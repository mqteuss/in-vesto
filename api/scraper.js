const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// OTIMIZAÇÃO 1: Agente HTTPS com Keep-Alive para reutilizar conexões TCP
// Isso acelera muito requisições em lote (portfolio).
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
        'Accept-Encoding': 'gzip, deflate, br' // Garante compressão
    },
    timeout: 9000
});

// OTIMIZAÇÃO 2: Pré-compilação de Regex (evita recriar a cada chamada)
const REGEX_CLEAN_NUMBER = /[^0-9,-]+/g;
const REGEX_NORMALIZE = /[\u0300-\u036f]/g;

function parseDate(dateStr) {
    if (!dateStr || dateStr === '-') return null;
    // Otimização simples de string sem regex complexo
    const parts = dateStr.trim().split('/');
    if (parts.length !== 3) return null;
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function parseValue(valueStr) {
    if (!valueStr) return 0;
    try {
        // Usa a regex pré-compilada
        return parseFloat(valueStr.replace(REGEX_CLEAN_NUMBER, "").replace(',', '.')) || 0;
    } catch (e) { return 0; }
}

function parseExtendedValue(str) {
    if (!str) return 0;
    const val = parseValue(str);
    const lower = str.toLowerCase();
    // Multiplicadores
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

// Helper para evitar duplicar a lógica de try/catch de URL
async function fetchHtmlWithRetry(ticker) {
    const tickerLower = ticker.toLowerCase();
    try {
        // Tenta FII
        return await client.get(`https://investidor10.com.br/fiis/${tickerLower}/`);
    } catch (e) {
        if (e.response && e.response.status === 404) {
            // Fallback para Ações (mantendo a lógica original)
            return await client.get(`https://investidor10.com.br/acoes/${tickerLower}/`);
        }
        throw e;
    }
}

// --- SCRAPER DE FUNDAMENTOS ---
// --- SCRAPER DE FUNDAMENTOS (ATUALIZADO PARA AÇÕES) ---
async function scrapeFundamentos(ticker) {
    try {
        const response = await fetchHtmlWithRetry(ticker);
        const html = response.data;
        const $ = cheerio.load(html);

        // 1. Dicionário Híbrido (Campos de FIIs + Campos de Ações)
        let dados = {
            // Comuns / FIIs
            dy: 'N/A', pvp: 'N/A', segmento: 'N/A', tipo_fundo: 'N/A', mandato: 'N/A',
            vacancia: 'N/A', vp_cota: 'N/A', liquidez: 'N/A', val_mercado: 'N/A',
            patrimonio_liquido: 'N/A', variacao_12m: 'N/A', ultimo_rendimento: 'N/A',
            cnpj: 'N/A', num_cotistas: 'N/A', tipo_gestao: 'N/A', prazo_duracao: 'N/A',
            taxa_adm: 'N/A', cotas_emitidas: 'N/A',
            
            // Novos campos para Ações
            pl: 'N/A', roe: 'N/A', lpa: 'N/A', margem_liquida: 'N/A', 
            divida_liquida_ebitda: 'N/A', ev_ebit: 'N/A', roic: 'N/A'
        };

        let cotacao_atual = 0;
        let num_cotas = 0;

        const processPair = (tituloRaw, valorRaw) => {
            const titulo = normalize(tituloRaw);
            const valor = valorRaw.trim();
            if (!valor) return;

            // --- Mapeamentos Existentes ---
            if (dados.dy === 'N/A' && titulo.includes('dividend yield')) dados.dy = valor;
            if (dados.pvp === 'N/A' && titulo.includes('p/vp')) dados.pvp = valor;
            if (dados.liquidez === 'N/A' && titulo.includes('liquidez')) dados.liquidez = valor;
            if (dados.segmento === 'N/A' && titulo.includes('segmento')) dados.segmento = valor;
            if (dados.vacancia === 'N/A' && titulo.includes('vacancia')) dados.vacancia = valor;
            if (dados.val_mercado === 'N/A' && titulo.includes('mercado')) dados.val_mercado = valor;
            if (dados.ultimo_rendimento === 'N/A' && titulo.includes('ultimo rendimento')) dados.ultimo_rendimento = valor;
            if (dados.variacao_12m === 'N/A' && titulo.includes('variacao') && titulo.includes('12m')) dados.variacao_12m = valor;
            
            // --- Novos Mapeamentos de Ações ---
            if (dados.pl === 'N/A' && titulo === 'p/l') dados.pl = valor;
            if (dados.roe === 'N/A' && titulo === 'roe') dados.roe = valor;
            if (dados.lpa === 'N/A' && titulo === 'lpa') dados.lpa = valor;
            if (dados.roic === 'N/A' && titulo === 'roic') dados.roic = valor;
            if (dados.margem_liquida === 'N/A' && titulo.includes('margem liquida')) dados.margem_liquida = valor;
            if (dados.divida_liquida_ebitda === 'N/A' && titulo.includes('div. liquida') && titulo.includes('ebitda')) dados.divida_liquida_ebitda = valor;
            if (dados.ev_ebit === 'N/A' && titulo.includes('ev/ebit')) dados.ev_ebit = valor;

            // ... (Resto dos mapeamentos originais mantidos: CNPJ, Gestão, etc) ...
            if (dados.cnpj === 'N/A' && titulo.includes('cnpj')) dados.cnpj = valor;
            if (dados.num_cotistas === 'N/A' && titulo.includes('cotistas')) dados.num_cotistas = valor;
            if (dados.tipo_gestao === 'N/A' && titulo.includes('gestao')) dados.tipo_gestao = valor;
            if (dados.mandato === 'N/A' && titulo.includes('mandato')) dados.mandato = valor;
            if (dados.tipo_fundo === 'N/A' && titulo.includes('tipo de fundo')) dados.tipo_fundo = valor;
            if (dados.prazo_duracao === 'N/A' && titulo.includes('prazo')) dados.prazo_duracao = valor;
            if (dados.taxa_adm === 'N/A' && titulo.includes('taxa') && titulo.includes('administracao')) dados.taxa_adm = valor;
            if (dados.cotas_emitidas === 'N/A' && titulo.includes('cotas emitidas')) dados.cotas_emitidas = valor;

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

        // Extração por Cards (Otimização para Investidor10)
        // Adicionando P/L que costuma ter destaque em ações
        const plEl = $('._card.pl ._card-body span').first();
        if (plEl.length) dados.pl = plEl.text().trim();
        
        const dyEl = $('._card.dy ._card-body span').first();
        if (dyEl.length) dados.dy = dyEl.text().trim();
        const pvpEl = $('._card.vp ._card-body span').first();
        if (pvpEl.length) dados.pvp = pvpEl.text().trim();
        const liqEl = $('._card.liquidity ._card-body span').first();
        if (liqEl.length) dados.liquidez = liqEl.text().trim();
        const valPatEl = $('._card.val_patrimonial ._card-body span').first();
        if (valPatEl.length) dados.vp_cota = valPatEl.text().trim();
        const cotacaoEl = $('._card.cotacao ._card-body span').first();
        if (cotacaoEl.length) cotacao_atual = parseValue(cotacaoEl.text());

        // Varredura Geral
        $('._card').each((i, el) => processPair($(el).find('._card-header span').text(), $(el).find('._card-body span').text()));
        $('.cell').each((i, el) => processPair($(el).find('.name').text(), $(el).find('.value').text()));
        $('table tbody tr').each((i, row) => {
            const cols = $(row).find('td');
            if (cols.length >= 2) processPair($(cols[0]).text(), $(cols[1]).text());
        });

        // Lógica de Market Cap (Mantida igual)
        if (dados.val_mercado === 'N/A' || dados.val_mercado === '-') {
            let mercadoCalc = 0;
            if (cotacao_atual > 0 && num_cotas > 0) mercadoCalc = cotacao_atual * num_cotas;
            else if (dados.patrimonio_liquido !== 'N/A' && dados.pvp !== 'N/A') {
                const plValue = parseExtendedValue(dados.patrimonio_liquido);
                const pvpValue = parseValue(dados.pvp);
                if (plValue > 0 && pvpValue > 0) mercadoCalc = plValue * pvpValue;
            }
            if (mercadoCalc > 0) {
                if (mercadoCalc > 1000000000) dados.val_mercado = `R$ ${(mercadoCalc / 1000000000).toFixed(2)} Bilhões`;
                else if (mercadoCalc > 1000000) dados.val_mercado = `R$ ${(mercadoCalc / 1000000).toFixed(2)} Milhões`;
                else dados.val_mercado = formatCurrency(mercadoCalc);
            }
        }

        return dados;
    } catch (error) {
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

        let tableRows = $('#table-dividends-history tbody tr');
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
    // CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // OTIMIZAÇÃO 3: Cache Headers (Importantíssimo)
    // Cacheia a resposta por 1 hora (3600s) na CDN da Vercel.
    // O 'stale-while-revalidate' serve o cache antigo enquanto atualiza em segundo plano.
    if (req.method === 'GET' || (req.method === 'POST' && req.body.mode !== 'proventos_carteira')) {
       // Evitamos cache em 'proventos_carteira' se ele for muito dinâmico ou grande, 
       // mas para fundamentos e histórico é seguro.
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
            
            // fiiList agora será um array de objetos: [{ ticker: 'MXRF11', limit: 12 }, ...]
            const batches = chunkArray(payload.fiiList, 3);
            let finalResults = [];

            for (const batch of batches) {
                const promises = batch.map(async (item) => {
                    // Verifica se o item é string (legado) ou objeto (novo formato)
                    const ticker = typeof item === 'string' ? item : item.ticker;
                    // Se for string, assume 24 (padrão antigo). Se for objeto, usa o limite calculado.
                    const limit = typeof item === 'string' ? 24 : (item.limit || 24);

                    const history = await scrapeAsset(ticker);
                    
                    // AQUI APLICAMOS O CORTE INTELIGENTE
                    const recents = history
                        .filter(h => h.paymentDate && h.value > 0)
                        .slice(0, limit); // Corta exatamente onde o App.js pediu

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