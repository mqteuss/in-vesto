'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// ---------------------------------------------------------
// CONSTANTES
// ---------------------------------------------------------
const CACHE_TTL_MS = 5 * 60 * 1000;      // 5 minutos (dados de fundamentos)
const CACHE_TTL_IPCA_MS = 60 * 60 * 1000; // 1 hora (IPCA muda raramente)
const MAX_RETRIES = 3;
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 250;

// ---------------------------------------------------------
// AGENTE HTTPS & CLIENTE AXIOS
// ---------------------------------------------------------
const httpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 64,
    maxFreeSockets: 10,
    timeout: 10_000,
});

const client = axios.create({
    httpsAgent,
    timeout: 10_000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        'Referer': 'https://investidor10.com.br/',
    },
});

// ---------------------------------------------------------
// CACHE EM MEMÓRIA (simples, processo único)
// ---------------------------------------------------------
const _cache = new Map();

function cacheGet(key) {
    const entry = _cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.at > entry.ttl) {
        _cache.delete(key);
        return null;
    }
    return entry.value;
}

function cacheSet(key, value, ttl = CACHE_TTL_MS) {
    _cache.set(key, { value, at: Date.now(), ttl });
}

// ---------------------------------------------------------
// LOG ESTRUTURADO
// ---------------------------------------------------------
const log = {
    info: (msg, ctx = {}) => console.log(JSON.stringify({ level: 'info', msg, ...ctx, ts: new Date().toISOString() })),
    warn: (msg, ctx = {}) => console.warn(JSON.stringify({ level: 'warn', msg, ...ctx, ts: new Date().toISOString() })),
    error: (msg, ctx = {}) => console.error(JSON.stringify({ level: 'error', msg, ...ctx, ts: new Date().toISOString() })),
};

// ---------------------------------------------------------
// RETRY COM BACKOFF EXPONENCIAL
// ---------------------------------------------------------
async function fetchWithRetry(url, options = {}, retries = MAX_RETRIES) {
    let lastError;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await client.get(url, options);
        } catch (err) {
            lastError = err;
            const isRetryable = !err.response || err.response.status >= 500 || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT';
            if (!isRetryable || attempt === retries) break;
            const delay = 200 * 2 ** (attempt - 1); // 200ms, 400ms, 800ms
            log.warn('Tentando novamente após erro', { url, attempt, delay, error: err.message });
            await sleep(delay);
        }
    }
    throw lastError;
}

// ---------------------------------------------------------
// HELPERS
// ---------------------------------------------------------
const REGEX_DIACRITICS = /[\u0300-\u036f]/g;

/** Remove acentos, lowercase, trim. */
function normalize(str) {
    if (!str) return '';
    return str.normalize('NFD').replace(REGEX_DIACRITICS, '').toLowerCase().trim();
}

/**
 * Converte string numérica brasileira para float.
 * Suporta negativos (ex: "-1,25" → -1.25).
 */
function parseValue(valueStr) {
    if (valueStr === null || valueStr === undefined) return 0;
    if (typeof valueStr === 'number') return valueStr;
    try {
        const clean = valueStr
            .replace(/[^\d,.\-]/g, '') // mantém dígitos, vírgula, ponto e sinal negativo
            .replace(',', '.');
        return parseFloat(clean) || 0;
    } catch {
        return 0;
    }
}

/**
 * Converte strings com sufixo de magnitude (bilhões/milhões/mil) para número.
 */
function parseExtendedValue(str) {
    if (!str) return 0;
    const val = parseValue(str);
    const lower = str.toLowerCase();
    if (lower.includes('bilh')) return val * 1_000_000_000;
    if (lower.includes('milh')) return val * 1_000_000;
    if (lower.includes('mil')) return val * 1_000;
    return val;
}

