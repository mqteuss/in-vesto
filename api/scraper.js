const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// ---------------------------------------------------------
// CONFIGURAÇÃO CENTRAL
// ---------------------------------------------------------
const CONFIG = {
    allowedOrigin: process.env.ALLOWED_ORIGIN || 'https://seusite.com',
    apiKey: process.env.SCRAPER_API_KEY || null,
    timeouts: {
        agent: 10000,
        axios: 8000
    },
    batch: {
        size: 5,
        delayMs: 300
    },
    retry: {
        maxAttempts: 3,
        baseDelayMs: 500
    },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    baseReferer: 'https://investidor10.com.br/',
    urls: {
        fii: (ticker) => `https://investidor10.com.br/fiis/${ticker}/`,
        acao: (ticker) => `https://investidor10.com.br/acoes/${ticker}/`,
        ipca: 'https://investidor10.com.br/indices/ipca/',
        statusInvest: (type, ticker) => `https://statusinvest.com.br/${type}/companytickerprovents?ticker=${ticker}&chartProventsType=2`,
        yahoo: (symbol, range, interval) => `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}&includePrePost=false`
    }
};

// ---------------------------------------------------------
// LOGGER ESTRUTURADO
// ---------------------------------------------------------
const logger = {
    _format: (level, message, meta = {}) => JSON.stringify({ level, message, timestamp: new Date().toISOString(), ...meta }),
    info:  (msg, meta) => console.log(logger._format('info', msg, meta)),
    warn:  (msg, meta) => console.warn(logger._format('warn', msg, meta)),
    error: (msg, meta) => console.error(logger._format('error', msg, meta)),
    debug: (msg, meta) => process.env.DEBUG && console.log(logger._format('debug', msg, meta))
};

// ---------------------------------------------------------
// AGENTE HTTPS & CLIENTE AXIOS
// ---------------------------------------------------------
const httpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 128,
    maxFreeSockets: 20,
    timeout: CONFIG.timeouts.agent
});

const client = axios.create({
    httpsAgent,
    headers: {
        'User-Agent': CONFIG.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': CONFIG.baseReferer
    },
    timeout: CONFIG.timeouts.axios
});

// ---------------------------------------------------------
// RATE LIMITER SIMPLES (em memória)
// ---------------------------------------------------------
const rateLimiter = (() => {
    const requests = new Map();
    const WINDOW_MS = 60 * 1000; // 1 minuto
    const MAX_REQUESTS = 60;

    return {
        check(key) {
            const now = Date.now();
            const entry = requests.get(key) || { count: 0, resetAt: now + WINDOW_MS };

            if (now > entry.resetAt) {
                entry.count = 0;
                entry.resetAt = now + WINDOW_MS;
            }

            if (entry.count >= MAX_REQUESTS) return false;

            entry.count++;
            requests.set(key, entry);
            return true;
        }
    };
})();

// ---------------------------------------------------------
// HELPERS
// ---------------------------------------------------------
const REGEX_CLEAN_NUMBER = /[^0-9,-]+/g;
const REGEX_NORMALIZE    = /[\u0300-\u036f]/g;

function parseValue(valueStr) {
    if (!valueStr) return 0;
    if (typeof valueStr === 'number') return isFinite(valueStr) ? valueStr : 0;
    const cleaned = valueStr.replace(REGEX_CLEAN_NUMBER, '').replace(',', '.');
    const parsed = parseFloat(cleaned);
    return isFinite(parsed) ? parsed : 0;
}

function normalize(str) {
    if (!str) return '';
    return str.normalize('NFD').replace(REGEX_NORMALIZE, '').toLowerCase().trim();
}

function chunkArray(array, size) {
    const results = [];
    for (let i = 0; i < array.length; i += size) {
        results.push(array.slice(i, i + size));
    }
    return results;
}

function parseExtendedValue(str) {
    if (!str) return 0;
    const val = parseValue(str);
    const lower = str.toLowerCase();
    if (lower.includes('bilh')) return val * 1_000_000_000;
    if (lower.includes('milh')) return val * 1_000_000;
    if (lower.includes('mil'))  return val * 1_000;
    return val;
}

