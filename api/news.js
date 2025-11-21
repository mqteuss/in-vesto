// Schema define estritamente o formato do JSON para o Gemini
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
        return response.status(405).json({ error: "Método não permitido." });
    }

    const { NEWS_GEMINI_API_KEY } = process.env;
    /* ... suas validações de chave ... */

    // Use o modelo Flash padrão (ajuste a versão conforme disponibilidade da sua conta)
    // Nota: gemini-2.0-flash-exp costuma ser excelente para isso
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${NEWS_GEMINI_API_KEY}`;

    try {
        const { todayString } = request.body;
        
        const payload = {
            contents: [{ 
                parts: [{ 
                    text: `Encontre 10 notícias relevantes sobre Fundos Imobiliários (FIIs) desta semana (${todayString}) usando o Google Search.` 
                }] 
            }],
            tools: [{ google_search: {} }],
            generationConfig: {
                temperature: 0.3, // Levemente maior para variar as fontes
                responseMimeType: "application/json",
                responseSchema: newsSchema // <--- O SEGREDO ESTÁ AQUI
            }
        };

        // Reutilizando sua função de backoff (que está ótima)
        const result = await fetchWithBackoff(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const candidate = result?.candidates?.[0];
        
        // Tratamento de erro de segurança/bloqueio
        if (candidate?.finishReason && candidate?.finishReason !== "STOP") {
             console.warn("Bloqueio Gemini:", candidate.finishReason);
             // Às vezes o JSON vem mesmo com MAX_TOKENS, então tentamos ler
        }

        const contentText = candidate?.content?.parts?.[0]?.text;

        if (!contentText) {
            throw new Error("Conteúdo vazio retornado pela API.");
        }

        // Como usamos Native JSON, não precisa de regex/replace
        const parsedJson = JSON.parse(contentText);

        return response.status(200).json({ json: parsedJson });

    } catch (error) {
        console.error("Erro API Notícias:", error);
        return response.status(500).json({ error: error.message });
    }
}

// Mantenha sua função fetchWithBackoff igual, ela está correta.
async function fetchWithBackoff(url, options, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            
            // Tratamento específico para erros 4xx/5xx antes de tentar o JSON
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            return await response.json();
        } catch (error) {
            if (i === retries - 1) throw error;
            await new Promise(res => setTimeout(res, delay * (i + 1)));
        }
    }
}
