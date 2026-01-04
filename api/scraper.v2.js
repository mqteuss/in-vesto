const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// --- OTIMIZAÇÃO: AGENTE HTTPS ---
const httpsAgent = new https.Agent({ 
    keepAlive: true,
    maxSockets: 100,
    maxFreeSockets: 10,
    timeout: 15000
});

const client = axios.create({
    httpsAgent,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br'
    },
    timeout: 10000
});

// --- HELPERS ---
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

// ---------------------------------------------------------
// PARTE 1: FUNDAMENTOS -> INVESTIDOR10 (COM A LÓGICA ORIGINAL RESTAURADA)
// ---------------------------------------------------------

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

async function scrapeFundamentos(ticker) {
    try {
        let html;
        try {
            const res = await client.get(`https://investidor10.com.br/fiis/${ticker.toLowerCase()}/`);
            html = res.data;
        } catch (e) {
            const res = await client.get(`https://investidor10.com.br/acoes/${ticker.toLowerCase()}/`);
            html = res.data;
        }

        const $ = cheerio.load(html);

        let dados = {
            dy: 'N/A', pvp: 'N/A', segmento: 'N/A', tipo_fundo: 'N/A', mandato: 'N/A',
            vacancia: 'N/A', vp_cota: 'N/A', liquidez: 'N/A', val_mercado: 'N/A',
            patrimonio_liquido: 'N/A', variacao_12m: 'N/A', ultimo_rendimento: 'N/A',
            cnpj: 'N/A', num_cotistas: 'N/A', tipo_gestao: 'N/A', prazo_duracao: 'N/A',
            taxa_adm: 'N/A', cotas_emitidas: 'N/A'
        };

        let cotacao_atual = 0;
        let num_cotas = 0;

        const processPair = (tituloRaw, valorRaw) => {
            const titulo = normalize(tituloRaw);
            const valor = valorRaw.trim();
            if (!valor) return;

            if (dados.dy === 'N/A' && titulo.includes('dividend yield')) dados.dy = valor;
            if (dados.pvp === 'N/A' && titulo.includes('p/vp')) dados.pvp = valor;
            if (dados.liquidez === 'N/A' && titulo.includes('liquidez')) dados.liquidez = valor;
            if (dados.segmento === 'N/A' && titulo.includes('segmento')) dados.segmento = valor;
            if (dados.vacancia === 'N/A' && titulo.includes('vacancia')) dados.vacancia = valor;
            if (dados.val_mercado === 'N/A' && titulo.includes('mercado')) dados.val_mercado = valor;
            if (dados.ultimo_rendimento === 'N/A' && titulo.includes('ultimo rendimento')) dados.ultimo_rendimento = valor;
            if (dados.variacao_12m === 'N/A' && titulo.includes('variacao') && titulo.includes('12m')) dados.variacao_12m = valor;
            if (dados.cnpj === 'N/A' && titulo.includes('cnpj')) dados.cnpj = valor;
            if (dados.num_cotistas === 'N/A' && titulo.includes('cotistas')) dados.num_cotistas = valor;
            if (dados.tipo_gestao === 'N/A' && titulo.includes('gestao')) dados.tipo_gestao = valor;
            if (dados.mandato === 'N/A' && titulo.includes('mandato')) dados.mandato = valor;
            if (dados.tipo_fundo === 'N/A' && titulo.includes('tipo de fundo')) dados.tipo_fundo = valor;
            if (dados.prazo_duracao === 'N/A' && titulo.includes('prazo')) dados.prazo_duracao = valor;
            if (dados.taxa_adm === 'N/A' && titulo.includes('taxa') && titulo.includes('administracao')) dados.taxa_adm = valor;
            if (dados.cotas_emitidas === 'N/A' && titulo.includes('cotas emitidas')) dados.cotas_emitidas = valor;

            // --- CORREÇÃO AQUI: Lógica Original Restaurada ---
            if (titulo.includes('patrimonial') || titulo.includes('patrimonio')) {
                const valorNumerico = parseValue(valor);
                const textoLower = valor.toLowerCase();
                // Verifica se tem "milh", "bilh" ou se é um número muito grande
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

        $('._card').each((i, el) => processPair($(el).find('._card-header span').text(), $(el).find('._card-body span').text()));
        $('.cell').each((i, el) => processPair($(el).find('.name').text(), $(el).find('.value').text()));
        $('table tbody tr').each((i, row) => {
            const cols = $(row).find('td');
            if (cols.length >= 2) processPair($(cols[0]).text(), $(cols[1]).text());
        });

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

        return dados;
    } catch (error) {
        return { dy: '-', pvp: '-', segmento: '-' };
    }
}

// ---------------------------------------------------------
// PARTE 2: HISTÓRICO -> STATUS INVEST (MANTIDO API JSON)
// ---------------------------------------------------------

async function scrapeAsset(ticker) {
    try {
        const t = ticker.toUpperCase();
        let type = 'acao';
        if (t.endsWith('11') || t.endsWith('11B')) type = 'fii'; 
        
        const url = `https://statusinvest.com.br/${type}/companytickerprovents?ticker=${t}&chartProventsType=2`;

        const { data } = await client.get(url, { 
            headers: { 
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': 'https://statusinvest.com.br/',
                'Origin': 'https://statusinvest.com.br'
            } 
        });

        const earnings = data.assetEarningsModels || [];

        const dividendos = earnings.map(d => {
            const parseDateJSON = (dStr) => {
                if(!dStr) return null;
                const parts = dStr.split('/');
                return `${parts[2]}-${parts[1]}-${parts[0]}`;
            };

            return {
                dataCom: parseDateJSON(d.ed),
                paymentDate: parseDateJSON(d.pd),
                value: d.v,
                type: d.et
            };
        });

        return dividendos.sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));

    } catch (error) { 
        console.error(`Erro StatusInvest API ${ticker}:`, error.message);
        return []; 
    }
}

// ---------------------------------------------------------
// HANDLER PRINCIPAL
// ---------------------------------------------------------

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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

        // --- ATUALIZAÇÃO: Adicionado 'historico_portfolio' no mesmo bloco ---
        if (mode === 'proventos_carteira' || mode === 'historico_portfolio') {
            if (!payload.fiiList) return res.json({ json: [] });
            
            const batches = chunkArray(payload.fiiList, 3);
            let finalResults = [];

            for (const batch of batches) {
                const promises = batch.map(async (item) => {
                    const ticker = typeof item === 'string' ? item : item.ticker;
                    // Se for historico_portfolio (chart), garantimos um limite maior (ex: 24) se não vier especificado
                    const defaultLimit = mode === 'historico_portfolio' ? 36 : 24;
                    const limit = typeof item === 'string' ? defaultLimit : (item.limit || defaultLimit);

                    const history = await scrapeAsset(ticker);
                    
                    const recents = history
                        .filter(h => h.paymentDate && h.value > 0)
                        .slice(0, limit);

                    if (recents.length > 0) return recents.map(r => ({ symbol: ticker.toUpperCase(), ...r }));
                    return null;
                });
                
                const batchResults = await Promise.all(promises);
                finalResults = finalResults.concat(batchResults);
                if (batches.length > 1) await new Promise(r => setTimeout(r, 600)); 
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