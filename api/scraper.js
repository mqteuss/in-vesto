const axios = require('axios');
const cheerio = require('cheerio');

// Configuração do cliente HTTP
const client = axios.create({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    },
    timeout: 9000
});

function parseDate(dateStr) {
    if (!dateStr || dateStr === '-') return null;
    const parts = dateStr.trim().split('/');
    if (parts.length !== 3) return null;
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function parseValue(valueStr) {
    if (!valueStr) return 0;
    try {
        return parseFloat(valueStr.replace('R$', '').replace(/\./g, '').replace(',', '.').trim()) || 0;
    } catch (e) { return 0; }
}

async function scrapeAsset(ticker) {
    try {
        let url = `https://investidor10.com.br/fiis/${ticker.toLowerCase()}/`;
        let response;
        
        try {
            response = await client.get(url);
        } catch (e) {
            if (e.response && e.response.status === 404) {
                url = `https://investidor10.com.br/acoes/${ticker.toLowerCase()}/`;
                response = await client.get(url);
            } else {
                throw e; 
            }
        }

        const html = response.data;
        const $ = cheerio.load(html);
        const dividendos = [];

        // Seletor ajustado para capturar a tabela corretamente
        $('#table-dividends-history tbody tr').each((i, el) => {
            const cols = $(el).find('td');
            if (cols.length >= 4) {
                const tipo = $(cols[0]).text().trim();
                const dataCom = $(cols[1]).text().trim();
                const dataPag = $(cols[2]).text().trim();
                const valor = $(cols[3]).text().trim();

                dividendos.push({
                    tipo,
                    dataCom: parseDate(dataCom),
                    paymentDate: parseDate(dataPag),
                    value: parseValue(valor)
                });
            }
        });
        return dividendos;
    } catch (error) {
        console.warn(`[Scraper] Falha ao ler ${ticker}: ${error.message}`);
        return []; 
    }
}

// Exportação no formato CommonJS (compatível com seu package.json)
module.exports = async function handler(req, res) {
    // Cabeçalhos CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Use POST" });
    }

    try {
        if (!req.body || !req.body.mode) {
             throw new Error("Payload inválido: 'mode' é obrigatório.");
        }

        const { mode, payload } = req.body;

        if (mode === 'proventos_carteira') {
            const { fiiList } = payload || {};
            if (!fiiList || !Array.isArray(fiiList)) return res.json({ json: [] });

            const promises = fiiList.map(async (ticker) => {
                const history = await scrapeAsset(ticker);
                // Encontra o mais recente com data de pagamento válida
                const latest = history.find(h => h.paymentDate && h.value > 0);
                if (latest) {
                    return {
                        symbol: ticker.toUpperCase(),
                        value: latest.value,
                        paymentDate: latest.paymentDate,
                        dataCom: latest.dataCom
                    };
                }
                return null;
            });

            const data = await Promise.all(promises);
            return res.status(200).json({ json: data.filter(d => d !== null) });
        }

        if (mode === 'historico_12m') {
            const { ticker } = payload || {};
            if (!ticker) return res.json({ json: [] });

            const history = await scrapeAsset(ticker);
            const formatted = history.slice(0, 18).map(h => {
                if (!h.paymentDate) return null;
                const [ano, mes] = h.paymentDate.split('-');
                return { mes: `${mes}/${ano.substring(2)}`, valor: h.value };
            }).filter(h => h !== null);

            return res.status(200).json({ json: formatted });
        }

        if (mode === 'historico_portfolio') {
            const { fiiList } = payload || {};
            if (!fiiList) return res.json({ json: [] });

            const aggregator = {};
            const promises = fiiList.map(async (ticker) => {
                const history = await scrapeAsset(ticker);
                history.slice(0, 12).forEach(h => {
                    if (!h.paymentDate) return;
                    const [ano, mes] = h.paymentDate.split('-');
                    const mesAno = `${mes}/${ano.substring(2)}`;
                    if (!aggregator[mesAno]) aggregator[mesAno] = { mes: mesAno };
                    aggregator[mesAno][ticker.toUpperCase()] = h.value;
                });
            });

            await Promise.all(promises);
            
            const result = Object.values(aggregator).sort((a, b) => {
                const [mesA, anoA] = a.mes.split('/');
                const [mesB, anoB] = b.mes.split('/');
                return new Date(`20${anoA}-${mesA}-01`) - new Date(`20${anoB}-${mesB}-01`);
            });

            return res.status(200).json({ json: result });
        }

        return res.status(400).json({ error: "Modo desconhecido" });

    } catch (error) {
        console.error("CRITICAL SCRAPER ERROR:", error);
        return res.status(500).json({ 
            error: `Erro no servidor: ${error.message}`,
            stack: error.stack 
        });
    }
};
