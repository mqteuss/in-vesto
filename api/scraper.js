const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// ---------------------------------------------------------
// CONFIGURAÇÃO: AGENTE HTTPS & CLIENTE AXIOS
// ---------------------------------------------------------
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

// ---------------------------------------------------------
// HELPERS (FUNÇÕES AUXILIARES)
// ---------------------------------------------------------
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
// PARTE 1: FUNDAMENTOS -> INVESTIDOR10
// ---------------------------------------------------------

async function scrapeFundamentos(ticker) {
    try {
        let html;
        // Dispara FII e Ação em paralelo — usa a que responder primeiro com sucesso
        // Economiza ~1-2s no caso de ações (elimina o round-trip de fallback sequencial)
        const urlFii  = `https://investidor10.com.br/fiis/${ticker.toLowerCase()}/`;
        const urlAcao = `https://investidor10.com.br/acoes/${ticker.toLowerCase()}/`;

        const fetchHtml = async (url) => {
            const res = await client.get(url);
            if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
            // Rejeita páginas inválidas (404 customizado, ticker não encontrado)
            if (!res.data.includes('cotacao') && !res.data.includes('Cotação')) throw new Error('Página inválida');
            return res.data;
        };

        try {
            html = await Promise.any([fetchHtml(urlFii), fetchHtml(urlAcao)]);
        } catch (e) {
            // Promise.any só rejeita quando TODAS falham (AggregateError)
            throw new Error('Ativo não encontrado no Investidor10');
        }

        const $ = cheerio.load(html);

let dados = {
            // Campos Comuns
            dy: 'N/A', pvp: 'N/A', pl: 'N/A', roe: 'N/A', lpa: 'N/A', vp_cota: 'N/A',
            val_mercado: 'N/A', liquidez: 'N/A', variacao_12m: 'N/A', ultimo_rendimento: 'N/A',

            // FIIs
            segmento: 'N/A', tipo_fundo: 'N/A', mandato: 'N/A', vacancia: 'N/A',
            patrimonio_liquido: 'N/A', cnpj: 'N/A',
            num_cotistas: 'N/A', tipo_gestao: 'N/A', prazo_duracao: 'N/A',
            taxa_adm: 'N/A', cotas_emitidas: 'N/A', publico_alvo: 'N/A',

            // Ações (Novos Campos)
            margem_liquida: 'N/A', margem_bruta: 'N/A', margem_ebit: 'N/A',
            divida_liquida_ebitda: 'N/A', divida_liquida_pl: 'N/A', ev_ebitda: 'N/A',
            payout: 'N/A', cagr_receita_5a: 'N/A', cagr_lucros_5a: 'N/A',

            // --- NOVO: ARRAY DE IMÓVEIS ---
            imoveis: [] 
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

            // --- DATA-INDICATOR (Prioridade) ---
            if (indicatorAttr) {
                const ind = indicatorAttr.toUpperCase();
                if (ind === 'DIVIDA_LIQUIDA_EBITDA') { dados.divida_liquida_ebitda = valor; return; }
                if (ind === 'DY') { dados.dy = valor; return; }
                if (ind === 'P_L') { dados.pl = valor; return; }
                if (ind === 'P_VP') { dados.pvp = valor; return; }
                if (ind === 'ROE') { dados.roe = valor; return; }
                if (ind === 'MARGEM_LIQUIDA') { dados.margem_liquida = valor; return; }
            }

            // --- FALLBACK POR TEXTO ---
            // Geral
            if (dados.dy === 'N/A' && (titulo === 'dy' || titulo.includes('dividend yield') || titulo.includes('dy ('))) dados.dy = valor;
            if (dados.pvp === 'N/A' && titulo.includes('p/vp')) dados.pvp = valor;
            if (dados.liquidez === 'N/A' && titulo.includes('liquidez')) dados.liquidez = valor;
            if (dados.val_mercado === 'N/A' && titulo.includes('mercado')) dados.val_mercado = valor;
            if (dados.variacao_12m === 'N/A' && titulo.includes('variacao') && titulo.includes('12m')) dados.variacao_12m = valor;
            if (dados.ultimo_rendimento === 'N/A' && titulo.includes('ultimo rendimento')) dados.ultimo_rendimento = valor;

            // FIIs
            if (dados.segmento === 'N/A' && titulo.includes('segmento')) dados.segmento = valor;
            if (dados.vacancia === 'N/A' && titulo.includes('vacancia')) dados.vacancia = valor;
            if (dados.cnpj === 'N/A' && titulo.includes('cnpj')) dados.cnpj = valor;
            if (dados.num_cotistas === 'N/A' && titulo.includes('cotistas')) dados.num_cotistas = valor;
            if (dados.tipo_gestao === 'N/A' && titulo.includes('gestao')) dados.tipo_gestao = valor;
            if (dados.mandato === 'N/A' && titulo.includes('mandato')) dados.mandato = valor;
            if (dados.tipo_fundo === 'N/A' && titulo.includes('tipo de fundo')) dados.tipo_fundo = valor;
            if (dados.prazo_duracao === 'N/A' && titulo.includes('prazo')) dados.prazo_duracao = valor;
            if (dados.taxa_adm === 'N/A' && titulo.includes('taxa') && titulo.includes('administracao')) dados.taxa_adm = valor;
            if (dados.cotas_emitidas === 'N/A' && titulo.includes('cotas')) dados.cotas_emitidas = valor;
            if (dados.publico_alvo === 'N/A' && titulo.includes('publico') && titulo.includes('alvo')) dados.publico_alvo = valor;

            // Ações
            if (dados.pl === 'N/A' && (titulo === 'p/l' || titulo.includes('p/l'))) dados.pl = valor;
            if (dados.roe === 'N/A' && titulo.replace(/\./g, '') === 'roe') dados.roe = valor;
            if (dados.lpa === 'N/A' && titulo.replace(/\./g, '') === 'lpa') dados.lpa = valor;

            // Margens & Payout
            if (titulo.includes('margem liquida')) dados.margem_liquida = valor;
            if (titulo.includes('margem bruta')) dados.margem_bruta = valor;
            if (titulo.includes('margem ebit')) dados.margem_ebit = valor;
            if (titulo.includes('payout')) dados.payout = valor;

            // EV e Dívidas
            if (titulo.includes('ev/ebitda')) dados.ev_ebitda = valor;
            const tClean = titulo.replace(/[\s\/\.\-]/g, ''); 
            if (dados.divida_liquida_ebitda === 'N/A') {
                if (tClean.includes('div') && tClean.includes('liq') && tClean.includes('ebitda')) dados.divida_liquida_ebitda = valor;
            }
            if (tClean.includes('div') && tClean.includes('liq') && tClean.includes('patrim')) dados.divida_liquida_pl = valor;

            // CAGR
            if (titulo.includes('cagr') && titulo.includes('receita')) dados.cagr_receita_5a = valor;
            if (titulo.includes('cagr') && titulo.includes('lucro')) dados.cagr_lucros_5a = valor;

            // VPA/Patrimônio
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

        // --- EXECUÇÃO ---
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

// --- BUSCA DE IMÓVEIS (FIIs) ---
        $('#properties-section .card-propertie').each((i, el) => {
            const nome = $(el).find('h3').text().trim();
            let estado = '';
            let abl = '';
            $(el).find('small').each((j, small) => {
                const t = $(small).text().trim();
                if (t.includes('Estado:')) estado = t.replace('Estado:', '').trim();
                if (t.includes('Área bruta locável:')) abl = t.replace('Área bruta locável:', '').trim();
            });
            if (nome) {
                dados.imoveis.push({ nome, estado, abl });
            }
        });

        return dados;
    } catch (error) {
        console.error("Erro scraper:", error.message);
        return { dy: '-', pvp: '-' };
    }
}

// ---------------------------------------------------------
// PARTE 2: PROVENTOS -> STATUSINVEST
// ---------------------------------------------------------

async function scrapeAsset(ticker) {
    try {
        const t = ticker.toUpperCase();
        let type = 'acao';
        // FIIs brasileiros: terminam em 11 ou 11B
        if (/\d{2}B?$/.test(t) && t.endsWith('11') || t.endsWith('11B')) type = 'fii';

        // parseDateJSON hoistado fora do .map() — evita recriar a função a cada iteração
        const parseDateJSON = (dStr) => {
            if (!dStr || dStr.trim() === '' || dStr.trim() === '-') return null;
            const parts = dStr.split('/');
            if (parts.length !== 3) return null;
            return `${parts[2]}-${parts[1]}-${parts[0]}`;
        };

        const url = `https://statusinvest.com.br/${type}/companytickerprovents?ticker=${t}&chartProventsType=2`;

        const { data } = await client.get(url, { 
            headers: { 
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': 'https://statusinvest.com.br/',
                'User-Agent': 'Mozilla/5.0'
            } 
        });

        const earnings = data.assetEarningsModels || [];

        // Se retornou vazio e tentamos como 'acao', pode ser um FII com ticker atípico — tenta de novo
        if (earnings.length === 0 && type === 'acao') {
            const urlFii = `https://statusinvest.com.br/fii/companytickerprovents?ticker=${t}&chartProventsType=2`;
            const { data: dataFii } = await client.get(urlFii, {
                headers: { 'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://statusinvest.com.br/' }
            }).catch(() => ({ data: {} }));
            if ((dataFii.assetEarningsModels || []).length > 0) {
                earnings.push(...dataFii.assetEarningsModels);
            }
        }

        const dividendos = earnings.map(d => {
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
                dataCom:     parseDateJSON(d.ed),
                paymentDate: parseDateJSON(d.pd),
                value:       d.v,
                type:        labelTipo,
                rawType:     d.et
            };
        });

        return dividendos.filter(d => d.paymentDate !== null).sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));

    } catch (error) { 
        console.error(`Erro StatusInvest API ${ticker}:`, error.message);
        return []; 
    }
}

