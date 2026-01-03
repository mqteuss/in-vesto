const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// --- SETUP (MANTIDO) ---
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
        'Referer': 'https://statusinvest.com.br/',
        'Cache-Control': 'no-cache', 
    },
    timeout: 12000
});

const REGEX_CLEAN_NUMBER = /[^0-9,-]+/g;

// --- HELPERS (MANTIDOS) ---
function parseValue(valueStr) {
    if (!valueStr) return 0;
    if (typeof valueStr === 'number') return valueStr;
    try {
        return parseFloat(valueStr.replace(REGEX_CLEAN_NUMBER, "").replace(',', '.')) || 0;
    } catch (e) { return 0; }
}

function chunkArray(array, size) {
    const results = [];
    for (let i = 0; i < array.length; i += size) {
        results.push(array.slice(i, i + size));
    }
    return results;
}

// --- NAVEGAÇÃO INTELIGENTE (MANTIDA) ---
async function fetchHtmlSmart(ticker) {
    const t = ticker.toLowerCase();
    const tryUrl = async (category) => {
        try {
            const url = `https://statusinvest.com.br/${category}/${t}`;
            const res = await client.get(url);
            const $ = cheerio.load(res.data);
            const hasTitle = $('h1').length > 0;
            const hasData = $('.value').length > 3; 
            if (hasTitle && hasData) return { html: res.data, type: category };
            return null;
        } catch (e) { return null; }
    };

    if (t.endsWith('11') || t.endsWith('11b')) {
        let result = await tryUrl('fundos-imobiliarios'); 
        if (result) return result;
        result = await tryUrl('fiagros'); 
        if (result) return result;
        return await tryUrl('acoes');
    }
    
    let resultAcao = await tryUrl('acoes');
    if (resultAcao) return resultAcao;
    return await tryUrl('fundos-imobiliarios');
}

