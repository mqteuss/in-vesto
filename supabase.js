// supabase.js
// Módulo para gerenciar a autenticação e o banco de dados Supabase.
// VERSÃO CORRIGIDA (com nomes de tabela e COLUNA em minúsculas)

// Pega o cliente Supabase carregado pelo CDN no index.html
const { createClient } = supabase;
let supabaseClient = null;

/**
 * Lida com erros do Supabase e retorna uma mensagem amigável.
 */
function handleSupabaseError(error, context) {
    console.error(`Erro no Supabase (${context}):`, error);
    if (error.code === '42501') { // RLS policy violation
        return "Erro de permissão. Contate o suporte.";
    }
    if (error.message.includes("fetch")) {
        return "Erro de rede. Verifique sua conexão.";
    }
    if (error.message.includes("invalid JWT") || error.message.includes("Invalid token")) {
        return "Sessão inválida. Por favor, faça login novamente.";
    }
    if (error.message.includes("Email not confirmed")) {
         return "Email não confirmado. Verifique sua caixa de entrada.";
    }
    return error.hint || error.message || "Ocorreu um erro desconhecido.";
}

/**
 * 1. INICIALIZAÇÃO E AUTENTICAÇÃO
 */

/**
 * Inicializa o cliente Supabase.
 * Busca as chaves da API e configura o listener de autenticação.
 */
export async function initialize() {
    try {
        // 1. Buscar as chaves do Vercel
        const response = await fetch('/api/get-keys');
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || "Não foi possível carregar as chaves do servidor.");
        }
        const { supabaseUrl, supabaseKey } = await response.json();

        // 2. Inicializar o cliente
        supabaseClient = createClient(supabaseUrl, supabaseKey, {
            auth: {
                persistSession: true, 
                autoRefreshToken: true,
                detectSessionInUrl: true
            },
        });

        // 3. Listener de Autenticação
        supabaseClient.auth.onAuthStateChange((event, session) => {
            console.log("Supabase Auth State Change:", event, session);
            
            if (event === "INITIAL_SESSION") {
                return;
            }

            if (event === "SIGNED_OUT") {
                window.location.reload();
            }
        });
        
        // 4. Retorna a sessão atual (pode ser null)
        const { data } = await supabaseClient.auth.getSession();
        return data.session;

    } catch (error) {
        console.error("Erro fatal ao inicializar o Supabase:", error);
        throw error;
    }
}

/**
 * Tenta fazer login com email e senha.
 */
export async function signIn(email, password) {
    try {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
    } catch (error) {
        return handleSupabaseError(error, "signIn");
    }
}

/**
 * Tenta criar uma nova conta.
 */
export async function signUp(email, password) {
     try {
        const { data, error } = await supabaseClient.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session === null) {
            return "success"; 
        }
        return "success_signed_in"; 
    } catch (error) {
        return handleSupabaseError(error, "signUp");
    }
}

/**
 * Faz logout do usuário.
 */
export async function signOut() {
    try {
        const { error } = await supabaseClient.auth.signOut();
        if (error) throw error;
    } catch (error) {
        console.error("Erro ao sair:", error);
    }
}


/**
 * 2. FUNÇÕES DO BANCO DE DADOS (CRUD)
 */

// --- Transações ---

export async function getTransacoes() {
    const { data, error } = await supabaseClient
        .from('transacoes')
        .select('*');
        
    if (error) throw new Error(handleSupabaseError(error, "getTransacoes"));
    return data || [];
}

export async function addTransacao(transacao) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuário não autenticado.");
    const transacaoComUser = { ...transacao, user_id: user.id };
    const { error } = await supabaseClient
        .from('transacoes')
        .insert(transacaoComUser);
    if (error) throw new Error(handleSupabaseError(error, "addTransacao"));
}

export async function updateTransacao(id, transacaoUpdate) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuário não autenticado.");
    const { error } = await supabaseClient
        .from('transacoes')
        .update(transacaoUpdate)
        .eq('id', id)
        .eq('user_id', user.id); 
    if (error) throw new Error(handleSupabaseError(error, "updateTransacao"));
}

export async function deleteTransacao(id) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuário não autenticado.");
    const { error } = await supabaseClient
        .from('transacoes')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id); 
    if (error) throw new Error(handleSupabaseError(error, "deleteTransacao"));
}

export async function deleteTransacoesDoAtivo(symbol) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuário não autenticado.");
    const { error } = await supabaseClient
        .from('transacoes')
        .delete()
        .eq('symbol', symbol)
        .eq('user_id', user.id); 
    if (error) throw new Error(handleSupabaseError(error, "deleteTransacoesDoAtivo"));
}


