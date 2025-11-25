import axios from 'axios';
import * as cheerio from 'cheerio';

// Configuração do cliente HTTP para parecer um navegador
const client = axios.create({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
    },
    timeout: 8000 // Timeout de 8s para não estourar o limite da Vercel
});

// Função auxiliar para formatar data (dd/mm/aaaa -> aaaa-mm-dd)
function parseDate(dateStr) {
    if (!dateStr || dateStr === '-') return null;
    const parts = dateStr.trim().split('/');
    if (parts.length !== 3) return null;
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

// Função auxiliar para formatar valor (R$ 0,10 -> 0.10)
function parseValue(valueStr) {
    if (!valueStr) return 0;
    return parseFloat(valueStr.replace('R$', '').replace('.', '').replace(',', '.').trim()) || 0;
}

// Scraper principal de um único ativo
async function scrapeAsset(ticker) {
    try {
        // Tenta primeiro como FII, se falhar (404), tenta como Ação (fallback)
        let url = `https://investidor10.com.br/fiis/${ticker.toLowerCase()}/`;
        let response;
        
        try {
            response = await client.get(url);
        } catch (e) {
            if (e.response && e.response.status === 404) {
                url = `https://investidor10.com.br/acoes/${ticker.toLowerCase()}/`;
                response = await client.get(url);
            } else {
                throw e;
            }
        }

        const html = response.data;
        const $ = cheerio.load(html);
        const dividendos = [];

        // Busca a tabela de histórico de proventos
        // O seletor pode variar, mas geralmente é #table-dividends-history
        $('#table-dividends-history tbody tr').each((i, el) => {
            const cols = $(el).find('td');
            if (cols.length >= 4) {
                const tipo = $(cols[0]).text().trim();
                const dataCom = $(cols[1]).text().trim();
                const dataPag = $(cols[2]).text().trim();
                const valor = $(cols[3]).text().trim();

                dividendos.push({
                    tipo,
                    dataCom: parseDate(dataCom),
                    paymentDate: parseDate(dataPag),
                    value: parseValue(valor),
                    originalDataCom: dataCom // Mantém para debug/exibição se precisar
                });
            }
        });

        return dividendos;
    } catch (error) {
        console.error(`Erro ao fazer scrap de ${ticker}:`, error.message);
        return [];
    }
}

export default async function handler(req, res) {
    // Permite CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Método não permitido. Use POST." });
    }

    const { mode, payload } = req.body;

    try {
        if (mode === 'proventos_carteira') {
            // Tarefa: Buscar o provento FUTURO ou MAIS RECENTE de uma lista
            // Payload: { fiiList: ['MXRF11', 'HGLG11'], todayString: ... }
            const { fiiList } = payload;
            const results = [];

            // Faz as requisições em paralelo (Promise.all)
            const promises = fiiList.map(async (ticker) => {
                const history = await scrapeAsset(ticker);
                
                // Pega o último anunciado (o primeiro da lista, pois o site ordena desc)
                // Filtra para garantir que tem data válida
                const latest = history.find(h => h.paymentDate && h.value > 0);

                if (latest) {
                    return {
                        symbol: ticker.toUpperCase(),
                        value: latest.value,
                        paymentDate: latest.paymentDate,
                        dataCom: latest.dataCom,
                        type: latest.tipo
                    };
                }
                return null;
            });

            const data = await Promise.all(promises);
            // Remove nulos
            const cleanData = data.filter(d => d !== null);
            
            return res.status(200).json({ json: cleanData });
        }

        if (mode === 'historico_12m') {
            // Tarefa: Histórico detalhado para UM ativo (usado no modal de detalhes)
            // Payload: { ticker: 'MXRF11' }
            const { ticker } = payload;
            const history = await scrapeAsset(ticker);
            
            // Filtra últimos 12 meses (simplificado: pega os últimos 15 registros e o front trata)
            // O front espera: [{ mes: "MM/AA", valor: 0.00 }]
            
            const formattedHistory = history.slice(0, 18).map(h => {
                if (!h.paymentDate) return null;
                const [ano, mes, dia] = h.paymentDate.split('-');
                return {
                    mes: `${mes}/${ano.substring(2)}`, // Formato MM/AA
                    valor: h.value
                };
            }).filter(h => h !== null);

            return res.status(200).json({ json: formattedHistory });
        }

        if (mode === 'historico_portfolio') {
            // Tarefa: Histórico agregado para gráfico da carteira
            // Payload: { fiiList: [...] }
            // CUIDADO: Isso pode demorar se a lista for grande. 
            // Idealmente o scraping deve ser leve.
            
            const { fiiList } = payload;
            const aggregator = {}; // Chave: "MM/AA", Valor: { Ticker: Valor }

            const promises = fiiList.map(async (ticker) => {
                const history = await scrapeAsset(ticker);
                // Pega ultimos 12 pagamentos
                history.slice(0, 12).forEach(h => {
                    if (!h.paymentDate) return;
                    const [ano, mes] = h.paymentDate.split('-');
                    const mesAno = `${mes}/${ano.substring(2)}`; // MM/AA
                    
                    if (!aggregator[mesAno]) aggregator[mesAno] = { mes: mesAno };
                    aggregator[mesAno][ticker.toUpperCase()] = h.value;
                });
            });

            await Promise.all(promises);

            // Transforma objeto em array e ordena por data
            const result = Object.values(aggregator).sort((a, b) => {
                const [mesA, anoA] = a.mes.split('/');
                const [mesB, anoB] = b.mes.split('/');
                return new Date(`20${anoA}-${mesA}-01`) - new Date(`20${anoB}-${mesB}-01`);
            });

            return res.status(200).json({ json: result });
        }

        return res.status(400).json({ error: "Modo desconhecido." });

    } catch (error) {
        console.error("Erro no Scraper:", error);
        return res.status(500).json({ error: "Erro interno no servidor." });
    }
}
