const Parser = require('rss-parser');




const DEFAULT_ALLOWED_ORIGIN = 'https://appvesto.vercel.app';

const CONFIG = {
    allowedOrigin:  process.env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN,
    cacheTTL:       900,   
    timeoutMs:      10000,
    maxQueryLength: 200,
    defaultQuery:   '("FII" OR "Fundos ImobiliÃ¡rios" OR "Dividendos" OR "AÃ§Ãµes" OR "Ibovespa")',
    windowDays:     30,     
};




const log = {
    _w: (level, msg, meta) =>
        console[level === 'error' ? 'error' : 'log'](
            JSON.stringify({ level, msg, ...meta, ts: new Date().toISOString() })
        ),
    info:  (msg, meta = {}) => log._w('info',  msg, meta),
    warn:  (msg, meta = {}) => log._w('warn',  msg, meta),
    error: (msg, meta = {}) => log._w('error', msg, meta),
};

function resolveAllowedOrigin(request) {
    const configured = (CONFIG.allowedOrigin || DEFAULT_ALLOWED_ORIGIN).trim();
    const requestOrigin = request.headers?.origin;
    if (
        typeof requestOrigin === 'string' &&
        /^https:\/\/appvesto(?:-[a-z0-9-]+)?\.vercel\.app$/i.test(requestOrigin)
    ) {
        return requestOrigin;
    }
    return configured || DEFAULT_ALLOWED_ORIGIN;
}

function applyCors(request, response) {
    const allowedOrigin = resolveAllowedOrigin(request);
    response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}





const rssParser = new Parser({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
    timeout: CONFIG.timeoutMs,
    customFields: {
        item: [
            ['source', 'sourceObj'],
            ['media:content', 'mediaContent'],
            ['media:thumbnail', 'mediaThumbnail'],
            ['enclosure', 'enclosure'],
        ],
    },
});





const KNOWN_SOURCES_RAW = {
    'infomoney':                 { name: 'InfoMoney',                domain: 'infomoney.com.br' },
    'money times':               { name: 'Money Times',              domain: 'moneytimes.com.br' },
    'suno':                      { name: 'Suno',                     domain: 'suno.com.br' },
    'investidor10':              { name: 'Investidor10',             domain: 'investidor10.com.br' },
    'seu dinheiro':              { name: 'Seu Dinheiro',             domain: 'seudinheiro.com' },
    'investing.com':             { name: 'Investing.com',            domain: 'br.investing.com' },
    'valor investe':             { name: 'Valor Investe',            domain: 'valorinveste.globo.com' },
    'valor':                     { name: 'Valor EconÃ´mico',          domain: 'valor.globo.com' },
    'valor econÃ´mico':           { name: 'Valor EconÃ´mico',          domain: 'valor.globo.com' },
    'exame':                     { name: 'Exame',                    domain: 'exame.com' },
    'bloomberg':                 { name: 'Bloomberg LÃ­nea',          domain: 'bloomberglinea.com.br' },
    'forbes':                    { name: 'Forbes Brasil',            domain: 'forbes.com.br' },
    'neofeed':                   { name: 'NeoFeed',                  domain: 'neofeed.com.br' },
    'brazil journal':            { name: 'Brazil Journal',           domain: 'braziljournal.com' },
    'inteligÃªncia financeira':   { name: 'InteligÃªncia Financeira',  domain: 'inteligenciafinanceira.com.br' },
    'inteligencia financeira':   { name: 'InteligÃªncia Financeira',  domain: 'inteligenciafinanceira.com.br' },
    'e-investidor':              { name: 'E-Investidor',             domain: 'einvestidor.estadao.com.br' },
    'cnn brasil':                { name: 'CNN Brasil',               domain: 'cnnbrasil.com.br' },
    'estadao':                   { name: 'EstadÃ£o',                  domain: 'estadao.com.br' },
    'estadÃ£o':                   { name: 'EstadÃ£o',                  domain: 'estadao.com.br' },
    'folha':                     { name: 'Folha de S.Paulo',         domain: 'folha.uol.com.br' },
    'g1':                        { name: 'G1',                       domain: 'g1.globo.com' },
    'o globo':                   { name: 'O Globo',                  domain: 'oglobo.globo.com' },
    'uol':                       { name: 'UOL Economia',             domain: 'economia.uol.com.br' },
    'istoÃ© dinheiro':            { name: 'IstoÃ‰ Dinheiro',           domain: 'istoedinheiro.com.br' },
    'istoe dinheiro':            { name: 'IstoÃ‰ Dinheiro',           domain: 'istoedinheiro.com.br' },
    'mais retorno':              { name: 'Mais Retorno',             domain: 'maisretorno.com' },
    'monitor do mercado':        { name: 'Monitor do Mercado',       domain: 'monitordomercado.com.br' },
    'investnews':                { name: 'InvestNews',               domain: 'investnews.com.br' },
    'invest news':               { name: 'InvestNews',               domain: 'investnews.com.br' },
};



const SOURCE_INDEX = new Map(Object.entries(KNOWN_SOURCES_RAW));

function resolveSource(rawName) {
    const key = rawName.toLowerCase().trim();
    if (SOURCE_INDEX.has(key)) return SOURCE_INDEX.get(key);
    
    for (const [k, v] of SOURCE_INDEX) {
        if (key.includes(k)) return v;
    }
    return null; 
}




function requestId() {
    return Math.random().toString(36).slice(2, 9);
}

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}



function normalizeDate(raw) {
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d.toISOString();
}



