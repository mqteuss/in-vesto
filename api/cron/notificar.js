const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');

// Ajuste o caminho do scraper conforme sua estrutura de pastas
const scraperHandler = require('../scraper.js');

webpush.setVapidDetails(
  'mailto:mh.umateus@gmail.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const fmtBRL = (val) => val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Normaliza Símbolos
function normalizeSymbol(symbol) {
    if (!symbol) return "";
    return symbol.trim().toUpperCase().replace('.SA', '');
}

// Pausa (Sleep)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- CONFIGURAÇÃO DE VELOCIDADE ---
// 300ms é rápido o suficiente para não dar timeout na Vercel, 
// mas lento o suficiente para a Brapi não bloquear (Erro 429).
const INTERVALO_MS = 250; 

async function atualizarPatrimonioJob() {
    console.log("=== INICIANDO JOB DE PATRIMÔNIO (MODO RÁPIDO) ===");
    try {
        // 1. Buscar dados
        const { data: transacoes, error: errTx } = await supabase
            .from('transacoes')
            .select('user_id, symbol, type, quantity');

        const { data: appStates, error: errApp } = await supabase
            .from('appstate')
            .select('user_id, value_json')
            .eq('key', 'saldoCaixa');

        if (errTx || errApp) {
            console.error("Erro BD:", errTx || errApp);
            return 0;
        }

        if (!transacoes || transacoes.length === 0) return 0;

        // 2. Mapear Carteiras
        const userHoldings = {};
        const uniqueSymbolsSet = new Set();

        transacoes.forEach(tx => {
            if (!userHoldings[tx.user_id]) userHoldings[tx.user_id] = {};
            const rawSymbol = tx.symbol.trim().toUpperCase();
            uniqueSymbolsSet.add(rawSymbol);
            const cleanSymbol = normalizeSymbol(rawSymbol);

            if (!userHoldings[tx.user_id][cleanSymbol]) userHoldings[tx.user_id][cleanSymbol] = 0;
            const qtd = Number(tx.quantity);
            if (tx.type === 'buy') userHoldings[tx.user_id][cleanSymbol] += qtd;
            else if (tx.type === 'sell') userHoldings[tx.user_id][cleanSymbol] -= qtd;
        });

        const symbolsToFetch = Array.from(uniqueSymbolsSet);
        console.log(`Buscando ${symbolsToFetch.length} ativos. Intervalo: ${INTERVALO_MS}ms.`);

        // 3. Buscar Preços (Sequencial Rápido com Timeout Controller)
        const pricesMap = {};
        const token = process.env.BRAPI_API_TOKEN;

        if (!token) {
            console.error("ERRO: Token Brapi faltando.");
            return 0;
        }

        for (const symbol of symbolsToFetch) {
            const tickerParaApi = symbol.endsWith('.SA') ? symbol : `${symbol}.SA`;

            try {
                // Controller para abortar requisição se travar por mais de 3s
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000); 

                const response = await fetch(`https://brapi.dev/api/quote/${tickerParaApi}?token=${token}`, {
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (response.status === 429) {
                    console.warn(`⚠️ Rate Limit em ${symbol}. Pulando para evitar travamento geral.`);
                    continue; 
                }

                if (response.ok) {
                    const json = await response.json();
                    if (json.results && json.results.length > 0) {
                        const p = json.results[0].regularMarketPrice || 0;
                        pricesMap[symbol] = p;
                        pricesMap[normalizeSymbol(symbol)] = p;
                    }
                }
            } catch (err) {
                console.error(`Falha ao buscar ${symbol}: ${err.name}`);
            }

            // Pausa curta para respeitar a API
            await sleep(INTERVALO_MS);
        }

        // Se não pegou NENHUM preço, aborta para não zerar saldo
        if (Object.keys(pricesMap).length === 0 && symbolsToFetch.length > 0) {
            console.error("Nenhum preço obtido. Abortando atualização de patrimônio.");
            return 0;
        }

        // 4. Calcular e Salvar
        const userCash = {};
        if (appStates) {
            appStates.forEach(item => {
                let val = 0;
                try {
                    const jsonVal = typeof item.value_json === 'string' ? JSON.parse(item.value_json) : item.value_json;
                    if (jsonVal?.value !== undefined) val = Number(jsonVal.value);
                    else if (typeof jsonVal === 'number') val = jsonVal;
                } catch (e) {}
                userCash[item.user_id] = val;
            });
        }

        const hoje = new Date();
        hoje.setHours(hoje.getHours() - 3);
        const dataHoje = hoje.toISOString().split('T')[0];
        const snapshots = [];

        Object.keys(userHoldings).forEach(userId => {
            let totalAtivos = 0;
            const portfolio = userHoldings[userId];

            Object.keys(portfolio).forEach(sym => {
                const qtd = portfolio[sym];
                if (qtd <= 0.0001) return;
                const preco = pricesMap[sym] || 0;
                if (preco > 0) totalAtivos += (qtd * preco);
            });

            const caixa = userCash[userId] || 0;
            const patrimonioTotal = totalAtivos + caixa;

            if (patrimonioTotal > 0) {
                snapshots.push({
                    user_id: userId,
                    date: dataHoje,
                    value: parseFloat(patrimonioTotal.toFixed(2))
                });
            }
        });

        if (snapshots.length > 0) {
            const { error } = await supabase.from('patrimonio').upsert(snapshots, { onConflict: 'user_id, date' });
            if (error) console.error("Erro ao salvar:", error);
            return snapshots.length;
        }

        return 0;
    } catch (e) {
        console.error("Erro Fatal Job:", e);
        return 0;
    }
}

async function atualizarProventosPeloScraper(fiiList) {
    const req = { method: 'POST', body: { mode: 'proventos_carteira', payload: { fiiList } } };
    let resultado = [];
    const res = { setHeader: () => {}, status: () => ({ json: (d) => resultado = d.json }), json: (d) => resultado = d.json };
    try { await scraperHandler(req, res); return resultado || []; } catch (e) { return []; }
}

module.exports = async function handler(req, res) {
    try {
        console.log("Cron Iniciado...");
        const start = Date.now();

        // 1. Proventos
        const { data: ativos } = await supabase.from('transacoes').select('symbol');
        if (ativos?.length > 0) {
            const symbols = [...new Set(ativos.map(a => a.symbol))];
            if (symbols.length > 0) {
                await sleep(500); 
                const novosDados = await atualizarProventosPeloScraper(symbols);

                if (novosDados?.length > 0) {
                    const upserts = [];
                    const { data: allTransacoes } = await supabase.from('transacoes').select('user_id, symbol');
                    
                    for (const dado of novosDados) {
                        if (!dado.paymentDate || !dado.value) continue;

                        const usersInteressados = allTransacoes
                            .filter(t => normalizeSymbol(t.symbol) === normalizeSymbol(dado.symbol))
                            .map(u => u.user_id);

                        const usersUnicos = [...new Set(usersInteressados)];

                        usersUnicos.forEach(uid => {
                             const tipoProvento = (dado.type || 'REND').toUpperCase().trim();
                             const idGerado = `${dado.symbol}_${dado.paymentDate}_${tipoProvento}_${parseFloat(dado.value).toFixed(4)}`;

                             upserts.push({
                                 id: idGerado,
                                 user_id: uid,
                                 symbol: dado.symbol,
                                 value: dado.value,
                                 paymentdate: dado.paymentDate,
                                 datacom: dado.dataCom,
                                 type: tipoProvento, 
                                 processado: false
                             });
                        });
                    }

                    if (upserts.length > 0) {
                        // Salva proventos
                        await supabase.from('proventosconhecidos')
                            .upsert(upserts, { onConflict: 'user_id, id', ignoreDuplicates: true });
                    }
                }
            }
        }

        // 2. Patrimônio (Versão Otimizada)
        const totalSnapshots = await atualizarPatrimonioJob();

        // 3. Notificações (VERSÃO ORIGINAL RESTAURADA)
        const agora = new Date();
        agora.setHours(agora.getHours() - 3); 
        const hojeString = agora.toISOString().split('T')[0];
        const inicioDoDia = `${hojeString}T00:00:00`;
        const hojeDateObj = new Date(hojeString + 'T00:00:00');

        const { data: proventos } = await supabase
            .from('proventosconhecidos')
            .select('*')
            .or(`paymentdate.eq.${hojeString},datacom.eq.${hojeString},created_at.gte.${inicioDoDia}`);

        let totalSent = 0;

        if (proventos && proventos.length > 0) {
            const userEvents = {};
            proventos.forEach(p => {
                if (!userEvents[p.user_id]) userEvents[p.user_id] = [];
                userEvents[p.user_id].push(p);
            });

            const usersIds = Object.keys(userEvents);

            for (const userId of usersIds) {
                try {
                    const eventos = userEvents[userId];
                    const { data: subs } = await supabase
                        .from('push_subscriptions').select('*').eq('user_id', userId);

                    if (!subs?.length) continue;

                    const matchDate = (f, s) => f && f.startsWith(s);

                    // Filtros
                    const pagamentos = eventos.filter(e => matchDate(e.paymentdate, hojeString));
                    const dataComs = eventos.filter(e => matchDate(e.datacom, hojeString));
                    const novosAnuncios = eventos.filter(e => {
                        const createdToday = (e.created_at || '').startsWith(hojeString);
                        const duplicate = matchDate(e.datacom, hojeString) || matchDate(e.paymentdate, hojeString);
                        let isFuturo = false;
                        if (e.paymentdate) {
                            const d = new Date(e.paymentdate.split('T')[0] + 'T00:00:00');
                            isFuturo = d >= hojeDateObj;
                        }
                        return createdToday && !duplicate && isFuturo;
                    });

                    // --- RECONSTRUÇÃO DAS MENSAGENS ORIGINAIS ---
                    let title = '', body = '';
                    const icon = 'https://in-vesto.vercel.app/icons/icon-192x192.png'; 
                    const badge = 'https://in-vesto.vercel.app/sininhov2.png';

                    if (pagamentos.length > 0) {
                        const lista = pagamentos.map(p => `${p.symbol} (${fmtBRL(p.value)}/cota)`).join(', ');
                        title = 'Crédito de Proventos';
                        body = pagamentos.length === 1 
                            ? `O ativo ${pagamentos[0].symbol} realizou pagamento de ${fmtBRL(pagamentos[0].value)}/cota hoje.` 
                            : `Pagamentos realizados hoje: ${lista}.`;

                    } else if (dataComs.length > 0) {
                        const lista = dataComs.map(p => `${p.symbol} (${fmtBRL(p.value)}/cota)`).join(', ');
                        title = 'Data Com (Corte)';
                        body = `Data limite registrada hoje para: ${lista}.`;

                    } else if (novosAnuncios.length > 0) {
                        const lista = novosAnuncios.map(p => `${p.symbol} (${fmtBRL(p.value)}/cota)`).slice(0,3).join(', ');
                        title = 'Comunicado de Proventos';
                        body = novosAnuncios.length === 1
                            ? `Comunicado: ${novosAnuncios[0].symbol} anunciou pagamento de ${fmtBRL(novosAnuncios[0].value)}/cota.`
                            : `Novos anúncios: ${lista}${novosAnuncios.length > 3 ? '...' : ''}`;
                    } else {
                        continue; 
                    }

                    const payload = JSON.stringify({ 
                        title, 
                        body, 
                        icon, 
                        badge,
                        url: '/?tab=tab-carteira'
                    });

                    const pushPromises = subs.map(sub => 
                        webpush.sendNotification(sub.subscription, payload).catch(err => {
                            // Remove inscrição inválida
                            if (err.statusCode === 410 || err.statusCode === 404) {
                                supabase.from('push_subscriptions').delete().match({ id: sub.id }).then(()=>{});
                            }
                        })
                    );
                    await Promise.all(pushPromises);
                    totalSent += pushPromises.length;

                } catch (errUser) {
                    console.error(`Erro user ${userId}:`, errUser.message);
                }
            }
        }

        const duration = (Date.now() - start) / 1000;
        console.log(`Fim. Tempo: ${duration}s. Snapshots: ${totalSnapshots}. Msg: ${totalSent}`);
        return res.status(200).json({ status: 'Ok', snapshots: totalSnapshots, time: duration });

    } catch (e) {
        console.error('Fatal:', e);
        return res.status(500).json({ error: e.message });
    }
};
