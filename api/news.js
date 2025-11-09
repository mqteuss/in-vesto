// Constrói o payload para a API Gemini (Modo JSON de Resumos com Hostname)
function getGeminiPayload(todayString) {

    const systemPrompt = `Você é um editor de notícias financeiras. Sua tarefa é encontrar as 10 notícias mais recentes e relevantes sobre FIIs (Fundos Imobiliários) no Brasil, publicadas **nesta semana** (data de hoje: ${todayString}).

REGRAS:
1.  Encontre artigos de portais de notícias conhecidos (ex: InfoMoney, Fiis.com.br, Seu Dinheiro, Money Times).
2.  Responda APENAS com um array JSON válido. Não inclua \`\`\`json ou qualquer outro texto.
3.  Cada objeto no array deve conter 6 campos:
    - "title": O título exato ou ligeiramente abreviado da notícia.
    - "summary": Um resumo um pouco mais detalhado, com cerca de 3 a 5 frases, explicando o ponto principal e o contexto da notícia.
    - "sourceName": O nome do portal (ex: "InfoMoney").
    - "sourceHostname": O domínio raiz da fonte (ex: "infomoney.com.br"). ESTE CAMPO É OBRIGATÓRIO.
    - "publicationDate": A data da publicação no formato YYYY-MM-DD.
    - "relatedTickers": Um array de strings com os tickers de FIIs (ex: "MXRF11", "HGLG11") mencionados no título ou resumo. Se nenhum for mencionado, retorne um array vazio [].

EXEMPLO DE RESPOSTA JSON:
[
  {"title": "IFIX atinge nova máxima: O que esperar?", "summary": "O IFIX atiu nova máxima histórica nesta semana. Analistas debatem se o movimento é sustentável ou se uma correção está próxima, de olho na Selic.", "sourceName": "InfoMoney", "sourceHostname": "infomoney.com.br", "publicationDate": "2025-11-06", "relatedTickers": []},
  {"title": "HGLG11 e CPTS11 anunciam aquisições", "summary": "O fundo HGLG11 investiu R$ 63 milhões em galpões. Já o CPTS11 anunciou uma nova emissão.", "sourceName": "Money Times", "sourceHostname": "moneytimes.com.br", "publicationDate": "2025-11-05", "relatedTickers": ["HGLG11", "CPTS11"]}
]

IMPORTANTE: Sua resposta DEVE começar com '[' e terminar com ']'. Nenhuma outra palavra, frase ou formatação é permitida antes ou depois do array JSON.`;

    const userQuery = `Gere um array JSON com os 10 resumos de notícias mais recentes (desta semana, ${todayString}) sobre FIIs. Inclua "title", "summary", "sourceName", "sourceHostname", "publicationDate" (YYYY-MM-DD) e "relatedTickers" (array de FIIs mencionados).`;

    return {
        contents: [{ parts: [{ text: userQuery }] }],
        tools: [{ "google_search": {} }], 
        systemInstruction: { parts: [{ text: systemPrompt }] },
    };
}
