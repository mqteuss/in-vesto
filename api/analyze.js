// Importa a biblioteca oficial
import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
    // 1. Configuração de CORS (Padrão para o seu frontend acessar)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    // 2. Verifica a Chave
    if (!process.env.GEMINI_API_KEY) {
        console.error("ERRO: GEMINI_API_KEY não encontrada na Vercel.");
        return res.status(500).json({ error: 'Chave de API não configurada.' });
    }

    try {
        const { carteira, totalPatrimonio } = req.body;

        // 3. Inicializa o Google AI
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        
        // IMPORTANTE: Se o "gemini-2.5-flash" der erro 404, mude para "gemini-1.5-flash"
        // O modelo 2.5 pode não estar liberado em todas as contas ainda via API SDK.
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `
        Atue como Consultor Financeiro Sênior (Brasil/B3).
        Analise esta carteira:
        - Patrimônio Total: ${totalPatrimonio}
        - Ativos: ${JSON.stringify(carteira)}

        Gere uma resposta curta em Markdown contendo:
        1. Análise de Diversificação.
        2. Riscos Principais.
        3. Nota (0 a 10).
        4. Uma sugestão de melhoria.
        `;

        // 4. Gera o conteúdo
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        return res.status(200).json({ result: responseText });

    } catch (error) {
        console.error("Erro Google AI SDK:", error);
        return res.status(500).json({ 
            error: 'Erro ao gerar análise.',
            details: error.message 
        });
    }
}
