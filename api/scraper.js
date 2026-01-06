const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// --- OTIMIZAÇÕES DE PERFORMANCE ---

// 1. Agente HTTPS otimizado com mais sockets
const httpsAgent = new https.Agent({ 
    keepAlive: true,
    maxSockets: 150,
    maxFreeSockets: 20,
    timeout: 12000,
    keepAliveMsecs: 30000
});

// 2. Cliente axios com configurações otimizadas
const client = axios.create({
    httpsAgent,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive'
    },
    timeout: 8000,
    maxRedirects: 2,
    decompress: true
});

// 3. Cache em memória simples (evita requisições duplicadas na mesma sessão)
const cache = new Map();
const CACHE_TTL = 300000; // 5 minutos

function getCached(key) {
    const item = cache.get(key);
    if (item && Date.now() - item.timestamp < CACHE_TTL) {
        return item.data;
    }
    cache.delete(key);
    return null;
}

function setCache(key, data) {
    cache.set(key, { data, timestamp: Date.now() });
    // Limpa cache antigo (mantém no máximo 100 itens)
    if (cache.size > 100) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
    }
}

// --- HELPERS OTIMIZADOS ---
const REGEX_CLEAN_NUMBER = /[^0-9,-]+/g;
const REGEX_NORMALIZE = /[\u0300-\u036f]/g;

// Parseadores mais rápidos
const parseValue = (valueStr) => {
    if (!valueStr) return 0;
    if (typeof valueStr === 'number') return valueStr;
    const cleaned = valueStr.replace(REGEX_CLEAN_NUMBER, "").replace(',', '.');
    return parseFloat(cleaned) || 0;
};

const normalize = (str) => {
    if (!str) return '';
    return str.normalize("NFD").replace(REGEX_NORMALIZE, "").toLowerCase().trim();
};

const chunkArray = (array, size) => {
    const results = [];
    for (let i = 0; i < array.length; i += size) {
        results.push(array.slice(i, i + size));
    }
    return results;
};

const parseExtendedValue = (str) => {
    if (!str) return 0;
    const val = parseValue(str);
    const lower = str.toLowerCase();
    if (lower.includes('bilh')) return val * 1e9;
    if (lower.includes('milh')) return val * 1e6;
    if (lower.includes('mil')) return val * 1000;
    return val;
};

