// api/gemini.js
// Vercel Serverless Function (corrigida para usar chave do Google AI Studio)
// Usa header x-goog-api-key com o GEMINI_API_KEY e endpoint oficial generateContent
// Referências: Gemini quickstart / API docs.

async function fetchWithBackoff(url, options, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      // se 429 ou >=500, tenta novamente
      if (response.status === 429 || response.status >= 500) {
        const statusText = response.statusText || response.status;
        throw new Error(`API Error: ${response.status} ${statusText}`);
      }
      // tenta parse seguro do body (alguns erros não retornam JSON)
      const text = await response.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (e) { /* não-JSON */ }
      if (!response.ok) {
        const errMsg = json?.error?.message || text || response.statusText;
        throw new Error(errMsg);
      }
      return json ?? text;
    } catch (error) {
      if (i === retries - 1) throw error;
      console.warn(`Tentativa ${i + 1} falhou, aguardando ${delay * (i + 1)}ms...`, error.message);
      await new Promise(res => setTimeout(res, delay * (i + 1)));
    }
  }
}

// Construção do payload conforme quickstart (contents / parts)
function getGeminiPayload(mode, payload) {
  const { ticker, todayString, fiiList } = payload || {};
  let systemPrompt = '';
  let userQuery = '';

  switch (mode) {
    case 'historico_12m':
      systemPrompt = `Você é um assistente financeiro focado em FIIs (Fundos Imobiliários) brasileiros. Sua única tarefa é encontrar o histórico de proventos (dividendos) dos *últimos 12 meses* para o FII solicitado. Use a busca na web para garantir que a informação seja a mais recente (data de hoje: ${todayString}).\n\nResponda APENAS com um array JSON válido, sem nenhum outro texto, introdução ou markdown.\nOrdene a resposta do mais recente para o mais antigo (até 12 itens).\n\n- O mês deve estar no formato "MM/AA" (ex: "10/25").\n- O valor deve ser um número (ex: 0.10).\n\nExemplo de Resposta:\n[\n  {"mes": "10/25", "valor": 0.10},\n  {"mes": "09/25", "valor": 0.10}\n]\n\nSe não encontrar dados, retorne um array JSON vazio: []`;
      userQuery = `Gere o histórico de proventos JSON (últimos 12 meses) para o FII ${ticker}.`;
      break;

    case 'proventos_carteira':
      systemPrompt = `Você é um assistente financeiro focado em FIIs (Fundos Imobiliários) brasileiros. Sua tarefa é encontrar o valor e a data do provento (dividendo) mais recente anunciado para uma lista de FIIs. **Inclua proventos cujo pagamento está agendado para hoje (${todayString})** ou para uma data futura. Use a busca na web para garantir que a informação seja a mais recente.

TAREFA CRÍTICA: Ao buscar a data de pagamento, verifique ativamente por "fatos relevantes" ou "comunicados ao mercado" recentes (de hoje, ${todayString}) que possam ter *alterado* ou *corrigido* a data de pagamento anunciada. A data corrigida é a data correta.

Para FIIs sem provento futuro (ou para hoje) anunciado, retorne 'value' como 0 e 'paymentDate' como null.

IMPORTANTE: A data 'paymentDate' DEVE estar no formato AAAA-MM-DD (ex: 2025-11-07).

Responda APENAS com um array JSON válido, sem nenhum outro texto, introdução, markdown (\`\`\`) ou formatação.`;
      userQuery = `Encontre o provento mais recente anunciado (incluindo pagamentos de hoje, ${todayString}, e futuros) para os seguintes FIIs: ${fiiList?.join(', ')}. Verifique ativamente por fatos relevantes ou comunicados recentes que possam ter *corrigido* a data de pagamento.`;
      break;

    case 'historico_portfolio':
      systemPrompt = `Você é um assistente financeiro. Sua tarefa é encontrar o histórico de proventos (dividendos) *por cota* dos últimos 6 meses *completos*.\n\nNÃO inclua o mês atual (data de hoje: ${todayString}).\n\nResponda APENAS com um array JSON válido, sem nenhum outro texto, introdução ou markdown.\nOrdene a resposta do mês mais antigo para o mais recente.\n\n- O mês deve estar no formato "MM/AA" (ex: "10/25").\n- Se um FII não pagou em um mês, retorne 0 para ele.`;
      userQuery = `Gere o histórico de proventos por cota dos últimos 6 meses completos (não inclua o mês atual) para: ${fiiList?.join(', ')}.`;
      break;

    default:
      throw new Error("Modo de API Gemini inválido.");
  }

  // payload conforme docs (contents -> parts -> text). Colocamos o systemInstruction como texto concatenado
  const fullPrompt = (systemPrompt ? `SYSTEM:\n${systemPrompt}\n\n` : '') + `USER:\n${userQuery}`;
  return {
    contents: [
      {
        parts: [
          { text: fullPrompt }
        ]
      }
    ]
  };
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: "Método não permitido, use POST." });
  }

  const { GEMINI_API_KEY } = process.env;
  if (!GEMINI_API_KEY) {
    return response.status(500).json({ error: "Chave da API Gemini não configurada no servidor (GEMINI_API_KEY)." });
  }

  // Endpoint oficial (generateContent) e modelo estável (gemini-2.5-flash) conforme quickstart.
  const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`;

  try {
    const { mode, payload } = request.body;
    const geminiPayload = getGeminiPayload(mode, payload);

    // fetch com header x-goog-api-key (recomendado para chaves do AI Studio / Gemini quickstart)
    const result = await fetchWithBackoff(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY
      },
      body: JSON.stringify(geminiPayload)
    });

    // result já é JSON (fetchWithBackoff tenta parse)
    const candidate = result?.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text;

    if (!text) {
      console.warn('Resposta da API sem texto esperado:', JSON.stringify(result).slice(0, 200));
      throw new Error("A API retornou uma resposta sem campo de texto esperado.");
    }

    // Cache de 24 horas (ajuste conforme necessidade)
    response.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');

    // Para modos que esperam JSON estruturado, tentamos extrair um array JSON do texto.
    if (mode === 'proventos_carteira' || mode === 'historico_portfolio' || mode === 'historico_12m') {
      try {
        let jsonText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonMatch = jsonText.match(/\[.*\]/s);
        if (jsonMatch && jsonMatch[0]) jsonText = jsonMatch[0];
        const parsedJson = JSON.parse(jsonText);
        if (Array.isArray(parsedJson)) {
          return response.status(200).json({ json: parsedJson });
        } else {
          throw new Error("API retornou JSON porém não é um array.");
        }
      } catch (e) {
        console.warn(`[Alerta API Gemini] retorno inválido (forçando array vazio). Erro: ${e.message}`);
        return response.status(200).json({ json: [] });
      }
    } else {
      // resposta livre
      return response.status(200).json({ text: text.replace(/\*/g, '') });
    }
  } catch (error) {
    console.error("Erro interno no proxy Gemini:", error);
    return response.status(500).json({ error: `Erro interno no servidor: ${error.message}` });
  }
}