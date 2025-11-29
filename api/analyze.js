// api/analyze.js
import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(request, response) {
    // Tratamento de CORS/Métodos
    if (request.method === 'OPTIONS') return response.status(200).end();
    if (request.method !== 'POST') return response.status(405).json({ error: "Use POST." });

    const { GEMINI_API_KEY } = process.env;
    if (!GEMINI_API_KEY) {
        return response.status(500).json({ error: "API Key não configurada." });
    }

    try {
        const { carteira, totalPatrimonio } = request.body;

        // Pega a data de hoje para garantir que a IA busque a Selic/IPCA vigentes
        const dataAtual = new Date().toLocaleDateString('pt-BR', { 
            day: 'numeric', month: 'long', year: 'numeric' 
        });

        // Inicializa o SDK
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

        const systemPrompt = `
        Você é um Consultor Financeiro Sênior (B3/Brasil) Conservador e Consistente.
        Data atual: ${dataAtual}.
        
        SUA PERSONALIDADE:
        1. **Filosofia**: Priorize a proteção de patrimônio e dividendos constantes.
        2. **Realidade**: Use a ferramenta Google Search para validar a Taxa SELIC e o IPCA (acumulado 12m) VIGENTES HOJE no Brasil antes de opinar.
        3. **Brevidade**: Use frases curtas e bullet points.

        Se a carteira for pequena (< R$ 2.000), o foco deve ser o "Hábito de Aportar", não critique a falta de diversificação complexa.
        `;

        // Configuração mantida no 2.5 Flash conforme solicitado
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash", 
            systemInstruction: systemPrompt,
            tools: [{ googleSearch: {} }], 
        });

        const userQuery = `
        Analise esta carteira B3 (Data: ${dataAtual}):
        - Patrimônio: ${totalPatrimonio}
        - Ativos: ${JSON.stringify(carteira)}

        Gere este relatório Markdown exato:
        ### 1. Cenário Macro (Google)
        (Cite a SELIC e IPCA exatos de hoje. Em 1 frase, diga se a Renda Fixa está ganhando dos FIIs).

        ### 2. Riscos Reais
        (Seja direto: Há concentração perigosa? Se o patrimônio for baixo, diga que o risco é baixo).

        ### 3. Veredito (0-10)
        (Nota baseada na qualidade dos ativos).

        ### 4. Próximo Passo Sugerido
        (Uma ação lógica: ex: "Aportar em Papel", "Fazer Caixa", "Manter estratégia").
        `;

        const generationConfig = {
            temperature: 0.1, 
            maxOutputTokens: 1000,
        };

        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: userQuery }] }],
            generationConfig
        });

        const responseData = await result.response;
        const text = responseData.text();

        return response.status(200).json({ result: text });

    } catch (error) {
        console.error("Erro no Analyze Handler:", error);
        const errorMessage = error.message || "Erro desconhecido ao processar análise.";
        return response.status(500).json({ error: errorMessage });
    }
}
