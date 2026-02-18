import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------
// CONFIGURAÇÃO
// Credenciais lidas de variáveis de ambiente.
// NUNCA hardcode URLs ou keys no código-fonte — elas ficam
// visíveis no bundle final enviado ao navegador.
// Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env
// ---------------------------------------------------------
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Variáveis de ambiente VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY não configuradas.');
}

const PASSWORD_MIN_LENGTH = 8;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------
// SINGLETON COM PROTEÇÃO CONTRA RACE CONDITION
//
// ANTES: if (supabaseClient) return — duas chamadas simultâneas
// com supabaseClient=null passariam pelo check e criariam dois
// clientes diferentes, causando comportamento imprevisível de sessão.
//
// AGORA: _initPromise garante que qualquer chamada paralela
// aguarde a mesma Promise em vez de iniciar uma nova.
// ---------------------------------------------------------
let supabaseClient = null;
let _initPromise   = null;

function getClient() {
    if (!supabaseClient) {
        throw new Error('Supabase não inicializado. Chame initialize() antes de usar qualquer função.');
    }
    return supabaseClient;
}

// ---------------------------------------------------------
// HELPER: USUÁRIO AUTENTICADO
//
// ANTES: cada função chamava supabaseClient.auth.getUser()
// individualmente — 1 round trip por operação.
//
// AGORA: getSession() é local (lê do storage, sem rede).
// Mais rápido e sem custo de latência.
// ---------------------------------------------------------
async function requireUser() {
    const { data: { session } } = await getClient().auth.getSession();
    if (!session?.user) throw new Error('Usuário não autenticado.');
    return session.user;
}

// ---------------------------------------------------------
// HELPER: MAPEAMENTO snake_case → camelCase
// Centraliza a conversão que estava duplicada em
// getProventosConhecidos e getWatchlist.
// ---------------------------------------------------------
function mapProvento(item) {
    return {
        ...item,
        paymentDate: item.paymentdate,
        dataCom:     item.datacom,
        type:        item.type || 'REND',
    };
}

function mapWatchlistItem(item) {
    return {
        symbol:   item.symbol,
        addedAt:  item.addedat,
    };
}

// ---------------------------------------------------------
// TRATAMENTO DE ERROS
// ---------------------------------------------------------
function handleSupabaseError(error, context) {
    console.error(`Supabase error (${context}):`, error);

    // Guard: protege contra error.message undefined
    const message = error?.message ?? '';
    const code    = error?.code    ?? '';
    const status  = error?.status  ?? 0;

    if (message.includes('Invalid login credentials'))
        return 'E-mail ou senha incorretos.';

    if (message.includes('User already registered') || message.includes('duplicate key value violates unique constraint'))
        return 'Este e-mail já está cadastrado. Tente fazer login.';

    if (code === '42501')
        return 'Erro de permissão. Contate o suporte.';

    if (message.includes('fetch'))
        return 'Erro de rede. Verifique sua conexão.';

    if (message.includes('invalid JWT') || message.includes('Invalid token'))
        return 'Sessão inválida. Por favor, faça login novamente.';

    if (message.includes('Email not confirmed'))
        return 'Email não confirmado. Verifique sua caixa de entrada.';

    if (message.includes('Rate limit') || status === 429)
        return 'Muitas tentativas. Aguarde um pouco antes de tentar novamente.';

    return error?.hint || message || 'Ocorreu um erro desconhecido.';
}

// ---------------------------------------------------------
// VALIDAÇÕES
// ---------------------------------------------------------
function validateEmail(email) {
    if (!email || !EMAIL_REGEX.test(email.trim())) {
        throw new Error('E-mail inválido.');
    }
}

function validatePassword(password, context = 'senha') {
    if (!password || password.length < PASSWORD_MIN_LENGTH) {
        throw new Error(`A ${context} deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`);
    }
}

