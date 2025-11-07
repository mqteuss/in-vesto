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
    
    // *** PROMPT MAIS DIRETO E RESUMIDO ***
    const systemPrompt = `Você é um editor de notícias financeiras. Sua tarefa é encontrar os 5 artigos de notícias mais recentes e relevantes sobre FIIs (Fundos Imobiliários) no Brasil, publicados **neste mês** (data de hoje: ${todayString}).

REGRAS:
1.  Encontre artigos de portais de notícias conhecidos (ex: InfoMoney, Fiis.com.br, Seu Dinheiro, Money Times).
2.  Responda APENAS com um array JSON válido. Não inclua \`\`\`json ou qualquer outro texto.
3.  'url' deve ser o link direto para o artigo.
4.  'sourceName' deve ser o nome do portal.
5.  'publishedAt' deve estar no formato AAAA-MM-DD.

EXEMPLO:
[
  {"title": "MXRF11 anuncia nova emissão de cotas", "url": "https://infomoney.com.br/mxrf11-emissao", "sourceName": "InfoMoney", "description": "O fundo detalhou a 14ª emissão...", "publishedAt": "2025-11-06"},
  {"title": "HGLG11 reduz vacância", "url": "https://fiis.com.br/hglg11-vacancia", "sourceName": "Fiis.com.br", "description": "A vacância do HGLG11 caiu para 5%...", "publishedAt": "2025-11-05"}
]`;

    const userQuery = `Liste os 5 artigos de notícias mais recentes (deste mês, ${todayString}) sobre FIIs de portais financeiros brasileiros.`;

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
