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

    const systemPrompt = `Você é um editor de notícias financeiras. Sua tarefa é encontrar as 10 notícias mais recentes e relevantes sobre FIIs (Fundos Imobiliários) no Brasil, publicadas **nesta semana** (data de hoje: ${todayString}).

REGRAS:
1.  Encontre artigos de portais de notícias conhecidos (ex: InfoMoney, Fiis.com.br, Seu Dinheiro, Money Times).
2.  Responda APENAS com um array JSON válido, respeitando o esquema solicitado.
3.  Cada objeto no array deve conter 6 campos:
    - "title": O título exato ou ligeiramente abreviado da notícia.
    - "summary": Um resumo da notícia com 4 frases (ligeiramente maior).
    - "sourceName": O nome do portal (ex: "InfoMoney").
    - "sourceHostname": O domínio raiz da fonte (ex: "infomoney.com.br"). ESTE CAMPO É OBRIGATÓRIO.
    - "publicationDate": A data da publicação no formato YYYY-MM-DD.
    - "relatedTickers": Um array de strings com os tickers de FIIs (ex: "MXRF11", "HGLG11") mencionados no título ou resumo. Se nenhum for mencionado, retorne um array vazio [].
`;

    const userQuery = `Gere um array JSON com os 10 resumos de notícias mais recentes (desta semana, ${todayString}) sobre FIIs. Inclua "title", "summary", "sourceName", "sourceHostname", "publicationDate" (YYYY-MM-DD) e "relatedTickers" (array de FIIs mencionados).`;

    return {
        contents: [{ parts: [{ text: userQuery }] }],
        tools: [{ "google_search": {} }], 
        systemInstruction: { parts: [{ text: systemPrompt }] },
        // ADIÇÃO DO PASSO 2: JSON Mode Ativado
        generationConfig: { 
            responseMimeType: "application/json" 
        }
    };
}

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ error: "Método não permitido, use POST." });
    }

    const { NEWS_GEMINI_API_KEY } = process.env;
    if (!NEWS_GEMINI_API_KEY) {
        return response.status(500).json({ error: "Chave NEWS_GEMINI_API_KEY não configurada no servidor." });
    }

    // Versão mantida conforme sua solicitação
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${NEWS_GEMINI_API_KEY}`;

    try {
        const { todayString } = request.body;
        if (!todayString) {
            return response.status(400).json({ error: "Parâmetro 'todayString' é obrigatório." });
        }

        const geminiPayload = getGeminiPayload(todayString);

        const result = await fetchWithBackoff(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiPayload)
        });

        const candidate = result?.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text;

        // CORREÇÃO DO TYPO: MAX_TOKENS
        if (candidate?.finishReason !== "STOP" && candidate?.finishReason !== "MAX_TOKENS") {
             if (candidate?.finishReason) {
                 throw new Error(`A resposta foi bloqueada. Razão: ${candidate.finishReason}`);
             }
        }
        if (!text) {
            throw new Error("A API retornou uma resposta vazia.");
        }

        response.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate');

        let parsedJson;

        try {
            // Com o JSON Mode, a API deve retornar JSON puro.
            // No entanto, mantemos uma limpeza básica por segurança caso o modelo ainda inclua formatação markdown.
            const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
            parsedJson = JSON.parse(cleanText);

            if (!Array.isArray(parsedJson)) {
                 // Caso o modelo retorne um objeto { "news": [...] } em vez de direto o array
                 if (parsedJson.news && Array.isArray(parsedJson.news)) {
                     parsedJson = parsedJson.news;
                 } else {
                     throw new Error("O JSON retornado não é um array como esperado.");
                 }
            }
        } catch (e) {
            console.warn("[Alerta API News] Falha ao processar JSON:", text);
            throw new Error(`A API retornou dados inválidos: ${e.message}`);
        }

        return response.status(200).json({ json: parsedJson });

    } catch (error) {
        console.error("Erro interno no proxy Gemini (Notícias):", error);
        return response.status(500).json({ error: `Erro interno no servidor: ${error.message}` });
    }
}
