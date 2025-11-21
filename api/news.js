async function fetchWithBackoff(url, options, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
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
    // Prompt reforçado para evitar "conversa" já que não temos o JSON Mode
    const systemPrompt = `Você é um motor de busca de notícias financeiras focado em velocidade e precisão JSON.
Data de referência: ${todayString}.

TAREFA:
1. Busque as 10 notícias mais importantes desta semana sobre Fundos Imobiliários (FIIs) no Brasil.
2. Fontes confiáveis: InfoMoney, Fiis.com.br, Brazil Journal, Money Times, Suno.
3. IMPORTANTE: Sua resposta deve ser ESTRITAMENTE um Array JSON válido.
4. NÃO escreva introduções como "Aqui está o JSON". Comece com '[' e termine com ']'.
5. Se não encontrar 10, envie as que encontrar.

SCHEMA DO JSON (Array de Objetos):
[
  {
    "title": "Título da notícia",
    "summary": "Resumo curto de 2 frases.",
    "sourceName": "Fonte (ex: InfoMoney)",
    "sourceHostname": "infomoney.com.br",
    "publicationDate": "YYYY-MM-DD",
    "relatedTickers": ["HGLG11", "MXRF11"] (Array vazio [] se nenhum ticker for citado)
  }
]`;

    const userQuery = `Retorne o JSON com as notícias da semana (${todayString}).`;

    return {
        contents: [{ parts: [{ text: userQuery }] }],
        tools: [{ "google_search": {} }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            temperature: 0.1, // Baixa temperatura reduz a chance de alucinação de texto extra
            // response_mime_type REMOVIDO
        }
    };
}

export default async function handler(request, response) {
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

    // Mantendo o modelo rápido
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

        if (!text) {
            throw new Error("A API retornou uma resposta vazia.");
        }

        response.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate');

        // TRATAMENTO DE TEXTO (Essencial sem JSON Mode)
        // Remove blocos de código markdown e espaços extras
        let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        
        // Tenta encontrar o array JSON dentro do texto caso o modelo tenha falado algo antes
        const jsonMatch = cleanText.match(/\[[\s\S]*\]/);
        
        let parsedJson;
        try {
            if (jsonMatch) {
                parsedJson = JSON.parse(jsonMatch[0]);
            } else {
                parsedJson = JSON.parse(cleanText);
            }
        } catch (e) {
            console.warn("Falha ao parsear JSON, texto bruto:", text);
            throw new Error("O modelo retornou um formato inválido. Tente novamente.");
        }

        return response.status(200).json({ json: parsedJson });

    } catch (error) {
        console.error("Erro interno no proxy Gemini (Notícias):", error);
        return response.status(500).json({ error: `Erro interno: ${error.message}` });
    }
}
