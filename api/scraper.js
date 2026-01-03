const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// --- OTIMIZAÇÃO DE REDE ---
const httpsAgent = new https.Agent({ 
    keepAlive: true,
    maxSockets: 100,
    maxFreeSockets: 10,
    timeout: 15000
});

const client = axios.create({
    httpsAgent,
    headers: {
        // User-Agent de navegador real para evitar bloqueios
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://statusinvest.com.br/',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    },
    timeout: 12000
});

const REGEX_CLEAN_NUMBER = /[^0-9,-]+/g;

// --- FUNÇÕES AUXILIARES ---
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

// --- LÓGICA DE ROTAS INTELIGENTE ---
async function fetchHtmlSmart(ticker) {
    const t = ticker.toLowerCase();

    // Helper para testar uma URL e verificar se tem dados REAIS
    const tryUrl = async (category) => {
        try {
            const url = `https://statusinvest.com.br/${category}/${t}`;
            const res = await client.get(url);
            const $ = cheerio.load(res.data);
            
            // VERIFICAÇÃO DE SUCESSO:
            // Se a página não tiver o nome da empresa OU não tiver nenhum valor de cotação/DY,
            // consideramos que a URL está errada (ex: tentar abrir Fiagro como FII).
            const hasTitle = $('h1').length > 0;
            const hasData = $('.value').length > 5; // Tem que ter pelo menos alguns valores na tela

            if (hasTitle && hasData) return { html: res.data, type: category };
            return null;
        } catch (e) { return null; }
    };

    // 1. Se termina em 11, a prioridade é: FII -> FIAGRO -> AÇÃO (Unit)
    if (t.endsWith('11') || t.endsWith('11b')) {
        let result = await tryUrl('fundos-imobiliarios'); 
        if (result) return result;

        result = await tryUrl('fiagros'); // ESSENCIAL PARA SNAG11
        if (result) return result;

        return await tryUrl('acoes');
    }
    
    // 2. Se não termina em 11 (ex: PETR4), prioridade: AÇÃO -> FII
    let resultAcao = await tryUrl('acoes');
    if (resultAcao) return resultAcao;
    
    return await tryUrl('fundos-imobiliarios');
}

// --- SCRAPER UNIVERSAL (O SEGREDO PARA NÃO VIR N/A) ---
async function scrapeFundamentos(ticker) {
    try {
        const result = await fetchHtmlSmart(ticker);
        if (!result) return { dy: '-', pvp: '-', segmento: '-' }; // Ativo não encontrado

        const $ = cheerio.load(result.html);
        
        let dados = {
            dy: 'N/A', pvp: 'N/A', segmento: 'N/A', tipo_fundo: 'N/A', mandato: 'N/A',
            vacancia: 'N/A', vp_cota: 'N/A', liquidez: 'N/A', val_mercado: 'N/A',
            patrimonio_liquido: 'N/A', variacao_12m: 'N/A', ultimo_rendimento: 'N/A',
            cnpj: 'N/A', num_cotistas: 'N/A', tipo_gestao: 'N/A', prazo_duracao: 'N/A',
            taxa_adm: 'N/A', cotas_emitidas: 'N/A'
        };

        // FUNÇÃO DE BUSCA PROFUNDA
        // Procura valores baseados em palavras-chave no HTML inteiro
        const findVal = (keywords) => {
            const terms = Array.isArray(keywords) ? keywords : [keywords];
            let foundValue = null;

            terms.forEach(term => {
                if (foundValue) return;
                const termLower = term.toLowerCase();

                // ESTRATÉGIA 1: Atributo Title (Muito usado no Status Invest)
                // Ex: <div title="Valor patrimonial...">
                $(`div[title*="${term}"], div[title*="${termLower}"]`).each((i, el) => {
                    const val = $(el).find('.value').text().trim();
                    if (val) foundValue = val;
                });
                if (foundValue) return;

                // ESTRATÉGIA 2: Busca textual em Títulos (.title ou strong)
                // Varre elementos que contêm o texto e olha para os irmãos/filhos
                $('.title, strong, h3, span').each((i, el) => {
                    if ($(el).text().toLowerCase().includes(termLower)) {
                        // Tenta achar .value no irmão
                        let val = $(el).next('.value').text().trim();
                        // Tenta achar .sub-value (muito comum em FIIs)
                        if (!val) val = $(el).next('.sub-value').text().trim();
                        // Tenta achar .value no pai
                        if (!val) val = $(el).parent().find('.value').first().text().trim();
                        // Tenta achar .sub-value no pai
                        if (!val) val = $(el).parent().find('.sub-value').first().text().trim();

                        if (val) {
                            foundValue = val;
                            return false; // Break loop
                        }
                    }
                });
            });
            return foundValue;
        };

        // --- PREENCHIMENTO DOS DADOS ---

        // 1. CARDS PRINCIPAIS (DY, PVP, Cotação)
        dados.dy = findVal(['Dividend Yield', 'DY']) || 'N/A';
        dados.pvp = findVal(['P/VP', 'VPA', 'P/L']) || 'N/A'; // P/L fallback para ações
        dados.cotacao_atual = findVal(['Valor atual', 'Cotação']) || 'N/A';
        dados.ultimo_rendimento = findVal(['Último rendimento']) || 'N/A';

        // 2. FUNDAMENTOS FINANCEIROS
        dados.liquidez = findVal(['Liquidez média', 'Liquidez Diária']) || 'N/A';
        dados.patrimonio_liquido = findVal(['Patrimônio líquido']) || 'N/A';
        dados.val_mercado = findVal(['Valor de mercado']) || 'N/A';
        dados.vp_cota = findVal(['Valor patrimonial p/cota', 'V.P.A', 'VP por cota']) || 'N/A';
        dados.cotas_emitidas = findVal(['Num. de cotas', 'Cotas emitidas', 'Total de papeis']) || 'N/A';

        // 3. DADOS QUALITATIVOS (A parte que estava falhando no GGRC11)
        dados.segmento = findVal(['Segmento', 'Setor de Atuação']) || 'N/A';
        dados.tipo_fundo = findVal(['Tipo de fundo']) || 'N/A';
        dados.mandato = findVal(['Mandato']) || 'N/A';
        dados.tipo_gestao = findVal(['Gestão']) || 'N/A';
        dados.prazo_duracao = findVal(['Prazo de duração', 'Prazo']) || 'N/A';
        dados.vacancia = findVal(['Vacância Física']) || 'N/A';
        dados.num_cotistas = findVal(['Num. Cotistas', 'Nº de acionistas']) || 'N/A';
        dados.cnpj = findVal(['CNPJ']) || 'N/A';
        dados.taxa_adm = findVal(['Taxa de Administração']) || 'N/A';

        // LIMPEZA FINAL
        // As vezes o segmento vem grudado tipo "SegmentoLogística". Removemos a chave.
        if (dados.segmento !== 'N/A') dados.segmento = dados.segmento.replace(/segmento/yi, '').trim();
        if (dados.mandato !== 'N/A') dados.mandato = dados.mandato.replace(/mandato/yi, '').trim();
        if (dados.tipo_gestao !== 'N/A') dados.tipo_gestao = dados.tipo_gestao.replace(/gestão/yi, '').trim();

        return dados;

    } catch (error) {
        console.error(`Erro fatal ${ticker}:`, error.message);
        return { dy: '-', pvp: '-', segmento: '-' };
    }
}

// --- SCRAPER HISTÓRICO (JSON API) ---
async function scrapeAsset(ticker) {
    try {
        let type = 'acao';
        const t = ticker.toUpperCase();
        // Fiagros também usam a rota 'fii' na API interna na maioria das vezes, 
        // mas vamos garantir
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
