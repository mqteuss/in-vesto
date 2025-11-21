// Configuração: Schema simplificado para processamento ultra-rápido
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
  // 1. Garante método POST
  if (request.method !== 'POST') {
    return response.status(405).json({ error: "Método inválido. Use POST." });
  }

  // 2. Verifica a Chave de API
  const { NEWS_GEMINI_API_KEY } = process.env;
  if (!NEWS_GEMINI_API_KEY) {
    console.error("ERRO FATAL: NEWS_GEMINI_API_KEY não encontrada.");
    return response.status(500).json({ error: "Configuração de servidor inválida (API Key ausente)." });
  }

  const { todayString } = request.body;
  if (!todayString) {
    return response.status(400).json({ error: "Data obrigatória." });
  }

  // 3. CONFIGURAÇÃO DE ALTA VELOCIDADE
  // Usamos o 'gemini-1.5-flash-8b', que é a versão mais rápida e leve do Google atualmente.
  const GEN_AI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-8b:generateContent?key=${NEWS_GEMINI_API_KEY}`;

  const systemPrompt = `
    Analista FIIs. Data: ${todayString}.
    Tarefa: 5 notícias urgentes de FIIs da semana.
    Regra: Use 'google_search'. Resumos curtos com valores. Fatos reais apenas.
  `;

  const payload = {
    contents: [{ parts: [{ text: `5 notícias recentes de FIIs (${todayString})` }] }],
    tools: [{ google_search: {} }], // Busca ativa
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2000,
      responseMimeType: "application/json",
      responseSchema: NEWS_SCHEMA
    },
    systemInstruction: { parts: [{ text: systemPrompt }] }
  };

  try {
    // 4. Controle de Timeout Rigoroso (9 segundos para não estourar o limite da Vercel)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 9000);

    const fetchResponse = await fetch(GEN_AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // 5. Tratamento de Erro Detalhado (para você ver o motivo real no frontend)
    if (!fetchResponse.ok) {
      const errorText = await fetchResponse.text();
      let errorMessage = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error?.message || errorText;
      } catch (e) {} // Falha silenciosa no parse
      
      console.error("Erro Gemini API:", errorMessage);
      throw new Error(`Gemini recusou: ${errorMessage}`);
    }

    const data = await fetchResponse.json();
    const rawJSON = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawJSON) {
      throw new Error("IA respondeu vazio (possível filtro de segurança).");
    }

    const parsedNews = JSON.parse(rawJSON);

    // Cache curto (30 min)
    response.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=600');
    return response.status(200).json({ json: parsedNews });

  } catch (error) {
    console.error("FALHA NO HANDLER:", error);
    
    // Mensagem de erro amigável dependendo do caso
    let userMessage = error.message;
    if (error.name === 'AbortError') {
      userMessage = "Tempo limite excedido (Google demorou mais de 9s). Tente novamente.";
    }

    // Retorna o erro no campo 'error' para aparecer no seu Toast vermelho
    return response.status(500).json({ error: userMessage });
  }
}
