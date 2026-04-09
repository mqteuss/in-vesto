/**
 * Scraper API — Consumidor otimizado do AeroScrape v2.
 * 
 * Otimizações aplicadas:
 * - Multi-selector: scrapeFundamentos faz 1 HTTP call (era 9)
 * - Timeout + AbortController no helper aeroScrape
 * - Removed dead code (require('https'))
 * - Cleaned up fetchWithRetry
 */

// ─── ScraperCache — Cache JSON final em memória do serverless ─────────────────
// Quando a função Vercel está quente, requests subsequentes pegam o JSON
// em ~0ms sem chamar AeroScrape. Compartilhado entre TODOS os devices.

class ScraperCache {
    constructor(maxEntries = 200) {
        this.cache = new Map();
        this.maxEntries = maxEntries;
    }

    get(key) {
        const entry = this.cache.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return null;
        }
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.data;
    }

    set(key, data, ttlMs) {
        if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) return;
        if (this.cache.size >= this.maxEntries) {
            const oldest = this.cache.keys().next().value;
            this.cache.delete(oldest);
        }
        this.cache.set(key, { data, expiresAt: Date.now() + ttlMs });
    }

    clear() { this.cache.clear(); }
    get size() { return this.cache.size; }
}

const SCRAPER_CACHE_TTL = {
    fundamentos:       1000 * 60 * 60 * 4,
    rankings:          1000 * 60 * 15,
    indices:           1000 * 60 * 60,
    ipca:              1000 * 60 * 60 * 24,
    proximo_provento:  1000 * 60 * 60 * 2,
    cotacao_historica: 1000 * 60 * 5,
    historico_12m:     1000 * 60 * 60 * 2,
};

const scraperCache = new ScraperCache(200);

// ─── AeroScrape Helper (com timeout) ─────────────────────────────────────────

const AEROSCRAPE_URL = 'https://aero-scrape.vercel.app/api/scrape';

async function aeroScrape(url, payloadOpts = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const res = await fetch(AEROSCRAPE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, ...payloadOpts }),
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`AeroScrape HTTP ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(timeout);
    }
}

// ─── Fetch JSON Helper (para APIs que retornam JSON puro) ────────────────────

async function fetchWithRetry(url, options = {}, retries = 3, baseBackoff = 1000) {
    if (!options.headers) {
        options.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Referer': 'https://investidor10.com.br/'
        };
    }

    for (let i = 0; i < retries; i++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        try {
            const res = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeout);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return { data };
        } catch (err) {
            clearTimeout(timeout);
            const msg = err.name === 'AbortError' ? `Timeout 10s` : err.message;
            if (i === retries - 1 || (err.message && err.message.includes('404'))) throw new Error(msg);
            const delay = baseBackoff * Math.pow(2, i);
            console.log(`[RETRY] Tentativa ${i + 1} falhou para ${url}: ${msg}. Retentando em ${delay}ms...`);
            await new Promise(res => setTimeout(res, delay));
        }
    }
}

// ─── Constantes ──────────────────────────────────────────────────────────────

const KNOWN_UNITS = new Set([
    'BPAC11', 'BIDI11', 'ENGI11', 'TAEE11', 'KLBN11', 'SANB11', 'ALUP11', 'BBAS11',
    'MODL11', 'BRBI11', 'SULA11', 'SAPR11', 'IGTI11', 'CPLE11', 'ABEV11', 'PETR11',
    'ITUB11', 'BBDC11', 'VALE11', 'AMER11', 'MGLU11', 'VIIA11', 'WEGE11', 'EMBR11',
    'SUZB11', 'ELET11', 'CSNA11', 'GGBR11', 'GOAU11', 'USIM11', 'CSAN11', 'RRRP11',
    'PRIO11', 'ENAT11', 'VBBR11', 'UGPA11', 'BBSE11', 'CXSE11', 'PSSA11', 'IRBR11',
    'MULT11', 'CYRE11', 'LREN11', 'SBFG11', 'ASAI11', 'CRFB11', 'NTCO11', 'CASH11',
    'TOTS11', 'LWSA11', 'AERI11', 'INTB11', 'VIVT11', 'TIMS11', 'EQTL11', 'NEOE11',
    'HYPE11', 'RDOR11', 'RADL11', 'FLRY11', 'MDIA11', 'SMTO11', 'JBSS11', 'MRFG11',
    'BEEF11', 'BRFS11', 'CMIN11', 'CBAV11', 'FESA11', 'POMO11', 'RANI11',
    'SLCE11', 'AGRO11', 'TTEN11', 'HBSA11', 'YDUQ11', 'COGN11', 'SEER11', 'ANIM11',
    'CVCB11', 'GOLL11', 'AZUL11', 'RAIL11', 'STBP11', 'CCRO11', 'ECOR11', 'JSLG11',
    'SIMH11', 'RENT11', 'AMAR11', 'ARZZ11', 'CEAB11', 'SGPS11', 'VAMO11', 'VIVA11',
    'VULC11', 'ALPA11', 'DXCO11', 'LEVE11', 'MYPK11', 'RCSL11', 'TUPY11', 'WIZC11',
    'AESB11'
]);
const guessType = (ticker) => {
    const t = ticker.toUpperCase();
    if (KNOWN_UNITS.has(t)) return 'acao';
    if (t.endsWith('11') || t.endsWith('12')) return 'fii';
    return 'acao';
};
const TICKER_REGEX = /^[A-Z]{4}\d{1,2}[A-Z]?$/;
const ALLOWED_MODES = new Set([
    'rankings',
    'indices',
    'ipca',
    'fundamentos',
    'proventos_carteira',
    'historico_portfolio',
    'historico_12m',
    'proximo_provento',
    'cotacao_historica'
]);
const ALLOWED_RANGES = new Set(['1D', '5D', '1M', '6M', 'YTD', '1Y', '1A', '5Y', '5A', 'Tudo', 'MAX']);
const DEFAULT_ALLOWED_ORIGIN = 'https://appvesto.vercel.app';
const MAX_FII_LIST_SIZE = 200;
const MAX_HISTORY_LIMIT = 120;
const FII_BATCH_SIZE = 5;

function sanitizeTickerInput(rawTicker) {
    if (typeof rawTicker !== 'string') return '';
    let ticker = rawTicker.trim().toUpperCase();
    if (ticker.endsWith('.SA')) ticker = ticker.slice(0, -3);
    if (ticker.endsWith('F')) ticker = ticker.slice(0, -1);
    return TICKER_REGEX.test(ticker) ? ticker : '';
}

function sanitizeRangeInput(rawRange) {
    if (typeof rawRange !== 'string') return '1D';
    const trimmed = rawRange.trim();
    if (!trimmed) return '1D';

    const upper = trimmed.toUpperCase();
    if (upper === 'TUDO') return 'Tudo';
    if (ALLOWED_RANGES.has(upper)) return upper;
    if (ALLOWED_RANGES.has(trimmed)) return trimmed;
    return '1D';
}

function sanitizePositiveLimit(rawLimit, fallback, max = MAX_HISTORY_LIMIT) {
    const parsed = Number.parseInt(rawLimit, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, max);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const REGEX_CLEAN_NUMBER = /[^0-9,-]+/g;
const REGEX_NORMALIZE = /[\u0300-\u036f]/g;

function parseValue(valueStr) {
    if (!valueStr) return 0;
    if (typeof valueStr === 'number') return valueStr;
    try {
        return parseFloat(valueStr.replace(REGEX_CLEAN_NUMBER, "").replace(',', '.')) || 0;
    } catch (e) { return 0; }
}

function normalize(str) {
    if (!str) return '';
    return str.normalize("NFD").replace(REGEX_NORMALIZE, "").toLowerCase().trim();
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
    if (lower.includes('bilh')) return val * 1000000000;
    if (lower.includes('milh')) return val * 1000000;
    if (lower.includes('mil')) return val * 1000;
    return val;
}

function formatCurrency(value) {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatNumberBR(value, decimals = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'N/A';
    return n.toLocaleString('pt-BR', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}


function cleanDoubledString(str) {
    if (!str) return "";
    const parts = str.split('R$');
    if (parts.length > 2) return 'R$' + parts[1].trim();
    return str;
}

function decodeHtmlEntities(str) {
    if (!str) return '';
    return String(str)
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>');
}

function stripHtmlToText(htmlChunk) {
    if (!htmlChunk) return '';
    return decodeHtmlEntities(
        String(htmlChunk)
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
    ).trim();
}

function inferChecklistStatus(rawHtml) {
    const chunk = String(rawHtml || '').toLowerCase();
    if (!chunk) return null;

    if (/type=["']checkbox["'][^>]*checked|checked[^>]*type=["']checkbox["']/.test(chunk)) return true;
    if (/type=["']checkbox["']/.test(chunk)) return false;

    if (/\b(is-checked|checked-item|fa-check|fa-square-check|bi-check|bi-check-square|mdi-check|mdi-checkbox-marked|ri-check|icon-check|icon-ok)\b/.test(chunk)) return true;
    if (/\b(is-unchecked|unchecked-item|fa-times|fa-xmark|fa-square|bi-x|bi-square|mdi-close|mdi-checkbox-blank-outline|ri-close|icon-close)\b/.test(chunk)) return false;

    if (/&#10003;|✓/.test(chunk)) return true;
    if (/&#10007;|✗|✕/.test(chunk)) return false;

    return null;
}

function formatIndicatorHistoryValue(rawValue, rawType) {
    const n = Number(rawValue);
    if (!Number.isFinite(n)) {
        return stripHtmlToText(String(rawValue || '-')) || '-';
    }

    const type = String(rawType || '').toLowerCase();
    const formatDecimal = (value, decimals = 2) =>
        value.toLocaleString('pt-BR', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });

    const abbreviate = (value, decimals = 2, withSpace = true) => {
        const abs = Math.abs(value);
        if (abs >= 1e9) return `${formatDecimal(value / 1e9, decimals)}${withSpace ? ' ' : ''}B`;
        if (abs >= 1e6) return `${formatDecimal(value / 1e6, decimals)}${withSpace ? ' ' : ''}M`;
        if (abs >= 1e3) return `${formatDecimal(value / 1e3, decimals)}${withSpace ? ' ' : ''}K`;
        return formatDecimal(value, 0);
    };

    if (type === 'money_abbr') return `R$ ${abbreviate(n, 2, true)}`;
    if (type === 'number_abbr') return abbreviate(n, 0, false);
    if (type === 'money') return `R$ ${formatDecimal(n, 2)}`;
    if (type === 'percent') return `${formatDecimal(n, 2)}%`;
    if (type === 'decimal') return formatDecimal(n, 2);
    if (type === 'number') return formatDecimal(n, 0);
    return formatDecimal(n, 2);
}

function extractFiiIdFromHtml(html) {
    const source = String(html || '');
    const patterns = [
        /\/api\/fii\/comparador\/table\/(\d+)\//i,
        /\/api\/fii\/historico-indicadores\/(\d+)\//i
    ];

    for (const pattern of patterns) {
        const match = source.match(pattern);
        if (match && match[1]) return match[1];
    }
    return null;
}

async function fetchFiiHistoricalIndicatorsApi(fiiId) {
    if (!fiiId) return null;

    const endpoint = `https://investidor10.com.br/api/fii/historico-indicadores/${fiiId}/10`;
    const { data } = await fetchWithRetry(endpoint, {
        headers: {
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': 'https://investidor10.com.br/'
        }
    });

    if (!data || typeof data !== 'object') return null;

    const entries = Object.entries(data).filter(([, values]) => Array.isArray(values) && values.length > 0);
    if (entries.length === 0) return null;

    const firstValues = entries[0][1];
    const orderedYears = firstValues
        .map(item => String(item?.year || '').trim())
        .filter(Boolean);
    const uniqueYears = [];
    const seenYears = new Set();
    for (const yearLabel of orderedYears) {
        if (!seenYears.has(yearLabel)) {
            uniqueYears.push(yearLabel);
            seenYears.add(yearLabel);
        }
    }

    const colunas = uniqueYears.length > 0 ? uniqueYears : ['Atual'];
    const linhas = [];

    for (const [indicador, values] of entries) {
        const byYear = new Map();
        for (const item of values) {
            const yearLabel = String(item?.year || '').trim();
            if (!yearLabel) continue;
            byYear.set(yearLabel, item);
        }

        const valores = {};
        for (const col of colunas) {
            const item = byYear.get(col);
            if (!item) {
                valores[col] = '-';
                continue;
            }
            valores[col] = formatIndicatorHistoryValue(item.value, item.type);
        }

        linhas.push({
            indicador,
            valores
        });
    }

    return linhas.length > 0 ? { colunas, linhas } : null;
}

