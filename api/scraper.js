const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// --- SETUP OTIMIZADO ---
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
    timeout: 15000
});

const REGEX_CLEAN_NUMBER = /[^0-9,-]+/g;

// --- HELPERS ---
function parseValue(valueStr) {
    if (!valueStr) return 0;
    if (typeof valueStr === 'number') return valueStr;
    try {
        // Remove % e outros caracteres, troca vírgula por ponto
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

// ---------------------------------------------------------
// FONTE 1: FUNDAMENTUS (MELHOR PARA AÇÕES)
// ---------------------------------------------------------
async function scrapeFundamentus(ticker) {
    try {
        const url = `https://www.fundamentus.com.br/detalhes.php?papel=${ticker.toUpperCase()}`;
        const { data } = await client.get(url);
        const $ = cheerio.load(data);

        let dados = {
            dy: 'N/A', pvp: 'N/A', segmento: 'N/A', tipo_fundo: 'Ação', 
            vacancia: 'N/A', vp_cota: 'N/A', liquidez: 'N/A', val_mercado: 'N/A',
            patrimonio_liquido: 'N/A', variacao_12m: 'N/A', ultimo_rendimento: 'N/A',
            cnpj: 'N/A', num_cotistas: 'N/A', tipo_gestao: 'N/A', prazo_duracao: 'Indeterminado',
            taxa_adm: 'N/A', cotas_emitidas: 'N/A',
            // Ações Específicos
            pl: 'N/A', roe: 'N/A', lpa: 'N/A', margem_liquida: 'N/A', divida_liquida_ebitda: 'N/A'
        };

        // Varredura de Tabelas (Método Robusto par Label/Data)
        $('table.w728 tr').each((i, row) => {
            $(row).find('td.label').each((j, labelCell) => {
                const label = $(labelCell).text().trim().toLowerCase();
                const valueCell = $(labelCell).next('td.data');
                const valueSpan = valueCell.find('span.txt');
                let value = valueSpan.length ? valueSpan.text().trim() : valueCell.text().trim();
                
                if (!value || value === '') return;

                if (label.includes('div. yield')) dados.dy = value;
                if (label.includes('p/vp')) dados.pvp = value;
                if (label.includes('vol $ med') || label.includes('liq. corr')) dados.liquidez = value;
                if (label.includes('valor de mercado')) dados.val_mercado = value;
                if (label.includes('patrim')) dados.patrimonio_liquido = value;
                if (label.includes('nro. acoes')) dados.cotas_emitidas = value;
                if (label.includes('setor')) dados.segmento = value;
                if (label.includes('cotacao')) dados.cotacao_atual = value; 
                if (label.includes('vpa')) dados.vp_cota = value;

                // Indicadores de Ações
                if (label.includes('p/l')) dados.pl = value;
                if (label.includes('roe')) dados.roe = value;
                if (label.includes('lpa')) dados.lpa = value;
                if (label.includes('marg. liquida')) dados.margem_liquida = value;
                if (label.includes('div. liquida/ebitda')) dados.divida_liquida_ebitda = value;
            });
        });
        
        return dados;
    } catch (e) { return null; }
}

// ---------------------------------------------------------
// FONTE 2: INVESTIDOR10 (MELHOR PARA FIIs)
// ---------------------------------------------------------
function parseExtendedValue(str) {
    if (!str) return 0;
    const val = parseValue(str);
    const lower = str.toLowerCase();
    if (lower.includes('bilh')) return val * 1e9;
    if (lower.includes('milh')) return val * 1e6;
    if (lower.includes('mil')) return val * 1e3;
    return val;
}

function formatCurrency(value) {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function scrapeInvestidor10(ticker) {
    try {
        let html;
        let isFII = ticker.toUpperCase().endsWith('11') || ticker.toUpperCase().endsWith('11B');
        
        // Tenta rota correta baseada no ticker
        try {
            const typePath = isFII ? 'fiis' : 'acoes';
            const res = await client.get(`https://investidor10.com.br/${typePath}/${ticker.toLowerCase()}/`);
            html = res.data;
        } catch (e) {
            // Fallback reverso
            const typePath = isFII ? 'acoes' : 'fiis';
            const res = await client.get(`https://investidor10.com.br/${typePath}/${ticker.toLowerCase()}/`);
            html = res.data;
        }

        const $ = cheerio.load(html);
        let dados = {
            dy: 'N/A', pvp: 'N/A', segmento: 'N/A', tipo_fundo: 'N/A', mandato: 'N/A',
            vacancia: 'N/A', vp_cota: 'N/A', liquidez: 'N/A', val_mercado: 'N/A',
            patrimonio_liquido: 'N/A', variacao_12m: 'N/A', ultimo_rendimento: 'N/A',
            cnpj: 'N/A', num_cotistas: 'N/A', tipo_gestao: 'N/A', prazo_duracao: 'N/A',
            taxa_adm: 'N/A', cotas_emitidas: 'N/A',
            pl: 'N/A', roe: 'N/A', lpa: 'N/A', margem_liquida: 'N/A'
        };
        
        let cotacao_atual = 0;
        let num_cotas = 0;

        const processPair = (tituloRaw, valorRaw) => {
            if (!tituloRaw || !valorRaw) return;
            const titulo = tituloRaw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const valor = valorRaw.trim();
            if (!valor || valor === '-') return;

            if (dados.dy === 'N/A' && titulo.includes('dividend yield')) dados.dy = valor;
            if (dados.pvp === 'N/A' && titulo.includes('p/vp')) dados.pvp = valor;
            
            // Ações
            if (dados.pl === 'N/A' && titulo.includes('p/l')) dados.pl = valor;
            if (dados.roe === 'N/A' && titulo.includes('roe')) dados.roe = valor;
            if (dados.lpa === 'N/A' && titulo.includes('lpa')) dados.lpa = valor;
            if (dados.margem_liquida === 'N/A' && titulo.includes('margem liquida')) dados.margem_liquida = valor;

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

            if (titulo.includes('patrimonial') || titulo.includes('patrimonio')) {
                const valorNumerico = parseValue(valor);
                const textoLower = valor.toLowerCase();
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
        
        const cotacaoEl = $('._card.cotacao ._card-body span').first();
        if (cotacaoEl.length) cotacao_atual = parseValue(cotacaoEl.text());

        // Processa Cards do Topo
        $('._card').each((i, el) => processPair($(el).find('._card-header span').text(), $(el).find('._card-body span').text()));
        // Processa Tabela de Detalhes
        $('.cell').each((i, el) => processPair($(el).find('.name').text(), $(el).find('.value').text()));
        
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
    } catch (error) { return null; }
}

// ---------------------------------------------------------
// FONTE 3: STATUS INVEST (PROVENTOS) - COM CORREÇÃO DE DATAS
// ---------------------------------------------------------
async function scrapeProventosAPI(ticker) {
    const t = ticker.toUpperCase();

    const fetchEarnings = async (type) => {
        try {
            const url = `https://statusinvest.com.br/${type}/companytickerprovents?ticker=${t}&chartProventsType=2`;
            const { data } = await client.get(url, { 
                headers: { 'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://statusinvest.com.br/' } 
            });
            return data.assetEarningsModels || [];
        } catch (e) { return []; }
    };

    let earnings = [];
    
    // Lógica Inteligente de Rota
    if (t.endsWith('11') || t.endsWith('11B') || t.endsWith('33') || t.endsWith('34') || t.endsWith('35')) {
        // Prioriza rota de FIIs
        earnings = await fetchEarnings('fii');
        if (earnings.length === 0) earnings = await fetchEarnings('acao');
    } else {
        // Prioriza rota de Ações (3, 4, 5, 6, UNITs)
        earnings = await fetchEarnings('acao');
        if (earnings.length === 0) earnings = await fetchEarnings('fii');
    }

    const dividendos = earnings.map(d => {
        const parseDateJSON = (dStr) => {
            if(!dStr) return null;
            const parts = dStr.split('/');
            return `${parts[2]}-${parts[1]}-${parts[0]}`; // YYYY-MM-DD
        };
        
        const dataCom = parseDateJSON(d.ed);
        let paymentDate = parseDateJSON(d.pd);
        
        // CORREÇÃO CRÍTICA: Se não tem Data Pagamento (Ações provisionadas), usa Data Com + 30 dias (Estimativa)
        // Isso evita quebras no gráfico e permite listar como "Futuro"
        if (!paymentDate && dataCom) {
            const dComObj = new Date(dataCom);
            dComObj.setDate(dComObj.getDate() + 30); // Estima pagamento 1 mês depois
            paymentDate = dComObj.toISOString().split('T')[0];
        }

        return {
            dataCom: dataCom,
            paymentDate: paymentDate, // Agora nunca é null se tiver DataCom
            value: d.v,
            type: d.et
        };
    });

    return dividendos.sort((a, b) => {
        if (!a.paymentDate) return -1; 
        if (!b.paymentDate) return 1;
        return new Date(b.paymentDate) - new Date(a.paymentDate);
    });
}

// ---------------------------------------------------------
// HANDLER PRINCIPAL
// ---------------------------------------------------------
module.exports = async function handler(req, res) {
    // Headers CORS e Cache
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

        // --- FUNDAMENTOS ---
        if (mode === 'fundamentos') {
            if (!payload.ticker) return res.json({ json: {} });
            const ticker = payload.ticker.toUpperCase();
            
            let dados = null;
            
            // CORREÇÃO DE PRIORIDADE:
            // 1. Se parece FII (termina em 11), tenta Investidor10 primeiro.
            // 2. Se parece Ação, tenta Fundamentus primeiro.
            
            if (ticker.endsWith('11') || ticker.endsWith('11B')) {
                // Tenta Investidor10 (Melhor FII)
                dados = await scrapeInvestidor10(ticker);
                
                // Se Investidor10 falhou ou retornou N/A no DY, tenta Fundamentus
                if (!dados || dados.dy === 'N/A') {
                     const backup = await scrapeFundamentus(ticker);
                     if (backup && backup.dy !== 'N/A') dados = backup;
                     else if (!dados) dados = backup;
                }
            } 
            else {
                // Tenta Fundamentus (Melhor Ação)
                dados = await scrapeFundamentus(ticker);
                
                // Se falhou ou faltou dados cruciais, tenta Investidor10
                if (!dados || dados.pl === 'N/A') {
                    const backup = await scrapeInvestidor10(ticker);
                    if (backup && backup.pl !== 'N/A') dados = backup;
                    else if (!dados) dados = backup;
                }
            }

            if (!dados) dados = { dy: '-', pvp: '-', segmento: '-' };
            return res.status(200).json({ json: dados });
        }

        // --- PROVENTOS CARTEIRA (Batch) ---
        if (mode === 'proventos_carteira') {
            if (!payload.fiiList) return res.json({ json: [] });
            const batches = chunkArray(payload.fiiList, 3);
            let finalResults = [];

            for (const batch of batches) {
                const promises = batch.map(async (item) => {
                    const ticker = typeof item === 'string' ? item : item.ticker;
                    const limit = typeof item === 'string' ? 24 : (item.limit || 24);
                    
                    const history = await scrapeProventosAPI(ticker);
                    const recents = history
                        .filter(h => h.value > 0)
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

        // --- HISTÓRICO 12M (Para Gráfico de Detalhes) ---
        if (mode === 'historico_12m') {
            if (!payload.ticker) return res.json({ json: [] });
            const history = await scrapeProventosAPI(payload.ticker);
            
            const formatted = history.slice(0, 18).map(h => {
                // CORREÇÃO: Evita erro undefined/defined
                if (!h.paymentDate || !h.paymentDate.includes('-')) return null;
                
                const [ano, mes] = h.paymentDate.split('-');
                return { mes: `${mes}/${ano.substring(2)}`, valor: h.value };
            }).filter(h => h !== null);
            
            return res.status(200).json({ json: formatted });
        }

        // --- HISTÓRICO PORTFOLIO (Agregado) ---
        if (mode === 'historico_portfolio') {
            if (!payload.fiiList) return res.json({ json: [] });
            const batches = chunkArray(payload.fiiList, 3); 
            let all = [];
            for (const batch of batches) {
                const promises = batch.map(async (ticker) => {
                    const history = await scrapeProventosAPI(ticker);
                    history.slice(0, 24).forEach(h => {
                        if (h.value > 0) all.push({ symbol: ticker.toUpperCase(), ...h });
                    });
                });
                await Promise.all(promises);
                if (batches.length > 1) await new Promise(r => setTimeout(r, 600));
            }
            return res.status(200).json({ json: all });
        }

        // --- PRÓXIMO PROVENTO (Card Destaque) ---
        if (mode === 'proximo_provento') {
            if (!payload.ticker) return res.json({ json: null });
            const history = await scrapeProventosAPI(payload.ticker);
            // Filtra datas futuras ou recentes
            const hoje = new Date();
            hoje.setDate(hoje.getDate() - 20); // Pega recentes também
            
            const relevantes = history.filter(h => new Date(h.paymentDate) >= hoje);
            const proximo = relevantes.length > 0 ? relevantes[relevantes.length - 1] : (history[0] || null);
            
            return res.status(200).json({ json: proximo });
        }

        return res.status(400).json({ error: "Modo desconhecido" });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
