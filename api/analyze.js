// api/analyze.js
// Otimizado para CONSISTÊNCIA, VELOCIDADE e VISUAL LIMPO (Sem emojis)

async function fetchWithBackoff(url, options, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.status === 429 || response.status >= 500) {
                throw new Error(`API Error: ${response.status} ${response.statusText}`);
            }
            if (!response.ok) {
                 const errorBody = await response.json().catch(() => ({}));
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

export default async function handler(request, response) {
    if (request.method === 'OPTIONS') return response.status(200).end();
    if (request.method !== 'POST') return response.status(405).json({ error: "Use POST." });

    const { GEMINI_API_KEY } = process.env;
    if (!GEMINI_API_KEY) {
        console.error("ERRO: GEMINI_API_KEY ausente.");
        return response.status(500).json({ error: "API Key não configurada." });
    }

    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`;

    try {
        const { carteira, totalPatrimonio } = request.body;

        // Prompt ajustado: Sem emojis, tom sóbrio e profissional.
        const systemPrompt = `
        Você é um Consultor Financeiro Sênior (B3/Brasil) Conservador e Consistente.
        
        SUA PERSONALIDADE:
        1. **Filosofia**: Priorize a proteção de patrimônio e dividendos constantes. Evite riscos excessivos.
        2. **Consistência**: Diante dos mesmos dados, mantenha a mesma recomendação técnica.
        3. **Brevidade**: Use frases curtas e listas (bullet points).
        4. **Realidade**: Use o Google Search para validar SELIC e IPCA atuais antes de opinar.

        Analise de forma crítica. Se a carteira for pequena (< R$ 2k), o foco deve ser o aporte regular, não a diversificação complexa.
        `;

        const userQuery = `
        Analise esta carteira B3:
        - Patrimônio: ${totalPatrimonio}
        - Ativos: ${JSON.stringify(carteira)}

        Gere este relatório Markdown exato:
        ### 1. Cenário Macro (Google)
        (Cite SELIC/IPCA hoje e em 1 frase diga como isso impacta essa carteira).

        ### 2. Riscos Reais
        (Seja direto: Há concentração? Algum ativo problemático? Se não, afirme que a carteira está segura).

        ### 3. Veredito (0-10)
        (Dê uma nota justa baseada na qualidade dos ativos).

        ### 4. Próximo Passo Sugerido
        (Uma ação lógica: "Aportar em Tijolo", "Aumentar Caixa", "Manter estratégia").
        `;

        const geminiPayload = {
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            tools: [{ google_search: {} }],
            generationConfig: {
                temperature: 0.1, // Mantido baixo para garantir consistência
                maxOutputTokens: 1000,
                topP: 0.8,
                topK: 40
            }
        };

        const result = await fetchWithBackoff(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiPayload)
        });

        const candidate = result?.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text;

        if (!text) throw new Error("A IA não retornou texto válido.");

        return response.status(200).json({ result: text });

    } catch (error) {
        console.error("Erro no Analyze Handler:", error);
        return response.status(500).json({ error: `Erro interno: ${error.message}` });
    }
}
