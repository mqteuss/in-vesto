const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// ---------------------------------------------------------
// CONFIGURAÇÃO CENTRALIZADA
// ---------------------------------------------------------
const CONFIG = {
    allowedOrigin:   process.env.ALLOWED_ORIGIN     || '*',
    maxCacheEntries: parseInt(process.env.MAX_CACHE_ENTRIES || '500', 10),
    cacheCleanupMs:  parseInt(process.env.CACHE_CLEANUP_MS  || String(10 * 60 * 1000), 10),
    ttl: {
        fundamentos:       3600 * 1000,
        proventos:         3600 * 1000,
        ipca:          6 * 3600 * 1000,
        cotacao_historica:  5 * 60 * 1000,
    },
    retry: {
        attempts:    3,
        baseDelayMs: 300,
        maxJitterMs: 150,
    },
    batchSize:    5,
    batchDelayMs: 200,
};

// ---------------------------------------------------------
// LOGGER ESTRUTURADO COM TIMING
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
// ERROS TIPADOS
// ---------------------------------------------------------
class AppError extends Error {
    constructor(message, statusCode = 500) {
        super(message);
        this.name = 'AppError';
        this.statusCode = statusCode;
    }
}
class ValidationError extends AppError {
    constructor(msg) { super(msg, 400); this.name = 'ValidationError'; }
}
class UpstreamError extends AppError {
    constructor(msg) { super(msg, 502); this.name = 'UpstreamError'; }
}

// ---------------------------------------------------------
// CACHE LRU COM TTL E LIMITE DE TAMANHO
// ---------------------------------------------------------
class LRUCache {
    #map = new Map();
    #maxSize;
    constructor(maxSize) { this.#maxSize = maxSize; }

    get(key) {
        const entry = this.#map.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) { this.#map.delete(key); return null; }
        // Move para o fim (mais recente usado)
        this.#map.delete(key);
        this.#map.set(key, entry);
        return entry.value;
    }

    // Retorna entrada mesmo expirada (para stale-while-revalidate)
    getStale(key) { return this.#map.get(key) ?? null; }

    set(key, value, ttlMs) {
        if (this.#map.has(key)) this.#map.delete(key);
        else if (this.#map.size >= this.#maxSize) {
            // Evicta o menos recentemente usado (primeiro do iterador)
            this.#map.delete(this.#map.keys().next().value);
        }
        this.#map.set(key, { value, expiresAt: Date.now() + ttlMs });
    }

    evictExpired() {
        const now = Date.now();
        for (const [k, e] of this.#map) if (now > e.expiresAt) this.#map.delete(k);
    }

    get size() { return this.#map.size; }
}

const cache = new LRUCache(CONFIG.maxCacheEntries);

// Limpeza periódica de entradas expiradas para não vazar memória
setInterval(() => {
    cache.evictExpired();
    log.info('Cache cleanup', { size: cache.size });
}, CONFIG.cacheCleanupMs).unref(); // .unref() para não impedir o processo de terminar

// ---------------------------------------------------------
// DEDUPLICAÇÃO DE REQUISIÇÕES EM VOO
// Múltiplas chamadas simultâneas para o mesmo recurso
// aguardam a mesma Promise em vez de disparar N requests.
// ---------------------------------------------------------
const inFlight = new Map();

async function dedupe(key, fn) {
    if (inFlight.has(key)) return inFlight.get(key);
    const promise = fn().finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
}

// ---------------------------------------------------------
// STALE-WHILE-REVALIDATE
// Retorna dado expirado imediatamente e atualiza em background.
// ---------------------------------------------------------
function staleWhileRevalidate(key, ttlMs, fetchFn) {
    const fresh = cache.get(key);
    if (fresh) return Promise.resolve(fresh);

    const stale = cache.getStale(key);
    if (stale) {
        dedupe(`swr:${key}`, async () => {
            try {
                const value = await fetchFn();
                cache.set(key, value, ttlMs);
            } catch (err) {
                log.warn('SWR revalidation failed', { key, error: err.message });
            }
        });
        return Promise.resolve(stale.value);
    }

    return dedupe(key, async () => {
        const value = await fetchFn();
        cache.set(key, value, ttlMs);
        return value;
    });
}

// ---------------------------------------------------------
// CLIENTE AXIOS
// ---------------------------------------------------------
const httpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 128,
    maxFreeSockets: 20,
    timeout: 10000,
});

const client = axios.create({
    httpsAgent,
    headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer':         'https://investidor10.com.br/',
    },
    timeout: 8000,
});

// ---------------------------------------------------------
// RETRY COM BACKOFF EXPONENCIAL + JITTER
// ---------------------------------------------------------
async function withRetry(fn, opts = {}) {
    const { attempts, baseDelayMs, maxJitterMs } = { ...CONFIG.retry, ...opts };
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            const isLast        = attempt === attempts;
            const isClientError = err.response && err.response.status < 500 && err.response.status !== 429;
            if (isLast || isClientError) break;

            const jitter = Math.random() * maxJitterMs;
            const delay  = baseDelayMs * Math.pow(2, attempt - 1) + jitter;
            log.warn('Retrying', { attempt, delayMs: Math.round(delay), error: err.message });
            await new Promise(r => setTimeout(r, delay));
        }
    }
    throw lastError;
}