function formatCurrency(value) {
    if (!isFinite(value) || isNaN(value)) return 'N/A';
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function cleanDoubledString(str) {
    if (!str) return '';
    const parts = str.split('R$');
    if (parts.length > 2) return 'R$' + parts[1].trim();
    return str;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------
// RETRY COM BACKOFF EXPONENCIAL
// ---------------------------------------------------------
async function withRetry(fn, context = 'unknown') {
    let lastError;
    for (let attempt = 1; attempt <= CONFIG.retry.maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            const delay = CONFIG.retry.baseDelayMs * Math.pow(2, attempt - 1);
            logger.warn(`[${context}] Tentativa ${attempt}/${CONFIG.retry.maxAttempts} falhou. Aguardando ${delay}ms...`, { error: err.message });
            if (attempt < CONFIG.retry.maxAttempts) await sleep(delay);
        }
    }
    throw lastError;
}

// ---------------------------------------------------------
// MAPA DE CAMPOS (substitui a God Function processPair)
// ---------------------------------------------------------
const FIELD_MATCHERS = [
    // [ campo, fn de teste no título normalizado, prioridade: 'indicator' | 'text' ]
    { key: 'dy',                   indicator: ['DY'],              text: (t) => t === 'dy' || t.includes('dividend yield') || t.includes('dy (') },
    { key: 'pvp',                  indicator: ['P_VP'],            text: (t) => t.includes('p/vp') },
    { key: 'pl',                   indicator: ['P_L'],             text: (t) => t === 'p/l' || t.includes('p/l') },
    { key: 'roe',                  indicator: ['ROE'],             text: (t) => t.replace(/\./g, '') === 'roe' },
    { key: 'lpa',                  indicator: [],                  text: (t) => t.replace(/\./g, '') === 'lpa' },
    { key: 'liquidez',             indicator: [],                  text: (t) => t.includes('liquidez') },
    { key: 'val_mercado',          indicator: [],                  text: (t) => t.includes('mercado') },
    { key: 'variacao_12m',         indicator: [],                  text: (t) => t.includes('variacao') && t.includes('12m') },
    { key: 'ultimo_rendimento',    indicator: [],                  text: (t) => t.includes('ultimo rendimento') },
    { key: 'segmento',             indicator: [],                  text: (t) => t.includes('segmento') },
    { key: 'vacancia',             indicator: [],                  text: (t) => t.includes('vacancia') },
    { key: 'cnpj',                 indicator: [],                  text: (t) => t.includes('cnpj') },
    { key: 'num_cotistas',         indicator: [],                  text: (t) => t.includes('cotistas') },
    { key: 'tipo_gestao',          indicator: [],                  text: (t) => t.includes('gestao') },
    { key: 'mandato',              indicator: [],                  text: (t) => t.includes('mandato') },
    { key: 'tipo_fundo',           indicator: [],                  text: (t) => t.includes('tipo de fundo') },
    { key: 'prazo_duracao',        indicator: [],                  text: (t) => t.includes('prazo') },
    { key: 'taxa_adm',             indicator: [],                  text: (t) => t.includes('taxa') && t.includes('administracao') },
    { key: 'cotas_emitidas',       indicator: [],                  text: (t) => t.includes('cotas') && (t.includes('emitidas') || t.includes('total')) },
    { key: 'publico_alvo',         indicator: [],                  text: (t) => t.includes('publico') && t.includes('alvo') },
    { key: 'margem_liquida',       indicator: ['MARGEM_LIQUIDA'],  text: (t) => t.includes('margem liquida') },
    { key: 'margem_bruta',         indicator: [],                  text: (t) => t.includes('margem bruta') },
    { key: 'margem_ebit',          indicator: [],                  text: (t) => t.includes('margem ebit') },
    { key: 'payout',               indicator: [],                  text: (t) => t.includes('payout') },
    { key: 'ev_ebitda',            indicator: [],                  text: (t) => t.includes('ev/ebitda') },
    { key: 'divida_liquida_ebitda',indicator: ['DIVIDA_LIQUIDA_EBITDA'], text: (t) => { const c = t.replace(/[\s\/\.\-]/g, ''); return c.includes('div') && c.includes('liq') && c.includes('ebitda'); } },
    { key: 'divida_liquida_pl',    indicator: [],                  text: (t) => { const c = t.replace(/[\s\/\.\-]/g, ''); return c.includes('div') && c.includes('liq') && c.includes('patrim'); } },
    { key: 'cagr_receita_5a',      indicator: [],                  text: (t) => t.includes('cagr') && t.includes('receita') },
    { key: 'cagr_lucros_5a',       indicator: [],                  text: (t) => t.includes('cagr') && t.includes('lucro') },
    { key: 'vp_cota',              indicator: [],                  text: (t) => t === 'vpa' || t.replace(/\./g, '') === 'vpa' || t.includes('vp por cota') },
];

function buildProcessPair(dados) {
    return function processPair(tituloRaw, valorRaw, origem = 'table', indicatorAttr = null) {
        const titulo = normalize(tituloRaw);
        let valor = (valorRaw || '').trim();

        if (titulo.includes('mercado')) {
            valor = cleanDoubledString(valor);
            if (dados.val_mercado !== 'N/A' && origem === 'table') return;
        }

        if (!valor) return;

        for (const matcher of FIELD_MATCHERS) {
            if (dados[matcher.key] !== 'N/A') continue; // já preenchido

            // Prioridade 1: data-indicator
            if (indicatorAttr && matcher.indicator.includes(indicatorAttr.toUpperCase())) {
                dados[matcher.key] = valor;
                return;
            }

            // Prioridade 2: texto
            if (matcher.text(titulo)) {
                dados[matcher.key] = valor;
                return;
            }
        }
    };
}

// ---------------------------------------------------------
// PARTE 1: FUNDAMENTOS -> INVESTIDOR10
// ---------------------------------------------------------
function buildDadosDefault() {
    return {
        dy: 'N/A', pvp: 'N/A', pl: 'N/A', roe: 'N/A', lpa: 'N/A', vp_cota: 'N/A',
        val_mercado: 'N/A', liquidez: 'N/A', variacao_12m: 'N/A', ultimo_rendimento: 'N/A',
        segmento: 'N/A', tipo_fundo: 'N/A', mandato: 'N/A', vacancia: 'N/A',
        patrimonio_liquido: 'N/A', cnpj: 'N/A', num_cotistas: 'N/A', tipo_gestao: 'N/A',
        prazo_duracao: 'N/A', taxa_adm: 'N/A', cotas_emitidas: 'N/A', publico_alvo: 'N/A',
        margem_liquida: 'N/A', margem_bruta: 'N/A', margem_ebit: 'N/A',
        divida_liquida_ebitda: 'N/A', divida_liquida_pl: 'N/A', ev_ebitda: 'N/A',
        payout: 'N/A', cagr_receita_5a: 'N/A', cagr_lucros_5a: 'N/A',
        imoveis: []
    };
}

// Lista de exceções para tickers que terminam em 11 mas NÃO são FIIs
const NAO_FII_EXCEPTIONS = new Set(['BOVA11', 'SMAL11', 'IVVB11', 'HASH11', 'DIVO11', 'FIND11', 'SPXI11']);

function isLikelyFii(ticker) {
    const t = ticker.toUpperCase();
    if (NAO_FII_EXCEPTIONS.has(t)) return false;
    return t.endsWith('11') || t.endsWith('11B');
}

async function scrapeFundamentos(ticker) {
    const t = ticker.toLowerCase();
    let html;
    let tipoAtivo = null;

    try {
        // Tenta FIIs primeiro se o ticker parecer um FII
        if (isLikelyFii(ticker)) {
            try {
                const res = await withRetry(() => client.get(CONFIG.urls.fii(t)), `FII ${ticker}`);
                html = res.data;
                tipoAtivo = 'fii';
            } catch {
                const res = await withRetry(() => client.get(CONFIG.urls.acao(t)), `ACAO ${ticker}`);
                html = res.data;
                tipoAtivo = 'acao';
            }
        } else {
            try {
                const res = await withRetry(() => client.get(CONFIG.urls.acao(t)), `ACAO ${ticker}`);
                html = res.data;
                tipoAtivo = 'acao';
            } catch {
                const res = await withRetry(() => client.get(CONFIG.urls.fii(t)), `FII ${ticker}`);
                html = res.data;
                tipoAtivo = 'fii';
            }
        }
    } catch (error) {
        logger.error('Falha ao buscar fundamentos', { ticker, error: error.message });
        return { error: 'Ativo não encontrado', ticker: ticker.toUpperCase() };
    }

    const $ = cheerio.load(html);
    const dados = buildDadosDefault();
    dados.tipo_ativo = tipoAtivo;

    const processPair = buildProcessPair(dados);

    let cotacao_atual = 0;
    let num_cotas = 0;

    // Cards
    $('._card').each((i, el) => {
        const titulo = $(el).find('._card-header').text().trim();
        const valor  = $(el).find('._card-body').text().trim();
        processPair(titulo, valor, 'card');
        if (normalize(titulo).includes('cotacao')) cotacao_atual = parseValue(valor);
    });

    if (cotacao_atual === 0) {
        const cEl = $('._card.cotacao ._card-body span').first();
        if (cEl.length) cotacao_atual = parseValue(cEl.text());
    }

    // Cells
    $('.cell').each((i, el) => {
        let titulo = $(el).find('.name').text().trim();
        if (!titulo) titulo = $(el).children('span').first().text().trim();
        const valorEl = $(el).find('.value span').first();
        const valor = valorEl.length > 0 ? valorEl.text().trim() : $(el).find('.value').text().trim();
        processPair(titulo, valor, 'cell');
    });

    // Tabelas
    $('table tbody tr').each((i, row) => {
        const cols = $(row).find('td');
        if (cols.length >= 2) {
            const indicatorAttr = $(cols[0]).find('[data-indicator]').attr('data-indicator');
            processPair($(cols[0]).text(), $(cols[1]).text(), 'table', indicatorAttr);
        }
        // Cotas emitidas (para cálculo de val_mercado)
        if (cols.length >= 2) {
            const labelNorm = normalize($(cols[0]).text());
            if (labelNorm.includes('cotas') && (labelNorm.includes('emitidas') || labelNorm.includes('total'))) {
                num_cotas = parseValue($(cols[1]).text());
            }
        }
    });

    // Cálculo de val_mercado como fallback
    if (dados.val_mercado === 'N/A' || dados.val_mercado === '-') {
        let mercadoCalc = 0;
        if (cotacao_atual > 0 && num_cotas > 0) {
            mercadoCalc = cotacao_atual * num_cotas;
        } else if (dados.patrimonio_liquido !== 'N/A' && dados.pvp !== 'N/A') {
            const pl  = parseExtendedValue(dados.patrimonio_liquido);
            const pvp = parseValue(dados.pvp);
            if (pl > 0 && pvp > 0) mercadoCalc = pl * pvp;
        }

        if (mercadoCalc > 0) {
            if (mercadoCalc > 1e9)      dados.val_mercado = `R$ ${(mercadoCalc / 1e9).toFixed(2)} Bilhões`;
            else if (mercadoCalc > 1e6) dados.val_mercado = `R$ ${(mercadoCalc / 1e6).toFixed(2)} Milhões`;
            else                         dados.val_mercado = formatCurrency(mercadoCalc);
        }
    }

    // Imóveis (FIIs)
    $('#properties-section .card-propertie').each((i, el) => {
        const nome  = $(el).find('h3').text().trim();
        let estado  = '';
        let abl     = '';
        $(el).find('small').each((j, small) => {
            const t = $(small).text().trim();
            if (t.includes('Estado:'))             estado = t.replace('Estado:', '').trim();
            if (t.includes('Área bruta locável:')) abl    = t.replace('Área bruta locável:', '').trim();
        });
        if (nome) dados.imoveis.push({ nome, estado, abl });
    });

    return dados;
}

// ---------------------------------------------------------
// PARTE 2: PROVENTOS -> STATUSINVEST
// ---------------------------------------------------------
async function scrapeAsset(ticker) {
    const t    = ticker.toUpperCase();
    const type = isLikelyFii(t) ? 'fii' : 'acao';

    try {
        const { data } = await withRetry(
            () => client.get(CONFIG.urls.statusInvest(type, t), {
                headers: {
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': 'https://statusinvest.com.br/',
                    'User-Agent': CONFIG.userAgent
                }
            }),
            `StatusInvest ${ticker}`
        );

        const earnings = data.assetEarningsModels || [];

        const parseDateJSON = (dStr) => {
            if (!dStr || dStr.trim() === '' || dStr.trim() === '-') return null;
            const parts = dStr.split('/');
            if (parts.length !== 3) return null;
            return `${parts[2]}-${parts[1]}-${parts[0]}`;
        };

        const labelTipoMap = { 1: 'DIV', 2: 'JCP' };

        const dividendos = earnings.map(d => {
            let labelTipo = labelTipoMap[d.et] || 'REND';
            if (d.etd) {
                const texto = d.etd.toUpperCase();
                if (texto.includes('JURO'))       labelTipo = 'JCP';
                else if (texto.includes('DIVID')) labelTipo = 'DIV';
                else if (texto.includes('TRIBUTADO')) labelTipo = 'REND_TRIB';
            }
            return {
                dataCom:     parseDateJSON(d.ed),
                paymentDate: parseDateJSON(d.pd),
                value:       d.v,
                type:        labelTipo,
                rawType:     d.et
            };
        });

        return dividendos
            .filter(d => d.paymentDate !== null)
            .sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));

    } catch (error) {
        logger.error('Erro StatusInvest', { ticker, error: error.message });
        return [];
    }
}

