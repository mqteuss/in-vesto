const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// ============================================================================
// CONFIGURAÇÃO & CLIENTE HTTP
// ============================================================================

const HTTPS_AGENT = new https.Agent({
    keepAlive: true,
    maxSockets: 64, // Otimizado para Serverless
    timeout: 10000
});

const client = axios.create({
    httpsAgent: HTTPS_AGENT,
    timeout: 10000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/json,application/xhtml+xml',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://investidor10.com.br/'
    }
});

// ============================================================================
// HELPERS & PARSERS
// ============================================================================

const MULTIPLIERS = { 'mil': 1e3, 'milh': 1e6, 'bilh': 1e9, 'trilh': 1e12 };

/**
 * Normaliza strings para chave de busca (remove acentos, lower case)
 */
const normalizeKey = (str) => {
    if (!str) return '';
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
};

/**
 * Parser numérico inteligente que detecta sufixos (M, B, %) e formatação BR
 */
const parseSmartNumber = (valStr) => {
    if (!valStr || typeof valStr !== 'string') return 0;
    
    let cleanStr = valStr.trim().toLowerCase();
    
    // Detecta multiplicador antes de limpar caracteres
    let multiplier = 1;
    for (const [key, val] of Object.entries(MULTIPLIERS)) {
        if (cleanStr.includes(key)) {
            multiplier = val;
            break;
        }
    }

    // Limpa tudo que não é número, vírgula ou sinal de menos
    cleanStr = cleanStr.replace(/[^0-9,-]/g, '').replace(',', '.');
    
    const parsed = parseFloat(cleanStr);
    return isNaN(parsed) ? 0 : parsed * multiplier;
};

/**
 * Formata moeda BRL
 */
const formatBRL = (val) => val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Executa promessas com limite de concorrência (Melhor que chunkArray)
 */
async function runWithConcurrency(items, fn, concurrency = 5) {
    const results = [];
    const executing = [];

    for (const item of items) {
        const p = Promise.resolve().then(() => fn(item));
        results.push(p);

        if (concurrency <= items.length) {
            const e = p.then(() => executing.splice(executing.indexOf(e), 1));
            executing.push(e);
            if (executing.length >= concurrency) {
                await Promise.race(executing);
            }
        }
    }
    return Promise.all(results);
}

// ============================================================================
// MAPEAMENTO DE CAMPOS (A "INTELIGÊNCIA" DO SCRAPER)
// ============================================================================

// Mapeia o texto visual do site (chave normalizada) para o campo do JSON
const INDICATORS_MAP = {
    // Comuns
    'cotacao': 'cotacao',
    'dy': 'dy',
    'dividendyield': 'dy',
    'pvp': 'pvp',
    'pl': 'pl',
    'roe': 'roe',
    'lpa': 'lpa',
    'vpc': 'vp_cota',
    'vppa': 'vp_cota',
    'valormercado': 'val_mercado',
    'liquidezdiaria': 'liquidez',
    'liqdiaria': 'liquidez',
    'variacao12m': 'variacao_12m',
    
    // FIIs
    'segmento': 'segmento',
    'tipodefundo': 'tipo_fundo',
    'mandato': 'mandato',
    'vacancia': 'vacancia',
    'patrimonioliquido': 'patrimonio_liquido',
    'ultimorendimento': 'ultimo_rendimento',
    'cnpj': 'cnpj',
    'numcotistas': 'num_cotistas',
    'publicoalvo': 'publico_alvo',
    'taxadeadministracao': 'taxa_adm',
    'cotasemitidas': 'cotas_emitidas',
    
    // Ações
    'margemliquida': 'margem_liquida',
    'margembruta': 'margem_bruta',
    'evebitda': 'ev_ebitda',
    'dividaliquidaebitda': 'divida_liquida_ebitda',
    'dividaliquidapatrimonio': 'divida_liquida_pl',
    'payout': 'payout',
    'cagrreceita5anos': 'cagr_receita_5a',
    'cagrlucros5anos': 'cagr_lucros_5a'
};

