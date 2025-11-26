import axios from 'axios';

export default async function handler(req, res) {
    // Configuração de CORS para permitir chamadas do seu front
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { carteira, totalPatrimonio, perfil } = req.body;

    if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: 'GEMINI_API_KEY não configurada no servidor.' });
    }

    // Construção do Prompt Otimizado para Finanças
    const prompt = `
    Atue como um Consultor Financeiro Sênior especialista no mercado brasileiro (B3).
    Analise a seguinte carteira de investimentos:

    DADOS TÉCNICOS:
    - Patrimônio Total: ${totalPatrimonio}
    - Ativos: ${JSON.stringify(carteira)}

    TAREFAS:
    1. Analise a diversificação atual (Setores, Papel vs Tijolo se houver FIIs).
    2. Identifique riscos potenciais (ex: concentração excessiva em um ativo).
    3. Dê uma nota de 0 a 10 para a saúde da carteira.
    4. Sugira 1 melhoria prática e direta.

    FORMATO DE RESPOSTA (Markdown):
    Use negrito para destacar valores e ativos. Seja direto, empático e profissional.
    Não use introduções genéricas. Vá direto ao ponto.
    `;

    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                contents: [{
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 1000,
                }
            },
            {
                headers: { 'Content-Type': 'application/json' }
            }
        );

        const aiText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!aiText) {
            throw new Error('Sem resposta da IA');
        }

        return res.status(200).json({ result: aiText });

    } catch (error) {
        console.error('Erro Gemini API:', error.response?.data || error.message);
        return res.status(500).json({ error: 'Erro ao processar análise de IA.' });
    }
}