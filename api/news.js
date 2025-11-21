// Definição do Schema: Obriga o Gemini a devolver JSON perfeito e estruturado.
const NEWS_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      title: { type: "STRING", description: "Título curto e direto (sem data/fonte), máx 60 chars." },
      summary: { type: "STRING", description: "Resumo denso (3-5 frases) com valores (R$), Yield (%) e impacto para o investidor." },
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
      // Se for a última tentativa, lança o erro
      if (i === retries - 1) throw error;
      
      console.warn(`[Tentativa ${i + 1}/${retries}] Falha: ${error.message}. Aguardando...`);
      // Backoff exponencial (1s, 2s, 4s...)
      await new Promise(res => setTimeout(res, delay * Math.pow(2, i)));
    }
  }
}

export default async function handler(request, response) {
  // Garante que só aceita POST
  if (request.method !== 'POST') {
    return response.status(405).json({ error: "Method Not Allowed. Use POST." });
  }

  const { NEWS_GEMINI_API_KEY } = process.env;
  if (!NEWS_GEMINI_API_KEY) {
    console.error("Erro Crítico: NEWS_GEMINI_API_KEY não definida.");
    return response.status(500).json({ error: "Server Configuration Error" });
  }

  // Validação de entrada
  const { todayString } = request.body;
  if (!todayString) {
    return response.status(400).json({ error: "Parâmetro 'todayString' é obrigatório." });
  }

  // --- CONFIGURAÇÃO DO MODELO EXATA ---
  // Configurado explicitamente para 'gemini-2.5-flash' conforme solicitado
  const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${NEWS_GEMINI_API_KEY}`;

  const systemPrompt = `
    Você é um analista financeiro sênior especializado em Fundos Imobiliários (FIIs).
    DATA DE HOJE: ${todayString}.
    
    TAREFA:
    Pesquise e liste as 15 notícias mais impactantes sobre FIIs da semana atual.
    
    DIRETRIZES:
    1. Use a ferramenta 'google_search' para encontrar fatos recentes, dividendos e emissões.
    2. Resumos devem ser JORNALÍSTICOS e DENSOS. Use números (R$, %, Datas) obrigatoriamente.
    3. Ignore notícias especulativas sem fonte.
    4. Foque em fatos: "Fundo X anuncia dividendos de R$ 1,20", "Fundo Y compra imóvel por R$ 50mi".
  `;

  const payload = {
    contents: [{ parts: [{ text: `Encontre 15 notícias de FIIs da semana de ${todayString} com valores detalhados.` }] }],
    
    // Ferramenta de busca ativa
    tools: [{ google_search: {} }], 
    
    generationConfig: {
      temperature: 0.3, // Foco em precisão
      responseMimeType: "application/json", // Garante o retorno JSON nativo
      responseSchema: NEWS_SCHEMA // Validação da estrutura definida no topo
    },
    
    systemInstruction: { parts: [{ text: systemPrompt }] }
  };

  try {
    // Chamada à API com retries automáticos
    const data = await fetchWithBackoff(GEMINI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    // Extração segura sem regex (formato nativo JSON)
    const rawJSON = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawJSON) {
      throw new Error("Gemini retornou resposta vazia (sem candidatos).");
    }

    let parsedNews;
    try {
        // O Gemini agora retorna apenas o JSON puro, sem markdown, graças ao responseMimeType
        parsedNews = JSON.parse(rawJSON);
    } catch (e) {
        console.error("Erro de Parse JSON:", rawJSON);
        throw new Error("Falha ao processar a resposta do Gemini.");
    }

    // Cache no Vercel (6 horas de cache compartilhado, 5 min de stale)
    response.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=300');
    
    return response.status(200).json({ json: parsedNews });

  } catch (error) {
    console.error("Erro na API de Notícias:", error);
    return response.status(500).json({ 
      error: "Erro ao buscar notícias.", 
      details: error.message 
    });
  }
}
