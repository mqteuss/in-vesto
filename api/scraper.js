const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// --- CONFIGURAÇÃO DO CLIENTE ---
const httpsAgent = new https.Agent({ 
    keepAlive: true,
    maxSockets: 100,
    maxFreeSockets: 10,
    timeout: 10000
});

const client = axios.create({
    httpsAgent,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Referer': 'https://statusinvest.com.br/',
    },
    timeout: 9000
});

// --- HELPERS ---
const REGEX_CLEAN_NUMBER = /[^0-9,-]+/g;

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

function getAssetType(ticker) {
    const t = ticker.toUpperCase();
    if (t.endsWith('11') || t.endsWith('11B')) return 'fundos-imobiliarios';
    return 'acoes';
}

// --- FETCHERS ---
async function fetchProventosJson(ticker) {
    const type = getAssetType(ticker) === 'fundos-imobiliarios' ? 'fii' : 'acao';
    const url = `https://statusinvest.com.br/${type}/companytickerprovents?ticker=${ticker}&chartProventsType=2`;
    try {
        const { data } = await client.get(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        return data.assetEarningsModels || [];
    } catch (e) { return []; }
}

async function fetchFundamentosHtml(ticker) {
    const type = getAssetType(ticker);
    try {
        return await client.get(`https://statusinvest.com.br/${type}/${ticker.toLowerCase()}`);
    } catch (e) {
        if (type === 'fundos-imobiliarios') return await client.get(`https://statusinvest.com.br/acoes/${ticker.toLowerCase()}`);
        throw e;
    }
}

// --- SCRAPER FUNDAMENTOS (CORRIGIDO) ---
async function scrapeFundamentos(ticker) {
    try {
        const response = await fetchFundamentosHtml(ticker);
        const html = response.data;
        const $ = cheerio.load(html);

        let dados = {
            dy: 'N/A', pvp: 'N/A', segmento: 'N/A', tipo_fundo: 'N/A', mandato: 'N/A',
            vacancia: 'N/A', vp_cota: 'N/A', liquidez: 'N/A', val_mercado: 'N/A',
            patrimonio_liquido: 'N/A', variacao_12m: 'N/A', ultimo_rendimento: 'N/A',
            cnpj: 'N/A', num_cotistas: 'N/A', tipo_gestao: 'N/A', prazo_duracao: 'N/A',
            taxa_adm: 'N/A', cotas_emitidas: 'N/A'
        };

        // --- 1. DADOS DE CABEÇALHO (Cards Superiores) ---
        // Ex: DY, P/VP, Cotação
        $('.top-info .info').each((i, el) => {
            const title = $(el).find('.title').text().toLowerCase();
            const value = $(el).find('.value').text().trim();
            
            if (title.includes('dividend yield')) dados.dy = value;
            if (title.includes('p/vp')) dados.pvp = value;
            if (title.includes('cotacao') || title.includes('valor atual')) dados.cotacao_atual = value;
        });

        // --- 2. DADOS ESPECÍFICOS (Liquidez, Patrimônio, VP) ---
        // O Status Invest usa divs com title="ajuda" que facilitam a busca
        const getValByTitleAttr = (titleKey) => {
            // Procura div que tenha title="...texto..."
            const target = $(`div[title*="${titleKey}"]`).first();
            if (target.length) {
                // Tenta pegar .value dentro ou perto
                return target.find('.value').text().trim() || target.parent().find('.value').text().trim();
            }
            // Fallback: Procura por texto visível do título
            const textTarget = $(`.title:contains("${titleKey}")`).last(); // Last geralmente é o correto no layout
            if (textTarget.length) return textTarget.parent().find('.value').text().trim();
            
            return null;
        };

        dados.liquidez = getValByTitleAttr('Liquidez média') || 'N/A';
        dados.vp_cota = getValByTitleAttr('Valor patrimonial p/cota') || 'N/A';
        dados.val_mercado = getValByTitleAttr('Valor de mercado') || 'N/A';
        dados.patrimonio_liquido = getValByTitleAttr('Patrimônio líquido') || 'N/A';
        dados.ultimo_rendimento = getValByTitleAttr('Último rendimento') || 'N/A';
        dados.cotas_emitidas = getValByTitleAttr('Num. de cotas') || getValByTitleAttr('Cotas emitidas') || 'N/A';

        // --- 3. DADOS GERAIS (Tabela inferior: Segmento, Vacância, CNPJ) ---
        // Essa parte geralmente fica numa div .card-bg
        
        // Função para limpar o texto grudado (ex: "SegmentoLogística" -> "Logística")
        const cleanLabel = (fullText, label) => {
            return fullText.replace(label, '').trim();
        };

        // Percorre todos os containers de info menores
        $('.info').each((i, el) => {
            const fullText = $(el).text().trim();
            const titleEl = $(el).find('.title');
            const subValueEl = $(el).find('.sub-value'); // Status Invest usa .sub-value aqui
            const valueEl = $(el).find('.value');

            let valorFinal = 'N/A';
            if (subValueEl.length) valorFinal = subValueEl.text().trim();
            else if (valueEl.length) valorFinal = valueEl.text().trim();
            
            // Se achou o valor via classe, ótimo. Se não, tenta limpar texto.
            const titleText = titleEl.text().trim();

            if (titleText.includes('Segmento')) dados.segmento = valorFinal !== 'N/A' ? valorFinal : cleanLabel(fullText, 'Segmento');
            if (titleText.includes('Tipo de fundo')) dados.tipo_fundo = valorFinal !== 'N/A' ? valorFinal : cleanLabel(fullText, 'Tipo de fundo');
            if (titleText.includes('Mandato')) dados.mandato = valorFinal !== 'N/A' ? valorFinal : cleanLabel(fullText, 'Mandato');
            if (titleText.includes('Gestão')) dados.tipo_gestao = valorFinal !== 'N/A' ? valorFinal : cleanLabel(fullText, 'Gestão');
            if (titleText.includes('Prazo')) dados.prazo_duracao = valorFinal !== 'N/A' ? valorFinal : cleanLabel(fullText, 'Prazo de duração');
            if (titleText.includes('Vacância Física')) dados.vacancia = valorFinal !== 'N/A' ? valorFinal : cleanLabel(fullText, 'Vacância Física');
            if (titleText.includes('Cotistas')) dados.num_cotistas = valorFinal !== 'N/A' ? valorFinal : cleanLabel(fullText, 'Num. Cotistas');
            if (titleText.includes('CNPJ')) dados.cnpj = valorFinal !== 'N/A' ? valorFinal : cleanLabel(fullText, 'CNPJ');
        });

        // --- CORREÇÃO EXTRA PARA "SEGMENTO" ---
        // Se ainda estiver grudado ou errado, tenta pegar direto do strong
        if (dados.segmento === 'N/A' || dados.segmento.length > 50) {
            const segStrong = $('strong:contains("Segmento")').parent().find('.sub-value');
            if (segStrong.length) dados.segmento = segStrong.text().trim();
        }

        return dados;

    } catch (error) {
        console.error("Erro scraper:", error.message);
        return { dy: '-', pvp: '-', segmento: '-' };
    }
}

// --- SCRAPER HISTÓRICO (Mantido igual pois funciona) ---
async function scrapeAsset(ticker) {
    try {
        const earnings = await fetchProventosJson(ticker);
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
            const hoje = new Date().toISOString().split('T')[0];
            const futuro = history.find(h => h.paymentDate >= hoje) || history[0];
            return res.status(200).json({ json: futuro || null });
        }

        return res.status(400).json({ error: "Modo desconhecido" });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
