const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// --- OTIMIZAÇÃO 1: AGENTE MAIS AGRESSIVO ---
const httpsAgent = new https.Agent({ 
    keepAlive: true,
    maxSockets: 128, // Aumentado para permitir mais conexões paralelas
    maxFreeSockets: 10,
    timeout: 8000 // Timeout de socket reduzido
});

const client = axios.create({
    httpsAgent,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://investidor10.com.br/'
    },
    timeout: 6000 // Timeout global reduzido (se demorar 6s, falha logo)
});

// --- HELPERS ---
const REGEX_CLEAN_NUMBER = /[^0-9,-]+/g;
const REGEX_NORMALIZE = /[\u0300-\u036f]/g;

function parseValue(valueStr) {
    if (!valueStr) return 0;
    if (typeof valueStr === 'number') return valueStr;
    try {
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

function cleanDoubledString(str) {
    if (!str) return "";
    const parts = str.split('R$');
    if (parts.length > 2) {
        return 'R$' + parts[1].trim(); 
    }
    return str;
}

// ---------------------------------------------------------
// PARTE 1: FUNDAMENTOS -> INVESTIDOR10 (OTIMIZADO)
// ---------------------------------------------------------

async function scrapeFundamentos(tickerRaw) {
    const ticker = tickerRaw.toLowerCase();
    try {
        let html;
        
        // --- OTIMIZAÇÃO 2: ROTEAMENTO INTELIGENTE DE URL ---
        // Evita tentar /fiis/ para ações óbvias (ex: PETR4, VALE3)
        // Se termina em 11 ou 11B, assumimos prioridade FII, caso contrário, prioridade Ação.
        const isLikelyFii = ticker.endsWith('11') || ticker.endsWith('11b');
        
        const urlPrimary = isLikelyFii 
            ? `https://investidor10.com.br/fiis/${ticker}/` 
            : `https://investidor10.com.br/acoes/${ticker}/`;
            
        const urlSecondary = isLikelyFii 
            ? `https://investidor10.com.br/acoes/${ticker}/` // Caso seja Unit (KLBN11) mas caiu no catch
            : `https://investidor10.com.br/fiis/${ticker}/`;

        try {
            const res = await client.get(urlPrimary);
            html = res.data;
        } catch (e) {
            // Se falhou a primária, tenta a secundária (ex: KLBN11 é Unit, não FII)
            console.log(`[Warn] Tentando rota secundária para ${ticker}`);
            const res = await client.get(urlSecondary);
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

        let cotacao_atual = 0;
        let num_cotas = 0;

        const processPair = (tituloRaw, valorRaw, origem = 'table', indicatorAttr = null) => {
            if (!valorRaw) return;
            const titulo = normalize(tituloRaw); 
            let valor = valorRaw.trim();

            if (titulo.includes('mercado')) {
                valor = cleanDoubledString(valor);
                if (dados.val_mercado !== 'N/A' && origem === 'table') return;
            }

            if (!valor) return;

            // Lógica via Data-Indicator (Mais rápida e precisa)
            if (indicatorAttr) {
                const ind = indicatorAttr.toUpperCase();
                switch(ind) {
                    case 'DIVIDA_LIQUIDA_EBITDA': dados.divida_liquida_ebitda = valor; return;
                    case 'DY': dados.dy = valor; return;
                    case 'P_L': dados.pl = valor; return;
                    case 'P_VP': dados.pvp = valor; return;
                    case 'ROE': dados.roe = valor; return;
                    case 'MARGEM_LIQUIDA': dados.margem_liquida = valor; return;
                }
            }

            // Fallback Textual
            if (dados.dy === 'N/A' && (titulo === 'dy' || titulo.includes('dividend yield'))) dados.dy = valor;
            else if (dados.pvp === 'N/A' && titulo.includes('p/vp')) dados.pvp = valor;
            else if (dados.pl === 'N/A' && (titulo === 'p/l' || titulo.includes('p/l'))) dados.pl = valor;
            else if (dados.liquidez === 'N/A' && titulo.includes('liquidez')) dados.liquidez = valor;
            else if (dados.val_mercado === 'N/A' && titulo.includes('mercado')) dados.val_mercado = valor;
            else if (dados.segmento === 'N/A' && titulo.includes('segmento')) dados.segmento = valor;
            else if (dados.vacancia === 'N/A' && titulo.includes('vacancia')) dados.vacancia = valor;
            else if (dados.ultimo_rendimento === 'N/A' && titulo.includes('ultimo rendimento')) dados.ultimo_rendimento = valor;
            else if (dados.cotas_emitidas === 'N/A' && titulo.includes('cotas')) dados.cotas_emitidas = valor;
            else if (dados.roe === 'N/A' && titulo.includes('roe')) dados.roe = valor;
            
            // Verificações secundárias (menos frequentes)
            if (dados.cnpj === 'N/A' && titulo.includes('cnpj')) dados.cnpj = valor;
            if (dados.num_cotistas === 'N/A' && titulo.includes('cotistas')) dados.num_cotistas = valor;
            if (dados.tipo_gestao === 'N/A' && titulo.includes('gestao')) dados.tipo_gestao = valor;
            if (dados.mandato === 'N/A' && titulo.includes('mandato')) dados.mandato = valor;
            if (dados.variacao_12m === 'N/A' && titulo.includes('variacao') && titulo.includes('12m')) dados.variacao_12m = valor;
            
            // VPA e Patrimônio
            if (titulo.includes('patrimonial') || titulo.includes('patrimonio')) {
                const valorNumerico = parseValue(valor);
                if (valor.toLowerCase().includes('milh') || valor.toLowerCase().includes('bilh') || valorNumerico > 10000) {
                    if (dados.patrimonio_liquido === 'N/A') dados.patrimonio_liquido = valor;
                } else {
                    if (dados.vp_cota === 'N/A') dados.vp_cota = valor;
                }
            }
            if (dados.vp_cota === 'N/A' && (titulo === 'vpa' || titulo.includes('vp por cota'))) dados.vp_cota = valor;

            if (titulo.includes('cotas') && (titulo.includes('emitidas') || titulo.includes('total'))) {
                num_cotas = parseValue(valor);
            }
        };

        // 1. CARDS (Geralmente contêm o essencial: Cotação, DY, PVP, Liquidez)
        $('._card').each((i, el) => {
            const titulo = $(el).find('._card-header').text().trim();
            const valor = $(el).find('._card-body').text().trim();
            processPair(titulo, valor, 'card');
            if (normalize(titulo).includes('cotacao')) cotacao_atual = parseValue(valor);
        });

        // Fallback Cotação rápido
        if (cotacao_atual === 0) {
             const cotacaoEl = $('._card.cotacao ._card-body span').first();
             if (cotacaoEl.length) cotacao_atual = parseValue(cotacaoEl.text());
        }

        // 2. TABELAS (Mais estruturadas que .cell)
        $('table tbody tr').each((i, row) => {
            const cols = $(row).find('td');
            if (cols.length >= 2) {
                const indicatorAttr = $(cols[0]).find('[data-indicator]').attr('data-indicator');
                processPair($(cols[0]).text(), $(cols[1]).text(), 'table', indicatorAttr);
            }
        });

        // 3. CELL (Fallback apenas se faltar dados cruciais)
        if (dados.segmento === 'N/A' || dados.vacancia === 'N/A') {
             $('.cell').each((i, el) => {
                let titulo = $(el).find('.name').text().trim();
                if (!titulo) titulo = $(el).children('span').first().text().trim();
                let valor = $(el).find('.value').text().trim();
                processPair(titulo, valor, 'cell');
            });
        }

        // Cálculo de Valor de Mercado
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
    } catch (error) {
        console.error(`Erro ${ticker}:`, error.message);
        return { dy: '-', pvp: '-', segmento: '-' };
    }
}

// ---------------------------------------------------------
// PARTE 2: PROVENTOS (STATUSINVEST)
// ---------------------------------------------------------

async function scrapeAsset(ticker) {
    try {
        const t = ticker.toUpperCase();
        let type = 'acao';
        if (t.endsWith('11') || t.endsWith('11B') || t.endsWith('33') || t.endsWith('34')) type = 'fii'; 

        const url = `https://statusinvest.com.br/${type}/companytickerprovents?ticker=${t}&chartProventsType=2`;
        const { data } = await client.get(url, { 
            headers: { 'X-Requested-With': 'XMLHttpRequest' } 
        });

        if (!data || !data.assetEarningsModels) return [];

        return data.assetEarningsModels.map(d => {
            let labelTipo = 'REND'; 
            if (d.et === 1) labelTipo = 'DIV';
            else if (d.et === 2) labelTipo = 'JCP';
            else if (d.etd) {
                const texto = d.etd.toUpperCase();
                if (texto.includes('JURO')) labelTipo = 'JCP';
                else if (texto.includes('DIVID')) labelTipo = 'DIV';
                else if (texto.includes('TRIBUTADO')) labelTipo = 'REND_TRIB';
            }

            // Formatação de data manual é mais rápida que criar objetos Date
            const edParts = d.ed ? d.ed.split('/') : null;
            const pdParts = d.pd ? d.pd.split('/') : null;

            return {
                dataCom: edParts ? `${edParts[2]}-${edParts[1]}-${edParts[0]}` : null,
                paymentDate: pdParts ? `${pdParts[2]}-${pdParts[1]}-${pdParts[0]}` : null,
                value: d.v,
                type: labelTipo,
                rawType: d.et
            };
        })
        .filter(d => d.paymentDate !== null)
        .sort((a, b) => a.paymentDate.localeCompare(b.paymentDate) * -1); // Sort reverso por string ISO funciona e é rápido

    } catch (error) { 
        return []; 
    }
}

// ---------------------------------------------------------
// HANDLER (API)
// ---------------------------------------------------------

module.exports = async function handler(req, res) {
    // CORS e Headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // --- OTIMIZAÇÃO 3: CACHING ---
    // Cache de 1 hora na CDN (s-maxage), stale-while-revalidate por 1 dia
    // Isso faz com que requisições repetidas sejam respondidas instantaneamente pelo Vercel Edge
    if (req.method === 'POST') {
       res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    }

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'POST') { return res.status(405).json({ error: "Method not allowed" }); }

    try {
        const { mode, payload } = req.body;
        if (!payload) throw new Error("Payload missing");

        if (mode === 'fundamentos') {
            if (!payload.ticker) return res.json({ json: {} });
            const dados = await scrapeFundamentos(payload.ticker);
            return res.status(200).json({ json: dados });
        }

        if (mode === 'proventos_carteira' || mode === 'historico_portfolio') {
            const list = payload.fiiList || [];
            if (!list.length) return res.json({ json: [] });

            // --- OTIMIZAÇÃO 4: BATCH MAIOR E MAIS RÁPIDO ---
            // Aumentado para 6 itens por vez (StatusInvest tolera bem)
            const batches = chunkArray(list, 6);
            let finalResults = [];

            for (const batch of batches) {
                const promises = batch.map(async (item) => {
                    const ticker = typeof item === 'string' ? item : item.ticker;
                    const limit = (typeof item !== 'string' && item.limit) 
                        ? item.limit 
                        : (mode === 'historico_portfolio' ? 36 : 24);

                    const history = await scrapeAsset(ticker);
                    
                    // Slice rápido
                    const recents = [];
                    for(let i=0; i < history.length && recents.length < limit; i++) {
                        if(history[i].value > 0) recents.push(history[i]);
                    }

                    if (recents.length > 0) return recents.map(r => ({ symbol: ticker.toUpperCase(), ...r }));
                    return null;
                });

                const batchResults = await Promise.all(promises);
                finalResults.push(...batchResults);
                
                // Delay reduzido drasticamente (600ms -> 150ms)
                if (batches.length > 1) await new Promise(r => setTimeout(r, 150)); 
            }
            return res.status(200).json({ json: finalResults.filter(Boolean).flat() });
        }

        if (mode === 'historico_12m') {
            const history = await scrapeAsset(payload.ticker);
            const formatted = history.slice(0, 18).map(h => {
                if (!h.paymentDate) return null;
                // Ex: "2024-05-15" -> "05/24"
                return { mes: `${h.paymentDate.substring(5,7)}/${h.paymentDate.substring(2,4)}`, valor: h.value };
            }).filter(Boolean);
            return res.status(200).json({ json: formatted });
        }

        if (mode === 'proximo_provento') {
            const history = await scrapeAsset(payload.ticker);
            return res.status(200).json({ json: history[0] || null });
        }

        return res.status(400).json({ error: "Modo desconhecido" });

    } catch (error) {
        console.error("Handler error:", error);
        return res.status(500).json({ error: error.message });
    }
};
