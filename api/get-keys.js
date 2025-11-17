export default async function handler(request, response) {
    
    const { URL_SUPABASE, SUPABASE_ANON_KEY } = process.env;

    if (!URL_SUPABASE || !SUPABASE_ANON_KEY) {
        return response.status(500).json({ 
            error: "Configuração do servidor incompleta. As chaves do Supabase não foram encontradas." 
        });
    }

    response.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    
    return response.status(200).json({
        supabaseUrl: URL_SUPABASE,
        supabaseKey: SUPABASE_ANON_KEY
    });
}
