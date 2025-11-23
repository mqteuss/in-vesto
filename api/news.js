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

    // --- MAPA DE FONTES CONHECIDAS ---
    // Adicionei os novos sites solicitados aqui
    const knownSources = {
        // Fontes solicitadas recentemente
        'xp investimentos': { name: 'XP Investimentos', domain: 'xpi.com.br' },
        'xp': { name: 'XP Investimentos', domain: 'xpi.com.br' }, // Caso venha só "XP"
        'investalk': { name: 'InvesTalk', domain: 'investalk.bb.com.br' },
        'investidor10': { name: 'Investidor10', domain: 'investidor10.com.br' },
        'investidor 10': { name: 'Investidor10', domain: 'investidor10.com.br' },
        'riconnect': { name: 'Riconnect', domain: 'riconnect.rico.com.vc' },
        'rico': { name: 'Rico', domain: 'rico.com.vc' },
        'e-investidor': { name: 'E-Investidor', domain: 'einvestidor.estadao.com.br' },
        'estadão e-investidor': { name: 'E-Investidor', domain: 'einvestidor.estadao.com.br' },
        'genial analisa': { name: 'Genial Analisa', domain: 'analisa.genialinvestimentos.com.br' },
        'genial': { name: 'Genial Investimentos', domain: 'genialinvestimentos.com.br' },
        'fiis': { name: 'FIIs.com.br', domain: 'fiis.com.br' }, // Mapeando "FIIs" para o site principal

        // Fontes anteriores
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
        
        // ALTERAÇÃO: Mudado de 30d para 7d (1 semana)
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

            let finalSourceName = rawSourceName;
            let finalDomain = 'google.com';

            const key = rawSourceName.toLowerCase().trim();
            
            let known = knownSources[key];
            
            if (!known) {
                const foundKey = Object.keys(knownSources).find(k => key.includes(k));
                if (foundKey) known = knownSources[foundKey];
            }

            if (known) {
                finalSourceName = known.name;
                finalDomain = known.domain;
            } else {
                if (item.sourceData && item.sourceData['$'] && item.sourceData['$'].url) {
                    try {
                        const urlObj = new URL(item.sourceData['$'].url);
                        finalDomain = urlObj.hostname;
                    } catch (e) {}
                }
                
                if (finalSourceName.includes('.com') || finalSourceName.includes('.br')) {
                    finalDomain = finalSourceName; 
                }
            }

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
