// api.js

// Importa dependências de outros módulos
import { isFII, isB3Open, parseMesAno } from './utils.js';
import { setCache, getCache, CACHE_PREFIX, CACHE_24_HORAS, CACHE_6_HORAS } from './cache.js';

// ==========================================================
// Wrapper de Fetch (Privado)
// ==========================================================

/** Wrapper de Fetch para o BFF com timeout (usado apenas dentro deste módulo) */
async function fetchBFF(url, options = {}) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); 
        
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeoutId); 

        if (!response.ok) {
            const errorBody = await response.json();
            throw new Error(errorBody.error || `Erro do servidor: ${response.statusText}`);
        }
        return response.json();
    } catch (error) {
        if (error.name === 'AbortError') {
            console.error(`Erro ao chamar o BFF ${url}:`, "Timeout de 30s excedido");
            throw new Error("O servidor demorou muito para responder.");
        }
        console.error(`Erro ao chamar o BFF ${url}:`, error);
        throw error;
    }
}

// ==========================================================
// Funções de API Exportadas
// ==========================================================

/** Verifica se um ativo existe na API (usado no Add/Detalhes) */
export async function verificarAtivo(tickerParaApi) {
    return fetchBFF(`/api/brapi?path=/quote/${tickerParaApi}?range=1d&interval=1d`);
}

/** Busca o JSON de resumos de notícias */
export async function fetchNoticiasBFF(todayString, force = false) {
    const cacheKey = CACHE_PREFIX + 'noticias_json_v4';
    if (force) {
        localStorage.removeItem(cacheKey);
    }
    
    const cache = getCache(cacheKey);
    if (cache) {
        return cache; 
    }
    try {
        const response = await fetchBFF('/api/news', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ todayString: todayString }) 
        });
        const articles = response.json;
        if (articles && Array.isArray(articles)) {
            setCache(cacheKey, articles, CACHE_6_HORAS);
        }
        return articles;
    } catch (error) {
        console.error("Erro ao buscar notícias (BFF):", error);
        throw error;
    }
}

/** Busca preços, usando cache individual por ativo */
export async function buscarPrecosCarteira(carteira, force = false) { 
    if (carteira.length === 0) return [];
    console.log("A buscar preços na API (cache por ativo)...");
    
    const promessas = carteira.map(async (ativo) => {
        const cacheKey = `preco_${ativo.symbol}`;
        if (force) {
            localStorage.removeItem(cacheKey);
        }
        
        if (!force) {
            const precoCache = getCache(cacheKey);
            if (precoCache && !isB3Open()) return precoCache;
            if (precoCache) return precoCache;
        }
        try {
            const tickerParaApi = isFII(ativo.symbol) ? `${ativo.symbol}.SA` : ativo.symbol;
            const data = await fetchBFF(`/api/brapi?path=/quote/${tickerParaApi}?range=1d&interval=1d`);
            const result = data.results?.[0];

            if (result && !result.error) {
                if (result.symbol.endsWith('.SA')) result.symbol = result.symbol.replace('.SA', '');
                setCache(cacheKey, result); 
                return result;
            } else {
                console.warn(`Ativo ${tickerParaApi} retornou erro ou sem dados.`);
                return null;
            }
        } catch (err) {
            console.error(`Erro ao buscar preço para ${ativo.symbol}:`, err);
            return null;
        }
    });
    const resultados = await Promise.all(promessas);
    return resultados.filter(p => p !== null);
}

/** Filtra proventos da IA para datas futuras */
export function processarProventosIA(proventosDaIA = [], carteira) {
    const hoje = new Date(); 
    hoje.setHours(0, 0, 0, 0);
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    return proventosDaIA
        .map(proventoIA => {
            const ativoCarteira = carteira.find(a => a.symbol === proventoIA.symbol);
            if (!ativoCarteira) return null;
            
            if (proventoIA.paymentDate && typeof proventoIA.value === 'number' && proventoIA.value > 0 && dateRegex.test(proventoIA.paymentDate)) {
                const parts = proventoIA.paymentDate.split('-');
                const dataPagamento = new Date(parts[0], parts[1] - 1, parts[2]); 
                
                // Apenas futuros (igual ou depois de hoje)
                if (!isNaN(dataPagamento) && dataPagamento >= hoje) {
                    return proventoIA;
                }
            }
            return null; 
        })
        .filter(p => p !== null);
}