// --- SCRAPER FUNDAMENTOS (ATUALIZADO PARA PEGAR OS DADOS FALTANTES) ---
async function scrapeFundamentos(ticker) {
    try {
        const result = await fetchHtmlSmart(ticker);
        if (!result) return { dy: '-', pvp: '-', segmento: '-' };

        const $ = cheerio.load(result.html);
        
        let dados = {
            dy: 'N/A', pvp: 'N/A', segmento: 'N/A', tipo_fundo: 'N/A', mandato: 'N/A',
            vacancia: 'N/A', vp_cota: 'N/A', liquidez: 'N/A', val_mercado: 'N/A',
            patrimonio_liquido: 'N/A', variacao_12m: 'N/A', ultimo_rendimento: 'N/A',
            cnpj: 'N/A', num_cotistas: 'N/A', tipo_gestao: 'N/A', prazo_duracao: 'N/A',
            taxa_adm: 'N/A', cotas_emitidas: 'N/A'
        };

        // --- ESTRATÉGIA 1: BUSCA DIRETA POR TITLE (Resolve Patrimônio e VP) ---
        // O Status Invest coloca esses dados no topo com atributos title específicos
        
        const getValByTitle = (key) => {
            // Procura div com title="...key..." e pega o filho .value
            let val = $(`div[title*="${key}"] .value`).text().trim();
            if (!val) val = $(`div[title*="${key}"]`).find('.value').text().trim();
            return val;
        };

        // Mantendo o que já funcionava
        dados.val_mercado = getValByTitle('Valor de mercado') || getValByTitle('Valor de Mercado') || 'N/A';
        dados.liquidez = getValByTitle('Liquidez média') || getValByTitle('Liquidez Diária') || 'N/A';
        
        // Novos (Que estavam faltando)
        dados.patrimonio_liquido = getValByTitle('Patrimônio líquido') || 'N/A';
        dados.vp_cota = getValByTitle('Valor patrimonial p/cota') || getValByTitle('V.P.A') || 'N/A';
        dados.cotas_emitidas = getValByTitle('Num. de cotas') || getValByTitle('Total de papeis') || 'N/A';

        // --- ESTRATÉGIA 2: VARREDURA DE GRID (Resolve Mandato, Gestão, CNPJ, Cotistas) ---
        // Varre todas as caixinhas .info na página inteira
        $('.info').each((i, el) => {
            const titleRaw = $(el).find('.title').text().toLowerCase().trim();
            const value = $(el).find('.value').text().trim();
            
            if (!value || value === '-') return;

            if (titleRaw.includes('segmento')) dados.segmento = value;
            if (titleRaw.includes('tipo de fundo')) dados.tipo_fundo = value;
            if (titleRaw.includes('mandato')) dados.mandato = value;
            if (titleRaw.includes('gestão')) dados.tipo_gestao = value;
            if (titleRaw.includes('prazo')) dados.prazo_duracao = value;
            if (titleRaw.includes('cotistas') || titleRaw.includes('acionistas')) dados.num_cotistas = value;
            if (titleRaw.includes('cotas emitidas')) dados.cotas_emitidas = value; // Fallback
            if (titleRaw.includes('vacância física')) dados.vacancia = value;
            if (titleRaw.includes('cnpj')) dados.cnpj = value;
        });

        // --- ESTRATÉGIA 3: BUSCA ESPECÍFICA (Fallbacks) ---
        
        // DY e PVP (Geralmente no topo, sem title, apenas texto)
        const findTopCard = (label) => {
            return $(`.title:contains("${label}")`).parent().find('.value').text().trim();
        };
        dados.dy = findTopCard('Dividend Yield') || 'N/A';
        dados.pvp = findTopCard('P/VP') || findTopCard('P/L') || 'N/A';
        dados.cotacao_atual = findTopCard('Valor atual') || 'N/A';
        dados.ultimo_rendimento = findTopCard('Último rendimento') || 'N/A';

        // Taxa de Administração (Geralmente é um texto longo, precisa de cuidado)
        // Procura pelo título e pega o strong ou span dentro do próximo container
        const taxaBlock = $('h3.title:contains("Taxa de Administração")').parent().find('.value').text().trim();
        if (taxaBlock) dados.taxa_adm = taxaBlock;

        // --- LIMPEZA FINAL ---
        // SNAG11 (Fiagro) às vezes não tem "Segmento", tem "Setor" ou nada.
        if (dados.segmento === 'N/A' && result.type === 'fiagros') {
            dados.segmento = 'Fiagro/Agro'; // Padrão se não achar
        }
        
        // Limpar "SegmentoImóveis..." caso ocorra concatenação
        if (dados.segmento !== 'N/A') dados.segmento = dados.segmento.replace(/segmento/yi, '').trim();

        return dados;

    } catch (error) {
        console.error(`Erro fatal ${ticker}:`, error.message);
        return { dy: '-', pvp: '-', segmento: '-' };
    }
}

// --- SCRAPER HISTÓRICO (MANTIDO IGUAL) ---
async function scrapeAsset(ticker) {
    try {
        let type = 'acao';
        const t = ticker.toUpperCase();
        if (t.endsWith('11') || t.endsWith('11B')) type = 'fii'; 
        
        const url = `https://statusinvest.com.br/${type}/companytickerprovents?ticker=${ticker}&chartProventsType=2`;
        const { data } = await client.get(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
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
    } catch (error) { return []; }
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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

        // --- OUTROS MODOS MANTIDOS IDÊNTICOS ---
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
        
        if (mode === 'proximo_provento') {
            if (!payload.ticker) return res.json({ json: null });
            const history = await scrapeAsset(payload.ticker);
            const hoje = new Date().toISOString().split('T')[0];
            const futuro = history.find(h => h.paymentDate >= hoje) || history[0];
            return res.status(200).json({ json: futuro || null });
        }

        return res.status(400).json({ error: "Modo desconhecido" });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