// ---------------------------------------------------------
// PARTE 3: IPCA -> INVESTIDOR10
// ---------------------------------------------------------

async function scrapeIpca() {
    try {
        const url = 'https://investidor10.com.br/indices/ipca/';
        const { data } = await client.get(url);
        const $ = cheerio.load(data);

        const historico = [];
        let acumulado12m = '0,00';
        let acumuladoAno = '0,00';

        // Selector direto pelos headers conhecidos — evita ler .text() de todas as tabelas
        let $table = $('table').filter((i, el) => {
            const firstRow = $(el).find('thead tr th').first().text().toLowerCase();
            return firstRow.includes('acumulado') || firstRow.includes('varia');
        }).first();

        // Fallback para busca por conteúdo se o selector direto não encontrar
        if (!$table.length) {
            $('table').each((i, el) => {
                if ($table.length) return false;
                const headers = $(el).find('thead').text().toLowerCase();
                if (headers.includes('acumulado 12 meses') || headers.includes('variação em %')) {
                    $table = $(el);
                }
            });
        }

        if ($table) {
            $table.find('tbody tr').each((i, el) => {
                const cols = $(el).find('td');
                if (cols.length >= 2) {
                    const dataRef = $(cols[0]).text().trim();
                    const valorStr = $(cols[1]).text().trim();
                    const acAnoStr = $(cols[2]).text().trim();
                    const ac12mStr = $(cols[3]).text().trim();

                    if (i === 0) {
                         acumulado12m = ac12mStr.replace('.', ','); 
                         acumuladoAno = acAnoStr.replace('.', ',');
                    }

                    if (dataRef && valorStr && i < 13) {
                         historico.push({
                             mes: dataRef,
                             valor: parseFloat(valorStr.replace('.', '').replace(',', '.')),
                             acumulado_12m: ac12mStr.replace('.', ','),
                             acumulado_ano: acAnoStr.replace('.', ',')
                         });
                    }
                }
            });
        }

        const historicoCronologico = historico.reverse();

        return {
            historico: historicoCronologico,
            acumulado_12m: acumulado12m,
            acumulado_ano: acumuladoAno
        };

    } catch (error) {
        console.error('Erro no Scraper IPCA:', error);
        return { historico: [], acumulado_12m: '0,00', acumulado_ano: '0,00' };
    }
}

