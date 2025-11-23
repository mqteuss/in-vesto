import Parser from 'rss-parser';

export default async function handler(request, response) {
    // 1. Configuração de CORS
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

    // 2. Configura o Parser para extrair a URL original da fonte
    // Isso é crucial para pegar o favicon correto, pois o item.link é um redirecionamento do Google.
    const parser = new Parser({
        customFields: {
            item: [['source', 'sourceData', { keepArray: false }]],
        },
    });

    try {
        const { q } = request.query;
        
        // Termo padrão focado estritamente em FIIs
        const baseQuery = q || 'FII OR "Fundos Imobiliários" OR IFIX OR "Dividendos FII"';
        
        // 3. Adiciona "when:30d" para filtrar apenas os últimos 30 dias
        // O operador "+" concatena a string de busca na URL
        const encodedQuery = encodeURIComponent(baseQuery) + '+when:30d';
        
        const feedUrl = `https://news.google.com/rss/search?q=${encodedQuery}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
        
        const feed = await parser.parseURL(feedUrl);

        const articles = feed.items.map((item) => {
            // Limpeza do título
            const sourcePattern = / - (.*?)$/;
            const sourceMatch = item.title.match(sourcePattern);
            const sourceName = sourceMatch ? sourceMatch[1] : (item.sourceData?.content || 'Google News');
            const cleanTitle = item.title.replace(sourcePattern, '');

            // 4. Lógica de Extração do Domínio para o Favicon
            // Tenta pegar a URL da tag <source> do XML. Se falhar, usa o link do item.
            let domain = 'google.com';
            
            if (item.sourceData && item.sourceData.$.url) {
                try {
                    const sourceUrlObj = new URL(item.sourceData.$.url);
                    domain = sourceUrlObj.hostname;
                } catch (e) {
                    // Fallback se a URL da fonte for inválida
                }
            }

            // Gera a URL do favicon usando a API pública do Google (sz=64 para alta resolução)
            const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

            return {
                title: cleanTitle,
                link: item.link,
                publicationDate: item.pubDate,
                sourceName: sourceName,
                sourceHostname: domain,
                favicon: faviconUrl, // Novo campo para você usar no <img src="...">
                summary: item.contentSnippet || '',
            };
        });

        response.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=1800');
        return response.status(200).json(articles);

    } catch (error) {
        console.error('Erro API News:', error);
        return response.status(500).json({ error: 'Erro ao buscar notícias.' });
    }
}
