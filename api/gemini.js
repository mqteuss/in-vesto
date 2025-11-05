// api/gemini.js
// Esta é uma Vercel Serverless Function.
// Ela atua como um proxy seguro para a API Google Gemini.

// Função de retry otimizada com backoff exponencial
async function fetchWithBackoff(url, options, retries = 2, delay = 800) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.status === 429 || response.status >= 500) {
                throw new Error(`API Error: ${response.status} ${response.statusText}`);
            }
            if (!response.ok) {
                const errorBody = await response.json();
                throw new Error(errorBody.error?.message || `API Error: ${response.statusText}`);
            }
            return response.json();
        } catch (error) {
            if (i === retries - 1) throw error;
            const waitTime = delay * Math.pow(2, i);
            console.warn(`Tentativa ${i+1} falhou, aguardando ${waitTime}ms...`);
            await new Promise(res => setTimeout(res, waitTime));
        }
    }
}

// Constrói o payload para a API Gemini
function getGeminiPayload(mode, payload) {
    const { ticker, todayString, fiiList } = payload;
    let systemPrompt = '';
    let userQuery = '';

    switch (mode) {
        case 'proximo_provento':
            systemPrompt = `Você é um assistente financeiro especializado em FIIs brasileiros. Data atual: ${todayString}.

TAREFA: Encontre o valor e data do PRÓXIMO pagamento de provento do ${ticker}.

INSTRUÇÕES:
1. Busque apenas informações de fontes confiáveis (sites oficiais, InfoMoney, Funds Explorer)
2. O provento deve ter data de pagamento FUTURA
3. Verifique a data de aprovação/anúncio para validar

FORMATO DE RESPOSTA:
Se encontrado: "O próximo provento do ${ticker} será de R$ [VALOR] por cota, com pagamento em [DATA]."
Se não encontrado: "Nenhum provento futuro foi anunciado para ${ticker}."

Resposta concisa, sem asteriscos ou formatação markdown.`;
            userQuery = `Próximo provento ${ticker}`;
            break;

        case 'historico_12m':
            systemPrompt = `Você é um assistente financeiro especializado em FIIs brasileiros. Data atual: ${todayString}.

TAREFA: Liste os proventos dos ÚLTIMOS 12 MESES do ${ticker}.

INSTRUÇÕES:
1. Busque fontes confiáveis (Funds Explorer, InfoMoney, site do administrador)
2. Liste do mais recente ao mais antigo
3. Valores por cota, não totais

FORMATO OBRIGATÓRIO (uma linha por mês):
MM/AA: R$ VALOR
MM/AA: R$ VALOR

Exemplo:
10/25: R$ 0,10
09/25: R$ 0,10

Se não encontrar: "Não foi possível encontrar o histórico de proventos dos últimos 12 meses para ${ticker}."

Sem texto adicional, asteriscos ou markdown.`;
            userQuery = `Histórico 12 meses proventos ${ticker}`;
            break;

        case 'proventos_carteira':
            systemPrompt = `Você é um assistente financeiro especializado em FIIs brasileiros. Data atual: ${todayString}.

TAREFA: Para cada FII listado, encontre o PRÓXIMO provento (valor e data de pagamento).

INSTRUÇÕES CRÍTICAS:
1. Busque apenas proventos com data FUTURA
2. Verifique múltiplas fontes para precisão
3. Data OBRIGATORIAMENTE no formato: AAAA-MM-DD
4. Se não houver provento futuro: value=0, paymentDate=null
5. Valores são POR COTA

FORMATO DE RESPOSTA (JSON puro, sem markdown):
[
  {"symbol": "MXRF11", "value": 0.10, "paymentDate": "2025-11-14"},
  {"symbol": "HGLG11", "value": 1.10, "paymentDate": "2025-11-14"},
  {"symbol": "GARE11", "value": 0, "paymentDate": null}
]

IMPORTANTE: Responda APENAS o array JSON, sem texto adicional, sem \`\`\`, sem explicações.`;
            userQuery = `Próximos proventos: ${fiiList.join(', ')}`;
            break;

        case 'historico_portfolio':
            systemPrompt = `Você é um assistente financeiro. Data atual: ${todayString}.

TAREFA: Histórico de proventos POR COTA dos últimos 6 MESES COMPLETOS.

REGRAS OBRIGATÓRIAS:
1. NÃO incluir o mês atual (${todayString.slice(3)})
2. Valores POR COTA (não totais)
3. Se não pagou: value = 0
4. Ordenar do MÊS MAIS ANTIGO para o MAIS RECENTE
5. Formato do mês: MM/AA

FORMATO DE RESPOSTA (JSON puro):
[
  {"mes": "05/25", "MXRF11": 0.10, "GARE11": 0.08},
  {"mes": "06/25", "MXRF11": 0.10, "GARE11": 0.08},
  {"mes": "07/25", "MXRF11": 0.10, "GARE11": 0.08},
  {"mes": "08/25", "MXRF11": 0.10, "GARE11": 0},
  {"mes": "09/25", "MXRF11": 0.11, "GARE11": 0.09},
  {"mes": "10/25", "MXRF11": 0.11, "GARE11": 0.09}
]

Responda APENAS o array JSON, sem \`\`\`, sem texto adicional.`;
            userQuery = `Histórico 6 meses: ${fiiList.join(', ')}`;
            break;
            
        default:
            throw new Error("Modo de API Gemini inválido.");
    }

    return {
        contents: [{ parts: [{ text: userQuery }] }],
        tools: [{ google_search: {} }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            temperature: 0.1,  // Menor temperatura = respostas mais precisas e consistentes
            topP: 0.8,
            topK: 20,
            maxOutputTokens: mode.includes('portfolio') || mode === 'proventos_carteira' ? 2048 : 512,
        }
    };
}

