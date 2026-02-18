const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// ---------------------------------------------------------
// CONFIGURAÇÃO: AGENTE HTTPS & CLIENTE AXIOS
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://investidor10.com.br/',
    },
    timeout: 8000,
});

// ---------------------------------------------------------
// LOGGER ESTRUTURADO
// ---------------------------------------------------------
const log = {
    info: (msg, meta = {}) => console.log(JSON.stringify({ level: 'info', msg, ...meta, ts: new Date().toISOString() })),
    warn: (msg, meta = {}) => console.warn(JSON.stringify({ level: 'warn', msg, ...meta, ts: new Date().toISOString() })),
    error: (msg, meta = {}) => console.error(JSON.stringify({ level: 'error', msg, ...meta, ts: new Date().toISOString() })),
};

// ---------------------------------------------------------
// CACHE EM MEMÓRIA COM TTL
// ---------------------------------------------------------
const cache = new Map();

const TTL = {
    fundamentos: 3600 * 1000,       // 1 hora
    proventos: 3600 * 1000,         // 1 hora
    ipca: 6 * 3600 * 1000,          // 6 horas
    cotacao_historica: 5 * 60 * 1000, // 5 minutos
};

function cacheGet(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        cache.delete(key);
        return null;
    }
    return entry.value;
}

