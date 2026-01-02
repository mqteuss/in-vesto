const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// --- CONFIGURAÇÃO DO CLIENTE HTTP ---
const httpsAgent = new https.Agent({ 
    keepAlive: true,
    maxSockets: 100,
    maxFreeSockets: 10,
    timeout: 10000
});

const client = axios.create({
    httpsAgent,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    },
    timeout: 9000
});

// --- HELPERS DE FORMATAÇÃO ---
const REGEX_CLEAN_NUMBER = /[^0-9,-]+/g;
const parseValue = (val) => {
    if (!val || typeof val !== 'string') return 0;
    const clean = val.replace('.', '').replace(',', '.').replace('%', '').trim();
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
};

const normalize = (str) => str ? str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";

// --- LÓGICA DE URL INTELIGENTE ---
function getInvestidor10Url(ticker) {
    const t = ticker.toUpperCase().trim();
    
    // Identificação de Ações (Final 3, 4, 5, 6)
    if (t.endsWith('3') || t.endsWith('4') || t.endsWith('5') || t.endsWith('6')) {
        return `https://investidor10.com.br/acoes/${t}/`;
    }
    // Identificação de BDRs (Final 32, 33, 34, 35)
    if (t.endsWith('32') || t.endsWith('33') || t.endsWith('34') || t.endsWith('35')) {
        return `https://investidor10.com.br/bdrs/${t}/`;
    }
    // Padrão para FIIs (Final 11, 12, B) ou outros
    return `https://investidor10.com.br/fiis/${t}/`;
}

// --- FUNÇÃO DE FETCH COM RETRY ---
const fetchHtmlWithRetry = async (ticker) => {
    const url = getInvestidor10Url(ticker);
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
        try {
            const response = await client.get(url);
            return response; // Sucesso
        } catch (error) {
            attempts++;
            console.error(`[Scraper] Erro ao buscar ${ticker} (Tentativa ${attempts}/${maxAttempts}): ${error.message}`);
            if (attempts >= maxAttempts) throw error;
            await new Promise(r => setTimeout(r, 1000 * attempts)); // Backoff
        }
    }
};

