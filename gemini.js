// api/gemini.js
// Esta é uma Vercel Serverless Function.
// Ela atua como um proxy seguro para a API Google Gemini.

// Função de retry (backoff) para o servidor
async function fetchWithBackoff(url, options, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.status === 429 || response.status >= 500) {
                throw new Error(`API Error: ${response.status} ${response.statusText}`);
            }
            if (!response.ok) {
                 const errorBody = await response.json();
                 throw new Error(errorBody.error?.message || `API Error: ${response.statusText}`);
            }
            return response.json();
        } catch (error) {
            if (i === retries - 1) throw error;
            console.warn(`Tentativa ${i+1} falhou, aguardando ${delay * (i + 1)}ms...`);
            await new Promise(res => setTimeout(res, delay * (i + 1)));
        }
    }
}

// Constrói o payload para a API Gemini
function getGeminiPayload(mode, payload) {
    const { ticker, todayString, fiiList } = payload;
    let systemPrompt = '';
    let userQuery = '';

    switch (mode) {

        case 'historico_12m':
            systemPrompt = `Você é um assistente financeiro focado em FIIs (Fundos Imobiliários) brasileiros. Sua única tarefa é encontrar o histórico de proventos (dividendos) dos *últimos 12 meses* para o FII solicitado. Use a busca na web para garantir que a informação seja a mais recente (data de hoje: ${todayString}).\n\nResponda APENAS com um array JSON válido, sem nenhum outro texto, introdução ou markdown.\nOrdene a resposta do mais recente para o mais antigo (até 12 itens).\n\n- O mês deve estar no formato "MM/AA" (ex: "10/25").\n- O valor deve ser um número (ex: 0.10).\n\nExemplo de Resposta:\n[\n  {"mes": "10/25", "valor": 0.10},\n  {"mes": "09/25", "valor": 0.10}\n]\n\nSe não encontrar dados, retorne um array JSON vazio: []`;
            userQuery = `Gere o histórico de proventos JSON (últimos 12 meses) para o FII ${ticker}.`;
            break;

        case 'proventos_carteira':
            // **** ALTERAÇÃO AQUI ****
            systemPrompt = `Você é um assistente financeiro focado em FIIs (Fundos Imobiliários) brasileiros. Sua tarefa é encontrar o valor e a data do provento (dividendo) mais recente **OFICIALMENTE ANUNCIADO** para uma lista de FIIs.
Sua busca deve focar APENAS em proventos cujo pagamento está agendado para **hoje (${todayString})** ou para uma **data futura**.

TAREFA CRÍTICA / ALERTA:
1.  Busque ativamente por "fatos relevantes" ou "comunicados ao mercado" recentes (de hoje, ${todayString}) que possam ter *alterado* ou *corrigido* a data de pagamento anunciada.
2.  Se um provento futuro (com pagamento hoje ou depois) **NÃO FOI OFICIALMENTE ANUNCIADO** (via fato relevante ou comunicado), **NÃO ADIVINHE**, não projete, e não use datas de meses passados como base.
3.  Nestes casos (sem anúncio oficial futuro), a resposta DEVE ser 'value' como 0 e 'paymentDate' como null.

IMPORTANTE: A data 'paymentDate' DEVE estar no formato AAAA-MM-DD (ex: 2025-11-07).

Responda APENAS com um array JSON válido, sem nenhum outro texto, introdução, markdown (\`\`\`) ou formatação.

Exemplo de resposta (se hoje for 07/11/2025 e GARE11 tem um anúncio oficial de pagamento para hoje, mas HGLG11 não tem anúncio futuro):
[
  {"symbol": "MXRF11", "value": 0.10, "paymentDate": "2025-11-15"},
  {"symbol": "GARE11", "value": 0.08, "paymentDate": "2025-11-07"},
  {"symbol": "HGLG11", "value": 0, "paymentDate": null} 
]`;
            // **** FIM DA ALTERAÇÃO ****

            userQuery = `Encontre o provento mais recente **oficialmente anunciado** (incluindo pagamentos de hoje, ${todayString}, e futuros) para os FIIs: ${fiiList.join(', ')}. Verifique ativamente por fatos relevantes ou comunicados recentes que possam ter *corrigido* a data de pagamento. Não adivinhe pagamentos futuros que não foram anunciados.`;
            break;

        case 'historico_portfolio':
            systemPrompt = `Você é um assistente financeiro. Sua tarefa é encontrar o histórico de proventos (dividendos) *por cota* dos últimos 6 meses *completos*.\n\nNÃO inclua o mês atual (data de hoje: ${todayString}).\n\nResponda APENAS com um array JSON válido, sem nenhum outro texto, introdução ou markdown.\nOrdene a resposta do mês mais antigo para o mais recente.\n\n- O mês deve estar no formato "MM/AA" (ex: "10/25").\n- Se um FII não pagou em um mês, retorne 0 para ele.\n\nExemplo de Resposta (se hoje for Nov/2025):\n[\n  {"mes": "05/25", "MXRF11": 0.10, "GARE11": 0.08},\n  {"mes": "06/25", "MXRF11": 0.10, "GARE11": 0.08},\n  {"mes": "07/25", "MXRF11": 0.10, "GARE11": 0.08},\n  {"mes": "08/25", "MXRF11": 0.10, "GARE11": 0},\n  {"mes": "09/25", "MXRF11": 0.11, "GARE11": 0.09},\n  {"mes": "10/25", "MXRF11": 0.11, "GARE11": 0.09}\n]`;
            userQuery = `Gere o histórico de proventos por cota dos últimos 6 meses completos (não inclua o mês atual) para: ${fiiList.join(', ')}.`;
            break;

        default:
            throw new Error("Modo de API Gemini inválido.");
    }

    return {
        contents: [{ parts: [{ text: userQuery }] }],
        tools: [{ "google_search": {} }], 
        systemInstruction: { parts: [{ text: systemPrompt }] },
    };
}

