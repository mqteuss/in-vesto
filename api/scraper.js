'use strict';

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
// CORS: ORIGENS PERMITIDAS
// Adicione aqui os domínios que podem chamar esta API.
// ---------------------------------------------------------
const ALLOWED_ORIGINS = [
    'https://in-vesto.vercel.app',
    'https://in-vesto.vercel.app',
    'http://localhost:3000',
];

// ---------------------------------------------------------
// CACHE EM MEMÓRIA (TTL em milissegundos)
// ---------------------------------------------------------
const CACHE_TTL = {
    fundamentos: 15 * 60 * 1000,   // 15 min
    proventos:   30 * 60 * 1000,   // 30 min
    ipca:        60 * 60 * 1000,   // 1 hora
    cotacao:      5 * 60 * 1000,   //  5 min
};

const cache = new Map();

function cacheGet(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        cache.delete(key);
        return null;
    }
    return entry.value;
}

function cacheSet(key, value, ttl) {
    cache.set(key, { value, expiresAt: Date.now() + ttl });
}

// ---------------------------------------------------------
// VALIDAÇÃO DE TICKER
// ---------------------------------------------------------
const TICKER_REGEX = /^[A-Z0-9]{4,7}$/i;

function validateTicker(ticker) {
    if (!ticker || typeof ticker !== 'string') return false;
    return TICKER_REGEX.test(ticker.trim());
}

// ---------------------------------------------------------
// HELPERS (FUNÇÕES AUXILIARES)
// ---------------------------------------------------------
const REGEX_CLEAN_NUMBER = /[^0-9,.-]+/g;
const REGEX_NORMALIZE    = /[\u0300-\u036f]/g;

/**
 * Converte uma string de valor brasileiro (ex: "1.234,56") para float.
 * Suporta números negativos.
 */