// ---------------------------------------------------------
// VALIDAÇÃO DE INPUT
// ---------------------------------------------------------
const VALID_TICKER = /^[A-Z0-9]{1,12}$/i;

const ALLOWED_MODES = new Set([
    'ipca', 'fundamentos', 'proventos_carteira', 'historico_portfolio',
    'historico_12m', 'proximo_provento', 'cotacao_historica',
]);

const ALLOWED_RANGES = new Set([
    '1D', '5D', '1M', '6M', 'YTD', '1Y', '1A', '5Y', '5A', 'Tudo', 'MAX',
]);

function validateTicker(ticker) {
    if (!ticker || typeof ticker !== 'string') throw new ValidationError('Ticker ausente ou inválido.');
    const clean = ticker.trim().toUpperCase();
    if (!VALID_TICKER.test(clean)) throw new ValidationError(`Ticker inválido: "${ticker}". Use apenas letras e números (máx. 12 caracteres).`);
    return clean;
}

// ---------------------------------------------------------
// DETECÇÃO DE TIPO DE ATIVO
// ---------------------------------------------------------
function detectAssetType(ticker) {
    const t = ticker.toUpperCase();
    if (/[A-Z]{4}\d{2}11B?$/.test(t)) return 'fii';
    if (/[A-Z]{4}\d{2}3[2-5]$/.test(t)) return 'bdr';
    return 'acao';
}

// ---------------------------------------------------------
// HELPERS
// ---------------------------------------------------------
const REGEX_CLEAN_NUMBER = /[^0-9,-]+/g;
const REGEX_DIACRITICS   = /[\u0300-\u036f]/g;

function parseValue(str) {
    if (!str) return 0;
    if (typeof str === 'number') return str;
    return parseFloat(str.replace(REGEX_CLEAN_NUMBER, '').replace(',', '.')) || 0;
}

function normalize(str) {
    if (!str) return '';
    return str.normalize('NFD').replace(REGEX_DIACRITICS, '').toLowerCase().trim();
}

function chunkArray(arr, size) {
    const result = [];
    for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
    return result;
}

function parseExtendedValue(str) {
    if (!str) return 0;
    const val = parseValue(str);
    const l   = str.toLowerCase();
    if (l.includes('bilh')) return val * 1_000_000_000;
    if (l.includes('milh')) return val * 1_000_000;
    if (l.includes('mil'))  return val * 1_000;
    return val;
}

