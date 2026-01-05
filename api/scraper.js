const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// --- OTIMIZAÇÃO: AGENTE HTTPS ---
// Configuração para manter a conexão viva e evitar timeouts em múltiplas requisições
const httpsAgent = new https.Agent({ 
    keepAlive: true,
    maxSockets: 100,
    maxFreeSockets: 10,
    timeout: 15000
});

// Cliente Axios com Headers simulando um navegador real
const client = axios.create({
    httpsAgent,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://investidor10.com.br/'
    },
    timeout: 10000
});

// --- HELPERS (Funções Auxiliares) ---
const REGEX_CLEAN_NUMBER = /[^0-9,-]+/g;

/**
 * Converte string formatada (ex: "10,50%") para float (10.50)
 */
function parseValue(valueStr) {
    if (!valueStr) return 0;
    if (typeof valueStr === 'number') return valueStr;
    
    // Remove caracteres indesejados, exceto números, vírgula e hífen
    let cleanStr = valueStr.replace(REGEX_CLEAN_NUMBER, "").trim();
    
    // Substitui vírgula por ponto para conversão
    cleanStr = cleanStr.replace(',', '.');
    
    // Tenta converter para float
    const floatVal = parseFloat(cleanStr);
    
    return isNaN(floatVal) ? 0 : floatVal;
}

/**
 * Função principal de raspagem (Scraping)
 */
async function scrapeAsset(ticker) {
    try {
        const url = `https://investidor10.com.br/acoes/${ticker.toLowerCase()}/`;
        const { data } = await client.get(url);
        const $ = cheerio.load(data);

        // Objeto base com valores padrão
        const dados = {
            ticker: ticker.toUpperCase(),
            cotacao: 0,
            dy: 0,
            pl: 0,
            pvp: 0,
            evebitda: 0,
            margem_liquida: 0,
            roe: 0,
            liqs_corr: 0,
            divida_liquida_ebitda: 0,
            cresc_rec_5a: 0, // CAGR Receita 5 anos
            valor_mercado: 0
        };

        // --- 1. CAPTURA DOS CARDS DE DESTAQUE (Topo da página) ---
        // Onde geralmente ficam: Cotação, DY, P/L, P/VP no layout mobile/card
        $('._card').each((i, el) => {
            const headerText = $(el).find('._card-header').text().trim().toUpperCase();
            const bodyText = $(el).find('._card-body').text().trim();

            if (headerText.includes('DY')) {
                dados.dy = parseValue(bodyText);
            } else if (headerText.includes('P/L')) {
                dados.pl = parseValue(bodyText);
            } else if (headerText.includes('P/VP')) {
                dados.pvp = parseValue(bodyText);
            } else if (headerText.includes('COTAÇÃO')) {
                dados.cotacao = parseValue(bodyText);
            }
        });

        // Fallback: Tenta pegar a cotação se houver um card específico com classe .cotacao
        const cotacaoDestaque = $('._card.cotacao ._card-body span').first().text();
        if (cotacaoDestaque) {
            dados.cotacao = parseValue(cotacaoDestaque);
        }

        // --- 2. CAPTURA DA GRELHA DE INDICADORES (Divs .cell) ---
        // Itera sobre todas as células de indicadores fundamentais
        $('.cell').each((i, el) => {
            // Tenta pegar o título pela classe .name
            let titulo = $(el).find('.name').text().trim();
            
            // Se não encontrar .name, pega o primeiro span (estrutura alternativa encontrada no HTML)
            if (!titulo) {
                titulo = $(el).children('span').first().text().trim();
            }
            
            const valorStr = $(el).find('.value').text().trim();
            const valor = parseValue(valorStr);
            const tituloUpper = titulo.toUpperCase();

            // Mapeamento dos campos baseado no título
            if (tituloUpper === 'P/L') dados.pl = valor;
            else if (tituloUpper === 'P/VP') dados.pvp = valor;
            else if (tituloUpper === 'DY' || tituloUpper === 'DIVIDEND YIELD') dados.dy = valor; // Caso esteja na grid
            else if (tituloUpper === 'EV/EBITDA') dados.evebitda = valor;
            else if (tituloUpper === 'MARGEM LÍQUIDA') dados.margem_liquida = valor;
            else if (tituloUpper === 'ROE') dados.roe = valor;
            else if (tituloUpper === 'LIQUIDEZ CORRENTE') dados.liqs_corr = valor;
            else if (tituloUpper === 'DÍV. LÍQUIDA/EBITDA') dados.divida_liquida_ebitda = valor;
            else if (tituloUpper.includes('CAGR RECEITA')) dados.cresc_rec_5a = valor;
            else if (tituloUpper === 'VALOR DE MERCADO') {
                // Valor de mercado às vezes vem com sufixo B (Bilhão) ou M (Milhão), 
                // aqui pegamos apenas o número bruto parseado.
                dados.valor_mercado = valorStr; 
            }
        });

        return [dados]; // Retorna array para compatibilidade

    } catch (error) {
        console.error(`Erro ao fazer scraping de ${ticker}:`, error.message);
        return [];
    }
}

// --- HANDLER PRINCIPAL (Serverless/API Entry Point) ---
module.exports = async function handler(req, res) {
    const { ticker, mode } = req.query || req.body || {};

    // Verifica se o ticker foi fornecido
    if (!ticker && (!mode || mode !== 'test')) {
        return res.status(400).json({ error: 'Ticker é obrigatório.' });
    }

    try {
        // Modo de teste simples
        if (mode === 'test') {
            return res.status(200).json({ status: 'Scraper online' });
        }

        // Executa a raspagem
        const result = await scrapeAsset(ticker);
        
        if (result.length === 0) {
            return res.status(404).json({ error: 'Nenhum dado encontrado ou erro na raspagem.' });
        }

        return res.status(200).json({ json: result });

    } catch (error) {
        return res.status(500).json({ error: 'Erro interno no servidor.', details: error.message });
    }
};
