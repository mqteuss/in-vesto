export default async function handler(request, response) {
    const { BRAPI_API_TOKEN } = process.env;

    if (!BRAPI_API_TOKEN) {
        return response.status(500).json({ error: "Chave da API Brapi não configurada no servidor." });
    }

    const urlParts = new URL(request.url, `https://${request.headers.host}`);
    const pathWithQuery = urlParts.searchParams.get('path');

    if (!pathWithQuery) {
         return response.status(400).json({ error: "Parâmetro 'path' é obrigatório." });
    }

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

        response.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate');

        return response.status(200).json(data);

    } catch (error) {
        console.error("Erro interno no proxy Brapi:", error);
        return response.status(500).json({ error: `Erro interno no servidor: ${error.message}` });
    }
}
