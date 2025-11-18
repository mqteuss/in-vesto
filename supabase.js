const { createClient } = supabase;
let supabaseClient = null;

function handleSupabaseError(error, context) {
    console.error(`[handleSupabaseError] Context: ${context}`);
    console.error(`[handleSupabaseError] Error object:`, error);
    console.error(`[handleSupabaseError] Error message:`, error.message);
    
    const message = error.message;

    if (message.includes("User already registered") || 
        message.includes("duplicate key value violates unique constraint") ||
        message.includes("already been registered")) {
         return "Este e-mail já está cadastrado. Tente fazer login.";
    }
    if (error.code === '42501') {
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
    return error.hint || message || "Ocorreu um erro desconhecido.";
}

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

/**
 * ✅ CORREÇÃO DEFINITIVA APLICADA
 * Verifica 'data.user.identities.length' para detectar e-mails duplicados
 * que ainda não foram confirmados.
 */
export async function signUp(email, password) {
    try {
        const { data, error } = await supabaseClient.auth.signUp({ email, password });
        
        // 1. Verifica erro explícito (ex: senha muito curta)
        if (error) {
            console.error("[signUp] Erro explícito do Supabase:", error);
            throw error;
        }

        // 2. ✅ CORREÇÃO CRÍTICA: Verifica se 'identities' está vazio.
        // Se estiver, é um e-mail já existente (mas não confirmado)
        // e o Supabase está apenas reenviando o e-mail de confirmação.
        if (data.user && data.user.identities && data.user.identities.length === 0) {
            console.warn("[signUp] E-mail duplicado (ou não confirmado) detectado. 'identities' está vazio.");
            // Lançamos nosso próprio erro para ser pego pelo catch
            throw new Error("User already registered"); 
        }

        // 3. Sucesso (precisa de confirmação de e-mail)
        if (data.session === null && data.user && data.user.id) {
            console.log("[signUp] Cadastro OK - Precisa confirmar e-mail");
            return { success: true, needsConfirmation: true };
        }
        
        // 4. Sucesso (confirmação desligada, logado automaticamente)
        if (data.session && data.user && data.user.id) {
            console.log("[signUp] Cadastro OK - Logado automaticamente");
            return { success: true, needsConfirmation: false };
        }

        // 5. Fallback
        console.warn("[signUp] Fallback: data.user ou data.session está em estado inesperado.", data);
        throw new Error("Erro desconhecido ao criar conta");
        
    } catch (error) {
        // 6. Bloco Catch: formata o erro (incluindo o "User already registered" que jogamos)
        const errorMessage = handleSupabaseError(error, "signUp");
        console.error("[signUp] Retornando erro para UI:", errorMessage);
        return { success: false, error: errorMessage };
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
export async function getAppState(key) {
    const { data, error } = await supabaseClient
        .from('appstate') 
        .select('value_json')
        .eq('key', key)
        .single(); 

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

export async function getProventosConhecidos() {
    const { data, error } = await supabaseClient
        .from('proventosconhecidos') 
        .select('*'); 
    if (error) throw new Error(handleSupabaseError(error, "getProventosConhecidos"));
    
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
    
    const proventoParaDB = {
        id: provento.id,
        user_id: user.id,
        symbol: provento.symbol,
        value: provento.value,
        processado: provento.processado,
        paymentdate: provento.paymentDate
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

export async function getWatchlist() {
    const { data, error } = await supabaseClient
        .from('watchlist')
        .select('symbol, addedat'); 
    if (error) throw new Error(handleSupabaseError(error, "getWatchlist"));
    
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

    const itemParaDB = {
        user_id: user.id,
        symbol: item.symbol,
        addedat: item.addedAt
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