/** Formata valor em BRL. */
function formatCurrency(value) {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Remove strings duplicadas do tipo "R$ 1,00 R$ 1,00".
 * Mantém apenas a primeira ocorrência.
 */
function cleanDoubledString(str) {
    if (!str) return '';
    const parts = str.split('R$');
    return parts.length > 2 ? `R$${parts[1].trim()}` : str;
}

/** Divide array em chunks de tamanho `size`. */
function chunkArray(array, size) {
    const results = [];
    for (let i = 0; i < array.length; i += size) {
        results.push(array.slice(i, i + size));
    }
    return results;
}

/** Promessa de delay. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retorna true se o ticker for de FII (termina em 11 ou 11B).
 * Corrige bug original onde `&&` tinha precedência sobre `||`.
 */
function isFii(ticker) {
    return ticker.endsWith('11') || ticker.endsWith('11B');
}

/**
 * Valida e sanitiza tickers de ativos brasileiros.
 * Lança erro se o formato for inválido.
 */
function sanitizeTicker(ticker) {
    if (!ticker || typeof ticker !== 'string') throw new Error('Ticker inválido');
    const clean = ticker.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^[A-Z]{4}\d{1,2}B?$/.test(clean)) throw new Error(`Ticker com formato inválido: "${ticker}"`);
    return clean;
}

// ---------------------------------------------------------
// MAPA DECLARATIVO DE INDICADORES
// Cada entrada: [campo_em_dados, fn_de_correspondência]
// Mais fácil de manter e estender do que dezenas de `if`s.
// ---------------------------------------------------------
const INDICATOR_MAP = [
    ['dy',                   (t) => t === 'dy' || t.includes('dividend yield') || t.includes('dy (')],
    ['pvp',                  (t) => t.includes('p/vp')],
    ['pl',                   (t) => t === 'p/l' || (t.includes('p/l') && !t.includes('p/lp'))],
    ['roe',                  (t) => t.replace(/\./g, '') === 'roe'],
    ['lpa',                  (t) => t.replace(/\./g, '') === 'lpa'],
    ['liquidez',             (t) => t.includes('liquidez')],
    ['val_mercado',          (t) => t.includes('mercado')],
    ['variacao_12m',         (t) => t.includes('variacao') && t.includes('12m')],
    ['ultimo_rendimento',    (t) => t.includes('ultimo rendimento')],
    ['segmento',             (t) => t.includes('segmento')],
    ['vacancia',             (t) => t.includes('vacancia')],
    ['cnpj',                 (t) => t.includes('cnpj')],
    ['num_cotistas',         (t) => t.includes('cotistas')],
    ['tipo_gestao',          (t) => t.includes('gestao')],
    ['mandato',              (t) => t.includes('mandato')],
    ['tipo_fundo',           (t) => t.includes('tipo de fundo')],
    ['prazo_duracao',        (t) => t.includes('prazo')],
    ['taxa_adm',             (t) => t.includes('taxa') && t.includes('administracao')],
    ['publico_alvo',         (t) => t.includes('publico') && t.includes('alvo')],
    ['margem_liquida',       (t) => t.includes('margem liquida')],
    ['margem_bruta',         (t) => t.includes('margem bruta')],
    ['margem_ebit',          (t) => t.includes('margem ebit')],
    ['payout',               (t) => t.includes('payout')],
    ['ev_ebitda',            (t) => t.includes('ev/ebitda')],
    ['cagr_receita_5a',      (t) => t.includes('cagr') && t.includes('receita')],
    ['cagr_lucros_5a',       (t) => t.includes('cagr') && t.includes('lucro')],
    ['divida_liquida_pl',    (t) => { const c = t.replace(/[\s/.\-]/g, ''); return c.includes('div') && c.includes('liq') && c.includes('patrim'); }],
    ['divida_liquida_ebitda',(t) => { const c = t.replace(/[\s/.\-]/g, ''); return c.includes('div') && c.includes('liq') && c.includes('ebitda'); }],
    ['vp_cota',              (t) => t === 'vpa' || t.replace(/\./g, '') === 'vpa' || t.includes('vp por cota')],
];

// Mapa de atributos data-indicator → campo em dados
const DATA_INDICATOR_MAP = {
    DIVIDA_LIQUIDA_EBITDA: 'divida_liquida_ebitda',
    DY: 'dy',
    P_L: 'pl',
    P_VP: 'pvp',
    ROE: 'roe',
    MARGEM_LIQUIDA: 'margem_liquida',
};