/** Busca proventos futuros, usando cache individual por FII */
export async function buscarProventosFuturos(carteira, todayString, force = false) {
    const fiiNaCarteira = carteira
        .filter(a => isFII(a.symbol))
        .map(a => a.symbol);
        
    if (fiiNaCarteira.length === 0) {
        return { proventosPool: [], novosParaSalvar: [] };
    }

    let proventosPool = []; // Pool de proventos para filtrar
    let fiisParaBuscar = [];
    let novosParaSalvar = []; // Lista de proventos novos encontrados

    // 1. Processa o que já está em cache
    for (const symbol of fiiNaCarteira) {
        const cacheKey = `provento_ia_${symbol}`;
        if (force) {
            localStorage.removeItem(cacheKey);
        }
        
        const proventoCache = getCache(cacheKey);
        if (proventoCache) {
            proventosPool.push(proventoCache);
        } else {
            fiisParaBuscar.push(symbol);
        }
    }
    
    console.log("Proventos em cache (para filtrar):", proventosPool.map(p => p.symbol));
    console.log("Proventos para buscar (API):", fiisParaBuscar);

    // 2. Busca novos na API
    if (fiisParaBuscar.length > 0) {
        try {
            const novosProventos = await callGeminiProventosCarteiraAPI(fiisParaBuscar, todayString);
            
            if (novosProventos && Array.isArray(novosProventos)) {
                for (const provento of novosProventos) {
                    if (provento && provento.symbol && provento.paymentDate) {
                        const cacheKey = `provento_ia_${provento.symbol}`;
                        setCache(cacheKey, provento, CACHE_24_HORAS); 
                        proventosPool.push(provento); // Adiciona ao pool de processamento
                        novosParaSalvar.push(provento); // Adiciona à lista para salvar
                    }
                }
            }
        } catch (error) {
            console.error("Erro ao buscar novos proventos com IA:", error);
        }
    }
    
    // 3. Retorna o pool (para processamento) e a lista de novos (para salvar)
    return { proventosPool, novosParaSalvar };
}

/** Busca o histórico de proventos agregados para o gráfico */
export async function buscarHistoricoProventosAgregado(carteira, todayString, force = false) {
    const fiiNaCarteira = carteira.filter(a => isFII(a.symbol));
    if (fiiNaCarteira.length === 0) return { labels: [], data: [] };

    const fiiSymbols = fiiNaCarteira.map(a => a.symbol);
    const cacheKey = 'hist_agregado_v4_' + fiiSymbols.join('-');
    
    if (force) {
        localStorage.removeItem(cacheKey);
    }
    
    const cache = getCache(cacheKey);
    let aiData;

    if (cache) {
        aiData = cache;
    } else {
        try {
            aiData = await callGeminiHistoricoPortfolioAPI(fiiSymbols, todayString);
            if (aiData && aiData.length > 0) {
                setCache(cacheKey, aiData, CACHE_24_HORAS);
            }
        } catch (e) {
            console.error("Erro ao buscar histórico agregado:", e);
            return { labels: [], data: [] }; 
        }
    }

    if (!aiData || aiData.length === 0) return { labels: [], data: [] };

    const carteiraMap = new Map(fiiNaCarteira.map(a => [a.symbol, { 
        quantity: a.quantity, 
        inicioMesCompra: new Date(new Date(a.dataCompra).setDate(1)).setHours(0, 0, 0, 0)
    }]));
    
    const labels = aiData.map(d => d.mes);
    const data = aiData.map(mesData => {
        let totalMes = 0;
        const dataDoMes = parseMesAno(mesData.mes); 
        
        if (!dataDoMes) return 0;
        const timeDoMes = dataDoMes.getTime();

        fiiSymbols.forEach(symbol => {
            const ativo = carteiraMap.get(symbol);
            if (!ativo) return; 

            const quantity = ativo.quantity;
            const inicioMesCompraTime = ativo.inicioMesCompra;
            const valorPorCota = mesData[symbol] || 0;
            
            if (timeDoMes >= inicioMesCompraTime) {
                 totalMes += (valorPorCota * quantity);
            }
        });
        return totalMes;
    });

    return { labels, data };
}

// ==========================================================
// Funções da API Gemini (BFF)
// ==========================================================

export async function callGeminiHistoricoAPI(ticker, todayString) {
    const body = { mode: 'historico_12m', payload: { ticker, todayString } };
    const response = await fetchBFF('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return response.text; // Retorna o texto formatado
}

export async function callGeminiProventosCarteiraAPI(fiiList, todayString) {
    const body = { mode: 'proventos_carteira', payload: { fiiList, todayString } };
    const response = await fetchBFF('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return response.json; // Retorna um array JSON
}

export async function callGeminiHistoricoPortfolioAPI(fiiList, todayString) {
     const body = { mode: 'historico_portfolio', payload: { fiiList, todayString } };
     const response = await fetchBFF('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return response.json; // Retorna um array JSON
}