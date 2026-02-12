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
const REGEX_CLEAN_NUMBER = /[^0-9,-]/g;

function parseValue(str) {
    if (!str) return 0;
    let clean = str.replace(REGEX_CLEAN_NUMBER, '').replace(',', '.');
    if (clean.endsWith('.')) clean = clean.slice(0, -1); 
    const val = parseFloat(clean);
    return isNaN(val) ? 0 : val;
}

function parseExtendedValue(str) {
    if (!str) return 0;
    const cleanStr = str.replace(/\./g, '').replace(',', '.'); 
    let val = parseFloat(cleanStr);
    if (isNaN(val)) return 0;

    const lower = str.toLowerCase();
    if (lower.includes('bi')) val *= 1e9;
    else if (lower.includes('mi')) val *= 1e6;
    else if (lower.includes('mil')) val *= 1e3;
    
    return val;
}

function normalize(str) {
    return str.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "");
}

function cleanDoubledString(str) {
    if (!str) return 'N/A';
    const half = Math.floor(str.length / 2);
    const firstHalf = str.substring(0, half);
    const secondHalf = str.substring(half);
    if (firstHalf === secondHalf) return firstHalf;
    return str;
}

function formatCurrency(val) {
    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ---------------------------------------------------------
// SCRAPER DO STATUS INVEST (HISTÓRICO)
// ---------------------------------------------------------
async function scrapeAsset(ticker) {
    try {
        const t = ticker.toUpperCase();
        let type = 'acao';
        if (t.endsWith('11') || t.endsWith('11B')) type = 'fii'; 

        const url = `https://statusinvest.com.br/${type == 'fii' ? 'fundos-imobiliarios' : 'acoes'}/${t.toLowerCase()}`;
        
        const res = await client.get(url, {
            headers: {
                'Referer': 'https://statusinvest.com.br/',
                'Host': 'statusinvest.com.br'
            }
        });
        
        const html = res.data;
        const jsonRegex = /input\s+id="results"\s+type="hidden"\s+value="([^"]+)"/;
        const match = html.match(jsonRegex);

        if (match && match[1]) {
            const decoded = decodeURIComponent(match[1]);
            const json = JSON.parse(decoded);
            
            return json.map(item => ({
                assetId: item.ad,
                paymentDate: item.pd, // Formato YYYY-MM-DD
                value: item.v,
                type: item.et,        // Importante para diferenciar JCP/Div
                dateCom: item.ed
            }));
        }
        return [];
    } catch (e) {
        console.error(`Erro scrapeAsset [${ticker}]:`, e.message);
        return [];
    }
}

// ---------------------------------------------------------
// SCRAPER DO INVESTIDOR10 (FUNDAMENTOS)
// ---------------------------------------------------------
async function scrapeFundamentos(ticker) {
    try {
        let html;
        try {
            const res = await client.get(`https://investidor10.com.br/fiis/${ticker.toLowerCase()}/`);
            html = res.data;
        } catch (e) {
            const res = await client.get(`https://investidor10.com.br/acoes/${ticker.toLowerCase()}/`);
            html = res.data;
        }

        const $ = cheerio.load(html);

        let dados = {
            dy: 'N/A', pvp: 'N/A', pl: 'N/A', roe: 'N/A', lpa: 'N/A', vp_cota: 'N/A',
            val_mercado: 'N/A', liquidez: 'N/A', variacao_12m: 'N/A',
            segmento: 'N/A', tipo_fundo: 'N/A', mandato: 'N/A', vacancia: 'N/A',
            patrimonio_liquido: 'N/A', ultimo_rendimento: 'N/A', cnpj: 'N/A',
            num_cotistas: 'N/A', tipo_gestao: 'N/A', prazo_duracao: 'N/A',
            taxa_adm: 'N/A', cotas_emitidas: 'N/A', publico_alvo: 'N/A',
            margem_liquida: 'N/A', margem_bruta: 'N/A', margem_ebit: 'N/A',
            divida_liquida_ebitda: 'N/A', divida_liquida_pl: 'N/A', ev_ebitda: 'N/A',
            payout: 'N/A', cagr_receita_5a: 'N/A', cagr_lucros_5a: 'N/A'
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

        return dados;
    } catch (error) {
        console.error("Erro scraper:", error.message);
        return { dy: '-', pvp: '-' };
    }
}

// ---------------------------------------------------------
// SERVERLESS HANDLER
// ---------------------------------------------------------
module.exports = async (req, res) => {
    // Configura CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const payload = req.method === 'POST' ? req.body : req.query;
    const mode = payload.mode;

    try {
        // --- MODO: IPCA ---
        if (mode === 'ipca') {
            const url = 'https://investidor10.com.br/indices/ipca/';
            const response = await client.get(url);
            // Mock simples (implementação real depende da necessidade)
            return res.status(200).json({ json: [] }); 
        }

        // --- MODO: HISTÓRICO 12M (StatusInvest) ---
        // Mantém o objeto completo para permitir os gráficos coloridos no frontend
        if (mode === 'historico_12m') {
            if (!payload.ticker) return res.json({ json: [] });
            
            const history = await scrapeAsset(payload.ticker);
            
            const formatted = history.slice(0, 24).map(h => {
                return {
                    paymentDate: h.paymentDate,
                    value: h.value,
                    type: h.type || 'Outros',
                    mes: h.paymentDate ? h.paymentDate.substring(0, 7) : '' 
                };
            });

            return res.status(200).json({ json: formatted });
        }

        // --- MODO: PRÓXIMO PROVENTO (StatusInvest) ---
        // CORREÇÃO: Filtra para garantir que retorne o ÚLTIMO PAGO (<= HOJE)
        if (mode === 'proximo_provento') {
            if (!payload.ticker) return res.json({ json: null });

            const history = await scrapeAsset(payload.ticker);
            
            // 1. Ordena decrescente (mais novo pro mais velho)
            history.sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));

            if (history.length === 0) return res.json({ json: null });

            // 2. Define data de hoje zerada
            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);

            // 3. Procura o primeiro pagamento que já aconteceu (<= hoje)
            const ultimoPagoReal = history.find(h => {
                if (!h.paymentDate) return false;
                const parts = h.paymentDate.split('-');
                const dataPag = new Date(parts[0], parts[1] - 1, parts[2]);
                return dataPag <= hoje;
            });

            // Retorna o pago ou o mais recente como fallback
            const resultadoFinal = ultimoPagoReal || history[0];

            return res.status(200).json(resultadoFinal);
        }

        // --- MODO: FUNDAMENTOS (Investidor10) ---
        if (mode === 'fundamentos') {
            if (!payload.ticker) return res.json({ json: {} });
            const dados = await scrapeFundamentos(payload.ticker);
            return res.status(200).json({ json: dados });
        }

        return res.status(400).json({ error: 'Modo inválido' });

    } catch (error) {
        console.error('Erro geral handler:', error);
        return res.status(500).json({ error: 'Erro interno' });
    }
};
