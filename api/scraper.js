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
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://investidor10.com.br/'
    },
    timeout: 10000
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

function cleanString(str) {
    if (!str) return 'N/A';
    return str.trim();
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

// ---------------------------------------------------------
// PARTE 1: FUNDAMENTOS -> INVESTIDOR10 (OTIMIZADO)
// ---------------------------------------------------------

async function scrapeFundamentos(ticker) {
    try {
        let html;
        const t = ticker.toLowerCase();
        
        // Tenta primeiro como FII, se falhar ou redirecionar, tenta Ação (lógica simplificada pelo try/catch do axios se retornar 404)
        try {
            const res = await client.get(`https://investidor10.com.br/fiis/${t}/`);
            html = res.data;
        } catch (e) {
            const res = await client.get(`https://investidor10.com.br/acoes/${t}/`);
            html = res.data;
        }

        const $ = cheerio.load(html);

        let dados = {
            dy: 'N/A', pvp: 'N/A', segmento: 'N/A', tipo_fundo: 'N/A', mandato: 'N/A',
            vacancia: 'N/A', vp_cota: 'N/A', liquidez: 'N/A', val_mercado: 'N/A',
            patrimonio_liquido: 'N/A', variacao_12m: 'N/A', ultimo_rendimento: 'N/A',
            cnpj: 'N/A', num_cotistas: 'N/A', tipo_gestao: 'N/A', prazo_duracao: 'N/A',
            taxa_adm: 'N/A', cotas_emitidas: 'N/A',
            pl: 'N/A', roe: 'N/A', lpa: 'N/A', margem_liquida: 'N/A', divida_liquida_ebitda: 'N/A'
        };

        // --- 1. CARDS DO TOPO (Acesso Direto) ---
        // Cotação
        const cotacaoStr = $('._card.cotacao .value').text();
        let cotacao_atual = parseValue(cotacaoStr);

        // Dividend Yield (DY)
        const dyStr = $('._card.dy ._card-body span').text(); // Busca direta no card DY
        if (dyStr) dados.dy = cleanString(dyStr);

        // Variação 12M (Geralmente no card ou primeira linha)
        // Se houver um card específico para variação (comum em alguns layouts), adicione aqui. 
        // Caso contrário, busca na grid abaixo.

        // --- 2. GRID DE INDICADORES (.cell) (Busca Otimizada) ---
        
        // Helper para buscar valor dentro de uma célula pelo título (Case Insensitive logic via Cheerio :contains modificado ou filter)
        const getCell = (textos) => {
            // Filtra as células que contêm algum dos textos passados
            let el = null;
            $('.cell').each((i, elem) => {
                const name = $(elem).find('.name').text().toUpperCase();
                if (textos.some(t => name.includes(t.toUpperCase()))) {
                    el = $(elem).find('.value');
                    return false; // break loop
                }
            });
            return el ? el.text().trim() : 'N/A';
        };

        // Indicadores Gerais e FIIs
        dados.pvp = getCell(['P/VP']);
        dados.liquidez = getCell(['LIQUIDEZ DIÁRIA', 'LIQUIDEZ M']);
        dados.val_mercado = getCell(['VALOR DE MERCADO']);
        dados.ultimo_rendimento = getCell(['ÚLTIMO RENDIMENTO']);
        dados.patrimonio_liquido = getCell(['PATRIMÔNIO LÍQUIDO', 'PATRIMONIO LIQUIDO']); // Evita confusão com Valor Patrimonial p/ Cota
        dados.vp_cota = getCell(['VALOR PATRIMONIAL', 'VPA', 'VP POR COTA']); // Em FIIs muitas vezes aparece como "VALOR PATRIMONIAL" referindo-se a Cota em alguns contextos, ou VP/Cota.
        
        // Refinamento: Se VP Cota veio igual a Patrimonio Liquido (erro comum de texto), ajusta
        if (dados.vp_cota === dados.patrimonio_liquido && dados.vp_cota !== 'N/A') {
             // Tenta buscar especificamente VP por Cota se existir outra label
             const vpaSpecific = getCell(['VP POR COTA']);
             if (vpaSpecific !== 'N/A') dados.vp_cota = vpaSpecific;
        }

        dados.num_cotistas = getCell(['NÚMERO DE COTISTAS', 'COTISTAS']);
        dados.variacao_12m = getCell(['VARIAÇÃO', '12 MESES']);
        dados.vacancia = getCell(['VACÂNCIA']);
        
        // Dados Cadastrais (Geralmente na tabela de "Informações Básicas" ou células específicas)
        dados.segmento = getCell(['SEGMENTO']);
        dados.tipo_fundo = getCell(['TIPO DE FUNDO']);
        dados.mandato = getCell(['MANDATO']);
        dados.tipo_gestao = getCell(['TIPO DE GESTÃO', 'GESTÃO']);
        dados.cnpj = getCell(['CNPJ']);
        dados.prazo_duracao = getCell(['PRAZO']);
        dados.taxa_adm = getCell(['TAXA DE ADMINISTRAÇÃO']);
        dados.cotas_emitidas = getCell(['COTAS EMITIDAS', 'TOTAL DE COTAS']);

        // Indicadores de Ações (Caso seja ação)
        dados.pl = getCell(['P/L']);
        dados.roe = getCell(['ROE']);
        dados.lpa = getCell(['LPA']);
        dados.margem_liquida = getCell(['MARGEM LÍQUIDA']);
        dados.divida_liquida_ebitda = getCell(['DÍV. LÍQUIDA/EBITDA', 'DIV. LIQ. / EBITDA']);

        // --- 3. CORREÇÕES FINAIS ---

        // Valor de Mercado (Fallback Numérico se estiver N/A)
        if (dados.val_mercado === 'N/A' || dados.val_mercado === '-') {
            let numCotas = parseExtendedValue(dados.cotas_emitidas);
            if (cotacao_atual > 0 && numCotas > 0) {
                const mktCap = cotacao_atual * numCotas;
                dados.val_mercado = mktCap.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            }
        }

        return dados;

    } catch (error) {
        console.error("Erro no scraper de fundamentos:", error.message);
        return { dy: 'N/A', pvp: 'N/A', error: true };
    }
}

// ---------------------------------------------------------
// PARTE 2: PROVENTOS -> STATUSINVEST (MANTIDO)
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
                'User-Agent': 'Mozilla/5.0'
            } 
        });

        const earnings = data.assetEarningsModels || [];

        const dividendos = earnings.map(d => {
            const parseDateJSON = (dStr) => {
                if (!dStr || dStr.trim() === '' || dStr.trim() === '-') return null;
                const parts = dStr.split('/');
                if (parts.length !== 3) return null;
                return `${parts[2]}-${parts[1]}-${parts[0]}`;
            };

            let labelTipo = 'REND'; 
            if (d.et === 1) labelTipo = 'DIV';
            if (d.et === 2) labelTipo = 'JCP';

            if (d.etd) {
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

        return dividendos
            .filter(d => d.paymentDate !== null) 
            .sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));

    } catch (error) { 
        console.error(`Erro StatusInvest API ${ticker}:`, error.message);
        return []; 
    }
}

// ---------------------------------------------------------
// HANDLER (API)
// ---------------------------------------------------------

function chunkArray(array, size) {
    const results = [];
    for (let i = 0; i < array.length; i += size) {
        results.push(array.slice(i, i + size));
    }
    return results;
}

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

        if (mode === 'proventos_carteira' || mode === 'historico_portfolio') {
            if (!payload.fiiList) return res.json({ json: [] });

            const batches = chunkArray(payload.fiiList, 3);
            let finalResults = [];

            for (const batch of batches) {
                const promises = batch.map(async (item) => {
                    const ticker = typeof item === 'string' ? item : item.ticker;
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