function parseValue(valueStr) {
    if (valueStr === null || valueStr === undefined) return 0;
    if (typeof valueStr === 'number') return valueStr;
    try {
        const cleaned = valueStr
            .replace(REGEX_CLEAN_NUMBER, '')  // mantém dígitos, vírgula, ponto e hífen
            .replace(/\./g, '')               // remove separador de milhar
            .replace(',', '.');               // normaliza decimal
        const num = parseFloat(cleaned);
        return isNaN(num) ? 0 : num;
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
    const val   = parseValue(str);
    const lower = str.toLowerCase();
    if (lower.includes('bilh')) return val * 1_000_000_000;
    if (lower.includes('milh')) return val * 1_000_000;
    if (lower.includes('mil'))  return val * 1_000;
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

/**
 * Converte "DD/MM/YYYY" → "YYYY-MM-DD". Retorna null para entradas inválidas.
 */
function parseDateBR(dStr) {
    if (!dStr || dStr === '-' || dStr.includes('N/D')) return null;
    const parts = dStr.split('/');
    return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : null;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------
// HELPER: URL do Investidor10 por tipo de ativo
// ---------------------------------------------------------
function getInvestidor10Url(ticker, tipo) {
    const t = ticker.toLowerCase();
    if (tipo === 'acao') return `https://investidor10.com.br/acoes/${t}/`;
    if (tipo === 'bdr')  return `https://investidor10.com.br/bdrs/${t}/`;
    return `https://investidor10.com.br/fiis/${t}/`; // padrão: FII
}

/**
 * Busca o HTML do Investidor10, tentando FII → Ação → BDR se `tipo` não for informado.
 */
async function fetchInvestidor10Html(ticker, tipo = null) {
    if (tipo) {
        const res = await client.get(getInvestidor10Url(ticker, tipo));
        return res.data;
    }

    // Fallback automático: FII → Ação → BDR
    const urls = [
        `https://investidor10.com.br/fiis/${ticker.toLowerCase()}/`,
        `https://investidor10.com.br/acoes/${ticker.toLowerCase()}/`,
        `https://investidor10.com.br/bdrs/${ticker.toLowerCase()}/`,
    ];

    let lastError;
    for (const url of urls) {
        try {
            const res = await client.get(url);
            return res.data;
        } catch (err) {
            lastError = err;
        }
    }
    throw lastError;
}

// ---------------------------------------------------------
// PARTE 1: FUNDAMENTOS -> INVESTIDOR10
// ---------------------------------------------------------

function buildDadosVazio() {
    return {
        // Comuns
        dy: 'N/A', pvp: 'N/A', pl: 'N/A', roe: 'N/A', lpa: 'N/A', vp_cota: 'N/A',
        val_mercado: 'N/A', liquidez: 'N/A', variacao_12m: 'N/A', ultimo_rendimento: 'N/A',
        // FIIs
        segmento: 'N/A', tipo_fundo: 'N/A', mandato: 'N/A', vacancia: 'N/A',
        patrimonio_liquido: 'N/A', cnpj: 'N/A', num_cotistas: 'N/A',
        tipo_gestao: 'N/A', prazo_duracao: 'N/A', taxa_adm: 'N/A',
        cotas_emitidas: 'N/A', publico_alvo: 'N/A',
        // Ações
        margem_liquida: 'N/A', margem_bruta: 'N/A', margem_ebit: 'N/A',
        divida_liquida_ebitda: 'N/A', divida_liquida_pl: 'N/A', ev_ebitda: 'N/A',
        payout: 'N/A', cagr_receita_5a: 'N/A', cagr_lucros_5a: 'N/A',
        // FIIs – imóveis
        imoveis: [],
    };
}

/**
 * Aplica valores com prioridade via atributo data-indicator.
 * Retorna true se o campo foi preenchido, false caso contrário.
 */
function applyIndicatorAttr(dados, indicatorAttr, valor) {
    const ind = indicatorAttr.toUpperCase();
    const MAP = {
        DIVIDA_LIQUIDA_EBITDA: 'divida_liquida_ebitda',
        DY:                    'dy',
        P_L:                   'pl',
        P_VP:                  'pvp',
        ROE:                   'roe',
        MARGEM_LIQUIDA:        'margem_liquida',
    };
    if (MAP[ind]) {
        dados[MAP[ind]] = valor;
        return true;
    }
    return false;
}

/**
 * Aplica valores via fallback textual (normalizado).
 */
function applyTextFallback(dados, titulo, valor, origem) {
    // Geral
    if (dados.dy === 'N/A' && (titulo === 'dy' || titulo.includes('dividend yield') || titulo.includes('dy (')))
        dados.dy = valor;
    if (dados.pvp === 'N/A' && titulo.includes('p/vp'))
        dados.pvp = valor;
    if (dados.liquidez === 'N/A' && titulo.includes('liquidez'))
        dados.liquidez = valor;
    if (dados.val_mercado === 'N/A' && titulo.includes('mercado') && !(dados.val_mercado !== 'N/A' && origem === 'table'))
        dados.val_mercado = valor;
    if (dados.variacao_12m === 'N/A' && titulo.includes('variacao') && titulo.includes('12m'))
        dados.variacao_12m = valor;
    if (dados.ultimo_rendimento === 'N/A' && titulo.includes('ultimo rendimento'))
        dados.ultimo_rendimento = valor;

    // FIIs
    if (dados.segmento === 'N/A'       && titulo.includes('segmento'))      dados.segmento = valor;
    if (dados.vacancia === 'N/A'       && titulo.includes('vacancia'))       dados.vacancia = valor;
    if (dados.cnpj === 'N/A'           && titulo.includes('cnpj'))           dados.cnpj = valor;
    if (dados.num_cotistas === 'N/A'   && titulo.includes('cotistas'))       dados.num_cotistas = valor;
    if (dados.tipo_gestao === 'N/A'    && titulo.includes('gestao'))         dados.tipo_gestao = valor;
    if (dados.mandato === 'N/A'        && titulo.includes('mandato'))        dados.mandato = valor;
    if (dados.tipo_fundo === 'N/A'     && titulo.includes('tipo de fundo'))  dados.tipo_fundo = valor;
    if (dados.prazo_duracao === 'N/A'  && titulo.includes('prazo'))          dados.prazo_duracao = valor;
    if (dados.taxa_adm === 'N/A'       && titulo.includes('taxa') && titulo.includes('administracao'))
        dados.taxa_adm = valor;
    if (dados.cotas_emitidas === 'N/A' && titulo.includes('cotas'))          dados.cotas_emitidas = valor;
    if (dados.publico_alvo === 'N/A'   && titulo.includes('publico') && titulo.includes('alvo'))
        dados.publico_alvo = valor;

    // Ações
    if (dados.pl === 'N/A'  && titulo.includes('p/l'))               dados.pl = valor;
    if (dados.roe === 'N/A' && titulo.replace(/\./g, '') === 'roe')  dados.roe = valor;
    if (dados.lpa === 'N/A' && titulo.replace(/\./g, '') === 'lpa')  dados.lpa = valor;

    // Margens & Payout
    if (titulo.includes('margem liquida')) dados.margem_liquida = valor;
    if (titulo.includes('margem bruta'))   dados.margem_bruta   = valor;
    if (titulo.includes('margem ebit'))    dados.margem_ebit    = valor;
    if (titulo.includes('payout'))         dados.payout         = valor;

    // EV e Dívidas
    if (titulo.includes('ev/ebitda')) dados.ev_ebitda = valor;

    const tClean = titulo.replace(/[\s/.\-]/g, '');
    if (dados.divida_liquida_ebitda === 'N/A' && tClean.includes('div') && tClean.includes('liq') && tClean.includes('ebitda'))
        dados.divida_liquida_ebitda = valor;
    if (tClean.includes('div') && tClean.includes('liq') && tClean.includes('patrim'))
        dados.divida_liquida_pl = valor;

    // CAGR
    if (titulo.includes('cagr') && titulo.includes('receita')) dados.cagr_receita_5a = valor;
    if (titulo.includes('cagr') && titulo.includes('lucro'))   dados.cagr_lucros_5a  = valor;

    // VPA / Patrimônio
    if (dados.vp_cota === 'N/A' && (titulo === 'vpa' || titulo.replace(/\./g, '') === 'vpa' || titulo.includes('vp por cota')))
        dados.vp_cota = valor;
}

async function scrapeFundamentos(ticker, tipo = null) {
    const cacheKey = `fundamentos:${ticker.toUpperCase()}`;
    const cached   = cacheGet(cacheKey);
    if (cached) return cached;

    try {
        const html = await fetchInvestidor10Html(ticker, tipo);
        const $    = cheerio.load(html);
        const dados = buildDadosVazio();

        let cotacao_atual = 0;
        let num_cotas     = 0;

        const processPair = (tituloRaw, valorRaw, origem = 'table', indicatorAttr = null) => {
            const titulo = normalize(tituloRaw);
            let valor    = (valorRaw || '').trim();

            if (titulo.includes('mercado')) {
                valor = cleanDoubledString(valor);
                if (dados.val_mercado !== 'N/A' && origem === 'table') return;
            }

            if (!valor) return;

            // Prioridade 1: data-indicator
            if (indicatorAttr && applyIndicatorAttr(dados, indicatorAttr, valor)) return;

            // Prioridade 2: fallback textual
            applyTextFallback(dados, titulo, valor, origem);

            // Patrimônio / VPA (lógica especial pelo tamanho do valor)
            if (titulo.includes('patrimonial') || titulo.includes('patrimonio')) {
                const valorNumerico = parseValue(valor);
                const textoLower    = valor.toLowerCase();
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
            const valor   = valorEl.length > 0 ? valorEl.text().trim() : $(el).find('.value').text().trim();
            processPair(titulo, valor, 'cell');
        });

        // Tabela
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
                const pl  = parseExtendedValue(dados.patrimonio_liquido);
                const pvp = parseValue(dados.pvp);
                if (pl > 0 && pvp > 0) mercadoCalc = pl * pvp;
            }
            if (mercadoCalc > 0) {
                if (mercadoCalc > 1e9)      dados.val_mercado = `R$ ${(mercadoCalc / 1e9).toFixed(2)} Bilhões`;
                else if (mercadoCalc > 1e6) dados.val_mercado = `R$ ${(mercadoCalc / 1e6).toFixed(2)} Milhões`;
                else                        dados.val_mercado = formatCurrency(mercadoCalc);
            }
        }

        // Imóveis (FIIs)
        $('#properties-section .card-propertie').each((i, el) => {
            const nome = $(el).find('h3').text().trim();
            let estado = '';
            let abl    = '';
            $(el).find('small').each((j, small) => {
                const t = $(small).text().trim();
                if (t.includes('Estado:'))              estado = t.replace('Estado:', '').trim();
                if (t.includes('Área bruta locável:'))  abl    = t.replace('Área bruta locável:', '').trim();
            });
            if (nome) dados.imoveis.push({ nome, estado, abl });
        });

        cacheSet(cacheKey, dados, CACHE_TTL.fundamentos);
        return dados;

    } catch (error) {
        console.error(`[scrapeFundamentos] Erro para ${ticker}:`, error.message);
        return { error: 'Falha ao buscar fundamentos', dy: '-', pvp: '-' };
    }
}

// ---------------------------------------------------------
// PARTE 2: PROVENTOS -> INVESTIDOR10
// ---------------------------------------------------------

async function scrapeAsset(ticker, tipo = null) {
    const cacheKey = `proventos:${ticker.toUpperCase()}`;
    const cached   = cacheGet(cacheKey);
    if (cached) return cached;

    try {
        const html = await fetchInvestidor10Html(ticker, tipo);
        const $    = cheerio.load(html);
        const dividendos = [];

        $('#table-dividends-history tbody tr').each((i, el) => {
            const cols = $(el).find('td');
            if (cols.length < 4) return;

            const tipoOriginal    = $(cols[0]).text().trim();
            const tipoNormalizado = tipoOriginal
                .toUpperCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '');

            const dataComRaw   = $(cols[1]).text().trim();
            const pagamentoRaw = $(cols[2]).text().trim();
            const valorText    = $(cols[3]).text().trim();

            const match = valorText.match(/[\d,.]+/);
            const value = match ? parseFloat(match[0].replace(/\./g, '').replace(',', '.')) || 0 : 0;

            const dataCom    = parseDateBR(dataComRaw);
            const paymentDate = parseDateBR(pagamentoRaw);

            let labelTipo = 'REND';
            if (tipoNormalizado.includes('JURO') || tipoNormalizado.includes('JSCP') || tipoNormalizado.includes('JCP'))
                labelTipo = 'JCP';
            else if (tipoNormalizado.includes('DIVIDENDO'))
                labelTipo = 'DIV';
            else if (tipoNormalizado.includes('TRIBUTADO'))
                labelTipo = 'REND_TRIB';
            else if (tipoNormalizado.includes('AMORTIZA') || tipoNormalizado.includes('RESTITUI'))
                labelTipo = 'AMORT';

            if (paymentDate && value > 0) {
                dividendos.push({ dataCom, paymentDate, value, type: labelTipo, rawType: tipoOriginal });
            }
        });

        const result = dividendos.sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));
        cacheSet(cacheKey, result, CACHE_TTL.proventos);
        return result;

    } catch (error) {
        console.error(`[scrapeAsset] Erro para ${ticker}:`, error.message);
        return [];
    }
}

