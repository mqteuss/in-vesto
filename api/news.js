// api/news.js
// Esta é uma Vercel Serverless Function.
// Ela usa a API Gemini com a chave NEWS_GEMINI_API_KEY e Web Search
// para buscar um RESUMO das notícias de FIIs.

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

// Constrói o payload para a API Gemini (Modo Resumo de Notícias)
function getGeminiPayload(todayString) {
    
    // *** PROMPT TOTALMENTE NOVO: PEDE UM RESUMO, NÃO LINKS ***
    const systemPrompt = `Você é um editor de notícias financeiras. Sua tarefa é encontrar as 3 a 5 principais notícias sobre FIIs (Fundos Imobiliários) no Brasil, publicadas **neste mês** (data de hoje: ${todayString}).

REGRAS:
1.  Escreva um resumo conciso para cada notícia.
2.  Formate a resposta como uma lista (bullet points).
3.  Comece cada ponto com um emoji (ex: 📈, 💰, 🏢).
4.  No final de cada ponto, cite a fonte entre parênteses (ex: InfoMoney).
5.  Responda APENAS com o texto do resumo. NÃO inclua títulos, saudações, markdown (\`\`\`) ou qualquer outro texto.

EXEMPLO DE RESPOSTA:
📈 O fundo MXRF11 anunciou sua 14ª emissão de cotas, com o objetivo de captar R$ 500 milhões para novos investimentos. (InfoMoney)
💰 BTG Pactual (BTLG11) foi o FII mais recomendado por analistas para o mês, refletindo a confiança no setor de logística. (Seu Dinheiro)
🏢 O IFIX, principal índice de FIIs, registrou uma leve alta de 0,2% na primeira semana do mês, impulsionado por fundos de tijolo. (Fiis.com.br)`;

    const userQuery = `Gere um resumo em bullet points das 3-5 principais notícias sobre FIIs deste mês (${todayString}), citando a fonte no final de cada ponto.`;

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
        
        // *** RESPOSTA MODIFICADA ***
        // Limpa o texto (remove asteriscos extras) e o retorna dentro de um objeto JSON.
        const cleanedText = text.replace(/\*/g, '').trim();
        
        return response.status(200).json({ summary: cleanedText });

    } catch (error) {
        console.error("Erro interno no proxy Gemini (Notícias):", error);
        return response.status(500).json({ error: `Erro interno no servidor: ${error.message}` });
    }
}
