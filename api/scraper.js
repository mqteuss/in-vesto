const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// Agente HTTPS com Keep-Alive para reutilizar conexões TCP
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
    timeout: 9000
});

// Pré-compilação de Regex
const REGEX_CLEAN_NUMBER = /[^0-9,-]+/g;
const REGEX_NORMALIZE = /[\u0300-\u036f]/g;

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
    if (lower.includes('b') && !lower.includes('bilh')) return val * 1000000000; // B (inglês)
    if (lower.includes('bilh')) return val * 1000000000;
    if (lower.includes('m') && !lower.includes('milh')) return val * 1000000; // M (inglês)
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

async function fetchHtmlWithRetry(ticker) {
    const tickerUpper = ticker.toUpperCase();
    try {
        // Status Invest usa URLs em maiúscula
        return await client.get(`https://statusinvest.com.br/fundos-imobiliarios/${tickerUpper}`);
    } catch (e) {
        if (e.response && e.response.status === 404) {
            // Fallback para ações
            return await client.get(`https://statusinvest.com.br/acoes/${tickerUpper}`);
        }
        throw e;
    }
}

// --- SCRAPER DE FUNDAMENTOS ---
async function scrapeFundamentos(ticker) {
    try {
        const response = await fetchHtmlWithRetry(ticker);
        const html = response.data;
        const $ = cheerio.load(html);

        let dados = {
            dy: 'N/A', pvp: 'N/A', segmento: 'N/A', tipo_fundo: 'N/A', mandato: 'N/A',
            vacancia: 'N/A', vp_cota: 'N/A', liquidez: 'N/A', val_mercado: 'N/A',
            patrimonio_liquido: 'N/A', variacao_12m: 'N/A', ultimo_rendimento: 'N/A',
            cnpj: 'N/A', num_cotistas: 'N/A', tipo_gestao: 'N/A', prazo_duracao: 'N/A',
            taxa_adm: 'N/A', cotas_emitidas: 'N/A'
        };

        // Status Invest: Cards principais (top-info)
        $('.top-info .info .value').each((i, el) => {
            const value = $(el).text().trim();
            const title = normalize($(el).siblings('.title, .legend').text());
            
            if (title.includes('dividend yield') || title.includes('d.y')) dados.dy = value;
            if (title.includes('p/vp') || title.includes('pvp')) dados.pvp = value;
            if (title.includes('liquidez')) dados.liquidez = value;
            if (title.includes('valor patrimonial') || title.includes('v.p')) dados.vp_cota = value;
            if (title.includes('cotacao') || title.includes('ultimo')) dados.cotacao = value;
        });

        // Indicadores principais
        $('.indicator-today-container .item').each((i, el) => {
            const title = normalize($(el).find('.title, .sub-value').text());
            const value = $(el).find('.value').text().trim();
            
            if (title.includes('vacancia')) dados.vacancia = value;
            if (title.includes('dividend yield')) dados.dy = value;
            if (title.includes('p/vp')) dados.pvp = value;
            if (title.includes('liquidez')) dados.liquidez = value;
            if (title.includes('valor de mercado')) dados.val_mercado = value;
            if (title.includes('patrimonio')) dados.patrimonio_liquido = value;
            if (title.includes('valor patrimonial')) dados.vp_cota = value;
        });

        // Lista de informações detalhadas
        $('.info .d-flex, .list .item').each((i, el) => {
            const title = normalize($(el).find('.title, strong, .info-title').text());
            const value = $(el).find('.value, .info-value').text().trim();
            
            if (!value || value === '-') return;

            if (title.includes('segmento')) dados.segmento = value;
            if (title.includes('tipo') && title.includes('fundo')) dados.tipo_fundo = value;
            if (title.includes('mandato')) dados.mandato = value;
            if (title.includes('cnpj')) dados.cnpj = value;
            if (title.includes('cotistas')) dados.num_cotistas = value;
            if (title.includes('gestao') || title.includes('tipo de gestao')) dados.tipo_gestao = value;
            if (title.includes('prazo')) dados.prazo_duracao = value;
            if (title.includes('taxa') && title.includes('adm')) dados.taxa_adm = value;
            if (title.includes('cotas emitidas')) dados.cotas_emitidas = value;
            if (title.includes('ultimo rendimento')) dados.ultimo_rendimento = value;
            if (title.includes('variacao') && title.includes('12')) dados.variacao_12m = value;
        });

        // Tabelas genéricas
        $('table tbody tr').each((i, row) => {
            const cols = $(row).find('td');
            if (cols.length >= 2) {
                const title = normalize($(cols[0]).text());
                const value = $(cols[1]).text().trim();
                
                if (!value || value === '-') return;
                
                if (title.includes('segmento')) dados.segmento = value;
                if (title.includes('vacancia')) dados.vacancia = value;
                if (title.includes('tipo') && title.includes('fundo')) dados.tipo_fundo = value;
                if (title.includes('patrimonio')) dados.patrimonio_liquido = value;
                if (title.includes('cotistas')) dados.num_cotistas = value;
                if (title.includes('gestao')) dados.tipo_gestao = value;
            }
        });

        return dados;
    } catch (error) {
        console.error(`Erro ao buscar fundamentos de ${ticker}:`, error.message);
        return { dy: '-', pvp: '-', segmento: '-' };
    }
}

// --- SCRAPER DE HISTÓRICO ---
async function scrapeAsset(ticker) {
    try {
        const response = await fetchHtmlWithRetry(ticker);
        const html = response.data;
        const $ = cheerio.load(html);
        const dividendos = [];

        // Status Invest: Tabela de dividendos
        let tableRows = $('#earning-section table tbody tr, .table-dividends tbody tr');
        
        if (tableRows.length === 0) {
            // Fallback: procura qualquer tabela com cabeçalhos relevantes
            $('table').each((i, tbl) => {
                const header = normalize($(tbl).find('thead').text());
                if (header.includes('data com') || header.includes('pagamento') || header.includes('rendimento')) {
                    tableRows = $(tbl).find('tbody tr');
                    return false; 
                }
            });
        }

        tableRows.each((i, el) => {
            const cols = $(el).find('td');
            if (cols.length >= 3) {
                // Status Invest geralmente tem: Data Com | Data Pagamento | Valor | Rendimento
                const dataCom = $(cols[0]).text().trim();
                const dataPag = $(cols[1]).text().trim();
                const valor = $(cols[2]).text().trim() || $(cols[3]).text().trim();

                const parsedDataCom = parseDate(dataCom);
                const parsedDataPag = parseDate(dataPag);
                const parsedValor = parseValue(valor);

                if (parsedDataPag && parsedValor > 0) {
                    dividendos.push({
                        dataCom: parsedDataCom,
                        paymentDate: parsedDataPag,
                        value: parsedValor
                    });
                }
            }
        });

        return dividendos;
    } catch (error) { 
        console.error(`Erro ao buscar histórico de ${ticker}:`, error.message);
        return []; 
    }
}

module.exports = async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Cache Headers
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
                    
                    const recents = history
                        .filter(h => h.paymentDate && h.value > 0)
                        .slice(0, limit);

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
        console.error('Erro no handler:', error);
        return res.status(500).json({ error: error.message });
    }
};