// ---------------------------------------------------------
// PARTE 4: COTAÇÃO HISTÓRICA (COM FALLBACK YAHOO FINANCE)
// ---------------------------------------------------------

// --- HELPER: Mapeamento de Ranges do Yahoo ---
function getYahooParams(range) {
    switch (range) {
        case '1D': return { range: '1d', interval: '5m' };   // Intraday
        case '5D': return { range: '5d', interval: '15m' };  // Intraday
        case '1M': return { range: '1mo', interval: '1d' };
        case '6M': return { range: '6mo', interval: '1d' };
        case 'YTD': return { range: 'ytd', interval: '1d' };
        case '1Y': 
        case '1A': return { range: '1y', interval: '1d' };
        case '5Y': 
        case '5A': return { range: '5y', interval: '1wk' };
        case 'Tudo':
        case 'MAX': return { range: 'max', interval: '1mo' };
        default: return { range: '1y', interval: '1d' };
    }
}

async function fetchYahooFinance(ticker, rangeFilter = '1A') {
    try {
        const symbol = ticker.toUpperCase().endsWith('.SA') ? ticker.toUpperCase() : `${ticker.toUpperCase()}.SA`;
        const { range, interval } = getYahooParams(rangeFilter);

        // Tenta query1 primeiro; se falhar (rate-limit ou instabilidade), cai para query2
        const buildUrl = (host) => 
            `https://${host}.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}&includePrePost=false`;

        let data;
        try {
            ({ data } = await client.get(buildUrl('query1'), {
                headers: { 'Accept': 'application/json' }
            }));
        } catch (e) {
            ({ data } = await client.get(buildUrl('query2'), {
                headers: { 'Accept': 'application/json' }
            }));
        }

        const result = data.chart.result[0];

        if (!result || !result.timestamp || !result.indicators.quote[0].close) return null;

        const timestamps = result.timestamp;
        const quote  = result.indicators.quote[0];
        const prices = quote.close;
        const opens  = quote.open;
        const highs  = quote.high;
        const lows   = quote.low;

        // Formata com OHLC completo
        const points = timestamps.map((t, i) => {
            if (prices[i] === null || prices[i] === undefined) return null;
            return {
                date:      new Date(t * 1000).toISOString(),
                timestamp: t * 1000,
                price:     prices[i],          // close
                open:      opens[i]  ?? prices[i],
                high:      highs[i]  ?? prices[i],
                low:       lows[i]   ?? prices[i]
            };
        }).filter(p => p !== null);

        return points;

    } catch (e) {
        console.error(`[DEBUG] Erro Yahoo Finance para ${ticker}:`, e.message);
        return null;
    }
}

