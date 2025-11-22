import Parser from 'rss-parser';

export default async function handler(request, response) {
    // 1. Configuração de CORS (Segurança e Acesso)
    response.setHeader('Access-Control-Allow-Credentials', true);
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    response.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    // Responde imediatamente ao "pre-flight" do navegador
    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }

    const parser = new Parser();

    try {
        // 2. Captura o termo de busca (opcional)
        // Se o frontend mandar ?q=MXRF11, busca específico. Se não, busca geral.
        const { q } = request.query;
        const queryTerm = q || 'FII OR Fundos Imobiliários OR IFIX';
        
        // Codifica para URL (ex: espaço vira %20)
        const encodedQuery = encodeURIComponent(queryTerm);
        
        // URL oficial do RSS do Google News (Brasil)
        const feedUrl = `https://news.google.com/rss/search?q=${encodedQuery}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
        
        const feed = await parser.parseURL(feedUrl);

        // 3. Formatação dos dados para o Frontend
        const articles = feed.items.map((item) => {
            // Remove o " - Nome da Fonte" do final do título para ficar limpo
            const sourcePattern = / - (.*?)$/;
            const sourceMatch = item.title.match(sourcePattern);
            const sourceName = sourceMatch ? sourceMatch[1] : 'Google News';
            const cleanTitle = item.title.replace(sourcePattern, '');

            // Tenta extrair o domínio para o ícone (favicon)
            let hostname = 'google.com';
            try {
                const urlObj = new URL(item.link);
                hostname = urlObj.hostname;
            } catch (e) {}

            return {
                title: cleanTitle,
                link: item.link,
                publicationDate: item.pubDate, // Mantendo compatibilidade com seu app.js
                sourceName: sourceName,
                sourceHostname: hostname,
                summary: item.contentSnippet || '',
                relatedTickers: [] // RSS não tem tickers, enviamos vazio
            };
        });

        // 4. Configuração de Cache (Vercel Edge Network)
        // s-maxage=3600 -> Cache dura 1 hora (3600 segundos)
        // stale-while-revalidate=1800 -> Serve conteúdo antigo por mais 30min se cair a conexão
        response.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=1800');

        return response.status(200).json(articles);

    } catch (error) {
        console.error('Erro API News:', error);
        return response.status(500).json({ error: 'Erro ao buscar notícias.' });
    }
}