function formatCurrency(value) {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function cleanDoubledString(str) {
    if (!str) return '';
    const parts = str.split('R$');
    return parts.length > 2 ? 'R$' + parts[1].trim() : str;
}

// Objeto base imutável reutilizado no fallback de erros
const EMPTY_DADOS = Object.freeze({
    dy: 'N/A', pvp: 'N/A', pl: 'N/A', roe: 'N/A', lpa: 'N/A', vp_cota: 'N/A',
    val_mercado: 'N/A', liquidez: 'N/A', variacao_12m: 'N/A', ultimo_rendimento: 'N/A',
    segmento: 'N/A', tipo_fundo: 'N/A', mandato: 'N/A', vacancia: 'N/A',
    patrimonio_liquido: 'N/A', cnpj: 'N/A', num_cotistas: 'N/A', tipo_gestao: 'N/A',
    prazo_duracao: 'N/A', taxa_adm: 'N/A', cotas_emitidas: 'N/A', publico_alvo: 'N/A',
    margem_liquida: 'N/A', margem_bruta: 'N/A', margem_ebit: 'N/A',
    divida_liquida_ebitda: 'N/A', divida_liquida_pl: 'N/A', ev_ebitda: 'N/A',
    payout: 'N/A', cagr_receita_5a: 'N/A', cagr_lucros_5a: 'N/A',
});

// ---------------------------------------------------------
// PARTE 1: FUNDAMENTOS -> INVESTIDOR10
// ---------------------------------------------------------

// Busca FII e Ação em paralelo — usa o que responder primeiro com sucesso.
// Elimina a latência do fallback sequencial para ações.
async function fetchFundamentosHtml(ticker) {
    const t = ticker.toLowerCase();
    const tryFetch = (url) => withRetry(() => client.get(url)).then(r => r.data);

    const [fii, acao] = await Promise.allSettled([
        tryFetch(`https://investidor10.com.br/fiis/${t}/`),
        tryFetch(`https://investidor10.com.br/acoes/${t}/`),
    ]);

    if (fii.status  === 'fulfilled') return fii.value;
    if (acao.status === 'fulfilled') return acao.value;

    throw new UpstreamError(`Não foi possível obter dados para o ticker "${ticker}".`);
}

// Extração pura do HTML — isolada para facilitar testes unitários
function extractDados(html) {
    const $ = cheerio.load(html);
    const dados = { ...EMPTY_DADOS, imoveis: [] };
    let cotacao_atual = 0;
    let num_cotas = 0;

    const processPair = (tituloRaw, valorRaw, origem = 'table', indicatorAttr = null) => {
        const titulo = normalize(tituloRaw);
        let valor = valorRaw.trim();

        if (titulo.includes('mercado')) {
            valor = cleanDoubledString(valor);
            if (dados.val_mercado !== 'N/A' && origem === 'table') return;
        }
        if (!valor) return;

        if (indicatorAttr) {
            const ind = indicatorAttr.toUpperCase();
            if (ind === 'DIVIDA_LIQUIDA_EBITDA') { dados.divida_liquida_ebitda = valor; return; }
            if (ind === 'DY')             { dados.dy = valor; return; }
            if (ind === 'P_L')            { dados.pl = valor; return; }
            if (ind === 'P_VP')           { dados.pvp = valor; return; }
            if (ind === 'ROE')            { dados.roe = valor; return; }
            if (ind === 'MARGEM_LIQUIDA') { dados.margem_liquida = valor; return; }
        }

        if (dados.dy === 'N/A' && (titulo === 'dy' || titulo.includes('dividend yield') || titulo.includes('dy ('))) dados.dy = valor;
        if (dados.pvp === 'N/A' && titulo.includes('p/vp')) dados.pvp = valor;
        if (dados.liquidez === 'N/A' && titulo.includes('liquidez')) dados.liquidez = valor;
        if (dados.val_mercado === 'N/A' && titulo.includes('mercado')) dados.val_mercado = valor;
        if (dados.variacao_12m === 'N/A' && titulo.includes('variacao') && titulo.includes('12m')) dados.variacao_12m = valor;
        if (dados.ultimo_rendimento === 'N/A' && titulo.includes('ultimo rendimento')) dados.ultimo_rendimento = valor;

        if (dados.segmento === 'N/A' && titulo.includes('segmento')) dados.segmento = valor;
        if (dados.vacancia === 'N/A' && titulo.includes('vacancia')) dados.vacancia = valor;
        if (dados.cnpj === 'N/A' && titulo.includes('cnpj')) dados.cnpj = valor;
        if (dados.num_cotistas === 'N/A' && titulo.includes('cotistas')) dados.num_cotistas = valor;
        if (dados.tipo_gestao === 'N/A' && titulo.includes('gestao')) dados.tipo_gestao = valor;
        if (dados.mandato === 'N/A' && titulo.includes('mandato')) dados.mandato = valor;
        if (dados.tipo_fundo === 'N/A' && titulo.includes('tipo de fundo')) dados.tipo_fundo = valor;
        if (dados.prazo_duracao === 'N/A' && titulo.includes('prazo')) dados.prazo_duracao = valor;
        if (dados.taxa_adm === 'N/A' && titulo.includes('taxa') && titulo.includes('administracao')) dados.taxa_adm = valor;
        if (dados.cotas_emitidas === 'N/A' && titulo.includes('cotas')) dados.cotas_emitidas = valor;
        if (dados.publico_alvo === 'N/A' && titulo.includes('publico') && titulo.includes('alvo')) dados.publico_alvo = valor;

        if (dados.pl === 'N/A' && titulo.includes('p/l')) dados.pl = valor;
        if (dados.roe === 'N/A' && titulo.replace(/\./g, '') === 'roe') dados.roe = valor;
        if (dados.lpa === 'N/A' && titulo.replace(/\./g, '') === 'lpa') dados.lpa = valor;

        if (titulo.includes('margem liquida')) dados.margem_liquida = valor;
        if (titulo.includes('margem bruta'))   dados.margem_bruta = valor;
        if (titulo.includes('margem ebit'))    dados.margem_ebit = valor;
        if (titulo.includes('payout'))         dados.payout = valor;
        if (titulo.includes('ev/ebitda'))      dados.ev_ebitda = valor;

        const tClean = titulo.replace(/[\s/.\-]/g, '');
        if (dados.divida_liquida_ebitda === 'N/A' && tClean.includes('div') && tClean.includes('liq') && tClean.includes('ebitda')) dados.divida_liquida_ebitda = valor;
        if (tClean.includes('div') && tClean.includes('liq') && tClean.includes('patrim')) dados.divida_liquida_pl = valor;

        if (titulo.includes('cagr') && titulo.includes('receita')) dados.cagr_receita_5a = valor;
        if (titulo.includes('cagr') && titulo.includes('lucro'))   dados.cagr_lucros_5a = valor;

        if (dados.vp_cota === 'N/A' && (titulo === 'vpa' || titulo.replace(/\./g, '') === 'vpa' || titulo.includes('vp por cota'))) dados.vp_cota = valor;

        if (titulo.includes('patrimonial') || titulo.includes('patrimonio')) {
            const num   = parseValue(valor);
            const lower = valor.toLowerCase();
            if (lower.includes('milh') || lower.includes('bilh') || num > 10000) {
                if (dados.patrimonio_liquido === 'N/A') dados.patrimonio_liquido = valor;
            } else {
                if (dados.vp_cota === 'N/A') dados.vp_cota = valor;
            }
        }

        if (titulo.includes('cotas') && (titulo.includes('emitidas') || titulo.includes('total'))) {
            num_cotas = parseValue(valor);
            if (dados.cotas_emitidas === 'N/A') dados.cotas_emitidas = valor;
        }
    };

    $('._card').each((_, el) => {
        const titulo = $(el).find('._card-header').text().trim();
        const valor  = $(el).find('._card-body').text().trim();
        processPair(titulo, valor, 'card');
        if (normalize(titulo).includes('cotacao')) cotacao_atual = parseValue(valor);
    });

    if (cotacao_atual === 0) {
        const cEl = $('._card.cotacao ._card-body span').first();
        if (cEl.length) cotacao_atual = parseValue(cEl.text());
    }

    $('.cell').each((_, el) => {
        let titulo   = $(el).find('.name').text().trim();
        if (!titulo) titulo = $(el).children('span').first().text().trim();
        const valorEl = $(el).find('.value span').first();
        const valor   = valorEl.length ? valorEl.text().trim() : $(el).find('.value').text().trim();
        processPair(titulo, valor, 'cell');
    });

    $('table tbody tr').each((_, row) => {
        const cols = $(row).find('td');
        if (cols.length >= 2) {
            const ind = $(cols[0]).find('[data-indicator]').attr('data-indicator');
            processPair($(cols[0]).text(), $(cols[1]).text(), 'table', ind);
        }
    });

    // Fallback: cálculo do valor de mercado
    if (dados.val_mercado === 'N/A' || dados.val_mercado === '-') {
        let calc = 0;
        if (cotacao_atual > 0 && num_cotas > 0) {
            calc = cotacao_atual * num_cotas;
        } else if (dados.patrimonio_liquido !== 'N/A' && dados.pvp !== 'N/A') {
            const pl  = parseExtendedValue(dados.patrimonio_liquido);
            const pvp = parseValue(dados.pvp);
            if (pl > 0 && pvp > 0) calc = pl * pvp;
        }
        if (calc > 0) {
            if (calc > 1e9)      dados.val_mercado = `R$ ${(calc / 1e9).toFixed(2)} Bilhões`;
            else if (calc > 1e6) dados.val_mercado = `R$ ${(calc / 1e6).toFixed(2)} Milhões`;
            else                 dados.val_mercado = formatCurrency(calc);
        }
    }

    $('#properties-section .card-propertie').each((_, el) => {
        const nome = $(el).find('h3').text().trim();
        if (!nome) return;
        let estado = '', abl = '';
        $(el).find('small').each((_, small) => {
            const t = $(small).text().trim();
            if (t.includes('Estado:'))             estado = t.replace('Estado:', '').trim();
            if (t.includes('Área bruta locável:')) abl    = t.replace('Área bruta locável:', '').trim();
        });
        dados.imoveis.push({ nome, estado, abl });
    });

    return dados;
}

async function scrapeFundamentos(rawTicker) {
    const ticker  = validateTicker(rawTicker);
    const elapsed = log.timer();

    return staleWhileRevalidate(`fundamentos:${ticker}`, CONFIG.ttl.fundamentos, async () => {
        const html   = await fetchFundamentosHtml(ticker);
        const result = extractDados(html);
        log.info('scrapeFundamentos ok', { ticker, ms: elapsed() });
        return result;
    }).catch(err => {
        log.error('scrapeFundamentos failed', { ticker, error: err.message, ms: elapsed() });
        return { ...EMPTY_DADOS, imoveis: [] };
    });
}

// ---------------------------------------------------------
// PARTE 2: PROVENTOS -> STATUSINVEST
// ---------------------------------------------------------
function parseDateBR(dStr) {
    if (!dStr || !dStr.trim() || dStr.trim() === '-') return null;
    const parts = dStr.split('/');
    if (parts.length !== 3) return null;
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function mapEarningType(d) {
    if (d.etd) {
        const t = d.etd.toUpperCase();
        if (t.includes('JURO'))      return 'JCP';
        if (t.includes('DIVID'))     return 'DIV';
        if (t.includes('TRIBUTADO')) return 'REND_TRIB';
    }
    if (d.et === 1) return 'DIV';
    if (d.et === 2) return 'JCP';
    return 'REND';
}

async function scrapeAsset(rawTicker) {
    const ticker = validateTicker(rawTicker);

    return staleWhileRevalidate(`proventos:${ticker}`, CONFIG.ttl.proventos, async () => {
        const type = detectAssetType(ticker) === 'fii' ? 'fii' : 'acao';
        const url  = `https://statusinvest.com.br/${type}/companytickerprovents?ticker=${ticker}&chartProventsType=2`;

        const { data } = await withRetry(() =>
            client.get(url, { headers: { 'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://statusinvest.com.br/' } })
        );

        return (data.assetEarningsModels || [])
            .map(d => ({
                dataCom:     parseDateBR(d.ed),
                paymentDate: parseDateBR(d.pd),
                value:       d.v,
                type:        mapEarningType(d),
                rawType:     d.et,
            }))
            .filter(d => d.paymentDate !== null)
            .sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));

    }).catch(err => {
        log.error('scrapeAsset failed', { ticker, error: err.message });
        return [];
    });
}