function cacheSet(key, value, ttlMs) {
    cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// ---------------------------------------------------------
// RETRY COM BACKOFF EXPONENCIAL
// ---------------------------------------------------------
async function withRetry(fn, { retries = 3, baseDelayMs = 300 } = {}) {
    let lastError;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            const isLastAttempt = attempt === retries;
            const isClientError = err.response && err.response.status < 500 && err.response.status !== 429;
            if (isLastAttempt || isClientError) break;
            const delay = baseDelayMs * Math.pow(2, attempt - 1);
            log.warn('Retrying request', { attempt, delay, error: err.message });
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
const ALLOWED_RANGES = new Set(['1D', '5D', '1M', '6M', 'YTD', '1Y', '1A', '5Y', '5A', 'Tudo', 'MAX']);

function validateTicker(ticker) {
    if (!ticker || typeof ticker !== 'string') throw new Error('Ticker ausente ou inválido.');
    const clean = ticker.trim().toUpperCase();
    if (!VALID_TICKER.test(clean)) throw new Error(`Ticker inválido: "${ticker}". Use apenas letras e números (máx. 12 caracteres).`);
    return clean;
}

// ---------------------------------------------------------
// DETECÇÃO DE TIPO DE ATIVO
// ---------------------------------------------------------
function detectAssetType(ticker) {
    const t = ticker.toUpperCase();
    // FIIs terminam em 11 ou 11B
    if (/\d{2}11B?$/.test(t)) return 'fii';
    // BDRs terminam em 34, 32, 33, 35
    if (/\d{2}3[2-5]$/.test(t)) return 'bdr';
    // ETFs geralmente terminam em 11 também, mas por hora tratamos como FII
    return 'acao';
}

// ---------------------------------------------------------
// HELPERS (FUNÇÕES AUXILIARES)
// ---------------------------------------------------------
const REGEX_CLEAN_NUMBER = /[^0-9,-]+/g;
const REGEX_NORMALIZE = /[\u0300-\u036f]/g;

function parseValue(valueStr) {
    if (!valueStr) return 0;
    if (typeof valueStr === 'number') return valueStr;
    try {
        return parseFloat(valueStr.replace(REGEX_CLEAN_NUMBER, '').replace(',', '.')) || 0;
    } catch {
        return 0;
    }
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
    if (lower.includes('mil')) return val * 1_000;
    return val;
}

function formatCurrency(value) {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function cleanDoubledString(str) {
    if (!str) return '';
    const parts = str.split('R$');
    if (parts.length > 2) return 'R$' + parts[1].trim();
    return str;
}

// ---------------------------------------------------------
// PARTE 1: FUNDAMENTOS -> INVESTIDOR10
// ---------------------------------------------------------
async function scrapeFundamentos(rawTicker) {
    const ticker = validateTicker(rawTicker);
    const cacheKey = `fundamentos:${ticker}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    try {
        let html;

        // Tenta FII primeiro; se der 404, tenta ações
        try {
            const res = await withRetry(() => client.get(`https://investidor10.com.br/fiis/${ticker.toLowerCase()}/`));
            html = res.data;
        } catch (e) {
            if (e.response?.status === 404 || e.response?.status === 403) {
                const res = await withRetry(() => client.get(`https://investidor10.com.br/acoes/${ticker.toLowerCase()}/`));
                html = res.data;
            } else {
                throw e;
            }
        }

        const $ = cheerio.load(html);

        const dados = {
            // Campos comuns
            dy: 'N/A', pvp: 'N/A', pl: 'N/A', roe: 'N/A', lpa: 'N/A', vp_cota: 'N/A',
            val_mercado: 'N/A', liquidez: 'N/A', variacao_12m: 'N/A', ultimo_rendimento: 'N/A',

            // FIIs
            segmento: 'N/A', tipo_fundo: 'N/A', mandato: 'N/A', vacancia: 'N/A',
            patrimonio_liquido: 'N/A', cnpj: 'N/A',
            num_cotistas: 'N/A', tipo_gestao: 'N/A', prazo_duracao: 'N/A',
            taxa_adm: 'N/A', cotas_emitidas: 'N/A', publico_alvo: 'N/A',

            // Ações
            margem_liquida: 'N/A', margem_bruta: 'N/A', margem_ebit: 'N/A',
            divida_liquida_ebitda: 'N/A', divida_liquida_pl: 'N/A', ev_ebitda: 'N/A',
            payout: 'N/A', cagr_receita_5a: 'N/A', cagr_lucros_5a: 'N/A',

            // Imóveis (FIIs)
            imoveis: [],
        };

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

            // Data-indicator (prioridade)
            if (indicatorAttr) {
                const ind = indicatorAttr.toUpperCase();
                if (ind === 'DIVIDA_LIQUIDA_EBITDA') { dados.divida_liquida_ebitda = valor; return; }
                if (ind === 'DY') { dados.dy = valor; return; }
                if (ind === 'P_L') { dados.pl = valor; return; }
                if (ind === 'P_VP') { dados.pvp = valor; return; }
                if (ind === 'ROE') { dados.roe = valor; return; }
                if (ind === 'MARGEM_LIQUIDA') { dados.margem_liquida = valor; return; }
            }

            // Fallback por texto
            if (dados.dy === 'N/A' && (titulo === 'dy' || titulo.includes('dividend yield') || titulo.includes('dy ('))) dados.dy = valor;
            if (dados.pvp === 'N/A' && titulo.includes('p/vp')) dados.pvp = valor;
            if (dados.liquidez === 'N/A' && titulo.includes('liquidez')) dados.liquidez = valor;
            if (dados.val_mercado === 'N/A' && titulo.includes('mercado')) dados.val_mercado = valor;
            if (dados.variacao_12m === 'N/A' && titulo.includes('variacao') && titulo.includes('12m')) dados.variacao_12m = valor;
            if (dados.ultimo_rendimento === 'N/A' && titulo.includes('ultimo rendimento')) dados.ultimo_rendimento = valor;

            // FIIs
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

            // Ações
            if (dados.pl === 'N/A' && titulo.includes('p/l')) dados.pl = valor;
            if (dados.roe === 'N/A' && titulo.replace(/\./g, '') === 'roe') dados.roe = valor;
            if (dados.lpa === 'N/A' && titulo.replace(/\./g, '') === 'lpa') dados.lpa = valor;

            // Margens & Payout
            if (titulo.includes('margem liquida')) dados.margem_liquida = valor;
            if (titulo.includes('margem bruta')) dados.margem_bruta = valor;
            if (titulo.includes('margem ebit')) dados.margem_ebit = valor;
            if (titulo.includes('payout')) dados.payout = valor;

            // EV e Dívidas
            if (titulo.includes('ev/ebitda')) dados.ev_ebitda = valor;
            const tClean = titulo.replace(/[\s/.\-]/g, '');
            if (dados.divida_liquida_ebitda === 'N/A' && tClean.includes('div') && tClean.includes('liq') && tClean.includes('ebitda')) dados.divida_liquida_ebitda = valor;
            if (tClean.includes('div') && tClean.includes('liq') && tClean.includes('patrim')) dados.divida_liquida_pl = valor;

            // CAGR
            if (titulo.includes('cagr') && titulo.includes('receita')) dados.cagr_receita_5a = valor;
            if (titulo.includes('cagr') && titulo.includes('lucro')) dados.cagr_lucros_5a = valor;

            // VPA / Patrimônio
            if (dados.vp_cota === 'N/A' && (titulo === 'vpa' || titulo.replace(/\./g, '') === 'vpa' || titulo.includes('vp por cota'))) dados.vp_cota = valor;

            if (titulo.includes('patrimonial') || titulo.includes('patrimonio')) {
                const valorNumerico = parseValue(valor);
                const textoLower = valor.toLowerCase();
                if (textoLower.includes('milh') || textoLower.includes('bilh') || valorNumerico > 10000) {
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

        // Execução dos seletores
        $('._card').each((i, el) => {
            const titulo = $(el).find('._card-header').text().trim();
            const valor = $(el).find('._card-body').text().trim();
            processPair(titulo, valor, 'card');
            if (normalize(titulo).includes('cotacao')) cotacao_atual = parseValue(valor);
        });

        if (cotacao_atual === 0) {
            const cEl = $('._card.cotacao ._card-body span').first();
            if (cEl.length) cotacao_atual = parseValue(cEl.text());
        }

        $('.cell').each((i, el) => {
            let titulo = $(el).find('.name').text().trim();
            if (!titulo) titulo = $(el).children('span').first().text().trim();
            const valorEl = $(el).find('.value span').first();
            const valor = valorEl.length > 0 ? valorEl.text().trim() : $(el).find('.value').text().trim();
            processPair(titulo, valor, 'cell');
        });

        $('table tbody tr').each((i, row) => {
            const cols = $(row).find('td');
            if (cols.length >= 2) {
                const indicatorAttr = $(cols[0]).find('[data-indicator]').attr('data-indicator');
                processPair($(cols[0]).text(), $(cols[1]).text(), 'table', indicatorAttr);
            }
        });

        // Cálculo de valor de mercado como fallback
        if (dados.val_mercado === 'N/A' || dados.val_mercado === '-') {
            let mercadoCalc = 0;
            if (cotacao_atual > 0 && num_cotas > 0) {
                mercadoCalc = cotacao_atual * num_cotas;
            } else if (dados.patrimonio_liquido !== 'N/A' && dados.pvp !== 'N/A') {
                const pl = parseExtendedValue(dados.patrimonio_liquido);
                const pvp = parseValue(dados.pvp);
                if (pl > 0 && pvp > 0) mercadoCalc = pl * pvp;
            }
            if (mercadoCalc > 0) {
                if (mercadoCalc > 1e9) dados.val_mercado = `R$ ${(mercadoCalc / 1e9).toFixed(2)} Bilhões`;
                else if (mercadoCalc > 1e6) dados.val_mercado = `R$ ${(mercadoCalc / 1e6).toFixed(2)} Milhões`;
                else dados.val_mercado = formatCurrency(mercadoCalc);
            }
        }

        // Imóveis (FIIs)
        $('#properties-section .card-propertie').each((i, el) => {
            const nome = $(el).find('h3').text().trim();
            let estado = '';
            let abl = '';
            $(el).find('small').each((j, small) => {
                const t = $(small).text().trim();
                if (t.includes('Estado:')) estado = t.replace('Estado:', '').trim();
                if (t.includes('Área bruta locável:')) abl = t.replace('Área bruta locável:', '').trim();
            });
            if (nome) dados.imoveis.push({ nome, estado, abl });
        });

        cacheSet(cacheKey, dados, TTL.fundamentos);
        return dados;

    } catch (error) {
        log.error('Erro scraper fundamentos', { ticker, error: error.message });
        // Retorna objeto completo com N/A para não quebrar o frontend
        return {
            dy: 'N/A', pvp: 'N/A', pl: 'N/A', roe: 'N/A', lpa: 'N/A', vp_cota: 'N/A',
            val_mercado: 'N/A', liquidez: 'N/A', variacao_12m: 'N/A', ultimo_rendimento: 'N/A',
            segmento: 'N/A', tipo_fundo: 'N/A', mandato: 'N/A', vacancia: 'N/A',
            patrimonio_liquido: 'N/A', cnpj: 'N/A', num_cotistas: 'N/A', tipo_gestao: 'N/A',
            prazo_duracao: 'N/A', taxa_adm: 'N/A', cotas_emitidas: 'N/A', publico_alvo: 'N/A',
            margem_liquida: 'N/A', margem_bruta: 'N/A', margem_ebit: 'N/A',
            divida_liquida_ebitda: 'N/A', divida_liquida_pl: 'N/A', ev_ebitda: 'N/A',
            payout: 'N/A', cagr_receita_5a: 'N/A', cagr_lucros_5a: 'N/A',
            imoveis: [],
        };
    }
}

// ---------------------------------------------------------
// PARTE 2: PROVENTOS -> STATUSINVEST
// ---------------------------------------------------------
async function scrapeAsset(rawTicker) {
    const ticker = validateTicker(rawTicker);
    const cacheKey = `proventos:${ticker}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    try {
        const type = detectAssetType(ticker) === 'fii' ? 'fii' : 'acao';
        const url = `https://statusinvest.com.br/${type}/companytickerprovents?ticker=${ticker}&chartProventsType=2`;

        const { data } = await withRetry(() =>
            client.get(url, {
                headers: {
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': 'https://statusinvest.com.br/',
                },
            })
        );

        const earnings = data.assetEarningsModels || [];

        const parseDateJSON = (dStr) => {
            if (!dStr || dStr.trim() === '' || dStr.trim() === '-') return null;
            const parts = dStr.split('/');
            if (parts.length !== 3) return null;
            return `${parts[2]}-${parts[1]}-${parts[0]}`;
        };

        const dividendos = earnings.map(d => {
            let labelTipo = 'REND';
            if (d.et === 1) labelTipo = 'DIV';
            if (d.et === 2) labelTipo = 'JCP';
            if (d.etd) {
                const texto = d.etd.toUpperCase();
                if (texto.includes('JURO')) labelTipo = 'JCP';
                else if (texto.includes('DIVID')) labelTipo = 'DIV';
                else if (texto.includes('TRIBUTADO')) labelTipo = 'REND_TRIB';
            }
            return {
                dataCom: parseDateJSON(d.ed),
                paymentDate: parseDateJSON(d.pd),
                value: d.v,
                type: labelTipo,
                rawType: d.et,
            };
        });

        const result = dividendos
            .filter(d => d.paymentDate !== null)
            .sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));

        cacheSet(cacheKey, result, TTL.proventos);
        return result;

    } catch (error) {
        log.error('Erro StatusInvest API', { ticker, error: error.message });
        return [];
    }
}

