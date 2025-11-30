// api/analyze.js
// Implementação via SDK Oficial do Google (Modelo Gemini 2.5 Flash)
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
        
        // Data atual formatada para o prompt
        const dataAtual = new Date().toLocaleDateString('pt-BR');

        // Inicializa o SDK
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

        // System Prompt: Persona Especialista em FIIs
        const systemPrompt = `
        Você é um Analista de Investimentos Especialista em Fundos Imobiliários (FIIs) e Renda Passiva.
        
        MANDAMENTOS:
        1. Use a tool 'googleSearch' OBRIGATORIAMENTE para buscar: SELIC Meta atual e IPCA acumulado 12 meses.
        2. Sua filosofia: Foco na sustentabilidade dos dividendos (Yield), qualidade dos imóveis/crédito e preço justo (P/VP e Cap Rate).
        3. Se o patrimônio total for < R$ 2.000,00: Ignore diversificação complexa. O conselho deve ser focado em "Aporte constante para atingir o 'Número Mágico' (quando os dividendos compram uma nova cota sozinhos)".
        4. Terminologia: Use termos do nicho (Tijolo, Papel, High Yield, High Grade, Vacância, P/VP, Data Com).
        5. Estilo: Direto, técnico e educativo. Use Markdown.
        `;

        // Configuração do Modelo com Grounding (Google Search)
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash", 
            systemInstruction: systemPrompt,
            tools: [{ googleSearch: {} }], // Ferramenta de busca ativada
        });

        // User Query: Focada em dinâmica de FIIs
        const userQuery = `
        Analise minha carteira de FIIs (Data: ${dataAtual})

        Patrimônio: ${totalPatrimonio}
        Ativos: ${JSON.stringify(carteira)}

        Gere o relatório neste formato exato (Markdown):

        ### 1. Cenário Macro (Google)
        - **Dados:** (Cite a SELIC e o IPCA encontrados).
        - **Impacto:** Com essa SELIC, o cenário atual favorece mais FIIs de Papel (indexados ao CDI) ou Tijolo (potencial de valorização com queda de juros)? Responda em 1 frase.

        ### 2. Raio-X da Carteira
        - Analise a exposição setorial (Logística, Shopping, Papel/Recebíveis, Agro).
        - Há concentração perigosa em um único fundo ou gestora?
        - (Se patrimônio < 2k: Reforce a importância de atingir o "Número Mágico" nos ativos mais baratos).

        ### 3. Veredito (Nota 0-10)

        ### 4. Próximo Movimento
        - Escolha APENAS 1 ação lógica: "Aportar em Tijolo (Desconto)", "Aportar em Papel (Renda)", "Aumentar Caixa" ou "Manter".
        - Justificativa relâmpago (máx 15 palavras).
        `;

        const generationConfig = {
            temperature: 0.1, // Baixo para consistência técnica
            maxOutputTokens: 1000,
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

        const errorMessage = error.message || "Erro desconhecido ao processar análise.";
        return response.status(500).json({ error: errorMessage });
    }
}
