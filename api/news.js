// Definição do Schema para garantir que o Gemini devolva EXATAMENTE isso
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

async function fetchWithBackoff(url, options, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      
      // Lida com Rate Limiting (429) ou erros de servidor (5xx)
      if (response.status === 429 || response.status >= 500) {
        const text = await response.text();
        throw new Error(`Gemini API Error (${response.status}): ${text}`);
      }

      if (!response.ok) {
        const errorBody = await response.json();
        throw new Error(errorBody.error?.message || `API Error: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.warn(`[Tentativa ${i + 1}/${retries}] Falha: ${error.message}`);
      if (i === retries - 1) throw error;
      
      // Backoff exponencial (1s, 2s, 4s...)
      await new Promise(res => setTimeout(res, delay * Math.pow(2, i)));
    }
  }
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: "Method Not Allowed" });
  }

  const { NEWS_GEMINI_API_KEY } = process.env;
  if (!NEWS_GEMINI_API_KEY) {
    console.error("Erro: Chave de API não encontrada.");
    return response.status(500).json({ error: "Configuration Error" });
  }

  // Validação básica de entrada
  const { todayString } = request.body;
  if (!todayString) {
    return response.status(400).json({ error: "Missing 'todayString'" });
  }

  // Modelo: Usando 1.5 Flash (rápido e suporta Google Search + JSON Schema)
  const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${NEWS_GEMINI_API_KEY}`;

  const systemPrompt = `
    Você é um analista financeiro sênior especializado em Fundos Imobiliários (FIIs) no Brasil.
    DATA DE HOJE: ${todayString}.
    
    TAREFA:
    Pesquise e liste as 15 notícias mais impactantes sobre FIIs desta semana atual.
    Use a ferramenta de busca para encontrar fatos recentes, dividendos anunciados, emissões ou fatos relevantes.
    
    DIRETRIZES DE CONTEÚDO:
    1. Resumos devem ser JORNALÍSTICOS e DENSOS. Evite generalidades. Use números (R$, %, Datas) sempre que a notícia permitir.
    2. Ignore notícias especulativas sem fonte clara.
    3. Foque em fatos: "Fundo X anuncia dividendos de R$ 1,20", "Fundo Y compra imóvel por R$ 50mi".
  `;

  const payload = {
    contents: [{ parts: [{ text: `Encontre 15 notícias de FIIs da semana de ${todayString}.` }] }],
    tools: [{ google_search: {} }], // Ativa busca no Google
    generationConfig: {
      temperature: 0.3, // Baixa criatividade para evitar alucinação
      responseMimeType: "application/json", // FORÇA resposta JSON nativa
      responseSchema: NEWS_SCHEMA // Validação rigorosa da estrutura
    },
    systemInstruction: { parts: [{ text: systemPrompt }] }
  };

  try {
    const data = await fetchWithBackoff(GEMINI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    // Com responseMimeType + responseSchema, o parsing é seguro
    // O Gemini retorna o texto já formatado como JSON válido dentro de `text`
    const rawJSON = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawJSON) {
      throw new Error("Gemini retornou resposta vazia.");
    }

    let parsedNews;
    try {
        parsedNews = JSON.parse(rawJSON);
    } catch (e) {
        console.error("Falha no parse final (raro com Schema mode):", rawJSON);
        throw new Error("Falha ao processar dados do Gemini.");
    }

    // Cache no Vercel (Edge Caching) - 6 horas
    response.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=300');
    
    return response.status(200).json({ json: parsedNews });

  } catch (error) {
    console.error("Erro no Handler de Notícias:", error);
    return response.status(500).json({ 
      error: "Erro ao obter notícias.", 
      details: error.message 
    });
  }
}