const formatCurrency = (value) => {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const cleanDoubledString = (str) => {
    if (!str) return "";
    const parts = str.split('R$');
    if (parts.length > 2) return 'R$' + parts[1].trim();
    return str;
};

// --- SCRAPER DE FUNDAMENTOS OTIMIZADO ---
async function scrapeFundamentos(ticker) {
    const cacheKey = `fund_${ticker}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
        // Tenta ambas URLs em paralelo (mais rápido)
        const urls = [
            `https://investidor10.com.br/fiis/${ticker.toLowerCase()}/`,
            `https://investidor10.com.br/acoes/${ticker.toLowerCase()}/`
        ];

        let html;
        try {
            const results = await Promise.allSettled(
                urls.map(url => client.get(url, { timeout: 6000 }))
            );
            const success = results.find(r => r.status === 'fulfilled');
            if (!success) throw new Error('Ambas URLs falharam');
            html = success.value.data;
        } catch (e) {
            throw new Error(`Ticker ${ticker} não encontrado`);
        }

        const $ = cheerio.load(html, {
            xml: { normalizeWhitespace: true },
            decodeEntities: true
        });

        // Objeto de dados inicializado
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

        // Mapa de indicadores para busca mais rápida
        const indicatorMap = {
            'DIVIDA_LIQUIDA_EBITDA': 'divida_liquida_ebitda',
            'DY': 'dy',
            'P_L': 'pl',
            'P_VP': 'pvp',
            'ROE': 'roe',
            'MARGEM_LIQUIDA': 'margem_liquida'
        };

        // Função de processamento otimizada
        const processPair = (tituloRaw, valorRaw, origem = 'table', indicatorAttr = null) => {
            const titulo = normalize(tituloRaw);
            let valor = valorRaw.trim();

            if (titulo.includes('mercado')) {
                valor = cleanDoubledString(valor);
                if (dados.val_mercado !== 'N/A' && origem === 'table') return;
            }

            if (!valor) return;

            // Processamento via data-indicator (mais rápido)
            if (indicatorAttr) {
                const field = indicatorMap[indicatorAttr.toUpperCase()];
                if (field && dados[field] === 'N/A') {
                    dados[field] = valor;
                    return;
                }
            }

            // Mapeamento direto para campos comuns (evita múltiplos if's)
            const fieldMap = {
                'dy': 'dy',
                'p/vp': 'pvp',
                'liquidez': 'liquidez',
                'segmento': 'segmento',
                'vacancia': 'vacancia',
                'cnpj': 'cnpj',
                'mandato': 'mandato',
                'p/l': 'pl',
                'roe': 'roe',
                'lpa': 'lpa'
            };

            for (const [key, field] of Object.entries(fieldMap)) {
                if (dados[field] === 'N/A' && titulo.includes(key)) {
                    dados[field] = valor;
                    return;
                }
            }

            // Campos compostos
            if (dados.ultimo_rendimento === 'N/A' && titulo.includes('ultimo rendimento')) dados.ultimo_rendimento = valor;
            if (dados.num_cotistas === 'N/A' && titulo.includes('cotistas')) dados.num_cotistas = valor;
            if (dados.tipo_gestao === 'N/A' && titulo.includes('gestao')) dados.tipo_gestao = valor;
            if (dados.tipo_fundo === 'N/A' && titulo.includes('tipo de fundo')) dados.tipo_fundo = valor;
            if (dados.prazo_duracao === 'N/A' && titulo.includes('prazo')) dados.prazo_duracao = valor;
            if (dados.taxa_adm === 'N/A' && titulo.includes('taxa') && titulo.includes('administracao')) dados.taxa_adm = valor;
            if (dados.margem_liquida === 'N/A' && titulo.includes('margem liquida')) dados.margem_liquida = valor;
            if (dados.variacao_12m === 'N/A' && titulo.includes('variacao') && titulo.includes('12m')) dados.variacao_12m = valor;
            if (dados.val_mercado === 'N/A' && titulo.includes('mercado')) dados.val_mercado = valor;

            // Dívida Líquida / EBITDA
            if (dados.divida_liquida_ebitda === 'N/A') {
                const tituloClean = titulo.replace(/[\s\/\.\-]/g, '');
                if (tituloClean.includes('div') && tituloClean.includes('liq') && tituloClean.includes('ebitda')) {
                    dados.divida_liquida_ebitda = valor;
                }
            }

            // VPA
            if (dados.vp_cota === 'N/A' && (titulo === 'vpa' || titulo.includes('vp por cota'))) {
                dados.vp_cota = valor;
            }

            // Patrimônio
            if (titulo.includes('patrimonial') || titulo.includes('patrimonio')) {
                const valorNumerico = parseValue(valor);
                const textoLower = valor.toLowerCase();
                if (textoLower.includes('milh') || textoLower.includes('bilh') || valorNumerico > 10000) {
                    if (dados.patrimonio_liquido === 'N/A') dados.patrimonio_liquido = valor;
                } else {
                    if (dados.vp_cota === 'N/A') dados.vp_cota = valor;
                }
            }

            // Cotas
            if (titulo.includes('cotas') && (titulo.includes('emitidas') || titulo.includes('total'))) {
                num_cotas = parseValue(valor);
                if (dados.cotas_emitidas === 'N/A') dados.cotas_emitidas = valor;
            }
        };

        // Extração de dados otimizada
        $('._card').each((i, el) => {
            const titulo = $(el).find('._card-header').text().trim();
            const valor = $(el).find('._card-body').text().trim();
            processPair(titulo, valor, 'card');
            if (normalize(titulo).includes('cotacao')) cotacao_atual = parseValue(valor);
        });

        if (cotacao_atual === 0) {
            const cotacaoEl = $('._card.cotacao ._card-body span').first();
            if (cotacaoEl.length) cotacao_atual = parseValue(cotacaoEl.text());
        }

        $('.cell').each((i, el) => {
            const titulo = $(el).find('.name').text().trim() || $(el).children('span').first().text().trim();
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

        // Cálculo de valor de mercado fallback
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
                dados.val_mercado = mercadoCalc > 1e9 
                    ? `R$ ${(mercadoCalc / 1e9).toFixed(2)} Bilhões`
                    : mercadoCalc > 1e6 
                        ? `R$ ${(mercadoCalc / 1e6).toFixed(2)} Milhões`
                        : formatCurrency(mercadoCalc);
            }
        }

        setCache(cacheKey, dados);
        return dados;

    } catch (error) {
        console.error("Erro no scraper de fundamentos:", error.message);
        return { dy: '-', pvp: '-', segmento: '-' };
    }
}

