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
2.  Responda APENAS com um array JSON válido. Não inclua \`\`\`json ou qualquer outro texto antes ou depois.
3.  Use as ferramentas de busca para garantir que as datas sejam desta semana.
4.  Seja breve no seu processo de pensamento para responder rápido.

ESTRUTURA OBRIGATÓRIA DOS OBJETOS NO ARRAY:
    - "title": Título da notícia.
    - "summary": Resumo com 3 frases.
    - "sourceName": Nome do portal.
    - "sourceHostname": Domínio (ex: infomoney.com.br).
    - "publicationDate": YYYY-MM-DD.
    - "relatedTickers": Array de strings (ex: ["MXRF11"]).

EXEMPLO:
[
  {"title": "IFIX sobe hoje", "summary": "Resumo...", "sourceName": "InfoMoney", "sourceHostname": "infomoney.com.br", "publicationDate": "2025-11-06", "relatedTickers": ["MXRF11"]}
]`;

    const userQuery = `Gere um array JSON com os 10 resumos de notícias mais recentes (desta semana, ${todayString}) sobre FIIs. Siga estritamente o formato JSON solicitado.`;

    return {
        contents: [{ parts: [{ text: userQuery }] }],
        tools: [{ "google_search": {} }],
        
        generationConfig: {
            temperature: 0.2, // Baixa temperatura para precisão
            
            // --- CONFIGURAÇÃO DE PENSAMENTO RÁPIDO ---
            thinkingConfig: {
                includeThoughts: false, // Esconde o pensamento para não quebrar o JSON
                thinkingBudget: 1024    // 1024 tokens é um orçamento baixo/médio, forçando um pensamento rápido (5-10s)
            }
        },

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

    // Mantendo a versão 2.5 Flash que suporta Thinking
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

        if (candidate?.finishReason !== "STOP" && candidate?.finishReason !== "MAX_TOKENS") {
             if (candidate?.finishReason) {
                 throw new Error(`A resposta foi bloqueada. Razão: ${candidate.finishReason}`);
             }
        }
        if (!text) {
            throw new Error("A API retornou uma resposta vazia.");
        }

        response.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate');

        // Limpeza robusta (essencial já que removemos o responseMimeType)
        let jsonText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        
        let parsedJson;
        try {
             // Tenta parse direto
             parsedJson = JSON.parse(jsonText);
        } catch (e) {
             // Fallback: Tenta encontrar o array [ ... ] dentro do texto
             const jsonMatch = jsonText.match(/\[.*\]/s);
             if (jsonMatch) {
                 try {
                    parsedJson = JSON.parse(jsonMatch[0]);
                 } catch (innerE) {
                    throw new Error("Falha ao processar o JSON extraído.");
                 }
             } else {
                 throw new Error("A resposta da IA não contém um JSON válido.");
             }
        }

        if (!Array.isArray(parsedJson)) {
            parsedJson = [parsedJson]; 
        }

        return response.status(200).json({ json: parsedJson });

    } catch (error) {
        console.error("Erro interno no proxy Gemini (Notícias):", error);
        return response.status(500).json({ error: `Erro interno no servidor: ${error.message}` });
    }
}
