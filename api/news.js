import Parser from 'rss-parser';

// --- SILENCIADOR DE AVISO (FIX) ---
const originalEmit = process.emit;
process.emit = function (name, data, ...args) {
    if (
        name === 'warning' &&
        typeof data === 'object' &&
        data.name === 'DeprecationWarning' &&
        data.message && data.message.includes('url.parse')
    ) {
        return false;
    }
    return originalEmit.apply(process, [name, data, ...args]);
};
// ----------------------------------

export default async function handler(request, response) {

    response.setHeader('Access-Control-Allow-Credentials', true);
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    response.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    response.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=60');

    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }

    const parser = new Parser({
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
        timeout: 10000,
        customFields: {
            item: [['source', 'sourceObj']], 
        },
    });

    const knownSources = {
        'clube fii': { name: 'Clube FII', domain: 'clubefii.com.br' },
        'funds explorer': { name: 'Funds Explorer', domain: 'fundsexplorer.com.br' },
        'status invest': { name: 'Status Invest', domain: 'statusinvest.com.br' },
        'fiis.com.br': { name: 'FIIs.com.br', domain: 'fiis.com.br' },
        'suno': { name: 'Suno Notícias', domain: 'suno.com.br' }, 
        'investidor10': { name: 'Investidor10', domain: 'investidor10.com.br' },
        'money times': { name: 'Money Times', domain: 'moneytimes.com.br' },
        'infomoney': { name: 'InfoMoney', domain: 'infomoney.com.br' },
        'investing.com': { name: 'Investing.com', domain: 'br.investing.com' },
        'mais retorno': { name: 'Mais Retorno', domain: 'maisretorno.com' },
        'valor investe': { name: 'Valor Investe', domain: 'valorinveste.globo.com' },
        'valor econômico': { name: 'Valor Econômico', domain: 'valor.globo.com' },
        'exame': { name: 'Exame', domain: 'exame.com' },
        'brazil journal': { name: 'Brazil Journal', domain: 'braziljournal.com' },
        'seu dinheiro': { name: 'Seu Dinheiro', domain: 'seudinheiro.com' },
        'neofeed': { name: 'NeoFeed', domain: 'neofeed.com.br' },
        'bmc news': { name: 'BMC News', domain: 'bmcnews.com.br' },
        'the cap': { name: 'The Cap', domain: 'thecap.com.br' },
        'inteligência financeira': { name: 'Inteligência Financeira', domain: 'inteligenciafinanceira.com.br' },
        'bloomberg línea': { name: 'Bloomberg Línea', domain: 'bloomberglinea.com.br' },
        'cnn brasil': { name: 'CNN Brasil', domain: 'cnnbrasil.com.br' },
        'tradersclub': { name: 'TC', domain: 'tc.com.br' },
        'advfn': { name: 'ADVFN', domain: 'br.advfn.com' },
        'e-investidor': { name: 'E-Investidor', domain: 'einvestidor.estadao.com.br' }
    };

    try {
        const { q } = request.query;

        // --- 1. QUERY MAIS INTELIGENTE ---
        // Removi: Ibovespa, Mercado Financeiro, B3 (Geradores de ruído)
        // Adicionei: JCP, Fato Relevante (Foco em valor)
        // Mantive: FII, Dividendos, Ações (Necessários)
        const defaultQuery = 'FII OR "Fundos Imobiliários" OR IFIX OR "Dividendos" OR "JCP" OR "Fato Relevante" OR "Ações"';
        
        const queryTerm = q || defaultQuery;
        
        // Reduzi para 3 dias (when:3d) para pegar coisas mais quentes e menos "resumão da semana"
        const fullQuery = `${queryTerm} when:3d`; 
        
        const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(fullQuery)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;

        const feed = await parser.parseURL(feedUrl);

        const seenTitles = new Set();
        
        // --- 2. PADRÕES DE RUÍDO (FILTRO) ---
        // Regex para identificar títulos genéricos de fechamento/abertura que não citam empresas
        const noiseRegex = /(ibovespa|dólar|bolsa|mercado) (fecha|abre|sobe|cai|recua|avança|opera|encerra)/i;

        const articles = feed.items.map((item) => {
            let rawSourceName = '';
            let cleanTitle = item.title || 'Sem título';

            if (item.sourceObj && (item.sourceObj._ || item.sourceObj.content)) {
                rawSourceName = item.sourceObj._ || item.sourceObj.content || item.sourceObj;
            } 
            else {
                const sourcePattern = /(?: - | \| )([^-|]+)$/; 
                const match = item.title.match(sourcePattern);
                if (match) {
                    rawSourceName = match[1];
                }
            }

            if (rawSourceName) {
                cleanTitle = cleanTitle.replace(new RegExp(`(?: - | \\| )\\s*${escapeRegExp(rawSourceName)}$`), '').trim();
            }

            if (!rawSourceName) return null;

            const keyToCheck = rawSourceName.toLowerCase().trim();
            let known = null;

            if (knownSources[keyToCheck]) {
                known = knownSources[keyToCheck];
            } else {
                const foundKey = Object.keys(knownSources).find(k => keyToCheck.includes(k));
                if (foundKey) known = knownSources[foundKey];
            }

            if (!known) return null; 

            if (seenTitles.has(cleanTitle)) return null;
            seenTitles.add(cleanTitle);

            // Captura de Tickers
            const tickerRegex = /\b[A-Z]{4}(?:3|4|5|6|11)\b/g;
            const foundTickers = cleanTitle.match(tickerRegex) || [];
            const uniqueTickers = [...new Set(foundTickers)];

            // --- 3. FILTRAGEM DE RUÍDO ---
            // Se o título parece "Ibovespa fecha em queda" E não tem nenhum ticker específico, ignoramos.
            if (uniqueTickers.length === 0 && noiseRegex.test(cleanTitle)) {
                return null;
            }

            return {
                title: cleanTitle,
                link: item.link,
                publicationDate: item.pubDate, 
                sourceName: known.name,
                sourceHostname: known.domain,
                favicon: `https://www.google.com/s2/favicons?domain=${known.domain}&sz=64`,
                summary: item.contentSnippet || '',
                tickers: uniqueTickers
            };
        })
        .filter(item => item !== null)
        .sort((a, b) => new Date(b.publicationDate) - new Date(a.publicationDate)); 

        return response.status(200).json(articles);

    } catch (error) {
        console.error('CRITICAL ERROR API NEWS:', error);
        return response.status(200).json([]); 
    }
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); 
}
