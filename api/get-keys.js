// api/get-keys.js
// Esta é uma Vercel Serverless Function.
// Ela envia as chaves públicas do Supabase para o cliente de forma segura.

export default async function handler(request, response) {
    
    // Pega as chaves públicas das Variáveis de Ambiente do Vercel
    // CORRIGIDO: Lendo 'SUPABASE_URL' (como na sua imagem) em vez de 'URL_SUPABASE'
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        console.error("Erro: Chaves do Supabase (SUPABASE_URL ou SUPABASE_ANON_KEY) não configuradas no Vercel.");
        return response.status(500).json({ 
            error: "Configuração do servidor incompleta. As chaves do Supabase não foram encontradas." 
        });
    }

    // Adiciona Caching na borda do Vercel por 1 hora (3600 segundos)
    // Essas chaves são públicas e não mudam, então o cache é seguro.
    response.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    
    // Envia as chaves para o cliente
    return response.status(200).json({
        supabaseUrl: SUPABASE_URL, // CORRIGIDO
        supabaseKey: SUPABASE_ANON_KEY
    });
}