// Configuração: Schema mantido (JSON estruturado)
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

  // --- CONFIGURAÇÃO OTIMIZADA ---
  // Modelo: gemini-2.0-flash (Rápido e com cota disponível, conforme seu print)
  const MODEL_VERSION = "gemini-2.0-flash"; 
  const GEN_AI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_VERSION}:generateContent?key=${NEWS_GEMINI_API_KEY}`;

  // --- AJUSTE DE QUANTIDADE ---
  // Aumentamos de 5 para 12.
  // O prompt foi otimizado para ser direto e não gastar tempo "pensando".
  const systemPrompt = `
    Analista FIIs. Data: ${todayString}.
    Tarefa: Listar entre 10 a 12 notícias relevantes de FIIs da semana.
    Regra: Use 'google_search'. Priorize fatos relevantes (Dividendos, Emissões, Vacância, Vendas) sobre opinião.
  `;

  const payload = {
    contents: [{ parts: [{ text: `Encontre 12 notícias recentes de FIIs (${todayString})` }] }],
    tools: [{ google_search: {} }], 
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: NEWS_SCHEMA
    },
    systemInstruction: { parts: [{ text: systemPrompt }] }
  };

  try {
    // Timeout mantido em 9.5s para proteger contra o erro 504 da Vercel.
    // O gemini-2.0-flash costuma ser capaz de gerar 12 itens nesse tempo.
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

      if (fetchResponse.status === 429) {
        throw new Error(`Muitas requisições. Aguarde um momento.`);
      }
      
      throw new Error(`Erro Gemini (${fetchResponse.status}): ${errorMessage}`);
    }

    const data = await fetchResponse.json();
    const rawJSON = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawJSON) {
      throw new Error("IA não retornou dados.");
    }

    const parsedNews = JSON.parse(rawJSON);

    // Cache de 30 minutos para economizar sua cota
    response.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=600');
    return response.status(200).json({ json: parsedNews });

  } catch (error) {
    console.error("ERRO API:", error.message);
    
    let userMessage = error.message;
    if (error.name === 'AbortError') {
      // Se cair aqui, é porque 12 notícias pesou demais para 10 segundos.
      userMessage = "A busca demorou muito. Tente novamente para recarregar.";
    }

    return response.status(500).json({ error: userMessage });
  }
}
