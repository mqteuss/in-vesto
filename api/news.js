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

function getGeminiPayload(todayString) {
    // Prompt otimizado para velocidade: Direto ao ponto, sem "roleplay" desnecessário.
    const systemPrompt = `TAREFA: Retornar um JSON com as 10 notícias mais relevantes sobre FIIs (Fundos Imobiliários) no Brasil desta semana (${todayString}).
FONTES: InfoMoney, Fiis.com.br, Brazil Journal, Money Times.

FORMATO DE RESPOSTA (Strict JSON Array):
[
  {
    "title": "String",
    "summary": "String (max 3 frases)",
    "sourceName": "String",
    "sourceHostname": "String (ex: site.com.br)",
    "publicationDate": "YYYY-MM-DD",
    "relatedTickers": ["TICK11"]
  }
]`;

    const userQuery = `News FIIs week ${todayString}`;

    return {
        contents: [{ parts: [{ text: userQuery }] }],
        tools: [{ "google_search": {} }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        // OTIMIZAÇÃO DE VELOCIDADE:
        generationConfig: { 
            responseMimeType: "application/json", // Garante resposta limpa e rápida
            temperature: 0.0 // Zero criatividade = Máxima velocidade de decisão
        }
    };
}

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ error: "Use POST." });
    }

    const { NEWS_GEMINI_API_KEY } = process.env;
    if (!NEWS_GEMINI_API_KEY) {
        return response.status(500).json({ error: "Chave API ausente." });
    }

    // --- MODELO DEFINIDO: gemini-2.5-flash ---
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${NEWS_GEMINI_API_KEY}`;

    try {
        const { todayString } = request.body;
        if (!todayString) {
            return response.status(400).json({ error: "Data obrigatória." });
        }

        const geminiPayload = getGeminiPayload(todayString);

        const result = await fetchWithBackoff(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiPayload)
        });

        const candidate = result?.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text;

        if (!text) throw new Error("Resposta vazia da API.");

        // PARSE DIRETO (Sem Regex pesado)
        // Graças ao 'responseMimeType: application/json', o texto já vem limpo.
        let parsedJson;
        try {
            parsedJson = JSON.parse(text);
        } catch (e) {
            // Fallback mínimo caso o modelo ignore o mimeType (raro em flash estável)
            const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
            parsedJson = JSON.parse(cleanText);
        }

        if (!Array.isArray(parsedJson)) {
            // Tratamento para caso o modelo devolva { "news": [...] }
            const keys = Object.keys(parsedJson);
            if (keys.length === 1 && Array.isArray(parsedJson[keys[0]])) {
                parsedJson = parsedJson[keys[0]];
            } else {
                // Tenta forçar um array se for um objeto único
                parsedJson = [parsedJson];
            }
        }

        // Cache para evitar requisições repetidas
        response.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate');
        return response.status(200).json({ json: parsedJson });

    } catch (error) {
        console.error("Erro API News:", error);
        return response.status(500).json({ error: error.message });
    }
}