// ---------------------------------------------------------
// PARTE 3: IPCA -> INVESTIDOR10
// ---------------------------------------------------------
async function scrapeIpca() {
    return staleWhileRevalidate('ipca', CONFIG.ttl.ipca, async () => {
        const { data } = await withRetry(() => client.get('https://investidor10.com.br/indices/ipca/'));
        const $ = cheerio.load(data);

        const historico = [];
        let acumulado12m = '0,00';
        let acumuladoAno = '0,00';

        let $table = null;
        $('table').each((_, el) => {
            const headers = $(el).text().toLowerCase();
            if (headers.includes('acumulado 12 meses') || headers.includes('variação em %')) {
                $table = $(el);
                return false;
            }
        });

        if ($table) {
            $table.find('tbody tr').each((i, el) => {
                const cols = $(el).find('td');
                if (cols.length < 2) return;

                const dataRef  = $(cols[0]).text().trim();
                const valorStr = $(cols[1]).text().trim();
                const acAnoStr = $(cols[2]).text().trim();
                const ac12mStr = $(cols[3]).text().trim();

                if (i === 0) {
                    acumulado12m = ac12mStr.replace('.', ',');
                    acumuladoAno = acAnoStr.replace('.', ',');
                }

                if (dataRef && valorStr && i < 13) {
                    historico.push({
                        mes:           dataRef,
                        valor:         parseFloat(valorStr.replace('.', '').replace(',', '.')),
                        acumulado_12m: ac12mStr.replace('.', ','),
                        acumulado_ano: acAnoStr.replace('.', ','),
                    });
                }
            });
        }

        return { historico: historico.reverse(), acumulado_12m: acumulado12m, acumulado_ano: acumuladoAno };

    }).catch(err => {
        log.error('scrapeIpca failed', { error: err.message });
        return { historico: [], acumulado_12m: '0,00', acumulado_ano: '0,00' };
    });
}