// ---------------------------------------------------------
// PARTE 3: IPCA -> INVESTIDOR10
// ---------------------------------------------------------
async function scrapeIpca() {
    const cacheKey = 'ipca';
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    try {
        const url = 'https://investidor10.com.br/indices/ipca/';
        const { data } = await withRetry(() => client.get(url));
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
                    const dataRef = $(cols[0]).text().trim();
                    const valorStr = $(cols[1]).text().trim();
                    const acAnoStr = $(cols[2]).text().trim();
                    const ac12mStr = $(cols[3]).text().trim();

                    if (i === 0) {
                        acumulado12m = ac12mStr.replace('.', ',');
                        acumuladoAno = acAnoStr.replace('.', ',');
                    }

                    if (dataRef && valorStr && i < 13) {
                        historico.push({
                            mes: dataRef,
                            valor: parseFloat(valorStr.replace('.', '').replace(',', '.')),
                            acumulado_12m: ac12mStr.replace('.', ','),
                            acumulado_ano: acAnoStr.replace('.', ','),
                        });
                    }
                }
            });
        }

        const result = {
            historico: historico.reverse(),
            acumulado_12m: acumulado12m,
            acumulado_ano: acumuladoAno,
        };

        cacheSet(cacheKey, result, TTL.ipca);
        return result;

    } catch (error) {
        log.error('Erro scraper IPCA', { error: error.message });
        return { historico: [], acumulado_12m: '0,00', acumulado_ano: '0,00' };
    }
}

