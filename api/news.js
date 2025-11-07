// api/news.js
// Esta é uma Vercel Serverless Function.
// Ela usa a API Gemini com a chave NEWS_GEMINI_API_KEY e Web Search
// para buscar um JSON de resumos de notícias, incluindo o hostname da fonte.

// Função de retry (backoff) para o servidor
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

// Constrói o payload para a API Gemini (Modo JSON de Resumos com Hostname)
function getGeminiPayload(todayString) {

    // *** PROMPT ATUALIZADO (Pontos 1, 2, 4, 5) ***
    const systemPrompt = `Você é um editor de notícias financeiras. Sua tarefa é encontrar as 10 notícias mais recentes e relevantes sobre FIIs (Fundos Imobiliários) no Brasil, publicadas **nesta semana** (data de hoje: ${todayString}).

REGRAS:
1.  Encontre artigos de portais de notícias conhecidos (ex: InfoMoney, Fiis.com.br, Seu Dinheiro, Money Times).
2.  Responda APENAS com um array JSON válido. Não inclua \`\`\`json ou qualquer outro texto.
3.  Cada objeto no array deve conter 5 campos:
    - "title": O título exato ou ligeiramente abreviado da notícia.
    - "summary": Um resumo da notícia com 2 ou 3 frases (ligeiramente maior).
    - "sourceName": O nome do portal (ex: "InfoMoney").
    - "sourceHostname": O domínio raiz da fonte (ex: "infomoney.com.br"). ESTE CAMPO É OBRIGATÓRIO.
    - "publicationDate": A data da publicação no formato YYYY-MM-DD.

EXEMPLO DE RESPOSTA JSON:
[
  {"title": "IFIX atinge nova máxima: O que esperar?", "summary": "O IFIX atingiu nova máxima histórica nesta semana. Analistas debatem se o movimento é sustentável ou se uma correção está próxima, de olho na Selic.", "sourceName": "InfoMoney", "sourceHostname": "infomoney.com.br", "publicationDate": "2025-11-06"},
  {"title": "HGLG11 anuncia compra de R$ 63 milhões", "summary": "O fundo HGLG11 investiu R$ 63 milhões na aquisição de galpões logísticos. A gestão afirma que a aquisição fortalece o portfólio na região de Itupeva (SP).", "sourceName": "Money Times", "sourceHostname": "moneytimes.com.br", "publicationDate": "2025-11-05"}
]`;

    const userQuery = `Gere um array JSON com os 10 resumos de notícias mais recentes (desta semana, ${todayString}) sobre FIIs. Inclua "title", "summary", "sourceName", "sourceHostname" e "publicationDate" (YYYY-MM-DD).`;

    return {
        contents: [{ parts: [{ text: userQuery }] }],
        tools: [{ "google_search": {} }], 
        systemInstruction: { parts: [{ text: systemPrompt }] },
    };
}

// Handler principal da Vercel Serverless Function
export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ error: "Método não permitido, use POST." });
    }

    const { NEWS_GEMINI_API_KEY } = process.env;
    if (!NEWS_GEMINI_API_KEY) {
        return response.status(500).json({ error: "Chave NEWS_GEMINI_API_KEY não configurada no servidor." });
    }

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

        if (candidate?.finishReason !== "STOP" && candidate?.finishReason !== "MAX_TOKSENS") {
             if (candidate?.finishReason) {
                 throw new Error(`A resposta foi bloqueada. Razão: ${candidate.finishReason}`);
             }
        }
        if (!text) {
            throw new Error("A API retornou uma resposta vazia.");
        }

        // CACHE DE 6 HORAS (21600 segundos)
        response.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate');

        // *** VALIDAÇÃO DE SEGURANÇA ***
        let jsonText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonMatch = jsonText.match(/\[.*\]/s); 

        let parsedJson;

        if (jsonMatch && jsonMatch[0]) {
            jsonText = jsonMatch[0];
            parsedJson = JSON.parse(jsonText);
        } else {
            parsedJson = JSON.parse(jsonText);
        }

        if (Array.isArray(parsedJson)) {
            return response.status(200).json({ json: parsedJson });
        } else {
            console.warn("Gemini retornou um JSON válido, mas não era um array:", parsedJson);
            throw new Error("A API retornou um formato de dados inesperado.");
        }
        // *** FIM DA VALIDAÇÃO ***

    } catch (error) {
        console.error("Erro interno no proxy Gemini (Notícias):", error);
        return response.status(500).json({ error: `Erro interno no servidor: ${error.message}` });
    }
}