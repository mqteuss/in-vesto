// api/gemini.js
// Esta é uma Vercel Serverless Function.
// Ela atua como um proxy seguro para a API Google Gemini.

// --- OTIMIZAÇÃO: Timeout e Retentativa ---
// Adiciona um timeout global para a Vercel (10s) e ajusta as retentativas.
async function fetchWithBackoff(url, options, retries = 2, delay = 1000, globalTimeout = 9000) {
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort();
    }, globalTimeout);

    // Adiciona o signal ao 'options' do fetch
    const fetchOptions = {
        ...options,
        signal: controller.signal
    };

    let lastError;

    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, fetchOptions);
            
            if (response.status === 429 || response.status >= 500) {
                throw new Error(`API Error: ${response.status} ${response.statusText} (Tentativa ${i + 1})`);
            }
            if (!response.ok) {
                 const errorBody = await response.json();
                 throw new Error(errorBody.error?.message || `API Error: ${response.statusText} (Tentativa ${i + 1})`);
            }
            
            clearTimeout(timeoutId); // Sucesso!
            return response.json();

        } catch (error) {
            lastError = error; // Salva o último erro
            
            if (error.name === 'AbortError') {
                // Timeout global atingido
                console.error("Timeout global de 9s da IA atingido.");
                throw new Error("A API da IA demorou muito para responder (timeout de 9s no servidor).");
            }

            if (i === retries - 1) {
                 // Última tentativa falhou, desiste
                console.error("Última tentativa de fetch falhou.", error);
                break; // Sai do loop para lançar o último erro
            }
            
            // Aguarda antes da próxima tentativa
            console.warn(`Tentativa ${i+1} falhou, aguardando ${delay}ms...`);
            await new Promise(res => setTimeout(res, delay));
        }
    }
    
    clearTimeout(timeoutId); // Limpa o timeout
    throw lastError; // Lança o último erro
}
// --- FIM DA OTIMIZAÇÃO ---

