// api/config.js

export default async function handler(request, response) {
    
    // Pega as chaves do ambiente Vercel
    const { SUPABASE_URL, SUPABASE_KEY } = process.env;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        return response.status(500).json({ error: "Variáveis do SupABASE não configuradas no servidor." });
    }

    // Envia as chaves públicas para o cliente
    return response.status(200).json({
        supabaseUrl: SUPABASE_URL,
        supabaseKey: SUPABASE_KEY // Esta é a chave 'anon' (pública), é seguro enviá-la
    });
}
