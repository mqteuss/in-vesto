const axios = require('axios');
const cheerio = require('cheerio');

const client = axios.create({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    },
    timeout: 9000
});

function parseDate(dateStr) {
    if (!dateStr || dateStr === '-') return null;
    const parts = dateStr.trim().split('/');
    if (parts.length !== 3) return null;
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function parseValue(valueStr) {
    if (!valueStr) return 0;
    try {
        return parseFloat(valueStr.replace(/[^0-9,-]+/g, "").replace(',', '.')) || 0;
    } catch (e) { return 0; }
}

function formatCurrency(value) {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function normalize(str) {
    if (!str) return '';
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

// --- SCRAPER DE FUNDAMENTOS ---
async function scrapeFundamentos(ticker) {
    try {
        let url = `https://investidor10.com.br/fiis/${ticker.toLowerCase()}/`;
        let response;

        try {
            response = await client.get(url);
        } catch (e) {
            if (e.response && e.response.status === 404) {
                url = `https://investidor10.com.br/acoes/${ticker.toLowerCase()}/`;
                response = await client.get(url);
            } else { throw e; }
        }

        const html = response.data;
        const $ = cheerio.load(html);

        let dados = {
            dy: 'N/A',
            pvp: 'N/A',
            segmento: 'N/A',
            vacancia: 'N/A',
            vp_cota: 'N/A',
            liquidez: 'N/A',
            val_mercado: 'N/A',
            patrimonio_liquido: 'N/A',
            variacao_12m: 'N/A',
            ultimo_rendimento: 'N/A'
        };
        
        let cotacao_atual = 0;
        let num_cotas = 0;

        // 1. MÉTODO ANTIGO (CLÁSSICO) - PRIORIDADE DY/PVP
        const dyEl = $('._card.dy ._card-body span').first();
        if (dyEl.length) dados.dy = dyEl.text().trim();

        const pvpEl = $('._card.vp ._card-body span').first();
        if (pvpEl.length) dados.pvp = pvpEl.text().trim();

        const liqEl = $('._card.liquidity ._card-body span').first();
        if (liqEl.length) dados.liquidez = liqEl.text().trim();

        // Tenta pegar VP por Cota direto da classe específica se existir
        const valPatEl = $('._card.val_patrimonial ._card-body span').first();
        if (valPatEl.length) dados.vp_cota = valPatEl.text().trim();

        const cotacaoEl = $('._card.cotacao ._card-body span').first();
        if (cotacaoEl.length) cotacao_atual = parseValue(cotacaoEl.text());

        // 2. VARREDURA (LOOP)
        const scanElements = (elements, contextStr) => {
            $(elements).each((i, el) => {
                let titulo = '', valor = '';
                
                if (contextStr === 'card') {
                    titulo = normalize($(el).find('._card-header span').text());
                    valor = $(el).find('._card-body span').text().trim();
                } else { // cell
                    titulo = normalize($(el).find('.name').text());
                    valor = $(el).find('.value').text().trim();
                }

                if (valor) {
                    if (dados.dy === 'N/A' && titulo.includes('dividend yield')) dados.dy = valor;
                    if (dados.pvp === 'N/A' && titulo.includes('p/vp')) dados.pvp = valor;
                    if (dados.liquidez === 'N/A' && titulo.includes('liquidez')) dados.liquidez = valor;
                    
                    if (dados.segmento === 'N/A' && titulo.includes('segmento')) dados.segmento = valor;
                    if (dados.vacancia === 'N/A' && titulo.includes('vacancia')) dados.vacancia = valor;
                    if (dados.val_mercado === 'N/A' && titulo.includes('mercado')) dados.val_mercado = valor;
                    if (dados.ultimo_rendimento === 'N/A' && titulo.includes('ultimo rendimento')) dados.ultimo_rendimento = valor;
                    if (dados.variacao_12m === 'N/A' && titulo.includes('variacao') && titulo.includes('12m')) dados.variacao_12m = valor;

                    // --- CORREÇÃO AQUI ---
                    // Se tem "cota", é VP por Cota.
                    if (titulo.includes('patrimonial') && titulo.includes('cota')) {
                        dados.vp_cota = valor;
                    } 
                    // Se tem "patrimonio" ou "patrimonial" MAS NÃO TEM "cota", é o Patrimônio Líquido Total
                    else if ((titulo.includes('patrimonio') || titulo.includes('patrimonial')) && !titulo.includes('cota')) {
                        dados.patrimonio_liquido = valor;
                    }

                    if (titulo.includes('cotas') && titulo.includes('num')) {
                        num_cotas = parseValue(valor);
                    }
                }
            });
        };

        scanElements('._card', 'card');
        scanElements('.cell', 'cell');

        // 3. CÁLCULO DE FALLBACK (Valor de Mercado)
        if ((dados.val_mercado === 'N/A' || dados.val_mercado === '-') && cotacao_atual > 0 && num_cotas > 0) {
            const mercadoCalc = cotacao_atual * num_cotas;
            if (mercadoCalc > 1000000000) dados.val_mercado = `R$ ${(mercadoCalc / 1000000000).toFixed(2)} Bilhões`;
            else if (mercadoCalc > 1000000) dados.val_mercado = `R$ ${(mercadoCalc / 1000000).toFixed(2)} Milhões`;
            else dados.val_mercado = formatCurrency(mercadoCalc);
        }

        return dados;

    } catch (error) {
        console.warn(`[Scraper] Falha: ${error.message}`);
        return { 
            dy: '-', pvp: '-', segmento: '-', vacancia: '-', 
            vp_cota: '-', liquidez: '-', val_mercado: '-', 
            ultimo_rendimento: '-', patrimonio_liquido: '-', variacao_12m: '-'
        }; 
    }
}

// --- SCRAPER DE HISTÓRICO ---
async function scrapeAsset(ticker) {
    try {
        let url = `https://investidor10.com.br/fiis/${ticker.toLowerCase()}/`;
        let response;
        try {
            response = await client.get(url);
        } catch (e) {
            if (e.response && e.response.status === 404) {
                url = `https://investidor10.com.br/acoes/${ticker.toLowerCase()}/`;
                response = await client.get(url);
            } else { throw e; }
        }

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
    } catch (error) {
        return []; 
    }
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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
            const promises = payload.fiiList.map(async (ticker) => {
                const history = await scrapeAsset(ticker);
                const recents = history.filter(h => h.paymentDate && h.value > 0).slice(0, 3);
                if (recents.length > 0) return recents.map(r => ({ symbol: ticker.toUpperCase(), ...r }));
                return null;
            });
            const data = await Promise.all(promises);
            return res.status(200).json({ json: data.filter(d => d !== null).flat() });
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
            let all = [];
            const promises = payload.fiiList.map(async (ticker) => {
                const history = await scrapeAsset(ticker);
                history.slice(0, 24).forEach(h => {
                    if (h.value > 0) all.push({ symbol: ticker.toUpperCase(), ...h });
                });
            });
            await Promise.all(promises);
            return res.status(200).json({ json: all });
        }

        return res.status(400).json({ error: "Modo desconhecido" });

    } catch (error) {
        console.error("SCRAPER ERROR:", error);
        return res.status(500).json({ error: error.message });
    }
};
