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

// --- FUNÇÃO DE SCRAPING DE FUNDAMENTOS (VERSÃO CORRIGIDA) ---
async function scrapeFundamentos(ticker) {
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

        // Inicializa variáveis com N/A
        let dy = 'N/A';
        let pvp = 'N/A';
        let segmento = 'N/A';
        let vacancia = 'N/A';
        let val_patrimonial = 'N/A';
        let liquidez = 'N/A';

        // 1. TENTATIVA DIRETA (Melhor para DY e P/VP)
        const dyEl = $('._card.dy ._card-body span').first();
        if (dyEl.length) dy = dyEl.text().trim();

        const pvpEl = $('._card.vp ._card-body span').first();
        if (pvpEl.length) pvp = pvpEl.text().trim();

        const liqEl = $('._card.liquidity ._card-body span').first();
        if (liqEl.length) liquidez = liqEl.text().trim();
        
        const valPatEl = $('._card.val_patrimonial ._card-body span').first();
        if (valPatEl.length) val_patrimonial = valPatEl.text().trim();

        // 2. VARREDURA DE CARDS (Cards genéricos)
        $('._card').each((i, el) => {
            const titulo = $(el).find('._card-header span').text().trim().toLowerCase();
            const valor = $(el).find('._card-body span').text().trim();

            if (valor) {
                if (dy === 'N/A' && titulo.includes('dividend yield')) dy = valor;
                if (pvp === 'N/A' && titulo.includes('p/vp')) pvp = valor;
                if (liquidez === 'N/A' && titulo.includes('liquidez')) liquidez = valor;
                
                // Segmento e Vacância as vezes aparecem em cards
                if (segmento === 'N/A' && titulo.includes('segmento')) segmento = valor;
                if (vacancia === 'N/A' && titulo.includes('vacância')) vacancia = valor;
                if (val_patrimonial === 'N/A' && titulo.includes('patrimonial') && titulo.includes('cota')) val_patrimonial = valor;
            }
        });

        // 3. VARREDURA DE TABELAS (.cell) - OBRIGATÓRIA PARA SEGMENTO/VACÂNCIA
        // Removemos o "if" que impedia isso de rodar se o DY já tivesse sido achado.
        $('.cell').each((i, el) => {
             const titulo = $(el).find('.name').text().trim().toLowerCase();
             const valor = $(el).find('.value').text().trim();

             if (valor) {
                if (dy === 'N/A' && titulo.includes('dividend yield')) dy = valor;
                if (pvp === 'N/A' && titulo.includes('p/vp')) pvp = valor;
                if (liquidez === 'N/A' && titulo.includes('liquidez')) liquidez = valor;
                
                // Prioridade aqui para preencher o que falta
                if (segmento === 'N/A' && titulo.includes('segmento')) segmento = valor;
                if (vacancia === 'N/A' && titulo.includes('vacância')) vacancia = valor;
                
                // Checagem extra para VP
                if (val_patrimonial === 'N/A' && (titulo.includes('patrimonial') && titulo.includes('cota'))) val_patrimonial = valor;
             }
         });

        return { dy, pvp, segmento, vacancia, val_patrimonial, liquidez };

    } catch (error) {
        console.warn(`[Scraper] Falha ao ler fundamentos de ${ticker}: ${error.message}`);
        return { dy: '-', pvp: '-', segmento: '-', vacancia: '-', val_patrimonial: '-', liquidez: '-' }; 
    }
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

module.exports = async function handler(req, res) {
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

        // --- MODO FUNDAMENTOS ---
        if (mode === 'fundamentos') {
            const { ticker } = payload || {};
            if (!ticker) return res.json({ json: { dy: '-', pvp: '-', segmento: '-', vacancia: '-', val_patrimonial: '-', liquidez: '-' } });

            const dados = await scrapeFundamentos(ticker);
            return res.status(200).json({ json: dados });
        }

        if (mode === 'proventos_carteira') {
            const { fiiList } = payload || {};
            if (!fiiList || !Array.isArray(fiiList)) return res.json({ json: [] });

            const promises = fiiList.map(async (ticker) => {
                const history = await scrapeAsset(ticker);
                const recents = history
                    .filter(h => h.paymentDate && h.value > 0)
                    .slice(0, 3); 

                if (recents.length > 0) {
                    return recents.map(r => ({
                        symbol: ticker.toUpperCase(),
                        value: r.value,
                        paymentDate: r.paymentDate,
                        dataCom: r.dataCom
                    }));
                }
                return null;
            });

            const data = await Promise.all(promises);
            return res.status(200).json({ json: data.filter(d => d !== null).flat() });
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

            let allDividends = [];
            const promises = fiiList.map(async (ticker) => {
                const history = await scrapeAsset(ticker);
                history.slice(0, 24).forEach(h => {
                    if (h.value > 0) {
                        allDividends.push({
                            symbol: ticker.toUpperCase(),
                            dataCom: h.dataCom,
                            paymentDate: h.paymentDate,
                            value: h.value
                        });
                    }
                });
            });

            await Promise.all(promises);
            return res.status(200).json({ json: allDividends });
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