// ---------------------------------------------------------
// PARTE 1: FUNDAMENTOS → INVESTIDOR10
// ---------------------------------------------------------
async function scrapeFundamentos(rawTicker) {
    const ticker = sanitizeTicker(rawTicker);
    const cacheKey = `fundamentos:${ticker}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
        log.info('Cache hit: fundamentos', { ticker });
        return cached;
    }

    const slug = ticker.toLowerCase();
    const urlFii  = `https://investidor10.com.br/fiis/${slug}/`;
    const urlAcao = `https://investidor10.com.br/acoes/${slug}/`;

    const fetchHtml = async (url) => {
        const res = await fetchWithRetry(url);
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        if (!res.data.includes('cotacao') && !res.data.includes('Cotação')) throw new Error('Página inválida');
        return res.data;
    };

    let html;
    try {
        html = await Promise.any([fetchHtml(urlFii), fetchHtml(urlAcao)]);
    } catch {
        throw new Error('Ativo não encontrado no Investidor10');
    }

    const $ = cheerio.load(html);

    // Estado inicial dos dados
    const N = 'N/A';
    const dados = {
        dy: N, pvp: N, pl: N, roe: N, lpa: N, vp_cota: N,
        val_mercado: N, liquidez: N, variacao_12m: N, ultimo_rendimento: N,
        segmento: N, tipo_fundo: N, mandato: N, vacancia: N,
        patrimonio_liquido: N, cnpj: N,
        num_cotistas: N, tipo_gestao: N, prazo_duracao: N,
        taxa_adm: N, cotas_emitidas: N, publico_alvo: N,
        margem_liquida: N, margem_bruta: N, margem_ebit: N,
        divida_liquida_ebitda: N, divida_liquida_pl: N, ev_ebitda: N,
        payout: N, cagr_receita_5a: N, cagr_lucros_5a: N,
        imoveis: [],
        sobre: '',
        comparacao: [],
    };

    let cotacao_atual = 0;
    let num_cotas = 0;

    /**
     * Tenta mapear um par (título, valor) para um campo em `dados`.
     * Usa o mapa declarativo acima — sem cascata de ifs.
     */
    const processPair = (tituloRaw, valorRaw, origem = 'table', indicatorAttr = null) => {
        if (!valorRaw) return;
        const titulo = normalize(tituloRaw);
        let valor = valorRaw.trim();
        if (!valor) return;

        // Prioridade: atributo data-indicator (mais confiável que texto)
        if (indicatorAttr) {
            const campo = DATA_INDICATOR_MAP[indicatorAttr.toUpperCase()];
            if (campo && dados[campo] === N) {
                dados[campo] = valor;
                return;
            }
        }

        // Tratamento especial: val_mercado pode vir duplicado
        if (titulo.includes('mercado')) {
            valor = cleanDoubledString(valor);
            if (dados.val_mercado !== N && origem === 'table') return;
        }

        // Patrimônio líquido: distingue VP/cota de PL total pelo valor
        if (titulo.includes('patrimonial') || titulo.includes('patrimonio')) {
            const num = parseValue(valor);
            const lower = valor.toLowerCase();
            const isGrande = lower.includes('milh') || lower.includes('bilh') || num > 10_000;
            if (isGrande) {
                if (dados.patrimonio_liquido === N) dados.patrimonio_liquido = valor;
            } else {
                if (dados.vp_cota === N) dados.vp_cota = valor;
            }
            return;
        }

        // Cotas emitidas e num_cotas
        if (titulo.includes('cotas') && (titulo.includes('emitidas') || titulo.includes('total'))) {
            num_cotas = parseValue(valor);
            if (dados.cotas_emitidas === N) dados.cotas_emitidas = valor;
            return;
        }

        // Mapeamento declarativo
        for (const [campo, matcher] of INDICATOR_MAP) {
            if (dados[campo] === N && matcher(titulo)) {
                dados[campo] = valor;
                return;
            }
        }
    };

    // --- Extração ---

    // Cards de cotação e indicadores
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

    // Células de indicadores
    $('.cell').each((_, el) => {
        const titulo  = $(el).find('.name').text().trim() || $(el).children('span').first().text().trim();
        const valorEl = $(el).find('.value span').first();
        const valor   = valorEl.length ? valorEl.text().trim() : $(el).find('.value').text().trim();
        processPair(titulo, valor, 'cell');
    });

    // Tabelas de indicadores
    $('table tbody tr').each((_, row) => {
        const cols = $(row).find('td');
        if (cols.length >= 2) {
            const indicatorAttr = $(cols[0]).find('[data-indicator]').attr('data-indicator');
            processPair($(cols[0]).text(), $(cols[1]).text(), 'table', indicatorAttr);
        }
    });

    // Estimativa de valor de mercado (fallback)
    if (dados.val_mercado === N || dados.val_mercado === '-') {
        let calc = 0;
        if (cotacao_atual > 0 && num_cotas > 0) {
            calc = cotacao_atual * num_cotas;
        } else if (dados.patrimonio_liquido !== N && dados.pvp !== N) {
            const pl  = parseExtendedValue(dados.patrimonio_liquido);
            const pvp = parseValue(dados.pvp);
            if (pl > 0 && pvp > 0) calc = pl * pvp;
        }
        if (calc > 0) {
            if (calc >= 1e9)      dados.val_mercado = `R$ ${(calc / 1e9).toFixed(2)} Bilhões`;
            else if (calc >= 1e6) dados.val_mercado = `R$ ${(calc / 1e6).toFixed(2)} Milhões`;
            else                  dados.val_mercado = formatCurrency(calc);
        }
    }

    // Imóveis do FII
    $('#properties-section .card-propertie').each((_, el) => {
        const nome = $(el).find('h3').text().trim();
        if (!nome) return;
        let estado = '';
        let abl = '';
        $(el).find('small').each((_, small) => {
            const t = $(small).text().trim();
            if (t.startsWith('Estado:'))              estado = t.replace('Estado:', '').trim();
            if (t.startsWith('Área bruta locável:'))  abl   = t.replace('Área bruta locável:', '').trim();
        });
        dados.imoveis.push({ nome, estado, abl });
    });

    // Texto "sobre"
    let sobreTexto = '';
    $('#about-section p, .profile-description p, #description p, .text-description p').each((_, el) => {
        sobreTexto += `${$(el).text().trim()} `;
    });

    if (!sobreTexto.trim()) {
        $('script[type="application/ld+json"]').each((_, el) => {
            try {
                const json = JSON.parse($(el).html() || '{}');
                const items = json['@graph'] || [json];
                items.forEach((item) => { if (item.articleBody) sobreTexto = item.articleBody; });
            } catch { /* JSON malformado — ignora */ }
        });
    }

    if (!sobreTexto.trim()) {
        sobreTexto = $('meta[name="description"]').attr('content') || '';
    }

    dados.sobre = sobreTexto.replace(/\s+/g, ' ').trim();

    // Comparação com peers
    dados.comparacao = [];
    const tickersVistos = new Set();

    // Tentativa 1: API interna do Investidor10
    const apiUrl = $('#table-compare-fiis').attr('data-url') || $('#table-compare-segments').attr('data-url');
    if (apiUrl) {
        try {
            const fullUrl = apiUrl.startsWith('http') ? apiUrl : `https://investidor10.com.br${apiUrl}`;
            const resApi = await fetchWithRetry(fullUrl);
            const arrayComparacao = resApi.data.data || resApi.data || [];

            if (Array.isArray(arrayComparacao)) {
                for (const item of arrayComparacao) {
                    const tickerAPI = (item.title || item.ticker || '').trim();
                    if (!tickerAPI || tickersVistos.has(tickerAPI)) continue;

                    const fmtBRL = (v) => {
                        const n = parseFloat(v);
                        if (isNaN(n)) return '-';
                        if (n >= 1e9) return `R$ ${(n / 1e9).toFixed(2).replace('.', ',')} B`;
                        if (n >= 1e6) return `R$ ${(n / 1e6).toFixed(2).replace('.', ',')} M`;
                        return `R$ ${n.toLocaleString('pt-BR')}`;
                    };

                    const fmtPct = (v) => {
                        if (v === null || v === undefined) return '-';
                        const s = String(v).replace('.', ',');
                        return s.includes('%') ? s : `${s}%`;
                    };

                    dados.comparacao.push({
                        ticker: tickerAPI,
                        nome: item.company_name || item.name || '',
                        dy: fmtPct(item.dividend_yield),
                        pvp: item.p_vp !== null && item.p_vp !== undefined ? String(item.p_vp).replace('.', ',') : '-',
                        patrimonio: fmtBRL(item.net_worth),
                        tipo: item.type || '-',
                        segmento: item.segment || '-',
                    });
                    tickersVistos.add(tickerAPI);
                }
            }
        } catch (err) {
            log.warn('API de comparação falhou, usando fallback HTML', { error: err.message });
        }
    }

    // Tentativa 2: HTML da tabela de comparação
    if (dados.comparacao.length === 0) {
        $('#table-compare-fiis, #table-compare-segments').each((_, table) => {
            let idxDy = -1, idxPvp = -1, idxPat = -1, idxSeg = -1, idxTipo = -1;
            $(table).find('thead th').each((idx, th) => {
                const txt = $(th).text().toLowerCase();
                if (txt.includes('dy') || txt.includes('dividend')) idxDy = idx;
                if (txt.includes('p/vp')) idxPvp = idx;
                if (txt.includes('patrim')) idxPat = idx;
                if (txt.includes('segmento')) idxSeg = idx;
                if (txt.includes('tipo')) idxTipo = idx;
            });

            $(table).find('tbody tr').each((_, el) => {
                const cols = $(el).find('td');
                if (cols.length < 3) return;
                const tk = $(cols[0]).text().replace(/\s+/g, ' ').trim();
                if (!tk || tickersVistos.has(tk)) return;

                const safeCol = (idx) => (idx !== -1 && cols.length > idx) ? $(cols[idx]).text().trim() : '-';
                dados.comparacao.push({
                    ticker: tk,
                    nome: $(cols[0]).find('a').attr('title') || '',
                    dy: safeCol(idxDy), pvp: safeCol(idxPvp),
                    patrimonio: safeCol(idxPat), segmento: safeCol(idxSeg), tipo: safeCol(idxTipo),
                });
                tickersVistos.add(tk);
            });
        });

        // Tentativa 3: Cards relacionados
        $('.card-related-fii').each((_, el) => {
            const tk = $(el).find('h2').text().trim();
            if (!tk || tickersVistos.has(tk)) return;
            const entry = { ticker: tk, nome: $(el).find('h3, span.name').first().text().trim(), dy: '-', pvp: '-', patrimonio: '-', segmento: '-', tipo: '-' };
            $(el).find('.card-footer p, .card-footer div').each((_, p) => {
                const text = $(p).text();
                if (text.includes('DY:'))         entry.dy         = text.replace('DY:', '').trim();
                if (text.includes('P/VP:'))        entry.pvp        = text.replace('P/VP:', '').trim();
                if (text.includes('Patrimônio:'))  entry.patrimonio = text.replace('Patrimônio:', '').trim();
                if (text.includes('Segmento:'))    entry.segmento   = text.replace('Segmento:', '').trim();
                if (text.includes('Tipo:'))        entry.tipo       = text.replace('Tipo:', '').trim();
            });
            dados.comparacao.push(entry);
            tickersVistos.add(tk);
        });
    }

    cacheSet(cacheKey, dados, CACHE_TTL_MS);
    return dados;
}

