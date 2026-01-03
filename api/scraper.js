const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// OTIMIZAÇÃO 1: Agente HTTPS com Keep-Alive
const httpsAgent = new https.Agent({ 
    keepAlive: true,
    maxSockets: 100,
    maxFreeSockets: 10,
    timeout: 10000
});

// Headers atualizados para parecer um navegador real acessando o Status Invest
const client = axios.create({
    httpsAgent,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://statusinvest.com.br/',
        'Origin': 'https://statusinvest.com.br'
    },
    timeout: 9000
});

const REGEX_CLEAN_NUMBER = /[^0-9,-]+/g;

function parseValue(valueStr) {
    if (!valueStr) return 0;
    if (typeof valueStr === 'number') return valueStr; // Caso venha do JSON
    try {
        return parseFloat(valueStr.replace(REGEX_CLEAN_NUMBER, "").replace(',', '.')) || 0;
    } catch (e) { return 0; }
}

function parseExtendedValue(str) {
    if (!str) return 0;
    const val = parseValue(str);
    const lower = str.toLowerCase();
    if (lower.includes('b')) return val * 1000000000; // Bilhões (Status usa B/M/K as vezes)
    if (lower.includes('m')) return val * 1000000;
    if (lower.includes('k')) return val * 1000;
    return val;
}

