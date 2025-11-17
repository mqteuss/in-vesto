// supabase.js
// Módulo para gerenciar a autenticação e o banco de dados Supabase.
// VERSÃO CORRIGIDA (com tradução manual de nomes de coluna)

// Pega o cliente Supabase carregado pelo CDN no index.html
const { createClient } = supabase;
let supabaseClient = null;

/**
 * Lida com erros do Supabase e retorna uma mensagem amigável.
 */
function handleSupabaseError(error, context) {
    console.error(`Erro no Supabase (${context}):`, error);
    // CORREÇÃO: Pega a 'hint' (dica) do erro, que é mais útil
    const hint = error.hint; 
    const message = error.message;

    if (hint) {
        // Ex: "Perhaps you meant to reference the column 'watchlist.addedat'?"
        return hint;
    }
    if (error.code === '42501') { // RLS policy violation
        return "Erro de permissão. Contate o suporte.";
    }
    if (message.includes("fetch")) {
        return "Erro de rede. Verifique sua conexão.";
    }
    if (message.includes("invalid JWT") || message.includes("Invalid token")) {
        return "Sessão inválida. Por favor, faça login novamente.";
    }
    if (message.includes("Email not confirmed")) {
         return "Email não confirmado. Verifique sua caixa de entrada.";
    }
    return message || "Ocorreu um erro desconhecido.";
}

/**
 * 1. INICIALIZAÇÃO E AUTENTICAÇÃO
 */
export async function initialize() {
    try {
        const response = await fetch('/api/get-keys');
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || "Não foi possível carregar as chaves do servidor.");
        }
        const { supabaseUrl, supabaseKey } = await response.json();

        supabaseClient = createClient(supabaseUrl, supabaseKey, {
            auth: {
                persistSession: true, 
                autoRefreshToken: true,
                detectSessionInUrl: true
            },
        });

        supabaseClient.auth.onAuthStateChange((event, session) => {
            console.log("Supabase Auth State Change:", event, session);
            if (event === "INITIAL_SESSION") {
                return;
            }
            if (event === "SIGNED_OUT") {
                window.location.reload();
            }
        });

        const { data } = await supabaseClient.auth.getSession();
        return data.session;

    } catch (error) {
        console.error("Erro fatal ao inicializar o Supabase:", error);
        throw error;
    }
}

export async function signIn(email, password) {
    try {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
    } catch (error) {
        return handleSupabaseError(error, "signIn");
    }
}

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

// --- Transações --- (Nomes já estavam corretos)
export async function getTransacoes() {
    const { data, error } = await supabaseClient.from('transacoes').select('*');
    if (error) throw new Error(handleSupabaseError(error, "getTransacoes"));
    return data || [];
}
export async function addTransacao(transacao) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuário não autenticado.");
    const transacaoComUser = { ...transacao, user_id: user.id };
    const { error } = await supabaseClient.from('transacoes').insert(transacaoComUser);
    if (error) throw new Error(handleSupabaseError(error, "addTransacao"));
}
export async function updateTransacao(id, transacaoUpdate) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuário não autenticado.");
    const { error } = await supabaseClient.from('transacoes').update(transacaoUpdate).eq('id', id).eq('user_id', user.id); 
    if (error) throw new Error(handleSupabaseError(error, "updateTransacao"));
}
export async function deleteTransacao(id) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuário não autenticado.");
    const { error } = await supabaseClient.from('transacoes').delete().eq('id', id).eq('user_id', user.id); 
    if (error) throw new Error(handleSupabaseError(error, "deleteTransacao"));
}
export async function deleteTransacoesDoAtivo(symbol) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuário não autenticado.");
    const { error } = await supabaseClient.from('transacoes').delete().eq('symbol', symbol).eq('user_id', user.id); 
    if (error) throw new Error(handleSupabaseError(error, "deleteTransacoesDoAtivo"));
}
// --- Patrimônio --- (Nomes já estavam corretos)
export async function getPatrimonio() {
    const { data, error } = await supabaseClient.from('patrimonio').select('*');
    if (error) throw new Error(handleSupabaseError(error, "getPatrimonio"));
    return data || [];
}
export async function savePatrimonioSnapshot(snapshot) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuário não autenticado.");
    const snapshotComUser = { ...snapshot, user_id: user.id };
    const { error } = await supabaseClient.from('patrimonio').upsert(snapshotComUser, { onConflict: 'user_id, date' }); 
    if (error) throw new Error(handleSupabaseError(error, "savePatrimonioSnapshot"));
}

// --- AppState --- (Tabela 'appstate')
export async function getAppState(key) {
    const { data, error } = await supabaseClient
        .from('appstate') 
        .select('value_json')
        .eq('key', key)
        .single(); 

    // CORREÇÃO: Trata o erro 406 (Not Acceptable) / 404 (Not Found)
    if (error && error.code !== 'PGRST116' && error.status !== 406 && error.status !== 404) { 
        throw new Error(handleSupabaseError(error, "getAppState"));
    }
    return data ? data.value_json : null;
}
export async function saveAppState(key, value_json) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuário não autenticado.");
    const record = { key, value_json, user_id: user.id };
    const { error } = await supabaseClient.from('appstate').upsert(record, { onConflict: 'user_id, key' });
    if (error) throw new Error(handleSupabaseError(error, "saveAppState"));
}


// --- Proventos Conhecidos --- (Tabela 'proventosconhecidos', Coluna 'paymentdate')
export async function getProventosConhecidos() {
    const { data, error } = await supabaseClient
        .from('proventosconhecidos') 
        .select('*'); // Pega tudo (incluindo 'paymentdate')
    if (error) throw new Error(handleSupabaseError(error, "getProventosConhecidos"));

    // CORREÇÃO: Traduz 'paymentdate' para 'paymentDate' para o app.js
    if (data) {
        return data.map(item => ({
            ...item,
            paymentDate: item.paymentdate 
        }));
    }
    return [];
}
export async function addProventoConhecido(provento) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuário não autenticado.");

    // CORREÇÃO: Traduz 'paymentDate' para 'paymentdate'
    const proventoParaDB = {
        id: provento.id,
        user_id: user.id,
        symbol: provento.symbol,
        value: provento.value,
        processado: provento.processado,
        paymentdate: provento.paymentDate // Tradução
    };

    const { error } = await supabaseClient
        .from('proventosconhecidos') 
        .upsert(proventoParaDB, { onConflict: 'user_id, id' });
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


// --- Watchlist --- (Tabela 'watchlist', Coluna 'addedat')
export async function getWatchlist() {
    const { data, error } = await supabaseClient
        .from('watchlist')
        .select('symbol, addedat'); // Pega a coluna 'addedat'
    if (error) throw new Error(handleSupabaseError(error, "getWatchlist"));

    // CORREÇÃO: Traduz 'addedat' para 'addedAt' para o app.js
    if (data) {
        return data.map(item => ({
            symbol: item.symbol,
            addedAt: item.addedat
        }));
    }
    return [];
}
export async function addWatchlist(item) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Usuário não autenticado.");

    // CORREÇÃO: Traduz 'addedAt' para 'addedat'
    const itemParaDB = {
        user_id: user.id,
        symbol: item.symbol,
        addedat: item.addedAt // Tradução
    };

    const { error } = await supabaseClient
        .from('watchlist')
        .insert(itemParaDB); 
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