// ---------------------------------------------------------
// PARTE 3: IPCA -> INVESTIDOR10
// ---------------------------------------------------------
async function scrapeIpca() {
    try {
        const { data } = await withRetry(
            () => client.get(CONFIG.urls.ipca),
            'IPCA'
        );
        const $ = cheerio.load(data);

        const historico = [];
        let acumulado12m = '0,00';
        let acumuladoAno = '0,00';

        let $table = null;
        $('table').each((i, el) => {
            const headers = $(el).text().toLowerCase();
            if (headers.includes('acumulado 12 meses') || headers.includes('variação em %')) {
                $table = $(el);
                return false;
            }
        });

        if ($table) {
            $table.find('tbody tr').each((i, el) => {
                const cols = $(el).find('td');
                if (cols.length >= 2) {
                    const dataRef   = $(cols[0]).text().trim();
                    const valorStr  = $(cols[1]).text().trim();
                    const acAnoStr  = $(cols[2]).text().trim();
                    const ac12mStr  = $(cols[3]).text().trim();

                    if (i === 0) {
                        acumulado12m = ac12mStr.replace('.', ',');
                        acumuladoAno = acAnoStr.replace('.', ',');
                    }

                    if (dataRef && valorStr && i < 13) {
                        historico.push({
                            mes:            dataRef,
                            valor:          parseFloat(valorStr.replace('.', '').replace(',', '.')),
                            acumulado_12m:  ac12mStr.replace('.', ','),
                            acumulado_ano:  acAnoStr.replace('.', ',')
                        });
                    }
                }
            });
        }

        return {
            historico:      historico.reverse(),
            acumulado_12m:  acumulado12m,
            acumulado_ano:  acumuladoAno
        };

    } catch (error) {
        logger.error('Erro scraper IPCA', { error: error.message });
        return { historico: [], acumulado_12m: '0,00', acumulado_ano: '0,00' };
    }
}

