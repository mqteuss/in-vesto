// api/analyze.js
// Agora com GOOGLE SEARCH ativado para dados em tempo real

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

        // Prompt Atualizado para tirar proveito da Busca
        const systemPrompt = `
        Você é um Consultor Financeiro Sênior (B3/Brasil) com acesso a dados em tempo real.
        
        DIRETRIZES:
        1. **Use o Google Search** para verificar a Taxa Selic atual e o cenário de inflação (IPCA) antes de opinar.
        2. **Contexto**: O usuário é pequeno investidor. Seja incentivador se o patrimônio for baixo (< R$ 2k).
        3. **Verificação**: Se houver algum FII na lista com "Fato Relevante" negativo recente (últimos 30 dias), alerte no item 'Riscos'.
        4. **Formato**: Markdown, curto e direto para celular.
        `;

        const userQuery = `
        Analise esta carteira de FIIs/Ações:
        - Patrimônio Total: ${totalPatrimonio}
        - Ativos: ${JSON.stringify(carteira)}

        Gere o relatório:
        ### 1. Raio-X e Cenário 🔎
        (Analise a carteira frente à Selic/Inflação atuais. Cite os setores).

        ### 2. Pontos de Atenção ⚠️
        (Riscos de concentração ou notícias recentes negativas dos ativos listados).

        ### 3. Veredito (Nota 0-10) ⭐
        (Nota baseada em diversificação e qualidade).

        ### 4. Próximo Passo 🚀
        (Sugestão prática de aporte considerando o cenário econômico atual).
        `;

        const geminiPayload = {
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            // AQUI ESTÁ A MÁGICA: Adicionamos a ferramenta de busca
            tools: [{ google_search: {} }],
            generationConfig: {
                temperature: 1.0, // Reduzi um pouco para ele não alucinar dados
                maxOutputTokens: 3500
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