function sanitizeQuery(q) {
    return q
        .trim()
        .slice(0, CONFIG.maxQueryLength)           
        .replace(/[<>{}[\]\\^`|]/g, '')            
        .replace(/\s{2,}/g, ' ');                  
}






function extractImageUrl(item) {
    
    if (item.mediaContent) {
        const mc = item.mediaContent;
        const url = mc.$ ? mc.$.url : (mc.url || mc);
        if (typeof url === 'string' && url.startsWith('http')) return url;
    }
    
    if (item.mediaThumbnail) {
        const mt = item.mediaThumbnail;
        const url = mt.$ ? mt.$.url : (mt.url || mt);
        if (typeof url === 'string' && url.startsWith('http')) return url;
    }
    
    if (item.enclosure) {
        const enc = item.enclosure;
        const url = enc.url || (enc.$ ? enc.$.url : null);
        const type = enc.type || (enc.$ ? enc.$.type : '');
        if (url && (type.startsWith('image') || /\.(jpg|jpeg|png|webp|gif)/i.test(url))) return url;
    }
    
    const content = item.content || item['content:encoded'] || '';
    const imgMatch = content.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgMatch && imgMatch[1].startsWith('http')) return imgMatch[1];
    return null;
}

function extractArticles(feedItems) {
    const seenTitles = new Set();
    const SOURCE_SUFFIX = /(?: - | \| )([^-|]+)$/;

    return feedItems
        .map(item => {
            
            let rawSourceName = '';
            let cleanTitle = (item.title || 'Sem tÃ­tulo').trim();

            if (item.sourceObj) {
                rawSourceName = item.sourceObj._ || item.sourceObj.content || '';
            }

            
            if (!rawSourceName) {
                const match = cleanTitle.match(SOURCE_SUFFIX);
                if (match) rawSourceName = match[1];
            }

            
            if (!rawSourceName) return null;

            
            const suffixRegex = new RegExp(
                `(?: - | \\| )\\s*${escapeRegExp(rawSourceName.trim())}$`
            );
            cleanTitle = cleanTitle.replace(suffixRegex, '').trim();

            const known = resolveSource(rawSourceName);
            if (!known) return null;

            if (seenTitles.has(cleanTitle)) return null;
            seenTitles.add(cleanTitle);

            return {
                title:           cleanTitle,
                link:            item.link || null,
                publicationDate: normalizeDate(item.pubDate),
                sourceName:      known.name,
                sourceHostname:  known.domain,
                favicon:         `https://www.google.com/s2/favicons?domain=${known.domain}&sz=64`,
                summary:         item.contentSnippet || '',
                imageUrl:        extractImageUrl(item),
            };
        })
        .filter(Boolean)
        .sort((a, b) => {
            
            if (!a.publicationDate) return 1;
            if (!b.publicationDate) return -1;
            return new Date(b.publicationDate) - new Date(a.publicationDate);
        });
}




module.exports = async function handler(request, response) {
    const rid = requestId();

    
    applyCors(request, response);
    response.setHeader('X-Request-Id', rid);

    if (request.method === 'OPTIONS') return response.status(200).end();

    
    if (request.method !== 'GET') {
        return response.status(405).json({ error: 'MÃ©todo nÃ£o permitido. Use GET.' });
    }

    
    const rawQ = request.query?.q;
    const isRadar = request.query?.radar === 'true';
    if (rawQ !== undefined && typeof rawQ !== 'string') {
        return response.status(400).json({ error: "ParÃ¢metro 'q' invÃ¡lido." });
    }

    const sanitizedQ = rawQ ? sanitizeQuery(rawQ) : '';
    const queryTerm  = sanitizedQ || CONFIG.defaultQuery;
    const fullQuery  = `${queryTerm} when:${CONFIG.windowDays}d`;
    const feedUrl    = `https://news.google.com/rss/search?q=${encodeURIComponent(fullQuery)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;

    log.info('News request', { rid, query: queryTerm });

    let timeoutId;
    try {
        
        
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('TIMEOUT')), CONFIG.timeoutMs);
        });

        const feed = await Promise.race([rssParser.parseURL(feedUrl), timeoutPromise]);

        let targetItems = feed.items;
        
        
        
        
        if (rawQ && isRadar) {
            
            const cleanRawQ = sanitizeQuery(rawQ).replace(/["()]/g, '');
            const allowedTickers = cleanRawQ.split(' OR ').map(t => t.trim().toUpperCase()).filter(Boolean);
            if (allowedTickers.length > 0) {
                targetItems = feed.items.filter(item => {
                    const textContent = `${item.title || ''} ${item.contentSnippet || item.content || ''}`.toUpperCase();
                    return allowedTickers.some(ticker => new RegExp(`\\b${escapeRegExp(ticker)}\\b`).test(textContent));
                });
            }
        }

        const articles = extractArticles(targetItems);

        response.setHeader(
            'Cache-Control',
            `s-maxage=${CONFIG.cacheTTL}, stale-while-revalidate=${Math.floor(CONFIG.cacheTTL / 3)}`
        );

        log.info('News request ok', { rid, count: articles.length });
        return response.status(200).json(articles);

    } catch (error) {
        if (error.message === 'TIMEOUT') {
            log.error('Feed timeout', { rid, feedUrl: feedUrl.split('?')[0] });
            return response.status(504).json({ error: 'Feed de notÃ­cias nÃ£o respondeu a tempo.' });
        }

        const isUpstreamError = error.message?.includes('Status code') ||
                                error.message?.includes('ENOTFOUND') ||
                                error.message?.includes('ECONNREFUSED');

        log.error('News feed error', {
            rid,
            type:  isUpstreamError ? 'upstream' : 'internal',
            error: error.message,
        });

        const statusCode = isUpstreamError ? 502 : 500;
        return response.status(statusCode).json({
            error: isUpstreamError
                ? 'NÃ£o foi possÃ­vel obter o feed de notÃ­cias. Tente novamente.'
                : 'Erro interno ao processar notÃ­cias.',
        });
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}



