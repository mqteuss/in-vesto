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
    // 1. CÁLCULO DE DATA (Filtro de 7 dias atrás)
    // Se hoje é 2025-11-21, startDate será 2025-11-14
    const today = new Date(todayString);
    const lastWeek = new Date(today);
    lastWeek.setDate(today.getDate() - 7);
    const startDate = lastWeek.toISOString().split('T')[0]; // Formato YYYY-MM-DD para o Google

    // --- PROMPT AJUSTADO PARA 25 NOTÍCIAS E FILTRO RIGOROSO ---
    const systemPrompt = `Tarefa: Atuar como um agregador de notícias financeiras em tempo real.
Objetivo: Listar as 25 notícias mais recentes e relevantes de FIIs (Fundos Imobiliários) publicadas ESTRITAMENTE entre ${startDate} e ${todayString}.
Fontes: Suno, Funds Explorer, InfoMoney, FIIs.com.br, Brazil Journal, Money Times, Valor Investe.
Output: APENAS um array JSON válido.

REGRAS DE FILTRAGEM (CRÍTICO):
1. QUANTIDADE: Busque exatamente 25 notícias distintas.
2. DATA: IGNORE qualquer notícia publicada antes de ${startDate}. Se a notícia for do dia 01, 05 ou 10 (e a data de corte for 14), NÃO inclua.
3. TEMA: Foque em Fatos Relevantes, Dividendos, Emissões e Relatórios Gerenciais.

CAMPOS JSON OBRIGATÓRIOS:
- "title": Título curto (Máx 60 caracteres). NÃO coloque a data nem o nome do site no título.
- "summary": Resumo jornalístico detalhado (3 a 4 frases). OBRIGATÓRIO incluir números (R$, %, Datas) para dar densidade ao texto.
- "sourceName": Nome do Portal.
- "sourceHostname": Domínio (ex: suno.com.br).
- "publicationDate": A data real da notícia (YYYY-MM-DD). Deve ser >= ${startDate}.
- "relatedTickers": Array com os tickers (ex: ["HGLG11"]).

Seja rápido e rigoroso com a data.`;

    // --- QUERY COM OPERADOR DE TEMPO ---
    // O operador "after:" força o Google a ignorar resultados velhos
    const userQuery = `25 notícias recentes de FIIs (Fundos Imobiliários) after:${startDate} até ${todayString}. JSON array.`;

    return {
        contents: [{ parts: [{ text: userQuery }] }],
        tools: [{ "google_search": {} }], // Busca ativa obrigatória

        generationConfig: {
            temperature: 0.1, // Baixa criatividade para garantir respeito às datas e formato
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
