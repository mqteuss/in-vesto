import Parser from 'rss-parser';

// ---------------------------------------------------------
// CONFIGURAÇÃO
// ---------------------------------------------------------
const CONFIG = {
    allowedOrigin:  process.env.ALLOWED_ORIGIN || '*',
    cacheTTL:       900,   // 15 min (s-maxage)
    timeoutMs:      10000,
    maxQueryLength: 200,
    defaultQuery:   'FII OR "Fundos Imobiliários" OR IFIX OR "Dividendos FII"',
    windowDays:     5,     // when:Nd no Google News
};

// ---------------------------------------------------------
// LOGGER ESTRUTURADO
// ---------------------------------------------------------
const log = {
    _w: (level, msg, meta) =>
        console[level === 'error' ? 'error' : 'log'](
            JSON.stringify({ level, msg, ...meta, ts: new Date().toISOString() })
        ),
    info:  (msg, meta = {}) => log._w('info',  msg, meta),
    warn:  (msg, meta = {}) => log._w('warn',  msg, meta),
    error: (msg, meta = {}) => log._w('error', msg, meta),
};

// ---------------------------------------------------------
// SINGLETON: Parser instanciado uma única vez no módulo.
// Sem isso, um novo Parser é alocado a cada request.
// ---------------------------------------------------------
const rssParser = new Parser({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
    timeout: CONFIG.timeoutMs,
    customFields: {
        item: [['source', 'sourceObj']],
    },
});

// ---------------------------------------------------------
// FONTES CONHECIDAS
// Definidas fora do handler: alocadas uma vez, nunca recriadas.
// ---------------------------------------------------------
const KNOWN_SOURCES_RAW = {
    'clube fii':                 { name: 'Clube FII',                domain: 'clubefii.com.br' },
    'funds explorer':            { name: 'Funds Explorer',           domain: 'fundsexplorer.com.br' },
    'status invest':             { name: 'Status Invest',            domain: 'statusinvest.com.br' },
    'fiis.com.br':               { name: 'FIIs.com.br',              domain: 'fiis.com.br' },
    'suno':                      { name: 'Suno Notícias',            domain: 'suno.com.br' },
    'investidor10':              { name: 'Investidor10',             domain: 'investidor10.com.br' },
    'money times':               { name: 'Money Times',              domain: 'moneytimes.com.br' },
    'infomoney':                 { name: 'InfoMoney',                domain: 'infomoney.com.br' },
    'investing.com':             { name: 'Investing.com',            domain: 'br.investing.com' },
    'mais retorno':              { name: 'Mais Retorno',             domain: 'maisretorno.com' },
    'valor investe':             { name: 'Valor Investe',            domain: 'valorinveste.globo.com' },
    'exame':                     { name: 'Exame',                    domain: 'exame.com' },
    'brazil journal':            { name: 'Brazil Journal',           domain: 'braziljournal.com' },
    'seu dinheiro':              { name: 'Seu Dinheiro',             domain: 'seudinheiro.com' },
    'neofeed':                   { name: 'NeoFeed',                  domain: 'neofeed.com.br' },
    'bmc news':                  { name: 'BMC News',                 domain: 'bmcnews.com.br' },
    'the cap':                   { name: 'The Cap',                  domain: 'thecap.com.br' },
    'inteligencia financeira':   { name: 'Inteligência Financeira',  domain: 'inteligenciafinanceira.com.br' },
    'inteligência financeira':   { name: 'Inteligência Financeira',  domain: 'inteligenciafinanceira.com.br' },
};

// Índice invertido pré-computado: O(1) para lookup exato, O(k) para parcial.
// Evita Object.keys().find() O(n) rodando para cada item do feed.
const SOURCE_INDEX = new Map(Object.entries(KNOWN_SOURCES_RAW));

function resolveSource(rawName) {
    const key = rawName.toLowerCase().trim();
    if (SOURCE_INDEX.has(key)) return SOURCE_INDEX.get(key);
    // Fallback: busca parcial (nome da fonte contém uma chave conhecida)
    for (const [k, v] of SOURCE_INDEX) {
        if (key.includes(k)) return v;
    }
    return null;
}

// ---------------------------------------------------------
// HELPERS
// ---------------------------------------------------------
function requestId() {
    return Math.random().toString(36).slice(2, 9);
}

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Normaliza publicationDate para ISO 8601.
// O formato raw do RSS (RFC 2822) varia entre fontes e pode quebrar Date().
function normalizeDate(raw) {
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d.toISOString();
}

