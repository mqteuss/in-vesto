const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// --- OTIMIZAÇÃO: AGENTE HTTPS (Keep-Alive) ---
const httpsAgent = new https.Agent({ 
    keepAlive: true,
    maxSockets: 128, // Aumentado levemente para concorrência
    maxFreeSockets: 16,
    timeout: 15000,
    scheduling: 'lifo'
});

const client = axios.create({
    httpsAgent,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://investidor10.com.br/'
    },
    timeout: 8000 // Timeout reduzido para falhar rápido e tentar fallback
});

// --- CONSTANTES DE REGEX (Compiladas uma vez) ---
const REGEX_CLEAN_NUMBER = /[^0-9,-]+/g;
const REGEX_NORMALIZE = /[\u0300-\u036f]/g;
const REGEX_SPACES = /\s+/g;

// --- MAPA DE CAMPOS (Lookup Table para O(1) performance) ---
// Mapeia termos normalizados (ou parciais) para as chaves do objeto 'dados'
const FIELD_MAP = {
    'dy': 'dy', 'dividendyield': 'dy', 'dy(12m)': 'dy',
    'p/vp': 'pvp', 'pvp': 'pvp',
    'p/l': 'pl', 'pl': 'pl',
    'roe': 'roe',
    'lpa': 'lpa',
    'vpa': 'vp_cota', 'vpporcota': 'vp_cota',
    'margemliquida': 'margem_liquida',
    'dividaliquida/ebitda': 'divida_liquida_ebitda',
    'divliq/ebitda': 'divida_liquida_ebitda',
    'liquidezdiaria': 'liquidez',
    'valordemercado': 'val_mercado',
    'variacao(12m)': 'variacao_12m',
    'segmento': 'segmento',
    'vacancia': 'vacancia',
    'ultimorendimento': 'ultimo_rendimento',
    'cnpj': 'cnpj',
    'numerodecotistas': 'num_cotistas', 'cotistas': 'num_cotistas',
    'tipodegestao': 'tipo_gestao',
    'mandato': 'mandato',
    'tipodefundo': 'tipo_fundo',
    'prazodeduracao': 'prazo_duracao',
    'taxadeadministracao': 'taxa_adm',
    'cotasemitidas': 'cotas_emitidas', 'totaldecotas': 'cotas_emitidas'
};

// --- HELPERS OTIMIZADOS ---

function parseValue(valueStr) {
    if (!valueStr) return 0;
    if (typeof valueStr === 'number') return valueStr;
    // Otimização: verificação rápida antes de regex
    if (valueStr.indexOf(',') === -1 && valueStr.indexOf('.') === -1) {
        const parsed = parseInt(valueStr, 10);
        return isNaN(parsed) ? 0 : parsed;
    }
    try {
        return parseFloat(valueStr.replace(REGEX_CLEAN_NUMBER, "").replace(',', '.')) || 0;
    } catch (e) { return 0; }
}

function normalize(str) {
    if (!str) return '';
    // replaceall simples de espaços para chave de busca
    return str.normalize("NFD").replace(REGEX_NORMALIZE, "").toLowerCase().replace(REGEX_SPACES, "");
}

function cleanDoubledString(str) {
    if (!str) return "";
    // Otimização: indexOf é mais rápido que split para checagem simples
    const idx = str.indexOf('R$');
    if (idx !== -1) {
        const secondIdx = str.indexOf('R$', idx + 2);
        if (secondIdx !== -1) {
            return 'R$ ' + str.substring(idx + 2, secondIdx).trim();
        }
    }
    return str;
}

// Heurística para evitar requests 404 desnecessários
function detectType(ticker) {
    const t = ticker.trim();
    const end = t.charAt(t.length - 1);
    // 3, 4, 5, 6 são quase sempre Ações (PETR4, VALE3)
    if (['3', '4', '5', '6'].includes(end)) return 'acoes';
    // 11 é ambíguo (FII ou Unit), mas assumimos FII como prioritário no scraper de "fundamentos"
    return 'fiis'; 
}

