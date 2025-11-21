// Definição do Schema: Garante JSON perfeito sem precisar de Regex
const NEWS_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      title: { type: "STRING", description: "Título curto e direto (sem data/fonte), máx 60 chars." },
      summary: { type: "STRING", description: "Resumo denso (3-5 frases) com valores (R$), Yield (%) e impacto." },
      sourceName: { type: "STRING", description: "Nome do portal (ex: InfoMoney)." },
      sourceHostname: { type: "STRING", description: "Domínio da fonte (ex: infomoney.com.br)." },
      publicationDate: { type: "STRING", description: "Data formato YYYY-MM-DD." },
      relatedTickers: { type: "ARRAY", items: { type: "STRING" }, description: "Lista de tickers (ex: MXRF11)." }
    },
    required: ["title", "summary", "sourceName", "publicationDate", "relatedTickers"]
  }
};

async function fetchWithBackoff(url, options, retries = 2, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      
      if (!response.ok) {
        const errorText = await response.text();
        let errorMsg = errorText;
        // Tenta limpar a mensagem de erro se for JSON
        try {
            const errorJson = JSON.parse(errorText);
            errorMsg = errorJson.error?.message || errorText;
        } catch(e) {}

        throw new Error(`Gemini API Error (${response.status}): ${errorMsg}`);
      }

      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      console.warn(`[Tentativa ${i + 1}] Falha: ${error.message}. Aguardando...`);
      await new Promise(res => setTimeout(res, delay));
    }
  }
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: "Method Not Allowed. Use POST." });
  }

  const { NEWS_GEMINI_API_KEY } = process.env;
  if (!NEWS_GEMINI_API_KEY) {
    return response.status(500).json({ error: "API KEY do Gemini não configurada no servidor." });
  }

  const { todayString } = request.body;
  if (!todayString) {
    return response.status(400).json({ error: "Parâmetro 'todayString' é obrigatório." });
  }

  // --- CONFIGURAÇÃO CRÍTICA ---
  // 1. MODELO: Usamos 1.5 Flash (O 2.5 não existe, causando erro 404/500).
  const MODEL_VERSION = "gemini-1.5-flash"; 
  const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_VERSION}:generateContent?key=${NEWS_GEMINI_API_KEY}`;

  // 2. QUANTIDADE: Reduzida para 8 para evitar TIMEOUT da Vercel (limite de 10s).
  const systemPrompt = `
    Você é um analista financeiro sênior de FIIs.
    DATA DE HOJE: ${todayString}.
    
    TAREFA:
    Liste as 8 notícias mais importantes de FIIs desta semana.
    Use 'google_search' para achar fatos reais.
    
    DIRETRIZES:
    - Resumos JORNALÍSTICOS com números (R$, %) e Datas.
    - Ignore fofocas, foque em Fatos Relevantes e Dividendos.
  `;

  const payload = {
    contents: [{ parts: [{ text: `Encontre 8 notícias urgentes de FIIs da semana de ${todayString}.` }] }],
    tools: [{ google_search: {} }], 
    generationConfig: {
      temperature: 0.3,
      responseMimeType: "application/json",
      responseSchema: NEWS_SCHEMA
    },
    systemInstruction: { parts: [{ text: systemPrompt }] }
  };

  try {
    // Controller para forçar timeout interno antes da Vercel derrubar
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 9500); // 9.5 segundos

    const data = await fetchWithBackoff(GEMINI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    }).catch(err => {
        if (err.name === 'AbortError') throw new Error("O Gemini demorou demais para responder (Timeout).");
        throw err;
    });
    
    clearTimeout(timeoutId);

    const rawJSON = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawJSON) {
      throw new Error("Gemini respondeu ok, mas sem texto.");
    }

    // O JSON já vem limpo graças ao responseSchema
    const parsedNews = JSON.parse(rawJSON);

    response.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=300');
    return response.status(200).json({ json: parsedNews });

  } catch (error) {
    console.error("ERRO NO BACKEND:", error.message);
    // Retorna o erro exato para o frontend ler no console
    return response.status(500).json({ 
      error: "Falha ao buscar notícias.", 
      details: error.message 
    });
  }
}
