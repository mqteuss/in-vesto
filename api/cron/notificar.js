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

// --- FUNÇÃO DE CÁLCULO DE PATRIMÔNIO (SEQUENCIAL & ROBUSTA) ---
async function atualizarPatrimonioJob() {
    console.log("Iniciando snapshot de patrimônio...");
    try {
        // 1. Buscar dados necessários (Transações e Saldo em Caixa)
        const { data: transacoes, error: errTx } = await supabase
            .from('transacoes')
            .select('user_id, symbol, type, quantity');
        
        const { data: appStates, error: errApp } = await supabase
            .from('appstate')
            .select('user_id, value_json')
            .eq('key', 'saldoCaixa');

        if (errTx || errApp) {
            console.error("Erro ao buscar dados iniciais:", errTx || errApp);
            return 0;
        }
        if (!transacoes || transacoes.length === 0) return 0;

        // 2. Mapear Carteiras por Usuário
        const userHoldings = {};
        const uniqueSymbols = new Set();

        transacoes.forEach(tx => {
            if (!userHoldings[tx.user_id]) userHoldings[tx.user_id] = {};
            // Normaliza para maiúsculo e remove espaços
            const symbolClean = tx.symbol.trim().toUpperCase();
            
            if (!userHoldings[tx.user_id][symbolClean]) userHoldings[tx.user_id][symbolClean] = 0;

            if (tx.type === 'buy') {
                userHoldings[tx.user_id][symbolClean] += tx.quantity;
            } else if (tx.type === 'sell') {
                userHoldings[tx.user_id][symbolClean] -= tx.quantity;
            }
            uniqueSymbols.add(symbolClean);
        });

        // 3. Buscar Preços (SEQUENCIAL - SEM Promise.all)
        const symbolsArray = Array.from(uniqueSymbols);
        const pricesMap = {};
        
        // Lote pequeno para garantir que a URL não estoure e a API não bloqueie
        const CHUNK_SIZE = 15; 

        if (symbolsArray.length > 0) {
            const token = process.env.BRAPI_API_TOKEN;
            
            // Loop Sequencial: Espera um terminar para começar o outro
            for (let i = 0; i < symbolsArray.length; i += CHUNK_SIZE) {
                const chunk = symbolsArray.slice(i, i + CHUNK_SIZE);
                
                // Monta a URL forçando o sufixo .SA para garantir compatibilidade
                // A Brapi prefere "PETR4.SA" do que "PETR4"
                const tickersParaApi = chunk.map(s => s.endsWith('.SA') ? s : `${s}.SA`).join(',');
                
                try {
                    const url = `https://brapi.dev/api/quote/${tickersParaApi}?token=${token}`;
                    
                    // Await aqui garante a execução sequencial
                    const response = await fetch(url);
                    const json = await response.json();
                    
                    if (json.results) {
                        json.results.forEach(item => {
                            const preco = item.regularMarketPrice || 0;
                            const symbolUpper = item.symbol.toUpperCase();
                            
                            // Mapeamento Duplo: Garante que o sistema encontre o preço
                            // tanto se procurar por "MXRF11" quanto "MXRF11.SA"
                            pricesMap[symbolUpper] = preco; 
                            pricesMap[symbolUpper.replace('.SA', '')] = preco;
                        });
                    }
                } catch (errApi) {
                    console.error(`Erro ao buscar lote ${i}:`, errApi.message);
                    // Não para o loop, tenta o próximo lote
                }
            }
        }

        // 4. Mapear Saldo em Caixa e Calcular Totais
        const userCash = {};
        if (appStates) {
            appStates.forEach(item => {
                // Garante leitura correta do JSON { value: 100 }
                const val = item.value_json && item.value_json.value ? Number(item.value_json.value) : 0;
                userCash[item.user_id] = val;
            });
        }

        const hoje = new Date();
        hoje.setHours(hoje.getHours() - 3); // Ajuste fuso BR
        const dataHoje = hoje.toISOString().split('T')[0];
        
        const snapshots = [];

        Object.keys(userHoldings).forEach(userId => {
            let totalAtivos = 0;
            const portfolio = userHoldings[userId];

            // Soma valor dos ativos
            Object.keys(portfolio).forEach(symbol => {
                const qtd = portfolio[symbol];
                // Busca no mapa
                const preco = pricesMap[symbol] || 0;
                
                if (qtd > 0 && preco > 0) {
                    totalAtivos += (qtd * preco);
                }
            });

            // Soma caixa
            const caixa = userCash[userId] || 0;
            const patrimonioTotal = totalAtivos + caixa;

            // Salva se tiver patrimônio positivo
            if (patrimonioTotal > 0) {
                snapshots.push({
                    user_id: userId,
                    date: dataHoje,
                    value: parseFloat(patrimonioTotal.toFixed(2))
                });
            }
        });

        // 5. Salvar no Banco (Upsert)
        if (snapshots.length > 0) {
            // Salva em lotes de 100 para não sobrecarregar o Supabase
            for (let i = 0; i < snapshots.length; i += 100) {
                const batch = snapshots.slice(i, i + 100);
                const { error } = await supabase
                    .from('patrimonio')
                    .upsert(batch, { onConflict: 'user_id, date' });
                
                if (error) console.error("Erro ao salvar lote de patrimônio:", error);
            }
            console.log(`Snapshot salvo para ${snapshots.length} usuários.`);
            return snapshots.length;
        }

        return 0;

    } catch (e) {
        console.error("Erro fatal no job de patrimônio:", e);
        return 0;
    }
}

