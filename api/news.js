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

    // --- AJUSTE PARA CONTEÚDO MAIS DENSO ---
    // 1. Title: Mantido curto e limpo (sem datas repetidas).
    // 2. Summary: Agora exigimos "Resumo Jornalístico" com valores e detalhes.
    
    const systemPrompt = `Tarefa: Listar 15 notícias recentes de FIIs (Fundos Imobiliários) desta semana (${todayString}).
Fontes: Principais portais financeiros do Brasil (Suno, Funds Explorer, InfoMoney, FIIs.com.br, Brazil Journal, Money Times).
Output: APENAS um array JSON válido. Sem markdown.

CAMPOS JSON OBRIGATÓRIOS:
- "title": Título curto e direto (Máximo 60 caracteres). REGRA CRÍTICA: NÃO coloque a data (ex: 21/11) e NÃO coloque o nome do site no título.
- "summary": Resumo jornalístico detalhado (Entre 3 a 5 frases). É OBRIGATÓRIO incluir dados numéricos quando houver (Valores em R$, Dividend Yield em %, Datas de Pagamento). O texto deve ser denso e explicar o impacto da notícia para o investidor. Evite resumos vazios de uma linha.
- "sourceName": Nome do Portal.
- "sourceHostname": Domínio (ex: suno.com.br).
- "publicationDate": A data real da notícia (Formato YYYY-MM-DD).
- "relatedTickers": Array com os tickers citados (ex: ["MXRF11"]).

Seja rápido, mas traga conteúdo rico nos resumos.`;

    const userQuery = `JSON com 15 notícias de FIIs desta semana (${todayString}). Resumos detalhados com números e valores.`;

    return {
        contents: [{ parts: [{ text: userQuery }] }],
        tools: [{ "google_search": {} }], // Busca ativa para garantir dados reais (valores e datas)

        generationConfig: {
            temperature: 0.1, // Baixa temperatura para fidelidade aos dados
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

        // Limpeza robusta de Markdown
        let jsonText = text.replace(/```json/g, '').replace(/```/g, '').trim();

        let parsedJson;
        try {
             parsedJson = JSON.parse(jsonText);
        } catch (e) {
             const jsonMatch = jsonText.match(/\[.*\]/s);
             if (jsonMatch) {
                 try {
                    parsedJson = JSON.parse(jsonMatch[0]);
                 } catch (innerE) {
                    throw new Error("Falha ao processar JSON extraído.");
                 }
             } else {
                 throw new Error("JSON inválido na resposta.");
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
