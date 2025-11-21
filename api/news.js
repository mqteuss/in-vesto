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
    const systemPrompt = `Você é um editor de notícias financeiras. 
TAREFA: Encontrar as 10 notícias mais recentes e relevantes sobre FIIs (Fundos Imobiliários) no Brasil, publicadas **nesta semana** (data de hoje: ${todayString}).

REGRAS:
1. Busque em portais confiáveis (InfoMoney, Fiis.com.br, etc).
2. Sua saída deve conter APENAS o array JSON final. Se você precisar processar informações (pensamento), não exiba isso no output final, ou garanta que o JSON esteja claramente separado.
3. Estrutura do JSON (Array de Objetos):
    - "title": Título.
    - "summary": Resumo (4 frases).
    - "sourceName": Nome da fonte.
    - "sourceHostname": Domínio (ex: infomoney.com.br).
    - "publicationDate": YYYY-MM-DD.
    - "relatedTickers": Array ["MXRF11", "HGLG11"].

IMPORTANTE: Comece a resposta final com '[' e termine com ']'.`;

    const userQuery = `Array JSON com 10 notícias recentes de FIIs (Semana ${todayString}).`;

    return {
        contents: [{ parts: [{ text: userQuery }] }],
        tools: [{ "google_search": {} }], 
        systemInstruction: { parts: [{ text: systemPrompt }] },
        // CONFIGURAÇÃO GEMINI 3 PRO - MODO RÁPIDO
        generationConfig: { 
            // Configuração baseada na sua observação da doc (Thinking Level: Low)
            // Nota: A chave exata pode variar (thinking, thinking_config, reasoning), 
            // usamos 'thinking' conforme o padrão comum para esse parâmetro.
            thinking: "LOW", 
            temperature: 0.1 // Reduz criatividade para focar em dados e velocidade
        }
    };
}

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ error: "Método não permitido, use POST." });
    }

    const { NEWS_GEMINI_API_KEY } = process.env;
    if (!NEWS_GEMINI_API_KEY) {
        return response.status(500).json({ error: "Chave NEWS_GEMINI_API_KEY não configurada." });
    }

    // URL DO GEMINI 3 PRO PREVIEW
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key=${NEWS_GEMINI_API_KEY}`;

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

        // Verifica se parou por MAX_TOKENS (comum em respostas longas) ou STOP normal
        if (candidate?.finishReason !== "STOP" && candidate?.finishReason !== "MAX_TOKENS") {
             if (candidate?.finishReason) {
                 throw new Error(`A resposta foi bloqueada. Razão: ${candidate.finishReason}`);
             }
        }
        if (!text) {
            throw new Error("A API retornou uma resposta vazia.");
        }

        response.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate');

        // --- EXTRAÇÃO ROBUSTA DE JSON (Necessária para modelos Thinking) ---
        // Mesmo com 'Thinking: LOW', o modelo pode soltar algum texto antes.
        // Esta lógica ignora tudo que não for o array JSON.
        
        let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        
        // Encontra o primeiro '[' e o último ']'
        const jsonMatch = cleanText.match(/\[[\s\S]*\]/); 
        
        if (jsonMatch) {
            cleanText = jsonMatch[0];
        }

        let parsedJson;
        try {
            parsedJson = JSON.parse(cleanText);
        } catch (e) {
            console.error("Erro Parse JSON:", e.message);
            // Log do texto para debug caso o modelo esteja "conversando" demais
            console.warn("Texto recebido da API:", text.substring(0, 200) + "..."); 
            throw new Error(`Falha ao processar o JSON retornado pelo Gemini 3.`);
        }

        if (!Array.isArray(parsedJson)) {
            // Fallback caso o modelo retorne dentro de um objeto { "news": [...] }
            if (parsedJson.news && Array.isArray(parsedJson.news)) {
                parsedJson = parsedJson.news;
            } else {
                throw new Error("A API retornou JSON válido, mas não é um array de notícias.");
            }
        }

        return response.status(200).json({ json: parsedJson });

    } catch (error) {
        console.error("Erro interno no proxy Gemini (Notícias):", error);
        // Se der erro 400, pode ser que o parâmetro 'thinking' ainda não esteja habilitado na sua chave
        return response.status(500).json({ error: `Erro: ${error.message}` });
    }
}
