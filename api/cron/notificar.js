const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');
const scraperHandler = require('../scraper.js');

// ---------------------------------------------------------
// CONFIGURAÇÃO
// ---------------------------------------------------------
const CONFIG = {
    brapiTimeoutMs:  8000,
    timezone_offset: -3,    // BRT (UTC-3)
    notif: {
        icon:  'https://in-vesto.vercel.app/icons/icon-192x192.png',
        badge: 'https://in-vesto.vercel.app/sininhov2.png',
        url:   '/?tab=tab-carteira',
    },
};

// ---------------------------------------------------------
// LOGGER ESTRUTURADO
// ---------------------------------------------------------
const log = {
    _w: (level, msg, meta) =>
        console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
            JSON.stringify({ level, msg, ...meta, ts: new Date().toISOString() })
        ),
    info:  (msg, meta = {}) => log._w('info',  msg, meta),
    warn:  (msg, meta = {}) => log._w('warn',  msg, meta),
    error: (msg, meta = {}) => log._w('error', msg, meta),
    timer: () => { const s = Date.now(); return () => Date.now() - s; },
};

// ---------------------------------------------------------
// INICIALIZAÇÃO (módulo — executada uma única vez)
// ---------------------------------------------------------
webpush.setVapidDetails(
    'mailto:mh.umateus@gmail.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
);

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ---------------------------------------------------------
// HELPERS
// ---------------------------------------------------------
function requestId() {
    return Math.random().toString(36).slice(2, 9);
}

function normalizeSymbol(symbol) {
    if (!symbol) return '';
    return symbol.trim().toUpperCase().replace('.SA', '');
}

// Obtém a data de hoje em BRT (UTC-3) sem depender de setHours frágil.
// setHours(h - 3) quebra silenciosamente quando hour < 3 (vira o dia anterior).
function getTodayBRT() {
    const now = new Date();
    const brt = new Date(now.getTime() + CONFIG.timezone_offset * 60 * 60 * 1000);
    return brt.toISOString().split('T')[0]; // YYYY-MM-DD
}

