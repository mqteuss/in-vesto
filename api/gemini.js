// Schema 1: Histórico Individual (Para o gráfico de barras do modal de detalhes)
const HISTORICO_INDIVIDUAL_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      mes: { type: "STRING", description: "Mês/Ano formato MM/AA (ex: 11/25)" },
      valor: { type: "NUMBER", description: "Valor pago por cota em Reais (ex: 0.10)" }
    },
    required: ["mes", "valor"]
  }
};

// Schema 2: Proventos Futuros (Para a previsão de ganhos)
const PROVENTOS_FUTUROS_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      symbol: { type: "STRING" },
      paymentDate: { type: "STRING", description: "Formato YYYY-MM-DD" },
      value: { type: "NUMBER", description: "Valor do provento por cota" }
    },
    required: ["symbol", "paymentDate", "value"]
  }
};

// Schema 3: Lista Bruta de Pagamentos (Para o histórico consolidado do portfólio)
const LISTA_PAGAMENTOS_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      ticker: { type: "STRING" },
      dataPagamento: { type: "STRING", description: "YYYY-MM-DD" },
      valor: { type: "NUMBER" }
    },
    required: ["ticker", "dataPagamento", "valor"]
  }
};

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: "Use POST" });

  // OBS: Aqui estou usando a mesma variável que usamos no news.js
  // Se no seu env for GEMINI_API_KEY, ajuste aqui.
  const API_KEY = process.env.NEWS_GEMINI_API_KEY || process.env.GEMINI_API_KEY; 
  
  if (!API_KEY) return response.status(500).json({ error: "API Key ausente" });

  const { mode, payload } = request.body;
  
  // VENCEDOR: Gemini 2.0 Flash (Suporta Search + JSON Nativo e tem cota livre)
  const MODEL = "gemini-2.0-flash";
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

  let systemPrompt = "";
  let userPrompt = "";
  let schema = null;

  if (mode === 'historico_12m') {
    schema = HISTORICO_INDIVIDUAL_SCHEMA;
    systemPrompt = `
      Analista de FIIs. Data Hoje: ${payload.todayString}.
      Tarefa: Pesquise o histórico de dividendos PAGOS pelo fundo ${payload.ticker} nos últimos 12 meses.
      Retorne apenas Mês/Ano (MM/AA) e Valor.
      Ordene do mais recente para o mais antigo.
    `;
    userPrompt = `Histórico de dividendos do ${payload.ticker} (últimos 12 meses).`;

  } else if (mode === 'proventos_carteira') {
    schema = PROVENTOS_FUTUROS_SCHEMA;
    const lista = payload.fiiList.join(", ");
    systemPrompt = `
      Analista FIIs. Data Hoje: ${payload.todayString}.
      Tarefa: Pesquise se há dividendos ANUNCIADOS (Data Com já passou) com pagamento futuro ou muito recente (neste mês) para estes fundos: ${lista}.
      Retorne apenas os confirmados OFICIALMENTE. Se não houver previsão, não invente.
    `;
    userPrompt = `Próximos dividendos para: ${lista}`;

  } else if (mode === 'historico_portfolio') {
    schema = LISTA_PAGAMENTOS_SCHEMA;
    const lista = payload.fiiList.join(", ");
    systemPrompt = `
      Analista FIIs. Data Hoje: ${payload.todayString}.
      Tarefa: Pesquise os dividendos PAGOS por estes fundos nos últimos 6 meses: ${lista}.
      Liste cada pagamento individualmente com data exata e valor.
    `;
    userPrompt = `Histórico de pagamentos dos últimos 6 meses para: ${lista}`;
  } else {
    return response.status(400).json({ error: "Modo inválido" });
  }

  const apiPayload = {
    contents: [{ parts: [{ text: userPrompt }] }],
    tools: [{ google_search: {} }], 
    generationConfig: {
      temperature: 0.1, 
      responseMimeType: "application/json",
      responseSchema: schema
    },
    systemInstruction: { parts: [{ text: systemPrompt }] }
  };

  try {
    const fetchResponse = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(apiPayload)
    });

    if (!fetchResponse.ok) {
        const txt = await fetchResponse.text();
        throw new Error(`Erro Gemini (${fetchResponse.status}): ${txt}`);
    }

    const data = await fetchResponse.json();
    const rawJSON = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!rawJSON) throw new Error("IA não retornou dados.");

    let resultData = JSON.parse(rawJSON);

    // Adapta o formato para o modo portfolio (Array de Objetos por Mês)
    if (mode === 'historico_portfolio') {
        const agrupadoPorMes = {};
        resultData.forEach(item => {
            if (!item.dataPagamento) return;
            const parts = item.dataPagamento.split('-'); // [YYYY, MM, DD]
            if(parts.length < 3) return;
            
            const anoCurto = parts[0].slice(2); 
            const mesChave = `${parts[1]}/${anoCurto}`; 

            if (!agrupadoPorMes[mesChave]) {
                agrupadoPorMes[mesChave] = { mes: mesChave };
            }
            agrupadoPorMes[mesChave][item.ticker] = item.valor;
        });
        
        // Retorna apenas a lista de meses, ordenada se necessário
        resultData = Object.values(agrupadoPorMes);
    }
    
    // Para manter compatibilidade com seu frontend que espera { json: [...] }
    if (mode === 'historico_12m' || mode === 'proventos_carteira' || mode === 'historico_portfolio') {
         // O frontend antigo pode estar esperando um objeto { json: [...] } ou array direto.
         // Seu código original retornava { json: parsedJson }. Vamos manter.
         return response.status(200).json({ json: resultData });
    }

    // Cache
    response.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=3600');
    return response.status(200).json(resultData);

  } catch (error) {
    console.error("ERRO GEMINI API:", error.message);
    // Retorna array vazio encapsulado em json para não quebrar o frontend
    return response.status(200).json({ json: [] }); 
  }
}