// ---------------------------------------------------------
// PARTE 3: IPCA -> INVESTIDOR10
// ---------------------------------------------------------

async function scrapeIpca() {
    const cacheKey = 'ipca';
    const cached   = cacheGet(cacheKey);
    if (cached) return cached;

    try {
        const { data } = await client.get('https://investidor10.com.br/indices/ipca/');
        const $        = cheerio.load(data);
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
                        mes:            dataRef,
                        valor:          parseFloat(valorStr.replace('.', '').replace(',', '.')),
                        acumulado_12m:  ac12mStr.replace('.', ','),
                        acumulado_ano:  acAnoStr.replace('.', ','),
                    });
                }
            });
        }

        const result = {
            historico: historico.reverse(),
            acumulado_12m: acumulado12m,
            acumulado_ano: acumuladoAno,
        };

        cacheSet(cacheKey, result, CACHE_TTL.ipca);
        return result;

    } catch (error) {
        console.error('[scrapeIpca] Erro:', error.message);
        return { historico: [], acumulado_12m: '0,00', acumulado_ano: '0,00' };
    }
}

// ---------------------------------------------------------
// PARTE 4: COTAÇÃO HISTÓRICA (YAHOO FINANCE)
// ---------------------------------------------------------

function getYahooParams(range) {
    switch (range) {
        case '1D':              return { range: '1d',  interval: '5m' };
        case '5D':              return { range: '5d',  interval: '15m' };
        case '1M':              return { range: '1mo', interval: '1d' };
        case '6M':              return { range: '6mo', interval: '1d' };
        case 'YTD':             return { range: 'ytd', interval: '1d' };
        case '1Y': case '1A':   return { range: '1y',  interval: '1d' };
        case '5Y': case '5A':   return { range: '5y',  interval: '1wk' };
        case 'Tudo': case 'MAX':return { range: 'max', interval: '1mo' };
        default:                return { range: '1y',  interval: '1d' };
    }
}

