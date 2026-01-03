const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// Configuração do Agente HTTPS
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
        'Accept-Encoding': 'gzip, deflate, br'
    },
    timeout: 10000
});

const REGEX_CLEAN_NUMBER = /[^0-9,-]+/g;
const REGEX_NORMALIZE = /[\u0300-\u036f]/g;

// --- HELPERS ---
function parseDate(dateStr) {
    if (!dateStr || dateStr === '-') return null;
    const parts = dateStr.trim().split('/');
    if (parts.length !== 3) return null;
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function parseValue(valueStr) {
    if (!valueStr) return 0;
    try {
        return parseFloat(valueStr.replace(REGEX_CLEAN_NUMBER, "").replace(',', '.')) || 0;
    } catch (e) { return 0; }
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

// Lógica de URL Inteligente
async function fetchHtmlWithRetry(ticker) {
    const tickerLower = ticker.toLowerCase();
    const lastChar = tickerLower.slice(-1);
    const isLikelyStock = ['3', '4', '5', '6'].includes(lastChar);
    
    // Define ordem de prioridade
    const urlsToTry = isLikelyStock 
        ? [`https://investidor10.com.br/acoes/${tickerLower}/`, `https://investidor10.com.br/fiis/${tickerLower}/`]
        : [`https://investidor10.com.br/fiis/${tickerLower}/`, `https://investidor10.com.br/acoes/${tickerLower}/`];

    for (const url of urlsToTry) {
        try {
            const response = await client.get(url);
            const html = response.data;
            const $ = cheerio.load(html);
            
            // Validação: se o título não tiver o ticker, fomos redirecionados para a Home errada
            const title = $('title').text().toLowerCase();
            const h1 = $('h1').text().toLowerCase();
            if (!title.includes(tickerLower) && !h1.includes(tickerLower)) {
                continue; 
            }
            return response;
        } catch (e) { continue; }
    }
    throw new Error(`Dados não encontrados para ${ticker}`);
}

// --- SCRAPER DE FUNDAMENTOS (CORRIGIDO) ---
async function scrapeFundamentos(ticker) {
    try {
        const response = await fetchHtmlWithRetry(ticker);
        const html = response.data;
        const $ = cheerio.load(html);

        let dados = {
            // FIIs + Comuns
            dy: 'N/A', pvp: 'N/A', segmento: 'N/A', tipo_fundo: 'N/A', mandato: 'N/A',
            vacancia: 'N/A', vp_cota: 'N/A', liquidez: 'N/A', val_mercado: 'N/A',
            patrimonio_liquido: 'N/A', variacao_12m: 'N/A', ultimo_rendimento: 'N/A',
            cnpj: 'N/A', num_cotistas: 'N/A', tipo_gestao: 'N/A', prazo_duracao: 'N/A',
            taxa_adm: 'N/A', cotas_emitidas: 'N/A',
            
            // Ações (Novos campos)
            pl: 'N/A', roe: 'N/A', lpa: 'N/A', margem_liquida: 'N/A', 
            divida_liquida_ebitda: 'N/A', ev_ebit: 'N/A', roic: 'N/A'
        };

        let cotacao_atual = 0;
        let num_cotas = 0;

        // 1. CARDS DO TOPO (Seleção Direta por Classes)
        const getCardValue = (className) => {
            const el = $(`._card.${className} ._card-body span`).first();
            return el.length ? el.text().trim() : null;
        };

        const dyCard = getCardValue('dy');
        if (dyCard) dados.dy = dyCard;
        
        const plCard = getCardValue('pl'); 
        if (plCard) dados.pl = plCard;

        const pvpCard = getCardValue('vp') || getCardValue('p_vp');
        if (pvpCard) dados.pvp = pvpCard;
        
        const roeCard = getCardValue('roe');
        if (roeCard) dados.roe = roeCard;

        const cotacaoEl = $('._card.cotacao ._card-body span').first();
        if (cotacaoEl.length) cotacao_atual = parseValue(cotacaoEl.text());

        // 2. VARREDURA GERAL (Grid + Tabelas + Cards)
        const processPair = (chaveRaw, valorRaw) => {
            if (!chaveRaw || !valorRaw) return;
            const chave = normalize(chaveRaw);
            const valor = valorRaw.trim();
            if (!valor || valor === '-') return;

            // --- FIIs & COMUM ---
            if (dados.liquidez === 'N/A' && chave.includes('liquidez')) dados.liquidez = valor;
            if (dados.val_mercado === 'N/A' && (chave.includes('mercado') || chave === 'valor de mercado')) dados.val_mercado = valor;
            if (dados.ultimo_rendimento === 'N/A' && chave.includes('ultimo rendimento')) dados.ultimo_rendimento = valor;
            if (dados.vacancia === 'N/A' && chave.includes('vacancia')) dados.vacancia = valor;
            
            // Segmento (FII ou Ação - Setor)
            if (dados.segmento === 'N/A') {
                if (chave.includes('segmento') || chave.includes('setor')) dados.segmento = valor;
            }
            
            // Patrimônio Líquido (FIIs usam "Valor Patrimonial")
            if (dados.patrimonio_liquido === 'N/A') {
                if (chave === 'patrimonio' || chave.includes('patrimonio liq') || chave.includes('valor patrimonial')) {
                    // Filtra valores pequenos que seriam VP por Cota
                    const valNum = parseValue(valor);
                    if (valNum > 1000) dados.patrimonio_liquido = valor;
                }
            }
            
            // VP por Cota / VPA
            if (dados.vp_cota === 'N/A') {
                if (chave.includes('vp por cota') || chave === 'vpa') {
                     dados.vp_cota = valor;
                }
            }

            // Metadados
            if (dados.cnpj === 'N/A' && chave.includes('cnpj')) dados.cnpj = valor;
            
            // Cotistas (FII) vs Acionistas (Ação)
            if (dados.num_cotistas === 'N/A') {
                if (chave.includes('cotistas') || chave.includes('acionistas') || chave.includes('investidores')) {
                    dados.num_cotistas = valor;
                }
            }
            
            if (dados.tipo_gestao === 'N/A' && chave.includes('gestao')) dados.tipo_gestao = valor;
            if (dados.mandato === 'N/A' && chave.includes('mandato')) dados.mandato = valor;
            
            // Tipo (Ação vs Fundo)
            if (dados.tipo_fundo === 'N/A') {
                if(chave === 'tipo' || chave.includes('tipo de fundo') || chave.includes('classificacao')) dados.tipo_fundo = valor;
            }

            // --- AÇÕES (Indicadores Corrigidos) ---
            if (dados.pl === 'N/A' && (chave === 'p/l' || chave === 'pl')) dados.pl = valor;
            if (dados.roe === 'N/A' && chave === 'roe') dados.roe = valor;
            if (dados.roic === 'N/A' && chave === 'roic') dados.roic = valor;
            if (dados.lpa === 'N/A' && chave === 'lpa') dados.lpa = valor;
            
            // Margem Líquida (Correção: aceita "Marg. Líquida" e variações)
            if (dados.margem_liquida === 'N/A') {
                if (chave.includes('margem liquida') || chave.includes('marg. liquida') || chave.includes('marg liquida')) {
                    dados.margem_liquida = valor;
                }
            }
            
            // Dívida Líquida / EBITDA
            if (dados.divida_liquida_ebitda === 'N/A') {
                if ((chave.includes('div') && chave.includes('liq') && chave.includes('ebit')) || chave.includes('div.liq/ebit')) {
                    dados.divida_liquida_ebitda = valor;
                }
            }
            
            if (dados.ev_ebit === 'N/A' && chave.includes('ev/ebit')) dados.ev_ebit = valor;
            
            // Num Ações para cálculo de Market Cap (se necessário)
            if (chave.includes('num. acoes') || chave.includes('cotas emitidas') || chave === 'numero de acoes') {
                 num_cotas = parseExtendedValue(valor);
                 if (dados.cotas_emitidas === 'N/A') dados.cotas_emitidas = valor;
            }
        };

        // --- ESTRATÉGIA DE VARREDURA ---
        
        // A. Grid Cells (Padrão novo do Investidor10 - Onde ficam LPA, Margens, etc)
        $('.cell').each((i, el) => {
            const title = $(el).find('.name').text();
            const val = $(el).find('.value').text();
            processPair(title, val);
        });

        // B. Tabelas (Dados técnicos e gerais)
        $('table tbody tr').each((i, row) => {
            const tds = $(row).find('td');
            // Tenta par chave-valor padrão
            if (tds.length >= 2) {
                processPair($(tds[0]).text(), $(tds[1]).text());
            }
            // Tenta tabela de 4 colunas (comum em dados técnicos)
            if (tds.length >= 4) {
                processPair($(tds[2]).text(), $(tds[3]).text());
            }
        });

        // C. Cards Internos (Fallback)
        $('._card').each((i, el) => {
            const head = $(el).find('._card-header').text();
            const body = $(el).find('._card-body').text();
            processPair(head, body);
        });

        // 3. RECUPERAÇÃO DA VARIAÇÃO 12M (Força Bruta)
        if (dados.variacao_12m === 'N/A') {
            // Procura em headers de cards
            $('._card-header').each((i, el) => {
                if ($(el).text().toLowerCase().includes('12 meses') || $(el).text().toLowerCase().includes('12m')) {
                    const val = $(el).parent().find('._card-body').text().trim();
                    if (val && !val.includes('DY')) { 
                         dados.variacao_12m = val;
                    }
                }
            });
            // Procura em cells específicas
            if (dados.variacao_12m === 'N/A') {
                $('.cell').each((i, el) => {
                     const name = $(el).find('.name').text().toLowerCase();
                     if (name.includes('variacao') || (name.includes('12') && name.includes('m'))) {
                         dados.variacao_12m = $(el).find('.value').text().trim();
                     }
                });
            }
        }

        // 4. CÁLCULO DE VALOR DE MERCADO (Se não achou pronto)
        if (dados.val_mercado === 'N/A' || dados.val_mercado === '-') {
            if (cotacao_atual > 0 && num_cotas > 0) {
                const mkt = cotacao_atual * num_cotas;
                if (mkt > 1000000000) dados.val_mercado = `R$ ${(mkt / 1000000000).toFixed(2)} Bilhões`;
                else if (mkt > 1000000) dados.val_mercado = `R$ ${(mkt / 1000000).toFixed(2)} Milhões`;
                else dados.val_mercado = formatCurrency(mkt);
            }
        }

        return dados;

    } catch (error) {
        console.error(`Erro scraper ${ticker}:`, error.message);
        return { dy: '-', pvp: '-' };
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
                    const recents = history.filter(h => h.paymentDate && h.value > 0).slice(0, limit);
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
