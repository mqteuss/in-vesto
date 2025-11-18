// /api/delete-user-self.js

import { createClient } from '@supabase/supabase-js';

// Função helper para lidar com as respostas e CORS
function createResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*', // Ajuste se necessário para o seu domínio
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

// O handler da Vercel
export default async function handler(req) {
  // 1. Lida com a requisição 'OPTIONS' (necessária para o navegador)
  if (req.method === 'OPTIONS') {
    return createResponse({ message: 'ok' }, 200);
  }

  // 2. Garante que é um método POST
  if (req.method !== 'POST') {
    return createResponse({ error: 'Método não permitido' }, 405);
  }

  try {
    // 3. Pega as chaves de ambiente da Vercel
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      console.error('[API Delete] Variáveis de ambiente não configuradas.');
      return createResponse({ error: 'Configuração do servidor incompleta.' }, 500);
    }

    // 4. Pega o ID do usuário que fez a chamada
    //    Primeiro, pegamos o token do cabeçalho
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return createResponse({ error: 'Token de autorização ausente.' }, 401);
    }

    //    Segundo, criamos um cliente com a 'anon key' para validar o token
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    
    const { data: { user }, error: userError } = await userClient.auth.getUser();

    // Se não conseguir identificar o usuário, retorna um erro
    if (userError || !user) {
      console.error('[API Delete] Erro ao autenticar usuário:', userError?.message);
      return createResponse({ error: 'Usuário não autenticado ou token inválido.' }, 401);
    }
    
    const userId = user.id;
    console.log(`[API Delete] Iniciando exclusão para user_id: ${userId}`);

    // 5. Cria um cliente "Admin" com a 'service_role_key'
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 6. DELETA OS DADOS DO USUÁRIO DE TODAS AS TABELAS
    const tables = [
      'transacoes',
      'patrimonio',
      'appstate',
      'proventosconhecidos',
      'watchlist'
    ];

    for (const table of tables) {
      console.log(`[API Delete] Deletando ${table} para ${userId}...`);
      const { error: deleteError } = await supabaseAdmin
        .from(table)
        .delete()
        .eq('user_id', userId); // <-- A MÁGICA: Só apaga onde o user_id é o do usuário logado
      
      if (deleteError) {
        console.error(`[API Delete] Erro ao deletar ${table}:`, deleteError.message);
        throw new Error(`Erro ao deletar dados da tabela ${table}`);
      }
    }

    // 7. DELETA O USUÁRIO DO SISTEMA DE AUTENTICAÇÃO
    console.log(`[API Delete] Deletando usuário da auth: ${userId}...`);
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    
    if (authError) {
      console.error(`[API Delete] Erro ao deletar usuário da auth:`, authError.message);
      throw new Error('Erro ao deletar usuário da autenticação');
    }

    console.log(`[API Delete] Usuário ${userId} excluído com sucesso.`);
    
    // 8. Retorna uma resposta de sucesso para o app.js
    return createResponse({ success: true, message: 'Conta excluída com sucesso.' }, 200);

  } catch (err) {
    // 9. Se algo der errado, retorna uma resposta de erro
    console.error('[API Delete] Erro geral:', err.message);
    return createResponse({ error: err.message || 'Erro interno do servidor.' }, 500);
  }
}
