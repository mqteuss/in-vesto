const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// --- OTIMIZAÇÃO: AGENTE HTTPS ---
const httpsAgent = new https.Agent({ 
    keepAlive: true,
    maxSockets: 128,
    maxFreeSockets: 20,
    timeout: 10000
});

const client = axios.create({
    httpsAgent,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://investidor10.com.br/'
    },
    timeout: 8000
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

function parseExtendedValue(valueStr) {
    if (!valueStr) return 0;
    const cleanStr = valueStr.replace(REGEX_CLEAN_NUMBER, "").replace(',', '.');
    const val = parseFloat(cleanStr) || 0;
    const lower = valueStr.toLowerCase();
    if (lower.includes('bilh')) return val * 1e9;
    if (lower.includes('milh')) return val * 1e6;
    return val;
}

function normalize(str) {
    return str.normalize("NFD").replace(REGEX_NORMALIZE, "").toLowerCase();
}

function cleanDoubledString(str) {
    if (!str) return '';
    const half = Math.floor(str.length / 2);
    const firstHalf = str.substring(0, half).trim();
    const secondHalf = str.substring(half).trim();
    if (firstHalf === secondHalf) return firstHalf;
    return str;
}

function formatCurrency(value) {
    if (value >= 1e9) return `R$ ${(value / 1e9).toFixed(2)} Bilhões`;
    if (value >= 1e6) return `R$ ${(value / 1e6).toFixed(2)} Milhões`;
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ---------------------------------------------------------
// PARTE 1: FUNDAMENTOS -> INVESTIDOR10
// ---------------------------------------------------------

async function scrapeFundamentos(ticker) {
    try {
        let html;
        try {
            // Tenta FIIs primeiro
            const res = await client.get(`https://investidor10.com.br/fiis/${ticker.toLowerCase()}/`);
            html = res.data;
        } catch (e) {
            // Se falhar, tenta Ações
            const res = await client.get(`https://investidor10.com.br/acoes/${ticker.toLowerCase()}/`);
            html = res.data;
        }

        const $ = cheerio.load(html);

        let dados = {
            // Campos Comuns
            dy: 'N/A', pvp: 'N/A', pl: 'N/A', roe: 'N/A', lpa: 'N/A', vp_cota: 'N/A',
            val_mercado: 'N/A', liquidez: 'N/A', variacao_12m: 'N/A',

            // FIIs
            segmento: 'N/A', tipo_fundo: 'N/A', mandato: 'N/A', vacancia: 'N/A',
            patrimonio_liquido: 'N/A', ultimo_rendimento: 'N/A', cnpj: 'N/A',
            num_cotistas: 'N/A', tipo_gestao: 'N/A', prazo_duracao: 'N/A',
            taxa_adm: 'N/A', cotas_emitidas: 'N/A', publico_alvo: 'N/A',

            // Ações (Novos Campos)
            margem_liquida: 'N/A', margem_bruta: 'N/A', margem_ebit: 'N/A',
            divida_liquida_ebitda: 'N/A', divida_liquida_pl: 'N/A', ev_ebitda: 'N/A',
            payout: 'N/A', cagr_receita_5a: 'N/A', cagr_lucros_5a: 'N/A',
            
            // NOVO CAMPO: Histórico
            historico_precos: []
        };

        let cotacao_atual = 0;
        let num_cotas = 0;

        const processPair = (tituloRaw, valorRaw, origem = 'table', indicatorAttr = null) => {
             const titulo = normalize(tituloRaw); 
             let valor = valorRaw.trim();
             
             if (titulo.includes('mercado')) {
                valor = cleanDoubledString(valor);
                if (dados.val_mercado !== 'N/A' && origem === 'table') return;
             }
             
             if (!valor) return;

            // Prioridade para data-indicator (mais preciso para ações)
             if (indicatorAttr) {
                const ind = indicatorAttr.toUpperCase();
                if (ind === 'DIVIDA_LIQUIDA_EBITDA') { dados.divida_liquida_ebitda = valor; return; }
                if (ind === 'DY') { dados.dy = valor; return; }
                if (ind === 'P_L') { dados.pl = valor; return; }
                if (ind === 'P_VP') { dados.pvp = valor; return; }
                if (ind === 'ROE') { dados.roe = valor; return; }
                if (ind === 'MARGEM_LIQUIDA') { dados.margem_liquida = valor; return; }
            }

            if (dados.dy === 'N/A' && (titulo === 'dy' || titulo.includes('dividend yield') || titulo.includes('dy ('))) dados.dy = valor;
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
            if (dados.cotas_emitidas === 'N/A' && titulo.includes('cotas')) dados.cotas_emitidas = valor;
            if (dados.publico_alvo === 'N/A' && titulo.includes('publico') && titulo.includes('alvo')) dados.publico_alvo = valor;

            // Ações - Backup se data-indicator falhar
            if (dados.pl === 'N/A' && (titulo === 'p/l' || titulo.includes('p/l'))) dados.pl = valor;
            if (dados.roe === 'N/A' && titulo.replace(/\./g, '') === 'roe') dados.roe = valor;
            if (dados.lpa === 'N/A' && titulo.replace(/\./g, '') === 'lpa') dados.lpa = valor;
            if (titulo.includes('margem liquida')) dados.margem_liquida = valor;
            if (titulo.includes('margem bruta')) dados.margem_bruta = valor;
            if (titulo.includes('margem ebit')) dados.margem_ebit = valor;
            if (titulo.includes('payout')) dados.payout = valor;
            if (titulo.includes('ev/ebitda')) dados.ev_ebitda = valor;

            const tClean = titulo.replace(/[\s\/\.\-]/g, ''); 
            if (dados.divida_liquida_ebitda === 'N/A') {
                if (tClean.includes('div') && tClean.includes('liq') && tClean.includes('ebitda')) dados.divida_liquida_ebitda = valor;
            }
            if (tClean.includes('div') && tClean.includes('liq') && tClean.includes('patrim')) dados.divida_liquida_pl = valor;

            if (titulo.includes('cagr') && titulo.includes('receita')) dados.cagr_receita_5a = valor;
            if (titulo.includes('cagr') && titulo.includes('lucro')) dados.cagr_lucros_5a = valor;

            if (dados.vp_cota === 'N/A') {
                if (titulo === 'vpa' || titulo.replace(/\./g, '') === 'vpa' || titulo.includes('vp por cota')) dados.vp_cota = valor;
            }

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

        $('._card').each((i, el) => {
            const titulo = $(el).find('._card-header').text().trim();
            const valor = $(el).find('._card-body').text().trim();
            processPair(titulo, valor, 'card');
            
            if (normalize(titulo).includes('cotacao')) cotacao_atual = parseValue(valor);
        });

         if (cotacao_atual === 0) {
             const cEl = $('._card.cotacao ._card-body span').first();
             if (cEl.length) cotacao_atual = parseValue(cEl.text());
        }

        $('.cell').each((i, el) => {
            let titulo = $(el).find('.name').text().trim();
            if (!titulo) titulo = $(el).children('span').first().text().trim();
            
            let valorEl = $(el).find('.value span').first();
            let valor = (valorEl.length > 0) ? valorEl.text().trim() : $(el).find('.value').text().trim();
            
            processPair(titulo, valor, 'cell');
        });

        $('table tbody tr').each((i, row) => {
            const cols = $(row).find('td');
            if (cols.length >= 2) {
                const indicatorAttr = $(cols[0]).find('[data-indicator]').attr('data-indicator');
                processPair($(cols[0]).text(), $(cols[1]).text(), 'table', indicatorAttr);
            }
        });

        // --- CÁLCULO DE VALOR DE MERCADO ---
        if (dados.val_mercado === 'N/A' || dados.val_mercado === '-') {
            let mercadoCalc = 0;
            if (cotacao_atual > 0 && num_cotas > 0) {
                mercadoCalc = cotacao_atual * num_cotas;
            } else if (dados.patrimonio_liquido !== 'N/A' && dados.pvp !== 'N/A') {
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
        
        // --- NOVA LÓGICA: EXTRAÇÃO DO GRÁFICO DE PREÇOS (COMPARE) ---
        // Busca o array JSON que popula o gráfico de rentabilidade no Investidor10
        try {
            const regexCompare = /let compare\s*=\s*({.*?});/s;
            const match = html.match(regexCompare);
            
            if (match && match[1]) {
                const jsObj = match[1];
                // Regex para pegar o JSON dentro de JSON.parse(`...`) na propriedade 'profitabilities'
                const regexJson = /'profitabilities':\s*JSON\.parse\(`(.*?)`\)/s;
                const matchJson = jsObj.match(regexJson);

                if (matchJson && matchJson[1]) {
                    const parsedData = JSON.parse(matchJson[1]);
                    // O primeiro array (índice 0) é o do ativo principal
                    if (Array.isArray(parsedData) && parsedData.length > 0) {
                        const assetHistory = parsedData[0];
                        // Extrai os últimos 12 meses
                        // O formato vem como [{date: "MM/YY", price: 10.5}, ...]
                        dados.historico_precos = assetHistory.slice(-13).map(item => ({
                            mes: item.date,
                            valor: item.price
                        }));
                    }
                }
            }
        } catch (e) {
            console.error("Erro ao extrair histórico de preços:", e.message);
        }

        return dados;
    } catch (error) {
        console.error("Erro scraper:", error.message);
        return { dy: '-', pvp: '-' };
    }
}

// ---------------------------------------------------------
// PARTE 2: HISTÓRICO DE PROVENTOS (STATUS INVEST)
// ---------------------------------------------------------

async function scrapeAsset(ticker) {
    if (!ticker) return [];
    try {
        const response = await client.get(`https://statusinvest.com.br/acoes/${ticker.toLowerCase()}`);
        const $ = cheerio.load(response.data);
        const inputCotas = $('input#results');
        if (inputCotas.length > 0) {
            const value = inputCotas.val();
            return JSON.parse(value);
        }
        
        // Fallback FIIs
        const resFii = await client.get(`https://statusinvest.com.br/fundos-imobiliarios/${ticker.toLowerCase()}`);
        const $fii = cheerio.load(resFii.data);
        const inputFii = $fii('input#results');
        if (inputFii.length > 0) return JSON.parse(inputFii.val());
        
        return [];
    } catch (error) {
        return [];
    }
}

// ---------------------------------------------------------
// EXPORTAÇÃO (API HANDLER)
// ---------------------------------------------------------

module.exports = async (req, res) => {
    try {
        const { mode, payload } = req.body;

        if (mode === 'fundamentos') {
            if (!payload.ticker) return res.json({});
            const dados = await scrapeFundamentos(payload.ticker);
            return res.status(200).json(dados);
        }

        if (mode === 'proventos_carteira') {
            const { fiiList } = payload;
            if (!fiiList || !Array.isArray(fiiList)) return res.json({ json: [] });

            const BATCH_SIZE = 5; 
            let finalResults = [];

            const batches = [];
            for (let i = 0; i < fiiList.length; i += BATCH_SIZE) {
                batches.push(fiiList.slice(i, i + BATCH_SIZE));
            }

            for (const batch of batches) {
                const promises = batch.map(async (ticker) => {
                    const history = await scrapeAsset(ticker);
                    const recents = history.filter(h => {
                         const payDate = new Date(h.paymentDividend);
                         const cutoff = new Date();
                         cutoff.setMonth(cutoff.getMonth() - 12); 
                         return payDate >= cutoff;
                    }).map(h => ({
                        symbol: ticker.toUpperCase(),
                        paymentDate: h.paymentDividend,
                        dataCom: h.dateCom,
                        value: h.resultAbsoluteValue,
                        type: h.earningType 
                    }));
                    if (recents.length > 0) return recents;
                    return null;
                });

                const batchResults = await Promise.all(promises);
                finalResults = finalResults.concat(batchResults.filter(r => r !== null).flat());
                
                if (batches.length > 1) await new Promise(r => setTimeout(r, 200)); 
            }

            return res.status(200).json({ json: finalResults });
        }

        if (mode === 'historico_portfolio') {
            const { fiiList } = payload;
            if (!fiiList || !Array.isArray(fiiList)) return res.json({ json: [] });

            let finalResults = [];
            const BATCH_SIZE = 5;
            const batches = [];
            
            for (let i = 0; i < fiiList.length; i += BATCH_SIZE) {
                batches.push(fiiList.slice(i, i + BATCH_SIZE));
            }

            for (const batch of batches) {
                const promises = batch.map(async (ticker) => {
                    const history = await scrapeAsset(ticker);
                    const recents = history.filter(h => {
                        const payDate = new Date(h.paymentDividend);
                        const cutoff = new Date();
                        cutoff.setMonth(cutoff.getMonth() - 12);
                        return payDate >= cutoff;
                    });
                    
                    if (recents.length > 0) return recents.map(r => ({ symbol: ticker.toUpperCase(), ...r }));
                    return null;
                });
                const batchResults = await Promise.all(promises);
                finalResults = finalResults.concat(batchResults);
                if (batches.length > 1) await new Promise(r => setTimeout(r, 200)); 
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
    } catch (e) {
        console.error("API Error:", e);
        return res.status(500).json({ error: e.message });
    }
};