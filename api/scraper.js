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
        // Remove % e outros caracteres, troca vírgula por ponto
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
// PARTE 1: SCRAPER FUNDAMENTUS (MELHOR PARA AÇÕES)
// ---------------------------------------------------------
async function scrapeFundamentusAcoes(ticker) {
    try {
        // Fundamentus usa codificação antiga, mas para números funciona bem
        const url = `https://www.fundamentus.com.br/detalhes.php?papel=${ticker.toUpperCase()}`;
        const { data: html } = await client.get(url);
        const $ = cheerio.load(html);

        let dados = {
            // Campos que seu app espera
            dy: '0,00%', pvp: '-', pl: '-', roe: '-', lpa: '-', 
            margem_liquida: '-', divida_liquida_ebitda: '-', 
            liquidez: '-', val_mercado: '-', vp_cota: '-', // vp_cota é o VPA
            variacao_12m: '-', cotacao: '-'
        };

        // O Fundamentus usa tabelas com classe 'w728'
        // A estrutura é: <td>Label</td> <td>Valor</td>
        $('table.w728 td.label').each((i, el) => {
            const label = $(el).text().trim().toLowerCase();
            const value = $(el).next('td.data').text().trim();
            
            // Ignora vazios
            if (!value) return;

            // Mapeamento
            if (label.includes('cotac')) dados.cotacao = value; // Cotação
            if (label.includes('mercado')) dados.val_mercado = value;
            if (label.includes('liquidez') && label.includes('corr')) dados.liquidez = value; // Liq. Corr
            if (label.includes('vol') && label.includes('med')) dados.liquidez = value; // Preferência: Vol $ med (2m)
            
            // Indicadores
            if (label === 'p/l') dados.pl = value;
            if (label === 'p/vp') dados.pvp = value;
            if (label === 'roe') dados.roe = value;
            if (label === 'lpa') dados.lpa = value;
            if (label === 'vpa') dados.vp_cota = value; // VPA = VP/Cota
            if (label.includes('marg. liquida')) dados.margem_liquida = value;
            if (label.includes('div. yield')) dados.dy = value;
            if (label.includes('div. brut/ patrim')) dados.divida_liquida_ebitda = value; // Aprox. ou busca outro campo
            
            // Variação (Fundamentus mostra tabela separada geralmente, mas tentamos achar)
            // Fundamentus não tem "variação 12m" fácil na home do detalhe, pegamos o que der
        });
        
        // Tratamento da Variação 12m (Geralmente na tabela de oscilações)
        // Fundamentus mostra: Dia, Mês, 30 dias, 12 meses, etc.
        // Procuramos o índice da coluna "12 meses"
        $('table.w728').each((i, tbl) => {
            const header = $(tbl).find('td.label').text();
            if (header.includes('Oscilac')) {
                 // A estrutura é fixa: Dia | Mês | 30 dias | 12 meses ...
                 // Vamos tentar pegar o valor correspondente.
                 // Geralmente Oscilações é a 3ª tabela
                 const val12m = $(tbl).find('tr').eq(2).find('td.data').eq(3).find('span').text().trim(); // Tentativa posicional
                 if (val12m) dados.variacao_12m = val12m;
            }
        });
        
        // Ajuste final se falhar
        if(!dados.variacao_12m || dados.variacao_12m === '-') {
            // Fallback: tenta pegar da linha específica se existir
            const oscilacoes = $('td.label:contains("12 meses")').next('td.data').text().trim();
            if(oscilacoes) dados.variacao_12m = oscilacoes;
        }

        return dados;

    } catch (e) {
        console.error(`Erro Fundamentus ${ticker}:`, e.message);
        return {};
    }
}