async function fetchYahooFinance(ticker, rangeFilter = '1A') {
    try {
        const symbol             = ticker.toUpperCase().endsWith('.SA') ? ticker.toUpperCase() : `${ticker.toUpperCase()}.SA`;
        const { range, interval } = getYahooParams(rangeFilter);
        const url                = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}&includePrePost=false`;

        // Usa o client configurado (keepAlive + timeout) em vez do axios global
        const { data } = await client.get(url);
        const result   = data?.chart?.result?.[0];

        if (!result?.timestamp || !result?.indicators?.quote?.[0]?.close) return null;

        const timestamps = result.timestamp;
        const prices     = result.indicators.quote[0].close;

        return timestamps
            .map((t, i) => {
                if (prices[i] == null) return null;
                return { date: new Date(t * 1000).toISOString(), timestamp: t * 1000, price: prices[i] };
            })
            .filter(Boolean);

    } catch (e) {
        console.error(`[fetchYahooFinance] Erro para ${ticker}:`, e.message);
        return null;
    }
}

async function scrapeCotacaoHistory(ticker, range = '1A') {
    const cacheKey = `cotacao:${ticker.toUpperCase()}:${range}`;
    const cached   = cacheGet(cacheKey);
    if (cached) return cached;

    const cleanTicker = ticker.toLowerCase().trim();
    const data        = await fetchYahooFinance(cleanTicker, range);

    if (!data || data.length === 0) {
        return { error: 'Dados não encontrados', points: [] };
    }

    const result = { ticker: cleanTicker.toUpperCase(), range, points: data };
    cacheSet(cacheKey, result, CACHE_TTL.cotacao);
    return result;
}

// ---------------------------------------------------------
// HANDLER (API MAIN)
// ---------------------------------------------------------

module.exports = async function handler(req, res) {
    // --- CORS ---
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'POST')    { return res.status(405).json({ error: 'Use POST' }); }

    if (req.method === 'POST') {
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    }

    try {
        if (!req.body?.mode) {
            return res.status(400).json({ error: 'Payload inválido: campo "mode" ausente.' });
        }

        const { mode, payload = {} } = req.body;

        // --- MODO: IPCA ---
        if (mode === 'ipca') {
            const dados = await scrapeIpca();
            return res.status(200).json({ json: dados });
        }

        // --- MODO: FUNDAMENTOS ---
        if (mode === 'fundamentos') {
            if (!payload.ticker || !validateTicker(payload.ticker)) {
                return res.status(400).json({ error: 'Ticker inválido ou ausente.' });
            }
            const dados = await scrapeFundamentos(payload.ticker, payload.tipo || null);
            return res.status(200).json({ json: dados });
        }

        // --- MODO: PROVENTOS EM LOTE ---
        if (mode === 'proventos_carteira' || mode === 'historico_portfolio') {
            if (!Array.isArray(payload.fiiList) || payload.fiiList.length === 0) {
                return res.status(400).json({ error: 'fiiList ausente ou vazio.' });
            }

            const batches = chunkArray(payload.fiiList, 5);
            let finalResults = [];

            for (const batch of batches) {
                const promises = batch.map(async (item) => {
                    const ticker       = typeof item === 'string' ? item : item.ticker;
                    const tipo         = typeof item === 'object' ? (item.tipo || null) : null;
                    const defaultLimit = mode === 'historico_portfolio' ? 14 : 12;
                    const limit        = typeof item === 'string' ? defaultLimit : (item.limit || defaultLimit);

                    if (!validateTicker(ticker)) return null;

                    const history = await scrapeAsset(ticker, tipo);
                    const recents = history.filter((h) => h.paymentDate && h.value > 0).slice(0, limit);
                    return recents.length > 0 ? recents.map((r) => ({ symbol: ticker.toUpperCase(), ...r })) : null;
                });

                const batchResults = await Promise.all(promises);
                finalResults = finalResults.concat(batchResults);

                // Sempre aguarda entre batches para respeitar rate limit
                await sleep(200);
            }

            return res.status(200).json({ json: finalResults.filter(Boolean).flat() });
        }

        // --- MODO: HISTÓRICO 12M ---
        if (mode === 'historico_12m') {
            if (!payload.ticker || !validateTicker(payload.ticker)) {
                return res.status(400).json({ error: 'Ticker inválido ou ausente.' });
            }
            const history = await scrapeAsset(payload.ticker, payload.tipo || null);
            return res.status(200).json({ json: history });
        }

        // --- MODO: PRÓXIMO PROVENTO ---
        if (mode === 'proximo_provento') {
            if (!payload.ticker || !validateTicker(payload.ticker)) {
                return res.status(400).json({ error: 'Ticker inválido ou ausente.' });
            }

            const history = await scrapeAsset(payload.ticker, payload.tipo || null);
            const hoje    = new Date();
            hoje.setHours(0, 0, 0, 0);

            let ultimoPago = null;
            let proximo    = null;

            for (const p of history) {
                if (!p.paymentDate) continue;
                const [ano, mes, dia] = p.paymentDate.split('-');
                const dataPag         = new Date(Number(ano), Number(mes) - 1, Number(dia));

                if (dataPag > hoje) {
                    if (!proximo)    proximo    = p;
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

        // --- MODO: COTAÇÃO HISTÓRICA ---
        if (mode === 'cotacao_historica') {
            if (!payload.ticker || !validateTicker(payload.ticker)) {
                return res.status(400).json({ error: 'Ticker inválido ou ausente.' });
            }
            const range = payload.range || '1D';
            const dados = await scrapeCotacaoHistory(payload.ticker, range);
            return res.status(200).json({ json: dados });
        }

        return res.status(400).json({ error: 'Modo desconhecido.' });

    } catch (error) {
        // Loga internamente, mas não expõe detalhes ao cliente
        console.error('[handler] Erro interno:', error);
        return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
};
