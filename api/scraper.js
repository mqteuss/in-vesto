const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

/* =========================
   AXIOS + KEEP ALIVE
========================= */
const httpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 100,
    maxFreeSockets: 10,
    timeout: 10000
});

const client = axios.create({
    httpsAgent,
    timeout: 9000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'text/html,application/xhtml+xml'
    }
});

/* =========================
   HELPERS
========================= */
function parseDate(str) {
    if (!str) return null;
    const p = str.split('/');
    if (p.length !== 3) return null;
    return `${p[2]}-${p[1]}-${p[0]}`;
}

function formatCurrency(v) {
    return Number(v).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    });
}

function chunkArray(arr, size) {
    const res = [];
    for (let i = 0; i < arr.length; i += size) {
        res.push(arr.slice(i, i + size));
    }
    return res;
}

/* =========================
   STATUS INVEST CORE
========================= */
async function fetchStatusInvestData(ticker) {
    const t = ticker.toLowerCase();

    try {
        const res = await client.get(`https://statusinvest.com.br/fundos-imobiliarios/${t}`);
        return extractNextData(res.data);
    } catch (e) {
        if (e.response && e.response.status === 404) {
            const res = await client.get(`https://statusinvest.com.br/acoes/${t}`);
            return extractNextData(res.data);
        }
        throw e;
    }
}

function extractNextData(html) {
    const $ = cheerio.load(html);
    const json = $('#__NEXT_DATA__').html();
    if (!json) throw new Error('NEXT_DATA não encontrado');
    return JSON.parse(json);
}

/* =========================
   FUNDAMENTOS
========================= */
async function scrapeFundamentos(ticker) {
    try {
        const data = await fetchStatusInvestData(ticker);
        const p = data.props.pageProps;

        const info = p.fii || p.stock;
        if (!info) throw new Error('Dados ausentes');

        return {
            dy: info.dividendsYield ? `${info.dividendsYield}%` : 'N/A',
            pvp: info.pvp ?? 'N/A',
            segmento: info.segment ?? 'N/A',
            tipo_fundo: info.fundType ?? 'N/A',
            mandato: info.management ?? 'N/A',
            vacancia: info.vacancy ?? 'N/A',
            vp_cota: info.vp ?? 'N/A',
            liquidez: info.liquidity ?? 'N/A',
            val_mercado: info.marketValue ? formatCurrency(info.marketValue) : 'N/A',
            patrimonio_liquido: info.netEquity ? formatCurrency(info.netEquity) : 'N/A',
            variacao_12m: info.change12Months ?? 'N/A',
            ultimo_rendimento: info.lastDividend ?? 'N/A',
            cnpj: info.cnpj ?? 'N/A',
            num_cotistas: info.shareholders ?? 'N/A',
            tipo_gestao: info.managementType ?? 'N/A',
            prazo_duracao: info.duration ?? 'N/A',
            taxa_adm: info.managementFee ?? 'N/A',
            cotas_emitidas: info.sharesOutstanding ?? 'N/A'
        };
    } catch (e) {
        return { dy: '-', pvp: '-', segmento: '-' };
    }
}

/* =========================
   DIVIDENDOS
========================= */
async function scrapeAsset(ticker) {
    try {
        const data = await fetchStatusInvestData(ticker);
        const dividends = data.props.pageProps.dividends || [];

        return dividends.map(d => ({
            dataCom: d.comDate ? parseDate(d.comDate) : null,
            paymentDate: d.paymentDate ? parseDate(d.paymentDate) : null,
            value: d.value ?? 0
        }));
    } catch {
        return [];
    }
}

/* =========================
   API HANDLER
========================= */
module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Credentials', true);

    if (req.method === 'GET' || req.method === 'POST') {
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    }

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

    try {
        const { mode, payload } = req.body;
        if (!mode) throw new Error('Modo inválido');

        /* FUNDAMENTOS */
        if (mode === 'fundamentos') {
            const dados = await scrapeFundamentos(payload.ticker);
            return res.json({ json: dados });
        }

        /* PROVENTOS DA CARTEIRA */
        if (mode === 'proventos_carteira') {
            const batches = chunkArray(payload.fiiList, 3);
            let all = [];

            for (const batch of batches) {
                const r = await Promise.all(batch.map(async item => {
                    const ticker = typeof item === 'string' ? item : item.ticker;
                    const limit = typeof item === 'string' ? 24 : (item.limit || 24);

                    const h = await scrapeAsset(ticker);
                    return h
                        .filter(x => x.paymentDate && x.value > 0)
                        .slice(0, limit)
                        .map(x => ({ symbol: ticker.toUpperCase(), ...x }));
                }));

                all = all.concat(r.flat());
                if (batches.length > 1) await new Promise(r => setTimeout(r, 500));
            }

            return res.json({ json: all });
        }

        /* HISTÓRICO 12M */
        if (mode === 'historico_12m') {
            const h = await scrapeAsset(payload.ticker);
            const out = h.slice(0, 18).map(x => {
                if (!x.paymentDate) return null;
                const [y, m] = x.paymentDate.split('-');
                return { mes: `${m}/${y.slice(2)}`, valor: x.value };
            }).filter(Boolean);

            return res.json({ json: out });
        }

        /* HISTÓRICO PORTFOLIO */
        if (mode === 'historico_portfolio') {
            const batches = chunkArray(payload.fiiList, 3);
            let all = [];

            for (const batch of batches) {
                await Promise.all(batch.map(async ticker => {
                    const h = await scrapeAsset(ticker);
                    h.slice(0, 24).forEach(x => {
                        if (x.value > 0) all.push({ symbol: ticker.toUpperCase(), ...x });
                    });
                }));
                if (batches.length > 1) await new Promise(r => setTimeout(r, 500));
            }

            return res.json({ json: all });
        }

        /* PRÓXIMO PROVENTO */
        if (mode === 'proximo_provento') {
            const h = await scrapeAsset(payload.ticker);
            return res.json({ json: h.length ? h[0] : null });
        }

        return res.status(400).json({ error: 'Modo desconhecido' });

    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
};