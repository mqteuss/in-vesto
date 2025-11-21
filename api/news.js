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
    // 1. CÁLCULO DE DATA (Filtro de 7 dias)
    // Se hoje é 2025-11-21, ele define a data de corte para 2025-11-14
    const today = new Date(todayString);
    const lastWeek = new Date(today);
    lastWeek.setDate(today.getDate() - 7);
    
    // Formata para YYYY-MM-DD para o Google Search entender
    const startDate = lastWeek.toISOString().split('T')[0]; 

    // --- PROMPT REFINADO ---
    const systemPrompt = `Tarefa: Atuar como um jornalista financeiro sênior. Listar as 15 notícias mais relevantes de FIIs (Fundos Imobiliários) publicadas entre ${startDate} e ${todayString}.
Fontes: Portais confiáveis (Suno, Funds Explorer, InfoMoney, FIIs.com.br, Brazil Journal, Money Times).
Output: APENAS um array JSON válido.

REGRAS DE CONTEÚDO:
1. DATA: Ignore qualquer notícia anterior a ${startDate}. Foque no que aconteceu nesta semana.
2. TÍTULO: Deve ser curto (Máx 60 chars) e impactante. NUNCA coloque a data ou o nome do site no título.
3. RESUMO: Deve ser denso e informativo (3 a 5 frases). É OBRIGATÓRIO citar valores (R$), dividend yields (%), datas de pagamento ou detalhes da transação. O leitor deve entender a notícia completa apenas lendo o resumo.
4. TICKERS: Identifique corretamente os fundos citados.

CAMPOS JSON OBRIGATÓRIOS:
- "title": String (Manchete limpa).
- "summary": String (Texto jornalístico detalhado).
- "sourceName": String (Portal).
- "sourceHostname": String (Domínio).
- "publicationDate": String (YYYY-MM-DD, deve ser >= ${startDate}).
- "relatedTickers": Array de Strings.

Seja rápido e preciso.`;

    // --- QUERY COM OPERADOR DE TEMPO ---
    // O "after:" força o Google a ignorar resultados velhos
    const userQuery = `Principais notícias de Fundos Imobiliários (FIIs) after:${startDate} até ${todayString}. JSON array completo.`;

    return {
        contents: [{ parts: [{ text: userQuery }] }],
        tools: [{ "google_search": {} }], // Ferramenta de busca ativa

        generationConfig: {
            temperature: 0.1, // Baixa temperatura para seguir as regras estritamente
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

        // Cache de 6 horas para economizar requisições
        response.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate');

        // Limpeza do Markdown para evitar erros de JSON
        let jsonText = text.replace(/```json/g, '').replace(/```/g, '').trim();

        let parsedJson;
        try {
             parsedJson = JSON.parse(jsonText);
        } catch (e) {
             // Tentativa de recuperação se houver texto antes/depois do JSON
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