// ---------------------------------------------------------
// PARTE 4: COTAÇÃO HISTÓRICA (YAHOO FINANCE)
// ---------------------------------------------------------
function getYahooParams(range) {
    const map = {
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
    return map[range] ?? { range: '1y', interval: '1d' };
}

async function fetchYahooFinance(ticker, rangeFilter = '1A') {
    const symbol = ticker.toUpperCase().endsWith('.SA') ? ticker.toUpperCase() : `${ticker.toUpperCase()}.SA`;
    const { range, interval } = getYahooParams(rangeFilter);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}&includePrePost=false`;

    try {
        const { data } = await withRetry(() => client.get(url));
        const result = data?.chart?.result?.[0];

        if (!result?.timestamp || !result?.indicators?.quote?.[0]?.close) return null;

        const { timestamp: timestamps, indicators: { quote: [{ close: prices }] } } = result;

        return timestamps
            .map((t, i) => {
                if (prices[i] == null) return null;
                return {
                    date: new Date(t * 1000).toISOString(),
                    timestamp: t * 1000,
                    price: prices[i],
                };
            })
            .filter(Boolean);

    } catch (e) {
        log.error('Erro Yahoo Finance', { ticker, error: e.message });
        return null;
    }
}

async function scrapeCotacaoHistory(rawTicker, range = '1A') {
    const ticker = validateTicker(rawTicker);

    if (!ALLOWED_RANGES.has(range)) {
        throw new Error(`Range inválido: "${range}". Use um dos valores permitidos: ${[...ALLOWED_RANGES].join(', ')}.`);
    }

    const cacheKey = `cotacao:${ticker}:${range}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const points = await fetchYahooFinance(ticker, range);

    if (!points || points.length === 0) {
        return { error: 'Dados não encontrados', points: [] };
    }

    const result = { ticker, range, points };
    cacheSet(cacheKey, result, TTL.cotacao_historica);
    return result;
}

