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
    const systemPrompt = `Tarefa: Listar 10 notícias recentes de FIIs (Fundos Imobiliários) desta semana (${todayString}).
Fontes: Principais portais financeiros do Brasil.
ALERTA CRÍTICO: Não Busque no portal "Genial Analisa". 

Output: APENAS um array JSON válido. 
- NÃO use markdown. 
- NÃO coloque texto antes ou depois do JSON.
- NÃO abrevie URLs.

CAMPOS JSON OBRIGATÓRIOS:
- "title": Título.
- "summary": Resumo (3 frases).
- "sourceName": Portal.
- "sourceHostname": Domínio (ex: site.com.br).
- "url": URL COMPLETA e EXATA da notícia.
- "imageUrl": URL da imagem de capa/destaque (retorne null se não encontrar).
- "publicationDate": YYYY-MM-DD.
- "relatedTickers": Array ["MXRF11"].

Seja preciso.`;

    // Adicionamos o pedido explícito por imagens na query do usuário também
    const userQuery = `JSON com 10 notícias de FIIs desta semana (${todayString}). Tente incluir a URL da imagem de capa (imageUrl) encontrada na busca.`;

    return {
        contents: [{ parts: [{ text: userQuery }] }],
        tools: [{ "google_search": {} }],
        generationConfig: {
            temperature: 0.1, 
        },
        systemInstruction: { parts: [{ text: systemPrompt }] },
    };
}

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ error: "Método não permitido, use POST." });
    }

    const { NEWS_GEMINI_API_KEY } = process.env;
    if (!NEWS_GEMINI_API_KEY) {
        return response.status(500).json({ error: "Chave NEWS_GEMINI_API_KEY não configurada no servidor." });
    }

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
        }, 3, 1000);

        const candidate = result?.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text;

        if (!text) {
            throw new Error("A API retornou uma resposta vazia.");
        }

        let jsonString = text;
        const firstBracket = text.indexOf('[');
        const lastBracket = text.lastIndexOf(']');

        if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
            jsonString = text.substring(firstBracket, lastBracket + 1);
        } else {
            jsonString = text.replace(/```json/g, '').replace(/```/g, '').trim();
        }

        let parsedJson;
        try {
             parsedJson = JSON.parse(jsonString);
        } catch (e) {
             try {
                const sanitized = jsonString.replace(/[\u0000-\u001F\u007F-\u009F]/g, ""); 
                parsedJson = JSON.parse(sanitized);
             } catch (innerE) {
                console.error("Texto recebido da IA:", text);
                throw new Error("JSON inválido na resposta da IA.");
             }
        }

        if (!Array.isArray(parsedJson)) {
            parsedJson = [parsedJson]; 
        }

        parsedJson = parsedJson.map(item => {
            if (item.url && !item.url.startsWith('http')) {
                item.url = `https://${item.url}`;
            }
            // Validação básica de imagem
            if (item.imageUrl && !item.imageUrl.startsWith('http')) {
                item.imageUrl = null;
            }
            return item;
        });

        response.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate');
        return response.status(200).json({ json: parsedJson });

    } catch (error) {
        console.error("Erro interno no proxy Gemini (Notícias):", error);
        return response.status(500).json({ error: `Erro interno no servidor: ${error.message}` });
    }
}
