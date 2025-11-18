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
 * ✅ CORREÇÃO DEFINITIVA v4
 * Compara os timestamps 'created_at' e 'updated_at'.
 * - Usuário NOVO: created_at e updated_at são quase idênticos.
 * - E-mail DUPLICADO: updated_at é atualizado, mas created_at é antigo.
 */
export async function signUp(email, password) {
    try {
        const { data, error } = await supabaseClient.auth.signUp({ email, password });
        
        // 1. Pega erro explícito (senha curta, e-mail já CONFIRMADO, etc)
        if (error) {
            console.error("[signUp] Erro explícito do Supabase:", error);
            throw error; // Vai pro catch
        }

        // 2. Fallback: se data ou data.user não existir
        if (!data || !data.user) {
            console.warn("[signUp] Fallback: Data ou User nulo, mas sem erro.");
            throw new Error("Erro desconhecido ao criar conta");
        }

        // 3. ✅ A VERIFICAÇÃO DEFINITIVA: Timestamps
        // Converte os timestamps para objetos Date
        const createdAt = new Date(data.user.created_at);
        const updatedAt = new Date(data.user.updated_at);

        // Calcula a diferença em milissegundos
        const diffInMs = Math.abs(updatedAt.getTime() - createdAt.getTime());
        
        console.log(`[signUp] CreatedAt: ${createdAt.toISOString()}, UpdatedAt: ${updatedAt.toISOString()}`);
        console.log(`[signUp] Diferença de tempo: ${diffInMs}ms`);

        // Se a diferença for maior que 2000ms (2 segundos),
        // consideramos que é um usuário existente sendo atualizado.
        if (diffInMs > 2000) {
            console.warn("[signUp] E-mail duplicado detectado. Diferença de timestamp é > 2s.");
            // Criamos o erro para ser pego pelo catch
            throw new Error("User already registered");
        }

        // 4. Sucesso (confirmação de e-mail LIGADA)
        if (data.session === null) {
            console.log("[signUp] Cadastro OK. Precisa confirmar e-mail.");
            return { success: true, needsConfirmation: true };
        }
        
        // 5. Sucesso (confirmação de e-mail DESLIGADA)
        if (data.session) {
            console.log("[signUp] Cadastro OK. Logado automaticamente.");
            return { success: true, needsConfirmation: false };
        }

        // 6. Fallback final
        console.warn("[signUp] Fallback: Estado inesperado.", data);
        throw new Error("Erro desconhecido ao criar conta");
        
    } catch (error) {
        // 7. Pega TODOS os erros (o explícito do 1, o do timestamp do 3)
        // e traduz
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