function formatCurrency(value) {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function chunkArray(array, size) {
    const results = [];
    for (let i = 0; i < array.length; i += size) {
        results.push(array.slice(i, i + size));
    }
    return results;
}

// Helper para determinar tipo de ativo (Ação vs FII) para montar URL
function getAssetType(ticker) {
    const t = ticker.toUpperCase();
    // Lógica básica: final 11 costuma ser FII ou Unit, outros (3,4,5,6) ações.
    // O Status Invest é chato com URL errada, então tentaremos inferir.
    if (t.endsWith('11') || t.endsWith('11B')) return 'fundos-imobiliarios'; // Pode ser Unit, mas a API de FII costuma redirecionar ou tratar
    return 'acoes';
}

// API INTERNA DO STATUS INVEST PARA PROVENTOS (Muito mais rápido que HTML)
async function fetchProventosJson(ticker) {
    const type = getAssetType(ticker) === 'fundos-imobiliarios' ? 'fii' : 'acao';
    const url = `https://statusinvest.com.br/${type}/companytickerprovents?ticker=${ticker}&chartProventsType=2`;
    
    try {
        const { data } = await client.get(url, { 
            headers: { 'X-Requested-With': 'XMLHttpRequest' } // Importante para API interna
        });
        return data.assetEarningsModels || [];
    } catch (e) {
        console.error(`Erro ao buscar proventos JSON ${ticker}:`, e.message);
        return [];
    }
}

async function fetchFundamentosHtml(ticker) {
    const type = getAssetType(ticker);
    try {
        return await client.get(`https://statusinvest.com.br/${type}/${ticker.toLowerCase()}`);
    } catch (e) {
        // Se falhar FII, tenta Ação (caso seja uma Unit final 11 que caiu na regra errada)
        if (type === 'fundos-imobiliarios') {
            return await client.get(`https://statusinvest.com.br/acoes/${ticker.toLowerCase()}`);
        }
        throw e;
    }
}

// --- SCRAPER DE FUNDAMENTOS (Status Invest) ---
async function scrapeFundamentos(ticker) {
    try {
        const response = await fetchFundamentosHtml(ticker);
        const html = response.data;
        const $ = cheerio.load(html);

        let dados = {
            dy: 'N/A', pvp: 'N/A', segmento: 'N/A', tipo_fundo: 'N/A',
            vacancia: 'N/A', vp_cota: 'N/A', liquidez: 'N/A', val_mercado: 'N/A',
            patrimonio_liquido: 'N/A', ultimo_rendimento: 'N/A', cotacao: 'N/A'
        };

        // Helper para extrair valor baseado no título do card (Status Invest usa muito isso)
        const getCardValue = (titleKey) => {
            // Procura divs que contenham o título e pega o valor irmão
            const titleEl = $(`.title:contains("${titleKey}")`).first();
            if (titleEl.length) {
                // A estrutura geralmente é div > h3.title + strong.value
                return titleEl.parent().find('.value').text().trim();
            }
            return null;
        };

        // Extração Cards Superiores
        dados.dy = getCardValue('Dividend Yield') || 'N/A';
        dados.pvp = getCardValue('P/VP') || 'N/A';
        dados.cotacao = getCardValue('Valor atual') || 'N/A';
        
        // P/VP as vezes aparece diferente em ações (P/L, etc), mas P/VP existe para ambos
        if (dados.pvp === 'N/A') {
            // Tenta seletor específico de PVP
            const pvpSpecific = $('div[title="Preço sobre Valor Patrimonial"] .value').text();
            if(pvpSpecific) dados.pvp = pvpSpecific;
        }

        // Liquidez Média Diária
        dados.liquidez = getCardValue('Liquidez média diária') || 'N/A';

        // Valor de Mercado e Patrimônio (Muitas vezes no rodapé ou seção geral)
        // Status Invest coloca isso numa seção de "Valor de mercado"
        $('.top-info .info').each((i, el) => {
            const title = $(el).find('.title').text();
            if (title.includes('Valor de mercado')) dados.val_mercado = $(el).find('.value').text();
            // Para FIIs, as vezes é "Valor Patrimonial"
        });

        // Tenta buscar VP por Cota e Valor Patrimonial
        // FIIs geralmente têm uma seção específica
        const vpCotaEl = $(`.info.special:contains("Valor patrimonial p/cota") .value`).first();
        if (vpCotaEl.length) dados.vp_cota = vpCotaEl.text();

        // Dados extra de FII
        const segmentoEl = $('strong:contains("Segmento")').parent().find('.sub-value');
        if (segmentoEl.length) dados.segmento = segmentoEl.text().trim();
        
        // Fallback de cálculo de mercado se não achar
        let cotacaoVal = parseValue(dados.cotacao);
        if (dados.val_mercado === 'N/A' && cotacaoVal > 0) {
            // Status invest não facilita o num cotas no HTML fácil, então deixamos N/A ou tentamos pegar o patrimônio
        }

        return dados;

    } catch (error) {
        return { dy: '-', pvp: '-', segmento: '-' };
    }
}

// --- SCRAPER DE HISTÓRICO (Via API JSON do Status Invest) ---
async function scrapeAsset(ticker) {
    try {
        const earnings = await fetchProventosJson(ticker);
        
        // Mapeia o JSON do Status Invest para o formato do seu app
        // JSON Exemplo: { "ed": "01/03/2024", "pd": "14/03/2024", "v": 0.10, "et": "Rendimento" }
        // ed = data com, pd = data pagamento, v = valor
        
        const dividendos = earnings.map(d => {
            // O Status Invest retorna dd/mm/yyyy. Precisamos converter para yyyy-mm-dd
            const parseDateJSON = (dStr) => {
                if(!dStr) return null;
                const parts = dStr.split('/');
                return `${parts[2]}-${parts[1]}-${parts[0]}`;
            };

            return {
                dataCom: parseDateJSON(d.ed), // Earn Date
                paymentDate: parseDateJSON(d.pd), // Payment Date
                value: d.v, // Value
                type: d.et // Earnings Type (Rendimento, JCP, Dividendo)
            };
        });

        // Ordenar por data de pagamento decrescente (mais recente primeiro)
        return dividendos.sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));

    } catch (error) { return []; }
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Cache Control
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

                // Delay levemente maior para o Status Invest não bloquear
                if (batches.length > 1) await new Promise(r => setTimeout(r, 800)); 
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
                if (batches.length > 1) await new Promise(r => setTimeout(r, 800));
            }
            return res.status(200).json({ json: all });
        }

        if (mode === 'proximo_provento') {
            if (!payload.ticker) return res.json({ json: null });
            const history = await scrapeAsset(payload.ticker);
            // API do Status Invest geralmente já manda ordenado, mas garantimos no sort acima
            // Filtra datas futuras ou a mais recente
            const hoje = new Date().toISOString().split('T')[0];
            const futuro = history.find(h => h.paymentDate >= hoje) || history[0];
            return res.status(200).json({ json: futuro || null });
        }

        return res.status(400).json({ error: "Modo desconhecido" });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
};
