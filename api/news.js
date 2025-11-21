const newsSchema = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      title: { type: "STRING" },
      summary: { type: "STRING" },
      sourceName: { type: "STRING" },
      sourceHostname: { type: "STRING" },
      publicationDate: { type: "STRING" },
      relatedTickers: { 
        type: "ARRAY",
        items: { type: "STRING" }
      }
    },
    required: ["title", "summary", "sourceName", "relatedTickers"]
  }
};

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ error: "Método não permitido, use POST." });
    }

    const { NEWS_GEMINI_API_KEY } = process.env;
    if (!NEWS_GEMINI_API_KEY) {
        return response.status(500).json({ error: "Chave NEWS_GEMINI_API_KEY ausente." });
    }

    // URL restaurada para o seu modelo específico (gemini-2.5-flash)
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${NEWS_GEMINI_API_KEY}`;

    try {
        const { todayString } = request.body;
        if (!todayString) {
            return response.status(400).json({ error: "Falta o parâmetro 'todayString'." });
        }

        const payload = {
            contents: [{ 
                parts: [{ 
                    text: `Liste 10 notícias de FIIs desta semana (${todayString}). Use o Google Search.` 
                }] 
            }],
            tools: [{ google_search: {} }],
            generationConfig: {
                temperature: 0.1,
                // Força o JSON estruturado. Obrigatório usar responseSchema junto.
                responseMimeType: "application/json",
                responseSchema: newsSchema
            }
        };

        const result = await fetchWithBackoff(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // Verifica erro de segurança/bloqueio
        const candidate = result?.candidates?.[0];
        if (candidate?.finishReason && candidate?.finishReason !== "STOP") {
             // Loga o aviso, mas tenta processar se houver texto parcial válido
             console.warn(`Aviso Gemini: ${candidate.finishReason}`);
        }

        const contentText = candidate?.content?.parts?.[0]?.text;
        if (!contentText) throw new Error("API retornou texto vazio.");

        // Parse direto (sem regex) pois o responseMimeType garante o formato
        const parsedJson = JSON.parse(contentText);

        return response.status(200).json({ json: parsedJson });

    } catch (error) {
        console.error("Erro Handler Notícias:", error);
        return response.status(500).json({ error: error.message });
    }
}

// Função auxiliar de retentativa (mantida igual)
async function fetchWithBackoff(url, options, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                 const errTxt = await response.text();
                 // Se for erro 404, pode ser que o modelo 2.5 ainda não exista nessa rota/região
                 throw new Error(`Erro HTTP ${response.status}: ${errTxt}`);
            }
            return await response.json();
        } catch (error) {
            if (i === retries - 1) throw error;
            await new Promise(res => setTimeout(res, delay * (i + 1)));
        }
    }
}