// Atualize a função principal do scraper para receber o range
async function scrapeCotacaoHistory(ticker, range = '1A') {
    const cleanTicker = ticker.toLowerCase().trim();

    // Para gráficos dinâmicos com filtros variados, o Yahoo Finance é mais estável e suporta intraday
    // Vamos priorizar o Yahoo para essa funcionalidade específica
    const data = await fetchYahooFinance(cleanTicker, range);

    if (!data || data.length === 0) {
        return { error: "Dados não encontrados", points: [] };
    }

    return {
        ticker: cleanTicker.toUpperCase(),
        range: range,
        points: data // Retorna array único focado no range pedido
    };
}

// ---------------------------------------------------------
// PARTE 5: ANÁLISE PROFUNDA DE FIIs -> INVESTIDOR10
// ---------------------------------------------------------

async function scrapeAnaliseProfundaFii(ticker) {
    // Retorna:
    //   sobre             → string
    //   dividend_yield    → [{periodo, percentual, valor}]          (1M/3M/6M/12M)
    //   comparacao_fiis   → [{ticker, dividend_yield, p_vp, valor_patrimonial, tipo, segmento}]
    //   historico_indicadores → [{ano, dy, pvp, variacao, rendimento}]  (anual – até 10 anos)
    //   comparacao_indices    → {labels:[], series:[{nome, cor, dados:[]}]}  (para Chart.js)

    try {
        const url = `https://investidor10.com.br/fiis/${ticker.toLowerCase()}/`;
        const { data: html } = await client.get(url);
        const $ = cheerio.load(html);
        const dados = {};

        // ─── 1. SOBRE ────────────────────────────────────────────────────────────
        let sobre = '';
        $('script[type="application/ld+json"]').each((_, el) => {
            if (sobre) return false;
            try {
                const obj = JSON.parse($(el).html());
                const items = Array.isArray(obj) ? obj : [obj];
                for (const o of items) {
                    if (o['@type'] === 'Article' && o.articleBody) { sobre = o.articleBody.trim(); break; }
                }
            } catch (_) {}
        });
        if (!sobre) {
            sobre = $('#about-section p').first().text().trim()
                 || $('.about-company p').first().text().trim()
                 || $('[class*="description"] p').first().text().trim()
                 || '';
        }
        dados.sobre = sobre || null;

        // ─── 2. DIVIDEND YIELD POR PERÍODO (1M, 3M, 6M, 12M) ───────────────────
        // Investidor10 usa vários patterns conforme a versão da página.
        // Tentamos do mais específico para o mais genérico.
        dados.dividend_yield = [];

        const tryDyStrategy = () => {
            // Strategy A: .content--info--item
            $('.content--info--item').each((_, el) => {
                const title = $(el).find('[class*="title"]').first().text().trim()
                           || $(el).children('span,div').first().text().trim();
                if (!title.toUpperCase().includes('YIELD') && !title.toUpperCase().includes('DY')) return;
                const vals  = $(el).find('[class*="value"]');
                let pct = '', rs = '';
                vals.each((_, v) => {
                    const t = $(v).text().trim();
                    if (t.includes('%') && !pct) pct = t;
                    else if (t.includes('R$') && !rs) rs = t;
                });
                if (!pct) { // tenta extrair do texto bruto do elemento
                    const raw = $(el).text();
                    const m = raw.match(/([\d,]+\s*%)/);
                    if (m) pct = m[1].trim();
                    const r = raw.match(/(R\$\s*[\d,.]+)/);
                    if (r) rs = r[1].trim();
                }
                if (pct) dados.dividend_yield.push({ periodo: title, percentual: pct, valor: rs });
            });
            if (dados.dividend_yield.length) return;

            // Strategy B: .cell com name contendo YIELD
            $('.cell').each((_, el) => {
                const name = $(el).find('.name,[class*="name"]').first().text().trim();
                if (!name.toUpperCase().includes('YIELD') && !name.toUpperCase().includes('DY')) return;
                const val  = $(el).find('.value,[class*="value"]').first().text().trim();
                const amt  = $(el).find('.amount,[class*="amount"]').first().text().trim();
                const pct  = val.includes('%') ? val : (val + (val ? '%' : ''));
                if (val) dados.dividend_yield.push({ periodo: name, percentual: pct, valor: amt });
            });
            if (dados.dividend_yield.length) return;

            // Strategy C: varredura geral — qualquer elemento com texto "YIELD" próximo de "%"
            $('[class],[id]').each((_, el) => {
                const txt = $(el).text().trim();
                if (!txt.toUpperCase().includes('YIELD')) return;
                if ($(el).children().length > 5) return; // evita containers grandes
                const mPct = txt.match(/([\d,]+\s*%)/);
                if (mPct) {
                    const mPeriodo = txt.toUpperCase().match(/(\d+M)/);
                    dados.dividend_yield.push({
                        periodo: mPeriodo ? mPeriodo[1] : txt.substring(0, 20),
                        percentual: mPct[1].trim(),
                        valor: ''
                    });
                }
            });
        };
        tryDyStrategy();

        // Normaliza labels → "1M", "3M", "6M", "12M"
        dados.dividend_yield = dados.dividend_yield
            .map(d => {
                const m = (d.periodo || '').toUpperCase().match(/(\d+M)/);
                return { ...d, _chave: m ? m[1] : null };
            })
            .filter(d => d._chave)
            .reduce((acc, d) => {
                if (!acc.find(x => x._chave === d._chave)) acc.push(d);
                return acc;
            }, [])
            .sort((a, b) => parseInt(a._chave) - parseInt(b._chave));

        // ─── 3. COMPARAÇÃO COM PARES DO SEGMENTO ────────────────────────────────
        dados.comparacao_fiis = [];
        const compareUrl = $('#table-compare-fiis').attr('data-url')
                        || $('[data-url*="comparador"]').first().attr('data-url');
        if (compareUrl) {
            try {
                const { data: cmp } = await client.get(compareUrl, {
                    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }
                });
                const rows = cmp?.data || cmp?.fiis || (Array.isArray(cmp) ? cmp : []);
                dados.comparacao_fiis = rows.map(fii => {
                    // ticker pode vir com HTML (link) — extrai só o texto
                    const tickerRaw = fii.title || fii.ticker || fii.code || '';
                    const tickerClean = cheerio.load(tickerRaw).text().trim();
                    return {
                        ticker:            tickerClean,
                        dividend_yield:    fii.dividend_yield ?? fii.dy ?? null,
                        p_vp:              fii.p_vp          ?? fii.pvp ?? null,
                        valor_patrimonial: fii.net_worth      ?? fii.valor_patrimonial ?? null,
                        tipo:              fii.type           ?? fii.tipo ?? null,
                        segmento:          fii.segment        ?? fii.segmento ?? null
                    };
                }).filter(f => f.ticker);
            } catch (e) {
                console.error(`[analise_fii] Erro pares ${ticker}:`, e.message);
            }
        }

        // ─── 4. HISTÓRICO DE INDICADORES FUNDAMENTALISTAS (ANUAL – 5/10 anos) ──
        // Esta secção usa a tabela de indicadores anuais (DY, P/VP, Rendimento, Variação)
        // NÃO é o histórico de proventos — são os indicadores agregados por ano.
        dados.historico_indicadores = [];

        const histSels = [
            '#indicators-history tbody tr',
            '#table-indicators tbody tr',
            '#fii-indicators tbody tr',
            'table[id*="indicator"] tbody tr',
            'table[id*="historico"] tbody tr',
        ];

        // Tenta cada seletor; para quando encontrar dados
        for (const sel of histSels) {
            if (dados.historico_indicadores.length) break;
            $(sel).each((_, row) => {
                const cols = $(row).find('td');
                if (cols.length < 2) return;
                const ano = $(cols[0]).text().trim();
                if (!ano.match(/^\d{4}$/)) return; // só linhas com ano de 4 dígitos
                const entry = { ano };
                // Mapeia colunas dinamicamente com base nos th do thead
                const thList = [];
                $(row).closest('table').find('thead th').each((_, th) => {
                    thList.push($(th).text().trim().toUpperCase());
                });
                cols.each((ci, td) => {
                    const val = $(td).text().trim();
                    const header = thList[ci] || `col${ci}`;
                    if (header.includes('DY') || header.includes('YIELD'))           entry.dy       = val;
                    else if (header.includes('P/VP') || header.includes('PVP'))      entry.pvp      = val;
                    else if (header.includes('REND') || header.includes('PROVENT'))  entry.rendimento = val;
                    else if (header.includes('VARI'))                                entry.variacao = val;
                    else if (header.includes('LIQ'))                                 entry.liquidez = val;
                    else if (ci > 0)                                                  entry[`col${ci}`] = val;
                });
                // Garante que tem pelo menos dy ou pvp
                if (entry.dy || entry.pvp) dados.historico_indicadores.push(entry);
            });
        }

        // Fallback: tenta tabela genérica com cabeçalho "Ano" + "DY"
        if (!dados.historico_indicadores.length) {
            $('table').each((_, tbl) => {
                if (dados.historico_indicadores.length) return false;
                const headers = $(tbl).find('thead th').map((_, th) => $(th).text().trim().toUpperCase()).get();
                const anoIdx  = headers.findIndex(h => h === 'ANO' || h.includes('EXERC'));
                const dyIdx   = headers.findIndex(h => h.includes('DY') || h.includes('YIELD'));
                if (anoIdx === -1 || dyIdx === -1) return;
                const pvpIdx  = headers.findIndex(h => h.includes('P/VP') || h.includes('PVP'));
                $(tbl).find('tbody tr').each((_, row) => {
                    const cols = $(row).find('td');
                    const ano  = $(cols[anoIdx])?.text().trim();
                    if (!ano?.match(/^\d{4}$/)) return;
                    dados.historico_indicadores.push({
                        ano,
                        dy:  $(cols[dyIdx])?.text().trim()  || '-',
                        pvp: pvpIdx >= 0 ? ($(cols[pvpIdx])?.text().trim() || '-') : '-'
                    });
                });
            });
        }

        // Ordena do mais recente para o mais antigo
        dados.historico_indicadores.sort((a, b) => parseInt(b.ano) - parseInt(a.ano));

        // ─── 5. COMPARAÇÃO COM ÍNDICES (dados para gráfico Chart.js) ────────────
        // Extrai do script ECharts a série de rentabilidade acumulada vs IFIX, CDI, etc.
        dados.comparacao_indices = null;

        const COR_PALETTE = ['#a78bfa', '#4ade80', '#60a5fa', '#fbbf24', '#f87171', '#34d399'];

        $('script').each((_, el) => {
            if (dados.comparacao_indices) return false;
            const src = $(el).html() || '';
            if (!src.includes('profitabilities')) return;

            try {
                // Extrai array de datas
                const datesMatch = src.match(/['"]dates['"]\s*:\s*\[([^\]]+)\]/);
                const labels = datesMatch
                    ? datesMatch[1].match(/['"]([^'"]+)['"]/g).map(s => s.replace(/['"]/g, ''))
                    : [];

                // Extrai o JSON de rentabilidades (pode estar em JSON.parse(`...`) ou diretamente)
                let chartData = null;

                // Padrão 1: JSON.parse(`...`)
                const m1 = src.match(/profitabilities['"]\s*:\s*JSON\.parse\(`([\s\S]*?)`\s*\)/);
                if (m1) {
                    try { chartData = JSON.parse(m1[1]); } catch (_) {}
                }

                // Padrão 2: array literal
                if (!chartData) {
                    const m2 = src.match(/profitabilities['"]\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
                    if (m2) { try { chartData = JSON.parse(m2[1]); } catch (_) {} }
                }

                if (!chartData || !Array.isArray(chartData)) return;

                const series = chartData.map((assetArr, idx) => {
                    const nome = assetArr[0]?.type || assetArr[0]?.name || `Ativo ${idx + 1}`;
                    const lower = nome.toLowerCase();
                    // Ticker primeiro (mais específico), depois índices conhecidos, fallback = nome bruto
                    const label = lower === ticker.toLowerCase() || lower.includes(ticker.toLowerCase()) ? ticker.toUpperCase()
                                : lower.includes('ifix')  ? 'IFIX'
                                : lower.includes('idiv')  ? 'IDIV'
                                : lower.includes('smll')  ? 'SMLL'
                                : lower.includes('ivvb')  ? 'IVVB11'
                                : lower.includes('ibov')  ? 'IBOV'
                                : lower.includes('ipca')  ? 'IPCA'
                                : lower.includes('cdi')   ? 'CDI'
                                : nome.replace(/ index$/i, '').trim().toUpperCase();
                    return {
                        nome:  label,
                        cor:   COR_PALETTE[idx % COR_PALETTE.length],
                        dados: assetArr.map(item => ({
                            data:          item.date || '',
                            rentabilidade: parseFloat(item.profitability) || 0
                        }))
                    };
                });

                dados.comparacao_indices = { labels, series };
            } catch (e) {
                console.error('[analise_fii] Erro ECharts parse:', e.message);
            }
        });

        return dados;

    } catch (error) {
        console.error('[analise_fii] Erro geral:', error.message);
        return { error: 'Falha ao extrair dados profundos.', detalhe: error.message };
    }
}

// ---------------------------------------------------------
// HANDLER (API MAIN)
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

        // --- MODO 1: IPCA ---
        if (mode === 'ipca') {
            const dados = await scrapeIpca();
            return res.status(200).json({ json: dados });
        }

        // --- MODO 2: FUNDAMENTOS ---
        if (mode === 'fundamentos') {
            if (!payload.ticker) return res.json({ json: {} });
            const dados = await scrapeFundamentos(payload.ticker);
            return res.status(200).json({ json: dados });
        }

        // --- MODO 3: PROVENTOS (LOTE OU INDIVIDUAL) ---
        if (mode === 'proventos_carteira' || mode === 'historico_portfolio') {
            if (!payload.fiiList) return res.json({ json: [] });
            const batches = chunkArray(payload.fiiList, 5);
            let finalResults = [];
            for (const [batchIdx, batch] of batches.entries()) {
                const promises = batch.map(async (item) => {
                    const ticker = typeof item === 'string' ? item : item.ticker;
                    const defaultLimit = mode === 'historico_portfolio' ? 14 : 12;
                    const limit = typeof item === 'string' ? defaultLimit : (item.limit || defaultLimit);
                    const history = await scrapeAsset(ticker);
                    const recents = history.filter(h => h.paymentDate && h.value > 0).slice(0, limit);
                    if (recents.length > 0) return recents.map(r => ({ symbol: ticker.toUpperCase(), ...r }));
                    return null;
                });
                const batchResults = await Promise.all(promises);
                finalResults = finalResults.concat(batchResults);
                if (batches.length > 1 && batchIdx < batches.length - 1) await new Promise(r => setTimeout(r, 200)); 
            }
            return res.status(200).json({ json: finalResults.filter(d => d !== null).flat() });
        }

if (mode === 'historico_12m') {
            if (!payload.ticker) return res.json({ json: [] });

            // Pega todo o histórico cru (sem limite de 18 meses e sem agrupar ainda)
            const history = await scrapeAsset(payload.ticker);

            // Retorna o array completo. O agrupamento será feito no app.js para permitir filtros dinâmicos
            return res.status(200).json({ json: history });
        }

if (mode === 'proximo_provento') {
            if (!payload.ticker) return res.json({ json: null });
            const history = await scrapeAsset(payload.ticker);

            const hoje = new Date();
            hoje.setHours(0,0,0,0);

            let ultimoPago = null;
            let proximo = null;

            // O history já vem ordenado do mais recente para o mais antigo
            for (const p of history) {
                if (!p.paymentDate) continue;
                const parts = p.paymentDate.split('-');
                const dataPag = new Date(parts[0], parts[1] - 1, parts[2]);

                if (dataPag > hoje) {
                    if (!proximo) proximo = p;
                } else {
                    if (!ultimoPago) ultimoPago = p;
                }

                // Se já achou os dois, pode parar o loop
                if (ultimoPago && proximo) break;
            }

            // Fallback: se não achou 'ultimoPago' mas tem dados, pega o primeiro possível
            if (!ultimoPago && history.length > 0 && !proximo) {
                ultimoPago = history[0];
            }

            return res.status(200).json({ json: { ultimoPago, proximo } });
        }

        // --- MODO 4: COTAÇÃO HISTÓRICA (NOVO) ---
// Exemplo dentro do seu router/handler da API:
if (mode === 'cotacao_historica') {
    const range = payload.range || '1D'; // Default muda conforme sua preferência
    const dados = await scrapeCotacaoHistory(payload.ticker, range);
    return res.status(200).json({ json: dados });
}

        // --- MODO: ANÁLISE PROFUNDA DE FII ---
        if (mode === 'analise_profunda_fii') {
            if (!payload || !payload.ticker) return res.status(400).json({ error: "Ticker não informado" });
            const dados = await scrapeAnaliseProfundaFii(payload.ticker);
            return res.status(200).json({ json: dados });
        }

        return res.status(400).json({ error: "Modo desconhecido" });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};