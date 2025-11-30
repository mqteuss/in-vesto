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

        // Data atual para contexto do prompt
        const dataAtual = new Date().toLocaleDateString('pt-BR');

        // Inicializa o SDK
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

        // --- NOVO SYSTEM PROMPT (Profissional / CVM) ---
        const systemPrompt = `
        Você é um Consultor de Investimentos Sênior (perfil CVM, Brasil), especialista em carteiras B3, com foco em proteção de patrimônio, consistência e dividendos estáveis. 
        
        Regras fundamentais: 
        - Sua análise deve ser sempre técnica, séria e objetiva. 
        - Use a ferramenta Google Search OBRIGATORIAMENTE para consultar: 
          • Taxa SELIC meta vigente hoje. 
          • IPCA acumulado dos últimos 12 meses. 
        - Todas as conclusões devem partir dos dados reais encontrados. 
        - Não invente valores. Se a busca não retornar algo, diga claramente. 
        - Responda sempre em português claro, em formato profissional. 
        
        Personalidade: 
        - Conservador, prudente e orientado a risco. 
        - Prefere segurança, renda fixa forte e carteiras equilibradas. 
        - Evita recomendações agressivas. 
        - Sempre considera liquidez, concentração, correlação e risco setorial. 
        - Se o patrimônio for baixo (< R$ 2.000): 
          • Não critique diversificação limitada. 
          • Reforce o hábito de aporte mensal. 
        
        Estilo de resposta: 
        - Estruturado. 
        - Raciocínio financeiro direto. 
        - Markdown limpo. 
        - Sem enrolação.
        `;

        // Configuração do Modelo: Usando a versão estável "gemini-2.5-flash"
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash", 
            systemInstruction: systemPrompt,
            tools: [{ googleSearch: {} }], // Ferramenta de Grounding ativada
        });

        // --- NOVO USER QUERY ---
        const userQuery = `
        Analise esta carteira com base no cenário econômico ATUAL do Brasil (Data: ${dataAtual}).
        Patrimônio total: ${totalPatrimonio}
        Ativos: ${JSON.stringify(carteira)}

        Use Google Search para obter:
        - SELIC atual
        - IPCA acumulado 12 meses

        Agora gere o relatório em Markdown no formato EXATO abaixo:
        ---
        ### **1. Cenário Macroeconômico (dados via Google)**
        - Informe a SELIC e o IPCA reais.
        - Em 1 frase, diga se o cenário favorece:
          • renda fixa pós
          • renda fixa prefixada
          • IPCA+
          • FIIs
        ---
        ### **2. Diagnóstico Técnico da Carteira**
        Avalie com profundidade:
        - Exposição por classe (FIIs, ações, renda fixa etc.)
        - Concentração perigosa
        - Qualidade média dos ativos
        - Risco x retorno no cenário atual
        - Liquidez
        - Adequação ao patrimônio informado
        ---
        ### **3. Nota Final (0 a 10)**
        Critérios:
        - Diversificação
        - Qualidade dos ativos
        - Adequação ao cenário macro
        - Risco x retorno
        ---
        ### **4. Próximo Passo Único Recomendado**
        Escolha apenas um:
        - "Aportar em renda fixa"
        - "Aumentar caixa"
        - "Aumentar FIIs de papel"
        - "Balancear setores"
        - "Reduzir exposição"
        - "Manter estratégia"
        Explique em 1 frase por que essa é a melhor ação HOJE.
        ---
        `;

        const generationConfig = {
            temperature: 0.1, // Baixo para manter o perfil sério/técnico
            maxOutputTokens: 1500, // Aumentado levemente para comportar a análise mais densa
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
