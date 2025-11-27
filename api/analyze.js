// api/analyze.js
import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });

    const { GEMINI_API_KEY } = process.env;
    if (!GEMINI_API_KEY) return res.status(500).json({ error: "API Key ausente." });

    try {
        const { carteira, totalPatrimonio } = req.body;

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

        // System direto e minimalista
        const systemPrompt = `
        Você é um consultor financeiro brasileiro conservador.
        Responda sempre em Markdown.
        Seja direto, com frases curtas e objetivas.
        Não enrole. Não conte história. Não use parágrafos longos.
        Use apenas fatos relevantes.
        Utilize Google Search para SELIC/IPCA antes de analisar.
        Sempre siga exatamente o formato solicitado.
        `;

        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            systemInstruction: systemPrompt,
            tools: [{ googleSearch: {} }]
        });

        const userQuery = `
        Analise esta carteira B3:
        Patrimônio: ${totalPatrimonio}
        Ativos: ${JSON.stringify(carteira)}

        Gere exatamente este formato:

        ### 1. Cenário Macro (Google)
        - SELIC hoje
        - IPCA hoje
        - Impacto em 1 frase

        ### 2. Riscos Reais
        - Pontos objetivos (concentração, qualidade dos FIIs, liquidez)
        - Se não houver riscos relevantes, diga: "Nenhum risco relevante."

        ### 3. Veredito
        Nota (0-10)

        ### 4. Próximo Passo
        Uma frase direta.
        `;

        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: userQuery }] }],
            generationConfig: {
                temperature: 0.05,
                maxOutputTokens: 600,
                topP: 0.8,
                topK: 40
            }
        });

        const text = result.response.text();
        if (!text) throw new Error("Retorno vazio.");

        return res.status(200).json({ result: text });

    } catch (err) {
        console.error("Analyze API error:", err);
        return res.status(500).json({ error: err.message || "Erro interno." });
    }
}