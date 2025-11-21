async function fetchWithBackoff(url, options, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            // 429 = Too Many Requests, 5xx = Server Error
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

function getGeminiPayload(todayString) {
    // Otimização: Prompt direto e curto para processamento rápido.
    const systemPrompt = `Data de hoje: ${todayString}.
Tarefa: Buscar 10 notícias recentes (desta semana) sobre FIIs (Fundos Imobiliários) no Brasil.
Fontes aceitas: InfoMoney, Fiis.com.br, Seu Dinheiro, Money Times, Brazil Journal.
Saída: Retorne APENAS um array JSON.
Formato do objeto:
{
  "title": "Título curto",
  "summary": "Resumo conciso de 2 frases.",
  "sourceName": "Nome da Fonte",
  "sourceHostname": "dominio.com.br",
  "publicationDate": "YYYY-MM-DD",
  "relatedTickers": ["TICK11"] (ou [] se nenhum)
}`;

    const userQuery = `Liste as 10 notícias mais relevantes da semana sobre FIIs em JSON.`;

    return {
        contents: [{ parts: [{ text: userQuery }] }],
        tools: [{ "google_search": {} }], // Necessário para notícias recentes
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            temperature: 0.1, // Baixa temperatura = resposta mais rápida e direta
            response_mime_type: "application/json" // Força resposta JSON pura (MUITO mais rápido)
        }
    };
}

export default async function handler(request, response) {
    // Aceitar OPTIONS para CORS (se necessário) ou apenas POST
    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }
    if (request.method !== 'POST') {
        return response.status(405).json({ error: "Método não permitido, use POST." });
    }

    const { NEWS_GEMINI_API_KEY } = process.env;
    if (!NEWS_GEMINI_API_KEY) {
        return response.status(500).json({ error: "Chave NEWS_GEMINI_API_KEY não configurada." });
    }

    // MODELO ATUALIZADO: gemini-2.5-flash
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${NEWS_GEMINI_API_KEY}`;

    try {
        const { todayString } = request.body;
        if (!todayString) {
            return response.status(400).json({ error: "Parâmetro 'todayString' é obrigatório." });
        }

        const geminiPayload = getGeminiPayload(todayString);

        const result = await fetchWithBackoff(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiPayload)
        });

        const candidate = result?.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text;

        // Verificação de segurança básica
        if (candidate?.finishReason && candidate?.finishReason !== "STOP") {
             // Se não for STOP, pode ter truncado ou bloqueado, mas vamos tentar processar se houver texto.
             console.warn(`Aviso de API: Finish Reason ${candidate.finishReason}`);
        }

        if (!text) {
            throw new Error("A API retornou uma resposta vazia.");
        }

        response.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate');

        // OTIMIZAÇÃO: Como usamos response_mime_type: "application/json", 
        // o texto já vem limpo, sem Markdown (```json). Basta parsear.
        let parsedJson;
        try {
            parsedJson = JSON.parse(text);
        } catch (e) {
            // Fallback caso o modelo alucine e coloque markdown mesmo assim (raro com JSON mode)
            const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
            parsedJson = JSON.parse(cleanText);
        }

        if (!Array.isArray(parsedJson)) {
            // Se a API retornar um objeto único em vez de array, encapsula.
            parsedJson = [parsedJson]; 
        }

        return response.status(200).json({ json: parsedJson });

    } catch (error) {
        console.error("Erro interno no proxy Gemini (Notícias):", error);
        return response.status(500).json({ error: `Erro interno: ${error.message}` });
    }
}
