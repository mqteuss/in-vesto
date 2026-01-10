const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');

// Ajuste o caminho do scraper conforme necessário
// Se o scraper.js não estiver disponível neste contexto para cotações, usamos fetch direto na Brapi
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

// --- NOVA FUNÇÃO: BUSCAR PREÇOS EM LOTE (BRAPI) ---
async function buscarPrecosBrapi(tickers) {
    if (!tickers || tickers.length === 0) return {};
    
    // Remove duplicados
    const uniqueTickers = [...new Set(tickers)];
    const token = process.env.BRAPI_API_TOKEN;
    
    // Brapi aceita múltiplos tickers separados por vírgula (limitado a ~20 por vez na free, ou mais na pro)
    // Para segurança, vamos buscar em chunks de 20 ou fazer loop se for muito grande
    // Aqui faremos uma chamada única assumindo que a lista cabe na URL (limite de caracteres)
    const tickersString = uniqueTickers.map(t => t.endsWith('11') || t.endsWith('3') || t.endsWith('4') ? t + '.SA' : t).join(',');
    
    try {
        const url = `https://brapi.dev/api/quote/${tickersString}?token=${token}`;
        const response = await fetch(url);
        const data = await response.json();
        
        const mapaPrecos = {};
        
        if (data.results) {
            data.results.forEach(item => {
                // Remove o .SA para bater com o banco de dados
                const symbolClean = item.symbol.replace('.SA', '');
                mapaPrecos[symbolClean] = item.regularMarketPrice;
            });
        }
        return mapaPrecos;
    } catch (e) {
        console.error("Erro ao buscar preços Brapi:", e.message);
        return {};
    }
}

// --- NOVA FUNÇÃO: SNAPSHOT DE PATRIMÔNIO ---
async function atualizarPatrimonioJob() {
    console.log("Iniciando Snapshot de Patrimônio...");
    
    // 1. Buscar todas as transações de todos os usuários
    const { data: transacoes, error: errTx } = await supabase
        .from('transacoes')
        .select('user_id, symbol, type, quantity');

    if (errTx) {
        console.error("Erro ao ler transações:", errTx);
        return 0;
    }

    // 2. Buscar Saldo em Caixa (AppState) de todos os usuários
    const { data: appStates, error: errState } = await supabase
        .from('appstate')
        .select('user_id, value_json')
        .eq('key', 'saldoCaixa');

    if (errState) console.error("Erro ao ler caixa:", errState);

    // Mapa de Caixa por Usuário
    const caixaPorUser = {};
    if (appStates) {
        appStates.forEach(row => {
            caixaPorUser[row.user_id] = row.value_json?.value || 0;
        });
    }

    // 3. Identificar todos os ativos únicos para buscar preço
    const todosAtivos = transacoes.map(t => t.symbol);
    if (todosAtivos.length === 0) return 0;

    const mapaPrecos = await buscarPrecosBrapi(todosAtivos);

    // 4. Calcular Carteira por Usuário em Memória
    const portfolios = {}; // { user_id: { symbol: quantidade } }

    transacoes.forEach(tx => {
        if (!portfolios[tx.user_id]) portfolios[tx.user_id] = {};
        
        if (!portfolios[tx.user_id][tx.symbol]) portfolios[tx.user_id][tx.symbol] = 0;

        const qtd = Number(tx.quantity);
        if (tx.type === 'buy') {
            portfolios[tx.user_id][tx.symbol] += qtd;
        } else if (tx.type === 'sell') {
            portfolios[tx.user_id][tx.symbol] -= qtd;
        }
    });

    // 5. Calcular Total Financeiro e Preparar Upsert
    const snapshots = [];
    const hoje = new Date();
    hoje.setHours(hoje.getHours() - 3); // Ajuste Brasil
    const dataHoje = hoje.toISOString().split('T')[0]; // YYYY-MM-DD

    for (const userId of Object.keys(portfolios)) {
        let totalAtivos = 0;
        const carteiraUser = portfolios[userId];

        // Soma Ativos
        for (const [symbol, qtd] of Object.entries(carteiraUser)) {
            if (qtd > 0.0001) { // Ignora posições zeradas
                const preco = mapaPrecos[symbol] || 0;
                totalAtivos += (qtd * preco);
            }
        }

        // Soma Caixa
        const saldoCaixa = caixaPorUser[userId] || 0;
        const totalGeral = totalAtivos + saldoCaixa;

        if (totalGeral > 0) {
            snapshots.push({
                user_id: userId,
                date: dataHoje,
                value: parseFloat(totalGeral.toFixed(2))
            });
        }
    }

    // 6. Salvar no Banco
    if (snapshots.length > 0) {
        const { error } = await supabase
            .from('patrimonio')
            .upsert(snapshots, { onConflict: 'user_id, date' });
        
        if (error) console.error("Erro ao salvar snapshots:", error);
        else console.log(`Snapshots salvos para ${snapshots.length} usuários.`);
    }
    
    return snapshots.length;
}

// --- FUNÇÕES ORIGINAIS DO SCRAPER (Mantidas) ---
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

// --- HANDLER PRINCIPAL ---
module.exports = async function handler(req, res) {
    try {
        console.log("Iniciando processamento (Cron Job)...");
        const start = Date.now();

        // ============================================
        // 1. ATUALIZAÇÃO DA BASE DE DADOS (Proventos)
        // ============================================
        const { data: ativos } = await supabase.from('transacoes').select('symbol');

        if (ativos?.length > 0) {
            const uniqueSymbols = [...new Set(ativos.map(a => a.symbol))];

            if (uniqueSymbols.length > 0) {
                const novosDados = await atualizarProventosPeloScraper(uniqueSymbols);

                if (novosDados?.length > 0) {
                    const upserts = [];
                    const { data: allTransacoes } = await supabase
                        .from('transacoes')
                        .select('user_id, symbol');

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
                        // Upsert em lotes para não estourar limite
                        for (let i = 0; i < upserts.length; i += 200) {
                            await supabase.from('proventosconhecidos')
                                .upsert(upserts.slice(i, i + 200), { onConflict: 'user_id, id', ignoreDuplicates: true });
                        }
                    }
                }
            }
        }

        // ============================================
        // 2. SNAPSHOT DE PATRIMÔNIO (NOVO)
        // ============================================
        // Executa o cálculo e salvamento do patrimônio total do dia
        await atualizarPatrimonioJob();


        // ============================================
        // 3. ENVIO DE NOTIFICAÇÕES (PUSH)
        // ============================================
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

        if (proventos?.length) {
            const userEvents = {};
            proventos.forEach(p => {
                if (!userEvents[p.user_id]) userEvents[p.user_id] = [];
                userEvents[p.user_id].push(p);
            });

            const usersIds = Object.keys(userEvents);

            await Promise.all(usersIds.map(async (userId) => {
                try {
                    const eventos = userEvents[userId];
                    const { data: subs } = await supabase
                        .from('push_subscriptions').select('*').eq('user_id', userId);

                    if (!subs?.length) return;

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
                    const icon = 'https://in-vesto.vercel.app/logo-vesto.png'; 
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
                        return; 
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
            }));
        }

        const duration = (Date.now() - start) / 1000;
        console.log(`Job Concluído em ${duration}s. Notificações: ${totalSent}`);
        return res.status(200).json({ status: 'Success', sent: totalSent, time: duration });

    } catch (error) {
        console.error('Erro Fatal no Job:', error);
        return res.status(500).json({ error: error.message });
    }
};
