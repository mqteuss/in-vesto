// api/analyze.js
// Baseado na arquitetura robusta do seu gemini.js

// 1. Função auxiliar de Retry (Idêntica à sua original)
async function fetchWithBackoff(url, options, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            
            // Se der erro de servidor ou rate limit, tenta de novo
            if (response.status === 429 || response.status >= 500) {
                throw new Error(`API Error: ${response.status} ${response.statusText}`);
            }
            
            if (!response.ok) {
                 const errorBody = await response.json();
                 throw new Error(errorBody.error?.message || `API Error: ${response.statusText}`);
            }
            return response.json();
        } catch (error) {
            if (i === retries - 1) throw error;
            console.warn(`Tentativa ${i+1} falhou, aguardando ${delay * (i + 1)}ms...`);
            await new Promise(res => setTimeout(res, delay * (i + 1)));
        }
    }
}

export default async function handler(req, res) {
    // 2. Configuração de CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    // 3. Verificação da Chave
    const { GEMINI_API_KEY } = process.env;
    if (!GEMINI_API_KEY) {
        console.error("ERRO: GEMINI_API_KEY não configurada.");
        return res.status(500).json({ error: "Chave de API não configurada no servidor." });
    }

    // URL do modelo específico que você usava no arquivo antigo
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`;

    try {
        const { carteira, totalPatrimonio } = req.body;

        // 4. Construção do Prompt (Adaptado para Consultoria)
        const systemPrompt = `
        Você é um Consultor Financeiro Sênior especialista no mercado brasileiro (B3).
        Sua tarefa é analisar carteiras de investimentos de forma direta, técnica, mas acessível.
        Não use introduções genéricas como "Olá, sou sua IA". Vá direto aos dados.
        Use Markdown para formatar a resposta (negrito, listas).
        `;

        const userQuery = `
        Analise a seguinte carteira:
        - Patrimônio Total: ${totalPatrimonio}
        - Ativos: ${JSON.stringify(carteira)}

        Gere um relatório contendo EXATAMENTE estes 4 pontos:
        1. **Diversificação**: Analise a distribuição (Setores, Papel vs Tijolo, Ações vs FIIs).
        2. **Riscos**: Identifique concentrações perigosas ou ativos voláteis.
        3. **Nota (0 a 10)**: Dê uma nota para a saúde da carteira e justifique brevemente.
        4. **Sugestão Prática**: Indique 1 movimento (compra, venda ou manutenção) que faria sentido agora.
        `;

        // Payload no formato nativo da API REST do Google
        const geminiPayload = {
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 1000
            }
        };

        // 5. Chamada usando sua função robusta
        const result = await fetchWithBackoff(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiPayload)
        });

        const candidate = result?.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text;

        if (!text) {
            throw new Error("A API retornou uma resposta vazia ou foi bloqueada.");
        }

        // Retorna o resultado
        return res.status(200).json({ result: text });

    } catch (error) {
        console.error("Erro interno no Analyze API:", error);
        return res.status(500).json({ 
            error: 'Erro ao processar análise.',
            details: error.message 
        });
    }
}
