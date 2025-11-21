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
    // Prompt otimizado para ser direto
    const systemPrompt = `Você é um agregador de notícias financeiras ultra-rápido.
TAREFA: Buscar e resumir 10 notícias sobre FIIs (Fundos Imobiliários) do Brasil desta semana (${todayString}).

REQUISITOS JSON (Strict):
Retorne APENAS um array JSON com objetos contendo:
- title (String)
- summary (String, máx 3 frases)
- sourceName (String)
- sourceHostname (String, domínio obrigatório)
- publicationDate (YYYY-MM-DD)
- relatedTickers (Array de Strings)

Fontes sugeridas: InfoMoney, Fiis.com.br, Brazil Journal, Money Times.`;

    const userQuery = `Notícias FIIs semana ${todayString}. JSON Array output.`;

    return {
        contents: [{ parts: [{ text: userQuery }] }],
        tools: [{ "google_search": {} }], // Busca conectada para dados reais
        systemInstruction: { parts: [{ text: systemPrompt }] },
        // CONFIGURAÇÃO DE VELOCIDADE (Gemini 2.0 / 3):
        // 1. responseMimeType: Garante JSON puro sem precisar de regex complexo.
        // 2. Não ativamos 'thinking' pois queremos velocidade pura.
        generationConfig: { 
            responseMimeType: "application/json",
            temperature: 0.1 // Temperatura baixa para respostas mais rápidas e diretas
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

    // MODELO OTIMIZADO: Usamos o 'flash-exp' que é a versão de velocidade da nova geração.
    // Se você tiver acesso exato ao 'gemini-3-pro-preview', pode trocar aqui, 
    // mas o '2.0-flash-exp' é geralmente o mais rápido para tasks simples.
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${NEWS_GEMINI_API_KEY}`;

    try {
        const { todayString } = request.body;
        if (!todayString) {
            return response.status(400).json({ error: "Data obrigatória." });
        }

        const geminiPayload = getGeminiPayload(todayString);

        // Request direto para a API
        const result = await fetchWithBackoff(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiPayload)
        });

        // Tratamento Otimizado com JSON Mode
        // Como ativamos 'application/json' no config, o modelo deve retornar JSON limpo.
        const candidate = result?.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text;

        if (!text) throw new Error("Resposta vazia da API.");

        let parsedJson;
        try {
            parsedJson = JSON.parse(text);
            // Garante que é array, se vier dentro de um objeto, extrai.
            if (!Array.isArray(parsedJson)) {
                parsedJson = parsedJson.news || parsedJson.articles || []; 
                if (!Array.isArray(parsedJson)) parsedJson = [parsedJson];
            }
        } catch (e) {
            // Fallback de segurança leve caso o JSON Mode falhe
            const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
            const match = cleanText.match(/\[.*\]/s);
            if (match) parsedJson = JSON.parse(match[0]);
            else throw new Error("Falha no parse JSON.");
        }

        // Cache agressivo na Vercel (6 horas) para economizar tokens e tempo
        response.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate');
        return response.status(200).json({ json: parsedJson });

    } catch (error) {
        console.error("Erro API News:", error);
        return response.status(500).json({ error: error.message });
    }
}
