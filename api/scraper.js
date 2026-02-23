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
    decompress: true,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://investidor10.com.br/'
    },
    timeout: 8000
});

// Heurística: tickers que terminam em 11/12 são FIIs, EXCETO Units conhecidas
const KNOWN_UNITS = new Set(['KLBN11', 'TAEE11', 'BPAC11', 'SANB11', 'RNEW11', 'ALUPL11', 'ENGI11', 'SAPR11', 'TIMS11', 'SULA11']);
const guessType = (ticker) => {
    const t = ticker.toUpperCase();
    if (KNOWN_UNITS.has(t)) return 'acao';
    if (t.endsWith('11') || t.endsWith('12')) return 'fii';
    return 'acao';
};

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
        const guess = guessType(ticker);
        let tipoAtivo = guess;
        const urlFii = `https://investidor10.com.br/fiis/${ticker.toLowerCase()}/`;
        const urlAcao = `https://investidor10.com.br/acoes/${ticker.toLowerCase()}/`;

        const fetchHtml = async (url, tipo) => {
            const res = await client.get(url);
            if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
            if (!res.data.includes('cotacao') && !res.data.includes('Cotação')) throw new Error('Página inválida');
            return { html: res.data, tipo };
        };

        // Smart URL: tenta a mais provável primeiro, fallback se falhar (evita 1 request desnecessário)
        const primaryUrl = guess === 'fii' ? urlFii : urlAcao;
        const fallbackUrl = guess === 'fii' ? urlAcao : urlFii;
        const primaryTipo = guess;
        const fallbackTipo = guess === 'fii' ? 'acao' : 'fii';

        try {
            const result = await fetchHtml(primaryUrl, primaryTipo);
            html = result.html;
            tipoAtivo = result.tipo;
        } catch (e) {
            try {
                const result = await fetchHtml(fallbackUrl, fallbackTipo);
                html = result.html;
                tipoAtivo = result.tipo;
            } catch (e2) {
                throw new Error('Ativo não encontrado no Investidor10');
            }
        }

        const $ = cheerio.load(html);

        let dados = {
            dy: 'N/A', pvp: 'N/A', pl: 'N/A', roe: 'N/A', lpa: 'N/A', vp_cota: 'N/A',
            val_mercado: 'N/A', liquidez: 'N/A', variacao_12m: 'N/A', ultimo_rendimento: 'N/A',
            segmento: 'N/A', tipo_fundo: 'N/A', mandato: 'N/A', vacancia: 'N/A',
            patrimonio_liquido: 'N/A', cnpj: 'N/A',
            num_cotistas: 'N/A', tipo_gestao: 'N/A', prazo_duracao: 'N/A',
            taxa_adm: 'N/A', cotas_emitidas: 'N/A', publico_alvo: 'N/A',
            margem_liquida: 'N/A', margem_bruta: 'N/A', margem_ebit: 'N/A',
            divida_liquida_ebitda: 'N/A', divida_liquida_pl: 'N/A', ev_ebitda: 'N/A',
            payout: 'N/A', cagr_receita_5a: 'N/A', cagr_lucros_5a: 'N/A',
            imoveis: [],
            sobre: '',
            comparacao: [],
            logo_url: ''
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
            if (dados.ultimo_rendimento === 'N/A' && titulo.includes('ultimo rendimento')) dados.ultimo_rendimento = valor;

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

        const logoImg = $('.header-company img, #header-container img, .brand-company img').first();
        if (logoImg.length) {
            dados.logo_url = logoImg.attr('src') || '';
            // Se for URL relativa, transforma em absoluta
            if (dados.logo_url.startsWith('/')) {
                dados.logo_url = 'https://investidor10.com.br' + dados.logo_url;
            }
        }

        let sobreTexto = '';
        $('#about-section p, .profile-description p, #description p, .text-description p').each((i, el) => {
            sobreTexto += $(el).text().trim() + ' ';
        });

        if (!sobreTexto.trim()) {
            $('script[type="application/ld+json"]').each((i, el) => {
                try {
                    const html = $(el).html();
                    if (html) {
                        const json = JSON.parse(html);
                        const items = json['@graph'] ? json['@graph'] : [json];
                        items.forEach(item => {
                            if (item.articleBody) sobreTexto = item.articleBody;
                        });
                    }
                } catch (e) { }
            });
        }

        if (!sobreTexto.trim()) {
            sobreTexto = $('meta[name="description"]').attr('content') || '';
        }

        // SEU CÓDIGO COMEÇA AQUI ==========================
        dados.sobre = sobreTexto.replace(/\s+/g, ' ').trim();

        // NOVO: Extração de Gráfico de Rentabilidade (Ativo vs Índices)
        let rentabilidadeChart = null;
        try {
            const chartMatch = html.match(/'lastProfitability':\s*JSON\.parse\(`([^`]+)`\)/);
            if (chartMatch && chartMatch[1]) {
                const lastProf = JSON.parse(chartMatch[1]);

                // Extrai as séries temporais (profitabilities) - pega a mais longa (5A ou 10A) se houver várias
                // Captura legend e profitabilities em PARES para evitar mismatch
                const regexProf = /'profitabilities':\s*JSON\.parse\(`([^`]+)`\)/g;
                const regexLegend = /'legend':\s*JSON\.parse\(`([^`]+)`\)/g;
                let profitabilities = [];
                let legend = [];
                let maxLen = 0;

                // Coletamos TODAS as legends na ordem que aparecem
                const allLegends = [];
                let matchL;
                while ((matchL = regexLegend.exec(html)) !== null) {
                    try { allLegends.push(JSON.parse(matchL[1])); } catch (e) { allLegends.push([]); }
                }

                // Coletamos os profitabilities e usamos o índice para casar com a legend correspondente
                let profIdx = 0;
                let matchProf;
                while ((matchProf = regexProf.exec(html)) !== null) {
                    try {
                        const profArray = JSON.parse(matchProf[1]);
                        if (profArray && profArray.length > 0 && profArray[0].length > maxLen) {
                            maxLen = profArray[0].length;
                            profitabilities = profArray;
                            // Casa com a legend que tem o mesmo número de itens ou a do mesmo índice
                            if (allLegends[profIdx] && allLegends[profIdx].length === profArray.length) {
                                legend = allLegends[profIdx];
                            } else {
                                // Fallback: tenta achar a legend com o mesmo número de séries
                                const matching = allLegends.find(l => l.length === profArray.length);
                                legend = matching || allLegends[profIdx] || [];
                            }
                        }
                    } catch (err) { }
                    profIdx++;
                }

                if (Object.keys(lastProf).length > 0) {
                    rentabilidadeChart = { lastProfitability: lastProf, legend, profitabilities };
                }
            }
        } catch (e) {
            console.error('Erro ao extrair chart de rentabilidade:', e.message);
        }
        dados.rentabilidade_chart = rentabilidadeChart;

        // NOVO: Extração de Indicadores Avançados e Receitas (Apenas para Ações)
        let advancedMetrics = null;
        let revenueGeography = null;
        let revenueSegment = null;
        try {
            // Extrai sectorIndicators
            const sectorMatch = html.match(/const\s+sectorIndicators\s*=\s*(\{.+\});/);
            if (sectorMatch && sectorMatch[1]) {
                advancedMetrics = JSON.parse(sectorMatch[1]);
            }

            // Extrai companyRevenuesChartPie (Receita por Geografia)
            const revGeoMatch = html.match(/let\s+companyRevenuesChartPie\s*=\s*(\{.+\});/);
            if (revGeoMatch && revGeoMatch[1]) {
                revenueGeography = JSON.parse(revGeoMatch[1]);
            }

            // Extrai companyBussinesRevenuesChartPie (Receita por Segmento)
            const revSegMatch = html.match(/let\s+companyBussinesRevenuesChartPie\s*=\s*(\{.+\});/);
            if (revSegMatch && revSegMatch[1]) {
                revenueSegment = JSON.parse(revSegMatch[1]);
            }
        } catch (e) {
            console.error('Erro ao extrair métricas avançadas:', e.message);
        }

        if (advancedMetrics) dados.advanced_metrics = advancedMetrics;
        if (revenueGeography) dados.revenue_geography = revenueGeography;
        if (revenueSegment) dados.revenue_segment = revenueSegment;

        // ─── OTIMIZADO: Lança chart APIs + comparação API em PARALELO (não bloqueia) ───
        // Extrai companyId e tickerId do HTML (via regex, sem cheerio)
        let companyId = null;
        let tickerId = null;
        try {
            const companyMatch = html.match(/\/api\/balancos\/receitaliquida\/chart\/(\d+)\//);
            if (companyMatch) companyId = companyMatch[1];
            const tickerMatch = html.match(/tickerId\s*=\s*'(\d+)'/);
            if (tickerMatch) tickerId = tickerMatch[1];
        } catch (e) { }

        // Lança chart promises AGORA — resolve depois junto com a comparação
        let chartPromise = Promise.resolve(null);
        if (companyId && tipoAtivo === 'acao') {
            const baseUrl = 'https://investidor10.com.br';
            const chartRequests = [
                client.get(`${baseUrl}/api/balancos/receitaliquida/chart/${companyId}/3650/false/`)
                    .then(r => ({ tipo: 'receitas_lucros', data: r.data })).catch(() => null),
                client.get(`${baseUrl}/api/cotacao-lucro/${ticker.toLowerCase()}/adjusted/`)
                    .then(r => ({ tipo: 'lucro_cotacao', data: r.data })).catch(() => null),
                client.get(`${baseUrl}/api/balancos/ativospassivos/chart/${companyId}/3650/`)
                    .then(r => ({ tipo: 'evolucao_patrimonio', data: r.data })).catch(() => null),
            ];
            if (tickerId) {
                chartRequests.push(
                    client.get(`${baseUrl}/api/acoes/payout-chart/${companyId}/${tickerId}/${ticker.toUpperCase()}/3650`)
                        .then(r => ({ tipo: 'payout', data: r.data })).catch(() => null)
                );
            }
            chartPromise = Promise.all(chartRequests);
        }

        // Lança comparação API em paralelo (não espera)
        const apiUrl = $('#table-compare-fiis').attr('data-url') || $('#table-compare-segments').attr('data-url');
        let comparacaoApiPromise = Promise.resolve(null);
        if (apiUrl) {
            const fullUrl = apiUrl.startsWith('http') ? apiUrl : `https://investidor10.com.br${apiUrl}`;
            comparacaoApiPromise = client.get(fullUrl).catch(() => null);
        }

        // ─── Aguarda comparação API + charts em paralelo enquanto parseia HTML abaixo ───
        dados.comparacao = [];
        const tickersVistos = new Set();

        // Resolver comparação API (já lançada acima)
        try {
            const resApi = await comparacaoApiPromise;
            if (resApi && resApi.data) {
                let arrayComparacao = resApi.data.data || resApi.data || [];

                if (Array.isArray(arrayComparacao)) {
                    arrayComparacao.forEach(item => {
                        const tickerAPI = item.title ? item.title.trim() : (item.ticker ? item.ticker.trim() : '');
                        if (tickerAPI && !tickersVistos.has(tickerAPI)) {
                            let patrim = '-';
                            if (item.net_worth !== null && item.net_worth !== undefined) {
                                let v = parseFloat(item.net_worth);
                                if (!isNaN(v)) {
                                    if (v >= 1e9) patrim = `R$ ${(v / 1e9).toFixed(2).replace('.', ',')} B`;
                                    else if (v >= 1e6) patrim = `R$ ${(v / 1e6).toFixed(2).replace('.', ',')} M`;
                                    else patrim = `R$ ${v.toLocaleString('pt-BR')}`;
                                }
                            }
                            let dy = '-';
                            if (item.dividend_yield !== null && item.dividend_yield !== undefined) {
                                dy = String(item.dividend_yield).replace('.', ',');
                                if (!dy.includes('%')) dy += '%';
                            }
                            let pvp = '-';
                            if (item.p_vp !== null && item.p_vp !== undefined) pvp = String(item.p_vp).replace('.', ',');

                            dados.comparacao.push({
                                ticker: tickerAPI, nome: item.company_name || item.name || '',
                                dy: dy, pvp: pvp, patrimonio: patrim, tipo: item.type || '-', segmento: item.segment || '-'
                            });
                            tickersVistos.add(tickerAPI);
                        }
                    });
                }
            }
        } catch (err) { /* Falhou API, segue pro HTML abaixo */ }

        // TENTATIVA 2: SEU CÓDIGO HTML (Fallback se a API falhar)
        if (dados.comparacao.length === 0) {
            // FII tables
            $('#table-compare-fiis, #table-compare-segments').each((_, table) => {
                let idxDy = -1, idxPvp = -1, idxPat = -1, idxSeg = -1, idxTipo = -1;

                $(table).find('thead th').each((idx, th) => {
                    const txt = $(th).text().toLowerCase();
                    if (txt.includes('dy') || txt.includes('dividend')) idxDy = idx;
                    if (txt.includes('p/vp')) idxPvp = idx;
                    if (txt.includes('patrim')) idxPat = idx;
                    if (txt.includes('segmento')) idxSeg = idx;
                    if (txt.includes('tipo')) idxTipo = idx;
                });

                $(table).find('tbody tr').each((i, el) => {
                    const cols = $(el).find('td');
                    if (cols.length >= 3) {
                        const ticker = $(cols[0]).text().replace(/\s+/g, ' ').trim();
                        if (ticker && !tickersVistos.has(ticker)) {
                            let nome = $(cols[0]).find('a').attr('title') || '';

                            const dy = idxDy !== -1 && cols.length > idxDy ? $(cols[idxDy]).text().trim() : '-';
                            const pvp = idxPvp !== -1 && cols.length > idxPvp ? $(cols[idxPvp]).text().trim() : '-';
                            const patrimonio = idxPat !== -1 && cols.length > idxPat ? $(cols[idxPat]).text().trim() : '-';
                            const segmento = idxSeg !== -1 && cols.length > idxSeg ? $(cols[idxSeg]).text().trim() : '-';
                            const tipo = idxTipo !== -1 && cols.length > idxTipo ? $(cols[idxTipo]).text().trim() : '-';

                            dados.comparacao.push({ ticker, nome, dy, pvp, patrimonio, segmento, tipo });
                            tickersVistos.add(ticker);
                        }
                    }
                });
            });

            // Tabela de COMPARAÇÃO DE AÇÕES (#table-compare-tickers)
            // Colunas: Ativo | P/L | P/VP | ROE | DY | Val. Mercado | Margem Líquida
            $('#table-compare-tickers').find('tbody tr').each((i, el) => {
                const cols = $(el).find('td');
                if (cols.length >= 7) {
                    const cleanTxt = (td) => $(td).clone().children('i').remove().end().text().replace(/\s+/g, ' ').trim();
                    const ticker = $(cols[0]).text().replace(/\s+/g, ' ').trim();
                    if (ticker && !tickersVistos.has(ticker)) {
                        const nome = $(cols[0]).find('a').attr('title') || '';
                        dados.comparacao.push({
                            ticker, nome,
                            pl: cleanTxt(cols[1]),
                            pvp: cleanTxt(cols[2]),
                            roe: cleanTxt(cols[3]),
                            dy: cleanTxt(cols[4]),
                            val_mercado: cleanTxt(cols[5]),
                            margem_liquida: cleanTxt(cols[6]),
                            patrimonio: '-', segmento: '-', tipo: '-'
                        });
                        tickersVistos.add(ticker);
                    }
                }
            });

            // Método B: Cards Relacionados (Fallback)
            $('.card-related-fii').each((i, el) => {
                const ticker = $(el).find('h2').text().trim();
                if (ticker && !tickersVistos.has(ticker)) {
                    const nome = $(el).find('h3, span.name').first().text().trim();
                    let dy = '-', pvp = '-', patrimonio = '-', segmento = '-', tipo = '-';

                    $(el).find('.card-footer p, .card-footer div').each((j, p) => {
                        const text = $(p).text();
                        if (text.includes('DY:')) dy = text.replace('DY:', '').trim();
                        if (text.includes('P/VP:')) pvp = text.replace('P/VP:', '').trim();
                        if (text.includes('Patrimônio:')) patrimonio = text.replace('Patrimônio:', '').trim();
                        if (text.includes('Segmento:')) segmento = text.replace('Segmento:', '').trim();
                        if (text.includes('Tipo:')) tipo = text.replace('Tipo:', '').trim();
                    });

                    dados.comparacao.push({ ticker, nome, dy, pvp, patrimonio, segmento, tipo });
                    tickersVistos.add(ticker);
                }
            });
        }

        // ─── Resolver chart promises (lançadas em paralelo acima) ───
        try {
            const chartResults = await chartPromise;
            if (chartResults) {
                const charts = {};
                chartResults.filter(r => r && r.data).forEach(r => {
                    charts[r.tipo] = r.data;
                });
                if (Object.keys(charts).length > 0) {
                    dados.charts_financeiros = charts;
                }
            }
        } catch (e) {
            console.error('Erro ao buscar gráficos financeiros:', e.message);
        }

        dados.tipo_ativo = tipoAtivo;
        return dados;
    } catch (error) {
        console.error("Erro scraper:", error.message);
        return { dy: '-', pvp: '-' };
    }
}

