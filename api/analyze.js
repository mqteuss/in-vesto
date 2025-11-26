// api/analyze.js
// Estrutura idêntica ao gemini.js funcional

// Função de retry (backoff) igual à do seu sistema atual
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
    // Tratamento simples de método, igual ao gemini.js
    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }
    
    if (request.method !== 'POST') {
        return response.status(405).json({ error: "Método não permitido, use POST." });
    }

    const { GEMINI_API_KEY } = process.env;
    if (!GEMINI_API_KEY) {
        console.error("ERRO: GEMINI_API_KEY ausente.");
        return response.status(500).json({ error: "Configuração de servidor inválida (API Key)." });
    }

    // Usando o mesmo modelo e versão que funciona no seu gemini.js
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`;

    try {
        const { carteira, totalPatrimonio } = request.body;

        // Preparação do Prompt
        const systemPrompt = `Você é um Consultor Financeiro Sênior especialista no mercado brasileiro (B3).
        Seu objetivo é analisar a carteira do usuário e fornecer insights práticos.
        Seja direto, técnico mas acessível. Use Markdown para formatar (negrito, listas).
        Não use introduções genéricas.`;

        const userQuery = `
        Analise minha carteira atual:
        - Patrimônio Total: ${totalPatrimonio}
        - Ativos: ${JSON.stringify(carteira)}

        Gere um relatório curto com estes 4 pontos exatos:
        1. **Diversificação**: Breve análise da distribuição (Setores, Papel vs Tijolo).
        2. **Riscos**: Pontos de atenção ou concentração.
        3. **Nota (0-10)**: Avaliação da saúde da carteira.
        4. **Sugestão**: Uma ação prática recomendada (manter, comprar, estudar algo).
        `;

        const geminiPayload = {
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 1000
            }
        };

        // Chamada à API do Google
        const result = await fetchWithBackoff(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiPayload)
        });

        const candidate = result?.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text;

        if (!text) {
            throw new Error("A IA não retornou texto válido.");
        }

        // Retorna o resultado formatado
        return response.status(200).json({ result: text });

    } catch (error) {
        console.error("Erro no Analyze Handler:", error);
        // Retorna o erro detalhado para o frontend ver o que houve
        return response.status(500).json({ 
            error: `Erro interno: ${error.message}`,
            details: error.toString()
        });
    }
}
