import Parser from 'rss-parser';

export default async function handler(request, response) {
    // Headers padrão
    response.setHeader('Access-Control-Allow-Credentials', true);
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    response.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );
    // Cache adaptativo: 15 minutos para a Vercel
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

    // Fontes confiáveis
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
        'exame': { name: 'Exame', domain: 'exame.com' },
        'brazil journal': { name: 'Brazil Journal', domain: 'braziljournal.com' },
        'seu dinheiro': { name: 'Seu Dinheiro', domain: 'seudinheiro.com' },
        'neofeed': { name: 'NeoFeed', domain: 'neofeed.com.br' },
        'bmc news': { name: 'BMC News', domain: 'bmcnews.com.br' },
        'the cap': { name: 'The Cap', domain: 'thecap.com.br' },
        'inteligência financeira': { name: 'Inteligência Financeira', domain: 'inteligenciafinanceira.com.br' }
    };

    // Função auxiliar para limpar e validar itens (usada tanto pelo Radar quanto pela aba Mercado)
    const processItems = (items, seenTitles) => {
        return items.map((item) => {
            let rawSourceName = '';
            let cleanTitle = item.title || 'Sem título';

            if (item.sourceObj && (item.sourceObj._ || item.sourceObj.content)) {
                rawSourceName = item.sourceObj._ || item.sourceObj.content || item.sourceObj;
            } else {
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

            // Verificação de duplicidade
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
        }).filter(item => item !== null);
    };

    // ========================================================
    // NOVO: BUSCA DIRECIONADA PARA A CARTEIRA DO USUÁRIO
    // ========================================================
    const { tickers } = request.query; 

    if (tickers) {
        // Transforma a string "PETR4,MXRF11" em um array e limita a 30 para evitar erro de URL muito longa
        const tickerList = tickers.split(',').slice(0, 30); 
        
        // Monta uma query dinâmica, ex: ("PETR4" OR "MXRF11") when:7d
        const queryCarteira = `(${tickerList.map(t => `"${t}"`).join(' OR ')}) when:7d`;
        const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(queryCarteira)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;

        try {
            const feed = await parser.parseURL(feedUrl);
            const seenTitles = new Set();
            const articles = processItems(feed.items || [], seenTitles);
            
            // Retorna apenas as notícias exclusivas da carteira e encerra a requisição aqui
            return response.status(200).json(articles);
        } catch (error) {
            console.error("Erro ao buscar notícias da carteira:", error);
            // Retorna array vazio em caso de erro para não travar a UI
            return response.status(200).json([]); 
        }
    }
    // ========================================================

    // ========================================================
    // BUSCA GERAL (Para a Aba "Mercado")
    // ========================================================
    try {
        // Definição das Queries separadas
        const queryFII = 'FII OR "Fundos Imobiliários" OR IFIX OR "Dividendos FII" when:14d';
        const queryStocks = '"Ações" OR "Ibovespa" OR "Dividendos Ações" OR "Mercado de Ações" -FII -"Fundos Imobiliários" when:14d';

        const feedUrlFII = `https://news.google.com/rss/search?q=${encodeURIComponent(queryFII)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
        const feedUrlStocks = `https://news.google.com/rss/search?q=${encodeURIComponent(queryStocks)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;

        // Busca paralela para velocidade máxima
        const [feedFII, feedStocks] = await Promise.all([
            parser.parseURL(feedUrlFII),
            parser.parseURL(feedUrlStocks)
        ]);

        const seenTitles = new Set();
        
        // Processamento separado
        const articlesFII = processItems(feedFII.items || [], seenTitles);
        const articlesStocks = processItems(feedStocks.items || [], seenTitles);

        // União e Ordenação Final pela data mais recente
        const allArticles = [...articlesFII, ...articlesStocks]
            .sort((a, b) => new Date(b.publicationDate) - new Date(a.publicationDate));

        return response.status(200).json(allArticles);

    } catch (error) {
        console.error('CRITICAL ERROR API NEWS:', error);
        return response.status(200).json([]);
    }
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}