// api/gemini.js
// Vercel Serverless Function - Proxy Otimizado para Google Gemini

async function fetchWithBackoff(url, options, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            
            // Lida com Rate Limits (429) e Erros de Servidor (500+)
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
            console.warn(`Tentativa ${i+1} falhou, aguardando ${delay * (i + 1)}ms...`);
            await new Promise(res => setTimeout(res, delay * (i + 1)));
        }
    }
}

function getGeminiPayload(mode, payload) {
    const { ticker, todayString, fiiList } = payload;
    let systemPrompt = '';
    let userQuery = '';

    // Instrução base para todos os modos
    const baseInstruction = `Você é um especialista em FIIs (Fundos Imobiliários). Data de hoje: ${todayString}. Use a Google Search para dados atualizados.`;

    switch (mode) {
        case 'historico_12m':
            systemPrompt = `${baseInstruction}
Tarefa: Obter histórico de proventos dos últimos 12 meses do FII ${ticker}.
Output: Array JSON ordenado do mais recente para o antigo.
Formato: [{"mes": "MM/AA", "valor": 0.00}]
Se vazio: []`;
            userQuery = `Histórico de proventos (últimos 12 meses) para ${ticker}.`;
            break;

        case 'proventos_carteira':
            systemPrompt = `${baseInstruction}
Tarefa: Encontrar o provento mais recente OFICIALMENTE ANUNCIADO (pagamento hoje ou futuro) para a lista de FIIs.
Regras Críticas:
1. Verifique Fatos Relevantes de hoje (${todayString}) para correções de data.
2. Se um provento futuro NÃO foi anunciado oficialmente, retorne valor 0 e data null. NÃO projete.
3. Data no formato AAAA-MM-DD.

Formato de Output:
[
  {"symbol": "TICKER11", "value": 0.00, "paymentDate": "YYYY-MM-DD" (ou null)}
]`;
            userQuery = `Proventos oficiais (hoje ou futuros) para: ${fiiList.join(', ')}. Verifique comunicados oficiais.`;
            break;

        case 'historico_portfolio':
            systemPrompt = `${baseInstruction}
Tarefa: Histórico de proventos por cota dos últimos 6 meses completos (EXCLUINDO o mês atual).
Output: Array JSON ordenado do mais antigo para o recente.
Se um FII não pagou, valor é 0.
Formato: [{"mes": "MM/AA", "TICKER11": 0.10, "TICKER22": 0.00}]`;
            userQuery = `Histórico 6 meses passados (sem mês atual) para: ${fiiList.join(', ')}.`;
            break;

        default:
            throw new Error("Modo inválido.");
    }

    return {
        contents: [{ parts: [{ text: userQuery }] }],
        tools: [{ "google_search": {} }], 
        
        // OTIMIZAÇÃO: Configuração de Geração
        generationConfig: {
            temperature: 0.1, // Baixa criatividade, foco em dados
            responseMimeType: "application/json" // FORÇA resposta JSON válida
        },
        
        systemInstruction: { parts: [{ text: systemPrompt }] },
    };
}

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ error: "Use POST." });
    }

    const { GEMINI_API_KEY } = process.env;
    if (!GEMINI_API_KEY) {
        return response.status(500).json({ error: "API Key não configurada." });
    }

    // URL do modelo (mantido o 2.5 conforme seu código original, mas funciona bem com 1.5-flash também)
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`;

    try {
        const { mode, payload } = request.body;
        
        if (!payload || !payload.todayString) {
             return response.status(400).json({ error: "Payload incompleto (missing todayString)." });
        }

        const geminiPayload = getGeminiPayload(mode, payload);

        const result = await fetchWithBackoff(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiPayload)
        });

        const candidate = result?.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text;

        if (!text) {
            // Verifica se foi bloqueado por segurança
            if (candidate?.finishReason && candidate.finishReason !== "STOP") {
                throw new Error(`Bloqueio API: ${candidate.finishReason}`);
            }
            throw new Error("API retornou resposta vazia.");
        }

        // OTIMIZAÇÃO: Cache agressivo para leitura (24h)
        response.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate'); 

        // OTIMIZAÇÃO: Parsing direto.
        // Como usamos responseMimeType: "application/json", não precisamos de regex complexo.
        try {
            const parsedJson = JSON.parse(text);
            
            // Garante que seja sempre um array, mesmo que a API devolva um objeto único
            const finalJson = Array.isArray(parsedJson) ? parsedJson : [parsedJson];
            
            return response.status(200).json({ json: finalJson });
            
        } catch (parseError) {
            console.error("Erro de Parse JSON (mesmo com JSON mode):", text);
            // Fallback de segurança: retorna array vazio em vez de erro 500 para não quebrar o front
            return response.status(200).json({ json: [] });
        }

    } catch (error) {
        console.error("Erro handler Gemini:", error);
        return response.status(500).json({ error: error.message });
    }
}