// Handler principal da Vercel Serverless Function
export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ error: "Método não permitido, use POST." });
    }

    const { GEMINI_API_KEY } = process.env;
    if (!GEMINI_API_KEY) {
        return response.status(500).json({ error: "Chave da API Gemini não configurada no servidor." });
    }

    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`;

    try {
        const { mode, payload } = request.body;
        const geminiPayload = getGeminiPayload(mode, payload);

        const result = await fetchWithBackoff(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiPayload)
        });

        const candidate = result?.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text;

        if (candidate?.finishReason !== "STOP" && candidate?.finishReason !== "MAX_TOKENS") { // Corrigido MAX_TOKSENS -> MAX_TOKENS
             if (candidate?.finishReason) {
                 throw new Error(`A resposta foi bloqueada. Razão: ${candidate.finishReason}`);
             }
        }
        if (!text) {
            throw new Error("A API retornou uma resposta vazia.");
        }

        // Cache de 24 horas (86400 segundos)
        response.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate'); 

        if (mode === 'proventos_carteira' || mode === 'historico_portfolio' || mode === 'historico_12m') {
            try {
                let jsonText = text.replace(/```json/g, '').replace(/```/g, '').trim();
                const jsonMatch = jsonText.match(/\[.*\]/s); // Tenta encontrar um array [ ... ]

                if (jsonMatch && jsonMatch[0]) {
                    jsonText = jsonMatch[0];
                }

                const parsedJson = JSON.parse(jsonText);

                if (Array.isArray(parsedJson)) {
                    return response.status(200).json({ json: parsedJson });
                } else {
                    throw new Error("API retornou um JSON válido, mas não um array.");
                }
            } catch (e) {
                console.warn(`[Alerta API Gemini] A API retornou texto inválido ("${text}") em vez de JSON. Retornando array vazio. Erro: ${e.message}`);
                return response.status(200).json({ json: [] }); 
            }
        } else {
            return response.status(200).json({ text: text.replace(/\*/g, '') });
        }

    } catch (error) {
        console.error("Erro interno no proxy Gemini:", error);
        return response.status(500).json({ error: `Erro interno no servidor: ${error.message}` });
    }
}