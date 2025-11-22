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
    // MODIFICAÇÃO NO PROMPT: Ênfase em URLs completas e proibição de abreviações.
    const systemPrompt = `Tarefa: Listar 9 notícias recentes de FIIs (Fundos Imobiliários) desta semana (${todayString}).
Fontes: Principais portais financeiros do Brasil.
ALERTA CRÍTICO: Não Busque no portal "Genial Analisa". 

Output: APENAS um array JSON válido. 
- NÃO use markdown. 
- NÃO coloque texto antes ou depois do JSON.
- NÃO abrevie URLs (ex: não use '...'). As URLs devem ser funcionais.

CAMPOS JSON OBRIGATÓRIOS:
- "title": Título.
- "summary": Resumo (2 frases).
- "sourceName": Portal.
- "sourceHostname": Domínio (ex: site.com.br).
- "url": URL COMPLETA e EXATA da notícia (incluindo https://).
- "publicationDate": YYYY-MM-DD.
- "relatedTickers": Array ["MXRF11"].

Seja preciso.`;

    const userQuery = `JSON com 9 notícias de FIIs desta semana (${todayString}). Use Google Search para pegar os links reais.`;

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

    // OBS: Verifique se o modelo 'gemini-2.5-flash' existe na sua conta. 
    // O padrão estável atual é 'gemini-1.5-flash'. Se der erro, troque para 1.5.
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

        // --- MODIFICAÇÃO CRÍTICA AQUI ---
        // Em vez de "limpar" o texto, nós EXTRAÍMOS apenas o JSON.
        // Isso evita que regex de replace quebre links ou caracteres especiais.
        let jsonString = text;
        
        // 1. Tenta encontrar o primeiro '[' e o último ']'
        const firstBracket = text.indexOf('[');
        const lastBracket = text.lastIndexOf(']');

        if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
            jsonString = text.substring(firstBracket, lastBracket + 1);
        } else {
            // Fallback: se não achar array, tenta limpar markdown como antes, mas com cuidado
            jsonString = text.replace(/```json/g, '').replace(/```/g, '').trim();
        }

        let parsedJson;
        try {
             parsedJson = JSON.parse(jsonString);
        } catch (e) {
             console.error("Falha no parse inicial, tentando limpar caracteres ocultos...", e);
             // Tenta uma limpeza secundária para caracteres de controle que as vezes vem da IA
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

        // Validação extra de URLs antes de enviar
        parsedJson = parsedJson.map(item => {
            // Se a URL vier sem protocolo, adiciona https://
            if (item.url && !item.url.startsWith('http')) {
                item.url = `https://${item.url}`;
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