function extractFiiHistoricalIndicators(html) {
    const tables = String(html || '').match(/<table[^>]*>[\s\S]*?<\/table>/gi) || [];
    const metricHints = [
        'valor de mercado',
        'p/vp',
        'dividend yield',
        'liquidez diaria',
        'valor patrimonial',
        'vacancia',
        'numero de cotistas',
        'cotas emitidas'
    ];

    for (const tableHtml of tables) {
        const tableNorm = normalize(stripHtmlToText(tableHtml));
        if (!tableNorm.includes('atual')) continue;
        if (!metricHints.some(h => tableNorm.includes(normalize(h)))) continue;

        const thBlocks = tableHtml.match(/<th[^>]*>[\s\S]*?<\/th>/gi) || [];
        const headerCandidates = thBlocks
            .map(th => stripHtmlToText(th))
            .filter(Boolean);

        const yearOrCurrent = headerCandidates.filter(h => {
            const hn = normalize(h);
            return hn === 'atual' || /^(19|20)\d{2}$/.test(hn);
        });
        if (yearOrCurrent.length < 2) continue;

        const rowBlocks = tableHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
        const rows = [];
        const seen = new Set();

        for (const rowHtml of rowBlocks) {
            const cellBlocks = rowHtml.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [];
            if (cellBlocks.length < 2) continue;

            const cleanedCells = cellBlocks
                .map(cell => stripHtmlToText(cell))
                .filter(text => text.length > 0);
            if (cleanedCells.length < 2) continue;

            const indicador = cleanedCells[0];
            const indicadorNorm = normalize(indicador);
            if (!indicadorNorm || indicadorNorm === 'atual' || /^(19|20)\d{2}$/.test(indicadorNorm)) continue;
            if (seen.has(indicadorNorm)) continue;

            const values = cleanedCells.slice(1);
            if (values.length === 0) continue;

            const valueMap = {};
            const maxCols = Math.min(yearOrCurrent.length, values.length);
            for (let i = 0; i < maxCols; i++) {
                valueMap[yearOrCurrent[i]] = values[i];
            }
            if (Object.keys(valueMap).length === 0) continue;

            rows.push({ indicador, valores: valueMap });
            seen.add(indicadorNorm);
        }

        if (rows.length >= 3) {
            return { colunas: yearOrCurrent, linhas: rows };
        }
    }

    return null;
}