// ---------------------------------------------------------
// PARTE 4: COTAÇÃO HISTÓRICA (YAHOO FINANCE)
// ---------------------------------------------------------
const YAHOO_PARAMS = {
    '1D':   { range: '1d',  interval: '5m'  },
    '5D':   { range: '5d',  interval: '15m' },
    '1M':   { range: '1mo', interval: '1d'  },
    '6M':   { range: '6mo', interval: '1d'  },
    'YTD':  { range: 'ytd', interval: '1d'  },
    '1Y':   { range: '1y',  interval: '1d'  },
    '1A':   { range: '1y',  interval: '1d'  },
    '5Y':   { range: '5y',  interval: '1wk' },
    '5A':   { range: '5y',  interval: '1wk' },
    'Tudo': { range: 'max', interval: '1mo' },
    'MAX':  { range: 'max', interval: '1mo' },
};

// Usa query1 e query2 em paralelo — vence o mais rápido
const YAHOO_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

async function fetchYahooFinance(ticker, rangeFilter = '1A') {
    const symbol = ticker.toUpperCase().endsWith('.SA') ? ticker.toUpperCase() : `${ticker.toUpperCase()}.SA`;
    const { range, interval } = YAHOO_PARAMS[rangeFilter] ?? YAHOO_PARAMS['1A'];

    const fetches = YAHOO_HOSTS.map(host => {
        const url = `https://${host}/v8/finance/chart/${symbol}?range=${range}&interval=${interval}&includePrePost=false`;
        return withRetry(() => client.get(url));
    });

    let response;
    try {
        response = await Promise.any(fetches);
    } catch {
        throw new UpstreamError(`Yahoo Finance indisponível para ${ticker}.`);
    }

    const result = response.data?.chart?.result?.[0];
    if (!result?.timestamp || !result?.indicators?.quote?.[0]?.close) return null;

    const { timestamp: ts, indicators: { quote: [{ close }] } } = result;

    return ts
        .map((t, i) => close[i] == null ? null : {
            date:      new Date(t * 1000).toISOString(),
            timestamp: t * 1000,
            price:     close[i],
        })
        .filter(Boolean);
}