// ---------------------------------------------------------
// PARTE 2: SCRAPER INVESTIDOR10 (MELHOR PARA FIIs)
// ---------------------------------------------------------
async function scrapeInvestidor10FII(ticker) {
    try {
        const res = await client.get(`https://investidor10.com.br/fiis/${ticker.toLowerCase()}/`);
        const $ = cheerio.load(res.data);

        let dados = {
            dy: 'N/A', pvp: 'N/A', segmento: 'N/A', tipo_fundo: 'N/A', mandato: 'N/A',
            vacancia: 'N/A', vp_cota: 'N/A', liquidez: 'N/A', val_mercado: 'N/A',
            patrimonio_liquido: 'N/A', variacao_12m: 'N/A', ultimo_rendimento: 'N/A',
            cnpj: 'N/A', num_cotistas: 'N/A', tipo_gestao: 'N/A', prazo_duracao: 'N/A',
            taxa_adm: 'N/A', cotas_emitidas: 'N/A'
        };
        
        // Processador de pares (Título -> Valor)
        const processPair = (tituloRaw, valorRaw) => {
            const titulo = normalize(tituloRaw);
            const valor = valorRaw.trim();
            if (!valor) return;

            if (dados.dy === 'N/A' && titulo.includes('dividend yield')) dados.dy = valor;
            if (dados.pvp === 'N/A' && titulo.includes('p/vp')) dados.pvp = valor;
            if (dados.liquidez === 'N/A' && titulo.includes('liquidez')) dados.liquidez = valor;
            if (dados.val_mercado === 'N/A' && titulo.includes('mercado')) dados.val_mercado = valor;
            if (dados.variacao_12m === 'N/A' && titulo.includes('variacao') && titulo.includes('12m')) dados.variacao_12m = valor;
            
            if (dados.segmento === 'N/A' && titulo.includes('segmento')) dados.segmento = valor;
            if (dados.vacancia === 'N/A' && titulo.includes('vacancia')) dados.vacancia = valor;
            if (dados.ultimo_rendimento === 'N/A' && titulo.includes('ultimo rendimento')) dados.ultimo_rendimento = valor;
            if (dados.cnpj === 'N/A' && titulo.includes('cnpj')) dados.cnpj = valor;
            if (dados.num_cotistas === 'N/A' && titulo.includes('cotistas')) dados.num_cotistas = valor;
            if (dados.tipo_gestao === 'N/A' && titulo.includes('gestao')) dados.tipo_gestao = valor;
            if (dados.mandato === 'N/A' && titulo.includes('mandato')) dados.mandato = valor;
            if (dados.tipo_fundo === 'N/A' && titulo.includes('tipo de fundo')) dados.tipo_fundo = valor;
            if (dados.prazo_duracao === 'N/A' && titulo.includes('prazo')) dados.prazo_duracao = valor;
            if (dados.taxa_adm === 'N/A' && titulo.includes('taxa') && titulo.includes('administracao')) dados.taxa_adm = valor;
            if (dados.cotas_emitidas === 'N/A' && (titulo.includes('cotas emitidas') || titulo === 'qtd cotas')) dados.cotas_emitidas = valor;
            
            if (dados.vp_cota === 'N/A' && titulo.includes('vp por cota')) dados.vp_cota = valor;

            if (titulo.includes('patrimonial') || titulo.includes('patrimonio')) {
                 if (dados.patrimonio_liquido === 'N/A') dados.patrimonio_liquido = valor;
            }
        };

        // Seletores específicos (Cards do Topo)
        const dyEl = $('._card.dy ._card-body span').first();
        if (dyEl.length) dados.dy = dyEl.text().trim();
        const pvpEl = $('._card.vp ._card-body span').first();
        if (pvpEl.length) dados.pvp = pvpEl.text().trim();
        const liqEl = $('._card.liquidity ._card-body span').first();
        if (liqEl.length) dados.liquidez = liqEl.text().trim();
        const valPatEl = $('._card.val_patrimonial ._card-body span').first();
        if (valPatEl.length) dados.vp_cota = valPatEl.text().trim();

        // Varredura Geral
        $('._card').each((i, el) => processPair($(el).find('._card-header span').text(), $(el).find('._card-body span').text()));
        $('.cell').each((i, el) => processPair($(el).find('.name').text(), $(el).find('.value').text()));
        $('table tbody tr').each((i, row) => {
            const cols = $(row).find('td');
            if (cols.length >= 2) processPair($(cols[0]).text(), $(cols[1]).text());
        });

        return dados;
    } catch (e) {
        console.error(`Erro Investidor10 FII ${ticker}:`, e.message);
        return {};
    }
}

// ---------------------------------------------------------
// PARTE 3: API E HANDLER
// ---------------------------------------------------------

async function scrapeAssetProventos(ticker) {
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

        // --- MODO FUNDAMENTOS (HÍBRIDO) ---
        if (mode === 'fundamentos') {
            if (!payload.ticker) return res.json({ json: {} });
            
            const ticker = payload.ticker.toUpperCase();
            const isFII = ticker.endsWith('11') || ticker.endsWith('11B');
            
            let dados = {};
            
            if (isFII) {
                // FIIs -> Investidor10 (Mais completo para FIIs)
                dados = await scrapeInvestidor10FII(ticker);
            } else {
                // AÇÕES -> Fundamentus (Muito mais estável para P/L, ROE, etc.)
                dados = await scrapeFundamentusAcoes(ticker);
            }
            
            return res.status(200).json({ json: dados });
        }

        // --- MODO PROVENTOS / HISTÓRICO ---
        if (mode === 'proventos_carteira' || mode === 'historico_portfolio') {
            if (!payload.fiiList) return res.json({ json: [] });
            
            const batches = chunkArray(payload.fiiList, 3);
            let finalResults = [];

            for (const batch of batches) {
                const promises = batch.map(async (item) => {
                    const ticker = typeof item === 'string' ? item : item.ticker;
                    const defaultLimit = mode === 'historico_portfolio' ? 36 : 24;
                    const limit = typeof item === 'string' ? defaultLimit : (item.limit || defaultLimit);

                    const history = await scrapeAssetProventos(ticker);
                    
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
            const history = await scrapeAssetProventos(payload.ticker);
            const formatted = history.slice(0, 18).map(h => {
                if (!h.paymentDate) return null;
                const [ano, mes] = h.paymentDate.split('-');
                return { mes: `${mes}/${ano.substring(2)}`, valor: h.value };
            }).filter(h => h !== null);
            return res.status(200).json({ json: formatted });
        }

        if (mode === 'proximo_provento') {
            if (!payload.ticker) return res.json({ json: null });
            const history = await scrapeAssetProventos(payload.ticker);
            const ultimo = history.length > 0 ? history[0] : null;
            return res.status(200).json({ json: ultimo });
        }

        return res.status(400).json({ error: "Modo desconhecido" });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
