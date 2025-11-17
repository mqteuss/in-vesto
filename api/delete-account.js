import { createClient } from '@supabase/supabase-js';

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Método não permitido' });
    }

    const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
        return response.status(500).json({ error: 'Configuração do servidor incompleta.' });
    }

    try {
        const token = request.headers.get('authorization')?.split('Bearer ')[1];
        if (!token) {
            return response.status(401).json({ error: 'Usuário não autenticado' });
        }
        
        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);

        if (userError || !user) {
            return response.status(401).json({ error: 'Token inválido ou expirado' });
        }

        const userId = user.id;

        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        const tablesToDelete = [
            'transacoes',
            'patrimonio',
            'appstate',
            'proventosconhecidos',
            'watchlist'
        ];

        const deletePromises = tablesToDelete.map(table => 
            supabaseAdmin.from(table).delete().eq('user_id', userId)
        );

        const results = await Promise.allSettled(deletePromises);

        results.forEach(result => {
            if (result.status === 'rejected') {
                throw new Error(`Falha ao limpar dados: ${result.reason.message}`);
            }
        });

        const { error: deleteAuthUserError } = await supabaseAdmin.auth.admin.deleteUser(userId);
        if (deleteAuthUserError) {
            throw new Error(`Falha ao excluir autenticação: ${deleteAuthUserError.message}`);
        }

        return response.status(200).json({ success: true, message: 'Conta excluída com sucesso' });

    } catch (error) {
        return response.status(500).json({ error: error.message || 'Erro interno do servidor' });
    }
}