async function scrapeCotacaoHistory(rawTicker, range = '1A') {
    const ticker = validateTicker(rawTicker);
    if (!ALLOWED_RANGES.has(range)) {
        throw new ValidationError(`Range inválido: "${range}". Valores aceitos: ${[...ALLOWED_RANGES].join(', ')}.`);
    }

    return staleWhileRevalidate(`cotacao:${ticker}:${range}`, CONFIG.ttl.cotacao_historica, async () => {
        const points = await fetchYahooFinance(ticker, range);
        if (!points?.length) return { ticker, range, points: [], error: 'Dados não encontrados.' };
        return { ticker, range, points };
    });
}

// ---------------------------------------------------------
// HANDLER (API MAIN) — PADRÃO DISPATCH
// Cada modo é um handler isolado, eliminando a cadeia de if/else.
// ---------------------------------------------------------
const MODE_HANDLERS = {
    ipca: async () => scrapeIpca(),

    fundamentos: async (payload) => {
        if (!payload?.ticker) throw new ValidationError('Ticker ausente.');
        return scrapeFundamentos(payload.ticker);
    },

    proventos_carteira: (payload) => handleProventosLote(payload, 12),

    historico_portfolio: (payload) => handleProventosLote(payload, 14),

    historico_12m: async (payload) => {
        if (!payload?.ticker) throw new ValidationError('Ticker ausente.');
        return scrapeAsset(payload.ticker);
    },

    proximo_provento: async (payload) => {
        if (!payload?.ticker) throw new ValidationError('Ticker ausente.');

        const history = await scrapeAsset(payload.ticker);
        const hoje    = new Date();
        hoje.setHours(0, 0, 0, 0);

        let ultimoPago = null;
        let proximo    = null;

        for (const p of history) {
            if (!p.paymentDate) continue;
            const [ano, mes, dia] = p.paymentDate.split('-').map(Number);
            const dataPag = new Date(ano, mes - 1, dia);

            if (dataPag > hoje) { if (!proximo)    proximo    = p; }
            else                { if (!ultimoPago) ultimoPago = p; }

            if (ultimoPago && proximo) break;
        }

        if (!ultimoPago && history.length > 0) ultimoPago = history[0];

        return { ultimoPago, proximo };
    },

    cotacao_historica: async (payload) => {
        if (!payload?.ticker) throw new ValidationError('Ticker ausente.');
        return scrapeCotacaoHistory(payload.ticker, payload.range || '1D');
    },
};

