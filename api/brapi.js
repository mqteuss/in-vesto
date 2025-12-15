export default async function handler(request, response) {
    // 1. Configuração de CORS (Permite que seu site acesse a API)
    response.setHeader('Access-Control-Allow-Credentials', true);
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Responde rápido para requisições OPTIONS (Pre-flight do navegador)
    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }

    const { BRAPI_API_TOKEN } = process.env;

    if (!BRAPI_API_TOKEN) {
        return response.status(500).json({ error: "API Token não configurado." });
    }

    // 2. Extração segura do path
    const urlParts = new URL(request.url, `https://${request.headers.host}`);
    const pathArg = urlParts.searchParams.get('path');

    if (!pathArg) {
         return response.status(400).json({ error: "Parâmetro 'path' faltando." });
    }

    try {
        // 3. Montagem Inteligente da URL (Evita erros de ? ou &)
        // Remove a barra inicial se houver para evitar //api
        const cleanPath = pathArg.startsWith('/') ? pathArg.substring(1) : pathArg;
        
        // Constrói a URL base
        // Nota: Se o path já tiver query params (ex: quote/PETR4?range=1d),
        // o construtor URL lida com isso se montarmos corretamente.
        const targetUrl = new URL(`https://brapi.dev/api/${cleanPath}`);
        
        // Adiciona o token de forma segura
        targetUrl.searchParams.append('token', BRAPI_API_TOKEN);

        const apiResponse = await fetch(targetUrl.toString(), {
            headers: { 'Accept': 'application/json' },
            next: { revalidate: 300 } // Otimização para Next.js (se estiver usando)
        });

        const data = await apiResponse.json();

        if (!apiResponse.ok) {
            console.error("Erro Brapi:", data);
            return response.status(apiResponse.status).json(data);
        }

        // 4. Cache (Mantido sua boa configuração)
        // Cache por 5 minutos (300s)
        response.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

        return response.status(200).json(data);

    } catch (error) {
        console.error("Erro Proxy Brapi:", error);
        return response.status(500).json({ error: "Erro interno ao conectar na Brapi." });
    }
}