// Definição do Schema (Mantido para garantir JSON)
const NEWS_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      title: { type: "STRING", description: "Título curto sem data." },
      summary: { type: "STRING", description: "Resumo com valores (R$) e impacto." },
      sourceName: { type: "STRING" },
      sourceHostname: { type: "STRING" },
      publicationDate: { type: "STRING", description: "YYYY-MM-DD" },
      relatedTickers: { type: "ARRAY", items: { type: "STRING" } }
    },
    required: ["title", "summary", "sourceName", "publicationDate", "relatedTickers"]
  }
};

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: "Método inválido. Use POST." });
  }

  const { NEWS_GEMINI_API_KEY } = process.env;
  if (!NEWS_GEMINI_API_KEY) {
    return response.status(500).json({ error: "API Key ausente." });
  }

  const { todayString } = request.body;
  if (!todayString) {
    return response.status(400).json({ error: "Data obrigatória." });
  }

  // --- CORREÇÃO FINAL BASEADA NAS SUAS IMAGENS ---
  // 1. MODELO: 'gemini-2.0-flash'. 
  //    Motivo: Sua imagem mostra que o 2.5 está lotado (12/10) e o 1.5 sumiu.
  //    O 2.0 está livre (2/15) e suporta as ferramentas novas.
  const MODEL_VERSION = "gemini-2.0-flash"; 
  
  // 2. URL: Mantemos v1beta que é o padrão para a série 2.0/2.5
  const GEN_AI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_VERSION}:generateContent?key=${NEWS_GEMINI_API_KEY}`;

  const systemPrompt = `
    Analista FIIs. Data: ${todayString}.
    Tarefa: 5 notícias urgentes de FIIs.
    Regra: Use 'google_search' obrigatóriamente.
  `;

  const payload = {
    contents: [{ parts: [{ text: `Encontre 5 notícias recentes de FIIs (${todayString})` }] }],
    // A ferramenta de busca é suportada nativamente no 2.0 Flash
    tools: [{ google_search: {} }], 
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: NEWS_SCHEMA
    },
    systemInstruction: { parts: [{ text: systemPrompt }] }
  };

  try {
    // Timeout de 9.5s para não travar a Vercel (Limite de 10s)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 9500);

    const fetchResponse = await fetch(GEN_AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!fetchResponse.ok) {
      const errorText = await fetchResponse.text();
      let errorMessage = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error?.message || errorText;
      } catch (e) {}

      // Se der erro 429 (Too Many Requests), avisamos especificamente
      if (fetchResponse.status === 429) {
        throw new Error(`Cota excedida no modelo ${MODEL_VERSION}. Tente novamente em alguns segundos.`);
      }
      
      throw new Error(`Gemini Error (${fetchResponse.status}): ${errorMessage}`);
    }

    const data = await fetchResponse.json();
    const rawJSON = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawJSON) {
      throw new Error("IA respondeu sem conteúdo (filtro ou erro interno).");
    }

    const parsedNews = JSON.parse(rawJSON);

    response.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=600');
    return response.status(200).json({ json: parsedNews });

  } catch (error) {
    console.error("ERRO API:", error.message);
    
    let userMessage = error.message;
    if (error.name === 'AbortError') {
      userMessage = "O Google demorou muito para responder (Timeout). Tente atualizar novamente.";
    }

    return response.status(500).json({ error: userMessage });
  }
}
