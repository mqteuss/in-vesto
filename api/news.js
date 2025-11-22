const NEWS_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      title: { type: "STRING", description: "Título curto sem data." },
      summary: { type: "STRING", description: "Resumo detalhado (3-4 frases) com valores (R$) e impacto." },
      sourceName: { type: "STRING" },
      sourceHostname: { type: "STRING" },
      publicationDate: { type: "STRING", description: "YYYY-MM-DD" },
      relatedTickers: { type: "ARRAY", items: { type: "STRING" } }
    },
    required: ["title", "summary", "sourceName", "publicationDate", "relatedTickers"]
  }
};

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: "Use POST" });

  const { NEWS_GEMINI_API_KEY } = process.env;
  if (!NEWS_GEMINI_API_KEY) return response.status(500).json({ error: "API Key ausente" });

  const { todayString } = request.body;
  if (!todayString) return response.status(400).json({ error: "Data obrigatória" });

  // VENCEDOR: Gemini 2.0 Flash (Suporta Search + JSON Nativo e tem cota livre)
  const MODEL_VERSION = "gemini-2.0-flash"; 
  const GEN_AI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_VERSION}:generateContent?key=${NEWS_GEMINI_API_KEY}`;

  const systemPrompt = `
    Tarefa: Listar 10 notícias recentes de FIIs (Fundos Imobiliários) desta semana (${todayString}).
    Fontes: Principais portais financeiros do Brasil.
    Seja extremamente rápido e direto.
     `;

  const payload = {
    contents: [{ parts: [{ text: `Encontre 10 notícias recentes de FIIs (${todayString})` }] }],
    tools: [{ google_search: {} }], 
    generationConfig: {
      temperature: 0.3,
      responseMimeType: "application/json", // O 2.0 SUPORTA ISSO COM TOOLS
      responseSchema: NEWS_SCHEMA
    },
    systemInstruction: { parts: [{ text: systemPrompt }] }
  };

  try {
    // Sem timeout artificial, deixamos a Vercel gerenciar (10s limite)
    const fetchResponse = await fetch(GEN_AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!fetchResponse.ok) {
      const text = await fetchResponse.text();
      if (fetchResponse.status === 429) throw new Error("Muitas requisições (Cota excedida).");
      throw new Error(`Erro Gemini 2.0 (${fetchResponse.status}): ${text}`);
    }

    const data = await fetchResponse.json();
    const rawJSON = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawJSON) throw new Error("IA não retornou dados.");

    // Como usamos Native JSON, o parse é seguro
    const parsedNews = JSON.parse(rawJSON);

    response.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=600');
    return response.status(200).json({ json: parsedNews });

  } catch (error) {
    console.error("ERRO:", error.message);
    return response.status(500).json({ error: error.message });
  }
}
