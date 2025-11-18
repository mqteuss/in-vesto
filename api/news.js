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

    const systemPrompt = `Você é um editor de notícias financeiras sênior. Sua tarefa é encontrar as 10 notícias mais recentes e impactantes sobre FIIs (Fundos Imobiliários) no Brasil, publicadas **nesta semana** (data de referência: ${todayString}).

REGRAS ESTRITAS:
1.  USE A FERRAMENTA DE BUSCA: Você DEVE usar o Google Search para encontrar fatos reais e atuais.
2.  FONTES: Priorize portais como InfoMoney, Fiis.com.br, Brazil Journal, Valor Econômico, Money Times.
3.  FORMATO: Responda APENAS com um JSON puro. Sem Markdown (\`\`\`json), sem introduções.
4.  ESTRUTURA DO JSON (Array de objetos):
    - "title": Título claro e direto.
    - "summary": Resumo informativo de 3 a 4 linhas.
    - "sourceName": Nome do portal (ex: "Brazil Journal").
    - "sourceHostname": Domínio raiz (ex: "braziljournal.com"). OBRIGATÓRIO.
    - "publicationDate": Data no formato YYYY-MM-DD.
    - "relatedTickers": Array com tickers (ex: "KNIP11") citados. Se nenhum, use [].

IMPORTANTE: Garanta que as notícias sejam desta semana. Se não houver 10 fatos relevantes, retorne menos, mas não invente.`;

    const userQuery = `Liste as principais notícias de FIIs desta semana (hoje é ${todayString}) em formato JSON array.`;

    return {
        contents: [{ parts: [{ text: userQuery }] }],
        // A ferramenta de busca é nativa e otimizada no Gemini 2.0 Flash
        tools: [{ "google_search": {} }], 
        systemInstruction: { parts: [{ text: systemPrompt }] },
        // Configurações para garantir JSON e evitar criatividade excessiva
        generationConfig: {
            temperature: 0.3, 
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

    // ATUALIZAÇÃO: Usando gemini-2.0-flash para melhor balanceamento de Busca + Velocidade + Quota
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${NEWS_GEMINI_API_KEY}`;

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

        if (candidate?.finishReason !== "STOP" && candidate?.finishReason !== "MAX_TOKENS") {
             if (candidate?.finishReason) {
                 throw new Error(`A resposta foi bloqueada. Razão: ${candidate.finishReason}`);
             }
        }
        if (!text) {
            throw new Error("A API retornou uma resposta vazia.");
        }

        // Cache agressivo para economizar chamadas (6 horas)
        response.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate');

        // Limpeza de segurança caso a IA mande Markdown mesmo com responseMimeType definido
        let jsonText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        
        let parsedJson;
        try {
             parsedJson = JSON.parse(jsonText);
             
             // Validação básica
             if (!Array.isArray(parsedJson)) {
                 // Tenta corrigir se a IA devolveu { "news": [...] } em vez de [...]
                 if (parsedJson.news && Array.isArray(parsedJson.news)) {
                    parsedJson = parsedJson.news;
                 } else {
                    throw new Error("O formato retornado não é um array.");
                 }
             }
        } catch (e) {
            console.warn("[Alerta API News] Falha no parse:", jsonText);
            throw new Error(`Erro ao processar JSON da notícia: ${e.message}`);
        }

        return response.status(200).json({ json: parsedJson });

    } catch (error) {
        console.error("Erro interno no proxy Gemini (Notícias):", error);
        return response.status(500).json({ error: `Erro interno no servidor: ${error.message}` });
    }
}