// --- SCRAPER DE FUNDAMENTOS (PRINCIPAL) ---
async function scrapeFundamentos(ticker) {
    try {
        const response = await fetchHtmlWithRetry(ticker);
        const html = response.data;
        const $ = cheerio.load(html);

        // Objeto base
        let dados = {
            dy: 'N/A', pvp: 'N/A', pl: 'N/A', roe: 'N/A',
            segmento: 'N/A', tipo_fundo: 'N/A', mandato: 'N/A',
            vacancia: 'N/A', vp_cota: 'N/A', liquidez: 'N/A', val_mercado: 'N/A',
            patrimonio_liquido: 'N/A', variacao_12m: 'N/A', ultimo_rendimento: 'N/A',
            cnpj: 'N/A', num_cotistas: 'N/A', tipo_gestao: 'N/A', prazo_duracao: 'N/A',
            taxa_adm: 'N/A', cotas_emitidas: 'N/A'
        };

        // --- ESTRATÉGIA 1: CARDS DO TOPO (Mais confiável) ---
        // Investidor10 usa classes como "_card dy", "_card vp", etc.
        
        // P/L (Ações)
        const plEl = $('._card.pl ._card-body span').first();
        if (plEl.length) dados.pl = plEl.text().trim();

        // ROE (Ações) - Às vezes está na tabela, às vezes em card
        const roeEl = $('._card.roe ._card-body span').first();
        if (roeEl.length) dados.roe = roeEl.text().trim();

        // P/VP
        const pvpEl = $('._card.vp ._card-body span').first();
        if (pvpEl.length) dados.pvp = pvpEl.text().trim();

        // Dividend Yield
        const dyEl = $('._card.dy ._card-body span').first();
        if (dyEl.length) dados.dy = dyEl.text().trim();

        // Cotação Atual (para cálculos)
        let cotacao_atual = 0;
        const cotacaoEl = $('._card.cotacao ._card-body span').first();
        if (cotacaoEl.length) cotacao_atual = parseValue(cotacaoEl.text());

        // Liquidez
        const liqEl = $('._card.liquidity ._card-body span').first(); // Classe liquidity
        if (liqEl.length) dados.liquidez = liqEl.text().trim();

        // Valor Patrimonial por Cota
        const valPatEl = $('._card.val_patrimonial ._card-body span').first();
        if (valPatEl.length) dados.vp_cota = valPatEl.text().trim();


        // --- ESTRATÉGIA 2: TABELA DE INDICADORES / DADOS GERAIS ---
        // Varre todas as células de tabelas chave-valor
        const processPair = (tituloRaw, valorRaw) => {
            if (!tituloRaw || !valorRaw) return;
            const titulo = normalize(tituloRaw);
            const valor = valorRaw.trim();

            if (dados.dy === 'N/A' && titulo.includes('dividend yield')) dados.dy = valor;
            if (dados.pvp === 'N/A' && titulo.includes('p/vp')) dados.pvp = valor;
            if (dados.pl === 'N/A' && titulo.includes('p/l')) dados.pl = valor;
            if (dados.roe === 'N/A' && titulo.includes('roe')) dados.roe = valor;
            if (dados.liquidez === 'N/A' && titulo.includes('liquidez')) dados.liquidez = valor;
            if (dados.segmento === 'N/A' && titulo.includes('segmento')) dados.segmento = valor;
            if (dados.vacancia === 'N/A' && titulo.includes('vacancia')) dados.vacancia = valor;
            if (dados.val_mercado === 'N/A' && titulo.includes('mercado')) dados.val_mercado = valor;
            if (dados.ultimo_rendimento === 'N/A' && titulo.includes('ultimo rendimento')) dados.ultimo_rendimento = valor;
            if (dados.variacao_12m === 'N/A' && (titulo.includes('variacao') || titulo.includes('12m'))) dados.variacao_12m = valor;
            if (dados.cnpj === 'N/A' && titulo.includes('cnpj')) dados.cnpj = valor;
            if (dados.num_cotistas === 'N/A' && titulo.includes('cotistas')) dados.num_cotistas = valor;
            if (dados.tipo_gestao === 'N/A' && titulo.includes('gestao')) dados.tipo_gestao = valor;
            if (dados.mandato === 'N/A' && titulo.includes('mandato')) dados.mandato = valor;
            if (dados.tipo_fundo === 'N/A' && titulo.includes('tipo de fundo')) dados.tipo_fundo = valor;
            if (dados.prazo_duracao === 'N/A' && titulo.includes('prazo')) dados.prazo_duracao = valor;
            if (dados.taxa_adm === 'N/A' && titulo.includes('taxa') && titulo.includes('administracao')) dados.taxa_adm = valor;

            // Cotas/Ações Emitidas
            if (dados.cotas_emitidas === 'N/A' && (titulo.includes('cotas emitidas') || titulo.includes('total de papeis') || titulo.includes('acoes emitidas'))) {
                dados.cotas_emitidas = valor;
            }

            // Patrimônio (tratamento especial para diferenciar de VP cota)
            if (titulo.includes('patrimonio') && !titulo.includes('liquido medio')) { // Evita "Patrimonio Liquido Medio"
                const valorNum = parseValue(valor);
                // Se for valor muito alto ou tiver M/B, é o PL Total. Se for baixo (ex: 10,00), é VP/Cota
                const temSufixo = valor.toLowerCase().includes('m') || valor.toLowerCase().includes('b');
                if (temSufixo || valorNum > 5000) {
                    if(dados.patrimonio_liquido === 'N/A') dados.patrimonio_liquido = valor;
                }
            }
        };

        // Executar varredura em tabelas
        $('.cell').each((i, el) => processPair($(el).find('.name').text(), $(el).find('.value').text()));
        $('table tr').each((i, row) => {
            const tds = $(row).find('td');
            if (tds.length >= 2) processPair($(tds[0]).text(), $(tds[1]).text());
        });

        // Fallback: Valor de Mercado calculado se não encontrado
        if (dados.val_mercado === 'N/A' || dados.val_mercado === '-') {
            const qtd = parseValue(dados.cotas_emitidas);
            if (cotacao_atual > 0 && qtd > 0) {
                const mkt = cotacao_atual * qtd;
                if (mkt > 1_000_000_000) dados.val_mercado = `R$ ${(mkt/1_000_000_000).toFixed(2)} B`;
                else if (mkt > 1_000_000) dados.val_mercado = `R$ ${(mkt/1_000_000).toFixed(2)} M`;
            }
        }

        return dados;

    } catch (error) {
        console.error(`Erro scraping ${ticker}:`, error.message);
        return { 
            dy: '-', pvp: '-', pl: '-', roe: '-', segmento: 'Erro de conexão'
        };
    }
}

// --- EXPORTAÇÃO ---
// Se estiver usando módulos (import/export), ajuste conforme seu projeto
// Aqui mantemos o padrão CommonJS compatível com o código anterior
module.exports = { scrapeFundamentos };
