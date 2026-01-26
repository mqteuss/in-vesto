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
// BAIXEI PARA 300ms. Se a Brapi bloquear, aumente levemente (ex: 500).
const INTERVALO_MS = 300; 

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

        // 3. Buscar Preços (Sequencial Rápido)
        const pricesMap = {};
        const token = process.env.BRAPI_API_TOKEN;

        if (!token) {
            console.error("ERRO: Token Brapi faltando.");
            return 0;
        }

        for (const symbol of symbolsToFetch) {
            const tickerParaApi = symbol.endsWith('.SA') ? symbol : `${symbol}.SA`;

            try {
                // Controller para abortar requisição se travar
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3000); // Max 3s por request

                const response = await fetch(`https://brapi.dev/api/quote/${tickerParaApi}?token=${token}`, {
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (response.status === 429) {
                    console.warn(`⚠️ Rate Limit em ${symbol}. Pulando para evitar travamento.`);
                    // Em modo rápido, se der 429, pulamos para tentar salvar o que já temos
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

            // Pausa curta
            await sleep(INTERVALO_MS);
        }

        // Se não pegou NENHUM preço, aborta
        if (Object.keys(pricesMap).length === 0 && symbolsToFetch.length > 0) {
            console.error("Nenhum preço obtido. Abortando.");
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
            // Salva tudo de uma vez (lote maior pois é rápido)
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
                // Pequeno delay inicial para garantir conexões
                await sleep(500); 
                const novos = await atualizarProventosPeloScraper(symbols);
                if (novos?.length > 0) {
                    const upserts = [];
                    const { data: allTx } = await supabase.from('transacoes').select('user_id, symbol');
                    for (const d of novos) {
                        if (!d.paymentDate || !d.value) continue;
                        const uids = [...new Set(allTx.filter(t => normalizeSymbol(t.symbol) === normalizeSymbol(d.symbol)).map(u => u.user_id))];
                        uids.forEach(uid => {
                            const tipo = (d.type || 'REND').toUpperCase().trim();
                            const id = `${d.symbol}_${d.paymentDate}_${tipo}_${parseFloat(d.value).toFixed(4)}`;
                            upserts.push({ id, user_id: uid, symbol: d.symbol, value: d.value, paymentdate: d.paymentDate, datacom: d.dataCom, type: tipo, processado: false });
                        });
                    }
                    if (upserts.length) await supabase.from('proventosconhecidos').upsert(upserts, { onConflict: 'user_id, id', ignoreDuplicates: true });
                }
            }
        }

        // 2. Patrimônio
        const snaps = await atualizarPatrimonioJob();

        // 3. Notificações
        const hoje = new Date();
        hoje.setHours(hoje.getHours() - 3);
        const hojeStr = hoje.toISOString().split('T')[0];
        const { data: provs } = await supabase.from('proventosconhecidos').select('*').or(`paymentdate.eq.${hojeStr},datacom.eq.${hojeStr},created_at.gte.${hojeStr}T00:00:00`);
        
        let sent = 0;
        if (provs?.length) {
            const events = {};
            provs.forEach(p => { if (!events[p.user_id]) events[p.user_id] = []; events[p.user_id].push(p); });
            for (const uid of Object.keys(events)) {
                const { data: subs } = await supabase.from('push_subscriptions').select('*').eq('user_id', uid);
                if (!subs?.length) continue;
                
                const evs = events[uid];
                const pays = evs.filter(e => e.paymentdate?.startsWith(hojeStr));
                const coms = evs.filter(e => e.datacom?.startsWith(hojeStr));
                const news = evs.filter(e => e.created_at?.startsWith(hojeStr) && !e.paymentdate?.startsWith(hojeStr) && !e.datacom?.startsWith(hojeStr));

                let t = '', b = '';
                if (pays.length) { t = '💰 Recebimento'; b = pays.map(p => p.symbol).join(', '); }
                else if (coms.length) { t = '📅 Data Com'; b = coms.map(p => p.symbol).join(', '); }
                else if (news.length) { t = '🔔 Anúncio'; b = news.slice(0,3).map(p => p.symbol).join(', '); }
                else continue;

                const pay = JSON.stringify({ title: t, body: b, icon: '/icons/icon-192x192.png', url: '/?tab=tab-carteira' });
                await Promise.all(subs.map(s => webpush.sendNotification(s.subscription, pay).catch(()=>{})));
                sent += subs.length;
            }
        }

        const dur = (Date.now() - start) / 1000;
        console.log(`Fim. Tempo: ${dur}s. Snaps: ${snaps}.`);
        return res.status(200).json({ status: 'Ok', snapshots: snaps, time: dur });

    } catch (e) {
        console.error('Fatal:', e);
        return res.status(500).json({ error: e.message });
    }
};
