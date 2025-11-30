// api/analyze.js
// Implementação via SDK Oficial do Google
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

        // System Prompt: Persona e Regras de Conduta
        const systemPrompt = `
        Você é um Consultor Financeiro Sênior (CVM, Brasil), conservador e técnico.
        
        MANDAMENTOS:
        1. Use a tool 'googleSearch' OBRIGATORIAMENTE para buscar a SELIC atual (Meta) e o IPCA acumulado (12 meses).
        2. Seja direto, objetivo e profissional.
        3. Não invente dados. Se a busca falhar, informe que o dado está indisponível.
        4. Se o patrimônio for < R$ 2.000,00, a análise deve focar quase exclusivamente no hábito de aportar e não na diversificação.
        5. Estilo: Frases curtas, análise séria, Markdown limpo.
        `;

        // Configuração do Modelo
        // Nota: Certifique-se que o modelo "gemini-2.5-flash" está disponível na sua conta. 
        // Caso contrário, use "gemini-1.5-flash".
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash", 
            systemInstruction: systemPrompt,
            tools: [{ googleSearch: {} }], // Ferramenta de Grounding ativada
        });

        // User Query: Dados Específicos e Estrutura de Saída
        const userQuery = `
        Analise minha carteira (Data: ${dataAtual})

        Patrimônio: ${totalPatrimonio}
        Ativos: ${JSON.stringify(carteira)}

        Sua tarefa é executar a busca e gerar o relatório no formato abaixo:

        ### 1. Macro (Google)
        - SELIC e IPCA reais encontrados via busca.
        - Em 1 frase: cenário favorece RF pós, prefixada, IPCA+ ou FIIs?

        ### 2. Riscos
        - Analise concentração, qualidade e liquidez.
        - Nota: Se patrimônio < 2k, classifique o risco geral como "Baixo/Irrelevante" (fase de acumulação).

        ### 3. Nota (0-10)

        ### 4. Próximo Passo
        - Escolha APENAS 1 ação: aportar RF / aumentar caixa / FIIs de papel / balancear / manter.
        - Explique em 1 frase curta.
        `;

        const generationConfig = {
            temperature: 0.1, // Baixo para máxima precisão técnica
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

        // Tratamento básico de erro para retorno ao cliente
        const errorMessage = error.message || "Erro desconhecido ao processar análise.";
        return response.status(500).json({ error: errorMessage });
    }
}