// ---------------------------------------------------------
// INICIALIZAÇÃO
// ---------------------------------------------------------
export function initialize() {
    // Retorna a Promise em andamento se já houver uma —
    // múltiplas chamadas paralelas aguardam o mesmo resultado.
    if (_initPromise) return _initPromise;

    _initPromise = (async () => {
        if (supabaseClient) {
            const { data } = await supabaseClient.auth.getSession();
            return data.session;
        }

        supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
            auth: {
                persistSession:     true,
                autoRefreshToken:   true,
                detectSessionInUrl: true,
            },
        });

        supabaseClient.auth.onAuthStateChange((event, session) => {
            if (event === 'INITIAL_SESSION') return;

            if (event === 'SIGNED_OUT') {
                // Despacha evento customizado para que o app possa
                // limpar estado local antes de recarregar a página.
                window.dispatchEvent(new CustomEvent('supabase:signed-out', { detail: { session } }));
            }
        });

        const { data } = await supabaseClient.auth.getSession();
        return data.session;
    })().catch(err => {
        // Reseta a promise em caso de falha para permitir nova tentativa
        _initPromise = null;
        console.error('Erro fatal ao inicializar o Supabase:', err);
        throw err;
    });

    return _initPromise;
}

// ---------------------------------------------------------
// AUTENTICAÇÃO
// ---------------------------------------------------------
export async function signIn(email, password) {
    try {
        validateEmail(email);
        validatePassword(password);
        const { error } = await getClient().auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        return 'success';
    } catch (error) {
        // Erros de validação local têm mensagem direta; erros do Supabase passam pelo handler
        if (error.message === 'E-mail inválido.' || error.message.startsWith('A senha')) {
            return error.message;
        }
        return handleSupabaseError(error, 'signIn');
    }
}

export async function signUp(email, password) {
    try {
        validateEmail(email);
        validatePassword(password, 'senha de cadastro');
        const { data, error } = await getClient().auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        return data.session ? 'success_signed_in' : 'success';
    } catch (error) {
        if (error.message === 'E-mail inválido.' || error.message.startsWith('A senha')) {
            return error.message;
        }
        return handleSupabaseError(error, 'signUp');
    }
}

export async function signOut() {
    const { error } = await getClient().auth.signOut();
    if (error) throw new Error(handleSupabaseError(error, 'signOut'));
}

export async function sendPasswordResetEmail(email) {
    try {
        validateEmail(email);
    } catch {
        return 'E-mail inválido.';
    }

    const { error } = await getClient().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin,
    });

    if (error) {
        if (error.message?.includes('Rate limit') || error.status === 429) {
            return 'Muitas tentativas. Aguarde 60 segundos antes de tentar novamente.';
        }
        return handleSupabaseError(error, 'resetPassword');
    }
    return 'success';
}

export async function updateUserPassword(newPassword) {
    validatePassword(newPassword, 'nova senha');
    const { error } = await getClient().auth.updateUser({ password: newPassword });
    if (error) throw new Error(handleSupabaseError(error, 'updateUserPassword'));
    return 'success';
}

// ---------------------------------------------------------
// TRANSAÇÕES
// ---------------------------------------------------------
export async function getTransacoes() {
    const { data, error } = await getClient()
        .from('transacoes')
        .select('id, user_id, symbol, type, quantity, price, date');
    if (error) throw new Error(handleSupabaseError(error, 'getTransacoes'));
    return data ?? [];
}

export async function addTransacao(transacao) {
    const user = await requireUser();
    const { error } = await getClient()
        .from('transacoes')
        .insert({ ...transacao, user_id: user.id });
    if (error) throw new Error(handleSupabaseError(error, 'addTransacao'));
}

export async function updateTransacao(id, transacaoUpdate) {
    const user = await requireUser();
    const { error } = await getClient()
        .from('transacoes')
        .update(transacaoUpdate)
        .eq('id', id)
        .eq('user_id', user.id);
    if (error) throw new Error(handleSupabaseError(error, 'updateTransacao'));
}

export async function deleteTransacao(id) {
    const user = await requireUser();
    const { error } = await getClient()
        .from('transacoes')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);
    if (error) throw new Error(handleSupabaseError(error, 'deleteTransacao'));
}

export async function deleteTransacoesDoAtivo(symbol) {
    const user = await requireUser();
    const { error } = await getClient()
        .from('transacoes')
        .delete()
        .eq('symbol', symbol)
        .eq('user_id', user.id);
    if (error) throw new Error(handleSupabaseError(error, 'deleteTransacoesDoAtivo'));
}

// ---------------------------------------------------------
// PATRIMÔNIO
// ---------------------------------------------------------
export async function getPatrimonio() {
    const { data, error } = await getClient()
        .from('patrimonio')
        .select('user_id, date, value');
    if (error) throw new Error(handleSupabaseError(error, 'getPatrimonio'));
    return data ?? [];
}

