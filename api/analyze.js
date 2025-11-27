// api/analyze.js
// Implementação via SDK Oficial do Google (Modelo Gemini 2.5 Flash Estável)
import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(request, response) {
    // Tratamento de CORS/Métodos
    if (request.method === 'OPTIONS') return response.status(200).end();
    if (request.method !== 'POST') return response.status(405).json({ error: "Use POST." });

    const { GEMINI_API_KEY } = process.env;
    if (!GEMINI_API_KEY) {
        console.error("ERRO: GEMINI_API_KEY ausente.");
        return response.status(500).json({ error: "API Key não configurada." });
    }

    try {
        const { carteira, totalPatrimonio } = request.body;

        // Inicializa o SDK
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

        const systemPrompt = `
        Você é um Consultor Financeiro Sênior (B3/Brasil) Conservador e Consistente.
        
        SUA PERSONALIDADE:
        1. **Filosofia**: Priorize a proteção de patrimônio e dividendos constantes. Evite riscos excessivos.
        2. **Consistência**: Diante dos mesmos dados, mantenha a mesma recomendação técnica.
        3. **Brevidade**: Use frases curtas e listas (bullet points).
        4. **Realidade**: Use o Google Search para validar SELIC e IPCA atuais antes de opinar.

        Analise de forma crítica. Se a carteira for pequena (< R$ 2k), o foco deve ser o aporte regular, não a diversificação complexa.
        `;

        // Configuração do Modelo: Usando a versão estável "gemini-2.5-flash"
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash", 
            systemInstruction: systemPrompt,
            tools: [{ googleSearch: {} }], // Ferramenta de Grounding ativada
        });

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

        const generationConfig = {
            temperature: 0.1, // Mantido baixo para consistência
            maxOutputTokens: 1250,
            topP: 0.8,
            topK: 40
        };

        // Chamada à API
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: userQuery }] }],
            generationConfig
        });

        const responseData = await result.response;
        const text = responseData.text();

        if (!text) throw new Error("A IA não retornou texto válido.");

        return response.status(200).json({ result: text });

    } catch (error) {
        console.error("Erro no Analyze Handler (SDK):", error);

        // Tratamento básico de erro para retorno ao cliente
        const errorMessage = error.message || "Erro desconhecido ao processar análise.";
        return response.status(500).json({ error: errorMessage });
    }
}