function extractFiiBuyAndHoldChecklist(html) {
    const fullHtml = String(html || '');
    const heading = /CHECKLIST\s+DO\s+INVESTIDOR\s+BUY\s+AND\s+HOLD/i;
    const startMatch = fullHtml.match(heading);
    if (!startMatch || startMatch.index === undefined) return [];

    const from = startMatch.index;
    const block = fullHtml.slice(from, from + 18000);

    const fragments = [];
    const liBlocks = block.match(/<li[^>]*>[\s\S]*?<\/li>/gi) || [];
    const rowBlocks = block.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
    const divBlocks = block.match(/<div[^>]*class=["'][^"']*(item|check|checklist|criter|criteria)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi) || [];
    const pBlocks = block.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [];

    fragments.push(...liBlocks, ...rowBlocks, ...divBlocks, ...pBlocks);
    if (fragments.length === 0) return [];

    const hints = [
        'anos listado',
        'liquidez',
        'patrimonio',
        'vacancia',
        'dividend yield',
        'cotistas',
        'imoveis',
        'portfolio',
        'portifolio',
        'portfólio'
    ];

    const results = [];
    const seen = new Set();

    for (const fragment of fragments) {
        const text = stripHtmlToText(fragment);
        if (!text || text.length < 12 || text.length > 220) continue;

        const n = normalize(text);
        if (!hints.some(h => n.includes(normalize(h)))) continue;
        if (seen.has(n)) continue;

        results.push({
            criterio: text,
            aprovado: inferChecklistStatus(fragment)
        });
        seen.add(n);
    }

    return results;
}

// ─── Multi-selectors para Investidor10 (pré-definidos) ───────────────────────

const FUNDAMENTOS_SELECTORS = {
    cards: { selector: '._card-header, ._card-body' },
    cells_titles: { selector: '.cell span.d-flex, .cell span.title' },
    cells_values: { selector: '.cell .value' },
    table: { selector: 'table tbody tr td' },
    about: { selector: '.description-text, .content--description, .description p, .link-card--description, .text-description p' },
    logo: { selector: '.header-company img, #header-container img, .logo img, .img-logo', extract: 'src' },
    compareUrl: { selector: '#table-compare-tickers, #table-compare-segments, #table-compare-fiis, [data-url*="comparador"]', extract: 'data-url' },
    props: { selector: 'div.card-propertie h3, div.card-property h3' },
    propsSmall: { selector: 'div.card-propertie small, div.card-property small' }
};

// ─── PARTE 1: FUNDAMENTOS → INVESTIDOR10 ─────────────────────────────────────
// Otimizado: 1 HTTP call via multi-selector (era 9 calls)

async function scrapeFundamentos(ticker) {
    try {
        let html, results;
        const guess = guessType(ticker);
        let tipoAtivo = guess;
        const urlFii = `https://investidor10.com.br/fiis/${ticker.toLowerCase()}/`;
        const urlAcao = `https://investidor10.com.br/acoes/${ticker.toLowerCase()}/`;

        const primaryUrl = guess === 'fii' ? urlFii : urlAcao;
        const fallbackUrl = guess === 'fii' ? urlAcao : urlFii;
        let urlToUse = primaryUrl;

        // ── 1 ÚNICO HTTP call: HTML + todos os seletores ──
        try {
            const res = await aeroScrape(primaryUrl, {
                returnHtml: true,
                includeScripts: true,
                selectors: FUNDAMENTOS_SELECTORS
            });
            if (!res.html) throw new Error('Sem html');
            html = res.html;
            results = res.results || {};
            tipoAtivo = guess;
        } catch (e) {
            try {
                const res = await aeroScrape(fallbackUrl, {
                    returnHtml: true,
                    includeScripts: true,
                    selectors: FUNDAMENTOS_SELECTORS
                });
                if (!res.html) throw new Error('Sem html');
                html = res.html;
                results = res.results || {};
                tipoAtivo = guess === 'fii' ? 'acao' : 'fii';
                urlToUse = fallbackUrl;
            } catch (e2) {
                throw new Error('Ativo não encontrado no Investidor10');
            }
        }

        if (!html.includes('cotacao') && !html.includes('Cotação')) throw new Error('Página inválida');

        let dados = {
            dy: 'N/A', pvp: 'N/A', pl: 'N/A', roe: 'N/A', roa: 'N/A', roic: 'N/A', lpa: 'N/A', vp_cota: 'N/A',
            val_mercado: 'N/A', liquidez: 'N/A', liq_corrente: 'N/A', variacao_12m: 'N/A', ultimo_rendimento: 'N/A',
            segmento: 'N/A', tipo_fundo: 'N/A', mandato: 'N/A', vacancia: 'N/A',
            patrimonio_liquido: 'N/A', cnpj: 'N/A',
            num_cotistas: 'N/A', tipo_gestao: 'N/A', prazo_duracao: 'N/A',
            taxa_adm: 'N/A', cotas_emitidas: 'N/A', publico_alvo: 'N/A',
            margem_liquida: 'N/A', margem_bruta: 'N/A', margem_ebit: 'N/A',
            divida_liquida_ebitda: 'N/A', divida_liquida_pl: 'N/A', ev_ebitda: 'N/A',
            payout: 'N/A', cagr_receita_5a: 'N/A', cagr_lucros_5a: 'N/A',
            imoveis: [],
            sobre: '',
            comparacao: [],
            logo_url: '',
            historico_indicadores: null,
            checklist_buy_hold: []
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

            if (indicatorAttr) {
                const ind = indicatorAttr.toUpperCase();
                if (ind === 'DIVIDA_LIQUIDA_EBITDA') { dados.divida_liquida_ebitda = valor; return; }
                if (ind === 'DY') { dados.dy = valor; return; }
                if (ind === 'P_L') { dados.pl = valor; return; }
                if (ind === 'P_VP') { dados.pvp = valor; return; }
                if (ind === 'ROE') { dados.roe = valor; return; }
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

            if (dados.pl === 'N/A' && (titulo === 'p/l' || titulo.includes('p/l'))) dados.pl = valor;
            if (dados.roe === 'N/A' && titulo.replace(/\./g, '') === 'roe') dados.roe = valor;
            if (dados.roa === 'N/A' && titulo.replace(/\./g, '') === 'roa') dados.roa = valor;
            if (dados.roic === 'N/A' && titulo.replace(/\./g, '') === 'roic') dados.roic = valor;
            if (dados.liq_corrente === 'N/A' && (titulo.includes('liq. corrente') || titulo.includes('liq corrente') || titulo.includes('liquidez corrente'))) dados.liq_corrente = valor;
            if (dados.lpa === 'N/A' && titulo.replace(/\./g, '') === 'lpa') dados.lpa = valor;

            if (titulo.includes('margem liquida')) dados.margem_liquida = valor;
            if (titulo.includes('margem bruta')) dados.margem_bruta = valor;
            if (titulo.includes('margem ebit')) dados.margem_ebit = valor;
            if (titulo.includes('payout')) dados.payout = valor;

            if (titulo.includes('ev/ebitda')) dados.ev_ebitda = valor;
            const tClean = titulo.replace(/[\s\/\.\-]/g, '');
            if (dados.divida_liquida_ebitda === 'N/A') {
                if (tClean.includes('div') && tClean.includes('liq') && tClean.includes('ebitda')) dados.divida_liquida_ebitda = valor;
            }
            if (tClean.includes('div') && tClean.includes('liq') && tClean.includes('patrim')) dados.divida_liquida_pl = valor;

            if (titulo.includes('cagr') && titulo.includes('receita')) dados.cagr_receita_5a = valor;
            if (titulo.includes('cagr') && titulo.includes('lucro')) dados.cagr_lucros_5a = valor;

            if (dados.vp_cota === 'N/A') {
                if (titulo === 'vpa' || titulo.replace(/\./g, '') === 'vpa' || titulo.includes('vp por cota')) dados.vp_cota = valor;
            }
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

        // ── Processar resultados do multi-selector (tudo local, zero HTTP) ──

        const cards = results.cards || [];
        for (let i = 0; i < cards.length; i += 2) {
            const titulo = cards[i] || '';
            const valor = cards[i + 1] || '';
            processPair(titulo, valor, 'card');
            if (normalize(titulo).includes('cotacao')) cotacao_atual = parseValue(valor);
        }

        if (cotacao_atual === 0) {
            const cotacaoMatch = html.match(/<span[^>]*>([\d.,]+)<\/span>/i);
            if (cotacaoMatch) cotacao_atual = parseValue(cotacaoMatch[1]);
        }

        const cellsTitles = results.cells_titles || [];
        const cellsValues = results.cells_values || [];
        for (let i = 0; i < cellsTitles.length; i++) {
            // No novo HTML, os titulos vem com tags ou sujidade, vamos limpar
            let title = typeof cellsTitles[i] === 'string' ? cellsTitles[i].replace(/<[^>]+>/g, '').trim() : '';
            processPair(title, cellsValues[i] || '', 'cell');
        }

        const tableTds = results.table || [];
        for (let i = 0; i < tableTds.length; i += 2) {
            processPair(tableTds[i] || '', tableTds[i + 1] || '', 'table', null);
        }

        // Fallback robusto direto no HTML se não houver 'results' (API antiga não suportava selectors)
        if (!results.cards && (dados.dy === 'N/A' || dados.pvp === 'N/A')) {
            // Extrair cards antigos direto do HTML
            const cardHeaders = html.match(/class="[^"]*_card-header[^"]*"[^>]*>([^<]+)/gi);
            const cardBodies = html.match(/class="[^"]*_card-body[^"]*"[^>]*>([\s\S]*?)<\/div>/gi);
            if (cardHeaders && cardBodies) {
                for (let i = 0; i < cardHeaders.length; i++) {
                    const title = cardHeaders[i].replace(/<[^>]+>/g, '').trim();
                    const valMatch = (cardBodies[i] || '').match(/>([^<]+)<\/span>/);
                    if (title && valMatch) processPair(title, valMatch[1], 'card');
                }
            }
            
            // Extrair cells antigos direto do HTML
            const cellDivs = html.match(/<div[^>]*class="[^"]*cell[^"]*"[^>]*>([\s\S]+?)<\/div>(?=\s*<div|\s*<\/div>)/gi) || [];
            cellDivs.forEach(cellHtml => {
                let title = '';
                const titleMatch = cellHtml.match(/<span[^>]*d-flex[^>]*>\s*([\w\/\s\(\)\.%:-]+)\s*<i/);
                const titleMatch2 = cellHtml.match(/<span[^>]*title[^>]*>([^<]+)<\/span>/);
                if (titleMatch) title = titleMatch[1].trim();
                else if (titleMatch2) title = titleMatch2[1].trim();
                
                let value = '';
                // Novo Investidor10 coloca span dentro de value, ou usa simple-value
                const valMatch = cellHtml.match(/<div[^>]*value[^>]*>[\s\S]*?<span>([\s\S]+?)<\/span>/);
                const valMatch2 = cellHtml.match(/<div[^>]*simple-value[^>]*>([\s\S]+?)<\/div>/);
                if (valMatch) value = valMatch[1].replace(/<[^>]+>/g, '').trim();
                else if (valMatch2) value = valMatch2[1].replace(/<[^>]+>/g, '').trim();
                
                if (title && value) processPair(title, value, 'cell');
            });
        }

        if (dados.val_mercado === 'N/A' || dados.val_mercado === '-') {
            let mercadoCalc = 0;
            if (cotacao_atual > 0 && num_cotas > 0) mercadoCalc = cotacao_atual * num_cotas;
            else if (dados.patrimonio_liquido !== 'N/A' && dados.pvp !== 'N/A') {
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

        // Imóveis do FII (via multi-selector results.props / results.propsSmall)
        const propNames = results.props || [];
        const propSmalls = results.propsSmall || [];
        if (propNames.length > 0) {
            let smallIdx = 0;
            propNames.forEach(nome => {
                if (!nome) return;
                let estado = '', abl = '';
                for (let s = 0; s < 2 && smallIdx < propSmalls.length; s++, smallIdx++) {
                    const t = propSmalls[smallIdx] || '';
                    if (t.includes('Estado:')) estado = t.replace('Estado:', '').trim();
                    if (t.includes('Área bruta locável:')) abl = t.replace('Área bruta locável:', '').trim();
                }
                dados.imoveis.push({ nome: nome.trim(), estado, abl });
            });
        }

        // Logo (via multi-selector results.logo — já extraiu 'src')
        const logos = results.logo || [];
        if (logos.length > 0) {
            dados.logo_url = logos[0];
            if (dados.logo_url && dados.logo_url.startsWith('/')) {
                dados.logo_url = 'https://investidor10.com.br' + dados.logo_url;
            }
        }

        // Sobre (via multi-selector results.about)
        // Filtra itens curtos, notícias ("Publicado em") e lixo de navegação
        const aboutRaw = (results.about || []).filter(item => {
            if (!item || item.length < 30) return false;
            if (item.includes('Publicado em')) return false;
            if (item.includes('Saiba mais') && item.length < 80) return false;
            if (item.includes('ADICIONAR NA CARTEIRA')) return false;
            return true;
        });
        let sobreTexto = aboutRaw.join('\n\n');

        if (!sobreTexto.trim()) {
            const scriptJsonMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
            if (scriptJsonMatch) {
                try {
                    const json = JSON.parse(scriptJsonMatch[1]);
                    const items = json['@graph'] ? json['@graph'] : [json];
                    items.forEach(item => {
                        if (item.articleBody) sobreTexto = item.articleBody;
                    });
                } catch (e) { }
            }
        }

        if (!sobreTexto.trim()) {
            const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
            if (metaDescMatch) sobreTexto = metaDescMatch[1];
        }

        dados.sobre = sobreTexto.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

        if (tipoAtivo === 'fii') {
            const fiiId = extractFiiIdFromHtml(html);
            if (fiiId) {
                try {
                    dados.historico_indicadores = await fetchFiiHistoricalIndicatorsApi(fiiId);
                } catch (e) {
                    console.warn('Falha ao buscar histórico de indicadores via API:', e.message);
                }
            }
            if (!dados.historico_indicadores) {
                dados.historico_indicadores = extractFiiHistoricalIndicators(html);
            }
            dados.checklist_buy_hold = extractFiiBuyAndHoldChecklist(html);
        }

        // Rentabilidade Chart (regex no HTML bruto)
        let rentabilidadeChart = null;
        try {
            const chartMatch = html.match(/'lastProfitability':\s*JSON\.parse\(`([^`]+)`\)/);
            if (chartMatch && chartMatch[1]) {
                const lastProf = JSON.parse(chartMatch[1]);

                const regexProf = /'profitabilities':\s*JSON\.parse\(`([^`]+)`\)/g;
                const regexLegend = /'legend':\s*JSON\.parse\(`([^`]+)`\)/g;
                let profitabilities = [];
                let legend = [];
                let maxLen = 0;

                const allLegends = [];
                let matchL;
                while ((matchL = regexLegend.exec(html)) !== null) {
                    try { allLegends.push(JSON.parse(matchL[1])); } catch (e) { allLegends.push([]); }
                }

                let profIdx = 0;
                let matchProf;
                while ((matchProf = regexProf.exec(html)) !== null) {
                    try {
                        const profArray = JSON.parse(matchProf[1]);
                        if (profArray && profArray.length > 0 && profArray[0].length > maxLen) {
                            maxLen = profArray[0].length;
                            profitabilities = profArray;
                            if (allLegends[profIdx] && allLegends[profIdx].length === profArray.length) {
                                legend = allLegends[profIdx];
                            } else {
                                const matching = allLegends.find(l => l.length === profArray.length);
                                legend = matching || allLegends[profIdx] || [];
                            }
                        }
                    } catch (err) { }
                    profIdx++;
                }

                if (Object.keys(lastProf).length > 0) {
                    rentabilidadeChart = { lastProfitability: lastProf, legend, profitabilities };
                }
            }
        } catch (e) {
            console.error('Erro ao extrair chart de rentabilidade:', e.message);
        }
        dados.rentabilidade_chart = rentabilidadeChart;

        // Indicadores Avançados e Receitas (Ações)
        let advancedMetrics = null;
        let revenueGeography = null;
        let revenueSegment = null;
        try {
            // Investidor10 alterou a variável de sectorIndicators para _sectorIndicators
            const sectorMatch = html.match(/_sectorIndicators\s*=\s*(\{.*?\});/);
            if (sectorMatch && sectorMatch[1]) advancedMetrics = JSON.parse(sectorMatch[1]);

            const revGeoMatch = html.match(/let\s+companyRevenuesChartPie\s*=\s*(\{.*?\});/);
            if (revGeoMatch && revGeoMatch[1]) revenueGeography = JSON.parse(revGeoMatch[1]);

            const revSegMatch = html.match(/let\s+companyBussinesRevenuesChartPie\s*=\s*(\{.*?\});/);
            if (revSegMatch && revSegMatch[1]) revenueSegment = JSON.parse(revSegMatch[1]);
        } catch (e) {
            console.error('Erro ao extrair métricas avançadas:', e.message);
        }

        if (advancedMetrics) dados.advanced_metrics = advancedMetrics;
        if (revenueGeography) dados.revenue_geography = revenueGeography;
        if (revenueSegment) dados.revenue_segment = revenueSegment;

        // ── Chart APIs + Comparação (lançadas em PARALELO) ──
        let companyId = null;
        let tickerId = null;
        try {
            const companyMatch = html.match(/\/api\/balancos\/receitaliquida\/chart\/(\d+)\//);
            if (companyMatch) companyId = companyMatch[1];
            const tickerMatch = html.match(/tickerId\s*=\s*'(\d+)'/);
            if (tickerMatch) tickerId = tickerMatch[1];
        } catch (e) { }

        let chartPromise = Promise.resolve(null);
        if (companyId && tipoAtivo === 'acao') {
            const baseUrl = 'https://investidor10.com.br';
            const chartRequests = [
                fetchWithRetry(`${baseUrl}/api/balancos/receitaliquida/chart/${companyId}/3650/false/`)
                    .then(r => ({ tipo: 'receitas_lucros', data: r.data })).catch(() => null),
                fetchWithRetry(`${baseUrl}/api/cotacao-lucro/${ticker.toLowerCase()}/adjusted/`)
                    .then(r => ({ tipo: 'lucro_cotacao', data: r.data })).catch(() => null),
                fetchWithRetry(`${baseUrl}/api/balancos/ativospassivos/chart/${companyId}/3650/`)
                    .then(r => ({ tipo: 'evolucao_patrimonio', data: r.data })).catch(() => null),
            ];
            if (tickerId) {
                chartRequests.push(
                    fetchWithRetry(`${baseUrl}/api/acoes/payout-chart/${companyId}/${tickerId}/${ticker.toUpperCase()}/3650`)
                        .then(r => ({ tipo: 'payout', data: r.data })).catch(() => null)
                );
            }
            chartPromise = Promise.all(chartRequests);
        }

        // Comparação via API (data-url já extraído pelo multi-selector)
        const compareUrls = results.compareUrl || [];
        const apiUrl = compareUrls.length > 0 ? compareUrls[0] : null;
        let comparacaoApiPromise = Promise.resolve(null);
        if (apiUrl) {
            const fullUrl = apiUrl.startsWith('http') ? apiUrl : `https://investidor10.com.br${apiUrl}`;
            comparacaoApiPromise = fetchWithRetry(fullUrl);
        }

        // ── Resolver comparação ──
        dados.comparacao = [];
        const tickersVistos = new Set();

        try {
            const resApi = await comparacaoApiPromise;
            if (resApi && resApi.data) {
                let arrayComparacao = resApi.data.data || resApi.data || [];

                if (Array.isArray(arrayComparacao)) {
                    arrayComparacao.forEach(item => {
                        const tickerAPI = item.title ? item.title.trim() : (item.ticker ? item.ticker.trim() : '');
                        if (tickerAPI && !tickersVistos.has(tickerAPI)) {
                            let patrim = '-';
                            if (item.net_worth !== null && item.net_worth !== undefined) {
                                let v = parseFloat(item.net_worth);
                                if (!isNaN(v)) {
                                    if (v >= 1e9) patrim = `R$ ${(v / 1e9).toFixed(2).replace('.', ',')} B`;
                                    else if (v >= 1e6) patrim = `R$ ${(v / 1e6).toFixed(2).replace('.', ',')} M`;
                                    else patrim = `R$ ${v.toLocaleString('pt-BR')}`;
                                }
                            }
                            let dy = '-';
                            if (item.dividend_yield !== null && item.dividend_yield !== undefined) {
                                dy = String(item.dividend_yield).replace('.', ',');
                                if (!dy.includes('%')) dy += '%';
                            }
                            let pvp = '-';
                            if (item.p_vp !== null && item.p_vp !== undefined) pvp = String(item.p_vp).replace('.', ',');

                            dados.comparacao.push({
                                ticker: tickerAPI, nome: item.company_name || item.name || '',
                                dy: dy, pvp: pvp, patrimonio: patrim, tipo: item.type || '-', segmento: item.segment || '-'
                            });
                            tickersVistos.add(tickerAPI);
                        }
                    });
                }
            }
        } catch (err) { /* API falhou, fallback HTML abaixo */ }

        // Fallback HTML para comparação
        if (dados.comparacao.length === 0) {
            const tableMatch = html.match(/<table[^>]*id=["']table-compare(?:-fiis|-segments|-tickers)["'][^>]*>([\s\S]*?)<\/table>/i);
            if (tableMatch) {
                let idxDy = -1, idxPvp = -1, idxPat = -1, idxSeg = -1, idxTipo = -1;
                const theadMatch = tableMatch[1].match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
                if (theadMatch) {
                    const ths = theadMatch[1].match(/<th[^>]*>([\s\S]*?)<\/th>/gi) || [];
                    ths.forEach((th, idx) => {
                        const txt = th.replace(/<[^>]+>/g, '').toLowerCase();
                        if (txt.includes('dy') || txt.includes('dividend')) idxDy = idx;
                        if (txt.includes('p/vp') || txt.includes('p/l') || txt.includes('p/ vp')) idxPvp = idx;
                        if (txt.includes('patrim') || txt.includes('mercado')) idxPat = idx;
                        if (txt.includes('segmento')) idxSeg = idx;
                        if (txt.includes('tipo')) idxTipo = idx;
                    });
                }

                const tbodyMatch = tableMatch[1].match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
                const rows = tbodyMatch ? (tbodyMatch[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || []) : [];
                rows.forEach((row) => {
                    const cols = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
                    if (cols.length >= 3) {
                        const cleanTxt = t => t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                        const tickerMatch = cols[0].match(/<a[^>]+title=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
                        let tkr = tickerMatch ? cleanTxt(tickerMatch[2]) : cleanTxt(cols[0]);
                        let nome = tickerMatch ? tickerMatch[1] : '';

                        if (tkr && !tickersVistos.has(tkr)) {
                            const dy = idxDy !== -1 && cols.length > idxDy ? cleanTxt(cols[idxDy]) : '-';
                            const pvp = idxPvp !== -1 && cols.length > idxPvp ? cleanTxt(cols[idxPvp]) : '-';
                            const patrimonio = idxPat !== -1 && cols.length > idxPat ? cleanTxt(cols[idxPat]) : '-';
                            const segmento = idxSeg !== -1 && cols.length > idxSeg ? cleanTxt(cols[idxSeg]) : '-';
                            const tipo = idxTipo !== -1 && cols.length > idxTipo ? cleanTxt(cols[idxTipo]) : '-';

                            dados.comparacao.push({ ticker: tkr, nome, dy, pvp, patrimonio, segmento, tipo });
                            tickersVistos.add(tkr);
                        }
                    }
                });
            }
        }

        // ── Resolver chart promises ──
        try {
            const chartResults = await chartPromise;
            if (chartResults) {
                const charts = {};
                chartResults.filter(r => r && r.data).forEach(r => { charts[r.tipo] = r.data; });
                if (Object.keys(charts).length > 0) dados.charts_financeiros = charts;
            }
        } catch (e) {
            console.error('Erro ao buscar gráficos financeiros:', e.message);
        }

        dados.tipo_ativo = tipoAtivo;
        return dados;
    } catch (error) {
        console.error("Erro scraper:", error.message);
        return { dy: '-', pvp: '-' };
    }
}

// ─── PARTE 1.4: ÍNDICES DE MERCADO (IBOV, IFIX, SP500, Dólar) → YAHOO v8 ───

async function scrapeMarketIndices() {
    const indexDefs = [
        { symbol: '^BVSP', nome: 'IBOV', isCurrency: false },
        { symbol: 'IFIX.SA', nome: 'IFIX', isCurrency: false },
        { symbol: '^GSPC', nome: 'S&P 500', isCurrency: false },
        { symbol: 'BRL=X', nome: 'Dólar', isCurrency: true },
    ];

    async function fetchIndexData(symbol) {
        const buildUrl = (host) =>
            `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d&includePrePost=false`;

        let data;
        try {
            ({ data } = await fetchWithRetry(buildUrl('query1'), {
                headers: { 'Accept': 'application/json' }
            }));
        } catch (e) {
            ({ data } = await fetchWithRetry(buildUrl('query2'), {
                headers: { 'Accept': 'application/json' }
            }));
        }

        const result = data?.chart?.result?.[0];
        if (!result) return null;

        const meta = result.meta;
        const price = meta.regularMarketPrice;
        const prevClose = meta.chartPreviousClose || meta.previousClose;

        if (!price || !prevClose) return null;

        const change = ((price - prevClose) / prevClose) * 100;
        return { price, change };
    }

    try {
        const results = await Promise.allSettled(
            indexDefs.map(async (def) => {
                const data = await fetchIndexData(def.symbol);
                if (!data) return null;

                let valorFormatado;
                if (def.isCurrency) {
                    valorFormatado = 'R$ ' + data.price.toFixed(2).replace('.', ',');
                } else if (data.price > 1000) {
                    valorFormatado = Math.floor(data.price).toLocaleString('pt-BR');
                } else {
                    valorFormatado = data.price.toFixed(2).replace('.', ',');
                }

                const signal = data.change > 0 ? '+' : '';
                const varFormatada = signal + data.change.toFixed(2).replace('.', ',') + '%';

                return { nome: def.nome, valor: valorFormatado, variacao: varFormatada };
            })
        );

        return results
            .filter(r => r.status === 'fulfilled' && r.value !== null)
            .map(r => r.value);
    } catch (e) {
        console.error("Erro scraper market indices", e.message);
        return [];
    }
}

// ─── PARTE 1.5: RANKINGS (Maiores Altas + Baixas) → INVESTIDOR10 ────────────
// Otimizado: usa multi-selectors AeroScrape + fallback para HTML parsing

const RANKINGS_SELECTORS = {
    altasLinks:   { selector: '.maioresAltas a[href*="/acoes/"]' },
    baixasLinks:  { selector: '.maioresBaixas a[href*="/acoes/"]' },
    altasTickers: { selector: '.maioresAltas .ticker, .maioresAltas .name, .maioresAltas a[href*="/acoes/"] span' },
    baixasTickers:{ selector: '.maioresBaixas .ticker, .maioresBaixas .name, .maioresBaixas a[href*="/acoes/"] span' },
    altasVars:    { selector: '.maioresAltas .variation, .maioresAltas .percent, .maioresAltas .change' },
    baixasVars:   { selector: '.maioresBaixas .variation, .maioresBaixas .percent, .maioresBaixas .change' },
    altasPrices:  { selector: '.maioresAltas .price, .maioresAltas .value, .maioresAltas .cotacao' },
    baixasPrices: { selector: '.maioresBaixas .price, .maioresBaixas .value, .maioresBaixas .cotacao' },
    altasHrefs:   { selector: '.maioresAltas a[href*="/acoes/"]', extract: 'href' },
    baixasHrefs:  { selector: '.maioresBaixas a[href*="/acoes/"]', extract: 'href' },
};

async function scrapeRankings() {
    const resultados = { altas: [], baixas: [] };

    try {
        // Estratégia 1: multi-selectors (mais rápido, sem HTML parsing)
        const res = await aeroScrape('https://investidor10.com.br/', {
            returnHtml: true,
            selectors: RANKINGS_SELECTORS
        });

        const results = res.results || {};
        const html = res.html || '';

        // Tentar extrair via hrefs dos seletores
        const altasHrefs = results.altasHrefs || [];
        const baixasHrefs = results.baixasHrefs || [];

        const buildFromSelectors = (hrefs, tickers, vars, prices, limit = 6) => {
            const items = [];
            const seen = new Set();

            // Se temos hrefs, extraímos tickers deles
            if (hrefs.length > 0) {
                for (let i = 0; i < Math.min(hrefs.length, limit); i++) {
                    const href = hrefs[i] || '';
                    const tickerMatch = href.match(/acoes\/([a-z]{4}\d{1,2})\//i);
                    if (!tickerMatch) continue;
                    const ticker = tickerMatch[1].toUpperCase();
                    if (seen.has(ticker)) continue;
                    seen.add(ticker);

                    items.push({
                        ticker,
                        variacao: vars[i] || '',
                        preco: prices[i] || '',
                        logo_url: ''
                    });
                }
            }
            // Se não temos hrefs mas temos tickers via text
            if (items.length === 0 && tickers.length > 0) {
                for (let i = 0; i < Math.min(tickers.length, limit); i++) {
                    const text = (tickers[i] || '').trim().toUpperCase();
                    if (!TICKER_REGEX.test(text) || seen.has(text)) continue;
                    seen.add(text);
                    items.push({
                        ticker: text,
                        variacao: vars[i] || '',
                        preco: prices[i] || '',
                        logo_url: ''
                    });
                }
            }
            return items;
        };

        resultados.altas = buildFromSelectors(
            altasHrefs, results.altasTickers || [], results.altasVars || [], results.altasPrices || []
        );
        resultados.baixas = buildFromSelectors(
            baixasHrefs, results.baixasTickers || [], results.baixasVars || [], results.baixasPrices || []
        );

        // Estratégia 2 (fallback): parse HTML bruto — cobre mudanças de estrutura
        if ((resultados.altas.length === 0 || resultados.baixas.length === 0) && html) {
            const parseItemsFromHtml = (blockHtml, limit = 6) => {
                const items = [];
                if (!blockHtml) return items;
                const seen = new Set();

                // Links genéricos com /acoes/TICKER/
                const linkMatches = blockHtml.match(/<a[^>]*acoes\/[a-z]{4}\d{1,2}[^>]*>[\s\S]*?<\/a>/gi) || [];
                for (const linkHtml of linkMatches) {
                    if (items.length >= limit) break;
                    const tickerMatch = linkHtml.match(/acoes\/([a-z]{4}\d{1,2})\//i);
                    if (!tickerMatch) continue;
                    const ticker = tickerMatch[1].toUpperCase();
                    if (seen.has(ticker)) continue;
                    seen.add(ticker);
                    const varMatch = linkHtml.match(/([+-]?\d+[,.]\d+\s*%)/); 
                    const precoMatch = linkHtml.match(/R\$\s*([\d.,]+)/);
                    items.push({
                        ticker,
                        variacao: varMatch ? varMatch[1].replace(/\s/g, '') : '',
                        preco: precoMatch ? `R$ ${precoMatch[1]}` : '',
                        logo_url: ''
                    });
                }
                return items;
            };

            const altasIdx = html.indexOf('Maiores Altas');
            const baixasIdx = html.indexOf('Maiores Baixas');

            if (altasIdx >= 0 && baixasIdx >= 0) {
                if (resultados.altas.length === 0) {
                    resultados.altas = parseItemsFromHtml(html.substring(altasIdx, baixasIdx), 6);
                }
                if (resultados.baixas.length === 0) {
                    const nextH2 = html.indexOf('<h2', baixasIdx + 20);
                    resultados.baixas = parseItemsFromHtml(
                        html.substring(baixasIdx, nextH2 > baixasIdx ? nextH2 : baixasIdx + 10000), 6
                    );
                }
            }
        }

    } catch (e) {
        console.error('Erro rankings:', e.message);
    }
    return resultados;
}

// ─── PARTE 2: PROVENTOS → STATUSINVEST ───────────────────────────────────────

async function scrapeAsset(ticker) {
    try {
        const t = ticker.toUpperCase();
        let type = 'acao';
        if (KNOWN_UNITS.has(t)) {
            type = 'acao';
        } else if (/^[A-Z]{4}(11|11B|12)$/.test(t)) {
            type = 'fii';
        }

        const parseDateJSON = (dStr) => {
            if (!dStr || dStr.trim() === '' || dStr.trim() === '-') return null;
            const parts = dStr.split('/');
            if (parts.length !== 3) return null;
            return `${parts[2]}-${parts[1]}-${parts[0]}`;
        };

        const url = `https://statusinvest.com.br/${type}/companytickerprovents?ticker=${t}&chartProventsType=2`;

        const { data } = await fetchWithRetry(url, {
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': 'https://statusinvest.com.br/',
                'User-Agent': 'Mozilla/5.0'
            }
        });

        const earnings = data.assetEarningsModels || [];

        if (earnings.length === 0 && type === 'acao') {
            const urlFii = `https://statusinvest.com.br/fii/companytickerprovents?ticker=${t}&chartProventsType=2`;
            const { data: dataFii } = await fetchWithRetry(urlFii, {
                headers: { 'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://statusinvest.com.br/' }
            }).catch(() => ({ data: {} }));
            if ((dataFii.assetEarningsModels || []).length > 0) {
                earnings.push(...dataFii.assetEarningsModels);
            }
        }

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
                rawType: d.et
            };
        });

        return dividendos.filter(d => d.paymentDate !== null).sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));

    } catch (error) {
        console.error(`Erro StatusInvest API ${ticker}:`, error.message);
        return [];
    }
}

// ─── PARTE 3: IPCA → INVESTIDOR10 ───────────────────────────────────────────

async function scrapeIpca() {
    try {
        const { html } = await aeroScrape('https://investidor10.com.br/indices/ipca/', { returnHtml: true });
        if (!html) throw new Error("Sem HTML retornado");

        const historico = [];
        let acumulado12m = '0,00';
        let acumuladoAno = '0,00';

        const tableDataMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/g);
        let rowsHtml = '';
        if (tableDataMatch) {
            for (let t of tableDataMatch) {
                if (t.toLowerCase().includes('acumulado') || t.toLowerCase().includes('variaç')) {
                    rowsHtml = t;
                    break;
                }
            }
            if (!rowsHtml && tableDataMatch.length > 0) rowsHtml = tableDataMatch[0];
        }

        if (rowsHtml) {
            const rows = rowsHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/g) || [];
            rows.forEach((r, i) => {
                const cols = r.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [];
                if (cols.length >= 4) {
                    const cleanTxt = (t) => t.replace(/<[^>]+>/g, '').trim();
                    const dataRef = cleanTxt(cols[0]);
                    const valorStr = cleanTxt(cols[1]);
                    const acAnoStr = cleanTxt(cols[2]);
                    const ac12mStr = cleanTxt(cols[3]);

                    if (i === 0) {
                        acumulado12m = ac12mStr.replace('.', ',');
                        acumuladoAno = acAnoStr.replace('.', ',');
                    }

                    if (dataRef && valorStr && i < 13) {
                        historico.push({
                            mes: dataRef,
                            valor: parseFloat(valorStr.replace('.', '').replace(',', '.')),
                            acumulado_12m: ac12mStr.replace('.', ','),
                            acumulado_ano: acAnoStr.replace('.', ',')
                        });
                    }
                }
            });
        }

        return {
            historico: historico.reverse(),
            acumulado_12m: acumulado12m,
            acumulado_ano: acumuladoAno
        };

    } catch (error) {
        console.error('Erro no Scraper IPCA:', error);
        return { historico: [], acumulado_12m: '0,00', acumulado_ano: '0,00' };
    }
}

// ─── PARTE 4: COTAÇÃO HISTÓRICA (YAHOO FINANCE) ─────────────────────────────

function getYahooParams(range) {
    switch (range) {
        case '1D': return { range: '1d', interval: '5m' };
        case '5D': return { range: '5d', interval: '15m' };
        case '1M': return { range: '1mo', interval: '1d' };
        case '6M': return { range: '6mo', interval: '1d' };
        case 'YTD': return { range: 'ytd', interval: '1d' };
        case '1Y':
        case '1A': return { range: '1y', interval: '1d' };
        case '5Y':
        case '5A': return { range: '5y', interval: '1wk' };
        case 'Tudo':
        case 'MAX': return { range: 'max', interval: '1mo' };
        default: return { range: '1y', interval: '1d' };
    }
}

const _b3HolidayCacheByYear = new Map();

function pad2(value) {
    return String(value).padStart(2, '0');
}

function toDateKey(year, month, day) {
    return `${year}-${pad2(month)}-${pad2(day)}`;
}

function shiftDateKey(dateKey, dayDelta) {
    const [y, m, d] = String(dateKey).split('-').map(Number);
    if (!y || !m || !d) return dateKey;
    const utc = new Date(Date.UTC(y, m - 1, d));
    utc.setUTCDate(utc.getUTCDate() + dayDelta);
    return toDateKey(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
}

function calculateEasterDateKey(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return toDateKey(year, month, day);
}

function getB3HolidaySet(year) {
    if (_b3HolidayCacheByYear.has(year)) {
        return _b3HolidayCacheByYear.get(year);
    }

    const easter = calculateEasterDateKey(year);
    const carnavalSegunda = shiftDateKey(easter, -48);
    const carnavalTerca = shiftDateKey(easter, -47);
    const sextaSanta = shiftDateKey(easter, -2);
    const corpusChristi = shiftDateKey(easter, 60);

    const holidays = new Set([
        `${year}-01-01`,
        `${year}-01-25`,
        carnavalSegunda,
        carnavalTerca,
        sextaSanta,
        `${year}-04-21`,
        `${year}-05-01`,
        corpusChristi,
        `${year}-09-07`,
        `${year}-10-12`,
        `${year}-11-02`,
        `${year}-11-15`,
        `${year}-11-20`,
        `${year}-12-24`,
        `${year}-12-25`,
        `${year}-12-31`
    ]);

    _b3HolidayCacheByYear.set(year, holidays);
    return holidays;
}

function isB3Holiday(dateKey) {
    if (!dateKey) return false;
    const year = Number(dateKey.slice(0, 4));
    if (!Number.isInteger(year)) return false;
    return getB3HolidaySet(year).has(dateKey);
}

function getB3SessionWindow(dateKey) {
    const regularWindow = { openHour: 10, openMinute: 0, closeHour: 18, closeMinute: 0 };
    if (!dateKey) return regularWindow;

    const year = Number(dateKey.slice(0, 4));
    if (!Number.isInteger(year)) return regularWindow;

    const ashWednesday = shiftDateKey(calculateEasterDateKey(year), -46);
    if (dateKey === ashWednesday) {
        return { openHour: 13, openMinute: 0, closeHour: 18, closeMinute: 0 };
    }

    return regularWindow;
}

function getSaoPauloDateParts(referenceTimestamp = Date.now()) {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Sao_Paulo',
            weekday: 'short',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(new Date(referenceTimestamp));

        const weekdayToken = (parts.find(p => p.type === 'weekday')?.value || '').toLowerCase();
        const weekdayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
        const year = parts.find(p => p.type === 'year')?.value || null;
        const month = parts.find(p => p.type === 'month')?.value || null;
        const day = parts.find(p => p.type === 'day')?.value || null;
        const dateKey = (year && month && day) ? `${year}-${month}-${day}` : null;
        const dayOfWeek = Number.isInteger(weekdayMap[weekdayToken])
            ? weekdayMap[weekdayToken]
            : new Date(referenceTimestamp).getDay();

        return { year, month, day, dateKey, dayOfWeek };
    } catch (_) {
        const localDate = new Date(referenceTimestamp);
        const year = String(localDate.getFullYear());
        const month = pad2(localDate.getMonth() + 1);
        const day = pad2(localDate.getDate());
        return {
            year,
            month,
            day,
            dateKey: `${year}-${month}-${day}`,
            dayOfWeek: localDate.getDay()
        };
    }
}

function getB3SessionStartTimestamp(referenceTimestamp) {
    try {
        const { year, month, day, dateKey, dayOfWeek } = getSaoPauloDateParts(referenceTimestamp);
        if (!year || !month || !day || !dateKey) return null;
        if (dayOfWeek === 0 || dayOfWeek === 6) return null;
        if (isB3Holiday(dateKey)) return null;

        const session = getB3SessionWindow(dateKey);
        return new Date(
            `${year}-${month}-${day}T${pad2(session.openHour)}:${pad2(session.openMinute)}:00-03:00`
        ).getTime();
    } catch (_) {
        return null;
    }
}

function normalizeIntradayOpenPoint(points, meta, rangeFilter) {
    if (rangeFilter !== '1D' || !Array.isArray(points) || points.length === 0) {
        return points;
    }

    const firstPoint = points[0];
    const firstTs = Number(firstPoint?.timestamp);
    if (!Number.isFinite(firstTs)) return points;

    const sessionStart = getB3SessionStartTimestamp(firstTs);
    if (!Number.isFinite(sessionStart) || firstTs <= sessionStart) {
        return points;
    }

    const gapMs = firstTs - sessionStart;
    const minGapMs = 2 * 60 * 1000;
    const maxGapMs = 2 * 60 * 60 * 1000;
    if (gapMs <= minGapMs || gapMs > maxGapMs) {
        return points;
    }

    const baselineCandidates = [
        Number(meta?.chartPreviousClose),
        Number(meta?.previousClose),
        Number(meta?.regularMarketPreviousClose),
        Number(meta?.regularMarketOpen),
        Number(firstPoint?.open),
        Number(firstPoint?.price),
        Number(firstPoint?.high),
        Number(firstPoint?.low)
    ];
    const baseline = baselineCandidates.find(v => Number.isFinite(v) && v > 0);
    if (!(baseline > 0)) return points;

    const syntheticPoint = {
        date: new Date(sessionStart).toISOString(),
        timestamp: sessionStart,
        price: baseline,
        open: baseline,
        high: baseline,
        low: baseline,
        synthetic: true
    };

    return [syntheticPoint, ...points];
}

async function fetchYahooFinance(ticker, rangeFilter = '1A') {
    try {
        const symbol = ticker.toUpperCase().endsWith('.SA') ? ticker.toUpperCase() : `${ticker.toUpperCase()}.SA`;
        const { range, interval } = getYahooParams(rangeFilter);

        const buildUrl = (host) =>
            `https://${host}.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}&includePrePost=false`;

        let data;
        try {
            ({ data } = await fetchWithRetry(buildUrl('query1'), {
                headers: { 'Accept': 'application/json' }
            }));
        } catch (e) {
            ({ data } = await fetchWithRetry(buildUrl('query2'), {
                headers: { 'Accept': 'application/json' }
            }));
        }

        const result = data.chart.result[0];

        if (!result || !result.timestamp || !result.indicators.quote[0].close) return null;

        const timestamps = result.timestamp;
        const quote = result.indicators.quote[0];
        const prices = quote.close;
        const opens = quote.open;
        const highs = quote.high;
        const lows = quote.low;

        let points = timestamps.map((t, i) => {
            if (prices[i] === null || prices[i] === undefined) return null;
            return {
                date: new Date(t * 1000).toISOString(),
                timestamp: t * 1000,
                price: prices[i],
                open: opens[i] ?? prices[i],
                high: highs[i] ?? prices[i],
                low: lows[i] ?? prices[i]
            };
        }).filter(p => p !== null);

        const meta = result.meta || {};
        points = normalizeIntradayOpenPoint(points, meta, rangeFilter);

        return {
            points,
            meta: {
                regularMarketPrice: meta.regularMarketPrice,
                chartPreviousClose: meta.chartPreviousClose,
                previousClose: meta.previousClose,
                regularMarketDayHigh: meta.regularMarketDayHigh,
                regularMarketDayLow: meta.regularMarketDayLow,
                regularMarketOpen: meta.regularMarketOpen ?? (meta.regularMarketPrice || null)
            }
        };

    } catch (e) {
        console.error(`[DEBUG] Erro Yahoo Finance para ${ticker}:`, e.message);
        return null;
    }
}

async function scrapeCotacaoHistory(ticker, range = '1A') {
    const cleanTicker = ticker.toLowerCase().trim();
    const result = await fetchYahooFinance(cleanTicker, range);

    if (!result || !result.points || result.points.length === 0) {
        return { error: "Dados não encontrados", points: [] };
    }

    return {
        ticker: cleanTicker.toUpperCase(),
        range: range,
        points: result.points,
        meta: result.meta || null
    };
}

// ─── HANDLER ─────────────────────────────────────────────────────────────────

function resolveCorsOrigin(req) {
    const configured = (process.env.ALLOWED_ORIGIN || '').trim();
    if (configured && configured !== '*') return configured;

    const requestOrigin = req.headers?.origin;
    if (
        typeof requestOrigin === 'string' &&
        /^https:\/\/appvesto(?:-[a-z0-9-]+)?\.vercel\.app$/i.test(requestOrigin)
    ) {
        return requestOrigin;
    }

    return DEFAULT_ALLOWED_ORIGIN;
}

module.exports = async function handler(req, res) {
    const allowedOrigin = resolveCorsOrigin(req);
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }

    // ── Suporte GET + POST: CDN cacheia GET automaticamente ──
    let mode = '';
    let payload = {};

    if (req.method === 'GET') {
        mode = typeof req.query?.mode === 'string' ? req.query.mode.trim() : '';
        // Suporte: ?mode=fundamentos&ticker=PETR4&range=1A
        if (req.query?.ticker) payload.ticker = req.query.ticker;
        if (req.query?.range) payload.range = req.query.range;
        if (req.query?.fiiList) {
            try { payload.fiiList = JSON.parse(req.query.fiiList); } catch(e) {}
        }
    } else if (req.method === 'POST') {
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({ error: "Payload invalido" });
        }
        mode = typeof req.body.mode === 'string' ? req.body.mode.trim() : '';
        payload = (req.body.payload && typeof req.body.payload === 'object') ? req.body.payload : {};
    } else {
        return res.status(405).json({ error: "Use GET ou POST" });
    }

    // ── Cache-Control por modo (CDN cacheia GET) ──
    if (mode === 'fundamentos') {
        res.setHeader('Cache-Control', 's-maxage=14400, stale-while-revalidate=86400');
    } else if (mode === 'cotacao_historica') {
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
    } else if (mode === 'proximo_provento' || mode === 'historico_12m') {
        res.setHeader('Cache-Control', 's-maxage=7200, stale-while-revalidate=43200');
    } else if (mode === 'rankings') {
        res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
    } else {
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    }

    try {
        if (!ALLOWED_MODES.has(mode)) {
            return res.status(400).json({ error: "Modo invalido" });
        }

        if (mode === 'rankings') {
            const cacheKey = 'rankings';
            const cached = scraperCache.get(cacheKey);
            if (cached) return res.status(200).json({ json: cached, _cache: 'HIT' });
            const dados = await scrapeRankings();
            if (dados && (dados.altas?.length > 0 || dados.baixas?.length > 0)) scraperCache.set(cacheKey, dados, SCRAPER_CACHE_TTL.rankings);
            return res.status(200).json({ json: dados });
        }

        if (mode === 'indices') {
            const cacheKey = 'indices';
            const cached = scraperCache.get(cacheKey);
            if (cached) return res.status(200).json({ json: cached, _cache: 'HIT' });
            const dados = await scrapeMarketIndices();
            if (dados && dados.length > 0) scraperCache.set(cacheKey, dados, SCRAPER_CACHE_TTL.indices);
            return res.status(200).json({ json: dados });
        }

        if (mode === 'ipca') {
            const cacheKey = 'ipca';
            const cached = scraperCache.get(cacheKey);
            if (cached) return res.status(200).json({ json: cached, _cache: 'HIT' });
            const dados = await scrapeIpca();
            if (dados) scraperCache.set(cacheKey, dados, SCRAPER_CACHE_TTL.ipca);
            return res.status(200).json({ json: dados });
        }

        if (mode === 'fundamentos') {
            const ticker = sanitizeTickerInput(payload.ticker);
            if (!ticker) return res.status(400).json({ error: "Ticker invalido" });
            const cacheKey = 'fund_' + ticker;
            const cached = scraperCache.get(cacheKey);
            if (cached) return res.status(200).json({ json: cached, _cache: 'HIT' });
            const dados = await scrapeFundamentos(ticker);
            if (dados && dados.dy && dados.dy !== '-') scraperCache.set(cacheKey, dados, SCRAPER_CACHE_TTL.fundamentos);
            return res.status(200).json({ json: dados });
        }

        if (mode === 'proventos_carteira' || mode === 'historico_portfolio') {
            const rawList = Array.isArray(payload.fiiList) ? payload.fiiList : [];
            if (rawList.length === 0) return res.status(200).json({ json: [] });
            if (rawList.length > MAX_FII_LIST_SIZE) {
                return res.status(400).json({ error: `Lista muito grande. Limite: ${MAX_FII_LIST_SIZE}` });
            }

            const defaultLimit = mode === 'historico_portfolio' ? 14 : 12;
            const sanitizedList = rawList.map((item) => {
                const ticker = sanitizeTickerInput(typeof item === 'string' ? item : item?.ticker);
                if (!ticker) return null;
                return {
                    ticker,
                    limit: sanitizePositiveLimit(item?.limit, defaultLimit, MAX_HISTORY_LIMIT)
                };
            }).filter(Boolean);

            if (sanitizedList.length === 0) {
                return res.status(200).json({ json: [] });
            }

            const batches = chunkArray(sanitizedList, FII_BATCH_SIZE);
            let finalResults = [];
            for (const [batchIdx, batch] of batches.entries()) {
                const promises = batch.map(async ({ ticker, limit }) => {
                    const history = await scrapeAsset(ticker);
                    const recents = history.filter(h => h.paymentDate && h.value > 0).slice(0, limit);
                    if (recents.length > 0) return recents.map(r => ({ symbol: ticker.toUpperCase(), ...r }));
                    return null;
                });
                const batchResults = await Promise.all(promises);
                finalResults = finalResults.concat(batchResults);
                if (batches.length > 1 && batchIdx < batches.length - 1) {
                    await new Promise(r => setTimeout(r, 200));
                }
            }
            return res.status(200).json({ json: finalResults.filter(d => d !== null).flat() });
        }

        if (mode === 'historico_12m') {
            const ticker = sanitizeTickerInput(payload.ticker);
            if (!ticker) return res.status(400).json({ error: "Ticker invalido" });
            const history = await scrapeAsset(ticker);
            return res.status(200).json({ json: history });
        }

        if (mode === 'proximo_provento') {
            const ticker = sanitizeTickerInput(payload.ticker);
            if (!ticker) return res.status(400).json({ error: "Ticker invalido" });
            const cacheKeyProv = 'prov_' + ticker;
            const cachedProv = scraperCache.get(cacheKeyProv);
            if (cachedProv) return res.status(200).json({ json: cachedProv, _cache: 'HIT' });
            const history = await scrapeAsset(ticker);

            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);

            let ultimoPago = null;
            let proximo = null;

            for (const p of history) {
                if (!p.paymentDate) continue;
                const parts = p.paymentDate.split('-');
                const dataPag = new Date(parts[0], parts[1] - 1, parts[2]);

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

            const resultado = { ultimoPago, proximo };
            if (ultimoPago || proximo) scraperCache.set(cacheKeyProv, resultado, SCRAPER_CACHE_TTL.proximo_provento);
            return res.status(200).json({ json: resultado });
        }

        if (mode === 'cotacao_historica') {
            const ticker = sanitizeTickerInput(payload.ticker);
            if (!ticker) return res.status(400).json({ error: "Ticker invalido" });
            const range = sanitizeRangeInput(payload.range);
            const dados = await scrapeCotacaoHistory(ticker, range);
            return res.status(200).json({ json: dados });
        }

        return res.status(400).json({ error: "Modo desconhecido" });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
