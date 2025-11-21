// Definição do Schema (Mantido)
const NEWS_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      title: { type: "STRING", description: "Título curto sem data." },
      summary: { type: "STRING", description: "Resumo detalhado (3-4 frases) com valores, contexto e impacto." }, // Descrição ajustada
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

  // --- CONFIGURAÇÃO ---
  const MODEL_VERSION = "gemini-2.5-flash"; 
  const GEN_AI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_VERSION}:generateContent?key=${NEWS_GEMINI_API_KEY}`;

  // --- PROMPT AJUSTADO PARA QUALIDADE ---
  // Removida a instrução de "ser sucinto".
  // Adicionada exigência de profundidade.
  const systemPrompt = `
    Você é um analista sênior de Fundos Imobiliários (FIIs).
    Data de Hoje: ${todayString}.
    
    TAREFA:
    Pesquise e compile 8 notícias impactantes e recentes sobre FIIs.
    
    REGRAS DE QUALIDADE:
    1. OBRIGATÓRIO: Cada resumo deve ter entre 3 a 5 frases.
    2. CONTEÚDO: Explique o "porquê" da notícia. Inclua valores (R$), Dividend Yield (%), Cap Rate ou Vacância sempre que disponível na fonte.
    3. Não entregue frases genéricas como "O fundo anunciou dividendos". Diga "O fundo MXRF11 anunciou dividendos de R$ 0,10 por cota, um aumento de..."
    4. Use a ferramenta 'google_search' para garantir a veracidade.
  `;

  const payload = {
    contents: [{ parts: [{ text: `Encontre 8 notícias detalhadas de FIIs da semana de ${todayString}` }] }],
    tools: [{ google_search: {} }], 
    generationConfig: {
      temperature: 0.1, // Um pouco mais criativo para permitir textos mais longos
      responseMimeType: "application/json",
      responseSchema: NEWS_SCHEMA
    },
    systemInstruction: { parts: [{ text: systemPrompt }] }
  };

  try {
    // --- REMOVIDO O ABORT CONTROLLER (TIMEOUT) ---
    // Agora o código vai esperar a resposta do Gemini até o limite nativo da plataforma (Vercel/Server).
    
    const fetchResponse = await fetch(GEN_AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!fetchResponse.ok) {
      const errorText = await fetchResponse.text();
      let errorMessage = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error?.message || errorText;
      } catch (e) {}

      if (fetchResponse.status === 429) {
        throw new Error(`Gemini 2.5 sobrecarregado (Rate Limit). Tente novamente.`);
      }
      
      throw new Error(`Erro Gemini (${fetchResponse.status}): ${errorMessage}`);
    }

    const data = await fetchResponse.json();
    const rawJSON = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawJSON) {
      throw new Error("A IA não gerou texto (verifique filtros de segurança).");
    }

    const parsedNews = JSON.parse(rawJSON);

    response.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=600');
    return response.status(200).json({ json: parsedNews });

  } catch (error) {
    console.error("ERRO API:", error.message);
    return response.status(500).json({ error: error.message });
  }
}