// Constrói o payload para a API Gemini
function getGeminiPayload(mode, payload) {
    const { ticker, todayString, fiiList } = payload;
    let systemPrompt = '';
    let userQuery = '';

    switch (mode) {
        case 'proximo_provento':
            systemPrompt = `Você é um assistente financeiro focado em FIIs (Fundos Imobiliários) brasileiros. Sua única tarefa é encontrar o valor e a data do *próximo* pagamento de provento (dividendo) para o FII solicitado. Use a busca na web para garantir que a informação seja a mais recente (data de hoje: ${todayString}).\n\nResponda de forma concisa e direta em português, sem asteriscos.\n\nSe encontrar, responda:\n"O próximo provento do ${ticker} será de R$ [VALOR] por cota, com pagamento em [DATA]."\n\nSe nenhum provento futuro for anunciado, apenas diga:\n"Nenhum provento futuro foi anunciado para ${ticker}."`;
            userQuery = `Qual é o valor e a data do próximo pagamento de proventos para o FII ${ticker}?`;
            break;

        // --- OTIMIZAÇÃO: Remove busca na web para histórico ---
        case 'historico_12m':
            systemPrompt = `Você é um assistente financeiro focado em FIIs (Fundos Imobiliários) brasileiros. Sua única tarefa é encontrar o histórico de proventos (dividendos) dos *últimos 12 meses* para o FII solicitado, com base em seu conhecimento interno (data de hoje: ${todayString}).\n\nResponda em português.\n\nFormate a resposta EXATAMENTE assim, com um item por linha (do mais recente para o mais antigo) e sem nenhum outro texto, introdução ou asteriscos:\n[MM/AA]: R$ [VALOR]\n[MM/AA]: R$ [VALOR]\n... (até 12 linhas)\n\nExemplo:\n10/25: R$ 0,10\n09/25: R$ 0,10\n\nSe não encontrar dados, apenas diga:\n"Não foi possível encontrar o histórico de proventos dos últimos 12 meses para ${ticker}."`;
            userQuery = `Qual é o histórico de proventos (últimos 12 meses) para o FII ${ticker}?`;
            break;

        case 'proventos_carteira':
            systemPrompt = `Você é um assistente financeiro focado em FIIs (Fundos Imobiliários) brasileiros. Sua tarefa é encontrar o valor e a data do *próximo* pagamento de provento (dividendo) para uma lista de FIIs. Use a busca na web para garantir que a informação seja a mais recente (data de hoje: ${todayString}).\n\nPara FIIs sem provento futuro anunciado, retorne 'value' como 0 e 'paymentDate' como null.\n\nIMPORTANTE: A data 'paymentDate' DEVE estar no formato AAAA-MM-DD (ex: 2025-11-14).\n\nResponda APENAS com um array JSON válido, sem nenhum outro texto, introdução, markdown (\`\`\`) ou formatação.\n\nExemplo de resposta:\n[\n  {"symbol": "MXRF11", "value": 0.10, "paymentDate": "2025-11-14"},\n  {"symbol": "HGLG11", "value": 1.10, "paymentDate": "2025-11-14"},\n  {"symbol": "GARE11", "value": 0, "paymentDate": null}\n]`;
            userQuery = `Encontre o próximo provento para os seguintes FIIs: ${fiiList.join(', ')}.`;
            break;

        // --- OTIMIZAÇÃO: Remove busca na web para histórico ---
        case 'historico_portfolio':
            systemPrompt = `Você é um assistente financeiro. Sua tarefa é encontrar o histórico de proventos (dividendos) *por cota* dos últimos 6 meses *completos*, com base em seu conhecimento interno.\n\nNÃO inclua o mês atual (data de hoje: ${todayString}).\n\nResponda APENAS com um array JSON válido, sem nenhum outro texto, introdução ou markdown.\nOrdene a resposta do mês mais antigo para o mais recente.\n\n- O mês deve estar no formato "MM/AA" (ex: "10/25").\n- Se um FII não pagou em um mês, retorne 0 para ele.\n\nExemplo de Resposta (se hoje for Nov/2025):\n[\n  {"mes": "05/25", "MXRF11": 0.10, "GARE11": 0.08},\n  {"mes": "06/25", "MXRF11": 0.10, "GARE11": 0.08},\n  {"mes": "07/25", "MXRF11": 0.10, "GARE11": 0.08},\n  {"mes": "08/25", "MXRF11": 0.10, "GARE11": 0},\n  {"mes": "09/25", "MXRF11": 0.11, "GARE11": 0.09},\n  {"mes": "10/25", "MXRF11": 0.11, "GARE11": 0.09}\n]`;
            userQuery = `Gere o histórico de proventos por cota dos últimos 6 meses completos (não inclua o mês atual) para: ${fiiList.join(', ')}.`;
            break;
            
        default:
            throw new Error("Modo de API Gemini inválido.");
    }

    // --- OTIMIZAÇÃO: Busca na web condicional ---
    const geminiPayload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
    };

    // Apenas adicione a busca na web (ferramenta) para dados em tempo real.
    // Dados históricos podem usar o conhecimento interno do modelo,
    // o que é MUITO mais rápido e evita timeouts de 10s na Vercel.
    if (mode === 'proximo_provento' || mode === 'proventos_carteira') {
        geminiPayload.tools = [{ "google_search": {} }];
    }
    // --- FIM DA OTIMIZAÇÃO ---

    return geminiPayload;
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
    
    // O nome do modelo 'gemini-2.5-flash-preview-09-2025' foi mantido como no seu arquivo original
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`;

    try {
        const { mode, payload } = request.body;
        const geminiPayload = getGeminiPayload(mode, payload);

        // A função de fetch otimizada é chamada aqui
        const result = await fetchWithBackoff(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiPayload)
        });

        const candidate = result?.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text;

        if (candidate?.finishReason !== "STOP" && candidate?.finishReason !== "MAX_TOKSENS") {
             if (candidate?.finishReason) {
                 throw new Error(`A resposta foi bloqueada. Razão: ${candidate.finishReason}`);
             }
        }
        if (!text) {
            throw new Error("A API retornou uma resposta vazia.");
        }
        
        // Adiciona Caching
        response.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate');

        // Retorna JSON ou texto limpo baseado no modo
        if (mode === 'proventos_carteira' || mode === 'historico_portfolio') {
            // Estes modos esperam JSON, então limpamos e parseamos
            let jsonText = text.replace(/```json/g, '').replace(/```/g, '').trim();
            const jsonMatch = jsonText.match(/\[.*\]/s);
            if (jsonMatch && jsonMatch[0]) {
                jsonText = jsonMatch[0];
            }
            return response.status(200).json({ json: JSON.parse(jsonText) });
        } else {
            // Estes modos esperam texto
            return response.status(200).json({ text: text.replace(/\*/g, '') });
        }

    } catch (error) {
        console.error("Erro interno no proxy Gemini:", error);
        // Agora, se o erro for o nosso timeout de 9s, a mensagem será mais clara
        return response.status(500).json({ error: `Erro interno no servidor: ${error.message}` });
    }
}