// Parser otimizado de JSON
function parseJsonResponse(text) {
    try {
        // Remove markdown e espaços
        let cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        
        // Extrai apenas o array JSON
        const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        
        // Tenta parse direto como fallback
        return JSON.parse(cleaned);
    } catch (error) {
        throw new Error(`Falha ao parsear JSON: ${error.message}`);
    }
}

// Handler principal da Vercel Serverless Function
export default async function handler(request, response) {
    // CORS headers para produção
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }

    if (request.method !== 'POST') {
        return response.status(405).json({ error: "Método não permitido, use POST." });
    }

    const { GEMINI_API_KEY } = process.env;
    if (!GEMINI_API_KEY) {
        return response.status(500).json({ error: "Chave da API Gemini não configurada no servidor." });
    }
    
    // Usando modelo mais recente e eficiente
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`;

    try {
        const { mode, payload } = request.body;
        
        // Validação de entrada
        if (!mode || !payload) {
            return response.status(400).json({ error: "Parâmetros inválidos: mode e payload são obrigatórios." });
        }

        const geminiPayload = getGeminiPayload(mode, payload);

        // Faz a requisição com timeout implícito do Vercel (10s para hobby, 60s para pro)
        const result = await fetchWithBackoff(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiPayload)
        });

        const candidate = result?.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text;

        // Validação mais robusta da resposta
        if (!candidate || (candidate.finishReason !== "STOP" && candidate.finishReason !== "MAX_TOKENS")) {
            const reason = candidate?.finishReason || 'UNKNOWN';
            throw new Error(`Resposta bloqueada ou incompleta. Razão: ${reason}`);
        }

        if (!text || text.trim().length === 0) {
            throw new Error("A API retornou uma resposta vazia.");
        }
        
        // Caching otimizado por tipo de consulta
        const cacheTime = mode.includes('historico') ? 1800 : 600; // 30min para histórico, 10min para próximos
        response.setHeader('Cache-Control', `s-maxage=${cacheTime}, stale-while-revalidate=300`);

        // Processa resposta baseado no modo
        if (mode === 'proventos_carteira' || mode === 'historico_portfolio') {
            const jsonData = parseJsonResponse(text);
            
            // Validação básica do JSON
            if (!Array.isArray(jsonData) || jsonData.length === 0) {
                throw new Error("Formato de resposta JSON inválido.");
            }
            
            return response.status(200).json({ json: jsonData });
        } else {
            // Remove formatação markdown e asteriscos
            const cleanText = text.replace(/\*\*/g, '').replace(/\*/g, '').trim();
            return response.status(200).json({ text: cleanText });
        }

    } catch (error) {
        console.error("Erro no proxy Gemini:", error.message);
        
        // Respostas de erro mais específicas
        const statusCode = error.message.includes('API Error: 429') ? 429 :
                          error.message.includes('bloqueada') ? 422 : 500;
        
        return response.status(statusCode).json({ 
            error: error.message,
            mode: request.body?.mode || 'unknown'
        });
    }
}