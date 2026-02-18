const { createClient } = supabase;
let supabaseClient = null;

function handleSupabaseError(error, context) {
    console.error(`Erro no Supabase (${context}):`, error);
    const message = error.message;

    if (message.includes("Invalid login credentials")) {
         return "E-mail ou senha incorretos.";
    }
    if (message.includes("User already registered") || message.includes("duplicate key value violates unique constraint")) {
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
    if (message.includes("Rate limit") || error.status === 429) {
        return "Muitas tentativas. Aguarde um pouco antes de tentar novamente.";
    }
    return error.hint || message || "Ocorreu um erro desconhecido.";
}

export async function initialize() {
    // Evita recriar o cliente se ele já existir (CRUCIAL para a troca de senha)
    if (supabaseClient) {
        const { data } = await supabaseClient.auth.getSession();
        return data.session;
    }

    try {
        const supabaseUrl = "https://ybmkhxacxkijvxvepjkj.supabase.co";
        const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlibWtoeGFjeGtpanZ4dmVwamtqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMzMTgwMjgsImV4cCI6MjA3ODg5NDAyOH0.ORllatX680hzWfnm3ymELFG18zvtfJjSJ3iQ4_eDsOg";

        supabaseClient = createClient(supabaseUrl, supabaseKey, {
            auth: {
                persistSession: true, 
                autoRefreshToken: true,
                detectSessionInUrl: true
            },
        });

        supabaseClient.auth.onAuthStateChange((event, session) => {
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

        if (data.session === null && data.user) {
            return "success"; 
        }
        if (data.session) {
             return "success_signed_in"; 
        }
        return "success"; 

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
    // O select('*') já traz a coluna 'type' se ela existir no banco
    const { data, error } = await supabaseClient
        .from('proventosconhecidos') 
        .select('*'); 

    if (error) throw new Error(handleSupabaseError(error, "getProventosConhecidos"));

    if (data) {
        return data.map(item => ({
            ...item,
            paymentDate: item.paymentdate,
            dataCom: item.datacom,
            type: item.type || 'REND' // Garante que se vier nulo, assume REND
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
        paymentdate: provento.paymentDate,
        datacom: provento.dataCom,
        type: provento.type || 'REND' // Correção: Garante que o tipo (JCP/DIV) seja salvo
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

export async function sendPasswordResetEmail(email) {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin 
    });

    if (error) {
        if (error.message.includes("Rate limit") || error.status === 429) {
            return "Muitas tentativas. Aguarde 60 segundos antes de tentar novamente.";
        }
        return handleSupabaseError(error, "resetPassword");
    }
    return "success";
}

export async function updateUserPassword(newPassword) {
    const { error } = await supabaseClient.auth.updateUser({ 
        password: newPassword 
    });

    if (error) throw new Error(handleSupabaseError(error, "updateUserPassword"));
    return "success";
}
// Adicione isso ao final do arquivo supabase.js
export async function salvarPushSubscription(subscription) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;

    // Salva a inscrição no banco ou atualiza se já existir
    const { error } = await supabaseClient.from('push_subscriptions').upsert({ 
       user_id: user.id, 
       subscription: subscription 
    }, { onConflict: 'user_id, subscription' });

    if (error) console.error("Erro ao salvar push:", error);
}
// Adicione ao final do supabase.js
export async function removerPushSubscription(subscription) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;

    // Remove do banco procurando pelo endpoint (que é único)
    const { error } = await supabaseClient
        .from('push_subscriptions')
        .delete()
        .eq('user_id', user.id)
        .eq('subscription->>endpoint', subscription.endpoint);

    if (error) console.error("Erro ao remover push:", error);
}