// ---------------------------------------------------------
// PARTE 2: PROVENTOS → STATUSINVEST
// ---------------------------------------------------------
async function scrapeAsset(rawTicker) {
    const ticker = sanitizeTicker(rawTicker);
    const cacheKey = `asset:${ticker}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const parseDateJSON = (dStr) => {
        if (!dStr || dStr.trim() === '' || dStr.trim() === '-') return null;
        const parts = dStr.split('/');
        if (parts.length !== 3) return null;
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
    };

    const labelTipo = (d) => {
        if (d.etd) {
            const txt = d.etd.toUpperCase();
            if (txt.includes('JURO'))      return 'JCP';
            if (txt.includes('DIVID'))     return 'DIV';
            if (txt.includes('TRIBUTADO')) return 'REND_TRIB';
        }
        if (d.et === 1) return 'DIV';
        if (d.et === 2) return 'JCP';
        return 'REND';
    };

    const fetchProvents = async (type) => {
        const url = `https://statusinvest.com.br/${type}/companytickerprovents?ticker=${ticker}&chartProventsType=2`;
        const { data } = await fetchWithRetry(url, {
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': 'https://statusinvest.com.br/',
                'User-Agent': 'Mozilla/5.0',
            },
        });
        return data.assetEarningsModels || [];
    };

    let earnings = [];
    const tipoInicial = isFii(ticker) ? 'fii' : 'acao';

    try {
        earnings = await fetchProvents(tipoInicial);
        // Se retornou vazio e era ação, tenta como FII (ex: BDRs com código 11)
        if (earnings.length === 0 && tipoInicial === 'acao') {
            earnings = await fetchProvents('fii').catch(() => []);
        }
    } catch (err) {
        log.error('Erro ao buscar proventos', { ticker, error: err.message });
        return [];
    }

    const dividendos = earnings
        .map((d) => ({
            dataCom:     parseDateJSON(d.ed),
            paymentDate: parseDateJSON(d.pd),
            value:       d.v,
            type:        labelTipo(d),
            rawType:     d.et,
        }))
        .filter((d) => d.paymentDate !== null)
        .sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));

    cacheSet(cacheKey, dividendos, CACHE_TTL_MS);
    return dividendos;
}