// ---------------------------------------------------------
// PARTE 4: COTAÇÃO HISTÓRICA (YAHOO FINANCE)
// ---------------------------------------------------------
const YAHOO_RANGE_MAP = {
    '1D':   { range: '1d',  interval: '5m' },
    '5D':   { range: '5d',  interval: '15m' },
    '1M':   { range: '1mo', interval: '1d' },
    '6M':   { range: '6mo', interval: '1d' },
    'YTD':  { range: 'ytd', interval: '1d' },
    '1Y':   { range: '1y',  interval: '1d' },
    '1A':   { range: '1y',  interval: '1d' },
    '5Y':   { range: '5y',  interval: '1wk' },
    '5A':   { range: '5y',  interval: '1wk' },
    'Tudo': { range: 'max', interval: '1mo' },
    'MAX':  { range: 'max', interval: '1mo' }
};

function getYahooParams(range) {
    return YAHOO_RANGE_MAP[range] || { range: '1y', interval: '1d' };
}

async function fetchYahooFinance(ticker, rangeFilter = '1A') {
    try {
        const symbol = ticker.toUpperCase().endsWith('.SA')
            ? ticker.toUpperCase()
            : `${ticker.toUpperCase()}.SA`;

        const { range, interval } = getYahooParams(rangeFilter);
        const url = CONFIG.urls.yahoo(symbol, range, interval);

        const { data } = await withRetry(() => axios.get(url), `Yahoo ${ticker}`);
        const result = data?.chart?.result?.[0];

        if (!result?.timestamp || !result?.indicators?.quote?.[0]?.close) return null;

        const timestamps = result.timestamp;
        const prices     = result.indicators.quote[0].close;

        return timestamps
            .map((t, i) => {
                if (prices[i] == null) return null;
                return {
                    date:      new Date(t * 1000).toISOString(),
                    timestamp: t * 1000,
                    price:     prices[i]
                };
            })
            .filter(Boolean);

    } catch (e) {
        logger.error('Erro Yahoo Finance', { ticker, error: e.message });
        return null;
    }
}

