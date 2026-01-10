import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

// Configurações do WebPush
webpush.setVapidDetails(
  'mailto:mh.umateus@gmail.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// Inicializa Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const fmtBRL = (val) => val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// --- IMPORTAÇÃO DINÂMICA DO SCRAPER ---
// Tenta carregar o scraper de locais diferentes para evitar erro de caminho
let scraperHandler = null;
async function carregarScraper() {
    if (scraperHandler) return scraperHandler;
    try {
        // Tenta buscar na mesma pasta (ex: /api/scraper.js)
        let mod = await import('./scraper.js');
        scraperHandler = mod.default;
    } catch (e1) {
        try {
            // Tenta buscar na pasta anterior (ex: ../scraper.js)
            let mod = await import('../scraper.js');
            scraperHandler = mod.default;
        } catch (e2) {
            console.warn("Aviso: scraper.js não encontrado. A atualização de proventos novos será pulada.");
        }
    }
    return scraperHandler;
}

// --- 1. FUNÇÃO DE PREÇOS (BRAPI) ---
async function buscarPrecosBrapi(tickers) {
    if (!tickers || tickers.length === 0) return {};
    const uniqueTickers = [...new Set(tickers)];
    
    // Limita tamanho da URL
    const tickersString = uniqueTickers.slice(0, 40).map(t => t.endsWith('11') || t.endsWith('3') || t.endsWith('4') ? t + '.SA' : t).join(',');
    
    try {
        const token = process.env.BRAPI_API_TOKEN;
        const url = `https://brapi.dev/api/quote/${tickersString}?token=${token}`;
        const response = await fetch(url);
        const data = await response.json();
        
        const mapaPrecos = {};
        if (data.results) {
            data.results.forEach(item => {
                const symbolClean = item.symbol.replace('.SA', '');
                mapaPrecos[symbolClean] = item.regularMarketPrice;
            });
        }
        return mapaPrecos;
    } catch (e) {
        console.error("Erro Brapi:", e.message);
        return {};
    }
}

// --- 2. JOB: ATUALIZAR PATRIMÔNIO (Snapshot) ---
async function atualizarPatrimonioJob() {
    console.log(">> Iniciando Snapshot de Patrimônio...");
    
    const { data: transacoes } = await supabase.from('transacoes').select('user_id, symbol, type, quantity');
    const { data: appStates } = await supabase.from('appstate').select('user_id, value_json').eq('key', 'saldoCaixa');
    
    if (!transacoes || transacoes.length === 0) return;

    const todosAtivos = transacoes.map(t => t.symbol);
    const mapaPrecos = await buscarPrecosBrapi(todosAtivos);
    
    const caixaPorUser = {};
    if (appStates) appStates.forEach(r => caixaPorUser[r.user_id] = r.value_json?.value || 0);

    const portfolios = {}; 
    transacoes.forEach(tx => {
        if (!portfolios[tx.user_id]) portfolios[tx.user_id] = {};
        if (!portfolios[tx.user_id][tx.symbol]) portfolios[tx.user_id][tx.symbol] = 0;
        
        const qtd = Number(tx.quantity);
        if (tx.type === 'buy') portfolios[tx.user_id][tx.symbol] += qtd;
        else if (tx.type === 'sell') portfolios[tx.user_id][tx.symbol] -= qtd;
    });

    const snapshots = [];
    const hoje = new Date();
    hoje.setHours(hoje.getHours() - 3); 
    const dataHoje = hoje.toISOString().split('T')[0];

    for (const userId of Object.keys(portfolios)) {
        let totalAtivos = 0;
        for (const [symbol, qtd] of Object.entries(portfolios[userId])) {
            if (qtd > 0.0001) {
                const preco = mapaPrecos[symbol] || 0;
                totalAtivos += (qtd * preco);
            }
        }
        
        const totalGeral = totalAtivos + (caixaPorUser[userId] || 0);
        
        if (totalGeral > 0) {
            snapshots.push({ 
                user_id: userId, 
                date: dataHoje, 
                value: parseFloat(totalGeral.toFixed(2)) 
            });
        }
    }

    if (snapshots.length > 0) {
        await supabase.from('patrimonio').upsert(snapshots, { onConflict: 'user_id, date' });
        console.log(`>> Patrimônio salvo para ${snapshots.length} usuários.`);
    }
}

// --- 3. HELPER: BUSCAR PROVENTOS VIA SCRAPER ---
async function atualizarProventosPeloScraper(fiiList) {
    const handler = await carregarScraper();
    if (!handler) return [];

    const req = { method: 'POST', body: { mode: 'proventos_carteira', payload: { fiiList } } };
    let resultado = [];
    
    // Mock de Response object para reutilizar a lógica do scraper existente
    const res = {
        setHeader: () => {},
        status: () => ({ json: (data) => { resultado = data.json; } }),
        json: (data) => { resultado = data.json; }
    };
    try {
        await handler(req, res);
        return resultado || [];
    } catch (e) { return []; }
}

// ==========================================
// HANDLER PRINCIPAL (Export Default - ESM)
// ==========================================
export default async function handler(req, res) {
    try {
        console.log("Iniciando Cron Job (ESM)...");
        const start = Date.now();
        
        const agora = new Date();
        agora.setHours(agora.getHours() - 3);
        const hojeString = agora.toISOString().split('T')[0];
        const inicioDoDia = `${hojeString}T00:00:00`;
        const hojeDateObj = new Date(hojeString + 'T00:00:00');

        // ------------------------------------------
        // PASSO 1: Atualizar Base de Proventos
        // ------------------------------------------
        const { data: ativos } = await supabase.from('transacoes').select('symbol');
        if (ativos?.length > 0) {
            const uniqueSymbols = [...new Set(ativos.map(a => a.symbol))];
            if (uniqueSymbols.length > 0) {
                const novosDados = await atualizarProventosPeloScraper(uniqueSymbols);
                
                if (novosDados?.length > 0) {
                    const upserts = [];
                    const { data: allTx } = await supabase.from('transacoes').select('user_id, symbol');
                    
                    for (const dado of novosDados) {
                        if (!dado.paymentDate || !dado.value) continue;
                        
                        const users = allTx.filter(t => t.symbol === dado.symbol).map(u => u.user_id);
                        [...new Set(users)].forEach(uid => {
                            const tipo = (dado.type || 'REND').toUpperCase().trim();
                            const valFmt = parseFloat(dado.value).toFixed(4);
                            const id = `${dado.symbol}_${dado.paymentDate}_${tipo}_${valFmt}`;
                            
                            upserts.push({
                                id, 
                                user_id: uid, 
                                symbol: dado.symbol, 
                                value: dado.value,
                                paymentdate: dado.paymentDate, 
                                datacom: dado.dataCom, 
                                type: tipo, 
                                processado: false
                            });
                        });
                    }
                    
                    for (let i = 0; i < upserts.length; i += 200) {
                        await supabase.from('proventosconhecidos')
                            .upsert(upserts.slice(i, i + 200), { onConflict: 'user_id, id', ignoreDuplicates: true });
                    }
                }
            }
        }

        // ------------------------------------------
        // PASSO 2: Salvar Snapshot de Patrimônio
        // ------------------------------------------
        await atualizarPatrimonioJob();

        // ------------------------------------------
        // PASSO 3: Enviar Notificações
        // ------------------------------------------
        const { data: proventos } = await supabase
            .from('proventosconhecidos')
            .select('*')
            .or(`paymentdate.eq.${hojeString},datacom.eq.${hojeString},created_at.gte.${inicioDoDia}`);

        const { data: allSubs } = await supabase.from('push_subscriptions').select('*');
        
        if (!allSubs?.length) {
            return res.status(200).json({ status: 'Success', msg: 'Sem inscritos.' });
        }

        const userMap = {};
        allSubs.forEach(sub => {
            if (!userMap[sub.user_id]) userMap[sub.user_id] = { subs: [], proventos: [] };
            userMap[sub.user_id].subs.push(sub);
        });

        if (proventos) proventos.forEach(p => {
            if (userMap[p.user_id]) userMap[p.user_id].proventos.push(p);
        });

        let totalSent = 0;

        await Promise.all(Object.keys(userMap).map(async (userId) => {
            const uData = userMap[userId];
            const eventos = uData.proventos;
            
            if (eventos.length === 0) return;

            const matchDate = (f, s) => f && f.startsWith(s);
            
            const pagamentos = eventos.filter(e => matchDate(e.paymentdate, hojeString));
            const dataComs = eventos.filter(e => matchDate(e.datacom, hojeString));
            const novosAnuncios = eventos.filter(e => {
                const created = (e.created_at || '').startsWith(hojeString);
                const isDup = matchDate(e.datacom, hojeString) || matchDate(e.paymentdate, hojeString);
                let isValido = true;
                if (e.paymentdate) {
                    const d = new Date(e.paymentdate.split('T')[0] + 'T00:00:00');
                    isValido = d >= hojeDateObj;
                }
                return created && !isDup && isValido;
            });

            // Lógica de Prioridade (Formato Original)
            let title = '', body = '';
            const icon = 'https://in-vesto.vercel.app/logo-vesto.png';
            const badge = 'https://in-vesto.vercel.app/sininhov2.png';
            const url = '/?tab=tab-carteira';

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
                return;
            }

            const payload = JSON.stringify({ title, body, icon, badge, url });
            
            const promises = uData.subs.map(sub => 
                webpush.sendNotification(sub.subscription, payload).catch(err => {
                    if (err.statusCode === 410 || err.statusCode === 404) {
                        supabase.from('push_subscriptions').delete().match({ id: sub.id }).then(()=>{});
                    }
                })
            );
            await Promise.all(promises);
            totalSent += promises.length;
        }));

        const duration = (Date.now() - start) / 1000;
        console.log(`Fim. Tempo: ${duration}s. Envios: ${totalSent}`);
        return res.status(200).json({ status: 'Success', sent: totalSent });

    } catch (error) {
        console.error('Erro Fatal:', error);
        return res.status(500).json({ error: error.message });
    }
};