// ============================================================================
// LOGICA DE NEGÓCIO: FUNDAMENTOS
// ============================================================================

async function fetchFundamentos(ticker) {
    if (!ticker) return {};
    const t = ticker.toLowerCase();

    // Objeto base zerado
    const data = { 
        ticker: t.toUpperCase(), 
        dy: '0,00%', pvp: '0,00', val_mercado: 'N/A' 
    };

    try {
        // Tenta buscar URL. Se falhar FII, tenta Ação (lógica mantida, mas mais limpa)
        let html;
        try {
            html = (await client.get(`https://investidor10.com.br/fiis/${t}/`)).data;
        } catch {
            html = (await client.get(`https://investidor10.com.br/acoes/${t}/`)).data;
        }

        const $ = cheerio.load(html);

        // Função extratora unificada
        const extract = (keyRaw, valueRaw) => {
            const keyNorm = normalizeKey(keyRaw);
            const targetField = INDICATORS_MAP[keyNorm];
            
            if (targetField && !data[targetField]) { // Prioriza o primeiro encontro
                data[targetField] = valueRaw.trim();
            }
        };

        // 1. Extrai Cards Superiores (._card)
        $('._card').each((_, el) => {
            const title = $(el).find('._card-header').text();
            const val = $(el).find('._card-body').text();
            extract(title, val);
        });

        // 2. Extrai Tabela de Indicadores (.cell)
        $('.cell').each((_, el) => {
            const title = $(el).find('.name').text() || $(el).find('span').first().text();
            const val = $(el).find('.value').text();
            extract(title, val);
        });

        // 3. Extrai Tabela Detalhada (table tr td)
        $('#table-indicators tr, #table-indicators-history tr').each((_, row) => {
            const cols = $(row).find('td');
            if (cols.length >= 2) {
                extract($(cols[0]).text(), $(cols[1]).text());
            }
        });

        // 4. Cálculos de Fallback (Valor de Mercado)
        if (!data.val_mercado || data.val_mercado === 'N/A') {
            const cotacao = parseSmartNumber(data.cotacao);
            const numCotas = parseSmartNumber(data.cotas_emitidas);
            
            if (cotacao > 0 && numCotas > 0) {
                const mktCap = cotacao * numCotas;
                if (mktCap > 1e9) data.val_mercado = `R$ ${(mktCap/1e9).toFixed(2)} Bilhões`;
                else if (mktCap > 1e6) data.val_mercado = `R$ ${(mktCap/1e6).toFixed(2)} Milhões`;
            }
        }

        return data;

    } catch (e) {
        console.error(`[Scraper] Erro ao buscar fundamentos de ${t}: ${e.message}`);
        return { error: true, message: "Ativo não encontrado ou erro na fonte" };
    }
}

// ============================================================================
// LOGICA DE NEGÓCIO: PROVENTOS (StatusInvest)
// ============================================================================

async function fetchProventos(ticker, limit = 999) {
    try {
        const t = ticker.toUpperCase();
        // Detecção simples de tipo
        const type = (t.endsWith('11') || t.endsWith('11B')) ? 'fii' : 'acao';
        const url = `https://statusinvest.com.br/${type}/companytickerprovents?ticker=${t}&chartProventsType=2`;

        const { data } = await client.get(url, {
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });

        if (!data.assetEarningsModels) return [];

        // Mapeamento de tipos do StatusInvest
        const TYPE_MAP = { 1: 'DIV', 2: 'JCP' };

        const results = data.assetEarningsModels
            .map(d => ({
                symbol: t,
                dataCom: d.ed ? d.ed.split('/').reverse().join('-') : null, // DD/MM/YYYY -> YYYY-MM-DD
                paymentDate: d.pd ? d.pd.split('/').reverse().join('-') : null,
                value: d.v,
                type: TYPE_MAP[d.et] || (d.etd && d.etd.includes('JURO') ? 'JCP' : 'REND')
            }))
            .filter(d => d.paymentDate) // Remove sem data de pagamento
            .sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));

        return results.slice(0, limit);

    } catch (e) {
        console.error(`[Scraper] Erro proventos ${ticker}: ${e.message}`);
        return [];
    }
}

