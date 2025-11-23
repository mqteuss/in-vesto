import Parser from 'rss-parser';

export default async function handler(request, response) {
    // 1. Configuração de CORS e Headers
    response.setHeader('Access-Control-Allow-Credentials', true);
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    response.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }

    const parser = new Parser({
        customFields: {
            item: [['source', 'sourceData', { keepArray: false }]],
        },
    });

    // 2. LISTA BRANCA (10 Sites)
    const knownSources = {
        'clube fii': { name: 'Clube FII', domain: 'clubefii.com.br' },
        'funds explorer': { name: 'Funds Explorer', domain: 'fundsexplorer.com.br' },
        'fundsexplorer': { name: 'Funds Explorer', domain: 'fundsexplorer.com.br' },
        'status invest': { name: 'Status Invest', domain: 'statusinvest.com.br' },
        'statusinvest': { name: 'Status Invest', domain: 'statusinvest.com.br' },
        'fiis.com.br': { name: 'FIIs.com.br', domain: 'fiis.com.br' },
        'fiis': { name: 'FIIs.com.br', domain: 'fiis.com.br' }, 
        'suno': { name: 'Suno Notícias', domain: 'suno.com.br' },
        'suno notícias': { name: 'Suno Notícias', domain: 'suno.com.br' },
        'investidor10': { name: 'Investidor10', domain: 'investidor10.com.br' },
        'investidor 10': { name: 'Investidor10', domain: 'investidor10.com.br' },
        'money times': { name: 'Money Times', domain: 'moneytimes.com.br' },
        'moneytimes': { name: 'Money Times', domain: 'moneytimes.com.br' },
        'infomoney': { name: 'InfoMoney', domain: 'infomoney.com.br' },
        'investing.com': { name: 'Investing.com', domain: 'br.investing.com' },
        'investing': { name: 'Investing.com', domain: 'br.investing.com' },
        'mais retorno': { name: 'Mais Retorno', domain: 'maisretorno.com' },
        'maisretorno': { name: 'Mais Retorno', domain: 'maisretorno.com' }
    };

    try {
        const { q } = request.query;
        const baseQuery = q || 'FII OR "Fundos Imobiliários" OR IFIX OR "Dividendos FII"';
        
        // Filtro de tempo: Últimos 7 dias
        const encodedQuery = encodeURIComponent(baseQuery) + '+when:7d';
        
        const feedUrl = `https://news.google.com/rss/search?q=${encodedQuery}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
        
        const feed = await parser.parseURL(feedUrl);

        const articles = feed.items.map((item) => {
            const sourcePattern = / - (.*?)$/;
            const sourceMatch = item.title ? item.title.match(sourcePattern) : null;
            
            let rawSourceName = 'Google News';
            if (sourceMatch) {
                rawSourceName = sourceMatch[1];
            } else if (item.sourceData && item.sourceData.content) {
                rawSourceName = item.sourceData.content;
            } else if (item.sourceData && item.sourceData._) {
                rawSourceName = item.sourceData._;
            }

            const cleanTitle = item.title ? item.title.replace(sourcePattern, '') : 'Sem título';

            // Normalização para busca na lista
            const key = rawSourceName.toLowerCase().trim();
            let known = knownSources[key];
            
            if (!known) {
                const foundKey = Object.keys(knownSources).find(k => key.includes(k));
                if (foundKey) known = knownSources[foundKey];
            }

            // Filtro de Segurança
            if (!known) {
                return null;
            }

            // --- EXTRAÇÃO DE TICKERS ---
            // Procura por padrões de 4 letras maiúsculas seguidas de "11" (ex: MXRF11)
            const tickerRegex = /\b[A-Z]{4}11\b/g;
            const textToScan = `${cleanTitle} ${item.contentSnippet || ''}`;
            // Remove duplicatas usando Set
            const foundTickers = [...new Set(textToScan.match(tickerRegex) || [])];

            const faviconUrl = `https://www.google.com/s2/favicons?domain=${known.domain}&sz=64`;

            return {
                title: cleanTitle,
                link: item.link,
                publicationDate: item.pubDate,
                sourceName: known.name,
                sourceHostname: known.domain,
                favicon: faviconUrl,
                summary: item.contentSnippet || '',
                tickers: foundTickers // Novo campo enviado para o frontend
            };
        })
        .filter(item => item !== null);

        // Cache de 1 hora (3600s)
        response.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=1800');
        return response.status(200).json(articles);

    } catch (error) {
        console.error('CRITICAL ERROR API NEWS:', error);
        return response.status(500).json({ error: 'Erro interno ao buscar notícias.', details: error.message });
    }
}