// ---------------------------------------------------------
// HANDLER (API MAIN)
// ---------------------------------------------------------
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido. Use POST.' });
    }

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

    try {
        const { mode, payload } = req.body ?? {};

        if (!mode) throw new Error('Campo "mode" ausente no payload.');
        if (!ALLOWED_MODES.has(mode)) throw new Error(`Modo desconhecido: "${mode}".`);

        // IPCA
        if (mode === 'ipca') {
            const dados = await scrapeIpca();
            return res.status(200).json({ json: dados });
        }

        // Fundamentos
        if (mode === 'fundamentos') {
            if (!payload?.ticker) return res.status(400).json({ error: 'Ticker ausente.' });
            const dados = await scrapeFundamentos(payload.ticker);
            return res.status(200).json({ json: dados });
        }

        // Proventos (lote)
        if (mode === 'proventos_carteira' || mode === 'historico_portfolio') {
            if (!Array.isArray(payload?.fiiList) || payload.fiiList.length === 0) {
                return res.status(400).json({ error: 'fiiList ausente ou vazio.' });
            }

            const defaultLimit = mode === 'historico_portfolio' ? 14 : 12;
            const batches = chunkArray(payload.fiiList, 5);
            let finalResults = [];

            for (const batch of batches) {
                const promises = batch.map(async (item) => {
                    const ticker = typeof item === 'string' ? item : item.ticker;
                    const limit = typeof item === 'string' ? defaultLimit : (item.limit ?? defaultLimit);
                    const history = await scrapeAsset(ticker);
                    const recents = history.filter(h => h.paymentDate && h.value > 0).slice(0, limit);
                    if (recents.length > 0) return recents.map(r => ({ symbol: ticker.toUpperCase(), ...r }));
                    return null;
                });
                const batchResults = await Promise.all(promises);
                finalResults = finalResults.concat(batchResults);
                if (batches.length > 1) await new Promise(r => setTimeout(r, 200));
            }

            return res.status(200).json({ json: finalResults.filter(Boolean).flat() });
        }

        // Histórico 12m
        if (mode === 'historico_12m') {
            if (!payload?.ticker) return res.status(400).json({ error: 'Ticker ausente.' });
            const history = await scrapeAsset(payload.ticker);
            return res.status(200).json({ json: history });
        }

        // Próximo provento
        if (mode === 'proximo_provento') {
            if (!payload?.ticker) return res.status(400).json({ error: 'Ticker ausente.' });
            const history = await scrapeAsset(payload.ticker);

            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);

            let ultimoPago = null;
            let proximo = null;

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

        // Cotação histórica
        if (mode === 'cotacao_historica') {
            if (!payload?.ticker) return res.status(400).json({ error: 'Ticker ausente.' });
            const range = payload.range || '1D';
            const dados = await scrapeCotacaoHistory(payload.ticker, range);
            return res.status(200).json({ json: dados });
        }

    } catch (error) {
        log.error('Erro no handler', { error: error.message });
        return res.status(500).json({ error: error.message });
    }
};
