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

// --- HELPERS DE PARSE ---
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

// --- SCRAPER DE FUNDAMENTOS (CORRIGIDO PARA PREENCHER OS DADOS FALTANTES) ---
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

        // --- ESTRATÉGIA 1: CARDS DO TOPO (DY, PVP, Cotação) ---
        // Procura blocos .top-info e pega os valores
        $('.top-info div').each((i, el) => {
            const title = $(el).find('.title').text().toLowerCase();
            const value = $(el).find('.value').text().trim();
            
            if (title.includes('dividend yield')) dados.dy = value;
            if (title.includes('p/vp')) dados.pvp = value;
            if (title.includes('cotacao') || title.includes('valor atual')) dados.cotacao_atual = value; // auxiliar
        });

        // --- ESTRATÉGIA 2: VARREDURA GERAL (Liquidez, Patrimônio, etc.) ---
        // O Status Invest coloca muitas informações em divs com classe .info dentro de containers
        $('.info').each((i, el) => {
            const title = $(el).find('.title').text().toLowerCase().trim();
            const value = $(el).find('.value').text().trim();

            if (!value) return;

            if (title.includes('liquidez media') || title.includes('liquidez diaria')) dados.liquidez = value;
            if (title.includes('patrimonio liquido')) dados.patrimonio_liquido = value;
            if (title.includes('valor patrimonial p/cota') || title.includes('vp por cota')) dados.vp_cota = value;
            if (title.includes('valor de mercado')) dados.val_mercado = value;
            if (title.includes('ultimo rendimento')) dados.ultimo_rendimento = value;
            if (title.includes('cotas emitidas')) dados.cotas_emitidas = value;
        });

        // --- ESTRATÉGIA 3: BUSCA POR LABEL ESPECÍFICO (Dados Gerais, Segmento, Vacância) ---
        // Esta função procura um texto exato (ex: "Segmento") e tenta achar o valor vizinho
        const findValueByLabel = (labelText) => {
            // Procura em strong, h3, spans, divs que contenham o texto
            let found = null;
            $('strong, h3, span, div.title').each((i, el) => {
                if ($(el).text().trim().toLowerCase() === labelText.toLowerCase()) {
                    // Tenta achar o valor no irmão, no pai, ou na próxima div
                    const nextVal = $(el).next('.value, .sub-value').text();
                    const parentVal = $(el).parent().find('.value, .sub-value').text();
                    // O Status invest as vezes coloca: <div title="Segmento">...<strong class="value">Logística</strong></div>
                    const parentContainerVal = $(el).parents('.info').find('.value').text();

                    if (nextVal) found = nextVal;
                    else if (parentVal) found = parentVal;
                    else if (parentContainerVal) found = parentContainerVal;
                    return false; // break loop
                }
            });
            return found ? found.trim() : 'N/A';
        };

        // Aplica a busca específica para os campos chatos
        if (dados.segmento === 'N/A') dados.segmento = findValueByLabel('Segmento');
        if (dados.tipo_fundo === 'N/A') dados.tipo_fundo = findValueByLabel('Tipo de fundo');
        if (dados.mandato === 'N/A') dados.mandato = findValueByLabel('Mandato');
        if (dados.tipo_gestao === 'N/A') dados.tipo_gestao = findValueByLabel('Gestão'); // As vezes é 'Gestão'
        if (dados.prazo_duracao === 'N/A') dados.prazo_duracao = findValueByLabel('Prazo de duração');
        if (dados.vacancia === 'N/A') dados.vacancia = findValueByLabel('Vacância Física'); // Status Invest usa 'Vacância Física'
        if (dados.num_cotistas === 'N/A') dados.num_cotistas = findValueByLabel('Num. Cotistas');
        if (dados.cnpj === 'N/A') dados.cnpj = findValueByLabel('CNPJ');

        // --- ESTRATÉGIA 4: CAIXA DE DADOS GERAIS (Fallback para Segmento/Gestão) ---
        // Às vezes está dentro de uma div card-bg específica
        if (dados.segmento === 'N/A') {
             // Tenta pegar direto do bloco de "Dados Gerais" se existir
             const segmentoTarget = $('strong:contains("Segmento")').parent().find('.sub-value');
             if (segmentoTarget.length) dados.segmento = segmentoTarget.text().trim();
        }

        // --- ESTRATÉGIA 5: TAXA DE ADMINISTRAÇÃO (Geralmente texto longo) ---
        // O Status Invest coloca a taxa num parágrafo ou div solta
        const taxaEl = $('div:contains("Taxa de Administração")').last().next(); 
        // Isso é complexo no Status Invest, as vezes está num texto corrido.
        // Vamos tentar pegar o valor se estiver estruturado
        if ($('h3:contains("Taxa de Administração")').length) {
            dados.taxa_adm = $('h3:contains("Taxa de Administração")').parents('.info').find('.value').text().trim();
        }

        // --- TRATAMENTO FINAL DE DADOS ---
        // Se Patrimônio veio vazio, mas temos cotas e VP
        if ((dados.patrimonio_liquido === 'N/A' || dados.patrimonio_liquido === '-') && dados.vp_cota !== 'N/A' && dados.cotas_emitidas !== 'N/A') {
             // Cálculo manual de fallback
        }

        return dados;

    } catch (error) {
        console.error("Erro scraper fundamentos:", error.message);
        return { dy: '-', pvp: '-', segmento: '-' };
    }
}

// --- SCRAPER DE HISTÓRICO (JSON API) ---
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
    // CORS
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

        if (mode === 'historico_portfolio') { // Compatibilidade legada
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
