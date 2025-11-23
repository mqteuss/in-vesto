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

    // Cache na borda (Vercel) por 15 min (900s), stale por 1 hora.
    // Notícias não mudam a cada segundo, isso economiza recursos.
    response.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');

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
    // Chaves em minúsculo para facilitar o match
    const knownSources = {
        'clube fii': { name: 'Clube FII', domain: 'clubefii.com.br' },
        'funds explorer': { name: 'Funds Explorer', domain: 'fundsexplorer.com.br' },
        'status invest': { name: 'Status Invest', domain: 'statusinvest.com.br' },
        'fiis.com.br': { name: 'FIIs.com.br', domain: 'fiis.com.br' },
        'suno': { name: 'Suno Notícias', domain: 'suno.com.br' }, // "Suno" pega "Suno Notícias" via includes
        'investidor10': { name: 'Investidor10', domain: 'investidor10.com.br' },
        'money times': { name: 'Money Times', domain: 'moneytimes.com.br' },
        'infomoney': { name: 'InfoMoney', domain: 'infomoney.com.br' },
        'investing.com': { name: 'Investing.com', domain: 'br.investing.com' },
        'mais retorno': { name: 'Mais Retorno', domain: 'maisretorno.com' },
        // Adicionei Valor e Exame pois são relevantes para FIIs frequentemente
        'valor investe': { name: 'Valor Investe', domain: 'valorinveste.globo.com' },
        'exame': { name: 'Exame', domain: 'exame.com' }
    };

    try {
        const { q } = request.query;
        // Query base refinada para evitar ruído
        const queryTerm = q || 'FII OR "Fundos Imobiliários" OR IFIX OR "Dividendos FII"';
        
        // Constrói a query completa antes de encodar
        const fullQuery = `${queryTerm} when:7d`; 
        const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(fullQuery)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;

        const feed = await parser.parseURL(feedUrl);

        // Set para deduplicação de títulos exatos
        const seenTitles = new Set();

        const articles = feed.items.map((item) => {
            // --- LÓGICA DE EXTRAÇÃO DE FONTE MELHORADA ---
            let rawSourceName = '';
            let cleanTitle = item.title || 'Sem título';

            // 1. Tenta pegar da tag <source> do XML (Mais confiável)
            if (item.sourceObj && item.sourceObj._) {
                rawSourceName = item.sourceObj._;
            } 
            // 2. Fallback: Regex no título (Padrão: "Título da Notícia - Nome da Fonte")
            else {
                const sourcePattern = / - ([^-]+)$/; // Pega o último texto após um hífen
                const match = item.title.match(sourcePattern);
                if (match) {
                    rawSourceName = match[1];
                }
            }

            // Limpa o título removendo o nome da fonte no final
            if (rawSourceName) {
                cleanTitle = cleanTitle.replace(` - ${rawSourceName}`, '').trim();
            }

            // --- FILTRAGEM (Whitelist) ---
            const keyToCheck = rawSourceName.toLowerCase().trim();
            let known = null;

            // 1. Busca exata
            if (knownSources[keyToCheck]) {
                known = knownSources[keyToCheck];
            } 
            // 2. Busca por "includes" (Ex: "Suno Notícias" contém "suno")
            else {
                const foundKey = Object.keys(knownSources).find(k => keyToCheck.includes(k));
                if (foundKey) known = knownSources[foundKey];
            }

            if (!known) return null; // Descarta fontes desconhecidas

            // --- DEDUPLICAÇÃO ---
            if (seenTitles.has(cleanTitle)) return null;
            seenTitles.add(cleanTitle);

            return {
                title: cleanTitle,
                link: item.link,
                publicationDate: item.pubDate, // Importante manter formato original para ordenação
                sourceName: known.name,
                sourceHostname: known.domain,
                // Usa o domínio da whitelist para garantir favicon correto
                favicon: `https://www.google.com/s2/favicons?domain=${known.domain}&sz=64`,
                summary: item.contentSnippet || '',
            };
        })
        .filter(item => item !== null) // Remove nulos (fontes bloqueadas ou duplicatas)
        .sort((a, b) => new Date(b.publicationDate) - new Date(a.publicationDate)); // Ordenação Forçada: Mais recente primeiro

        return response.status(200).json(articles);

    } catch (error) {
        console.error('CRITICAL ERROR API NEWS:', error);
        // Retorna array vazio em vez de erro 500 para não quebrar o frontend, 
        // mas loga o erro no servidor.
        return response.status(200).json([]); 
    }
}
