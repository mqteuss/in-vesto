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
2.  Responda APENAS com um array JSON válido. Não inclua \`\`\`json ou qualquer outro texto.
3.  Cada objeto no array deve conter 6 campos:
    - "title": O título exato ou ligeiramente abreviado da notícia.
    - "summary": Um resumo da notícia com 4 frases (ligeiramente maior).
    - "sourceName": O nome do portal (ex: "InfoMoney").
    - "sourceHostname": O domínio raiz da fonte (ex: "infomoney.com.br"). ESTE CAMPO É OBRIGATÓRIO.
    - "publicationDate": A data da publicação no formato YYYY-MM-DD.
    - "relatedTickers": Um array de strings com os tickers de FIIs (ex: "MXRF11", "HGLG11") mencionados no título ou resumo. Se nenhum for mencionado, retorne um array vazio [].

EXEMPLO DE RESPOSTA JSON:
[
  {"title": "IFIX atinge nova máxima: O que esperar?", "summary": "O IFIX atiu nova máxima histórica nesta semana. Analistas debatem se o movimento é sustentável ou se uma correção está próxima, de olho na Selic.", "sourceName": "InfoMoney", "sourceHostname": "infomoney.com.br", "publicationDate": "2025-11-06", "relatedTickers": []},
  {"title": "HGLG11 e CPTS11 anunciam aquisições", "summary": "O fundo HGLG11 investiu R$ 63 milhões em galpões. Já o CPTS11 anunciou uma nova emissão.", "sourceName": "Money Times", "sourceHostname": "moneytimes.com.br", "publicationDate": "2025-11-05", "relatedTickers": ["HGLG11", "CPTS11"]}
]

IMPORTANTE: Sua resposta DEVE começar com '[' e terminar com ']'. Nenhuma outra palavra, frase ou formatação é permitida antes ou depois do array JSON.`;

    const userQuery = `Gere um array JSON com os 10 resumos de notícias mais recentes (desta semana, ${todayString}) sobre FIIs. Inclua "title", "summary", "sourceName", "sourceHostname", "publicationDate" (YYYY-MM-DD) e "relatedTickers" (array de FIIs mencionados).`;

    return {
        contents: [{ parts: [{ text: userQuery }] }],
        tools: [{ "google_search": {} }], 
        systemInstruction: { parts: [{ text: systemPrompt }] },
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

    // ATUALIZADO: Usando o alias genérico para a versão 2.5 Flash
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${NEWS_GEMINI_API_KEY}`;

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

        // CORREÇÃO: Typo corrigido de 'MAX_TOKSENS' para 'MAX_TOKENS'
        if (candidate?.finishReason !== "STOP" && candidate?.finishReason !== "MAX_TOKENS") {
             if (candidate?.finishReason) {
                 throw new Error(`A resposta foi bloqueada. Razão: ${candidate.finishReason}`);
             }
        }
        if (!text) {
            throw new Error("A API retornou uma resposta vazia.");
        }

        response.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate');

        let jsonText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonMatch = jsonText.match(/\[.*\]/s);

        let parsedJson;

        if (jsonMatch && jsonMatch[0]) {
            try {
                parsedJson = JSON.parse(jsonMatch[0]);
            } catch (e) {
                console.error("Erro ao fazer parse do JSON encontrado (match):", e.message);
                throw new Error(`Erro interno ao processar JSON: ${e.message}`);
            }
        } else {
            try {
                 parsedJson = JSON.parse(jsonText);
                 if (!Array.isArray(parsedJson)) {
                     throw new Error("API retornou um JSON válido, mas não um array.");
                 }
            } catch (e) {
                console.warn("[Alerta API News] A API retornou texto em vez de JSON:", jsonText);
                throw new Error(`A API de notícias retornou texto inesperado: ${jsonText.substring(0, 50)}...`);
            }
        }

        return response.status(200).json({ json: parsedJson });

    } catch (error) {
        console.error("Erro interno no proxy Gemini (Notícias):", error);
        return response.status(500).json({ error: `Erro interno no servidor: ${error.message}` });
    }
}