// ---------------------------------------------------------
// PARTE 1: FUNDAMENTOS -> INVESTIDOR10 (FINAL v4)
// ---------------------------------------------------------

async function scrapeFundamentos(ticker) {
    const tickerLower = ticker.toLowerCase();
    const primaryType = detectType(ticker);
    const fallbackType = primaryType === 'fiis' ? 'acoes' : 'fiis';

    let html;
    let urlUsada = '';

    try {
        // Tenta a URL mais provável primeiro (evita o custo do 404)
        urlUsada = `https://investidor10.com.br/${primaryType}/${tickerLower}/`;
        const res = await client.get(urlUsada);
        html = res.data;
    } catch (e) {
        try {
            // Fallback apenas se falhar
            urlUsada = `https://investidor10.com.br/${fallbackType}/${tickerLower}/`;
            const res = await client.get(urlUsada);
            html = res.data;
        } catch (e2) {
            console.error(`Erro ao buscar ${ticker}:`, e2.message);
            return { dy: '-', pvp: '-', segmento: '-' };
        }
    }

    const $ = cheerio.load(html);

    const dados = {
        dy: 'N/A', pvp: 'N/A', segmento: 'N/A', tipo_fundo: 'N/A', mandato: 'N/A',
        vacancia: 'N/A', vp_cota: 'N/A', liquidez: 'N/A', val_mercado: 'N/A',
        patrimonio_liquido: 'N/A', variacao_12m: 'N/A', ultimo_rendimento: 'N/A',
        cnpj: 'N/A', num_cotistas: 'N/A', tipo_gestao: 'N/A', prazo_duracao: 'N/A',
        taxa_adm: 'N/A', cotas_emitidas: 'N/A',
        pl: 'N/A', roe: 'N/A', lpa: 'N/A', margem_liquida: 'N/A', divida_liquida_ebitda: 'N/A'
    };

    let cotacao_atual = 0;
    let num_cotas = 0;

    // Função interna otimizada com Map Lookup
    const processPair = (key, valorRaw, origem, indicatorAttr) => {
        if (!valorRaw) return;
        const valor = valorRaw.trim();
        if (!valor) return;

        // 1. Prioridade: Atributo Data-Indicator (Mais preciso)
        if (indicatorAttr) {
            const ind = indicatorAttr.toUpperCase();
            const mapAttr = {
                'DIVIDA_LIQUIDA_EBITDA': 'divida_liquida_ebitda',
                'DY': 'dy',
                'P_L': 'pl',
                'P_VP': 'pvp',
                'ROE': 'roe',
                'MARGEM_LIQUIDA': 'margem_liquida'
            };
            if (mapAttr[ind]) {
                dados[mapAttr[ind]] = valor;
                return;
            }
        }

        // 2. Lookup pelo Título Normalizado
        const targetField = FIELD_MAP[key];
        
        if (targetField) {
            // Tratamento especial para Valor de Mercado (evitar sobrescrita da Tabela se já pegou do Card)
            if (targetField === 'val_mercado') {
                const cleanVal = cleanDoubledString(valor);
                if (dados.val_mercado !== 'N/A' && origem === 'table') return;
                dados.val_mercado = cleanVal;
            } 
            else if (dados[targetField] === 'N/A') {
                dados[targetField] = valor;
            }
            
            // Lógica lateral para Cotas
            if (targetField === 'cotas_emitidas') {
                num_cotas = parseValue(valor);
            }
            return; // Encontrou, sai.
        }

        // 3. Fallbacks Específicos (Regex complexos ou lógica condicional)
        
        // Patrimônio vs VP
        if (key.includes('patrimonio')) {
            const valorNumerico = parseValue(valor);
            if (valor.toLowerCase().includes('mi') || valor.toLowerCase().includes('bi') || valorNumerico > 10000) {
                if (dados.patrimonio_liquido === 'N/A') dados.patrimonio_liquido = valor;
            } else {
                if (dados.vp_cota === 'N/A') dados.vp_cota = valor;
            }
        }
        
        // Fallback Div Liq (caso o map não pegue variações exóticas)
        if (dados.divida_liquida_ebitda === 'N/A' && key.includes('div') && key.includes('liq') && key.includes('ebitda')) {
            dados.divida_liquida_ebitda = valor;
        }
    };

    // --- VARREDURA OTIMIZADA ---

    // 1. Cards (Topo)
    $('._card').each((_, el) => {
        const header = $(el).find('._card-header').text();
        const body = $(el).find('._card-body').text();
        const key = normalize(header);
        
        processPair(key, body, 'card', null);

        if (key.includes('cotacao')) {
            const valSpan = $(el).find('._card-body span').first();
            const txt = valSpan.length ? valSpan.text() : body;
            cotacao_atual = parseValue(txt);
        }
    });

    // Fallback Cotação
    if (cotacao_atual === 0) {
        const cVal = $('._card.cotacao ._card-body span').text();
        if (cVal) cotacao_atual = parseValue(cVal);
    }

    // 2. Grid (.cell) e Tabelas juntas? Não, estrutura diferente.
    $('.cell').each((_, el) => {
        const $el = $(el);
        let titulo = $el.find('.name').text();
        if (!titulo) titulo = $el.children('span').first().text();
        
        let valorEl = $el.find('.value span').first();
        let valor = (valorEl.length > 0) ? valorEl.text() : $el.find('.value').text();

        processPair(normalize(titulo), valor, 'cell', null);
    });

    // 3. Tabelas
    $('table tbody tr').each((_, row) => {
        const cols = $(row).find('td');
        if (cols.length >= 2) {
            const $col0 = $(cols[0]);
            const indicatorAttr = $col0.find('[data-indicator]').attr('data-indicator');
            const titulo = normalize($col0.text());
            const valor = $(cols[1]).text();

            processPair(titulo, valor, 'table', indicatorAttr);
        }
    });

    // Fallback Valor de Mercado Calculado
    if (dados.val_mercado === 'N/A' || dados.val_mercado === '-') {
        let mercadoCalc = 0;
        if (cotacao_atual > 0 && num_cotas > 0) {
            mercadoCalc = cotacao_atual * num_cotas;
        } else if (dados.patrimonio_liquido !== 'N/A' && dados.pvp !== 'N/A') {
            const plStr = dados.patrimonio_liquido.toLowerCase();
            let pl = parseValue(dados.patrimonio_liquido);
            if (plStr.includes('bilh')) pl *= 1e9;
            else if (plStr.includes('milh')) pl *= 1e6;
            else if (plStr.includes('mil')) pl *= 1e3;
            
            const pvp = parseValue(dados.pvp);
            if (pl > 0 && pvp > 0) mercadoCalc = pl * pvp;
        }

        if (mercadoCalc > 0) {
            const format = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            if (mercadoCalc > 1e9) dados.val_mercado = `R$ ${(mercadoCalc / 1e9).toFixed(2)} Bilhões`;
            else if (mercadoCalc > 1e6) dados.val_mercado = `R$ ${(mercadoCalc / 1e6).toFixed(2)} Milhões`;
            else dados.val_mercado = format(mercadoCalc);
        }
    }

    return dados;
}

