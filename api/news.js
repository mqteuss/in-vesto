import axios from 'axios';
import { load } from 'cheerio';

export default async function handler(request, response) {
    // --- Configuração de Headers e CORS (Mantido igual) ---
    response.setHeader('Access-Control-Allow-Credentials', true);
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    response.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    response.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=60');

    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }

    // --- Lista de Fontes Conhecidas (Mantido igual) ---
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

    try {
        const { q } = request.query;
        const queryTerm = q || 'FII OR "Fundos Imobiliários" OR IFIX OR "Dividendos FII"';
        
        // Google News RSS URL
        const fullQuery = `${queryTerm} when:5d`; 
        const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(fullQuery)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;

        // 1. Fetch usando AXIOS (substitui o parser.parseURL)
        const { data: xmlData } = await axios.get(feedUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            },
            timeout: 10000
        });

        // 2. Parse usando CHEERIO (modo XML)
        const $ = load(xmlData, { xmlMode: true });
        const seenTitles = new Set();
        const articles = [];

        // Itera sobre cada tag <item> do XML
        $('item').each((_, element) => {
            const item = $(element);
            
            // Extrai dados brutos
            const titleRaw = item.find('title').text() || 'Sem título';
            const link = item.find('link').text();
            const pubDate = item.find('pubDate').text();
            const description = item.find('description').text(); // Google joga o snippet aqui muitas vezes
            
            // Tenta pegar a fonte da tag <source> ou do título
            let rawSourceName = item.find('source').text();
            let cleanTitle = titleRaw;

            // Fallback: se não achou na tag <source>, tenta regex no título
            if (!rawSourceName) {
                const sourcePattern = /(?: - | \| )([^-|]+)$/; 
                const match = titleRaw.match(sourcePattern);
                if (match) {
                    rawSourceName = match[1];
                }
            }

            // Limpeza do título (remove o nome da fonte do final)
            if (rawSourceName) {
                cleanTitle = cleanTitle.replace(new RegExp(`(?: - | \\| )\\s*${escapeRegExp(rawSourceName)}$`), '').trim();
            }

            if (!rawSourceName) return; // return no .each funciona como continue

            // Validação da Fonte (Lógica original mantida)
            const keyToCheck = rawSourceName.toLowerCase().trim();
            let known = null;

            if (knownSources[keyToCheck]) {
                known = knownSources[keyToCheck];
            } else {
                const foundKey = Object.keys(knownSources).find(k => keyToCheck.includes(k));
                if (foundKey) known = knownSources[foundKey];
            }

            if (!known) return; 

            // Deduplicação
            if (seenTitles.has(cleanTitle)) return;
            seenTitles.add(cleanTitle);

            articles.push({
                title: cleanTitle,
                link: link,
                publicationDate: pubDate, 
                sourceName: known.name,
                sourceHostname: known.domain,
                favicon: `https://www.google.com/s2/favicons?domain=${known.domain}&sz=64`,
                summary: extractSummary(description) // Função helper abaixo
            });
        });

        // Ordenação por data
        articles.sort((a, b) => new Date(b.publicationDate) - new Date(a.publicationDate));

        return response.status(200).json(articles);

    } catch (error) {
        console.error('CRITICAL ERROR API NEWS:', error);
        return response.status(200).json([]); 
    }
}

// --- Funções Auxiliares ---

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); 
}

// O Google News RSS coloca HTML dentro da description. 
// Essa função limpa tags simples para pegar o texto, se necessário.
function extractSummary(htmlContent) {
    if (!htmlContent) return '';
    // Remove tags HTML básicas se vierem no description
    return htmlContent.replace(/<[^>]*>?/gm, '').trim(); 
}
