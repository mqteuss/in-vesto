const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// Configuração do Agente HTTPS e Axios
const httpsAgent = new https.Agent({ 
    keepAlive: true,
    maxSockets: 100,
    maxFreeSockets: 10,
    timeout: 10000
});

const client = axios.create({
    httpsAgent,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br'
    },
    timeout: 10000,
    maxRedirects: 5 // Permite seguir redirects, mas vamos validar o conteúdo
});

const REGEX_CLEAN_NUMBER = /[^0-9,-]+/g;
const REGEX_NORMALIZE = /[\u0300-\u036f]/g;

// --- HELPERS ---
function parseDate(dateStr) {
    if (!dateStr || dateStr === '-') return null;
    const parts = dateStr.trim().split('/');
    if (parts.length !== 3) return null;
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function parseValue(valueStr) {
    if (!valueStr) return 0;
    try {
        return parseFloat(valueStr.replace(REGEX_CLEAN_NUMBER, "").replace(',', '.')) || 0;
    } catch (e) { return 0; }
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

// --- LÓGICA DE URL INTELIGENTE ---
async function fetchHtmlWithRetry(ticker) {
    const tickerLower = ticker.toLowerCase();
    const lastChar = tickerLower.slice(-1);
    
    // Heurística: Se termina em 3, 4, 5, 6, é AÇÃO com certeza.
    const isLikelyStock = ['3', '4', '5', '6'].includes(lastChar);
    
    // Define a ordem de tentativa baseada na heurística
    const urlsToTry = isLikelyStock 
        ? [`https://investidor10.com.br/acoes/${tickerLower}/`, `https://investidor10.com.br/fiis/${tickerLower}/`]
        : [`https://investidor10.com.br/fiis/${tickerLower}/`, `https://investidor10.com.br/acoes/${tickerLower}/`];

    for (const url of urlsToTry) {
        try {
            const response = await client.get(url);
            
            // VALIDAÇÃO CRÍTICA:
            // O site redireciona para a home se não encontrar. Precisamos verificar se
            // estamos na página certa procurando o ticker no título ou HTML.
            const html = response.data;
            const $ = cheerio.load(html);
            const title = $('title').text().toLowerCase();
            const h1 = $('h1').text().toLowerCase();
            
            // Se o título ou H1 não tiver o ticker, provavelmente foi redirecionado para a Home ou Search
            if (!title.includes(tickerLower) && !h1.includes(tickerLower)) {
                throw new Error("Página incorreta (redirecionamento detectado)");
            }

            return response; // Sucesso
        } catch (e) {
            // Continua para a próxima URL
            continue;
        }
    }
    throw new Error(`Não foi possível encontrar dados para ${ticker}`);
}

// --- SCRAPER DE FUNDAMENTOS ---
async function scrapeFundamentos(ticker) {
    try {
        const response = await fetchHtmlWithRetry(ticker);
        const html = response.data;
        const $ = cheerio.load(html);

        let dados = {
            // FIIs
            dy: 'N/A', pvp: 'N/A', segmento: 'N/A', tipo_fundo: 'N/A', mandato: 'N/A',
            vacancia: 'N/A', vp_cota: 'N/A', liquidez: 'N/A', val_mercado: 'N/A',
            patrimonio_liquido: 'N/A', variacao_12m: 'N/A', ultimo_rendimento: 'N/A',
            cnpj: 'N/A', num_cotistas: 'N/A', tipo_gestao: 'N/A', prazo_duracao: 'N/A',
            taxa_adm: 'N/A', cotas_emitidas: 'N/A',
            
            // Ações
            pl: 'N/A', roe: 'N/A', lpa: 'N/A', margem_liquida: 'N/A', 
            divida_liquida_ebitda: 'N/A', ev_ebit: 'N/A', roic: 'N/A'
        };

        let cotacao_atual = 0;
        let num_cotas = 0;

        // 1. VARREDURA POR CLASSES ESPECÍFICAS (MÉTODO MAIS CONFIÁVEL)
        // O site usa classes como "_card pl", "_card roe", etc.
        const getCardValue = (className) => {
            const el = $(`._card.${className} ._card-body span`).first();
            return el.length ? el.text().trim() : null;
        };

        dados.pl = getCardValue('pl') || 'N/A';
        dados.roe = getCardValue('roe') || 'N/A';
        dados.pvp = getCardValue('vp') || getCardValue('p_vp') || 'N/A'; // Às vezes muda a classe
        dados.dy = getCardValue('dy') || 'N/A';
        dados.liquidez = getCardValue('liquidity') || 'N/A';
        dados.val_mercado = getCardValue('val_mercado') || 'N/A';
        dados.vp_cota = getCardValue('val_patrimonial') || 'N/A'; // VPA para ações

        // Pegar cotação para cálculos
        const cotacaoEl = $('._card.cotacao ._card-body span').first();
        if (cotacaoEl.length) cotacao_atual = parseValue(cotacaoEl.text());

        // 2. VARREDURA GENÉRICA (TABELAS E KEY-VALUE)
        const processPair = (tituloRaw, valorRaw) => {
            const titulo = normalize(tituloRaw);
            const valor = valorRaw.trim();
            if (!valor) return;

            // Mapeamentos
            if (dados.dy === 'N/A' && titulo.includes('dividend yield')) dados.dy = valor;
            if (dados.pvp === 'N/A' && (titulo === 'p/vp' || titulo === 'pvp')) dados.pvp = valor;
            if (dados.pl === 'N/A' && titulo === 'p/l') dados.pl = valor;
            if (dados.roe === 'N/A' && titulo === 'roe') dados.roe = valor;
            if (dados.lpa === 'N/A' && titulo === 'lpa') dados.lpa = valor;
            if (dados.roic === 'N/A' && titulo === 'roic') dados.roic = valor;
            if (dados.margem_liquida === 'N/A' && titulo.includes('margem liquida')) dados.margem_liquida = valor;
            if (dados.divida_liquida_ebitda === 'N/A' && titulo.includes('div') && titulo.includes('liq') && titulo.includes('ebit')) dados.divida_liquida_ebitda = valor;
            if (dados.ev_ebit === 'N/A' && titulo.includes('ev/ebit')) dados.ev_ebit = valor;
            
            // FIIs Específicos
            if (dados.segmento === 'N/A' && titulo.includes('segmento')) dados.segmento = valor;
            if (dados.vacancia === 'N/A' && titulo.includes('vacancia')) dados.vacancia = valor;
            if (dados.val_mercado === 'N/A' && titulo.includes('mercado')) dados.val_mercado = valor;
            
            // Metadados
            if (dados.cnpj === 'N/A' && titulo.includes('cnpj')) dados.cnpj = valor;
            if (dados.num_cotistas === 'N/A' && titulo.includes('cotistas')) dados.num_cotistas = valor;
            if (dados.tipo_gestao === 'N/A' && titulo.includes('gestao')) dados.tipo_gestao = valor;
            if (dados.mandato === 'N/A' && titulo.includes('mandato')) dados.mandato = valor;
            if (dados.tipo_fundo === 'N/A' && titulo.includes('tipo de fundo')) dados.tipo_fundo = valor;
        };

        // Varre Cards Genéricos
        $('._card').each((i, el) => processPair($(el).find('._card-header span').text(), $(el).find('._card-body span').text()));
        // Varre Células de Tabela
        $('.cell').each((i, el) => processPair($(el).find('.name').text(), $(el).find('.value').text()));
        // Varre Linhas de Tabela
        $('table tbody tr').each((i, row) => {
            const cols = $(row).find('td');
            if (cols.length >= 2) processPair($(cols[0]).text(), $(cols[1]).text());
        });

        // 3. CÁLCULO DE FALLBACK (VALOR DE MERCADO)
        if (dados.val_mercado === 'N/A' || dados.val_mercado === '-') {
            // Tenta achar numerao de cotas para calcular
            if (cotacao_atual > 0 && num_cotas > 0) {
                 const mkt = cotacao_atual * num_cotas;
                 dados.val_mercado = formatCurrency(mkt);
            }
        }

        return dados;
    } catch (error) {
        console.error(`Erro ao fazer scrape de ${ticker}:`, error.message);
        return { dy: '-', pvp: '-', segmento: '-' };
    }
}

// --- SCRAPER DE HISTÓRICO (DIVIDENDOS) ---
async function scrapeAsset(ticker) {
    try {
        const response = await fetchHtmlWithRetry(ticker);
        const html = response.data;
        const $ = cheerio.load(html);
        const dividendos = [];

        // Tenta achar tabela de dividendos
        let tableRows = $('#table-dividends-history tbody tr');
        
        // Se não achou pelo ID, procura genericamente
        if (tableRows.length === 0) {
            $('table').each((i, tbl) => {
                const header = normalize($(tbl).find('thead').text());
                if (header.includes('com') && header.includes('pagamento')) {
                    tableRows = $(tbl).find('tbody tr');
                    return false; 
                }
            });
        }

        tableRows.each((i, el) => {
            const cols = $(el).find('td');
            if (cols.length >= 4) {
                const dataCom = $(cols[1]).text().trim();
                const dataPag = $(cols[2]).text().trim();
                const valor = $(cols[3]).text().trim();

                dividendos.push({
                    dataCom: parseDate(dataCom),
                    paymentDate: parseDate(dataPag),
                    value: parseValue(valor)
                });
            }
        });
        return dividendos;
    } catch (error) { return []; }
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Cache
    if (req.method === 'GET' || (req.method === 'POST' && req.body.mode !== 'proventos_carteira')) {
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

        if (mode === 'proventos_carteira') {
            if (!payload.fiiList) return res.json({ json: [] });
            const batches = chunkArray(payload.fiiList, 3);
            let finalResults = [];

            for (const batch of batches) {
                const promises = batch.map(async (item) => {
                    const ticker = typeof item === 'string' ? item : item.ticker;
                    const limit = typeof item === 'string' ? 24 : (item.limit || 24);
                    const history = await scrapeAsset(ticker);
                    const recents = history.filter(h => h.paymentDate && h.value > 0).slice(0, limit);
                    if (recents.length > 0) return recents.map(r => ({ symbol: ticker.toUpperCase(), ...r }));
                    return null;
                });
                
                const batchResults = await Promise.all(promises);
                finalResults = finalResults.concat(batchResults);
                if (batches.length > 1) await new Promise(r => setTimeout(r, 500)); 
            }
            return res.status(200).json({ json: finalResults.filter(d => d !== null).flat() });
        }

        if (mode === 'historico_12m') {
            if (!payload.ticker) return res.json({ json: [] });
            const history = await scrapeAsset(payload.ticker);
            const formatted = history.slice(0, 18).map(h => {
                if (!h.paymentDate) return null;
                const [ano, mes] = h.paymentDate.split('-');
                return { mes: `${mes}/${ano.substring(2)}`, valor: h.value };
            }).filter(h => h !== null);
            return res.status(200).json({ json: formatted });
        }

        if (mode === 'historico_portfolio') {
            if (!payload.fiiList) return res.json({ json: [] });
            const batches = chunkArray(payload.fiiList, 3); 
            let all = [];
            for (const batch of batches) {
                const promises = batch.map(async (ticker) => {
                    const history = await scrapeAsset(ticker);
                    history.slice(0, 24).forEach(h => {
                        if (h.value > 0) all.push({ symbol: ticker.toUpperCase(), ...h });
                    });
                });
                await Promise.all(promises);
                if (batches.length > 1) await new Promise(r => setTimeout(r, 500));
            }
            return res.status(200).json({ json: all });
        }

        if (mode === 'proximo_provento') {
            if (!payload.ticker) return res.json({ json: null });
            const history = await scrapeAsset(payload.ticker);
            const ultimo = history.length > 0 ? history[0] : null;
            return res.status(200).json({ json: ultimo });
        }

        return res.status(400).json({ error: "Modo desconhecido" });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