async function scrapeCotacaoHistory(ticker, range = '1A') {
    const cleanTicker = ticker.toLowerCase().trim();
    const data = await fetchYahooFinance(cleanTicker, range);

    if (!data || data.length === 0) {
        return { error: 'Dados não encontrados', points: [] };
    }

    return {
        ticker: cleanTicker.toUpperCase(),
        range,
        points: data
    };
}

// ---------------------------------------------------------
// VALIDAÇÃO DE PAYLOAD
// ---------------------------------------------------------
const VALID_MODES = new Set(['ipca', 'fundamentos', 'proventos_carteira', 'historico_portfolio', 'historico_12m', 'proximo_provento', 'cotacao_historica']);

function validatePayload(mode, payload) {
    if (!VALID_MODES.has(mode)) {
        return { valid: false, message: `Modo inválido. Modos aceitos: ${[...VALID_MODES].join(', ')}` };
    }

    const tickerModes = ['fundamentos', 'historico_12m', 'proximo_provento', 'cotacao_historica'];
    if (tickerModes.includes(mode) && !payload?.ticker) {
        return { valid: false, message: `Campo 'ticker' obrigatório para o modo '${mode}'` };
    }

    const listModes = ['proventos_carteira', 'historico_portfolio'];
    if (listModes.includes(mode) && !payload?.fiiList) {
        return { valid: false, message: `Campo 'fiiList' obrigatório para o modo '${mode}'` };
    }

    return { valid: true };
}

