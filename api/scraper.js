const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// --- CONFIGURAÇÃO DO CLIENTE HTTP ---
const httpsAgent = new https.Agent({ 
    keepAlive: true,
    maxSockets: 100,
    maxFreeSockets: 10,
    timeout: 10000
});

const client = axios.create({
    httpsAgent,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    },
    timeout: 9000
});

// --- HELPERS ---
const parseValue = (val) => {
    if (!val || typeof val !== 'string') return 0;
    const clean = val.replace('.', '').replace(',', '.').replace('%', '').replace('R$', '').trim();
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
};

const normalize = (str) => str ? str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";

// Define se é Ação, FII ou BDR para montar a URL correta
function getInvestidor10Url(ticker) {
    const t = ticker.toUpperCase().trim();
    if (t.endsWith('3') || t.endsWith('4') || t.endsWith('5') || t.endsWith('6')) return `https://investidor10.com.br/acoes/${t}/`;
    if (t.endsWith('32') || t.endsWith('33') || t.endsWith('34') || t.endsWith('35')) return `https://investidor10.com.br/bdrs/${t}/`;
    return `https://investidor10.com.br/fiis/${t}/`;
}

// --- SCRAPER DE FUNDAMENTOS ---
async function scrapeFundamentos(ticker) {
    try {
        const url = getInvestidor10Url(ticker);
        const response = await client.get(url);
        const $ = cheerio.load(response.data);

        let dados = {
            dy: 'N/A', pvp: 'N/A', pl: 'N/A', roe: 'N/A',
            segmento: 'N/A', tipo_fundo: 'N/A', mandato: 'N/A',
            vacancia: 'N/A', vp_cota: 'N/A', liquidez: 'N/A', val_mercado: 'N/A',
            patrimonio_liquido: 'N/A', variacao_12m: 'N/A', ultimo_rendimento: 'N/A',
            cnpj: 'N/A', num_cotistas: 'N/A', tipo_gestao: 'N/A', prazo_duracao: 'N/A',
            taxa_adm: 'N/A', cotas_emitidas: 'N/A'
        };

        // 1. Cards do Topo
        const plEl = $('._card.pl ._card-body span').first();
        if (plEl.length) dados.pl = plEl.text().trim();

        const roeEl = $('._card.roe ._card-body span').first();
        if (roeEl.length) dados.roe = roeEl.text().trim();

        const pvpEl = $('._card.vp ._card-body span').first();
        if (pvpEl.length) dados.pvp = pvpEl.text().trim();

        const dyEl = $('._card.dy ._card-body span').first();
        if (dyEl.length) dados.dy = dyEl.text().trim();

        const liqEl = $('._card.liquidity ._card-body span').first();
        if (liqEl.length) dados.liquidez = liqEl.text().trim();
        
        const valPatEl = $('._card.val_patrimonial ._card-body span').first();
        if (valPatEl.length) dados.vp_cota = valPatEl.text().trim();

        // 2. Varredura em Tabelas
        const processPair = (tituloRaw, valorRaw) => {
            if (!tituloRaw || !valorRaw) return;
            const titulo = normalize(tituloRaw);
            const valor = valorRaw.trim();

            if (dados.segmento === 'N/A' && titulo.includes('segmento')) dados.segmento = valor;
            if (dados.vacancia === 'N/A' && titulo.includes('vacancia')) dados.vacancia = valor;
            if (dados.val_mercado === 'N/A' && titulo.includes('mercado')) dados.val_mercado = valor;
            if (dados.ultimo_rendimento === 'N/A' && titulo.includes('ultimo rendimento')) dados.ultimo_rendimento = valor;
            if (dados.variacao_12m === 'N/A' && (titulo.includes('variacao') || titulo.includes('12m'))) dados.variacao_12m = valor;
            if (dados.cnpj === 'N/A' && titulo.includes('cnpj')) dados.cnpj = valor;
            if (dados.num_cotistas === 'N/A' && titulo.includes('cotistas')) dados.num_cotistas = valor;
            if (dados.tipo_gestao === 'N/A' && titulo.includes('gestao')) dados.tipo_gestao = valor;
            if (dados.mandato === 'N/A' && titulo.includes('mandato')) dados.mandato = valor;
            if (dados.tipo_fundo === 'N/A' && titulo.includes('tipo de fundo')) dados.tipo_fundo = valor;
            if (dados.prazo_duracao === 'N/A' && titulo.includes('prazo')) dados.prazo_duracao = valor;
            if (dados.taxa_adm === 'N/A' && titulo.includes('taxa') && titulo.includes('administracao')) dados.taxa_adm = valor;
            
            // Cotas ou Ações Emitidas
            if (dados.cotas_emitidas === 'N/A' && (titulo.includes('cotas emitidas') || titulo.includes('total de papeis') || titulo.includes('acoes emitidas'))) {
                dados.cotas_emitidas = valor;
            }
            // Patrimônio Líquido
            if (titulo.includes('patrimonio') && !titulo.includes('medio')) {
                const valNum = parseValue(valor);
                if (valNum > 5000 || valor.toLowerCase().includes('m') || valor.toLowerCase().includes('b')) {
                    if(dados.patrimonio_liquido === 'N/A') dados.patrimonio_liquido = valor;
                }
            }
        };

        $('.cell').each((i, el) => processPair($(el).find('.name').text(), $(el).find('.value').text()));
        $('table tr').each((i, row) => {
            const tds = $(row).find('td');
            if (tds.length >= 2) processPair($(tds[0]).text(), $(tds[1]).text());
        });

        return dados;
    } catch (error) {
        console.error(`Erro Fundamentos ${ticker}:`, error.message);
        return { dy: '-', pvp: '-', pl: '-', roe: '-' };
    }
}

