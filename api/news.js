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

    // 2. LISTA BRANCA ESTRITA (WHITELIST)
    // Apenas estes 9 sites serão aceitos.
    const knownSources = {
        // 1. Clube FII
        'clube fii': { name: 'Clube FII', domain: 'clubefii.com.br' },
        
        // 2. Funds Explorer
        'funds explorer': { name: 'Funds Explorer', domain: 'fundsexplorer.com.br' },
        'fundsexplorer': { name: 'Funds Explorer', domain: 'fundsexplorer.com.br' },
        
        // 3. FIIs.com.br
        'fiis.com.br': { name: 'FIIs.com.br', domain: 'fiis.com.br' },
        'fiis': { name: 'FIIs.com.br', domain: 'fiis.com.br' }, 
        
        // 4. Status Invest
        'status invest': { name: 'Status Invest', domain: 'statusinvest.com.br' },
        'statusinvest': { name: 'Status Invest', domain: 'statusinvest.com.br' },
        
        // 5. Suno Notícias
        'suno': { name: 'Suno Notícias', domain: 'suno.com.br' },
        'suno notícias': { name: 'Suno Notícias', domain: 'suno.com.br' },
        'suno.com.br': { name: 'Suno Notícias', domain: 'suno.com.br' },
        
        // 6. Money Times
        'money times': { name: 'Money Times', domain: 'moneytimes.com.br' },
        'moneytimes': { name: 'Money Times', domain: 'moneytimes.com.br' },
        
        // 7. InfoMoney
        'infomoney': { name: 'InfoMoney', domain: 'infomoney.com.br' },
        
        // 8. Investidor10
        'investidor10': { name: 'Investidor10', domain: 'investidor10.com.br' },
        'investidor 10': { name: 'Investidor10', domain: 'investidor10.com.br' },
        
        // 9. Brazil Journal
        'brazil journal': { name: 'Brazil Journal', domain: 'braziljournal.com' },
        'braziljournal': { name: 'Brazil Journal', domain: 'braziljournal.com' }
    };

    try {
        const { q } = request.query;
        const baseQuery = q || 'FII OR "Fundos Imobiliários" OR IFIX OR "Dividendos FII"';
        
        // Mantendo o filtro de 7 dias (1 semana)
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

            // Normalização para busca
            const key = rawSourceName.toLowerCase().trim();
            
            let known = knownSources[key];
            
            // Busca por aproximação (ex: "InfoMoney Mercados" -> acha "infomoney")
            if (!known) {
                const foundKey = Object.keys(knownSources).find(k => key.includes(k));
                if (foundKey) known = knownSources[foundKey];
            }

            // --- FILTRO RIGOROSO ---
            // Se não estiver na lista acima, descarta.
            if (!known) {
                return null;
            }

            const faviconUrl = `https://www.google.com/s2/favicons?domain=${known.domain}&sz=64`;

            return {
                title: cleanTitle,
                link: item.link,
                publicationDate: item.pubDate,
                sourceName: known.name,
                sourceHostname: known.domain,
                favicon: faviconUrl,
                summary: item.contentSnippet || '',
            };
        })
        .filter(item => item !== null); // Remove os nulos (sites indesejados)

        response.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=1800');
        return response.status(200).json(articles);

    } catch (error) {
        console.error('CRITICAL ERROR API NEWS:', error);
        return response.status(500).json({ error: 'Erro interno ao buscar notícias.', details: error.message });
    }
}
