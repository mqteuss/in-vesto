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

    // Configuração do Parser
    const parser = new Parser({
        customFields: {
            item: [['source', 'sourceData', { keepArray: false }]],
        },
    });

    try {
        const { q } = request.query;
        
        // Termo de busca e Filtro de 30 dias (when:30d)
        const baseQuery = q || 'FII OR "Fundos Imobiliários" OR IFIX OR "Dividendos FII"';
        const encodedQuery = encodeURIComponent(baseQuery) + '+when:30d';
        
        const feedUrl = `https://news.google.com/rss/search?q=${encodedQuery}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
        
        const feed = await parser.parseURL(feedUrl);

        const articles = feed.items.map((item) => {
            // Limpeza do título (com segurança para evitar crash se title for nulo)
            const sourcePattern = / - (.*?)$/;
            const sourceMatch = item.title ? item.title.match(sourcePattern) : null;
            
            // Segurança: Se item.sourceData não existir, usa fallback
            let sourceName = 'Google News';
            if (sourceMatch) {
                sourceName = sourceMatch[1];
            } else if (item.sourceData && item.sourceData.content) {
                sourceName = item.sourceData.content;
            } else if (item.sourceData && item.sourceData._) {
                sourceName = item.sourceData._;
            }

            const cleanTitle = item.title ? item.title.replace(sourcePattern, '') : 'Sem título';

            // Lógica BLINDADA de Extração do Domínio
            let domain = 'google.com';
            
            // AQUI ESTA A CORREÇÃO PRINCIPAL DO ERRO 500:
            // Verificamos se sourceData existe ANTES de tentar ler a URL
            if (item.sourceData && item.sourceData['$'] && item.sourceData['$'].url) {
                try {
                    const sourceUrlObj = new URL(item.sourceData['$'].url);
                    domain = sourceUrlObj.hostname;
                } catch (e) {
                    // Se a URL for inválida, mantém google.com e segue a vida
                }
            }

            // Gera favicon
            const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

            return {
                title: cleanTitle,
                link: item.link,
                publicationDate: item.pubDate,
                sourceName: sourceName,
                sourceHostname: domain,
                favicon: faviconUrl,
                summary: item.contentSnippet || '',
            };
        });

        response.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=1800');
        return response.status(200).json(articles);

    } catch (error) {
        console.error('CRITICAL ERROR API NEWS:', error);
        // Retorna o erro detalhado para ajudar no debug se acontecer de novo
        return response.status(500).json({ error: 'Erro interno ao buscar notícias.', details: error.message });
    }
}
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