// ---------------------------------------------------------
// PARTE 2: PROVENTOS -> STATUSINVEST
// ---------------------------------------------------------

async function scrapeAsset(ticker) {
    try {
        const t = ticker.toUpperCase();
        // Detecção rápida de tipo
        const isFII = t.endsWith('11') || t.endsWith('11B'); 
        const type = isFII ? 'fii' : 'acao';

        const url = `https://statusinvest.com.br/${type}/companytickerprovents?ticker=${t}&chartProventsType=2`;

        const { data } = await client.get(url, { 
            headers: { 'X-Requested-With': 'XMLHttpRequest' } 
        });

        const earnings = data.assetEarningsModels;
        if (!earnings || earnings.length === 0) return [];

        const result = [];
        
        // Otimização: Loop for simples é mais rápido que map + filter para grandes arrays
        for (let i = 0; i < earnings.length; i++) {
            const d = earnings[i];
            
            // Otimização: Substring é mais rápido que split('/') para datas fixas DD/MM/YYYY
            const pd = d.pd; 
            if (!pd) continue; // Pula sem data pagamento

            const pDate = `${pd.substring(6, 10)}-${pd.substring(3, 5)}-${pd.substring(0, 2)}`;
            
            // Data Com (opicional, validação rápida)
            let dCom = null;
            if (d.ed) dCom = `${d.ed.substring(6, 10)}-${d.ed.substring(3, 5)}-${d.ed.substring(0, 2)}`;

            let labelTipo = 'REND'; 
            if (d.et === 1) labelTipo = 'DIV';
            else if (d.et === 2) labelTipo = 'JCP';
            else if (d.etd) {
                const texto = d.etd; // Mantém case original para check rápido
                if (texto[0] === 'J') labelTipo = 'JCP'; // Heurística: Juros começa com J
                else if (texto[0] === 'D') labelTipo = 'DIV';
                else if (texto.includes('Tributado')) labelTipo = 'REND_TRIB';
            }

            result.push({
                dataCom: dCom,
                paymentDate: pDate,
                value: d.v,
                type: labelTipo,
                rawType: d.et
            });
        }

        return result.sort((a, b) => b.paymentDate.localeCompare(a.paymentDate));

    } catch (error) { 
        return []; 
    }
}

