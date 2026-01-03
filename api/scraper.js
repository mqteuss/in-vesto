const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// --- CONFIGURAÇÃO ---
const httpsAgent = new https.Agent({ 
    keepAlive: true,
    maxSockets: 100,
    maxFreeSockets: 10,
    timeout: 15000
});

const client = axios.create({
    httpsAgent,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Referer': 'https://statusinvest.com.br/',
    },
    timeout: 10000
});

const REGEX_CLEAN_NUMBER = /[^0-9,-]+/g;

// --- HELPERS ---
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

// --- LÓGICA DE ROTAS INTELIGENTE (FII vs FIAGRO vs AÇÃO) ---
async function fetchHtmlSmart(ticker) {
    const t = ticker.toLowerCase();
    
    // Tenta primeiro como FII (Maioria dos casos final 11)
    // Mas se falhar ou retornar página inválida, tentamos Fiagro
    
    const tryUrl = async (type) => {
        try {
            const url = `https://statusinvest.com.br/${type}/${t}`;
            const res = await client.get(url);
            // Verifica se a página carregou um conteúdo válido (ex: tem o título do ativo)
            const $ = cheerio.load(res.data);
            if ($('h1').length > 0) return { html: res.data, type }; 
            throw new Error("Página vazia");
        } catch (e) { return null; }
    };

    // Ordem de tentativa baseada no final do ticker
    if (t.endsWith('11') || t.endsWith('11b')) {
        // Tenta FII -> Fiagro -> Ação (Unit)
        let result = await tryUrl('fundos-imobiliarios');
        if (result) return result;
        
        result = await tryUrl('fiagros'); // Aqui resolve o SNAG11
        if (result) return result;
        
        return await tryUrl('acoes');
    } else {
        // Ações (3, 4, etc)
        return await tryUrl('acoes') || await tryUrl('fundos-imobiliarios'); // Fallback raro
    }
}

// --- SCRAPER DE FUNDAMENTOS (BUSCA UNIVERSAL) ---
async function scrapeFundamentos(ticker) {
    try {
        const result = await fetchHtmlSmart(ticker);
        if (!result) return { dy: '-', pvp: '-', segmento: '-' }; // Não achou página

        const $ = cheerio.load(result.html);
        const pageType = result.type; // 'acoes', 'fiagros' ou 'fundos-imobiliarios'

        let dados = {
            dy: 'N/A', pvp: 'N/A', segmento: 'N/A', tipo_fundo: 'N/A', mandato: 'N/A',
            vacancia: 'N/A', vp_cota: 'N/A', liquidez: 'N/A', val_mercado: 'N/A',
            patrimonio_liquido: 'N/A', variacao_12m: 'N/A', ultimo_rendimento: 'N/A',
            cnpj: 'N/A', num_cotistas: 'N/A', tipo_gestao: 'N/A', prazo_duracao: 'N/A',
            taxa_adm: 'N/A', cotas_emitidas: 'N/A'
        };

        // --- FUNÇÃO "SCANNER" ---
        // Procura um texto na tela e pega o valor mais próximo, não importa a estrutura HTML
        const findVal = (labels) => {
            const labelArray = Array.isArray(labels) ? labels : [labels];
            
            for (const label of labelArray) {
                // Procura elementos que contenham o texto exato ou parcial
                // Usamos filter para garantir que não pegamos scripts ou conteudos ocultos grandes
                const el = $('div, span, strong, h3, h4').filter((i, e) => {
                    return $(e).clone().children().remove().end().text().trim().toLowerCase() === label.toLowerCase();
                }).first();

                if (el.length) {
                    // Tenta achar o valor em várias posições relativas
                    let val = '';
                    
                    // 1. Irmão direto (.title + .value)
                    val = el.next('.value').text().trim();
                    if (val) return val;
                    
                    // 2. Filho (.info > .title ... .value)
                    val = el.parent().find('.value').first().text().trim();
                    if (val) return val;

                    // 3. Sub-value (usado em tabelas inferiores)
                    val = el.parent().find('.sub-value').first().text().trim();
                    if (val) return val;
                    
                    // 4. Estrutura de Cards do Topo (div > div.title ... div > div.value)
                    val = el.parents('div').first().find('.value').text().trim();
                    if (val) return val;
                }
            }
            return null;
        };

        // --- MAPEAMENTO DOS CAMPOS ---
        
        // 1. Cards Principais (Topo)
        dados.dy = findVal(['Dividend Yield', 'DY']) || 'N/A';
        dados.pvp = findVal(['P/VP', 'P/L', 'VPA']) || 'N/A'; // P/L para ações as vezes
        dados.cotacao_atual = findVal(['Valor atual', 'Cotação']) || 'N/A';
        dados.ultimo_rendimento = findVal(['Último rendimento']) || 'N/A';

        // 2. Dados de Mercado
        dados.liquidez = findVal(['Liquidez média diária', 'Liquidez Diária']) || 'N/A';
        dados.patrimonio_liquido = findVal(['Patrimônio líquido']) || 'N/A';
        dados.val_mercado = findVal(['Valor de mercado']) || 'N/A';
        dados.vp_cota = findVal(['Valor patrimonial p/cota', 'V.P.A', 'VP por cota']) || 'N/A';
        dados.cotas_emitidas = findVal(['Num. de cotas', 'Cotas emitidas', 'Total de papeis']) || 'N/A'; // Ações usa 'Total de papeis'

        // 3. Tabela de Informações Gerais (Inferior)
        // Fiagros e FIIs tem estruturas parecidas aqui
        dados.segmento = findVal(['Segmento', 'Setor de Atuação']) || 'N/A';
        dados.tipo_fundo = findVal(['Tipo de fundo']) || 'N/A';
        dados.mandato = findVal(['Mandato']) || 'N/A';
        dados.tipo_gestao = findVal(['Gestão']) || 'N/A';
        dados.prazo_duracao = findVal(['Prazo de duração']) || 'N/A';
        dados.vacancia = findVal(['Vacância Física']) || 'N/A';
        dados.num_cotistas = findVal(['Num. Cotistas', 'Nº de acionistas']) || 'N/A';
        dados.cnpj = findVal(['CNPJ']) || 'N/A';

        // Correção específica para Segmento que as vezes vem "grudado"
        if (dados.segmento !== 'N/A') {
             // Remove o label se ele vier junto (ex: "SegmentoIndefinido" -> "Indefinido")
             dados.segmento = dados.segmento.replace(/segmento/yi, '').trim();
        }

        return dados;

    } catch (error) {
        console.error(`Erro ao processar ${ticker}:`, error.message);
        return { dy: '-', pvp: '-', segmento: '-' };
    }
}

// --- SCRAPER HISTÓRICO (JSON API) ---
// Mantido igual, mas com a detecção de tipo (FII/Fiagro/Acao)
async function scrapeAsset(ticker) {
    try {
        // Tenta descobrir o tipo pela URL padrão ou lógica simples
        // A API de proventos do Status Invest usa 'fii' para Fiagros também? Vamos testar.
        // Geralmente: /fii/companytickerprovents funciona para FII e Fiagro
        
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


// --- HANDLER PRINCIPAL ---
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

        // Outros modos (historico_12m, proximo_provento) usam scrapeAsset, que já está corrigido
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