// Guard para fmtBRL — evita TypeError se value for null/undefined/NaN
function fmtBRL(val) {
    const n = Number(val);
    if (!isFinite(n)) return 'R$ --';
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ---------------------------------------------------------
// PARTE 1: PREÇOS SEQUENCIAIS VIA BRAPI
// Chamadas 1 a 1 com intervalo entre elas para respeitar o rate limit.
// ---------------------------------------------------------
const INTERVALO_MS = 250;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchPricesBatch(symbols) {
    const token = process.env.BRAPI_API_TOKEN;
    if (!token) throw new Error('BRAPI_API_TOKEN não configurado.');

    const pricesMap = {};
    log.info('Fetching prices sequentially', { count: symbols.length, intervalMs: INTERVALO_MS });

    for (const symbol of symbols) {
        const ticker     = symbol.endsWith('.SA') ? symbol : `${symbol}.SA`;
        const controller = new AbortController();
        const timeoutId  = setTimeout(() => controller.abort(), CONFIG.brapiTimeoutMs);

        try {
            // Token via header Authorization — não expõe na URL / logs de acesso
            const res = await fetch(`https://brapi.dev/api/quote/${ticker}`, {
                signal:  controller.signal,
                headers: {
                    'Accept':        'application/json',
                    'Authorization': `Bearer ${token}`,
                },
            });
            clearTimeout(timeoutId);

            if (res.status === 429) {
                log.warn('Brapi rate limit', { symbol });
                await sleep(INTERVALO_MS);
                continue;
            }

            if (!res.ok) {
                log.warn('Brapi non-ok response', { status: res.status, symbol });
                await sleep(INTERVALO_MS);
                continue;
            }

            const json  = await res.json();
            const price = json.results?.[0]?.regularMarketPrice ?? 0;
            if (price > 0) pricesMap[normalizeSymbol(symbol)] = price;

        } catch (err) {
            clearTimeout(timeoutId);
            log.error('Brapi fetch failed', { symbol, error: err.name });
        }

        await sleep(INTERVALO_MS);
    }

    return pricesMap;
}

// ---------------------------------------------------------
// PARTE 2: JOB DE PATRIMÔNIO
// ---------------------------------------------------------
async function atualizarPatrimonioJob(rid) {
    const elapsed = log.timer();
    log.info('Patrimônio job started', { rid });

    const [{ data: transacoes, error: errTx }, { data: appStates, error: errApp }] =
        await Promise.all([
            supabase.from('transacoes').select('user_id, symbol, type, quantity'),
            supabase.from('appstate').select('user_id, value_json').eq('key', 'saldoCaixa'),
        ]);

    if (errTx || errApp) {
        log.error('BD query failed', { rid, error: String(errTx || errApp) });
        return 0;
    }

    if (!transacoes?.length) return 0;

    // Mapeia carteiras por usuário
    const userHoldings    = {};
    const uniqueSymbolSet = new Set();

    for (const tx of transacoes) {
        const sym = normalizeSymbol(tx.symbol);
        uniqueSymbolSet.add(sym);
        if (!userHoldings[tx.user_id]) userHoldings[tx.user_id] = {};
        if (!userHoldings[tx.user_id][sym]) userHoldings[tx.user_id][sym] = 0;
        const qtd = Number(tx.quantity);
        if (tx.type === 'buy')  userHoldings[tx.user_id][sym] += qtd;
        if (tx.type === 'sell') userHoldings[tx.user_id][sym] -= qtd;
    }

    const symbolsToFetch = [...uniqueSymbolSet];
    log.info('Fetching prices', { rid, count: symbolsToFetch.length });

    const pricesMap = await fetchPricesBatch(symbolsToFetch);

    if (Object.keys(pricesMap).length === 0) {
        log.error('No prices obtained — aborting patrimônio update', { rid });
        return 0;
    }

    // Monta mapa de caixa por usuário
    const userCash = {};
    for (const item of appStates ?? []) {
        try {
            const raw    = typeof item.value_json === 'string' ? JSON.parse(item.value_json) : item.value_json;
            const val    = raw?.value !== undefined ? Number(raw.value) : (typeof raw === 'number' ? raw : 0);
            userCash[item.user_id] = isFinite(val) ? val : 0;
        } catch (e) {
            log.warn('Failed to parse value_json', { rid, user_id: item.user_id, error: e.message });
            userCash[item.user_id] = 0;
        }
    }

    const dataHoje  = getTodayBRT();
    const snapshots = [];

    for (const [userId, portfolio] of Object.entries(userHoldings)) {
        let totalAtivos = 0;
        for (const [sym, qtd] of Object.entries(portfolio)) {
            if (qtd <= 0.0001) continue;
            const preco = pricesMap[sym] ?? 0;
            if (preco > 0) totalAtivos += qtd * preco;
        }
        const patrimonioTotal = totalAtivos + (userCash[userId] ?? 0);
        if (patrimonioTotal > 0) {
            snapshots.push({
                user_id: userId,
                date:    dataHoje,
                value:   parseFloat(patrimonioTotal.toFixed(2)),
            });
        }
    }

    if (snapshots.length > 0) {
        const { error } = await supabase
            .from('patrimonio')
            .upsert(snapshots, { onConflict: 'user_id, date' });
        if (error) log.error('Erro ao salvar patrimônio', { rid, error: String(error) });
    }

    log.info('Patrimônio job done', { rid, snapshots: snapshots.length, ms: elapsed() });
    return snapshots.length;
}

// ---------------------------------------------------------
// PARTE 3: ATUALIZAÇÃO DE PROVENTOS
//
// Substitui o padrão de req/res falso por uma chamada direta
// ao scraperHandler com objetos mínimos mas corretos.
// Se a assinatura do handler mudar, o erro será explícito.
// ---------------------------------------------------------
async function atualizarProventosPeloScraper(fiiList) {
    return new Promise((resolve) => {
        let resultado = [];
        const fakeReq = {
            method: 'POST',
            body:   { mode: 'proventos_carteira', payload: { fiiList } },
        };
        const fakeRes = {
            setHeader: () => {},
            status:    () => ({
                json: (d) => { resultado = d?.json ?? []; resolve(resultado); },
            }),
            json: (d) => { resultado = d?.json ?? []; resolve(resultado); },
        };
        scraperHandler(fakeReq, fakeRes).catch(err => {
            log.error('scraperHandler error', { error: err.message });
            resolve([]);
        });
    });
}

// ---------------------------------------------------------
// PARTE 4: NOTIFICAÇÕES PUSH
//
// ANTES: 1 query ao Supabase por usuário dentro do loop.
//        N usuários = N queries.
// AGORA: 1 query para todos os usuários, resultado indexado por Map.
// ---------------------------------------------------------
async function enviarNotificacoes(rid) {
    const elapsed   = log.timer();
    const hojeString = getTodayBRT();
    const inicioDoDia = `${hojeString}T00:00:00`;
    const hojeDateObj = new Date(`${hojeString}T00:00:00Z`);

    const { data: proventos, error } = await supabase
        .from('proventosconhecidos')
        .select('*')
        .or(`paymentdate.eq.${hojeString},datacom.eq.${hojeString},created_at.gte.${inicioDoDia}`);

    if (error) {
        log.error('Erro ao buscar proventos para notificações', { rid, error: String(error) });
        return 0;
    }

    if (!proventos?.length) return 0;

    // Agrupa proventos por usuário
    const userEvents = {};
    for (const p of proventos) {
        if (!userEvents[p.user_id]) userEvents[p.user_id] = [];
        userEvents[p.user_id].push(p);
    }

    const userIds = Object.keys(userEvents);

    // Busca TODAS as subscriptions de uma vez, indexa por user_id
    const { data: allSubs, error: subErr } = await supabase
        .from('push_subscriptions')
        .select('*')
        .in('user_id', userIds);

    if (subErr) {
        log.error('Erro ao buscar subscriptions', { rid, error: String(subErr) });
        return 0;
    }

    const subsByUser = {};
    for (const sub of allSubs ?? []) {
        if (!subsByUser[sub.user_id]) subsByUser[sub.user_id] = [];
        subsByUser[sub.user_id].push(sub);
    }

    let totalSent      = 0;
    const staleSubIds  = []; // Coleta subs inválidas para deletar em lote ao final

    const matchDate = (field, dateStr) => field?.startsWith(dateStr) ?? false;

    for (const userId of userIds) {
        const subs = subsByUser[userId];
        if (!subs?.length) continue;

        const eventos     = userEvents[userId];
        const pagamentos  = eventos.filter(e => matchDate(e.paymentdate, hojeString));
        const dataComs    = eventos.filter(e => matchDate(e.datacom, hojeString));
        const novosAnuncios = eventos.filter(e => {
            const createdToday = matchDate(e.created_at, hojeString);
            const isDuplicate  = matchDate(e.datacom, hojeString) || matchDate(e.paymentdate, hojeString);
            const isFuturo     = e.paymentdate
                ? new Date(e.paymentdate.split('T')[0] + 'T00:00:00Z') >= hojeDateObj
                : false;
            return createdToday && !isDuplicate && isFuturo;
        });

        let title = '', body = '';

        if (pagamentos.length > 0) {
            const lista = pagamentos.map(p => `${p.symbol} (${fmtBRL(p.value)}/cota)`).join(', ');
            title = 'Crédito de Proventos';
            body  = pagamentos.length === 1
                ? `O ativo ${pagamentos[0].symbol} realizou pagamento de ${fmtBRL(pagamentos[0].value)}/cota hoje.`
                : `Pagamentos realizados hoje: ${lista}.`;

        } else if (dataComs.length > 0) {
            const lista = dataComs.map(p => `${p.symbol} (${fmtBRL(p.value)}/cota)`).join(', ');
            title = 'Data Com (Corte)';
            body  = `Data limite registrada hoje para: ${lista}.`;

        } else if (novosAnuncios.length > 0) {
            const lista = novosAnuncios
                .slice(0, 3)
                .map(p => `${p.symbol} (${fmtBRL(p.value)}/cota)`)
                .join(', ');
            title = 'Comunicado de Proventos';
            body  = novosAnuncios.length === 1
                ? `Comunicado: ${novosAnuncios[0].symbol} anunciou pagamento de ${fmtBRL(novosAnuncios[0].value)}/cota.`
                : `Novos anúncios: ${lista}${novosAnuncios.length > 3 ? '...' : ''}`;

        } else {
            continue;
        }

        const notifPayload = JSON.stringify({
            title,
            body,
            icon:  CONFIG.notif.icon,
            badge: CONFIG.notif.badge,
            url:   CONFIG.notif.url,
        });

        const pushResults = await Promise.allSettled(
            subs.map(sub => webpush.sendNotification(sub.subscription, notifPayload))
        );

        for (let i = 0; i < pushResults.length; i++) {
            const result = pushResults[i];
            if (result.status === 'fulfilled') {
                totalSent++;
            } else {
                const code = result.reason?.statusCode;
                if (code === 410 || code === 404) {
                    // Inscrição expirada — coleta para deletar em lote
                    staleSubIds.push(subs[i].id);
                } else {
                    log.warn('Push send failed', { userId, error: result.reason?.message });
                }
            }
        }
    }

    // Remove todas as subs inválidas de uma vez (1 query em vez de N)
    if (staleSubIds.length > 0) {
        const { error: delErr } = await supabase
            .from('push_subscriptions')
            .delete()
            .in('id', staleSubIds);
        if (delErr) log.warn('Erro ao deletar subs inválidas', { rid, error: String(delErr) });
        else log.info('Stale subs removed', { rid, count: staleSubIds.length });
    }

    log.info('Notificações enviadas', { rid, totalSent, ms: elapsed() });
    return totalSent;
}

// ---------------------------------------------------------
// PARTE 5: NOTIFICAÇÕES DE NOTÍCIAS (RSS)
// ---------------------------------------------------------
async function enviarNoticiasRSS(rid) {
    const elapsed = log.timer();
    log.info('RSS news job started', { rid });

    const RSSParser = require('rss-parser');
    const parser = new RSSParser();
    const RSS_URLS = [
        'https://www.infomoney.com.br/onde-investir/fundos-imobiliarios/feed/',
        'https://www.clubefiinews.com.br/feed/'
    ];

    let allItems = [];
    for (const feedUrl of RSS_URLS) {
        try {
            const feed = await parser.parseURL(feedUrl);
            if (feed && feed.items) {
                allItems.push(...feed.items);
            }
        } catch (err) {
            log.warn('Falha ao ler feed RSS', { rid, feedUrl, error: err.message });
        }
    }

    if (allItems.length === 0) return 0;

    // Busca guids já enviados (para não repetir)
    const { data: appStates } = await supabase
        .from('appstate')
        .select('*')
        .eq('key', 'last_news_sent')
        .limit(1);

    let enviadas = [];
    if (appStates && appStates.length > 0) {
        try {
            const raw = typeof appStates[0].value_json === 'string' 
                ? JSON.parse(appStates[0].value_json) 
                : appStates[0].value_json;
            if (Array.isArray(raw)) enviadas = raw;
        } catch(e) {}
    }
    const noticiasJaEnviadas = new Set(enviadas);

    // Carrega transacoes e subs em paralelo
    const [ { data: transacoes }, { data: allSubs } ] = await Promise.all([
        supabase.from('transacoes').select('user_id, symbol'),
        supabase.from('push_subscriptions').select('*')
    ]);

    if (!transacoes?.length || !allSubs?.length) return 0;

    // Monta Dicionários
    const symbolUserMap = {};
    for (const t of transacoes) {
        const sym = normalizeSymbol(t.symbol);
        if (!symbolUserMap[sym]) symbolUserMap[sym] = new Set();
        symbolUserMap[sym].add(t.user_id);
    }

    const subsByUser = {};
    for (const sub of allSubs) {
        if (!subsByUser[sub.user_id]) subsByUser[sub.user_id] = [];
        subsByUser[sub.user_id].push(sub);
    }

    // Processa Notícias (ordena mais recentes primeiro)
    allItems.sort((a,b) => new Date(b.pubDate || b.isoDate || 0) - new Date(a.pubDate || a.isoDate || 0));
    allItems = allItems.slice(0, 30); // Limita tamanho da fila de processamento

    const tickerRegex = /\b([A-Z]{4}11|[A-Z]{4}12)\b/g;
    let totalSent = 0;
    const staleSubIds = [];
    let guidsProcessadasHoje = [];
    
    for (const item of allItems) {
        const uniqueId = item.guid || item.link;
        if (!uniqueId || noticiasJaEnviadas.has(uniqueId)) continue;
        
        const textoBusca = `${item.title || ''} ${item.contentSnippet || item.content || ''}`;
        let matchedTickers = textoBusca.match(tickerRegex);
        
        if (!matchedTickers) {
            guidsProcessadasHoje.push(uniqueId);
            continue;
        }
        
        const uniqueTickers = [...new Set(matchedTickers)];
        let targetTickers = [];
        let usersToNotify = new Set();

        for (const ticker of uniqueTickers) {
            const sym = normalizeSymbol(ticker);
            if (symbolUserMap[sym]) {
                targetTickers.push(sym);
                for (const uid of symbolUserMap[sym]) usersToNotify.add(uid);
            }
        }

        if (usersToNotify.size === 0) {
            guidsProcessadasHoje.push(uniqueId);
            continue;
        }

        const titulo = item.title;
        // Strip HTML and get 100 chars max
        const excerpt = (item.contentSnippet || item.content || '').replace(/<[^>]*>?/gm, '').substring(0, 100) + '...';

        const notifPayload = JSON.stringify({
            title: `Notícia: ${targetTickers.join(', ')}`,
            body:  `${titulo}\n${excerpt}`,
            icon:  CONFIG.notif.icon,
            badge: CONFIG.notif.badge,
            url:   item.link || CONFIG.notif.url,
        });

        for (const userId of usersToNotify) {
            const subs = subsByUser[userId];
            if (!subs?.length) continue;

            const pushResults = await Promise.allSettled(
                subs.map(sub => webpush.sendNotification(sub.subscription, notifPayload))
            );

            for (let i = 0; i < pushResults.length; i++) {
                const res = pushResults[i];
                if (res.status === 'fulfilled') totalSent++;
                else {
                    const code = res.reason?.statusCode;
                    if (code === 410 || code === 404) staleSubIds.push(subs[i].id);
                }
            }
        }
        guidsProcessadasHoje.push(uniqueId);
    }

    if (staleSubIds.length > 0) {
        await supabase.from('push_subscriptions').delete().in('id', staleSubIds);
    }

    if (guidsProcessadasHoje.length > 0) {
        const novasGuidsArray = [...new Set([...guidsProcessadasHoje, ...enviadas])].slice(0, 150); // Buffer rotativo
        
        if (appStates && appStates.length > 0) {
            await supabase.from('appstate').update({
                value_json: JSON.stringify(novasGuidsArray)
            }).eq('key', 'last_news_sent');
        } else {
            await supabase.from('appstate').insert({
                user_id: '00000000-0000-0000-0000-000000000000',
                key: 'last_news_sent',
                value_json: JSON.stringify(novasGuidsArray)
            });
        }
    }

    log.info('RSS news job done', { rid, totalSent, ms: elapsed() });
    return totalSent;
}

// ---------------------------------------------------------
// HANDLER PRINCIPAL (CRON)
// ---------------------------------------------------------
module.exports = async function handler(req, res) {
    const rid     = requestId();
    const elapsed = log.timer();

    // Autenticação do cron — qualquer requisição não autorizada
    // poderia disparar o job inteiro e consumir cota da Brapi.
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
        const authHeader = req.headers['authorization'] ?? '';
        const token      = authHeader.replace('Bearer ', '').trim();
        if (token !== cronSecret) {
            log.warn('Unauthorized cron attempt', { rid });
            return res.status(401).json({ error: 'Não autorizado.' });
        }
    }

    log.info('Cron started', { rid });

    try {
        // 1. Proventos
        const { data: ativos } = await supabase.from('transacoes').select('symbol');
        if (ativos?.length > 0) {
            const symbols = [...new Set(ativos.map(a => normalizeSymbol(a.symbol)))].filter(Boolean);
            if (symbols.length > 0) {
                const novosDados = await atualizarProventosPeloScraper(symbols);

                if (novosDados?.length > 0) {
                    // Busca transações para montar mapeamento symbol → users
                    const { data: allTransacoes } = await supabase
                        .from('transacoes')
                        .select('user_id, symbol');

                    // Índice O(1): symbol normalizado → Set de user_ids
                    // ANTES: .filter() O(n×m) para cada item de novosDados
                    // AGORA: Map lookup O(1)
                    const symbolUserMap = {};
                    for (const t of allTransacoes ?? []) {
                        const sym = normalizeSymbol(t.symbol);
                        if (!symbolUserMap[sym]) symbolUserMap[sym] = new Set();
                        symbolUserMap[sym].add(t.user_id);
                    }

                    const upserts = [];
                    for (const dado of novosDados) {
                        if (!dado.paymentDate || !dado.value) continue;
                        const users = symbolUserMap[normalizeSymbol(dado.symbol)] ?? new Set();
                        const tipo  = (dado.type || 'REND').toUpperCase().trim();
                        const id    = `${dado.symbol}_${dado.paymentDate}_${tipo}_${parseFloat(dado.value).toFixed(4)}`;

                        for (const uid of users) {
                            upserts.push({
                                id,
                                user_id:     uid,
                                symbol:      dado.symbol,
                                value:       dado.value,
                                paymentdate: dado.paymentDate,
                                datacom:     dado.dataCom,
                                type:        tipo,
                                processado:  false,
                            });
                        }
                    }

                    if (upserts.length > 0) {
                        const { error } = await supabase
                            .from('proventosconhecidos')
                            .upsert(upserts, { onConflict: 'user_id, id', ignoreDuplicates: true });
                        if (error) log.error('Erro ao salvar proventos', { rid, error: String(error) });
                        else log.info('Proventos upserted', { rid, count: upserts.length });
                    }
                }
            }
        }

        // 2. Patrimônio
        const totalSnapshots = await atualizarPatrimonioJob(rid);

        // 3. Notificações de Proventos
        const totalSent = await enviarNotificacoes(rid);

        // 4. Notificações de Notícias FIIs (RSS)
        const totalNewsSent = await enviarNoticiasRSS(rid);

        const duration = ((Date.now() - elapsed()) / 1000 + elapsed() / 1000).toFixed(2);
        log.info('Cron finished', { rid, snapshots: totalSnapshots, notifications: totalSent, news: totalNewsSent, ms: elapsed() });

        return res.status(200).json({
            status:        'ok',
            rid,
            snapshots:     totalSnapshots,
            notifications: totalSent,
            news_sent:     totalNewsSent,
            ms:            elapsed(),
        });

    } catch (e) {
        log.error('Cron fatal error', { rid, error: e.message, stack: e.stack });
        return res.status(500).json({ error: e.message });
    }
};