async function atualizarProventosPeloScraper(fiiList) {
    const req = { method: 'POST', body: { mode: 'proventos_carteira', payload: { fiiList } } };
    let resultado = [];

    const res = {
        setHeader: () => {},
        status: () => ({ json: (data) => { resultado = data.json; } }),
        json: (data) => { resultado = data.json; }
    };

    try {
        await scraperHandler(req, res);
        return resultado || [];
    } catch (e) {
        console.error("Erro interno no Scraper:", e.message);
        return [];
    }
}

module.exports = async function handler(req, res) {
    try {
        console.log("Iniciando processamento Cron...");
        const start = Date.now();

        // 1. ATUALIZAÇÃO DA BASE DE DADOS (PROVENTOS)
        const { data: ativos } = await supabase.from('transacoes').select('symbol');

        if (ativos?.length > 0) {
            const uniqueSymbols = [...new Set(ativos.map(a => a.symbol))];

            if (uniqueSymbols.length > 0) {
                const novosDados = await atualizarProventosPeloScraper(uniqueSymbols);

                if (novosDados?.length > 0) {
                    const upserts = [];
                    const { data: allTransacoes } = await supabase.from('transacoes').select('user_id, symbol');

                    for (const dado of novosDados) {
                        if (!dado.paymentDate || !dado.value) continue;

                        const usersInteressados = allTransacoes
                            .filter(t => t.symbol === dado.symbol)
                            .map(u => u.user_id);

                        const usersUnicos = [...new Set(usersInteressados)];

                        usersUnicos.forEach(uid => {
                             const tipoProvento = (dado.type || 'REND').toUpperCase().trim();
                             const valorFormatadoID = parseFloat(dado.value).toFixed(4);
                             const idGerado = `${dado.symbol}_${dado.paymentDate}_${tipoProvento}_${valorFormatadoID}`;

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
                        for (let i = 0; i < upserts.length; i += 200) {
                            await supabase.from('proventosconhecidos')
                                .upsert(upserts.slice(i, i + 200), { onConflict: 'user_id, id', ignoreDuplicates: true });
                        }
                    }
                }
            }
        }

        // 2. ATUALIZAÇÃO AUTOMÁTICA DE PATRIMÔNIO (Agora usando a função corrigida)
        const totalSnapshots = await atualizarPatrimonioJob();

        // 3. ENVIO DE NOTIFICAÇÕES
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
            
            // Loop sequencial também nas notificações para evitar sobrecarga
            for (const userId of usersIds) {
                try {
                    const eventos = userEvents[userId];
                    const { data: subs } = await supabase
                        .from('push_subscriptions').select('*').eq('user_id', userId);

                    if (!subs?.length) continue;

                    const matchDate = (f, s) => f && f.startsWith(s);

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
        console.log(`Cron concluído em ${duration}s. Notificações: ${totalSent}. Patrimônios: ${totalSnapshots}.`);
        return res.status(200).json({ status: 'Success', sent: totalSent, snapshots: totalSnapshots, time: duration });

    } catch (error) {
        console.error('Erro Fatal:', error);
        return res.status(500).json({ error: error.message });
    }
};
