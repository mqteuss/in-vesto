// gemini.js
async function fetchWithBackoff(url, options, retries = 3, delay = 1000) {
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
            console.warn(`Tentativa ${i+1} falhou, aguardando ${delay * (i + 1)}ms...`);
            await new Promise(res => setTimeout(res, delay * (i + 1)));
        }
    }
}

function getGeminiPayload(mode, payload) {
    const { ticker, todayString, fiiList } = payload;
    let systemPrompt = '';
    let userQuery = '';

    const baseInstruction = `Data de hoje: ${todayString}. Use Google Search. Output: APENAS JSON.`;

    switch (mode) {
        case 'historico_12m':
            systemPrompt = `Tarefa: Histórico de proventos (últimos 12 meses) do FII ${ticker}.
${baseInstruction}
Output: Array JSON [{"mes": "MM/AA", "valor": 0.00}] ordenado do mais recente para o antigo.`;
            userQuery = `JSON histórico 12 meses para ${ticker}.`;
            break;

        case 'proventos_carteira':
            // --- CORREÇÃO AQUI: Adicionado campo dataCom ---
            systemPrompt = `Tarefa: Encontrar o provento mais recente OFICIALMENTE ANUNCIADO (hoje ou futuro) para a lista de FIIs.
${baseInstruction}
Regras:
1. Verifique fatos relevantes de hoje (${todayString}).
2. Identifique a 'Data Com' (data base/record date).
3. Se não houver anúncio oficial futuro, retorne value: 0 e paymentDate: null.
4. Formato: [{"symbol": "ABCD11", "value": 0.00, "paymentDate": "YYYY-MM-DD", "dataCom": "YYYY-MM-DD"}]`;
            userQuery = `JSON proventos oficiais (hoje/futuro) com Data Com para: ${fiiList.join(', ')}.`;
            break;

        case 'historico_portfolio':
            systemPrompt = `Tarefa: Histórico de proventos por cota dos últimos 6 meses completos (EXCLUINDO o mês atual).
${baseInstruction}
Output: Array JSON [{"mes": "MM/AA", "FII11": 0.10, "FII22": 0.00}] ordenado do antigo para o recente.`;
            userQuery = `JSON histórico 6 meses passados (sem mês atual) para: ${fiiList.join(', ')}.`;
            break;

        default:
            throw new Error("Modo inválido.");
    }

    return {
        contents: [{ parts: [{ text: userQuery }] }],
        tools: [{ "google_search": {} }],
        generationConfig: { temperature: 0.1 },
        systemInstruction: { parts: [{ text: systemPrompt }] },
    };
}

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ error: "Método não permitido, use POST." });
    }

    const { GEMINI_API_KEY } = process.env;
    if (!GEMINI_API_KEY) {
        return response.status(500).json({ error: "Chave GEMINI_API_KEY não configurada no servidor." });
    }

    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    try {
        const { mode, payload } = request.body;

        if (!payload || !payload.todayString) {
            return response.status(400).json({ error: "Parâmetro 'todayString' é obrigatório." });
        }

        const geminiPayload = getGeminiPayload(mode, payload);

        const result = await fetchWithBackoff(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiPayload)
        }, 3, 1000);

        const candidate = result?.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text;

        if (candidate?.finishReason !== "STOP" && candidate?.finishReason !== "MAX_TOKENS") {
             if (candidate?.finishReason) {
                 throw new Error(`A resposta foi bloqueada. Razão: ${candidate.finishReason}`);
             }
        }
        if (!text) {
            throw new Error("A API retornou uma resposta vazia.");
        }

        response.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');

        let jsonText = text.replace(/```json/g, '').replace(/```/g, '').trim();

        let parsedJson;
        try {
             parsedJson = JSON.parse(jsonText);
        } catch (e) {
             const jsonMatch = jsonText.match(/\[.*\]/s);
             if (jsonMatch) {
                 try {
                    parsedJson = JSON.parse(jsonMatch[0]);
                 } catch (innerE) {
                    console.warn("Falha ao processar JSON extraído, retornando vazio.");
                    return response.status(200).json({ json: [] });
                 }
             } else {
                 console.warn("JSON inválido na resposta, retornando vazio.");
                 return response.status(200).json({ json: [] });
             }
        }

        if (!Array.isArray(parsedJson)) {
            parsedJson = [parsedJson]; 
        }

        return response.status(200).json({ json: parsedJson });

    } catch (error) {
        console.error("Erro interno no proxy Gemini:", error);
        return response.status(500).json({ error: `Erro interno no servidor: ${error.message}` });
    }
}