// --- Patrimônio ---

export async function getPatrimonio() {
    const { data, error } = await supabaseClient
        .from('patrimonio')
        .select('*');
    
    if (error) throw new Error(handleSupabaseError(error, "getPatrimonio"));
    return data || [];
}

export async function savePatrimonioSnapshot(snapshot) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuário não autenticado.");
    const snapshotComUser = { ...snapshot, user_id: user.id };
    const { error } = await supabaseClient
        .from('patrimonio')
        .upsert(snapshotComUser, { onConflict: 'user_id, date' }); 
    if (error) throw new Error(handleSupabaseError(error, "savePatrimonioSnapshot"));
}


// --- AppState (Caixa e Histórico Processado) ---

export async function getAppState(key) {
    const { data, error } = await supabaseClient
        .from('appstate') 
        .select('value_json')
        .eq('key', key)
        .single(); 

    // CORREÇÃO: Trata o erro 406 (Not Acceptable) como "não encontrado".
    // Isso acontece quando o .single() não encontra dados que passem no RLS.
    if (error && error.code !== 'PGRST116' && error.status !== 406) { 
        throw new Error(handleSupabaseError(error, "getAppState"));
    }
    return data ? data.value_json : null;
}

export async function saveAppState(key, value_json) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuário não autenticado.");
    const record = { key, value_json, user_id: user.id };
    const { error } = await supabaseClient
        .from('appstate') 
        .upsert(record, { onConflict: 'user_id, key' });
    if (error) throw new Error(handleSupabaseError(error, "saveAppState"));
}


// --- Proventos Conhecidos ---

export async function getProventosConhecidos() {
    const { data, error } = await supabaseClient
        .from('proventosconhecidos') 
        // CORREÇÃO: Seleciona 'paymentdate' e renomeia para 'paymentDate'
        .select('*, paymentdate:paymentDate'); 
    if (error) throw new Error(handleSupabaseError(error, "getProventosConhecidos"));
    return data || [];
}

export async function addProventoConhecido(provento) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuário não autenticado.");
    
    // CORREÇÃO: Renomeia 'paymentDate' para 'paymentdate' antes de inserir
    const proventoComUser = { 
        ...provento, 
        paymentdate: provento.paymentDate, // Traduz
        user_id: user.id
    };
    delete proventoComUser.paymentDate; // Remove a chave errada

    const { error } = await supabaseClient
        .from('proventosconhecidos') 
        .upsert(proventoComUser, { onConflict: 'user_id, id' });
    if (error) throw new Error(handleSupabaseError(error, "addProventoConhecido"));
}

export async function updateProventoProcessado(id) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuário não autenticado.");
    const { error } = await supabaseClient
        .from('proventosconhecidos') 
        .update({ processado: true })
        .eq('id', id)
        .eq('user_id', user.id); 
    if (error) throw new Error(handleSupabaseError(error, "updateProventoProcessado"));
}

export async function deleteProventosDoAtivo(symbol) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuário não autenticado.");
    const { error } = await supabaseClient
        .from('proventosconhecidos') 
        .delete()
        .eq('symbol', symbol)
        .eq('user_id', user.id); 
    if (error) throw new Error(handleSupabaseError(error, "deleteProventosDoAtivo"));
}


// --- Watchlist ---

export async function getWatchlist() {
    const { data, error } = await supabaseClient
        .from('watchlist')
         // CORREÇÃO: Seleciona 'addedat' e renomeia para 'addedAt'
        .select('symbol, addedat:addedAt');
    if (error) throw new Error(handleSupabaseError(error, "getWatchlist"));
    return data || [];
}

export async function addWatchlist(item) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuário não autenticado.");

    // CORREÇÃO: Renomeia 'addedAt' para 'addedat' antes de inserir
    const itemComUser = { 
        ...item, 
        addedat: item.addedAt, // Traduz
        user_id: user.id 
    };
    delete itemComUser.addedAt; // Remove a chave errada

    const { error } = await supabaseClient
        .from('watchlist')
        .insert(itemComUser); 
    if (error) throw new Error(handleSupabaseError(error, "addWatchlist"));
}

export async function deleteWatchlist(symbol) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuário não autenticado.");
    const { error } = await supabaseClient
        .from('watchlist')
        .delete()
        .eq('symbol', symbol)
        .eq('user_id', user.id); 
    if (error) throw new Error(handleSupabaseError(error, "deleteWatchlist"));
}