// ============================================================================
// LOGICA DE NEGÓCIO: IPCA
// ============================================================================

async function fetchIpca() {
    try {
        const { data } = await client.get('https://investidor10.com.br/indices/ipca/');
        const $ = cheerio.load(data);
        
        // Encontra tabela pelo header, mais seguro que classe fixa
        const table = $('table').filter((_, el) => $(el).text().toLowerCase().includes('acumulado 12 meses')).first();
        
        if (!table.length) throw new Error("Tabela IPCA não encontrada");

        const historico = [];
        const rows = table.find('tbody tr');

        // Extrai meta-dados da primeira linha (mês atual)
        const firstRowCols = rows.first().find('td');
        const acumulado12m = $(firstRowCols[3]).text().trim() || '0,00';
        const acumuladoAno = $(firstRowCols[2]).text().trim() || '0,00';

        rows.each((i, el) => {
            if (i >= 13) return; // Limita a 13 meses
            const cols = $(el).find('td');
            if (cols.length < 2) return;

            historico.push({
                mes: $(cols[0]).text().trim(),
                valor: parseSmartNumber($(cols[1]).text()), // float para gráfico
                acumulado_12m: $(cols[3]).text().trim(),
                acumulado_ano: $(cols[2]).text().trim()
            });
        });

        return {
            historico: historico.reverse(), // Cronológico (Jan -> Dez)
            acumulado_12m,
            acumulado_ano
        };

    } catch (e) {
        console.error('[Scraper] Erro IPCA:', e.message);
        return { historico: [], acumulado_12m: '0,00', acumulado_ano: '0,00' };
    }
}

// ============================================================================
// CONTROLLER PRINCIPAL (Strategy Pattern)
// ============================================================================

const STRATEGIES = {
    // Busca dados fundamentalistas de um ticker
    'fundamentos': async ({ ticker }) => {
        return await fetchFundamentos(ticker);
    },

    // Busca histórico de IPCA
    'ipca': async () => {
        return await fetchIpca();
    },

    // Busca proventos para uma lista de ativos (Carteira)
    'proventos_carteira': async ({ fiiList }) => {
        if (!Array.isArray(fiiList)) return [];
        
        // Processa em paralelo com limite de 10 requests simultâneos
        // Muito mais rápido que chunks sequenciais
        const results = await runWithConcurrency(fiiList, async (item) => {
            const ticker = typeof item === 'string' ? item : item.ticker;
            const limit = typeof item === 'object' && item.limit ? item.limit : 12;
            return await fetchProventos(ticker, limit);
        }, 10);

        return results.flat();
    },

    // Histórico detalhado de um único ativo
    'historico_12m': async ({ ticker }) => {
        const data = await fetchProventos(ticker, 18);
        return data.map(h => ({
            mes: h.paymentDate.substring(5, 7) + '/' + h.paymentDate.substring(2, 4), // MM/YY
            valor: h.value
        }));
    },

    // Próximo provento (snapshot)
    'proximo_provento': async ({ ticker }) => {
        const data = await fetchProventos(ticker, 1);
        return data[0] || null;
    }
};

module.exports = async function handler(req, res) {
    // Headers CORS e Cache
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Cache Vercel: Cacheia por 1 hora na CDN, revalida em background por 1 dia
    if (req.method === 'GET') {
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    }

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

    try {
        const { mode, payload = {} } = req.body;
        
        const strategy = STRATEGIES[mode];
        
        if (!strategy) {
            return res.status(400).json({ 
                error: `Modo inválido: ${mode}. Modos disponíveis: ${Object.keys(STRATEGIES).join(', ')}` 
            });
        }

        const json = await strategy(payload);
        return res.status(200).json({ json });

    } catch (error) {
        console.error('[API Handler] Critical Error:', error);
        return res.status(500).json({ error: "Erro interno no servidor" });
    }
};
