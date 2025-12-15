const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// OTIMIZAÇÃO 1: Agente Keep-Alive para reutilizar conexões TCP (Acelera requisições em lote)
const httpsAgent = new https.Agent({ keepAlive: true });

const client = axios.create({
    httpsAgent,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Connection': 'keep-alive'
    },
    // OTIMIZAÇÃO 2: Timeout reduzido para 6s. 
    // Motivo: O limite da Vercel Hobby é 10s. Se esperar 9s, o script morre antes de tratar o erro.
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
        return parseFloat(valueStr.replace(/[^0-9,-]+/g, "").replace(',', '.')) || 0;
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
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function chunkArray(array, size) {
    const results = [];
    for (let i = 0; i < array.length; i += size) {
        results.push(array.slice(i, i + size));
    }
    return results;
}

// --- SCRAPER DE FUNDAMENTOS ---
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
            } else { throw e; }
        }

        const html = response.data;
        const $ = cheerio.load(html);

        let dados = {
            dy: 'N/A', pvp: 'N/A', segmento: 'N/A', tipo_fundo: 'N/A', mandato: 'N/A',
            vacancia: 'N/A', vp_cota: 'N/A', liquidez: 'N/A', val_mercado: 'N/A',
            patrimonio_liquido: 'N/A', variacao_12m: 'N/A', ultimo_rendimento: 'N/A',
            cnpj: 'N/A', num_cotistas: 'N/A', tipo_gestao: 'N/A', prazo_duracao: 'N/A',
            taxa_adm: 'N/A', cotas_emitidas: 'N/A'
        };

        let cotacao_atual = 0;
        let num_cotas = 0;

        // Otimização de String: Calcula lowerCase uma vez só
        const processPair = (tituloRaw, valorRaw) => {
            const titulo = normalize(tituloRaw);
            const valor = valorRaw.trim();
            if (!valor) return;

            // Mapeamento direto é mais rápido que muitos ifs, mas mantive a lógica robusta
            if (dados.dy === 'N/A' && titulo.includes('dividend yield')) dados.dy = valor;
            else if (dados.pvp === 'N/A' && titulo.includes('p/vp')) dados.pvp = valor;
            else if (dados.liquidez === 'N/A' && titulo.includes('liquidez')) dados.liquidez = valor;
            else if (dados.segmento === 'N/A' && titulo.includes('segmento')) dados.segmento = valor;
            else if (dados.vacancia === 'N/A' && titulo.includes('vacancia')) dados.vacancia = valor;
            else if (dados.val_mercado === 'N/A' && titulo.includes('mercado')) dados.val_mercado = valor;
            else if (dados.ultimo_rendimento === 'N/A' && titulo.includes('ultimo rendimento')) dados.ultimo_rendimento = valor;
            else if (dados.variacao_12m === 'N/A' && titulo.includes('variacao') && titulo.includes('12m')) dados.variacao_12m = valor;
            else if (dados.cnpj === 'N/A' && titulo.includes('cnpj')) dados.cnpj = valor;
            else if (dados.num_cotistas === 'N/A' && titulo.includes('cotistas')) dados.num_cotistas = valor;
            
            // Verificações específicas
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

        // Seletores específicos (mais rápido que varrer tudo)
        $('._card').each((i, el) => processPair($(el).find('._card-header span').text(), $(el).find('._card-body span').text()));
        $('.cell').each((i, el) => processPair($(el).find('.name').text(), $(el).find('.value').text()));
        $('table tbody tr').each((i, row) => {
            const cols = $(row).find('td');
            if (cols.length >= 2) processPair($(cols[0]).text(), $(cols[1]).text());
        });

        // Cálculos finais
        if (dados.val_mercado === 'N/A' || dados.val_mercado === '-') {
            const cotacaoEl = $('._card.cotacao ._card-body span').first();
            if (cotacaoEl.length) cotacao_atual = parseValue(cotacaoEl.text());

            let mercadoCalc = 0;
            if (cotacao_atual > 0 && num_cotas > 0) mercadoCalc = cotacao_atual * num_cotas;
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

        return dados;
    } catch (error) {
        return { dy: '-', pvp: '-', segmento: '-' };
    }
}

// --- SCRAPER DE HISTÓRICO ---
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
            } else { throw e; }
        }

        const html = response.data;
        const $ = cheerio.load(html);
        const dividendos = [];

        // Otimização: Tenta achar a tabela correta mais rápido
        let tableRows = $('#table-dividends-history tbody tr');
        if (tableRows.length === 0) {
            const tables = $('table');
            for (let i = 0; i < tables.length; i++) {
                const header = normalize($(tables[i]).find('thead').text());
                if (header.includes('com') && header.includes('pagamento')) {
                    tableRows = $(tables[i]).find('tbody tr');
                    break;
                }
            }
        }

        tableRows.each((i, el) => {
            const cols = $(el).find('td');
            if (cols.length >= 4) {
                dividendos.push({
                    dataCom: parseDate($(cols[1]).text().trim()),
                    paymentDate: parseDate($(cols[2]).text().trim()),
                    value: parseValue($(cols[3]).text().trim())
                });
            }
        });
        return dividendos;
    } catch (error) { return []; }
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    // Permite GET apenas para teste simples de "Online"
    if (req.method === 'GET') return res.status(200).json({ status: 'Scraper Online' });
    if (req.method !== 'POST') { return res.status(405).json({ error: "Use POST" }); }

    try {
        if (!req.body || !req.body.mode) throw new Error("Payload inválido");
        const { mode, payload } = req.body;

        if (mode === 'fundamentos') {
            if (!payload.ticker) return res.json({ json: {} });
            const dados = await scrapeFundamentos(payload.ticker);
            return res.status(200).json({ json: dados });
        }

        if (mode === 'proventos_carteira') {
            if (!payload.fiiList) return res.json({ json: [] });
            const batches = chunkArray(payload.fiiList, 3);
            const finalResults = []; // OTIMIZAÇÃO DE MEMÓRIA: Array único

            for (const batch of batches) {
                const promises = batch.map(async (ticker) => {
                    const history = await scrapeAsset(ticker);
                    // Pega apenas os 3 últimos pagamentos válidos
                    const recents = history.filter(h => h.paymentDate && h.value > 0).slice(0, 3);
                    if (recents.length > 0) return recents.map(r => ({ symbol: ticker.toUpperCase(), ...r }));
                    return null;
                });
                
                const batchResults = await Promise.all(promises);
                // OTIMIZAÇÃO: Push com spread é mais leve que concat para arrays grandes
                const validResults = batchResults.filter(d => d !== null).flat();
                if (validResults.length > 0) finalResults.push(...validResults);
                
                // Delay mantido para evitar Bloqueio (WAF)
                await new Promise(r => setTimeout(r, 500)); 
            }
            return res.status(200).json({ json: finalResults });
        }

        // ... Mantenha o resto dos modos iguais, eles já são leves ...
        // (Apenas repliquei o histórico_12m e outros abaixo para garantir integridade)
        
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

        if (mode === 'historico_portfolio') {
            if (!payload.fiiList) return res.json({ json: [] });
            const batches = chunkArray(payload.fiiList, 3); 
            const all = [];
            for (const batch of batches) {
                const promises = batch.map(async (ticker) => {
                    const history = await scrapeAsset(ticker);
                    history.slice(0, 24).forEach(h => {
                        if (h.value > 0) all.push({ symbol: ticker.toUpperCase(), ...h });
                    });
                });
                await Promise.all(promises);
                await new Promise(r => setTimeout(r, 500));
            }
            return res.status(200).json({ json: all });
        }

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