// ---------------------------------------------------------
// PARTE 1.5: RANKINGS (Maiores Altas + Baixas) -> INVESTIDOR10
// ---------------------------------------------------------
async function scrapeRankings() {
    const resultados = { altas: [], baixas: [] };

    const extractItems = ($, container, limit = 6) => {
        const items = [];
        if (!container) return items;
        container.find('a[href*="/acoes/"]').each((i, el) => {
            if (i >= limit) return false;
            const fullText = $(el).text().replace(/\s+/g, ' ').trim();
            const tickerMatch = fullText.match(/([A-Z]{4}\d{1,2})/);
            const varMatch = fullText.match(/([+-]?\d+[,.]\d+\s*%)/);
            const precoMatch = fullText.match(/R\$\s*([\d.,]+)/);

            let logo_url = '';
            const imgEl = $(el).find('img').first();
            if (imgEl.length) {
                logo_url = imgEl.attr('src') || '';
                if (logo_url.startsWith('/')) logo_url = 'https://investidor10.com.br' + logo_url;
            }

            if (tickerMatch) {
                items.push({
                    ticker: tickerMatch[1],
                    variacao: varMatch ? varMatch[1].replace(/\s/g, '') : '',
                    preco: precoMatch ? `R$ ${precoMatch[1]}` : '',
                    logo_url: logo_url
                });
            }
        });
        return items;
    };

    const findSection = ($, titulo) => {
        let container = null;
        $('h2').each((_, el) => {
            if ($(el).text().trim() === titulo) {
                container = $(el).parent();
                if (container.find('a[href*="/acoes/"]').length === 0) {
                    container = container.parent();
                }
                return false;
            }
        });
        return container;
    };

    try {
        const res = await client.get('https://investidor10.com.br/');
        if (res.status !== 200) return resultados;
        const $ = cheerio.load(res.data);

        resultados.altas = extractItems($, findSection($, 'Maiores Altas'), 6);
        resultados.baixas = extractItems($, findSection($, 'Maiores Baixas'), 6);

    } catch (e) {
        console.error('Erro rankings:', e.message);
    }

    return resultados;
}


