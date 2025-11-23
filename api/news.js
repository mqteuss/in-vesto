import Parser from 'rss-parser';

export default async function handler(request, response) {
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

    // --- MAPA DE FONTES CONHECIDAS (A Mágica acontece aqui) ---
    // Isso força o nome bonito e o domínio correto para o favicon
    const knownSources = {
        'infomoney': { name: 'InfoMoney', domain: 'infomoney.com.br' },
        'suno': { name: 'Suno Notícias', domain: 'suno.com.br' },
        'suno.com.br': { name: 'Suno Notícias', domain: 'suno.com.br' },
        'brazil journal': { name: 'Brazil Journal', domain: 'braziljournal.com' },
        'valor econômico': { name: 'Valor Econômico', domain: 'valor.globo.com' },
        'valor': { name: 'Valor Econômico', domain: 'valor.globo.com' },
        'exame': { name: 'Exame', domain: 'exame.com' },
        'money times': { name: 'Money Times', domain: 'moneytimes.com.br' },
        'fiis.com.br': { name: 'FIIs.com.br', domain: 'fiis.com.br' },
        'clube fii': { name: 'Clube FII', domain: 'clubefii.com.br' },
        'funds explorer': { name: 'Funds Explorer', domain: 'fundsexplorer.com.br' },
        'seu dinheiro': { name: 'Seu Dinheiro', domain: 'seudinheiro.com' },
        'terra': { name: 'Terra', domain: 'terra.com.br' },
        'uol': { name: 'UOL', domain: 'uol.com.br' },
        'folha': { name: 'Folha de S.Paulo', domain: 'folha.uol.com.br' },
        'folha de s.paulo': { name: 'Folha de S.Paulo', domain: 'folha.uol.com.br' },
        'estadao': { name: 'Estadão', domain: 'estadao.com.br' },
        'invest news': { name: 'InvestNews', domain: 'investnews.com.br' },
        'b3': { name: 'B3', domain: 'b3.com.br' },
        'inteligência financeira': { name: 'Inteligência Financeira', domain: 'inteligenciafinanceira.com.br' },
        'bora investir': { name: 'Bora Investir', domain: 'borainvestir.b3.com.br' },
        'martinelli.adv.br': { name: 'Martinelli Advogados', domain: 'martinelli.adv.br' },
        'neo feed': { name: 'NeoFeed', domain: 'neofeed.com.br' },
        'bp money': { name: 'BP Money', domain: 'bpmoney.com.br' }
    };

    try {
        const { q } = request.query;
        const baseQuery = q || 'FII OR "Fundos Imobiliários" OR IFIX OR "Dividendos FII"';
        const encodedQuery = encodeURIComponent(baseQuery) + '+when:30d';
        
        const feedUrl = `https://news.google.com/rss/search?q=${encodedQuery}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
        
        const feed = await parser.parseURL(feedUrl);

        const articles = feed.items.map((item) => {
            // 1. Tenta extrair o nome da fonte do Título (padrão: "Título - Fonte")
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

            // Remove o nome da fonte do título para não ficar duplicado
            const cleanTitle = item.title ? item.title.replace(sourcePattern, '') : 'Sem título';

            // 2. Lógica Inteligente de Domínio e Nome
            let finalSourceName = rawSourceName;
            let finalDomain = 'google.com'; // Fallback inicial

            // Normaliza para buscar no dicionário (lowercase)
            const key = rawSourceName.toLowerCase().trim();
            
            // Verifica se conhecemos essa fonte
            let known = knownSources[key];
            
            // Se não achou exato, tenta ver se a chave está contida (ex: "InfoMoney inves.." -> "InfoMoney")
            if (!known) {
                const foundKey = Object.keys(knownSources).find(k => key.includes(k));
                if (foundKey) known = knownSources[foundKey];
            }

            if (known) {
                // CASO 1: Fonte Conhecida (Usa nossos dados limpos)
                finalSourceName = known.name;
                finalDomain = known.domain;
            } else {
                // CASO 2: Fonte Desconhecida (Tenta extrair do XML ou mantém o nome original)
                // Tenta pegar URL do XML se existir
                if (item.sourceData && item.sourceData['$'] && item.sourceData['$'].url) {
                    try {
                        const urlObj = new URL(item.sourceData['$'].url);
                        finalDomain = urlObj.hostname;
                    } catch (e) {}
                }
                
                // Se o nome parecer um site (tem .com ou .br), usa ele como domínio também
                if (finalSourceName.includes('.com') || finalSourceName.includes('.br')) {
                    finalDomain = finalSourceName; 
                }
            }

            // Gera favicon usando a API do Google com o domínio correto
            const faviconUrl = `https://www.google.com/s2/favicons?domain=${finalDomain}&sz=64`;

            return {
                title: cleanTitle,
                link: item.link,
                publicationDate: item.pubDate,
                sourceName: finalSourceName,
                sourceHostname: finalDomain,
                favicon: faviconUrl,
                summary: item.contentSnippet || '',
            };
        });

        response.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=1800');
        return response.status(200).json(articles);

    } catch (error) {
        console.error('CRITICAL ERROR API NEWS:', error);
        return response.status(500).json({ error: 'Erro interno ao buscar notícias.', details: error.message });
    }
}
