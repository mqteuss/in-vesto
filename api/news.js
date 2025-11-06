// api/news.js
// Esta é uma Vercel Serverless Function.
// Ela usa a API Gemini com a chave NEWS_GEMINI_API_KEY e Web Search
// para buscar notícias de FIIs.

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

// Constrói o payload para a API Gemini (Modo Notícias)
function getGeminiPayload(todayString) {
    const systemPrompt = `Você é um assistente de notícias financeiras. Sua única tarefa é encontrar as 5 notícias mais recentes e relevantes sobre FIIs (Fundos Imobiliários) no Brasil, usando a busca na web (data de hoje: ${todayString}).

Responda APENAS com um array JSON válido, sem nenhum outro texto, introdução ou markdown (\`\`\`).

- As notícias devem ser em português.
- 'url' deve ser o link direto para a notícia.
- 'sourceName' deve ser o nome do portal de notícias (ex: "InfoMoney", "Fiis.com.br").
- 'publishedAt' deve estar no formato AAAA-MM-DD. Se a data exata não for encontrada, use a data de hoje.
- 'description' deve ser um resumo curto da notícia.

Exemplo de resposta:
[
  {"title": "FII MXRF11 anuncia novos investimentos", "url": "https://exemplo.com/mxrf11", "sourceName": "InfoMoney", "description": "O fundo MXRF11 detalhou onde...", "publishedAt": "2025-11-06"},
  {"title": "HGLG11: Vacância cai para 5%", "url": "https://exemplo.com/hglg11", "sourceName": "Fiis.com.br", "description": "A vacância do HGLG11 atingiu...", "publishedAt": "2025-11-06"}
]`;

    const userQuery = `Encontre as 5 notícias mais recentes e relevantes (de hoje, ${todayString}) sobre FIIs e Fundos Imobiliários no Brasil.`;

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

    // *** IMPORTANTE: Usa a NOVA chave de API ***
    const { NEWS_GEMINI_API_KEY } = process.env;
    if (!NEWS_GEMINI_API_KEY) {
        return response.status(500).json({ error: "Chave NEWS_GEMINI_API_KEY não configurada no servidor." });
    }
    
    // ATENÇÃO: O nome do modelo pode precisar de ajuste (ex: gemini-1.5-flash-latest)
    // Usando o mesmo do seu gemini.js:
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${NEWS_GEMINI_API_KEY}`;

    try {
        // Pega a data de hoje do corpo da requisição
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
        
        // *** CACHE DE 6 HORAS (21600 segundos) ***
        response.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate');

        // Limpa e faz o parse do JSON retornado pelo Gemini
        let jsonText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonMatch = jsonText.match(/\[.*\]/s); // Pega o conteúdo entre [ e ]
        if (jsonMatch && jsonMatch[0]) {
            jsonText = jsonMatch[0];
        }
        
        return response.status(200).json({ json: JSON.parse(jsonText) });

    } catch (error) {
        console.error("Erro interno no proxy Gemini (Notícias):", error);
        return response.status(500).json({ error: `Erro interno no servidor: ${error.message}` });
    }
}