// ---------------------------------------------------------
// PARTE 2: PROVENTOS -> STATUSINVEST
// ---------------------------------------------------------

async function scrapeAsset(ticker) {
    try {
        const t = ticker.toUpperCase();
        let type = 'acao';
        if (/\d{2}B?$/.test(t) && t.endsWith('11') || t.endsWith('11B')) type = 'fii';

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
                dataCom: parseDateJSON(d.ed),
                paymentDate: parseDateJSON(d.pd),
                value: d.v,
                type: labelTipo,
                rawType: d.et
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

        let $table = $('table').filter((i, el) => {
            const firstRow = $(el).find('thead tr th').first().text().toLowerCase();
            return firstRow.includes('acumulado') || firstRow.includes('varia');
        }).first();

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

function getYahooParams(range) {
    switch (range) {
        case '1D': return { range: '1d', interval: '5m' };
        case '5D': return { range: '5d', interval: '15m' };
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
        const quote = result.indicators.quote[0];
        const prices = quote.close;
        const opens = quote.open;
        const highs = quote.high;
        const lows = quote.low;

        const points = timestamps.map((t, i) => {
            if (prices[i] === null || prices[i] === undefined) return null;
            return {
                date: new Date(t * 1000).toISOString(),
                timestamp: t * 1000,
                price: prices[i],
                open: opens[i] ?? prices[i],
                high: highs[i] ?? prices[i],
                low: lows[i] ?? prices[i]
            };
        }).filter(p => p !== null);

        return points;

    } catch (e) {
        console.error(`[DEBUG] Erro Yahoo Finance para ${ticker}:`, e.message);
        return null;
    }
}

async function scrapeCotacaoHistory(ticker, range = '1A') {
    const cleanTicker = ticker.toLowerCase().trim();
    const data = await fetchYahooFinance(cleanTicker, range);

    if (!data || data.length === 0) {
        return { error: "Dados não encontrados", points: [] };
    }

    return {
        ticker: cleanTicker.toUpperCase(),
        range: range,
        points: data
    };
}

// ---------------------------------------------------------
// HANDLER (API MAIN)
// ---------------------------------------------------------

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Cache diferenciado por mode (otimização: fundamentos mudam pouco, cotação muda sempre)
    if (req.method === 'GET' || req.method === 'POST') {
        const mode = req.body?.mode;
        if (mode === 'fundamentos') {
            // Fundamentos mudam pouco — cache de 4h, stale até 24h
            res.setHeader('Cache-Control', 's-maxage=14400, stale-while-revalidate=86400');
        } else if (mode === 'cotacao_historica') {
            // Cotação muda durante o pregão — cache de 5min, stale até 1h
            res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
        } else if (mode === 'proximo_provento' || mode === 'historico_12m') {
            // Proventos mudam ocasionalmente — cache de 2h
            res.setHeader('Cache-Control', 's-maxage=7200, stale-while-revalidate=43200');
        } else if (mode === 'rankings') {
            // Rankings mudam durante o pregão — cache de 15min
            res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
        } else {
            // Default: 1h
            res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
        }
    }

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'POST') { return res.status(405).json({ error: "Use POST" }); }

    try {
        if (!req.body || !req.body.mode) throw new Error("Payload inválido");
        const { mode, payload } = req.body;

        if (mode === 'rankings') {
            const dados = await scrapeRankings();
            return res.status(200).json({ json: dados });
        }

        if (mode === 'ipca') {
            const dados = await scrapeIpca();
            return res.status(200).json({ json: dados });
        }

        if (mode === 'fundamentos') {
            if (!payload.ticker) return res.json({ json: {} });
            const dados = await scrapeFundamentos(payload.ticker);
            return res.status(200).json({ json: dados });
        }

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
            const history = await scrapeAsset(payload.ticker);
            return res.status(200).json({ json: history });
        }

        if (mode === 'proximo_provento') {
            if (!payload.ticker) return res.json({ json: null });
            const history = await scrapeAsset(payload.ticker);

            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);

            let ultimoPago = null;
            let proximo = null;

            for (const p of history) {
                if (!p.paymentDate) continue;
                const parts = p.paymentDate.split('-');
                const dataPag = new Date(parts[0], parts[1] - 1, parts[2]);

                if (dataPag > hoje) {
                    if (!proximo) proximo = p;
                } else {
                    if (!ultimoPago) ultimoPago = p;
                }

                if (ultimoPago && proximo) break;
            }

            if (!ultimoPago && history.length > 0 && !proximo) {
                ultimoPago = history[0];
            }

            return res.status(200).json({ json: { ultimoPago, proximo } });
        }

        if (mode === 'cotacao_historica') {
            const range = payload.range || '1D';
            const dados = await scrapeCotacaoHistory(payload.ticker, range);
            return res.status(200).json({ json: dados });
        }

        return res.status(400).json({ error: "Modo desconhecido" });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};