// Sanitiza o parâmetro q: remove caracteres que não fazem sentido em uma
// query de notícias e que poderiam ser usados para manipular a URL final.
function sanitizeQuery(q) {
    return q
        .trim()
        .slice(0, CONFIG.maxQueryLength)           // limita tamanho
        .replace(/[<>{}[\]\\^`|]/g, '')            // remove chars perigosos
        .replace(/\s{2,}/g, ' ');                  // colapsa espaços múltiplos
}

// ---------------------------------------------------------
// EXTRAÇÃO DE ARTIGOS
// Isolada do handler para ser testável independentemente.
// ---------------------------------------------------------
function extractArticles(feedItems) {
    const seenTitles = new Set();
    const SOURCE_SUFFIX = /(?: - | \| )([^-|]+)$/;

    return feedItems
        .map(item => {
            // --- Extrai nome da fonte ---
            let rawSourceName = '';
            let cleanTitle = (item.title || 'Sem título').trim();

            if (item.sourceObj) {
                rawSourceName = item.sourceObj._ || item.sourceObj.content || '';
            }

            if (!rawSourceName) {
                const match = cleanTitle.match(SOURCE_SUFFIX);
                if (match) rawSourceName = match[1];
            }

            if (!rawSourceName) return null;

            // Remove o sufixo da fonte do título — RegExp criada uma vez por item
            const suffixRegex = new RegExp(
                `(?: - | \\| )\\s*${escapeRegExp(rawSourceName.trim())}$`
            );
            cleanTitle = cleanTitle.replace(suffixRegex, '').trim();

            // --- Resolve fonte conhecida ---
            const known = resolveSource(rawSourceName);
            if (!known) return null;

            // --- Deduplica por título limpo ---
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
            };
        })
        .filter(Boolean)
        .sort((a, b) => {
            // Itens sem data ficam no final
            if (!a.publicationDate) return 1;
            if (!b.publicationDate) return -1;
            return new Date(b.publicationDate) - new Date(a.publicationDate);
        });
}

// ---------------------------------------------------------
// HANDLER PRINCIPAL
// ---------------------------------------------------------
export default async function handler(request, response) {
    const rid = requestId();

    // CORS — headers mínimos necessários para uma API GET pública
    response.setHeader('Access-Control-Allow-Credentials', true);
    response.setHeader('Access-Control-Allow-Origin', CONFIG.allowedOrigin);
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('X-Request-Id', rid);

    if (request.method === 'OPTIONS') return response.status(200).end();

    // Enforcement do método HTTP
    if (request.method !== 'GET') {
        return response.status(405).json({ error: 'Método não permitido. Use GET.' });
    }

    // Validação e sanitização do parâmetro q
    const rawQ = request.query?.q;
    if (rawQ !== undefined && typeof rawQ !== 'string') {
        return response.status(400).json({ error: "Parâmetro 'q' inválido." });
    }

    const queryTerm  = rawQ ? sanitizeQuery(rawQ) : CONFIG.defaultQuery;
    const fullQuery  = `${queryTerm} when:${CONFIG.windowDays}d`;
    const feedUrl    = `https://news.google.com/rss/search?q=${encodeURIComponent(fullQuery)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;

    log.info('News request', { rid, query: queryTerm });

    try {
        // Timeout via Promise.race — rss-parser não expõe AbortController,
        // então competimos com uma Promise que rejeita após o limite.
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('TIMEOUT')), CONFIG.timeoutMs)
        );

        const feed = await Promise.race([
            rssParser.parseURL(feedUrl),
            timeoutPromise,
        ]);

        const articles = extractArticles(feed.items);

        // Cache definido aqui: nunca será enviado em resposta a OPTIONS ou erros
        response.setHeader(
            'Cache-Control',
            `s-maxage=${CONFIG.cacheTTL}, stale-while-revalidate=${Math.floor(CONFIG.cacheTTL / 3)}`
        );

        log.info('News request ok', { rid, count: articles.length });
        return response.status(200).json(articles);

    } catch (error) {
        if (error.message === 'TIMEOUT') {
            log.error('Feed timeout', { rid, feedUrl: feedUrl.split('?')[0] });
            return response.status(504).json({ error: 'Feed de notícias não respondeu a tempo.' });
        }

        // Distingue erro de rede/parsing de erro interno
        const isUpstreamError = error.message?.includes('Status code') ||
                                error.message?.includes('ENOTFOUND') ||
                                error.message?.includes('ECONNREFUSED');

        log.error('News feed error', {
            rid,
            type:  isUpstreamError ? 'upstream' : 'internal',
            error: error.message,
        });

        // Retorna 502 para falha de fonte externa, 500 para erro interno.
        // Antes: sempre 200 + [] — escondia falhas reais do cliente e do monitoramento.
        const statusCode = isUpstreamError ? 502 : 500;
        return response.status(statusCode).json({
            error: isUpstreamError
                ? 'Não foi possível obter o feed de notícias. Tente novamente.'
                : 'Erro interno ao processar notícias.',
        });
    }
}