// ---------------------------------------------------------
// PARTE 3: IPCA → INVESTIDOR10
// ---------------------------------------------------------
async function scrapeIpca() {
    const cacheKey = 'ipca';
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const url = 'https://investidor10.com.br/indices/ipca/';
    const { data } = await fetchWithRetry(url);
    const $ = cheerio.load(data);

    const historico = [];
    let acumulado12m = '0,00';
    let acumuladoAno = '0,00';

    // Localiza a tabela relevante de forma robusta
    let $table = $('table').filter((_, el) => {
        const headers = $(el).find('thead').text().toLowerCase();
        return headers.includes('acumulado') || headers.includes('varia');
    }).first();

    $table.find('tbody tr').each((i, el) => {
        const cols = $(el).find('td');
        if (cols.length < 2) return;

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
                mes: dataRef,
                valor: parseFloat(valorStr.replace('.', '').replace(',', '.')),
                acumulado_12m: ac12mStr.replace('.', ','),
                acumulado_ano: acAnoStr.replace('.', ','),
            });
        }
    });

    const result = {
        historico: historico.reverse(), // cronológico crescente
        acumulado_12m: acumulado12m,
        acumulado_ano: acumuladoAno,
    };

    cacheSet(cacheKey, result, CACHE_TTL_IPCA_MS);
    return result;
}

