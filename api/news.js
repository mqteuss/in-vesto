// Configuração: Schema mantido
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

  // --- CONFIGURAÇÃO DE SEGURANÇA ---
  // Modelo: gemini-2.0-flash (Rápido e Disponível)
  const MODEL_VERSION = "gemini-2.0-flash"; 
  const GEN_AI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_VERSION}:generateContent?key=${NEWS_GEMINI_API_KEY}`;

  // --- AJUSTE FINAL: 8 NOTÍCIAS ---
  // 12 estoura o tempo limite de 10s da Vercel. 
  // 8 é o limite seguro para processar dentro de 9.5 segundos.
  const systemPrompt = `
    Analista FIIs. Data: ${todayString}.
    Tarefa: Listar 8 notícias relevantes de FIIs.
    Regra: Use 'google_search'. Seja sucinto e direto.
  `;

  const payload = {
    contents: [{ parts: [{ text: `Encontre 8 notícias recentes de FIIs (${todayString})` }] }],
    tools: [{ google_search: {} }], 
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: NEWS_SCHEMA
    },
    systemInstruction: { parts: [{ text: systemPrompt }] }
  };

  try {
    // Timeout de 9.5s (O limite da Vercel Free é 10s cravados)
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

      // Se der erro 429 (Too Many Requests)
      if (fetchResponse.status === 429) {
        throw new Error(`Muitas requisições ao Google. Tente em instantes.`);
      }
      
      throw new Error(`Erro Gemini (${fetchResponse.status}): ${errorMessage}`);
    }

    const data = await fetchResponse.json();
    const rawJSON = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawJSON) {
      throw new Error("IA não retornou dados.");
    }

    const parsedNews = JSON.parse(rawJSON);

    response.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=600');
    return response.status(200).json({ json: parsedNews });

  } catch (error) {
    console.error("ERRO API:", error.message);
    
    let userMessage = error.message;
    // Mensagem amigável para o Timeout
    if (error.name === 'AbortError') {
      userMessage = "A busca demorou muito (limite do servidor). Tente atualizar.";
    }

    return response.status(500).json({ error: userMessage });
  }
}
