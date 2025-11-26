// Removemos a dependência do axios para usar o fetch nativo (mais leve e seguro no Vercel)
// Isso evita erros de "import vs require"

export default async function handler(req, res) {
    // 1. CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    // 2. Debug da Chave (Não mostra a chave inteira por segurança, apenas se existe)
    console.log("Iniciando requisição IA...");
    if (!process.env.GEMINI_API_KEY) {
        console.error("ERRO FATAL: GEMINI_API_KEY não definida no ambiente Vercel.");
        return res.status(500).json({ error: 'Servidor mal configurado (API Key ausente).' });
    }

    try {
        const { carteira, totalPatrimonio } = req.body;

        // Prompt
        const prompt = `
        Atue como Consultor Financeiro. Analise esta carteira B3:
        Patrimônio: ${totalPatrimonio}
        Ativos: ${JSON.stringify(carteira)}
        
        Tarefas:
        1. Diversificação e Riscos.
        2. Nota (0-10).
        3. Uma sugestão prática.
        
        Responda em Markdown.
        `;

        // 3. Chamada Fetch
        // Se o modelo 2.5 não funcionar, o log vai mostrar o erro 404 ou 400 do Google.
        // Tente 'gemini-1.5-flash' se 'gemini-2.5-flash' der erro de modelo não encontrado.
        const modelVersion = 'gemini-2.5-flash'; 
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelVersion}:generateContent?key=${process.env.GEMINI_API_KEY}`;
        
        console.log(`Chamando Google API: ${modelVersion}`);

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.7, maxOutputTokens: 1000 }
            })
        });

        const data = await response.json();

        // Tratamento de erro específico da API do Google
        if (!response.ok) {
            console.error("Erro da Google API:", JSON.stringify(data, null, 2));
            throw new Error(`Google API Error: ${data.error?.message || response.statusText}`);
        }

        const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!aiText) throw new Error("Resposta da IA veio vazia.");

        return res.status(200).json({ result: aiText });

    } catch (error) {
        console.error("ERRO NO HANDLER:", error);
        return res.status(500).json({ error: `Erro interno: ${error.message}` });
    }
}