// ---------------------------------------------------------
// HANDLER (API)
// ---------------------------------------------------------

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Cache agressivo para leituras, mas revalida no background
    if (req.method === 'GET' || req.method === 'POST') {
       res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    }

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'POST') { return res.status(405).json({ error: "Use POST" }); }

    try {
        if (!req.body || !req.body.mode) throw new Error("Payload inválido");
        const { mode, payload } = req.body;

        if (mode === 'fundamentos') {
            if (!payload.ticker) return res.json({ json: {} });
            const dados = await scrapeFundamentos(payload.ticker);
            return res.status(200).json({ json: dados });
        }

        if (mode === 'proventos_carteira' || mode === 'historico_portfolio') {
            if (!payload.fiiList || !Array.isArray(payload.fiiList)) return res.json({ json: [] });

            // Chunking para evitar rate limit (Batching)
            const chunkSize = 3;
            let finalResults = [];
            const queue = payload.fiiList;

            for (let i = 0; i < queue.length; i += chunkSize) {
                const batch = queue.slice(i, i + chunkSize);
                
                const batchResults = await Promise.all(batch.map(async (item) => {
                    const ticker = (typeof item === 'string' ? item : item.ticker) || '';
                    if (!ticker) return null;

                    const limit = mode === 'historico_portfolio' ? 36 : ((typeof item !== 'string' && item.limit) || 24);
                    
                    const history = await scrapeAsset(ticker);
                    
                    // Slice direto é mais rápido
                    const recents = [];
                    let count = 0;
                    for (let h of history) {
                        if (h.value > 0) {
                            recents.push({ symbol: ticker.toUpperCase(), ...h });
                            count++;
                        }
                        if (count >= limit) break;
                    }
                    return recents.length ? recents : null;
                }));

                // Filtra nulos e flat map manual
                for (const r of batchResults) {
                    if (r) finalResults.push(...r);
                }

                // Delay leve entre chunks
                if (i + chunkSize < queue.length) await new Promise(r => setTimeout(r, 500)); 
            }
            return res.status(200).json({ json: finalResults });
        }

        if (mode === 'historico_12m') {
            if (!payload.ticker) return res.json({ json: [] });
            const history = await scrapeAsset(payload.ticker);
            const formatted = history.slice(0, 18).map(h => {
                // Parse otimizado YYYY-MM-DD
                const ano = h.paymentDate.substring(2, 4); // YY
                const mes = h.paymentDate.substring(5, 7); // MM
                return { mes: `${mes}/${ano}`, valor: h.value };
            });
            return res.status(200).json({ json: formatted });
        }

        if (mode === 'proximo_provento') {
            if (!payload.ticker) return res.json({ json: null });
            const history = await scrapeAsset(payload.ticker);
            return res.status(200).json({ json: history[0] || null });
        }

        return res.status(400).json({ error: "Modo desconhecido" });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