export async function savePatrimonioSnapshot(snapshot) {
    const user = await requireUser();
    const { error } = await getClient()
        .from('patrimonio')
        .upsert({ ...snapshot, user_id: user.id }, { onConflict: 'user_id, date' });
    if (error) throw new Error(handleSupabaseError(error, 'savePatrimonioSnapshot'));
}

// ---------------------------------------------------------
// APP STATE
// ---------------------------------------------------------
export async function getAppState(key) {
    const { data, error } = await getClient()
        .from('appstate')
        .select('value_json')
        .eq('key', key)
        .single();

    // PGRST116 = nenhuma linha encontrada — não é erro real
    if (error && error.code !== 'PGRST116' && error.status !== 406 && error.status !== 404) {
        throw new Error(handleSupabaseError(error, 'getAppState'));
    }
    return data?.value_json ?? null;
}

export async function saveAppState(key, value_json) {
    const user = await requireUser();
    const { error } = await getClient()
        .from('appstate')
        .upsert({ key, value_json, user_id: user.id }, { onConflict: 'user_id, key' });
    if (error) throw new Error(handleSupabaseError(error, 'saveAppState'));
}

// ---------------------------------------------------------
// PROVENTOS
// ---------------------------------------------------------
export async function getProventosConhecidos() {
    const { data, error } = await getClient()
        .from('proventosconhecidos')
        .select('id, user_id, symbol, value, paymentdate, datacom, type, processado');
    if (error) throw new Error(handleSupabaseError(error, 'getProventosConhecidos'));
    return (data ?? []).map(mapProvento);
}

export async function addProventoConhecido(provento) {
    const user = await requireUser();
    const { error } = await getClient()
        .from('proventosconhecidos')
        .upsert({
            id:          provento.id,
            user_id:     user.id,
            symbol:      provento.symbol,
            value:       provento.value,
            processado:  provento.processado,
            paymentdate: provento.paymentDate,
            datacom:     provento.dataCom,
            type:        provento.type || 'REND',
        }, { onConflict: 'user_id, id' });
    if (error) throw new Error(handleSupabaseError(error, 'addProventoConhecido'));
}

export async function updateProventoProcessado(id) {
    const user = await requireUser();
    const { error } = await getClient()
        .from('proventosconhecidos')
        .update({ processado: true })
        .eq('id', id)
        .eq('user_id', user.id);
    if (error) throw new Error(handleSupabaseError(error, 'updateProventoProcessado'));
}

export async function deleteProventosDoAtivo(symbol) {
    const user = await requireUser();
    const { error } = await getClient()
        .from('proventosconhecidos')
        .delete()
        .eq('symbol', symbol)
        .eq('user_id', user.id);
    if (error) throw new Error(handleSupabaseError(error, 'deleteProventosDoAtivo'));
}

// ---------------------------------------------------------
// WATCHLIST
// ---------------------------------------------------------
export async function getWatchlist() {
    const { data, error } = await getClient()
        .from('watchlist')
        .select('symbol, addedat');
    if (error) throw new Error(handleSupabaseError(error, 'getWatchlist'));
    return (data ?? []).map(mapWatchlistItem);
}

export async function addWatchlist(item) {
    const user = await requireUser();
    const { error } = await getClient()
        .from('watchlist')
        .insert({ user_id: user.id, symbol: item.symbol, addedat: item.addedAt });
    if (error) throw new Error(handleSupabaseError(error, 'addWatchlist'));
}

export async function deleteWatchlist(symbol) {
    const user = await requireUser();
    const { error } = await getClient()
        .from('watchlist')
        .delete()
        .eq('symbol', symbol)
        .eq('user_id', user.id);
    if (error) throw new Error(handleSupabaseError(error, 'deleteWatchlist'));
}

// ---------------------------------------------------------
// PUSH SUBSCRIPTIONS
// ---------------------------------------------------------
export async function salvarPushSubscription(subscription) {
    const user = await requireUser();
    const { error } = await getClient()
        .from('push_subscriptions')
        .upsert({ user_id: user.id, subscription }, { onConflict: 'user_id, subscription' });
    if (error) throw new Error(handleSupabaseError(error, 'salvarPushSubscription'));
}

export async function removerPushSubscription(subscription) {
    const user = await requireUser();
    const { error } = await getClient()
        .from('push_subscriptions')
        .delete()
        .eq('user_id', user.id)
        .eq('subscription->>endpoint', subscription.endpoint);
    if (error) throw new Error(handleSupabaseError(error, 'removerPushSubscription'));
}
