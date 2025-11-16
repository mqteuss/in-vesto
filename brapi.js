// api/brapi.js
// Esta é uma Vercel Serverless Function.
// Ela atua como um proxy seguro para a API Brapi.

export default async function handler(request, response) {
    // Pega o token secreto das Variáveis de Ambiente do Vercel
    const { BRAPI_API_TOKEN } = process.env;

    if (!BRAPI_API_TOKEN) {
        return response.status(500).json({ error: "Chave da API Brapi não configurada no servidor." });
    }

    // Pega o caminho da URL (ex: /quote/PETR4?range=1d)
    // Usamos 'request.url' para pegar o caminho completo com query params
    const urlParts = new URL(request.url, `https://${request.headers.host}`);
    const pathWithQuery = urlParts.searchParams.get('path');

    if (!pathWithQuery) {
         return response.status(400).json({ error: "Parâmetro 'path' é obrigatório." });
    }

    // Adiciona o token na URL da Brapi
    // Verifica se já existe uma '?' para adicionar '&' ou '?'
    const separator = pathWithQuery.includes('?') ? '&' : '?';
    const apiUrl = `https://brapi.dev/api${pathWithQuery}${separator}token=${BRAPI_API_TOKEN}`;

    try {
        const apiResponse = await fetch(apiUrl, {
            headers: {
                'Accept': 'application/json',
            }
        });

        if (!apiResponse.ok) {
            const errorData = await apiResponse.text();
            console.error("Erro da API Brapi:", errorData);
            return response.status(apiResponse.status).json({ error: `Erro da API Brapi: ${apiResponse.statusText}` });
        }

        const data = await apiResponse.json();

        // Adiciona Caching na borda do Vercel por 10 minutos (600 segundos)
        response.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate');

        return response.status(200).json(data);

    } catch (error) {
        console.error("Erro interno no proxy Brapi:", error);
        return response.status(500).json({ error: `Erro interno no servidor: ${error.message}` });
    }
}