// --- SCRAPER DE HISTÓRICO (PROVENTOS) ---
async function scrapeHistory(ticker) {
    try {
        const url = getInvestidor10Url(ticker);
        const response = await client.get(url);
        const $ = cheerio.load(response.data);
        const history = [];

        // Tenta encontrar tabela de dividendos (Funciona para FIIs e Ações no Investidor10)
        $('#table-dividends-history tbody tr').each((i, el) => {
            const cols = $(el).find('td');
            if (cols.length >= 4) {
                const tipo = $(cols[0]).text().trim();
                const comDate = $(cols[1]).text().trim();
                const payDate = $(cols[2]).text().trim();
                const valRaw = $(cols[3]).text().trim();
                
                // Converte data DD/MM/YYYY para YYYY-MM-DD
                const toIso = (d) => {
                    const parts = d.split('/');
                    return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : null;
                };

                const paymentDateIso = toIso(payDate);
                const baseDateIso = toIso(comDate);

                if (paymentDateIso && valRaw) {
                    history.push({
                        type: tipo,
                        paymentDate: paymentDateIso, // Formato YYYY-MM-DD para o app entender
                        baseDate: baseDateIso,
                        value: parseValue(valRaw)
                    });
                }
            }
        });

        return history;
    } catch (error) {
        console.error(`Erro Historico ${ticker}:`, error.message);
        return [];
    }
}

// --- HELPER PARA BATCH (Evita sobrecarga no Promise.all) ---
function chunkArray(myArray, chunk_size){
    var results = [];
    while (myArray.length) {
        results.push(myArray.splice(0, chunk_size));
    }
    return results;
}

// --- API HANDLER (O PONTO DE ENTRADA DO VERCEL) ---
export default async function handler(req, res) {
    // Permite CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { mode, ticker, fiiList } = req.body;

    try {
        // MODO 1: Fundamentos (Detalhes do Ativo)
        if (mode === 'fundamentos') {
            if (!ticker) return res.status(400).json({ error: 'Ticker ausente' });
            const data = await scrapeFundamentos(ticker);
            return res.status(200).json({ json: data });
        }

        // MODO 2: Histórico (Gráfico de Proventos)
        if (mode === 'historico') {
            if (!ticker) return res.status(400).json({ error: 'Ticker ausente' });
            const history = await scrapeHistory(ticker);
            // Formatação para o gráfico do app
            const formatted = history.map(h => {
                if (!h.paymentDate) return null;
                const [ano, mes] = h.paymentDate.split('-'); // Espera YYYY-MM-DD
                return { mes: `${mes}/${ano.substring(2)}`, valor: h.value };
            }).filter(h => h !== null);
            return res.status(200).json({ json: formatted });
        }

        // MODO 3: Histórico Portfolio (Carga em lote)
        if (mode === 'historico_portfolio') {
            if (!fiiList || !Array.isArray(fiiList)) return res.json({ json: [] });
            
            // Processa em lotes de 3 para não estourar timeout/bloqueio
            const batches = chunkArray([...fiiList], 3); 
            let all = [];
            
            for (const batch of batches) {
                const promises = batch.map(async (t) => {
                    const hList = await scrapeHistory(t);
                    // Pega apenas os últimos 24 registros para economizar banda
                    hList.slice(0, 24).forEach(h => {
                        if (h.value > 0) all.push({ symbol: t.toUpperCase(), ...h });
                    });
                });
                await Promise.all(promises);
                // Pequeno delay entre lotes
                if (batches.length > 0) await new Promise(r => setTimeout(r, 200));
            }
            return res.status(200).json({ json: all });
        }

        // MODO 4: Próximo Provento (Home)
        if (mode === 'proximo_provento') {
            if (!ticker) return res.json({ json: null });
            const history = await scrapeHistory(ticker);
            
            // Pega o futuro ou o mais recente
            const hoje = new Date();
            hoje.setHours(0,0,0,0);
            
            // Ordena por data de pagamento decrescente
            history.sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));
            
            const ultimo = history.length > 0 ? history[0] : null;
            return res.status(200).json({ json: ultimo });
        }

        return res.status(400).json({ error: "Modo desconhecido" });

    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: 'Erro interno do servidor' });
    }
}