// ---------------------------------------------------------
// PARTE 4: COTAÇÃO HISTÓRICA → YAHOO FINANCE
// ---------------------------------------------------------
const YAHOO_RANGE_MAP = {
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

function getYahooParams(rangeFilter) {
    return YAHOO_RANGE_MAP[rangeFilter] ?? { range: '1y', interval: '1d' };
}

async function fetchYahooFinance(ticker, rangeFilter = '1A') {
    const symbol = ticker.toUpperCase().endsWith('.SA') ? ticker.toUpperCase() : `${ticker.toUpperCase()}.SA`;
    const { range, interval } = getYahooParams(rangeFilter);
    const buildUrl = (host) =>
        `https://${host}.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}&includePrePost=false`;

    let data;
    try {
        ({ data } = await fetchWithRetry(buildUrl('query1'), { headers: { Accept: 'application/json' } }, 2));
    } catch {
        ({ data } = await fetchWithRetry(buildUrl('query2'), { headers: { Accept: 'application/json' } }, 2));
    }

    const result = data?.chart?.result?.[0];
    if (!result?.timestamp || !result?.indicators?.quote?.[0]?.close) return null;

    const { timestamp: timestamps, indicators: { quote: [quote] } } = result;
    const { close: prices, open: opens, high: highs, low: lows } = quote;

    return timestamps
        .map((t, i) => {
            if (prices[i] == null) return null;
            return {
                date:      new Date(t * 1000).toISOString(),
                timestamp: t * 1000,
                price:     prices[i],
                open:      opens[i]  ?? prices[i],
                high:      highs[i]  ?? prices[i],
                low:       lows[i]   ?? prices[i],
            };
        })
        .filter(Boolean);
}

async function scrapeCotacaoHistory(rawTicker, range = '1A') {
    const ticker = sanitizeTicker(rawTicker);
    const cacheKey = `cotacao:${ticker}:${range}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const points = await fetchYahooFinance(ticker.toLowerCase(), range);
    if (!points || points.length === 0) return { error: 'Dados não encontrados', points: [] };

    const result = { ticker, range, points };

    // Dados intraday têm TTL menor (5 min); histórico longo pode ser cacheado por mais tempo
    const isIntraday = range === '1D' || range === '5D';
    cacheSet(cacheKey, result, isIntraday ? CACHE_TTL_MS : CACHE_TTL_IPCA_MS);
    return result;
}

// ---------------------------------------------------------
// PARTE 5: INDICADORES FUNDAMENTALISTAS → INVESTIDOR10 (AÇÕES)
// ---------------------------------------------------------
async function scrapeIndicadores(rawTicker) {
    const ticker = sanitizeTicker(rawTicker);
    const cacheKey = `indicadores_${ticker.toUpperCase()}`;

    const cached = cacheGet(cacheKey);
    if (cached) {
        log.info('Cache hit: indicadores', { ticker });
        return cached;
    }

    const url = `https://investidor10.com.br/acoes/${ticker.toLowerCase()}/`;
    const res = await fetchWithRetry(url);
    if (res.status !== 200) throw new Error(`HTTP ${res.status} ao buscar indicadores de ${ticker}`);

    const $ = cheerio.load(res.data);
    
    // Objeto que vai guardar os indicadores categorizados exatos
    const secoes = {
        "Resumo": {},
        "Valuation": {},
        "Endividamento": {},
        "Eficiência": {},
        "Rentabilidade": {},
        "Crescimento": {}
    };

    // 1. Extração do Quadro Principal do Topo (Resumo)
    $('#table-indicators .cell').each((_, el) => {
        const nome = $(el).find('.desc span, .desc, .name').first().text().replace(/\s+/g, ' ').trim();
        const valor = $(el).find('.value span, .value').first().text().replace(/\s+/g, ' ').trim();
        
        if (nome && valor && valor !== '-' && valor !== '') {
            secoes["Resumo"][nome] = valor;
        }
    });

    // 2. Extração das Seções Detalhadas (Varredura inteligente)
    $('.panel, .card, section').each((_, el) => {
        // Busca o título do bloco atual na página
        const tituloRaw = $(el).find('h2, h3, .panel-title, .card-title, .card-header').first().text().trim();
        
        // Verifica se o título bate com uma das 5 categorias oficiais que definimos acima
        const categoriaEncontrada = Object.keys(secoes).find(cat => 
            tituloRaw.toLowerCase().includes(cat.toLowerCase())
        );
        
        if (categoriaEncontrada && categoriaEncontrada !== "Resumo") {
            // Se encontrou a categoria, varre os cards (.cell) lá de dentro
            $(el).find('.cell').each((_, cell) => {
                const nome = $(cell).find('.desc span, .desc, .name').first().text().replace(/\s+/g, ' ').trim();
                const valor = $(cell).find('.value span, .value').first().text().replace(/\s+/g, ' ').trim();
                
                if (nome && valor && valor !== '-' && valor !== '') {
                    // Evita duplicar se já pegamos esse indicador no "Resumo" do topo
                    if (!secoes["Resumo"][nome]) {
                        secoes[categoriaEncontrada][nome] = valor;
                    }
                }
            });
            
            // Varre também se por acaso estiver no formato de tabela normal (<tr> e <td>)
            $(el).find('table tbody tr').each((_, row) => {
                const cols = $(row).find('td');
                if (cols.length >= 2) {
                    const nome = $(cols[0]).text().replace(/\s+/g, ' ').trim();
                    const valor = $(cols[1]).text().replace(/\s+/g, ' ').trim();
                    
                    if (nome && valor && valor !== '-' && valor !== '') {
                        if (!secoes["Resumo"][nome]) {
                            secoes[categoriaEncontrada][nome] = valor;
                        }
                    }
                }
            });
        }
    });

    // Limpa categorias que ficaram vazias (caso a ação não tenha dados de "Crescimento", por exemplo)
    Object.keys(secoes).forEach(key => {
        if (Object.keys(secoes[key]).length === 0) {
            delete secoes[key];
        }
    });

    const result = { ticker, secoes };
    cacheSet(cacheKey, result, CACHE_TTL_MS);
    log.info('scrapeIndicadores concluído com seções oficiais', { ticker, secoesEncontradas: Object.keys(secoes) });
    return result;
}

// ---------------------------------------------------------
// VALIDAÇÃO DE PAYLOAD
// ---------------------------------------------------------
const VALID_MODES = new Set(['ipca', 'fundamentos', 'proventos_carteira', 'historico_portfolio', 'historico_12m', 'proximo_provento', 'cotacao_historica', 'indicadores']);

function validateBody(body) {
    if (!body || typeof body !== 'object') throw new Error('Payload inválido');
    if (!body.mode || !VALID_MODES.has(body.mode)) throw new Error(`Modo desconhecido: "${body.mode}"`);
    return body;
}

// ---------------------------------------------------------
// HANDLER (API MAIN)
// ---------------------------------------------------------
module.exports = async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST')   return res.status(405).json({ error: 'Método não permitido. Use POST.' });

    // Cache HTTP (CDN/edge)
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');

    let mode, payload;
    try {
        ({ mode, payload = {} } = validateBody(req.body));
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    try {
        if (mode === 'ipca') {
            return res.status(200).json({ json: await scrapeIpca() });
        }

        if (mode === 'fundamentos') {
            if (!payload.ticker) return res.status(400).json({ error: 'ticker obrigatório' });
            return res.status(200).json({ json: await scrapeFundamentos(payload.ticker) });
        }

        if (mode === 'proventos_carteira' || mode === 'historico_portfolio') {
            if (!Array.isArray(payload.fiiList) || payload.fiiList.length === 0) {
                return res.status(200).json({ json: [] });
            }
            const defaultLimit = mode === 'historico_portfolio' ? 14 : 12;
            const batches = chunkArray(payload.fiiList, BATCH_SIZE);
            const finalResults = [];

            for (const [batchIdx, batch] of batches.entries()) {
                const batchResults = await Promise.all(
                    batch.map(async (item) => {
                        const tk    = typeof item === 'string' ? item : item.ticker;
                        const limit = typeof item === 'string' ? defaultLimit : (item.limit ?? defaultLimit);
                        const history = await scrapeAsset(tk).catch((err) => {
                            log.warn('Erro ao buscar proventos de ativo', { ticker: tk, error: err.message });
                            return [];
                        });
                        const recents = history.filter((h) => h.paymentDate && h.value > 0).slice(0, limit);
                        return recents.length > 0 ? recents.map((r) => ({ symbol: tk.toUpperCase(), ...r })) : null;
                    })
                );
                finalResults.push(...batchResults);
                if (batchIdx < batches.length - 1) await sleep(BATCH_DELAY_MS);
            }

            return res.status(200).json({ json: finalResults.filter(Boolean).flat() });
        }

        if (mode === 'historico_12m') {
            if (!payload.ticker) return res.status(400).json({ error: 'ticker obrigatório' });
            return res.status(200).json({ json: await scrapeAsset(payload.ticker) });
        }

        if (mode === 'proximo_provento') {
            if (!payload.ticker) return res.status(400).json({ error: 'ticker obrigatório' });
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

        if (mode === 'cotacao_historica') {
            if (!payload.ticker) return res.status(400).json({ error: 'ticker obrigatório' });
            const range = payload.range || '1D';
            return res.status(200).json({ json: await scrapeCotacaoHistory(payload.ticker, range) });
        }

        if (mode === 'indicadores') {
            if (!payload.ticker) return res.status(400).json({ error: 'ticker obrigatório' });
            return res.status(200).json({ json: await scrapeIndicadores(payload.ticker) });
        }

        // Não deve chegar aqui (validateBody já filtra), mas por segurança:
        return res.status(400).json({ error: 'Modo desconhecido' });

    } catch (error) {
        log.error('Erro no handler', { mode, error: error.message, stack: error.stack });
        return res.status(500).json({ error: error.message || 'Erro interno' });
    }
};