// ---------------------------------------------------------
// HANDLER PRINCIPAL
// ---------------------------------------------------------
module.exports = async function handler(req, res) {
    // --- CORS ---
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', CONFIG.allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido. Use POST.' });
    }

    // --- CACHE (apenas POST) ---
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

    // --- AUTENTICAÇÃO (opcional via env) ---
    if (CONFIG.apiKey) {
        const provided = req.headers['x-api-key'];
        if (!provided || provided !== CONFIG.apiKey) {
            return res.status(401).json({ error: 'API key inválida ou ausente.' });
        }
    }

    // --- RATE LIMITING ---
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    if (!rateLimiter.check(clientIp)) {
        logger.warn('Rate limit atingido', { ip: clientIp });
        return res.status(429).json({ error: 'Muitas requisições. Tente novamente em 1 minuto.' });
    }

    // --- BODY ---
    if (!req.body?.mode) {
        return res.status(400).json({ error: "Payload inválido. Campo 'mode' é obrigatório." });
    }

    const { mode, payload = {} } = req.body;

    // --- VALIDAÇÃO ---
    const validation = validatePayload(mode, payload);
    if (!validation.valid) {
        return res.status(400).json({ error: validation.message });
    }

    logger.info('Requisição recebida', { mode, ip: clientIp });

    try {
        // MODO: IPCA
        if (mode === 'ipca') {
            const dados = await scrapeIpca();
            return res.status(200).json({ json: dados });
        }

        // MODO: FUNDAMENTOS
        if (mode === 'fundamentos') {
            const dados = await scrapeFundamentos(payload.ticker);
            if (dados.error) return res.status(404).json({ error: dados.error });
            return res.status(200).json({ json: dados });
        }

        // MODO: PROVENTOS (lote)
        if (mode === 'proventos_carteira' || mode === 'historico_portfolio') {
            const defaultLimit = mode === 'historico_portfolio' ? 14 : 12;
            const batches = chunkArray(payload.fiiList, CONFIG.batch.size);
            let finalResults = [];

            for (const batch of batches) {
                const promises = batch.map(async (item) => {
                    const ticker = typeof item === 'string' ? item : item.ticker;
                    const limit  = typeof item === 'string' ? defaultLimit : (item.limit || defaultLimit);
                    const history = await scrapeAsset(ticker);
                    const recents = history.filter(h => h.paymentDate && h.value > 0).slice(0, limit);
                    return recents.length > 0
                        ? recents.map(r => ({ symbol: ticker.toUpperCase(), ...r }))
                        : null;
                });

                const batchResults = await Promise.all(promises);
                finalResults = finalResults.concat(batchResults);

                if (batches.length > 1) await sleep(CONFIG.batch.delayMs);
            }

            return res.status(200).json({
                json: finalResults.filter(Boolean).flat()
            });
        }

        // MODO: HISTÓRICO 12M
        if (mode === 'historico_12m') {
            const history = await scrapeAsset(payload.ticker);
            return res.status(200).json({ json: history });
        }

        // MODO: PRÓXIMO PROVENTO
        if (mode === 'proximo_provento') {
            const history = await scrapeAsset(payload.ticker);

            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);

            let ultimoPago = null;
            let proximo    = null;

            for (const p of history) {
                if (!p.paymentDate) continue;
                const [ano, mes, dia] = p.paymentDate.split('-').map(Number);
                const dataPag = new Date(ano, mes - 1, dia);

                if (dataPag > hoje) {
                    if (!proximo) proximo = p;
                } else {
                    if (!ultimoPago) ultimoPago = p;
                }

                if (ultimoPago && proximo) break;
            }

            if (!ultimoPago && history.length > 0 && !proximo) {
                ultimoPago = history[0];
            }

            return res.status(200).json({ json: { ultimoPago, proximo } });
        }

        // MODO: COTAÇÃO HISTÓRICA
        if (mode === 'cotacao_historica') {
            const range = payload.range || '1D';
            const dados = await scrapeCotacaoHistory(payload.ticker, range);
            if (dados.error) return res.status(404).json({ error: dados.error });
            return res.status(200).json({ json: dados });
        }

    } catch (error) {
        logger.error('Erro interno no handler', { mode, error: error.message });
        return res.status(500).json({ error: 'Erro interno no servidor.' });
    }
};
