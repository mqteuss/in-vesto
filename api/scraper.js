const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// --- CONFIGURAÇÃO DO CLIENTE HTTP ---
const httpsAgent = new https.Agent({ 
    keepAlive: true,
    maxSockets: 100,
    maxFreeSockets: 10,
    timeout: 15000
});

const client = axios.create({
    httpsAgent,
    headers: {
        // Simula um navegador real para evitar bloqueios
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://investidor10.com.br/'
    },
    timeout: 12000
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
    // Remove acentos, pontos, traços e deixa minúsculo para facilitar a comparação
    return str.normalize("NFD").replace(REGEX_NORMALIZE, "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

function chunkArray(array, size) {
    const results = [];
    for (let i = 0; i < array.length; i += size) {
        results.push(array.slice(i, i + size));
    }
    return results;
}

// ---------------------------------------------------------
// SCRAPER UNIVERSAL (INVESTIDOR10)
// ---------------------------------------------------------
async function scrapeInvestidor10Universal(ticker, type) {
    try {
        // Tenta detectar URL correta (FIIs ou Ações)
        let url;
        if (type === 'fii') {
            url = `https://investidor10.com.br/fiis/${ticker.toLowerCase()}/`;
        } else {
            url = `https://investidor10.com.br/acoes/${ticker.toLowerCase()}/`;
        }

        const { data: html } = await client.get(url);
        const $ = cheerio.load(html);

        let dados = {
            // Comuns
            dy: 'N/A', pvp: 'N/A', val_mercado: 'N/A', liquidez: 'N/A', 
            vp_cota: 'N/A', variacao_12m: 'N/A', patrimonio_liquido: 'N/A',
            // Ações
            pl: 'N/A', roe: 'N/A', lpa: 'N/A', margem_liquida: 'N/A', divida_liquida_ebitda: 'N/A',
            // FIIs
            segmento: 'N/A', tipo_fundo: 'N/A', mandato: 'N/A', vacancia: 'N/A',
            ultimo_rendimento: 'N/A', cnpj: 'N/A', num_cotistas: 'N/A', 
            tipo_gestao: 'N/A', prazo_duracao: 'N/A', taxa_adm: 'N/A', cotas_emitidas: 'N/A'
        };

        let cotacao_atual = 0;
        let num_cotas = 0;

        // --- FUNÇÃO DE PROCESSAMENTO INTELIGENTE ---
        const processPair = (tituloRaw, valorRaw) => {
            const titulo = normalize(tituloRaw); // Ex: "p/vp" vira "pvp"
            const valor = valorRaw.trim();
            if (!valor || valor === '-') return;

            // Mapeamento Flexível (Resolve os problemas de N/A)

            // 1. P/L (Ações)
            if (titulo === 'pl') dados.pl = valor;
            
            // 2. P/VP
            if (titulo === 'pvp') dados.pvp = valor;
            
            // 3. Dividend Yield
            if (titulo.includes('dividendyield') || titulo === 'dy') dados.dy = valor;
            
            // 4. Valor de Mercado
            if (titulo.includes('valordemercado')) dados.val_mercado = valor;
            
            // 5. Liquidez
            if (titulo.includes('liquidez')) dados.liquidez = valor;
            
            // 6. ROE e LPA (Ações)
            if (titulo === 'roe') dados.roe = valor;
            if (titulo === 'lpa') dados.lpa = valor;
            
            // 7. VPA / VP por Cota
            // Ações usam "VPA", FIIs usam "Val. Patrimonial p/ Cota"
            if (titulo === 'vpa' || titulo.includes('vpporcota') || (titulo.includes('patrimonial') && titulo.includes('cota'))) {
                dados.vp_cota = valor;
            }

            // 8. Patrimônio Líquido (Total)
            // Se tem "patrimonio" mas NÃO tem "cota", é o total
            if ((titulo.includes('patrimonio') || titulo.includes('patrimonial')) && !titulo.includes('cota')) {
                dados.patrimonio_liquido = valor;
            }

            // 9. Margens e Dívidas (Ações)
            if (titulo.includes('margemliquida')) dados.margem_liquida = valor;
            if (titulo.includes('dividaliquidaebitda')) dados.divida_liquida_ebitda = valor;

            // 10. Dados de FIIs
            if (titulo.includes('segmento')) dados.segmento = valor;
            if (titulo.includes('mandato')) dados.mandato = valor;
            if (titulo.includes('vacancia')) dados.vacancia = valor;
            if (titulo.includes('ultimorendimento')) dados.ultimo_rendimento = valor;
            if (titulo.includes('cotistas')) dados.num_cotistas = valor;
            if (titulo.includes('cotasemitidas') || titulo === 'qtdcotas') {
                dados.cotas_emitidas = valor;
                num_cotas = parseValue(valor);
            }
            if (titulo.includes('gestao')) dados.tipo_gestao = valor;
            if (titulo.includes('prazo')) dados.prazo_duracao = valor;
            if (titulo.includes('taxa') && titulo.includes('administracao')) dados.taxa_adm = valor;
            if (titulo.includes('cnpj')) dados.cnpj = valor;
            if (titulo.includes('tipodefundo')) dados.tipo_fundo = valor;
            if (titulo.includes('variacao') && titulo.includes('12m')) dados.variacao_12m = valor;
        };

        // --- ESTRATÉGIA DE COLETA (VARRE TUDO) ---
        
        // 1. Cards do Topo (Geralmente P/L, P/VP, DY, Cotação)
        $('._card').each((i, el) => {
            const header = $(el).find('._card-header').text(); // ex: "P/L"
            const body = $(el).find('._card-body').text();     // ex: "5,00"
            processPair(header, body);
            
            // Pega cotação atual para cálculo de fallback
            if (normalize(header).includes('cotacao')) cotacao_atual = parseValue(body);
        });

        // 2. Dados da Empresa / Indicadores (Tabelas)
        // O site usa div.cell ou tabelas
        $('.cell').each((i, el) => {
            const name = $(el).find('.name').text();
            const val = $(el).find('.value').text();
            processPair(name, val);
        });

        $('table tr').each((i, row) => {
            const tds = $(row).find('td');
            if (tds.length >= 2) {
                processPair($(tds[0]).text(), $(tds[1]).text());
            }
            // Algumas tabelas tem 4 colunas (Label | Valor | Label | Valor)
            if (tds.length >= 4) {
                processPair($(tds[2]).text(), $(tds[3]).text());
            }
        });

        // --- CÁLCULOS DE FALLBACK (SE O SITE NÃO TIVER O DADO EXPLÍCITO) ---
        
        // Se faltar Valor de Mercado, calcula: Cotação * Cotas
        if ((dados.val_mercado === 'N/A' || dados.val_mercado === '-') && cotacao_atual > 0 && num_cotas > 0) {
            const mktCap = cotacao_atual * num_cotas;
            if (mktCap > 1e9) dados.val_mercado = `R$ ${(mktCap / 1e9).toFixed(2)} Bilhões`;
            else if (mktCap > 1e6) dados.val_mercado = `R$ ${(mktCap / 1e6).toFixed(2)} Milhões`;
            else dados.val_mercado = formatCurrency(mktCap);
        }

        // Se faltar VP/Cota e tivermos P/VP e Cotação
        // P/VP = Preço / VP_Cota  ->  VP_Cota = Preço / (P/VP)
        if ((dados.vp_cota === 'N/A' || dados.vp_cota === '-') && cotacao_atual > 0) {
            const pvpNum = parseValue(dados.pvp);
            if (pvpNum > 0) {
                dados.vp_cota = formatCurrency(cotacao_atual / pvpNum);
            }
        }

        return dados;

    } catch (e) {
        // Se falhar na URL de FII, tenta Ação (e vice-versa) caso o tipo esteja errado
        if (url.includes('/fiis/') && e.response?.status === 404) {
            return scrapeInvestidor10Universal(ticker, 'acao');
        }
        console.error(`Erro Scraper (${ticker}):`, e.message);
        return {}; 
    }
}

// ---------------------------------------------------------
// SCRAPER PROVENTOS (StatusInvest - Mantido pois funciona bem)
// ---------------------------------------------------------
async function scrapeAssetProventos(ticker) {
    try {
        const t = ticker.toUpperCase();
        let type = 'acao';
        if (t.endsWith('11') || t.endsWith('11B') || t.endsWith('33') || t.endsWith('34')) type = 'fii'; 
        
        // StatusInvest endpoint
        const url = `https://statusinvest.com.br/${type}/companytickerprovents?ticker=${t}&chartProventsType=2`;

        const { data } = await client.get(url, { 
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://statusinvest.com.br/' } 
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
        return []; 
    }
}

// ---------------------------------------------------------
// API HANDLER
// ---------------------------------------------------------
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

        // --- MODO FUNDAMENTOS (AGORA UNIVERSAL) ---
        if (mode === 'fundamentos') {
            if (!payload.ticker) return res.json({ json: {} });
            
            const ticker = payload.ticker.toUpperCase();
            // Detecção simples de tipo
            const isFII = ticker.endsWith('11') || ticker.endsWith('11B') || ticker.endsWith('13'); 
            const type = isFII ? 'fii' : 'acao';

            const dados = await scrapeInvestidor10Universal(ticker, type);
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
