função assíncrona fetchWithBackoff(url, opções, tentativas = 3, atraso = 1000) {
    para (seja i = 0; i < tentativas; i++) {
        tentar {
            const resposta = await fetch(url, opções);
            se (resposta.status === 429 || resposta.status >= 500) {
                throw new Error(`Erro de API: ${response.status} ${response.statusText}`);
            }
            se (!response.ok) {
                 const errorBody = await response.json();
                 throw new Error(errorBody.error?.message || `Erro de API: ${response.statusText}`);
            }
            retornar response.json();
        } catch (erro) {
            se (i === tentativas - 1) lançar erro;
            console.warn(`Tentativa ${i+1} falhada, aguardando ${delay * (i + 1)}ms...`);
            await new Promise(res => setTimeout(res, delay * (i + 1)));
        }
    }
}

função getGeminiPayload(todayString) {

    const systemPrompt = `Você é um editor de notícias financeiras. Sua tarefa é encontrar as 10 notícias mais recentes e relevantes sobre FIIs (Fundos Imobiliários) no Brasil, publicadas **nesta semana** (dados de hoje: ${todayString}).

REGISTRO:
1. Encontre artigos de portais de notícias conhecidas (ex: InfoMoney, Fiis.com.br, Seu Dinheiro, Money Times).
2. Responda APENAS com um array JSON válido. Não inclua \`\`\`json ou qualquer outro texto.
3. Cada objeto no array deve conter 6 campos:
    - "título": O título exato ou reduzido abreviado da notícia.
    - "resumo": Um resumo da notícia com 3 ou 4 frases (ligeiramente maior).
    - "sourceName": O nome do portal (ex: "InfoMoney").
    - "sourceHostname": O domínio raiz da fonte (ex: "infomoney.com.br"). ESTE CAMPO É OBRIGATÓRIO.
    - "publicationDate": Um dado da publicação no formato AAAA-MM-DD.
    - "relacionadoTickers": Um array de strings com os tickers de FIIs (ex: "MXRF11", "HGLG11") referências no título ou resumo. Se nenhum for mencionado, retorne um array vazio [].

EXEMPLO DE RESPOSTA JSON:
[
  {"title": "IFIX atinge nova máxima: O que esperar?", "summary": "O IFIX atiu nova máxima histórica nesta semana. Analistas debatem se o movimento é sustentável ou se uma correção está próxima, de olho na Selic.", "sourceName": "InfoMoney", "sourceHostname": "infomoney.com.br", "publicationDate": "2025-11-06", "relacionadoTickers": []},
  {"title": "HGLG11 e CPTS11 anunciam aquisições", "summary": "O fundo HGLG11 investiu R$ 63 milhões em galpões. Já o CPTS11 anunciou uma nova emissão.", "sourceName": "Money Times", "sourceHostname": "moneytimes.com.br", "publicationDate": "2025-11-05", "relacionadoTickers": ["HGLG11", "CPTS11"]}
]

IMPORTANTE: Sua resposta DEVE começar com '[' e terminar com ']'. Nenhuma outra palavra, frase ou formato é permitida antes ou depois do array JSON.`;

    const userQuery = `Gere um array JSON com os 10 resumos de notícias mais recentes (desta semana, ${todayString}) sobre FIIs. Inclui "title", "summary", "sourceName", "sourceHostname", "publicationDate" (YYYY-MM-DD) e "relatedTickers" (array de FIIs referenciados).`;

    retornar {
        conteúdo: [{ partes: [{ texto: userQuery }] }],
        ferramentas: [{ "google_search": {} }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
    };
}

export default async function handler(request, response) {
    se (request.method !== 'POST') {
        return response.status(405).json({ error: "Método não permitido, use POST." });
    }

    const { NEWS_GEMINI_API_KEY } = process.env;
    se (!NEWS_GEMINI_API_KEY) {
        return response.status(500).json({ error: "Chave NEWS_GEMINI_API_KEY não está configurada no servidor." });
    }

    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${NEWS_GEMINI_API_KEY}`;

    tentar {
        const { todayString } = request.body;
        se (!todayString) {
            return response.status(400).json({ error: "Parâmetro 'todayString' é obrigatório." });
        }

        const geminiPayload = getGeminiPayload(todayString);

        const result = await fetchWithBackoff(GEMINI_API_URL, {
            método: 'POST',
            cabeçalhos: { 'Content-Type': 'application/json' },
            corpo: JSON.stringify(geminiPayload)
        });

        const candidato = resultado?.candidatos?.[0];
        const text = candidate?.content?.parts?.[0]?.text;

        se (candidato?.finishReason !== "PARAR" && candidato?.finishReason !== "MAX_TOKSENS") {
             se (candidato?.finishReason) {
                 throw new Error(`A resposta foi bloqueada. Razão: ${candidate.finishReason}`);
             }
        }
        se (!texto) {
            throw new Error("A API retornau uma resposta vazia.");
        }

        response.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate');

        let jsonText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonMatch = jsonText.match(/\[.*\]/s);

        deixe parsedJson;

        se (jsonMatch && jsonMatch[0]) {
            tentar {
                parsedJson = JSON.parse(jsonMatch[0]);
            } catch (e) {
                console.error("Erro ao fazer parse do JSON encontrado (match):", e.message);
                throw new Error(`Erro interno ao processar JSON: ${e.message}`);
            }
        } outro {
            tentar {
                 parsedJson = JSON.parse(jsonText);
                 se (!Array.isArray(parsedJson)) {
                     throw new Error("API retornou um JSON válido, mas não um array.");
                 }
            } catch (e) {
                console.warn("[Alerta API News] A API retornou texto em vez de JSON:", jsonText);
                throw new Error(`Uma API de notícias retornando texto inesperado: ${jsonText.substring(0, 50)}...`);
            }
        }

        retornar response.status(200).json({ json: parsedJson });

    } catch (erro) {
        console.error("Erro interno no proxy Gemini (Notícias):", erro);
        return response.status(500).json({ erro: `Erro interno no servidor: ${error.message}` });
    }
}