import Parser from 'rss-parser';

export default async function handler(request, response) {
    // 1. Configuração de CORS e Headers Otimizados
    response.setHeader('Access-Control-Allow-Credentials', true);
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    response.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    // Cache na borda (Vercel) por 15 min (900s).
    // stale-while-revalidate reduzido para 60s para evitar entregar dados muito velhos.
    response.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=60');

    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }

    const parser = new Parser({
        customFields: {
            // Tenta pegar a tag <source> que o Google News fornece
            item: [['source', 'sourceObj']], 
        },
    });

    // 2. LISTA BRANCA (Mapeamento Normalizado)
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
        'exame': { name: 'Exame', domain: 'exame.com' }
    };

    try {
        const { q } = request.query;
        const queryTerm = q || 'FII OR "Fundos Imobiliários" OR IFIX OR "Dividendos FII"';
        
        const fullQuery = `${queryTerm} when:7d`; 
        const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(fullQuery)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;

        const feed = await parser.parseURL(feedUrl);

        // Set para deduplicação de títulos exatos
        const seenTitles = new Set();

        const articles = feed.items.map((item) => {
            let rawSourceName = '';
            let cleanTitle = item.title || 'Sem título';

            // 1. Tenta pegar da tag <source>
            if (item.sourceObj && item.sourceObj._) {
                rawSourceName = item.sourceObj._;
            } 
            // 2. Fallback: Regex no título
            else {
                const sourcePattern = / - ([^-]+)$/; 
                const match = item.title.match(sourcePattern);
                if (match) {
                    rawSourceName = match[1];
                }
            }

            // Limpa o título
            if (rawSourceName) {
                cleanTitle = cleanTitle.replace(` - ${rawSourceName}`, '').trim();
            }

            // --- FILTRAGEM (Whitelist) ---
            const keyToCheck = rawSourceName.toLowerCase().trim();
            let known = null;

            if (knownSources[keyToCheck]) {
                known = knownSources[keyToCheck];
            } else {
                const foundKey = Object.keys(knownSources).find(k => keyToCheck.includes(k));
                if (foundKey) known = knownSources[foundKey];
            }

            if (!known) return null; 

            // --- DEDUPLICAÇÃO ---
            if (seenTitles.has(cleanTitle)) return null;
            seenTitles.add(cleanTitle);

            return {
                title: cleanTitle,
                link: item.link,
                publicationDate: item.pubDate, 
                sourceName: known.name,
                sourceHostname: known.domain,
                favicon: `https://www.google.com/s2/favicons?domain=${known.domain}&sz=64`,
                summary: item.contentSnippet || '',
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
