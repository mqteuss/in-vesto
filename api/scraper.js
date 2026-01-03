const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// --- CONFIGURAÇÃO DE REDE OTIMIZADA ---
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
    timeout: 9000
});

// --- UTILITÁRIOS ---
const REGEX_CLEAN_NUMBER = /[^0-9,-]+/g;
const REGEX_NORMALIZE = /[\u0300-\u036f]/g;

function parseDate(dateStr) {
    if (!dateStr || dateStr === '-') return null;
    const parts = dateStr.trim().split('/');
    if (parts.length !== 3) return null;
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function parseValue(valueStr) {
    if (!valueStr) return 0;
    try {
        // Remove tudo que não for número, vírgula ou hífen (para negativos)
        let clean = valueStr.replace(/[^\d,\.-]/g, '');
        // Troca ponto de milhar por nada e vírgula decimal por ponto
        clean = clean.replace(/\./g, '').replace(',', '.');
        return parseFloat(clean) || 0;
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
    // Remove acentos, pontuações extras e deixa minúsculo
    return str.normalize("NFD").replace(REGEX_NORMALIZE, "").replace(/[^a-zA-Z0-9 ]/g, "").toLowerCase().trim();
}

function chunkArray(array, size) {
    const results = [];
    for (let i = 0; i < array.length; i += size) {
        results.push(array.slice(i, i + size));
    }
    return results;
}

async function fetchHtmlWithRetry(ticker) {
    const tickerLower = ticker.toLowerCase();
    try {
        // Tenta FII primeiro
        return await client.get(`https://investidor10.com.br/fiis/${tickerLower}/`);
    } catch (e) {
        if (e.response && e.response.status === 404) {
            // Se falhar, tenta Ações
            return await client.get(`https://investidor10.com.br/acoes/${tickerLower}/`);
        }
        throw e;
    }
}

// --- CORE: SCRAPER DE FUNDAMENTOS ---
async function scrapeFundamentos(ticker) {
    try {
        const response = await fetchHtmlWithRetry(ticker);
        const html = response.data;
        const $ = cheerio.load(html);

        let dados = {
            dy: 'N/A', pvp: 'N/A', segmento: 'N/A', tipo_fundo: 'N/A', mandato: 'N/A',
            vacancia: 'N/A', vp_cota: 'N/A', liquidez: 'N/A', val_mercado: 'N/A',
            patrimonio_liquido: 'N/A', variacao_12m: 'N/A', ultimo_rendimento: 'N/A',
            cnpj: 'N/A', num_cotistas: 'N/A', tipo_gestao: 'N/A', prazo_duracao: 'N/A',
            taxa_adm: 'N/A', cotas_emitidas: 'N/A',
            pl: 'N/A', roe: 'N/A', lpa: 'N/A', margem_liquida: 'N/A', 
            divida_liquida_ebitda: 'N/A', ev_ebit: 'N/A', roic: 'N/A'
        };

        let cotacao_atual = 0;
        let num_cotas = 0;

        // --- FUNÇÃO DE MAPEAMENTO INTELIGENTE ---
        const processPair = (tituloRaw, valorRaw) => {
            const titulo = normalize(tituloRaw); // Ex: "divida liquida ebitda"
            const valor = valorRaw.trim();
            if (!valor || valor === '-') return;

            // FIIs e Comuns
            if (dados.dy === 'N/A' && (titulo.includes('dividend yield') || titulo === 'dy')) dados.dy = valor;
            // P/VP aceita variações
            if (dados.pvp === 'N/A' && (titulo === 'pvp' || titulo === 'p vp')) dados.pvp = valor;
            
            if (dados.liquidez === 'N/A' && (titulo.includes('liquidez') && titulo.includes('diaria'))) dados.liquidez = valor;
            if (dados.val_mercado === 'N/A' && titulo.includes('valor de mercado')) dados.val_mercado = valor;
            if (dados.ultimo_rendimento === 'N/A' && titulo.includes('ultimo rendimento')) dados.ultimo_rendimento = valor;
            
            // Variação (Pega a de 12 meses preferencialmente)
            if (titulo.includes('12 meses') || (titulo.includes('variacao') && titulo.includes('12m'))) {
                dados.variacao_12m = valor;
            }

            // Ações (Indicadores) - Usa includes para ser mais flexível
            if (dados.pl === 'N/A' && (titulo === 'pl' || titulo.includes('preco lucro'))) dados.pl = valor;
            if (dados.roe === 'N/A' && titulo.includes('roe')) dados.roe = valor;
            if (dados.roic === 'N/A' && titulo.includes('roic')) dados.roic = valor;
            if (dados.lpa === 'N/A' && titulo.includes('lpa')) dados.lpa = valor;
            if (dados.margem_liquida === 'N/A' && titulo.includes('margem liquida')) dados.margem_liquida = valor;
            if (dados.divida_liquida_ebitda === 'N/A' && (titulo.includes('divida liquida ebitda') || titulo.includes('div liq ebitda'))) dados.divida_liquida_ebitda = valor;
            if (dados.ev_ebit === 'N/A' && titulo.includes('ev ebit')) dados.ev_ebit = valor;

            // Dados Gerais (FIIs e Empresas)
            if (dados.segmento === 'N/A' && (titulo.includes('segmento') || titulo.includes('setor'))) dados.segmento = valor;
            if (dados.vacancia === 'N/A' && titulo.includes('vacancia')) dados.vacancia = valor;
            if (dados.cnpj === 'N/A' && titulo.includes('cnpj')) dados.cnpj = valor;
            if (dados.num_cotistas === 'N/A' && titulo.includes('cotistas')) dados.num_cotistas = valor;
            if (dados.tipo_gestao === 'N/A' && titulo.includes('gestao')) dados.tipo_gestao = valor;
            if (dados.tipo_fundo === 'N/A' && titulo.includes('tipo de fundo')) dados.tipo_fundo = valor;
            if (dados.mandato === 'N/A' && titulo.includes('mandato')) dados.mandato = valor;

            // Lógica Específica para Patrimônio vs VP/Cota
            // VP por Cota geralmente tem "cota" no nome
            if (titulo.includes('patrimonial') && titulo.includes('cota')) {
                dados.vp_cota = valor;
            } 
            // Patrimônio Líquido total
            else if (titulo === 'patrimonio liquido' || titulo.includes('patrimonio liquido')) {
                 dados.patrimonio_liquido = valor;
            }

            // Captura Cotas Emitidas para calculo de fallback
            if (titulo.includes('cotas emitidas') || titulo.includes('total de papeis')) {
                dados.cotas_emitidas = valor;
                num_cotas = parseValue(valor);
            }
        };

        // 1. CARDS DO TOPO (Geralmente contêm os dados principais)
        $('._card').each((i, el) => {
            const header = $(el).find('._card-header span').text() || $(el).find('._card-header').text();
            const body = $(el).find('._card-body span').text() || $(el).find('._card-body').text();
            processPair(header, body);
        });

        // 2. TABELAS DE INDICADORES (Onde ficam P/L, ROE, Margens em Ações)
        // O Investidor10 costuma usar divs com classe .cell dentro de containers grid
        $('.cell').each((i, el) => {
            const name = $(el).find('.name').text();
            const value = $(el).find('.value').text();
            processPair(name, value);
        });

        // 3. TABELAS DE DADOS GERAIS (Sobre, Características)
        $('#table-indicators .cell').each((i, el) => { // Reforço para tabela de indicadores
             processPair($(el).find('.name').text(), $(el).find('.value').text());
        });
        
        // Dados como CNPJ e Segmento muitas vezes estão em tabelas simples tr/td
        $('table tbody tr').each((i, row) => {
            const cols = $(row).find('td');
            if (cols.length >= 2) {
                const key = $(cols[0]).text();
                const val = $(cols[1]).text();
                processPair(key, val);
            }
        });

        // 4. CAPTURA DE COTAÇÃO ATUAL (Para fallback de Valor de Mercado)
        const cotacaoEl = $('._card.cotacao ._card-body span').first();
        if (cotacaoEl.length) cotacao_atual = parseValue(cotacaoEl.text());

        // 5. CORREÇÕES DE FALLBACK (Se Valor de Mercado vier vazio, calcula)
        if (dados.val_mercado === 'N/A' || dados.val_mercado === '-') {
            let mercadoCalc = 0;
            // Tenta: Cotação * Num Ações/Cotas
            if (cotacao_atual > 0 && num_cotas > 0) {
                mercadoCalc = cotacao_atual * num_cotas;
            } 
            // Tenta: PL Total * P/VP (Estimativa grosseira mas útil para FIIs)
            else if (dados.patrimonio_liquido !== 'N/A' && dados.pvp !== 'N/A') {
                const plValue = parseExtendedValue(dados.patrimonio_liquido);
                const pvpValue = parseValue(dados.pvp);
                if (plValue > 0 && pvpValue > 0) mercadoCalc = plValue * pvpValue;
            }

            if (mercadoCalc > 0) {
                if (mercadoCalc > 1000000000) dados.val_mercado = `R$ ${(mercadoCalc / 1000000000).toFixed(2)} Bilhões`;
                else if (mercadoCalc > 1000000) dados.val_mercado = `R$ ${(mercadoCalc / 1000000).toFixed(2)} Milhões`;
                else dados.val_mercado = formatCurrency(mercadoCalc);
            }
        }

        // Se VP por Cota ainda estiver N/A mas tivermos Patrimônio e Num Cotas (FIIs)
        if (dados.vp_cota === 'N/A' && dados.patrimonio_liquido !== 'N/A' && num_cotas > 0) {
            const patLiqVal = parseExtendedValue(dados.patrimonio_liquido);
            if (patLiqVal > 0) {
                dados.vp_cota = formatCurrency(patLiqVal / num_cotas);
            }
        }

        return dados;

    } catch (error) {
        console.error(`Erro scraper ${ticker}:`, error.message);
        return { dy: '-', pvp: '-', segmento: '-' };
    }
}

// --- SCRAPER DE HISTÓRICO (Mantido e Ajustado) ---
async function scrapeAsset(ticker) {
    try {
        const response = await fetchHtmlWithRetry(ticker);
        const html = response.data;
        const $ = cheerio.load(html);
        const dividendos = [];

        // Tenta encontrar a tabela específica de proventos
        let tableRows = $('#table-dividends-history tbody tr');
        
        // Fallback: Procura qualquer tabela com headers de proventos
        if (tableRows.length === 0) {
            $('table').each((i, tbl) => {
                const header = normalize($(tbl).find('thead').text());
                if (header.includes('com') && header.includes('pagamento') && header.includes('valor')) {
                    tableRows = $(tbl).find('tbody tr');
                    return false; // Break
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

// --- HANDLER SERVERLESS (Vercel) ---
module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Cache: 1 hora de TTL, stale-while-revalidate por 24h
    if (req.method === 'GET' || (req.method === 'POST' && req.body.mode !== 'proventos_carteira')) {
       res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    }

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'POST') { return res.status(405).json({ error: "Use POST" }); }

    try {
        if (!req.body || !req.body.mode) throw new Error("Payload inválido");
        const { mode, payload } = req.body;

        // 1. FUNDAMENTOS (DETALHES DO ATIVO)
        if (mode === 'fundamentos') {
            if (!payload.ticker) return res.json({ json: {} });
            const dados = await scrapeFundamentos(payload.ticker);
            return res.status(200).json({ json: dados });
        }

        // 2. PROVENTOS DA CARTEIRA (IA / PREVISÃO)
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
                if (batches.length > 1) await new Promise(r => setTimeout(r, 500)); 
            }
            return res.status(200).json({ json: finalResults.filter(d => d !== null).flat() });
        }

        // 3. HISTÓRICO 12M (GRÁFICO DETALHES)
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

        // 4. HISTÓRICO PORTFOLIO (GRÁFICO AGREGADO)
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

        // 5. PRÓXIMO PROVENTO (CARD DETALHES)
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