// Deduplica tickers antes de buscar em lote
async function handleProventosLote(payload, defaultLimit) {
    if (!Array.isArray(payload?.fiiList) || payload.fiiList.length === 0) {
        throw new ValidationError('fiiList ausente ou vazio.');
    }

    // Deduplica: mesmo ticker com mesmo limit não é buscado duas vezes
    const seen  = new Map();
    const items = [];
    for (const item of payload.fiiList) {
        const ticker = typeof item === 'string' ? item : item.ticker;
        const limit  = typeof item === 'string' ? defaultLimit : (item.limit ?? defaultLimit);
        const key    = `${ticker.toUpperCase()}:${limit}`;
        if (!seen.has(key)) { seen.set(key, true); items.push({ ticker, limit }); }
    }

    const batches = chunkArray(items, CONFIG.batchSize);
    const results = [];

    for (const batch of batches) {
        const batchData = await Promise.all(
            batch.map(async ({ ticker, limit }) => {
                const history = await scrapeAsset(ticker);
                const recents = history.filter(h => h.paymentDate && h.value > 0).slice(0, limit);
                return recents.length ? recents.map(r => ({ symbol: ticker.toUpperCase(), ...r })) : null;
            })
        );
        results.push(...batchData);
        if (batches.length > 1) await new Promise(r => setTimeout(r, CONFIG.batchDelayMs));
    }

    return results.filter(Boolean).flat();
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', CONFIG.allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST')    return res.status(405).json({ error: 'Método não permitido. Use POST.' });

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

    const { mode, payload } = req.body ?? {};
    const elapsed = log.timer();

    try {
        if (!mode)                    throw new ValidationError('Campo "mode" ausente.');
        if (!ALLOWED_MODES.has(mode)) throw new ValidationError(`Modo desconhecido: "${mode}".`);

        const data = await MODE_HANDLERS[mode](payload);

        log.info('Request ok', { mode, ms: elapsed() });
        return res.status(200).json({ json: data });

    } catch (err) {
        const statusCode = err instanceof AppError ? err.statusCode : 500;
        log.error('Request failed', { mode, error: err.message, statusCode, ms: elapsed() });
        return res.status(statusCode).json({ error: err.message });
    }
};
