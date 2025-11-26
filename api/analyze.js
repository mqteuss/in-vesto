const axios = require('axios');

module.exports = async (req, res) => {
    // 1. Configuração de CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    // 2. Responder imediatamente a preflight requests (OPTIONS)
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // 3. Verificação da API Key
    if (!process.env.GEMINI_API_KEY) {
        console.error("ERRO: GEMINI_API_KEY não encontrada nas variáveis de ambiente.");
        return res.status(500).json({ error: 'Configuração de servidor ausente (API KEY).' });
    }

    const { carteira, totalPatrimonio } = req.body;

    // Prompt
    const prompt = `
    Atue como um Consultor Financeiro Sênior especialista no mercado brasileiro (B3).
    Analise a seguinte carteira de investimentos:

    DADOS TÉCNICOS:
    - Patrimônio Total: ${totalPatrimonio}
    - Ativos: ${JSON.stringify(carteira)}

    TAREFAS:
    1. Analise a diversificação atual (Setores, Papel vs Tijolo se houver FIIs).
    2. Identifique riscos potenciais.
    3. Dê uma nota de 0 a 10 para a saúde da carteira.
    4. Sugira 1 melhoria prática.

    FORMATO: Markdown, direto e profissional.
    `;

    try {
        // 4. Chamada à API
        // Nota: Se o modelo 'gemini-2.5-flash' falhar, tente mudar para 'gemini-1.5-flash'
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
            console.error("ERRO: Resposta da IA veio vazia.", JSON.stringify(response.data));
            throw new Error('Sem resposta da IA');
        }

        return res.status(200).json({ result: aiText });

    } catch (error) {
        // Log detalhado para você ver no painel da Vercel
        const erroDetalhe = error.response?.data || error.message;
        console.error('ERRO CRÍTICO NA API DO GEMINI:', JSON.stringify(erroDetalhe, null, 2));
        
        return res.status(500).json({ 
            error: 'Erro ao processar análise.',
            details: erroDetalhe // Envia o detalhe para o front (apenas para debug)
        });
    }
};