// --- SCRAPER DE PROVENTOS OTIMIZADO ---
async function scrapeAsset(ticker) {
    const cacheKey = `prov_${ticker}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
        const t = ticker.toUpperCase();
        const type = (t.endsWith('11') || t.endsWith('11B')) ? 'fii' : 'acao';
        const url = `https://statusinvest.com.br/${type}/companytickerprovents?ticker=${t}&chartProventsType=2`;

        const { data } = await client.get(url, { 
            headers: { 
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': 'https://statusinvest.com.br/'
            },
            timeout: 6000
        });

        const earnings = data.assetEarningsModels || [];

        // Processamento otimizado com cache de regex
        const parseDateJSON = (dStr) => {
            if (!dStr || dStr.trim() === '' || dStr.trim() === '-') return null;
            const parts = dStr.split('/');
            if (parts.length !== 3) return null;
            return `${parts[2]}-${parts[1]}-${parts[0]}`;
        };

        const dividendos = earnings.map(d => {
            let labelTipo = 'REND';
            if (d.et === 1) labelTipo = 'DIV';
            else if (d.et === 2) labelTipo = 'JCP';
            else if (d.etd) {
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

        const result = dividendos
            .filter(d => d.paymentDate !== null)
            .sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));

        setCache(cacheKey, result);
        return result;

    } catch (error) { 
        console.error(`Erro StatusInvest API ${ticker}:`, error.message);
        return [];
    }
}

// --- HANDLER OTIMIZADO ---
module.exports = async function handler(req, res) {
    // Headers CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'GET' || req.method === 'POST') {
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    }

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Use POST" });
    }

    try {
        if (!req.body || !req.body.mode) {
            throw new Error("Payload inválido");
        }

        const { mode, payload } = req.body;

        // MODE: fundamentos
        if (mode === 'fundamentos') {
            if (!payload.ticker) return res.json({ json: {} });
            const dados = await scrapeFundamentos(payload.ticker);
            return res.status(200).json({ json: dados });
        }

        // MODE: proventos_carteira / historico_portfolio
        if (mode === 'proventos_carteira' || mode === 'historico_portfolio') {
            if (!payload.fiiList || !Array.isArray(payload.fiiList)) {
                return res.json({ json: [] });
            }

            const defaultLimit = mode === 'historico_portfolio' ? 36 : 24;
            
            // Processa em batches paralelos maiores (de 3 para 5)
            const batches = chunkArray(payload.fiiList, 5);
            const allResults = [];

            for (const batch of batches) {
                const promises = batch.map(async (item) => {
                    const ticker = typeof item === 'string' ? item : item.ticker;
                    const limit = typeof item === 'string' ? defaultLimit : (item.limit || defaultLimit);

                    try {
                        const history = await scrapeAsset(ticker);
                        const recents = history
                            .filter(h => h.paymentDate && h.value > 0)
                            .slice(0, limit);

                        return recents.length > 0 
                            ? recents.map(r => ({ symbol: ticker.toUpperCase(), ...r }))
                            : null;
                    } catch (e) {
                        console.error(`Erro em ${ticker}:`, e.message);
                        return null;
                    }
                });

                const batchResults = await Promise.all(promises);
                allResults.push(...batchResults);
                
                // Delay menor entre batches
                if (batches.length > 1) {
                    await new Promise(r => setTimeout(r, 400));
                }
            }

            return res.status(200).json({ 
                json: allResults.filter(d => d !== null).flat() 
            });
        }

        // MODE: historico_12m
        if (mode === 'historico_12m') {
            if (!payload.ticker) return res.json({ json: [] });
            
            const history = await scrapeAsset(payload.ticker);
            const formatted = history
                .slice(0, 18)
                .map(h => {
                    if (!h.paymentDate) return null;
                    const [ano, mes] = h.paymentDate.split('-');
                    return { mes: `${mes}/${ano.substring(2)}`, valor: h.value };
                })
                .filter(h => h !== null);

            return res.status(200).json({ json: formatted });
        }

        // MODE: proximo_provento
        if (mode === 'proximo_provento') {
            if (!payload.ticker) return res.json({ json: null });
            
            const history = await scrapeAsset(payload.ticker);
            const ultimo = history.length > 0 ? history[0] : null;

            return res.status(200).json({ json: ultimo });
        }

        return res.status(400).json({ error: "Modo desconhecido" });

    } catch (error) {
        console.error("Erro no handler:", error);
        return res.status(500).json({ error: error.message });
    }
};