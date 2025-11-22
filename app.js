import * as supabaseDB from './supabase.js';

Chart.defaults.color = '#9ca3af'; 
Chart.defaults.borderColor = '#374151'; 

function bufferToBase64(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToBuffer(base64) {
    return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

const formatBRL = (value) => value?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) ?? 'N/A';
const formatNumber = (value) => value?.toLocaleString('pt-BR') ?? 'N/A';
const formatPercent = (value) => `${(value ?? 0).toFixed(2)}%`;
const formatDate = (dateString, includeTime = false) => {
    if (!dateString) return 'N/A';
    try {
        const date = new Date(dateString);
        const options = { day: '2-digit', month: '2-digit', year: 'numeric' };
        if (includeTime) {
            options.hour = '2-digit';
            options.minute = '2-digit';
        } else {
             options.timeZone = 'UTC'; 
        }
        return date.toLocaleDateString('pt-BR', options);
    } catch (e) { return dateString; }
};

const formatDateToInput = (dateString) => {
    try {
        const date = new Date(dateString);
        const year = date.getUTCFullYear();
        const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
        const day = date.getUTCDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    } catch (e) {
        console.error("Erro ao formatar data para input:", e);
        return new Date().toISOString().split('T')[0];
    }
};

const isFII = (symbol) => symbol && (symbol.endsWith('11') || symbol.endsWith('12'));

function parseMesAno(mesAnoStr) { 
    try {
        const [mesStr, anoStr] = mesAnoStr.split('/');
        const mes = parseInt(mesStr, 10) - 1; 
        const ano = parseInt("20" + anoStr, 10); 
        if (!isNaN(mes) && !isNaN(ano) && mes >= 0 && mes <= 11) {
            return new Date(ano, mes, 1); 
        }
        return null;
    } catch (e) {
        console.error("Erro ao analisar data 'MM/AA':", mesAnoStr, e);
        return null;
    }
}

function getSaoPauloDateTime() {
    try {
        const spTimeStr = new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' });
        const spDate = new Date(spTimeStr);
        const dayOfWeek = spDate.getDay(); 
        const hour = spDate.getHours();
        return { dayOfWeek, hour };
    } catch (e) {
        const localDate = new Date();
        return { dayOfWeek: localDate.getDay(), hour: localDate.getHours() };
    }
}

function isB3Open() {
    const { dayOfWeek, hour } = getSaoPauloDateTime();
    if (dayOfWeek === 0 || dayOfWeek === 6) { return false; } 
    if (hour >= 10 && hour < 18) { return true; } 
    return false;
}

const REFRESH_INTERVAL = 900000; 
const CACHE_PRECO_MERCADO_ABERTO = 1000 * 60 * 15; 
const CACHE_PRECO_MERCADO_FECHADO = 1000 * 60 * 60 * 12; 
const CACHE_NOTICIAS = 1000 * 60 * 60 * 6; 
const CACHE_IA_HISTORICO = 1000 * 60 * 60 * 24; 
const CACHE_PROVENTOS = 1000 * 60 * 60 * 12; 

const DB_NAME = 'vestoCacheDB';
const DB_VERSION = 1; 

function criarCardElemento(ativo, dados) {
    const {
        dadoPreco, precoFormatado, variacaoFormatada, corVariacao,
        totalPosicao, custoTotal, lucroPrejuizo, lucroPrejuizoPercent,
        corPL, bgPL, dadoProvento
    } = dados;

    let plTagHtml = '';
    if (dadoPreco) {
        plTagHtml = `<span class="text-xs font-semibold px-2 py-0.5 rounded-full ${bgPL} ${corPL} inline-block">
            ${lucroPrejuizoPercent.toFixed(1)}% L/P
        </span>`;
    }
    
    let proventoHtml = '';
    if (isFII(ativo.symbol)) { 
        if (dadoProvento && dadoProvento.value > 0) {
            proventoHtml = `
            <div class="mt-3 space-y-1">
                <div class="flex justify-between items-center">
                    <span class="text-sm text-gray-500">Provento</span>
                    <span class="text-base font-semibold accent-text">${formatBRL(dadoProvento.value)}</span>
                </div>
                <div class="flex justify-between items-center"> 
                    <span class="text-sm text-gray-500">Pagamento</span>
                    <span class="text-sm font-medium text-gray-400">${formatDate(dadoProvento.paymentDate)}</span>
                </div>
            </div>`;
        } else {
            proventoHtml = `
            <div class="flex justify-between items-center mt-3">
                <span class="text-sm text-gray-500">Provento</span>
                <span class="text-sm font-medium text-gray-400">Sem provento futuro.</span>
            </div>`;
        }
    }

    const card = document.createElement('div');
    card.className = 'card-bg p-4 rounded-2xl card-animate-in';
    card.setAttribute('data-symbol', ativo.symbol); 

    card.innerHTML = `
        <div class="flex justify-between items-start">
            <div class="flex items-center gap-3">
                <div class="w-14 h-14 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center flex-shrink-0 overflow-hidden shadow-sm">
                    <span class="text-xs font-bold text-purple-400 tracking-tight leading-none">${ativo.symbol}</span>
                </div>
                <div>
                    <h2 class="text-xl font-bold text-white">${ativo.symbol}</h2>
                    <p class="text-sm text-gray-500 mb-1" data-field="cota-qtd">${ativo.quantity} cota(s)</p>
                    <div data-field="pl-tag">${plTagHtml}</div>
                </div>
            </div>
            <div class="text-right flex-shrink-0 ml-2">
                <span data-field="variacao-valor" class="${corVariacao} font-semibold text-lg">${dadoPreco ? variacaoFormatada : '...'}</span>
                <p data-field="preco-valor" class="text-gray-100 text-lg">${precoFormatado}</p>
            </div>
        </div>
        <div class="flex justify-center mt-2 border-t border-gray-800 pt-2">
            <button class="p-1 text-gray-500 hover:text-white transition-colors rounded-full hover:bg-gray-700" data-symbol="${ativo.symbol}" data-action="toggle" title="Mostrar mais">
                <svg class="card-arrow-icon w-6 h-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
            </button>
        </div>
        <div id="drawer-${ativo.symbol}" class="card-drawer">
            <div class="drawer-content space-y-3 pt-2">
                <div class="flex justify-between items-center">
                    <span class="text-sm text-gray-500">Posição</span>
                    <span data-field="posicao-valor" class="text-base font-semibold text-white">${dadoPreco ? formatBRL(totalPosicao) : 'A calcular...'}</span>
                </div>
                <div class="flex justify-between items-center">
                    <span data-field="pm-label" class="text-sm text-gray-500">Custo (P.M. ${formatBRL(ativo.precoMedio)})</span>
                    <span data-field="custo-valor" class="text-base font-semibold text-white">${formatBRL(custoTotal)}</span>
                </div>
                <div class="flex justify-between items-center">
                    <span class="text-sm text-gray-500">L/P</span>
                    <span data-field="pl-valor" class="text-base font-semibold ${corPL}">${dadoPreco ? `${formatBRL(lucroPrejuizo)} (${lucroPrejuizoPercent.toFixed(2)}%)` : 'A calcular...'}</span>
                </div>
                <div data-field="provento-container">${proventoHtml}</div> 
                <div class="flex justify-end gap-3 pt-2">
                    <button class="py-1 px-3 text-xs font-medium text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors" data-symbol="${ativo.symbol}" data-action="details">
                        Detalhes
                    </button>
                    <button class="py-1 px-3 text-xs font-medium text-red-400 bg-red-900/50 hover:bg-red-900/80 rounded-md transition-colors" data-symbol="${ativo.symbol}" data-action="remove">
                        Remover
                    </button>
                </div>
            </div>
        </div>
    `;
    return card;
}

function atualizarCardElemento(card, ativo, dados) {
    const {
        dadoPreco, precoFormatado, variacaoFormatada, corVariacao,
        totalPosicao, custoTotal, lucroPrejuizo, lucroPrejuizoPercent,
        corPL, bgPL, dadoProvento
    } = dados;

    card.querySelector('[data-field="cota-qtd"]').textContent = `${ativo.quantity} cota(s)`;
    card.querySelector('[data-field="preco-valor"]').textContent = precoFormatado;
    card.querySelector('[data-field="posicao-valor"]').textContent = dadoPreco ? formatBRL(totalPosicao) : 'A calcular...';
    card.querySelector('[data-field="pm-label"]').textContent = `Custo (P.M. ${formatBRL(ativo.precoMedio)})`;
    card.querySelector('[data-field="custo-valor"]').textContent = formatBRL(custoTotal);

    const variacaoEl = card.querySelector('[data-field="variacao-valor"]');
    variacaoEl.textContent = dadoPreco ? variacaoFormatada : '...';
    variacaoEl.className = `${corVariacao} font-semibold text-lg`; 

    const plValorEl = card.querySelector('[data-field="pl-valor"]');
    plValorEl.textContent = dadoPreco ? `${formatBRL(lucroPrejuizo)} (${lucroPrejuizoPercent.toFixed(2)}%)` : 'A calcular...';
    plValorEl.className = `text-base font-semibold ${corPL}`; 

    let plTagHtml = '';
    if (dadoPreco) {
        plTagHtml = `<span class="text-xs font-semibold px-2 py-0.5 rounded-full ${bgPL} ${corPL} inline-block">
            ${lucroPrejuizoPercent.toFixed(1)}% L/P
        </span>`;
    }
    card.querySelector('[data-field="pl-tag"]').innerHTML = plTagHtml;

    if (isFII(ativo.symbol)) { 
        let proventoHtml = '';
        if (dadoProvento && dadoProvento.value > 0) {
            proventoHtml = `
            <div class="mt-3 space-y-1">
                <div class="flex justify-between items-center">
                    <span class="text-sm text-gray-500">Provento</span>
                    <span class="text-base font-semibold accent-text">${formatBRL(dadoProvento.value)}</span>
                </div>
                <div class="flex justify-between items-center"> 
                    <span class="text-sm text-gray-500">Pagamento</span>
                    <span class="text-sm font-medium text-gray-400">${formatDate(dadoProvento.paymentDate)}</span>
                </div>
            </div>`;
        } else {
            proventoHtml = `
            <div class="flex justify-between items-center mt-3">
                <span class="text-sm text-gray-500">Provento</span>
                <span class="text-sm font-medium text-gray-400">Sem provento futuro.</span>
            </div>`;
        }
        card.querySelector('[data-field="provento-container"]').innerHTML = proventoHtml;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    
    const vestoDB = {
        db: null,
        init() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, DB_VERSION);
                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains('apiCache')) {
                        db.createObjectStore('apiCache', { keyPath: 'key' });
                    }
                };
                request.onsuccess = (event) => {
                    this.db = event.target.result;
                    resolve();
                };
                request.onerror = (event) => {
                    console.error('[IDB Cache] Erro ao abrir DB:', event.target.error);
                    reject(event.target.error);
                };
            });
        },
        _getStore(storeName, mode = 'readonly') {
            if (!this.db) throw new Error('DB não inicializado.');
            return this.db.transaction(storeName, mode).objectStore(storeName);
        },
        get(storeName, key) {
            return new Promise((resolve, reject) => {
                const store = this._getStore(storeName);
                const request = store.get(key);
                request.onsuccess = () => resolve(request.result);
                request.onerror = (e) => reject(e.target.error);
            });
        },
        put(storeName, value) {
            return new Promise((resolve, reject) => {
                const store = this._getStore(storeName, 'readwrite');
                const request = store.put(value);
                request.onsuccess = () => resolve(request.result);
                request.onerror = (e) => reject(e.target.error);
            });
        },
        delete(storeName, key) {
            return new Promise((resolve, reject) => {
                const store = this._getStore(storeName, 'readwrite');
                const request = store.delete(key);
                request.onsuccess = () => resolve();
                request.onerror = (e) => reject(e.target.error);
            });
        },
        clear(storeName) {
            return new Promise((resolve, reject) => {
                const store = this._getStore(storeName, 'readwrite');
                const request = store.clear();
                request.onsuccess = () => resolve();
                request.onerror = (e) => reject(e.target.error);
            });
        }
    };
    
    const authContainer = document.getElementById('auth-container');
    const authLoading = document.getElementById('auth-loading');
    
    const loginForm = document.getElementById('login-form');
    const loginEmailInput = document.getElementById('login-email');
    const loginPasswordInput = document.getElementById('login-password');
    const loginSubmitBtn = document.getElementById('login-submit-btn');
    const loginError = document.getElementById('login-error');
    
    const signupForm = document.getElementById('signup-form');
    const signupEmailInput = document.getElementById('signup-email');
    const signupPasswordInput = document.getElementById('signup-password');
    const signupConfirmPasswordInput = document.getElementById('signup-confirm-password'); 
    const signupSubmitBtn = document.getElementById('signup-submit-btn');
    const signupError = document.getElementById('signup-error');
    const signupSuccess = document.getElementById('signup-success'); 
    
    const recoverForm = document.getElementById('recover-form');
    const recoverEmailInput = document.getElementById('recover-email');
    const recoverSubmitBtn = document.getElementById('recover-submit-btn');
    const recoverError = document.getElementById('recover-error');
    const recoverMessage = document.getElementById('recover-message');
    const showRecoverBtn = document.getElementById('show-recover-btn');
    const backToLoginBtn = document.getElementById('back-to-login-btn');
    
    const showSignupBtn = document.getElementById('show-signup-btn');
    const showLoginBtn = document.getElementById('show-login-btn');
    
    const newPasswordModal = document.getElementById('new-password-modal');
    const newPasswordForm = document.getElementById('new-password-form');
    const newPasswordInput = document.getElementById('new-password-input');
    const newPasswordBtn = document.getElementById('new-password-btn');

    const appWrapper = document.getElementById('app-wrapper');
    const logoutBtn = document.getElementById('logout-btn');
    const passwordToggleButtons = document.querySelectorAll('.password-toggle'); 

    const refreshButton = document.getElementById('refresh-button');
    const refreshNoticiasButton = document.getElementById('refresh-noticias-button');
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    const toastElement = document.getElementById('toast-notification');
    const toastMessageElement = document.getElementById('toast-message');
    const toastIconError = document.getElementById('toast-icon-error');
    const toastIconSuccess = document.getElementById('toast-icon-success');
    const fiiNewsList = document.getElementById('fii-news-list');
    const fiiNewsSkeleton = document.getElementById('fii-news-skeleton');
    const fiiNewsMensagem = document.getElementById('fii-news-mensagem');
    const dashboardStatus = document.getElementById('dashboard-status');
    const dashboardLoading = document.getElementById('dashboard-loading');
    const dashboardMensagem = document.getElementById('dashboard-mensagem');
    const dashboardDrawers = document.getElementById('dashboard-drawers');
    const skeletonTotalValor = document.getElementById('skeleton-total-valor');
    const skeletonTotalCusto = document.getElementById('skeleton-total-custo');
    const skeletonTotalPL = document.getElementById('skeleton-total-pl');
    const skeletonTotalProventos = document.getElementById('skeleton-total-proventos');
    const skeletonTotalCaixa = document.getElementById('skeleton-total-caixa');
    const totalCarteiraValor = document.getElementById('total-carteira-valor');
    const totalCarteiraCusto = document.getElementById('total-carteira-custo');
    const totalCarteiraPL = document.getElementById('total-carteira-pl');
    const totalCaixaValor = document.getElementById('total-caixa-valor');
    const listaCarteira = document.getElementById('lista-carteira');
    const carteiraStatus = document.getElementById('carteira-status');
    const skeletonListaCarteira = document.getElementById('skeleton-lista-carteira');
    const emptyStateAddBtn = document.getElementById('empty-state-add-btn');
    const totalProventosEl = document.getElementById('total-proventos');
    const detalhesPageModal = document.getElementById('detalhes-page-modal');
    const detalhesPageContent = document.getElementById('tab-detalhes');
    const detalhesVoltarBtn = document.getElementById('detalhes-voltar-btn');
    const detalhesTituloTexto = document.getElementById('detalhes-titulo-texto');
    const detalhesNomeLongo = document.getElementById('detalhes-nome-longo');
    const detalhesConteudoScroll = document.getElementById('detalhes-conteudo-scroll');
    const detalhesMensagem = document.getElementById('detalhes-mensagem');
    const detalhesLoading = document.getElementById('detalhes-loading');
    const detalhesPreco = document.getElementById('detalhes-preco');
    const detalhesHistoricoContainer = document.getElementById('detalhes-historico-container');
    const periodoSelectorGroup = document.getElementById('periodo-selector-group'); 
    const detalhesAiProvento = document.getElementById('detalhes-ai-provento'); 
    const listaHistorico = document.getElementById('lista-historico');
    const historicoStatus = document.getElementById('historico-status');
    const customModal = document.getElementById('custom-modal');
    const customModalContent = document.getElementById('custom-modal-content');
    const customModalTitle = document.getElementById('custom-modal-title');
    const customModalMessage = document.getElementById('custom-modal-message');
    const customModalOk = document.getElementById('custom-modal-ok');
    const customModalCancel = document.getElementById('custom-modal-cancel');
    const showAddModalBtn = document.getElementById('show-add-modal-btn');
    const addAtivoModal = document.getElementById('add-ativo-modal');
    const addAtivoModalContent = document.getElementById('add-ativo-modal-content');
    const addAtivoCancelBtn = document.getElementById('add-ativo-cancel-btn');
    const addAtivoForm = document.getElementById('add-ativo-form');
    const addModalTitle = document.getElementById('add-modal-title');
    const transacaoIdInput = document.getElementById('transacao-id-input');
    const tickerInput = document.getElementById('ticker-input');
    const quantityInput = document.getElementById('quantity-input');
    const precoMedioInput = document.getElementById('preco-medio-input'); 
    const dateInput = document.getElementById('date-input');
    const addButton = document.getElementById('add-button');
    const updateNotification = document.getElementById('update-notification');
    const updateButton = document.getElementById('update-button');
    const detalhesFavoritoBtn = document.getElementById('detalhes-favorito-btn'); 
    const detalhesFavoritoIconEmpty = document.getElementById('detalhes-favorito-icon-empty'); 
    const detalhesFavoritoIconFilled = document.getElementById('detalhes-favorito-icon-filled'); 
    const watchlistListaEl = document.getElementById('watchlist-lista'); 
    const watchlistStatusEl = document.getElementById('watchlist-status');
    
    const biometricLockScreen = document.getElementById('biometric-lock-screen');
    const btnDesbloquear = document.getElementById('btn-desbloquear');
    const btnSairLock = document.getElementById('btn-sair-lock');
    const toggleBioBtn = document.getElementById('toggle-bio-btn');
    const bioStatusIcon = document.getElementById('bio-status-icon'); 

    let currentUserId = null;
    let transacoes = [];        
    let carteiraCalculada = []; 
    let patrimonio = [];
    let saldoCaixa = 0;
    let proventosConhecidos = [];
    let watchlist = []; 
    let alocacaoChartInstance = null;
    let historicoChartInstance = null;
    let patrimonioChartInstance = null; 
    let onConfirmCallback = null; 
    let precosAtuais = [];
    let proventosAtuais = [];
    let mesesProcessados = [];
    const todayString = new Date().toLocaleDateString('pt-BR', { year: 'numeric', month: 'long', day: 'numeric' });
    let lastAlocacaoData = null; 
    let lastHistoricoData = null;
    let lastPatrimonioData = null; 
    let detalhesChartInstance = null;
    let toastTimer = null;
    let isToastShowing = false;
    let touchStartY = 0;
    let touchMoveY = 0;
    let isDraggingDetalhes = false;
    let newWorker;
    let transacaoEmEdicao = null;
    let currentDetalhesSymbol = null;
    let currentDetalhesMeses = 3; 
    let currentDetalhesHistoricoJSON = null; 

    function showToast(message, type = 'error') {
        clearTimeout(toastTimer);
        toastMessageElement.textContent = message;

        toastElement.classList.remove(
            'bg-red-800', 'border-red-600',
            'bg-green-700', 'border-green-500'
        );
        
        if (type === 'success') {
            toastElement.classList.add('bg-green-700', 'border-green-500');
            toastIconError.classList.add('hidden'); 
            toastIconSuccess.classList.remove('hidden'); 
        } else {
            toastElement.classList.add('bg-red-800', 'border-red-600');
            toastIconError.classList.remove('hidden'); 
            toastIconSuccess.classList.add('hidden'); 
        }

        if (isToastShowing && toastElement.classList.contains('toast-visible')) {
            toastElement.classList.add('toast-shake');
            setTimeout(() => toastElement.classList.remove('toast-shake'), 500);
        } else {
            isToastShowing = true;
            toastElement.classList.remove('toast-shake');
            toastElement.classList.add('toast-visible');
        }
        toastTimer = setTimeout(() => {
            toastElement.classList.remove('toast-visible');
            isToastShowing = false;
        }, 3000);
    }

    async function verificarStatusBiometria() {
        const bioEnabled = localStorage.getItem('vesto_bio_enabled') === 'true';
        
        if (bioStatusIcon) {
            if (bioEnabled) {
                bioStatusIcon.classList.remove('text-gray-500', 'text-red-500');
                bioStatusIcon.classList.add('text-green-500');
            } else {
                bioStatusIcon.classList.remove('text-green-500', 'text-gray-500');
                bioStatusIcon.classList.add('text-red-500');
            }
        }

        if (bioEnabled && currentUserId && !biometricLockScreen.classList.contains('hidden')) {
            document.body.style.overflow = 'hidden';
            setTimeout(() => autenticarBiometria(), 500);
        }
    }

    async function ativarBiometria() {
        if (!window.PublicKeyCredential) {
            showToast('Seu dispositivo não suporta biometria.');
            return;
        }

        try {
            const challenge = new Uint8Array(32);
            window.crypto.getRandomValues(challenge);

            const currentDomain = window.location.hostname;
            const userIdBuffer = Uint8Array.from(currentUserId || "user_id", c => c.charCodeAt(0));

            const publicKey = {
                challenge: challenge,
                rp: { name: "Vesto App", id: currentDomain },
                user: {
                    id: userIdBuffer,
                    name: "usuario@vesto",
                    displayName: "Usuário Vesto"
                },
                pubKeyCredParams: [
                    { type: "public-key", alg: -7 },
                    { type: "public-key", alg: -257 }
                ],
                authenticatorSelection: { 
                    authenticatorAttachment: "platform", 
                    userVerification: "required"
                },
                timeout: 60000,
                attestation: "none"
            };

            const credential = await navigator.credentials.create({ publicKey });
            
            if (credential) {
                const credentialId = bufferToBase64(credential.rawId);
                localStorage.setItem('vesto_bio_id', credentialId);
                localStorage.setItem('vesto_bio_enabled', 'true');
                verificarStatusBiometria();
                showToast('Face ID / Digital ativado!', 'success');
            }
        } catch (e) {
            console.error("Erro biometria:", e);
            showToast(`Erro ao ativar: ${e.message || e.name}`);
        }
    }

    async function autenticarBiometria() {
        if (!window.PublicKeyCredential) return;
        const savedCredId = localStorage.getItem('vesto_bio_id');
        
        if (!savedCredId) {
            console.warn("Nenhuma credencial salva encontrada.");
            desativarBiometria();
            return;
        }

        try {
            const challenge = new Uint8Array(32);
            window.crypto.getRandomValues(challenge);

            const publicKey = {
                challenge: challenge,
                timeout: 60000,
                userVerification: "required",
                allowCredentials: [{
                    id: base64ToBuffer(savedCredId),
                    type: 'public-key',
                    transports: ['internal']
                }]
            };

            const assertion = await navigator.credentials.get({ publicKey });

            if (assertion) {
                biometricLockScreen.classList.add('hidden');
                document.body.style.overflow = '';
                showToast('Acesso liberado!', 'success');
            }
        } catch (e) {
            console.warn("Biometria cancelada ou falhou:", e);
            if (e.name !== 'NotAllowedError') {
                 showToast("Falha na leitura biométrica.");
            }
        }
    }

    function desativarBiometria() {
        localStorage.removeItem('vesto_bio_enabled');
        localStorage.removeItem('vesto_bio_id');
        verificarStatusBiometria();
        showToast('Biometria desativada.');
    }

    if (toggleBioBtn) {
        toggleBioBtn.addEventListener('click', () => {
            const isEnabled = localStorage.getItem('vesto_bio_enabled') === 'true';
            if (isEnabled) {
                showModal("Desativar Biometria?", "Deseja remover o bloqueio por Face ID/Digital?", () => {
                    desativarBiometria();
                });
            } else {
                showModal("Ativar Biometria?", "Isso usará o sensor do seu dispositivo para proteger o app.", () => {
                    ativarBiometria();
                });
            }
        });
    }

    if (btnDesbloquear) {
        btnDesbloquear.addEventListener('click', autenticarBiometria);
    }
    
    if (btnSairLock) {
        btnSairLock.addEventListener('click', async () => {
            await supabaseDB.signOut();
            window.location.reload();
        });
    }

    function showUpdateBar() {
        updateNotification.classList.remove('hidden');
        setTimeout(() => {
            updateNotification.style.opacity = '1';
            updateNotification.style.transform = 'translateY(0) translateX(-50%)'; 
        }, 10);
    }

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').then(registration => {
            registration.addEventListener('updatefound', () => {
                newWorker = registration.installing;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        showUpdateBar();
                    }
                });
            });
        });

        updateButton.addEventListener('click', () => {
            updateButton.textContent = 'A atualizar...';
            updateButton.disabled = true;
            if (newWorker) {
                newWorker.postMessage({ action: 'SKIP_WAITING' });
            }
        });

        navigator.serviceWorker.addEventListener('controllerchange', () => {
            window.location.reload();
        });
    }
    
    async function setCache(key, data, duration) { 
        const finalDuration = duration || (1000 * 60 * 60); 
        const cacheItem = { key: key, timestamp: Date.now(), data: data, duration: finalDuration };
        try { 
            await vestoDB.put('apiCache', cacheItem);
        } 
        catch (e) { 
            console.error("Erro ao salvar no cache IDB:", e); 
            await clearBrapiCache();
        }
    }
    
    async function removerCacheAtivo(symbol) {
        try {
            await vestoDB.delete('apiCache', `preco_${symbol}`);
            await vestoDB.delete('apiCache', `provento_ia_${symbol}`);
            await vestoDB.delete('apiCache', `detalhe_preco_${symbol}`);
            await vestoDB.delete('apiCache', `hist_ia_${symbol}_12`); 
            
            if (isFII(symbol)) {
                 const userKey = currentUserId ? `_${currentUserId}` : '';
                 await vestoDB.delete('apiCache', `cache_grafico_historico${userKey}`);
            }

        } catch (e) {
            console.error("Erro ao remover cache do ativo:", e);
        }
    }
    
    async function removerProventosConhecidos(symbol) {
        proventosConhecidos = proventosConhecidos.filter(p => p.symbol !== symbol);
        try {
            await supabaseDB.deleteProventosDoAtivo(symbol);
        } catch (e) {
            console.error(`Erro ao remover proventos conhecidos do DB para ${symbol}:`, e);
        }
    }
    
    async function getCache(key) {
        try {
            const cacheItem = await vestoDB.get('apiCache', key);
            if (!cacheItem) return null;
            
            const duration = cacheItem.duration; 
            if (duration === -1) { return cacheItem.data; }
            
            const isExpired = (Date.now() - cacheItem.timestamp) > duration;
            if (isExpired) { 
                await vestoDB.delete('apiCache', key).catch(err => {
                    console.warn(`Erro ao deletar cache expirado (${key}):`, err);
                }); 
                return null; 
            }
            return cacheItem.data;
        } catch (e) {
            console.error(`Erro ao buscar cache (${key}):`, e);
            return null;
        }
    }
    
    async function clearBrapiCache() {
        await vestoDB.clear('apiCache');
    }

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    function gerarCores(num) {
        const PALETA_CORES = [
            '#c084fc', '#7c3aed', '#a855f7', '#8b5cf6',
            '#6d28d9', '#5b21b6', '#3b82f6', '#22c55e',
            '#f97316', '#ef4444'
        ];
        let cores = [];
        for (let i = 0; i < num; i++) { cores.push(PALETA_CORES[i % PALETA_CORES.length]); }
        return cores;
    }
    
    function showModal(title, message, onConfirm) {
        customModalTitle.textContent = title;
        customModalMessage.textContent = message;
        onConfirmCallback = onConfirm; 
        customModal.classList.add('visible');
        customModalContent.classList.remove('modal-out');
    }

    function hideModal() {
        onConfirmCallback = null; 
        customModalContent.classList.add('modal-out');
        setTimeout(() => {
            customModal.classList.remove('visible');
            customModalContent.classList.remove('modal-out');
        }, 200); 
    }
    
    function showAddModal() {
        addAtivoModal.classList.add('visible');
        addAtivoModalContent.classList.remove('modal-out');
        
        if (!transacaoEmEdicao) {
            dateInput.value = new Date().toISOString().split('T')[0];
            tickerInput.focus();
        }
    }
    
    function hideAddModal() {
        addAtivoModalContent.classList.add('modal-out');
        setTimeout(() => {
            addAtivoModal.classList.remove('visible');
            addAtivoModalContent.classList.remove('modal-out');
            
            tickerInput.value = '';
            quantityInput.value = '';
            precoMedioInput.value = '';
            dateInput.value = '';
            transacaoIdInput.value = '';
            
            transacaoEmEdicao = null;
            tickerInput.disabled = false;
            addModalTitle.textContent = 'Adicionar Compra';
            addButton.textContent = 'Adicionar';
            
            tickerInput.classList.remove('border-red-500');
            quantityInput.classList.remove('border-red-500');
            precoMedioInput.classList.remove('border-red-500');
            dateInput.classList.remove('border-red-500');
        }, 200);
    }
    
    function showDetalhesModal(symbol) {
        detalhesPageContent.style.transform = ''; 
        detalhesPageContent.classList.remove('closing'); 
        detalhesPageModal.classList.add('visible'); 
        document.body.style.overflow = 'hidden'; 
        detalhesConteudoScroll.scrollTop = 0; 
        handleMostrarDetalhes(symbol); 
    }
    
    function hideDetalhesModal() {
        detalhesPageContent.style.transform = ''; 
        detalhesPageContent.classList.add('closing'); 
        detalhesPageModal.classList.remove('visible'); 
        document.body.style.overflow = ''; 
        setTimeout(() => {
            limparDetalhes(); 
        }, 400); 
    }
    
    async function carregarTransacoes() {
        transacoes = await supabaseDB.getTransacoes();
    }
    
    async function carregarPatrimonio() {
         let allPatrimonio = await supabaseDB.getPatrimonio();
         allPatrimonio.sort((a, b) => new Date(a.date) - new Date(b.date));
         
         if (allPatrimonio.length > 365) {
            patrimonio = allPatrimonio.slice(allPatrimonio.length - 365);
         } else {
            patrimonio = allPatrimonio;
         }
    }
    
    async function salvarSnapshotPatrimonio(totalValor) {
        if (totalValor <= 0 && patrimonio.length === 0) return; 
        const today = new Date().toISOString().split('T')[0];
        
        const snapshot = { date: today, value: totalValor };
        await supabaseDB.savePatrimonioSnapshot(snapshot);
        
        const index = patrimonio.findIndex(p => p.date === today);
        if (index > -1) {
            patrimonio[index].value = totalValor;
        } else {
            patrimonio.push(snapshot);
        }
    }

    async function carregarCaixa() {
        const caixaState = await supabaseDB.getAppState('saldoCaixa');
        saldoCaixa = caixaState ? caixaState.value : 0;
    }

    async function salvarCaixa() {
        await supabaseDB.saveAppState('saldoCaixa', { value: saldoCaixa });
    }

    async function carregarProventosConhecidos() {
        proventosConhecidos = await supabaseDB.getProventosConhecidos();
    }
    
    async function carregarWatchlist() {
        watchlist = await supabaseDB.getWatchlist();
    }

    function renderizarWatchlist() {
        watchlistListaEl.innerHTML = ''; 

        if (watchlist.length === 0) {
            watchlistStatusEl.classList.remove('hidden');
            return;
        }
        
        watchlistStatusEl.classList.add('hidden');
        
        watchlist.sort((a, b) => a.symbol.localeCompare(b.symbol));

        const fragment = document.createDocumentFragment();
        watchlist.forEach(item => {
            const symbol = item.symbol;
            const el = document.createElement('div');
            el.className = 'flex justify-between items-center p-3 bg-gray-800 rounded-lg';
            el.innerHTML = `
                <span class="font-semibold text-white">${symbol}</span>
                <button class="py-1 px-3 text-xs font-medium text-purple-300 bg-purple-900/50 hover:bg-purple-900/80 rounded-md transition-colors" data-symbol="${symbol}" data-action="details">
                    Ver Detalhes
                </button>
            `;
            fragment.appendChild(el);
        });
        watchlistListaEl.appendChild(fragment);
    }
    
    function atualizarIconeFavorito(symbol) {
        if (!symbol || !detalhesFavoritoBtn) return;

        const isFavorite = watchlist.some(item => item.symbol === symbol);
        
        detalhesFavoritoIconEmpty.classList.toggle('hidden', isFavorite);
        detalhesFavoritoIconFilled.classList.toggle('hidden', !isFavorite);
        detalhesFavoritoBtn.dataset.symbol = symbol; 
    }

    async function carregarHistoricoProcessado() {
        const histState = await supabaseDB.getAppState('historicoProcessado');
        mesesProcessados = histState ? histState.value : [];
    }

    async function salvarHistoricoProcessado() {
        await supabaseDB.saveAppState('historicoProcessado', { value: mesesProcessados });
    }

    async function processarDividendosPagos() {
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        
        const carteiraMap = new Map(carteiraCalculada.map(a => [a.symbol, a.quantity]));
        let precisaSalvarCaixa = false;
        let proventosParaSalvar = [];

        proventosConhecidos.forEach(provento => {
            if (provento.paymentDate && !provento.processado) {
                const parts = provento.paymentDate.split('-');
                const dataPagamento = new Date(parts[0], parts[1] - 1, parts[2]);

                if (!isNaN(dataPagamento) && dataPagamento < hoje) {
                    const quantity = carteiraMap.get(provento.symbol) || 0;
                    if (quantity > 0 && typeof provento.value === 'number' && provento.value > 0) {
                        const valorRecebido = provento.value * quantity;
                        saldoCaixa += valorRecebido;
                        precisaSalvarCaixa = true;
                    }
                    
                    provento.processado = true;
                    proventosParaSalvar.push(provento);
                }
            }
        });

        if (precisaSalvarCaixa) {
            await salvarCaixa();
        }
        if (proventosParaSalvar.length > 0) {
            for (const provento of proventosParaSalvar) {
                await supabaseDB.updateProventoProcessado(provento.id);
            }
        }
    }

    function calcularCarteira() {
        const ativosMap = new Map();
        const transacoesOrdenadas = [...transacoes].sort((a, b) => new Date(a.date) - new Date(b.date));

        for (const t of transacoesOrdenadas) {
            if (t.type !== 'buy') continue;
            const symbol = t.symbol;
            let ativo = ativosMap.get(symbol) || { 
                symbol: symbol, 
                quantity: 0, 
                totalCost: 0, 
                dataCompra: t.date
            };
            ativo.quantity += t.quantity;
            ativo.totalCost += t.quantity * t.price;
            ativosMap.set(symbol, ativo);
        }
        
        carteiraCalculada = Array.from(ativosMap.values())
            .filter(a => a.quantity > 0) 
            .map(a => ({
                symbol: a.symbol,
                quantity: a.quantity,
                precoMedio: a.quantity > 0 ? parseFloat((a.totalCost / a.quantity).toFixed(2)) : 0,
                dataCompra: a.dataCompra
            }));
    }

    function renderizarGraficoAlocacao(dadosGrafico) {
        const canvas = document.getElementById('alocacao-chart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        
        if (dadosGrafico.length === 0) {
            if (alocacaoChartInstance) {
                alocacaoChartInstance.destroy();
                alocacaoChartInstance = null; 
            }
            lastAlocacaoData = null; 
            return;
        }
        
        const labels = dadosGrafico.map(d => d.symbol);
        const data = dadosGrafico.map(d => d.totalPosicao);
        const newDataString = JSON.stringify({ labels, data });

        if (newDataString === lastAlocacaoData) { return; }
        lastAlocacaoData = newDataString; 
        
        const colors = gerarCores(labels.length);

        if (alocacaoChartInstance) {
            alocacaoChartInstance.data.labels = labels;
            alocacaoChartInstance.data.datasets[0].data = data;
            alocacaoChartInstance.data.datasets[0].backgroundColor = colors;
            alocacaoChartInstance.update();
        } else {
            alocacaoChartInstance = new Chart(ctx, {
                type: 'doughnut',
                data: { labels: labels, datasets: [{ data: data, backgroundColor: colors, borderWidth: 0, }] },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { display: true, position: 'bottom', labels: { color: '#f3f4f6', boxWidth: 12, padding: 15, } },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const label = context.label || '';
                                    const value = context.parsed || 0;
                                    const total = context.chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
                                    const percent = ((value / total) * 100).toFixed(2);
                                    return `${label}: ${formatBRL(value)} (${percent}%)`;
                                }
                            }
                        }
                    }
                }
            });
        }
    }
    
    function renderizarGraficoHistorico({ labels, data }) {
        const canvas = document.getElementById('historico-proventos-chart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const newDataString = JSON.stringify({ labels, data });

        if (newDataString === lastHistoricoData) { return; }
        lastHistoricoData = newDataString; 
        
        if (!labels || !data || labels.length === 0) {
            if (historicoChartInstance) {
                historicoChartInstance.destroy();
                historicoChartInstance = null; 
            }
            return;
        }
        
        const gradient = ctx.createLinearGradient(0, 0, 0, 256); 
        gradient.addColorStop(0, 'rgba(192, 132, 252, 0.9)'); 
        gradient.addColorStop(1, 'rgba(124, 58, 237, 0.9)');  
        
        const hoverGradient = ctx.createLinearGradient(0, 0, 0, 256);
        hoverGradient.addColorStop(0, 'rgba(216, 180, 254, 1)'); 
        hoverGradient.addColorStop(1, 'rgba(139, 92, 246, 1)');  
        
        if (historicoChartInstance) {
            historicoChartInstance.data.labels = labels;
            historicoChartInstance.data.datasets[0].data = data;
            historicoChartInstance.data.datasets[0].backgroundColor = gradient;
            historicoChartInstance.data.datasets[0].hoverBackgroundColor = hoverGradient;
            historicoChartInstance.data.datasets[0].borderColor = 'rgba(192, 132, 252, 0.3)'; 
            historicoChartInstance.update();
        } else {
            historicoChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Total Recebido',
                        data: data,
                        backgroundColor: gradient,
                        hoverBackgroundColor: hoverGradient,
                        borderColor: 'rgba(192, 132, 252, 0.3)', 
                        borderWidth: 1,
                        borderRadius: 5 
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: '#1A1A1A',
                            titleColor: '#f3f4f6',
                            bodyColor: '#f3f4f6',
                            borderColor: '#2A2A2A',
                            borderWidth: 1,
                            padding: 10,
                            displayColors: false, 
                            callbacks: {
                                title: (context) => `Mês: ${context[0].label}`, 
                                label: (context) => `Total: ${formatBRL(context.parsed.y)}`
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: { color: '#2A2A2A' }, 
                            ticks: { display: false }
                        },
                        x: { grid: { display: false } }
                    }
                }
            });
        }
    }
    
    function renderizarGraficoProventosDetalhes({ labels, data }) {
        const canvas = document.getElementById('detalhes-proventos-chart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
    
        if (!labels || !data || labels.length === 0) {
            if (detalhesChartInstance) {
                detalhesChartInstance.destroy();
                detalhesChartInstance = null; 
            }
            return;
        }
    
        const gradient = ctx.createLinearGradient(0, 0, 0, 192);
        gradient.addColorStop(0, 'rgba(192, 132, 252, 0.9)'); 
        gradient.addColorStop(1, 'rgba(124, 58, 237, 0.9)');  
        
        const hoverGradient = ctx.createLinearGradient(0, 0, 0, 192);
        hoverGradient.addColorStop(0, 'rgba(216, 180, 254, 1)'); 
        hoverGradient.addColorStop(1, 'rgba(139, 92, 246, 1)');  
    
        if (detalhesChartInstance) {
            detalhesChartInstance.data.labels = labels;
            detalhesChartInstance.data.datasets[0].data = data;
            detalhesChartInstance.data.datasets[0].backgroundColor = gradient;
            detalhesChartInstance.data.datasets[0].hoverBackgroundColor = hoverGradient;
            detalhesChartInstance.data.datasets[0].borderColor = 'rgba(192, 132, 252, 0.3)';
            detalhesChartInstance.update();
        } else {
            detalhesChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Recebido',
                        data: data,
                        backgroundColor: gradient,
                        hoverBackgroundColor: hoverGradient,
                        borderColor: 'rgba(192, 132, 252, 0.3)', 
                        borderWidth: 1,
                        borderRadius: 4 
                    }]
                },
                options: {
                    responsive: true, 
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: '#1A1A1A',
                            borderColor: '#2A2A2A',
                            borderWidth: 1,
                            padding: 10,
                            displayColors: false, 
                            callbacks: {
                                title: (context) => `Mês: ${context[0].label}`, 
                                label: (context) => `Valor: ${formatBRL(context.parsed.y)}`
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: { color: '#2A2A2A' }, 
                            ticks: { 
                                display: true,
                                color: '#6b7280',
                                font: { size: 10 },
                                callback: function(value) {
                                    return formatBRL(value);
                                }
                            }
                        },
                        x: { 
                            grid: { display: false },
                            ticks: {
                                color: '#9ca3af',
                                font: { size: 10 }
                            }
                        }
                    }
                }
            });
        }
    function renderizarGraficoPatrimonio() {
        const canvas = document.getElementById('patrimonio-chart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        
        const labels = patrimonio.map(p => formatDate(p.date));
        const data = patrimonio.map(p => p.value);
        const newDataString = JSON.stringify({ labels, data });

        if (newDataString === lastPatrimonioData) { return; }
        lastPatrimonioData = newDataString;
        
        if (labels.length === 0) {
            if (patrimonioChartInstance) {
                patrimonioChartInstance.destroy();
                patrimonioChartInstance = null;
            }
            return;
        }

        const gradient = ctx.createLinearGradient(0, 0, 0, 256);
        gradient.addColorStop(0, 'rgba(192, 132, 252, 0.6)'); 
        gradient.addColorStop(1, 'rgba(124, 58, 237, 0.0)');  

        if (patrimonioChartInstance) {
            patrimonioChartInstance.data.labels = labels;
            patrimonioChartInstance.data.datasets[0].data = data;
            
            patrimonioChartInstance.data.datasets[0].backgroundColor = gradient;
            patrimonioChartInstance.data.datasets[0].borderColor = '#c084fc';
            patrimonioChartInstance.data.datasets[0].pointBackgroundColor = '#c084fc';
            
            patrimonioChartInstance.data.datasets[0].pointRadius = 3;
            patrimonioChartInstance.data.datasets[0].pointHitRadius = 15;
            patrimonioChartInstance.data.datasets[0].pointHoverRadius = 5;
            
            patrimonioChartInstance.update();
        } else {
            patrimonioChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Patrimônio',
                        data: data,
                        fill: true,
                        backgroundColor: gradient,
                        borderColor: '#c084fc', 
                        tension: 0.1,
                        pointRadius: 3, 
                        pointBackgroundColor: '#c084fc', 
                        pointHitRadius: 15, 
                        pointHoverRadius: 5 
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (context) => `Patrimônio: ${formatBRL(context.parsed.y)}`
                            }
                        }
                    },
                    scales: {
                        y: { beginAtZero: false, ticks: { display: false }, grid: { color: '#2A2A2A' } },
                        x: { ticks: { display: false }, grid: { display: false } }
                    }
                }
            });
        }
    }
    
    function renderizarDashboardSkeletons(show) {
        const skeletons = [skeletonTotalValor, skeletonTotalCusto, skeletonTotalPL, skeletonTotalProventos, skeletonTotalCaixa];
        const dataElements = [totalCarteiraValor, totalCarteiraCusto, totalCarteiraPL, totalProventosEl, totalCaixaValor];
        
        if (show) {
            skeletons.forEach(el => el.classList.remove('hidden'));
            dataElements.forEach(el => el.classList.add('hidden'));
        } else {
            skeletons.forEach(el => el.classList.add('hidden'));
            dataElements.forEach(el => el.classList.remove('hidden'));
        }
    }
    
    function renderizarCarteiraSkeletons(show) {
        if (show) {
            skeletonListaCarteira.classList.remove('hidden');
            carteiraStatus.classList.add('hidden');
        } else {
            skeletonListaCarteira.classList.add('hidden');
        }
    }
    
    async function renderizarCarteira() {
        renderizarCarteiraSkeletons(false);

        const precosMap = new Map(precosAtuais.map(p => [p.symbol, p]));
        const proventosMap = new Map(proventosAtuais.map(p => [p.symbol, p]));
        const carteiraOrdenada = [...carteiraCalculada].sort((a, b) => a.symbol.localeCompare(b.symbol));

        let totalValorCarteira = 0;
        let totalCustoCarteira = 0;
        let dadosGrafico = [];

        if (carteiraOrdenada.length === 0) {
            listaCarteira.innerHTML = ''; 
            carteiraStatus.classList.remove('hidden');
            renderizarDashboardSkeletons(false);
            totalCarteiraValor.textContent = formatBRL(0);
            totalCaixaValor.textContent = formatBRL(saldoCaixa);
            totalCarteiraCusto.textContent = formatBRL(0);
            totalCarteiraPL.textContent = `${formatBRL(0)} (---%)`;
            totalCarteiraPL.className = `text-lg font-semibold text-gray-500`;
            dashboardMensagem.textContent = 'A sua carteira está vazia. Adicione ativos na aba "Carteira" para começar.';
            dashboardLoading.classList.add('hidden');
            dashboardStatus.classList.remove('hidden');
            renderizarGraficoAlocacao([]);
            renderizarGraficoHistorico({ labels: [], data: [] });
            await salvarSnapshotPatrimonio(saldoCaixa);
            renderizarGraficoPatrimonio();
            return; 
        } else {
            carteiraStatus.classList.add('hidden');
            dashboardStatus.classList.add('hidden');
        }

        const symbolsNaCarteira = new Set(carteiraOrdenada.map(a => a.symbol));

        const cardsNaTela = listaCarteira.querySelectorAll('[data-symbol]');
        cardsNaTela.forEach(card => {
            const symbol = card.dataset.symbol;
            if (!symbolsNaCarteira.has(symbol)) {
                card.remove();
            }
        });

        carteiraOrdenada.forEach(ativo => {
            const dadoPreco = precosMap.get(ativo.symbol);
            const dadoProvento = proventosMap.get(ativo.symbol);

            let precoAtual = 0, variacao = 0, precoFormatado = 'N/A', variacaoFormatada = '0.00%', corVariacao = 'text-gray-500';
            if (dadoPreco) {
                precoAtual = dadoPreco.regularMarketPrice ?? 0;
                variacao = dadoPreco.regularMarketChangePercent ?? 0;
                precoFormatado = formatBRL(precoAtual);
                variacaoFormatada = formatPercent(variacao);
                corVariacao = variacao > 0 ? 'text-green-500' : (variacao < 0 ? 'text-red-500' : 'text-gray-500');
            } else {
                precoFormatado = 'A carregar...';
                corVariacao = 'text-yellow-500';
            }
            
            const totalPosicao = precoAtual * ativo.quantity;
            const custoTotal = ativo.precoMedio * ativo.quantity;
            const lucroPrejuizo = totalPosicao - custoTotal;
            const lucroPrejuizoPercent = (custoTotal === 0 || totalPosicao === 0) ? 0 : (lucroPrejuizo / custoTotal) * 100;
            
            let corPL = 'text-gray-500', bgPL = 'bg-gray-800';
            if (lucroPrejuizo > 0.01) { corPL = 'text-green-500'; bgPL = 'bg-green-900/50'; }
            else if (lucroPrejuizo < -0.01) { corPL = 'text-red-500'; bgPL = 'bg-red-900/50'; }

            const dadosRender = {
                dadoPreco,
                precoFormatado,
                variacaoFormatada,
                corVariacao,
                totalPosicao,
                custoTotal,
                lucroPrejuizo,
                lucroPrejuizoPercent,
                corPL,
                bgPL,
                dadoProvento
            };

            totalValorCarteira += totalPosicao;
            totalCustoCarteira += custoTotal;
            if (totalPosicao > 0) { dadosGrafico.push({ symbol: ativo.symbol, totalPosicao: totalPosicao }); }

            let card = listaCarteira.querySelector(`[data-symbol="${ativo.symbol}"]`);
            
            if (card) {
                atualizarCardElemento(card, ativo, dadosRender);
            } else {
                card = criarCardElemento(ativo, dadosRender);
                listaCarteira.appendChild(card);
            }
        });

        if (carteiraOrdenada.length > 0) {
            const patrimonioTotalAtivos = totalValorCarteira;
            const totalLucroPrejuizo = totalValorCarteira - totalCustoCarteira;
            const totalLucroPrejuizoPercent = (totalCustoCarteira === 0) ? 0 : (totalLucroPrejuizo / totalCustoCarteira) * 100;
            
            let corPLTotal = 'text-gray-500';
            if (totalLucroPrejuizo > 0.01) corPLTotal = 'text-green-500';
            else if (totalLucroPrejuizo < -0.01) corPLTotal = 'text-red-500';
            
            renderizarDashboardSkeletons(false);
            totalCarteiraValor.textContent = formatBRL(patrimonioTotalAtivos);
            totalCaixaValor.textContent = formatBRL(saldoCaixa);
            totalCarteiraCusto.textContent = formatBRL(totalCustoCarteira);
            totalCarteiraPL.textContent = `${formatBRL(totalLucroPrejuizo)} (${totalLucroPrejuizoPercent.toFixed(2)}%)`;
            totalCarteiraPL.className = `text-lg font-semibold ${corPLTotal}`;
            
            const patrimonioRealParaSnapshot = patrimonioTotalAtivos + saldoCaixa; 
            await salvarSnapshotPatrimonio(patrimonioRealParaSnapshot);
        }
        
        renderizarGraficoAlocacao(dadosGrafico);
        renderizarGraficoPatrimonio(); 
    }

    function renderizarProventos() {
        let totalEstimado = 0;
        const carteiraMap = new Map(carteiraCalculada.map(a => [a.symbol, a.quantity]));
        
        proventosAtuais.forEach(provento => {
            const quantity = carteiraMap.get(provento.symbol) || 0;
            if (quantity > 0 && typeof provento.value === 'number' && provento.value > 0) { 
                totalEstimado += (quantity * provento.value);
            }
        });
        totalProventosEl.textContent = formatBRL(totalEstimado);
    }
    
    function renderizarHistorico() {
        listaHistorico.innerHTML = '';
        if (transacoes.length === 0) {
            historicoStatus.classList.remove('hidden');
            return;
        }
        
        historicoStatus.classList.add('hidden');
        const fragment = document.createDocumentFragment();

        [...transacoes].sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(t => {
            const card = document.createElement('div');
            card.className = 'card-bg p-4 rounded-2xl flex items-center justify-between';
            const cor = 'text-green-500';
            const sinal = '+';
            const icone = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 ${cor}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
            
            card.innerHTML = `
                <div class="flex items-center gap-3">
                    ${icone}
                    <div>
                        <h3 class="text-base font-semibold text-white">${t.symbol}</h3>
                        <p class="text-sm text-gray-400">${formatDate(t.date)}</p>
                    </div>
                </div>
                <div class="flex items-center gap-4">
                    <div class="text-right">
                        <p class="text-base font-semibold ${cor}">${sinal}${t.quantity} Cotas</p>
                        <p class="text-sm text-gray-400">${formatBRL(t.price)}</p>
                    </div>
                    <div class="flex flex-col gap-2">
                        <button class="p-1 text-gray-500 hover:text-purple-400 transition-colors" data-action="edit" data-id="${t.id}" title="Editar">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" />
                              <path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd" />
                            </svg>
                        </button>
                        <button class="p-1 text-gray-500 hover:text-red-500 transition-colors" data-action="delete" data-id="${t.id}" data-symbol="${t.symbol}" title="Excluir">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                              <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                            </svg>
                        </button>
                    </div>
                </div>
            `;
            fragment.appendChild(card);
        });
        listaHistorico.appendChild(fragment);
    }

    function renderizarNoticias(articles) { 
        fiiNewsSkeleton.classList.add('hidden');
        fiiNewsList.innerHTML = ''; 
        fiiNewsMensagem.classList.add('hidden');

        if (!articles || articles.length === 0) {
            fiiNewsMensagem.textContent = 'Nenhuma notícia encontrada.';
            fiiNewsMensagem.classList.remove('hidden');
            return;
        }
        
        articles.sort((a, b) => new Date(b.publicationDate) - new Date(a.publicationDate));
        
        const fragment = document.createDocumentFragment();

        articles.forEach((article, index) => {
            const sourceName = article.sourceName || 'Fonte';
            const sourceHostname = article.sourceHostname || 'google.com'; 
            const publicationDate = article.publicationDate ? formatDate(article.publicationDate) : 'Data indisponível';
            const drawerId = `news-drawer-${index}`;
            const faviconUrl = `https://www.google.com/s2/favicons?domain=${sourceHostname}&sz=32`;
            
            let tagsHtml = '';
            if (article.relatedTickers && article.relatedTickers.length > 0) {
                const tags = article.relatedTickers.map(ticker => `
                    <button 
                        class="news-ticker-tag"
                        data-action="view-ticker"
                        data-symbol="${ticker}"
                    >
                        ${ticker}
                    </button>
                `).join('');
                tagsHtml = `<div class="mt-3 flex flex-wrap items-center">${tags}</div>`;
            }
            
            let linkHtml = '';
            if (article.url) {
                linkHtml = `
                <a href="${article.url}" target="_blank" rel="noopener noreferrer" 
                   class="mt-4 block w-full text-center py-2 px-4 bg-purple-900/50 hover:bg-purple-900/80 text-purple-200 text-sm font-medium rounded-lg transition-colors border border-purple-900">
                   Ler matéria completa em ${sourceName}
                </a>`;
            }

            // INICIO DA ALTERAÇÃO PARA IMAGEM
            let imageHtml = '';
            if (article.imageUrl) {
                imageHtml = `
                    <div class="mb-3 rounded-lg overflow-hidden border border-gray-700">
                        <img src="${article.imageUrl}" 
                             alt="Imagem da notícia" 
                             class="w-full h-40 object-cover"
                             onerror="this.parentElement.style.display='none';"
                        />
                    </div>
                `;
            }
            // FIM DA ALTERAÇÃO
            
            const drawerContentHtml = `
                ${imageHtml}
                <p class="news-card-summary">
                    ${article.summary || 'Resumo da notícia não disponível.'}
                </p>
                ${tagsHtml}
                ${linkHtml}
            `;

            const newsCard = document.createElement('div');
            newsCard.className = 'card-bg rounded-2xl p-4 space-y-3'; 
            newsCard.innerHTML = `
                <div class="flex items-start gap-3">
                    <img src="${faviconUrl}" alt="Logo ${sourceName}" 
                         class="w-10 h-10 rounded-lg object-contain p-1.5 flex-shrink-0 bg-gray-700"
                         onerror="this.style.backgroundColor='#4b5563'; this.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';" 
                    />
                    <div class="flex-1 min-w-0">
                        <h4 class="font-semibold text-white">${article.title || 'Título indisponível'}</h4>
                        <span class="text-sm text-gray-400">${sourceName} &bull; ${publicationDate}</span>
                    </div>
                    <button class="p-1 text-gray-500 hover:text-white transition-colors rounded-full hover:bg-gray-700 flex-shrink-0 ml-2" 
                            data-action="toggle-news" data-target="${drawerId}" title="Ler mais">
                        <svg class="card-arrow-icon w-6 h-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                        </svg>
                    </button>
                </div>
                
                <div id="${drawerId}" class="card-drawer">
                    <div class="drawer-content pt-3 border-t border-gray-800">
                        ${drawerContentHtml}
                    </div>
                </div>
            `;
            fragment.appendChild(newsCard);
        });
        fiiNewsList.appendChild(fragment);
    }

    async function handleAtualizarNoticias(force = false) {
        const cacheKey = 'noticias_json_v4';
        
        if (!force) {
            const cache = await getCache(cacheKey);
            if (cache) {
                renderizarNoticias(cache);
                return;
            }
        }
        
        fiiNewsSkeleton.classList.remove('hidden');
        fiiNewsList.innerHTML = '';
        fiiNewsMensagem.classList.add('hidden');

        const refreshIcon = refreshNoticiasButton.querySelector('svg');
        if (force) {
            refreshIcon.classList.add('spin-animation');
        }

        try {
            const articles = await fetchAndCacheNoticiasBFF_NetworkOnly();
            renderizarNoticias(articles);
        } catch (e) {
            console.error("Erro ao buscar notícias (função separada):", e);
            fiiNewsSkeleton.classList.add('hidden');
            fiiNewsMensagem.textContent = 'Erro ao carregar notícias.';
            fiiNewsMensagem.classList.remove('hidden');
        } finally {
            refreshIcon.classList.remove('spin-animation');
        }
    }

    async function fetchAndCacheNoticiasBFF_NetworkOnly() {
        const cacheKey = 'noticias_json_v4';
        
        await vestoDB.delete('apiCache', cacheKey);
        
        try {
            const response = await fetchBFF('/api/news', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ todayString: todayString }) 
            });
            const articles = response.json;
            
            if (articles && Array.isArray(articles) && articles.length > 0) {
                await setCache(cacheKey, articles, CACHE_NOTICIAS);
            } else {
                console.warn("API de notícias retornou vazio ou inválido.");
            }
            return articles;
        } catch (error) {
            console.error("Erro ao buscar notícias (BFF):", error);
            throw error;
        }
    }
    
    async function fetchBFF(url, options = {}) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000); 
            
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeoutId); 

            if (!response.ok) {
                const errorBody = await response.json();
                throw new Error(errorBody.error || `Erro do servidor: ${response.statusText}`);
            }
            return response.json();
        } catch (error) {
            if (error.name === 'AbortError') {
                console.error(`Erro ao chamar o BFF ${url}:`, "Timeout de 60s excedido");
                throw new Error("O servidor demorou muito para responder.");
            }
            console.error(`Erro ao chamar o BFF ${url}:`, error);
            throw error;
        }
    }
    
    async function buscarPrecosCarteira(force = false) { 
        if (carteiraCalculada.length === 0) return [];
        
        const mercadoAberto = isB3Open();
        const duracaoCachePreco = mercadoAberto ? CACHE_PRECO_MERCADO_ABERTO : CACHE_PRECO_MERCADO_FECHADO;

        const promessas = carteiraCalculada.map(async (ativo) => {
            const cacheKey = `preco_${ativo.symbol}`;
            if (force) {
                await vestoDB.delete('apiCache', cacheKey);
            }
            
            if (!force) {
                const precoCache = await getCache(cacheKey);
                if (precoCache) return precoCache;
            }
            try {
                const tickerParaApi = isFII(ativo.symbol) ? `${ativo.symbol}.SA` : ativo.symbol;
                const data = await fetchBFF(`/api/brapi?path=/quote/${tickerParaApi}?range=1d&interval=1d`);
                const result = data.results?.[0];

                if (result && !result.error) {
                    if (result.symbol.endsWith('.SA')) result.symbol = result.symbol.replace('.SA', '');
                    await setCache(cacheKey, result, duracaoCachePreco); 
                    return result;
                } else {
                    return null;
                }
            } catch (err) {
                console.error(`Erro ao buscar preço para ${ativo.symbol}:`, err);
                return null;
            }
        });
        const resultados = await Promise.all(promessas);
        return resultados.filter(p => p !== null);
    }

    function processarProventosIA(proventosDaIA = []) {
        const hoje = new Date(); 
        hoje.setHours(0, 0, 0, 0);
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

        return proventosDaIA
            .map(proventoIA => {
                const ativoCarteira = carteiraCalculada.find(a => a.symbol === proventoIA.symbol);
                if (!ativoCarteira) return null;
                
                if (proventoIA.paymentDate && typeof proventoIA.value === 'number' && proventoIA.value > 0 && dateRegex.test(proventoIA.paymentDate)) {
                    const parts = proventoIA.paymentDate.split('-');
                    const dataPagamento = new Date(parts[0], parts[1] - 1, parts[2]); 
                    
                    if (!isNaN(dataPagamento) && dataPagamento >= hoje) {
                        return proventoIA;
                    }
                }
                return null; 
            })
            .filter(p => p !== null);
    }

    async function buscarProventosFuturos(force = false) {
        const fiiNaCarteira = carteiraCalculada
            .filter(a => isFII(a.symbol))
            .map(a => a.symbol);
            
        if (fiiNaCarteira.length === 0) return [];

        let proventosPool = [];
        let fiisParaBuscar = [];

        for (const symbol of fiiNaCarteira) {
            const cacheKey = `provento_ia_${symbol}`;
            if (force) {
                await vestoDB.delete('apiCache', cacheKey);
                await removerProventosConhecidos(symbol);
            }
            
            const proventoCache = await getCache(cacheKey);
            if (proventoCache) {
                proventosPool.push(proventoCache);
            } else {
                fiisParaBuscar.push(symbol);
            }
        }
        
        if (fiisParaBuscar.length > 0) {
            try {
                const novosProventos = await callGeminiProventosCarteiraAPI(fiisParaBuscar, todayString);
                
                if (novosProventos && Array.isArray(novosProventos)) {
                    for (const provento of novosProventos) {
                        if (provento && provento.symbol && provento.paymentDate) {
                            const cacheKey = `provento_ia_${provento.symbol}`;
                            await setCache(cacheKey, provento, CACHE_PROVENTOS); 
                            proventosPool.push(provento);

                            const idUnico = provento.symbol + '_' + provento.paymentDate;
                            const existe = proventosConhecidos.some(p => p.id === idUnico);
                            
                            if (!existe) {
                                const novoProvento = { ...provento, processado: false, id: idUnico };
                                await supabaseDB.addProventoConhecido(novoProvento);
                                proventosConhecidos.push(novoProvento);
                            }
                        }
                    }
                }
            } catch (error) {
                console.error("Erro ao buscar novos proventos com IA:", error);
            }
        }
        
        return processarProventosIA(proventosPool); 
    }

    async function buscarHistoricoProventosAgregado(force = false) {
        const fiiNaCarteira = carteiraCalculada.filter(a => isFII(a.symbol));
        if (fiiNaCarteira.length === 0) return { labels: [], data: [] };

        const fiiSymbols = fiiNaCarteira.map(a => a.symbol);
        
        const cacheKey = `cache_grafico_historico_${currentUserId}`;
        
        if (force) {
            await vestoDB.delete('apiCache', cacheKey);
        }
        
        let aiData = await getCache(cacheKey);

        if (!aiData) {
            try {
                aiData = await callGeminiHistoricoPortfolioAPI(fiiSymbols, todayString);
                if (aiData && aiData.length > 0) {
                    await setCache(cacheKey, aiData, CACHE_IA_HISTORICO);
                }
            } catch (e) {
                console.error("Erro ao buscar histórico agregado:", e);
                return { labels: [], data: [] }; 
            }
        }

        if (!aiData || aiData.length === 0) return { labels: [], data: [] };

        const carteiraMap = new Map(fiiNaCarteira.map(a => [a.symbol, { 
            quantity: a.quantity, 
            inicioMesCompra: new Date(new Date(a.dataCompra).setDate(1)).setHours(0, 0, 0, 0)
        }]));
        
        let precisaSalvarCaixa = false;
        let precisaSalvarHistorico = false;
        
        const dataAtual = new Date();
        const mesAtual = dataAtual.getMonth(); 
        const anoAtual = dataAtual.getFullYear();
        
        if (force) {
            saldoCaixa = 0;
            mesesProcessados = [];
        }

        const labels = aiData.map(d => d.mes);
        const data = aiData.map(mesData => {
            let totalMes = 0;
            const dataDoMes = parseMesAno(mesData.mes); 
            
            if (!dataDoMes) return 0;
            const timeDoMes = dataDoMes.getTime();

            fiiSymbols.forEach(symbol => {
                const ativo = carteiraMap.get(symbol);
                if (!ativo) return; 

                const quantity = ativo.quantity;
                const inicioMesCompraTime = ativo.inicioMesCompra;
                const valorPorCota = mesData[symbol] || 0;
                
                if (timeDoMes >= inicioMesCompraTime) {
                     totalMes += (valorPorCota * quantity);
                }
            });
            
            const mesHistorico = dataDoMes.getMonth(); 
            const anoHistorico = dataDoMes.getFullYear();

            const isPastMonth = anoHistorico < anoAtual || (anoHistorico === anoAtual && mesHistorico < mesAtual);
            const isNotProcessed = !mesesProcessados.includes(mesData.mes);
            
            if (isPastMonth && isNotProcessed && totalMes > 0) {
                saldoCaixa += totalMes;
                mesesProcessados.push(mesData.mes); 
                precisaSalvarCaixa = true;
                precisaSalvarHistorico = true;
            }
            
            return totalMes;
        });

        if (precisaSalvarCaixa) {
            await salvarCaixa();
            totalCaixaValor.textContent = formatBRL(saldoCaixa);
        }
        if (precisaSalvarHistorico) {
            await salvarHistoricoProcessado();
        }

        return { labels, data };
    }
    
     async function atualizarTodosDados(force = false) { 
        renderizarDashboardSkeletons(true);
        renderizarCarteiraSkeletons(true);
        
        calcularCarteira();
        await processarDividendosPagos(); 
        renderizarHistorico();
        renderizarGraficoPatrimonio(); 
        
        if (carteiraCalculada.length > 0) {
            dashboardStatus.classList.remove('hidden');
            dashboardLoading.classList.remove('hidden');
        }
        
        const refreshIcon = refreshButton.querySelector('svg'); 
        if (force) {
            refreshIcon.classList.add('spin-animation');
        }

        if (!force) {
            const proventosFuturosCache = processarProventosIA(proventosConhecidos);
            if (proventosFuturosCache.length > 0) {
                proventosAtuais = proventosFuturosCache;
                renderizarProventos();
            }
        }
        
        if (carteiraCalculada.length === 0) {
             precosAtuais = []; 
             proventosAtuais = []; 
             await renderizarCarteira(); 
             renderizarProventos(); 
             renderizarGraficoHistorico({ labels: [], data: [] }); 
             refreshIcon.classList.remove('spin-animation');
             return;
        }

        const promessaPrecos = buscarPrecosCarteira(force); 
        const promessaProventos = buscarProventosFuturos(force);
        const promessaHistorico = buscarHistoricoProventosAgregado(force);

        promessaPrecos.then(async precos => {
            if (precos.length > 0) {
                precosAtuais = precos; 
                await renderizarCarteira(); 
            } else if (precosAtuais.length === 0) { 
                await renderizarCarteira(); 
            }
        }).catch(async err => {
            console.error("Erro ao buscar preços (BFF):", err);
            showToast("Erro ao buscar preços."); 
            if (precosAtuais.length === 0) { await renderizarCarteira(); }
        });

        promessaProventos.then(async proventosFuturos => {
            proventosAtuais = proventosFuturos; 
            renderizarProventos(); 
            if (precosAtuais.length > 0) { 
                await renderizarCarteira(); 
            }
        }).catch(err => {
            console.error("Erro ao buscar proventos (BFF):", err);
            showToast("Erro ao buscar proventos."); 
            if (proventosAtuais.length === 0) { totalProventosEl.textContent = "Erro"; }
        });
        
        promessaHistorico.then(({ labels, data }) => {
            renderizarGraficoHistorico({ labels, data });
        }).catch(err => {
            console.error("Erro ao buscar histórico agregado (BFF):", err);
            showToast("Erro ao buscar histórico."); 
            renderizarGraficoHistorico({ labels: [], data: [] }); 
        });
        
        try {
            await Promise.allSettled([promessaPrecos, promessaProventos, promessaHistorico]); 
        } finally {
            refreshIcon.classList.remove('spin-animation');
            dashboardStatus.classList.add('hidden');
            dashboardLoading.classList.add('hidden');
        }
    }
    
    async function handleToggleFavorito() {
        const symbol = detalhesFavoritoBtn.dataset.symbol;
        if (!symbol) return;

        const isFavorite = watchlist.some(item => item.symbol === symbol);

        try {
            if (isFavorite) {
                await supabaseDB.deleteWatchlist(symbol);
                watchlist = watchlist.filter(item => item.symbol !== symbol);
                showToast(`${symbol} removido dos favoritos.`);
            } else {
                const newItem = { symbol: symbol, addedAt: new Date().toISOString() };
                await supabaseDB.addWatchlist(newItem);
                watchlist.push(newItem);
                showToast(`${symbol} adicionado aos favoritos!`, 'success');
            }
            
            atualizarIconeFavorito(symbol); 
            renderizarWatchlist(); 
        } catch (e) {
            console.error("Erro ao salvar favorito:", e);
            showToast("Erro ao salvar favorito.");
        }
    }
    
    async function handleSalvarTransacao() {
        let ticker = tickerInput.value.trim().toUpperCase();
        let novaQuantidade = parseInt(quantityInput.value, 10);
        let novoPreco = parseFloat(precoMedioInput.value.replace(',', '.')); 
        let dataTransacao = dateInput.value;
        let transacaoID = transacaoIdInput.value;

        if (ticker.endsWith('.SA')) ticker = ticker.replace('.SA', '');

        if (!ticker || !novaQuantidade || novaQuantidade <= 0 || !novoPreco || novoPreco < 0 || !dataTransacao) { 
            showToast("Preencha todos os campos."); 
            if (!ticker) tickerInput.classList.add('border-red-500');
            if (!novaQuantidade || novaQuantidade <= 0) quantityInput.classList.add('border-red-500');
            if (!novoPreco || novoPreco < 0) precoMedioInput.classList.add('border-red-500'); 
            if (!dataTransacao) dateInput.classList.add('border-red-500');
            setTimeout(() => {
                tickerInput.classList.remove('border-red-500');
                quantityInput.classList.remove('border-red-500');
                precoMedioInput.classList.remove('border-red-500'); 
                dateInput.classList.remove('border-red-500');
            }, 2000);
            return;
        }
        
        addButton.innerHTML = `<span class="loader-sm"></span>`;
        addButton.disabled = true;

        if (!transacaoID) {
            const ativoExistente = carteiraCalculada.find(a => a.symbol === ticker);

            if (!ativoExistente && isFII(ticker)) {
                console.log("[Caixa] Novo FII detectado. Resetando saldoCaixa e mesesProcessados.");
                saldoCaixa = 0;
                await salvarCaixa();
                mesesProcessados = [];
                await salvarHistoricoProcessado();
            }

            if (!ativoExistente) {
                const tickerParaApi = isFII(ticker) ? `${ticker}.SA` : ticker;
                try {
                     const quoteData = await fetchBFF(`/api/brapi?path=/quote/${tickerParaApi}?range=1d&interval=1d`);
                     if (!quoteData.results || quoteData.results[0].error) {
                         throw new Error(quoteData.results?.[0]?.error || 'Ativo não encontrado');
                     }
                } catch (error) {
                     console.error(`Erro ao verificar ativo ${tickerParaApi}:`, error);
                     showToast("Ativo não encontrado."); 
                     tickerInput.value = '';
                     tickerInput.placeholder = "Ativo não encontrado";
                     tickerInput.classList.add('border-red-500');
                     setTimeout(() => { 
                        tickerInput.placeholder = "Ativo (ex: MXRF11)"; 
                        tickerInput.classList.remove('border-red-500');
                     }, 2000);
                     addButton.innerHTML = `Adicionar`;
                     addButton.disabled = false;
                     return;
                }
            } 
        }
        
        const dataISO = new Date(dataTransacao + 'T12:00:00').toISOString();

        if (transacaoID) {
            const transacaoAtualizada = {
                date: dataISO,
                symbol: ticker,
                type: 'buy',
                quantity: novaQuantidade,
                price: novoPreco
            };
            
            await supabaseDB.updateTransacao(transacaoID, transacaoAtualizada);
            
            const index = transacoes.findIndex(t => t.id === transacaoID);
            if (index > -1) {
                transacoes[index] = { ...transacoes[index], ...transacaoAtualizada };
            }
            showToast("Transação atualizada!", 'success');
            
        } else {
            const novaTransacao = {
                id: 'tx_' + Date.now(),
                date: dataISO,
                symbol: ticker,
                type: 'buy',
                quantity: novaQuantidade,
                price: novoPreco
            };
            
            await supabaseDB.addTransacao(novaTransacao);
            transacoes.push(novaTransacao);
            showToast("Ativo adicionado!", 'success');
        }

        addButton.innerHTML = `Adicionar`;
        addButton.disabled = false;
        hideAddModal();
        
        await removerCacheAtivo(ticker); 
        const ativoExistente = carteiraCalculada.find(a => a.symbol === ticker);
        const forceUpdate = (!ativoExistente && isFII(ticker));
        
        await atualizarTodosDados(forceUpdate);
    }

    function handleRemoverAtivo(symbol) {
        showModal(
            'Remover Ativo', 
            `Tem certeza? Isso removerá ${symbol} e TODO o seu histórico de compras deste ativo.`, 
            async () => { 
                transacoes = transacoes.filter(t => t.symbol !== symbol);
                
                await supabaseDB.deleteTransacoesDoAtivo(symbol);
                await removerCacheAtivo(symbol); 
                await removerProventosConhecidos(symbol);
                
                await supabaseDB.deleteWatchlist(symbol);
                watchlist = watchlist.filter(item => item.symbol !== symbol);
                renderizarWatchlist();
                
                saldoCaixa = 0;
                await salvarCaixa();
                
                mesesProcessados = [];
                await salvarHistoricoProcessado();
                
                await atualizarTodosDados(true); 
            }
        );
    }
    
    function handleAbrirModalEdicao(id) {
        const tx = transacoes.find(t => t.id === id);
        if (!tx) {
            showToast("Erro: Transação não encontrada.");
            return;
        }
        
        transacaoEmEdicao = tx;
        
        addModalTitle.textContent = 'Editar Compra';
        transacaoIdInput.value = tx.id;
        tickerInput.value = tx.symbol;
        tickerInput.disabled = true;
        dateInput.value = formatDateToInput(tx.date);
        quantityInput.value = tx.quantity;
        precoMedioInput.value = tx.price;
        addButton.textContent = 'Salvar';
        
        showAddModal();
    }
    
    function handleExcluirTransacao(id, symbol) {
        const tx = transacoes.find(t => t.id === id);
        if (!tx) {
             showToast("Erro: Transação não encontrada.");
             return;
        }

        const msg = `Excluir esta compra?\n\nAtivo: ${tx.symbol}\nData: ${formatDate(tx.date)}\nQtd: ${tx.quantity}\nPreço: ${formatBRL(tx.price)}`;
        
        showModal(
            'Excluir Transação', 
            msg, 
            async () => { 
                await supabaseDB.deleteTransacao(id);
                transacoes = transacoes.filter(t => t.id !== id);
                
                await removerCacheAtivo(symbol);
                
                const outrasTransacoes = transacoes.some(t => t.symbol === symbol);

                saldoCaixa = 0;
                await salvarCaixa();
                mesesProcessados = [];
                await salvarHistoricoProcessado();

                if (!outrasTransacoes) {
                    await removerProventosConhecidos(symbol);
                    
                    const isFavorite = watchlist.some(item => item.symbol === symbol);
                    if (isFavorite) {
                        setTimeout(() => {
                             showModal(
                                'Manter na Watchlist?',
                                `${symbol} não está mais na sua carteira. Deseja mantê-lo na sua watchlist?`,
                                () => {} 
                            );
                        }, 300); 
                    }
                }
                
                await atualizarTodosDados(true); 
                showToast("Transação excluída.", 'success');
            }
        );
    }
    
    function limparDetalhes() {
        detalhesMensagem.classList.remove('hidden');
        detalhesLoading.classList.add('hidden');
        detalhesTituloTexto.textContent = 'Detalhes'; 
        detalhesNomeLongo.textContent = ''; 
        detalhesPreco.innerHTML = '';
        detalhesHistoricoContainer.classList.add('hidden');
        detalhesAiProvento.innerHTML = '';
        
        document.getElementById('detalhes-transacoes-container').classList.add('hidden');
        document.getElementById('detalhes-lista-transacoes').innerHTML = '';
        document.getElementById('detalhes-transacoes-vazio').classList.add('hidden');
        
        if (detalhesChartInstance) {
            detalhesChartInstance.destroy();
            detalhesChartInstance = null;
        }
        
        detalhesFavoritoIconEmpty.classList.remove('hidden');
        detalhesFavoritoIconFilled.classList.add('hidden');
        detalhesFavoritoBtn.dataset.symbol = '';
        
        currentDetalhesSymbol = null;
        currentDetalhesMeses = 3; 
        currentDetalhesHistoricoJSON = null; 
        
        periodoSelectorGroup.querySelectorAll('.periodo-selector-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.meses === '3'); 
        });
    }
    
    async function handleMostrarDetalhes(symbol) {
        detalhesMensagem.classList.add('hidden');
        detalhesLoading.classList.remove('hidden');
        detalhesPreco.innerHTML = '';
        detalhesAiProvento.innerHTML = ''; 
        detalhesHistoricoContainer.classList.add('hidden');
        detalhesTituloTexto.textContent = symbol;
        detalhesNomeLongo.textContent = 'A carregar...';
        
        currentDetalhesSymbol = symbol;
        currentDetalhesMeses = 3; 
        currentDetalhesHistoricoJSON = null; 
        
        periodoSelectorGroup.querySelectorAll('.periodo-selector-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.meses === '3'); 
        });
        
        const tickerParaApi = isFII(symbol) ? `${symbol}.SA` : symbol;
        const cacheKeyPreco = `detalhe_preco_${symbol}`;
        let precoData = await getCache(cacheKeyPreco);
        
        if (!precoData) {
            try {
                const data = await fetchBFF(`/api/brapi?path=/quote/${tickerParaApi}?range=1d&interval=1d`);
                precoData = data.results?.[0];
                
                const isAberto = isB3Open();
                const duracao = isAberto ? CACHE_PRECO_MERCADO_ABERTO : CACHE_PRECO_MERCADO_FECHADO;
                
                if (precoData && !precoData.error) await setCache(cacheKeyPreco, precoData, duracao); 
                else throw new Error(precoData?.error || 'Ativo não encontrado');
            } catch (e) { 
                precoData = null; 
                showToast("Erro ao buscar preço."); 
            }
        }

        let promessaAi = null;
        
        if (isFII(symbol)) {
            detalhesHistoricoContainer.classList.remove('hidden'); 
            promessaAi = fetchHistoricoIA(symbol); 
        }
        
        detalhesLoading.classList.add('hidden');

        if (precoData) {
            detalhesNomeLongo.textContent = precoData.longName || 'Nome não disponível';
            const variacaoCor = precoData.regularMarketChangePercent > 0 ? 'text-green-500' : (precoData.regularMarketChangePercent < 0 ? 'text-red-500' : 'text-gray-500');
            const ativoCarteira = carteiraCalculada.find(a => a.symbol === symbol);
            let plHtml = '';
            
            if (ativoCarteira) {
                const totalPosicao = precoData.regularMarketPrice * ativoCarteira.quantity;
                const custoTotal = ativoCarteira.precoMedio * ativoCarteira.quantity;
                const lucroPrejuizo = totalPosicao - custoTotal;
                const lucroPrejuizoPercent = (custoTotal === 0) ? 0 : (lucroPrejuizo / custoTotal) * 100;
                let corPL = 'text-gray-500';
                if (lucroPrejuizo > 0) corPL = 'text-green-500';
                else if (lucroPrejuizo < 0) corPL = 'text-red-500';
                
                plHtml = `
                    <div class="bg-gray-800 p-4 rounded-xl">
                        <span class="text-xs text-gray-500">Sua Posição</span>
                        <p class="text-lg font-semibold text-white">${formatBRL(totalPosicao)}</p>
                    </div>
                    <div class="bg-gray-800 p-4 rounded-xl">
                        <span class="text-xs text-gray-500">Seu L/P</span>
                        <p class="text-lg font-semibold ${corPL}">${formatBRL(lucroPrejuizo)} (${lucroPrejuizoPercent.toFixed(2)}%)</p>
                    </div>
                `;
            }

            detalhesPreco.innerHTML = `
                <div class="col-span-2 bg-gray-800 p-4 rounded-xl text-center mb-1">
                    <span class="text-sm text-gray-500">Preço Atual</span>
                    <div class="flex justify-center items-end gap-3">
                        <h2 class="text-4xl font-bold text-white">${formatBRL(precoData.regularMarketPrice)}</h2>
                        <span class="text-xl font-semibold ${variacaoCor}">${formatPercent(precoData.regularMarketChangePercent)}</span>
                    </div>
                </div>
                ${plHtml}
                <div class="col-span-2 grid grid-cols-3 gap-3">
                    <div class="bg-gray-800 p-3 rounded-xl text-center">
                        <span class="text-xs text-gray-500">Abertura</span>
                        <p class="text-base font-semibold text-white">${formatBRL(precoData.regularMarketOpen)}</p>
                    </div>
                    <div class="bg-gray-800 p-3 rounded-xl text-center">
                        <span class="text-xs text-gray-500">Máx. Dia</span>
                        <p class="text-base font-semibold text-green-500">${formatBRL(precoData.regularMarketDayHigh)}</p>
                    </div>
                    <div class="bg-gray-800 p-3 rounded-xl text-center">
                        <span class="text-xs text-gray-500">Mín. Dia</span>
                        <p class="text-base font-semibold text-red-500">${formatBRL(precoData.regularMarketDayLow)}</p>
                    </div>
                </div>
                <div class="bg-gray-800 p-4 rounded-xl">
                    <span class="text-xs text-gray-500">Máx. 52 Semanas</span>
                    <p class="text-lg font-semibold text-white">${formatBRL(precoData.fiftyTwoWeekHigh)}</p>
                </div>
                <div class="bg-gray-800 p-4 rounded-xl">
                    <span class="text-xs text-gray-500">Mín. 52 Semanas</span>
                    <p class="text-lg font-semibold text-white">${formatBRL(precoData.fiftyTwoWeekLow)}</p>
                </div>
                <div class="col-span-2 bg-gray-800 p-4 rounded-xl">
                    <span class="text-xs text-gray-500">Valor de Mercado</span>
                    <p class="text-lg font-semibold text-white">${formatNumber(precoData.marketCap)}</p>
                </div>
            `;
        } else {
            detalhesPreco.innerHTML = '<p class="text-center text-red-500 col-span-2">Erro ao buscar preço.</p>';
        }
        
        renderizarTransacoesDetalhes(symbol);
        
        atualizarIconeFavorito(symbol);
    }
    
    function renderizarTransacoesDetalhes(symbol) {
        const listaContainer = document.getElementById('detalhes-lista-transacoes');
        const vazioMsg = document.getElementById('detalhes-transacoes-vazio');
        const container = document.getElementById('detalhes-transacoes-container');
    
        listaContainer.innerHTML = '';
        
        const txsDoAtivo = transacoes
            .filter(t => t.symbol === symbol)
            .sort((a, b) => new Date(b.date) - new Date(a.date));
    
        if (txsDoAtivo.length === 0) {
            vazioMsg.classList.remove('hidden');
            listaContainer.classList.add('hidden');
        } else {
            vazioMsg.classList.add('hidden');
            listaContainer.classList.remove('hidden');
            
            const fragment = document.createDocumentFragment();

            txsDoAtivo.forEach(t => {
                const card = document.createElement('div');
                card.className = 'card-bg p-3 rounded-lg flex items-center justify-between'; 
                
                const cor = 'text-green-500';
                const sinal = '+';
                
                card.innerHTML = `
                    <div class="flex items-center gap-3">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 ${cor}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                            <p class="text-sm font-semibold text-white">Compra</p>
                            <p class="text-xs text-gray-400">${formatDate(t.date)}</p>
                        </div>
                    </div>
                    <div class="text-right">
                        <p class="text-sm font-semibold ${cor}">${sinal}${t.quantity} Cotas</p>
                        <p class="text-xs text-gray-400">${formatBRL(t.price)}</p>
                    </div>
                `;
                fragment.appendChild(card);
            });
            listaContainer.appendChild(fragment);
        }
        
        container.classList.remove('hidden');
    }
    
    async function fetchHistoricoIA(symbol) {
        detalhesAiProvento.innerHTML = `
            <div id="historico-periodo-loading" class="space-y-3 animate-shimmer-parent pt-2 h-48">
                <div class="h-4 bg-gray-700 rounded-md w-3/4"></div>
                <div class="h-4 bg-gray-700 rounded-md w-1/2"></div>
                <div class="h-4 bg-gray-700 rounded-md w-2/3"></div>
            </div>
        `;
        
        try {
            const cacheKey = `hist_ia_${symbol}_12`;
            let aiResultJSON = await getCache(cacheKey);

            if (!aiResultJSON) {
                aiResultJSON = await callGeminiHistoricoAPI(symbol, todayString); 
                
                if (aiResultJSON && Array.isArray(aiResultJSON)) {
                    await setCache(cacheKey, aiResultJSON, CACHE_IA_HISTORICO);
                } else {
                    aiResultJSON = [];
                }
            }

            currentDetalhesHistoricoJSON = aiResultJSON;
            
            renderHistoricoIADetalhes(3);

        } catch (e) {
            showToast("Erro na consulta IA."); 
            detalhesAiProvento.innerHTML = `
                <div class="border border-red-700 bg-red-900/50 p-4 rounded-lg flex items-center gap-3">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.876c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div>
                        <h5 class="font-semibold text-red-300">Erro na Consulta</h5>
                        <p class="text-sm text-red-400">${e.message}</p>
                    </div>
                </div>
            `;
        }
    }
    
    function renderHistoricoIADetalhes(meses) {
        if (!currentDetalhesHistoricoJSON) {
            return;
        }

        if (currentDetalhesHistoricoJSON.length === 0) {
            detalhesAiProvento.innerHTML = `
                <p class="text-sm text-gray-100 bg-gray-800 p-3 rounded-lg">
                    Não foi possível encontrar o histórico de proventos.
                </p>
            `;
            if (detalhesChartInstance) {
                detalhesChartInstance.destroy();
                detalhesChartInstance = null;
            }
            return;
        }

        if (!document.getElementById('detalhes-proventos-chart')) {
             detalhesAiProvento.innerHTML = `
                <div class="relative h-48 w-full">
                    <canvas id="detalhes-proventos-chart"></canvas>
                </div>
             `;
        }

        const dadosFiltrados = currentDetalhesHistoricoJSON.slice(0, meses).reverse();
        
        const labels = dadosFiltrados.map(item => item.mes);
        const data = dadosFiltrados.map(item => item.valor);

        renderizarGraficoProventosDetalhes({ labels, data });
    }
    
    function mudarAba(tabId) {
        tabContents.forEach(content => {
            content.classList.toggle('active', content.id === tabId);
        });
        tabButtons.forEach(button => {
            button.classList.toggle('active', button.dataset.tab === tabId);
        });
        
        showAddModalBtn.classList.toggle('hidden', tabId !== 'tab-carteira');
    }
    
    refreshButton.addEventListener('click', async () => {
        await atualizarTodosDados(true); 
    });
    
    refreshNoticiasButton.addEventListener('click', async () => {
        await handleAtualizarNoticias(true); 
    });
    
    showAddModalBtn.addEventListener('click', showAddModal);
    emptyStateAddBtn.addEventListener('click', showAddModal);
    addAtivoCancelBtn.addEventListener('click', hideAddModal);
    addAtivoModal.addEventListener('click', (e) => {
        if (e.target === addAtivoModal) { hideAddModal(); } 
    });
    
    addAtivoForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleSalvarTransacao();
    });
    
    listaCarteira.addEventListener('click', (e) => {
        const target = e.target.closest('button');
        if (!target) return;
        
        const action = target.dataset.action;
        const symbol = target.dataset.symbol;

        if (action === 'remove') {
            handleRemoverAtivo(symbol);
        } else if (action === 'details') {
            showDetalhesModal(symbol);
        } else if (action === 'toggle') {
            const drawer = document.getElementById(`drawer-${symbol}`);
            const icon = target.querySelector('.card-arrow-icon');
            drawer?.classList.toggle('open');
            icon?.classList.toggle('open');
        }
    });
    
    listaHistorico.addEventListener('click', (e) => {
        const target = e.target.closest('button');
        if (!target) return;

        const action = target.dataset.action;
        const id = target.dataset.id;
        const symbol = target.dataset.symbol;

        if (action === 'edit') {
            handleAbrirModalEdicao(id);
        } else if (action === 'delete') {
            handleExcluirTransacao(id, symbol);
        }
    });
    
    dashboardDrawers.addEventListener('click', (e) => {
        const target = e.target.closest('button');
        if (!target || !target.dataset.targetDrawer) return;
        
        const drawerId = target.dataset.targetDrawer;
        const drawer = document.getElementById(drawerId);
        const icon = target.querySelector('.card-arrow-icon');
        
        drawer?.classList.toggle('open');
        icon?.classList.toggle('open');
    });

    const watchlistToggleBtn = document.querySelector('[data-target-drawer="watchlist-drawer"]');
    if (watchlistToggleBtn) {
        watchlistToggleBtn.addEventListener('click', (e) => {
            const target = e.currentTarget; 
            const drawerId = target.dataset.targetDrawer;
            const drawer = document.getElementById(drawerId);
            const icon = target.querySelector('.card-arrow-icon');
            
            drawer?.classList.toggle('open');
            icon?.classList.toggle('open');
        });
    }

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            mudarAba(button.dataset.tab);
        });
    });
    
    customModalCancel.addEventListener('click', hideModal);
    customModalOk.addEventListener('click', () => {
        if (typeof onConfirmCallback === 'function') {
            onConfirmCallback(); 
        }
        hideModal(); 
    });
    customModal.addEventListener('click', (e) => {
        if (e.target === customModal) { hideModal(); } 
    });
    
    detalhesVoltarBtn.addEventListener('click', hideDetalhesModal);
    detalhesPageModal.addEventListener('click', (e) => {
        if (e.target === detalhesPageModal) { hideDetalhesModal(); } 
    });

    detalhesPageContent.addEventListener('touchstart', (e) => {
        if (detalhesConteudoScroll.scrollTop === 0) {
            touchStartY = e.touches[0].clientY;
            touchMoveY = touchStartY; 
            isDraggingDetalhes = true;
            detalhesPageContent.style.transition = 'none'; 
        }
    }, { passive: true }); 
    
    detalhesPageContent.addEventListener('touchmove', (e) => {
        if (!isDraggingDetalhes) return;
        touchMoveY = e.touches[0].clientY;
        const diff = touchMoveY - touchStartY;
        if (diff > 0) { 
            e.preventDefault(); 
            detalhesPageContent.style.transform = `translateY(${diff}px)`;
        }
    }, { passive: false }); 
    
    detalhesPageContent.addEventListener('touchend', (e) => {
        if (!isDraggingDetalhes) return;
        isDraggingDetalhes = false;
        const diff = touchMoveY - touchStartY;
        detalhesPageContent.style.transition = 'transform 0.4s ease-in-out';
        
        if (diff > 100) { 
            hideDetalhesModal(); 
        } else {
            detalhesPageContent.style.transform = ''; 
        }
        touchStartY = 0;
        touchMoveY = 0;
    });

    fiiNewsList.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button) return;
        const action = button.dataset.action;

        if (action === 'toggle-news') {
            const targetId = button.dataset.target;
            const drawer = document.getElementById(targetId);
            const icon = button.querySelector('.card-arrow-icon');
            drawer?.classList.toggle('open');
            icon?.classList.toggle('open');
        } else if (action === 'view-ticker') {
            const symbol = button.dataset.symbol;
            if (symbol) {
                showDetalhesModal(symbol);
            }
        }
    });
    
    detalhesFavoritoBtn.addEventListener('click', handleToggleFavorito);

    watchlistListaEl.addEventListener('click', (e) => {
        const target = e.target.closest('button');
        if (target && target.dataset.action === 'details' && target.dataset.symbol) {
            showDetalhesModal(target.dataset.symbol);
        }
    });
    
    periodoSelectorGroup.addEventListener('click', (e) => {
        const target = e.target.closest('.periodo-selector-btn');
        if (!target) return;

        const meses = parseInt(target.dataset.meses, 10);
        
        if (meses === currentDetalhesMeses) {
            return;
        }

        currentDetalhesMeses = meses;
        
        periodoSelectorGroup.querySelectorAll('.periodo-selector-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        target.classList.add('active');

        renderHistoricoIADetalhes(currentDetalhesMeses);
    });

    async function callGeminiHistoricoAPI(ticker, todayString) { 
        const body = { 
            mode: 'historico_12m', 
            payload: { ticker, todayString } 
        };
        const response = await fetchBFF('/api/gemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return response.json; 
    }
    
    async function callGeminiProventosCarteiraAPI(fiiList, todayString) {
        const body = { mode: 'proventos_carteira', payload: { fiiList, todayString } };
        const response = await fetchBFF('/api/gemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return response.json; 
    }
    
    async function callGeminiHistoricoPortfolioAPI(fiiList, todayString) {
         const body = { mode: 'historico_portfolio', payload: { fiiList, todayString } };
         const response = await fetchBFF('/api/gemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return response.json; 
    }

    function showAuthLoading(isLoading) {
        if (isLoading) {
            authLoading.classList.remove('hidden');
            loginForm.classList.add('hidden');
            signupForm.classList.add('hidden');
            recoverForm.classList.add('hidden'); 
        } else {
            authLoading.classList.add('hidden');
        }
    }
    
    function showLoginError(message) {
        loginError.textContent = message;
        loginError.classList.remove('hidden');
        loginSubmitBtn.innerHTML = 'Entrar';
        loginSubmitBtn.disabled = false;
    }

    function showSignupError(message) {
        signupError.textContent = message;
        signupError.classList.remove('hidden');
        signupSubmitBtn.innerHTML = 'Criar conta';
        signupSubmitBtn.disabled = false;

        signupSuccess.classList.add('hidden');
        signupEmailInput.classList.remove('hidden');
        signupPasswordInput.parentElement.classList.remove('hidden');
        signupConfirmPasswordInput.parentElement.classList.remove('hidden');
        signupSubmitBtn.classList.remove('hidden');
    }

    async function carregarDadosIniciais() {
        try {
            await carregarTransacoes();
            await carregarPatrimonio();
            await carregarCaixa();
            await carregarProventosConhecidos();
            await carregarHistoricoProcessado();
            await carregarWatchlist(); 
            
            renderizarWatchlist(); 
            
            atualizarTodosDados(false); 
            handleAtualizarNoticias(false); 
            
            setInterval(() => atualizarTodosDados(false), REFRESH_INTERVAL); 

        } catch (e) {
            console.error("Erro ao carregar dados iniciais:", e);
            showToast("Falha ao carregar dados da nuvem.");
        }
    }
    
    async function init() {
        try {
            await vestoDB.init();
        } catch (e) {
            console.error("[IDB Cache] Falha fatal ao inicializar o DB.", e);
            showToast("Erro crítico: Banco de dados local não pôde ser carregado."); 
            return; 
        }
        
        if (showRecoverBtn) {
            showRecoverBtn.addEventListener('click', () => {
                loginForm.classList.add('hidden');
                signupForm.classList.add('hidden');
                recoverForm.classList.remove('hidden');
                recoverError.classList.add('hidden');
                recoverMessage.classList.add('hidden');
            });
        }
        
        if (backToLoginBtn) {
            backToLoginBtn.addEventListener('click', () => {
                recoverForm.classList.add('hidden');
                loginForm.classList.remove('hidden');
            });
        }

        if (recoverForm) {
            recoverForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const email = recoverEmailInput.value;
                recoverError.classList.add('hidden');
                recoverMessage.classList.add('hidden');
                
                recoverSubmitBtn.innerHTML = '<span class="loader-sm"></span>';
                recoverSubmitBtn.disabled = true;

                const result = await supabaseDB.sendPasswordResetEmail(email);

                if (result === 'success') {
                    recoverMessage.classList.remove('hidden');
                    recoverForm.reset();
                } else {
                    recoverError.textContent = result;
                    recoverError.classList.remove('hidden');
                }
                
                recoverSubmitBtn.innerHTML = 'Enviar Link';
                recoverSubmitBtn.disabled = false;
            });
        }
        
        if (window.location.hash && window.location.hash.includes('type=recovery')) {
             console.log("Modo de recuperação de senha detectado via URL Hash");
             newPasswordModal.classList.add('visible');
             document.querySelector('#new-password-modal .modal-content').classList.remove('modal-out');
        }
        
        if (newPasswordForm) {
            newPasswordForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const newPass = newPasswordInput.value;

                if (newPass.length < 6) {
                    showToast("A senha deve ter no mínimo 6 caracteres.");
                    return;
                }

                newPasswordBtn.innerHTML = '<span class="loader-sm"></span>';
                newPasswordBtn.disabled = true;

                try {
                    await supabaseDB.updateUserPassword(newPass);
                    showToast("Senha atualizada com sucesso!", "success");
                    
                    setTimeout(() => {
                        newPasswordModal.classList.remove('visible');
                        window.location.href = "/"; 
                    }, 1500);

                } catch (error) {
                    showToast("Erro ao atualizar senha: " + error.message);
                    newPasswordBtn.innerHTML = 'Salvar Nova Senha';
                    newPasswordBtn.disabled = false;
                }
            });
        }

        showAuthLoading(true);

        let session;
        try {
            session = await supabaseDB.initialize();
        } catch (e) {
            console.error("Erro na inicialização:", e);
            showAuthLoading(false);
            showLoginError("Erro ao conectar com o servidor. Tente novamente.");
            return; 
        }
        
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            loginSubmitBtn.innerHTML = '<span class="loader-sm"></span>';
            loginSubmitBtn.disabled = true;
            loginError.classList.add('hidden');

            const email = loginEmailInput.value;
            const password = loginPasswordInput.value;
            const error = await supabaseDB.signIn(email, password);
            
            if (error) {
                showLoginError(error);
            } else {
                window.location.reload();
            }
        });

        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const email = signupEmailInput.value;
            const password = signupPasswordInput.value;
            const confirmPassword = signupConfirmPasswordInput.value;

            signupError.classList.add('hidden');
            signupSuccess.classList.add('hidden'); 
            
            if (password !== confirmPassword) {
                showSignupError("As senhas não coincidem.");
                return;
            }
            if (password.length < 6) {
                showSignupError("A senha deve ter no mínimo 6 caracteres.");
                return;
            }
            
            signupSubmitBtn.innerHTML = '<span class="loader-sm"></span>';
            signupSubmitBtn.disabled = true;

            const result = await supabaseDB.signUp(email, password);
            
            if (result === 'success') {
                signupEmailInput.classList.add('hidden');
                signupPasswordInput.parentElement.classList.add('hidden');
                signupConfirmPasswordInput.parentElement.classList.add('hidden');
                signupSubmitBtn.classList.add('hidden');
                
                signupSuccess.classList.remove('hidden');

                signupForm.reset();
                signupSubmitBtn.innerHTML = 'Criar conta';
                signupSubmitBtn.disabled = false;

            } else {
                showSignupError(result);
            }
        });

        showSignupBtn.addEventListener('click', () => {
            loginForm.classList.add('hidden');
            signupForm.classList.remove('hidden');
            recoverForm.classList.add('hidden'); 
            loginError.classList.add('hidden');
            
            signupError.classList.add('hidden'); 
            signupSuccess.classList.add('hidden'); 
            
            signupEmailInput.classList.remove('hidden');
            signupPasswordInput.parentElement.classList.remove('hidden');
            signupConfirmPasswordInput.parentElement.classList.remove('hidden');
            signupSubmitBtn.classList.remove('hidden');
        });

        showLoginBtn.addEventListener('click', () => {
            signupForm.classList.add('hidden');
            recoverForm.classList.add('hidden');
            loginForm.classList.remove('hidden');
            signupError.classList.add('hidden');
        });
        
        logoutBtn.addEventListener('click', () => {
            showModal("Sair?", "Tem certeza que deseja sair da sua conta?", async () => {
                
                try {
                    await vestoDB.clear('apiCache'); 
                    sessionStorage.clear(); 
                } catch (e) {
                    console.error("Erro ao limpar dados locais:", e);
                }
                
                sessionStorage.setItem('vesto_just_logged_out', 'true');
                await supabaseDB.signOut();
                window.location.reload();
            });
        });

        passwordToggleButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetId = button.dataset.target;
                const targetInput = document.getElementById(targetId);
                if (!targetInput) return;

                const eyeOpen = button.querySelector('.eye-icon-open');
                const eyeClosed = button.querySelector('.eye-icon-closed');

                if (targetInput.type === 'password') {
                    targetInput.type = 'text';
                    eyeOpen.classList.add('hidden');
                    eyeClosed.classList.remove('hidden');
                } else {
                    targetInput.type = 'password';
                    eyeOpen.classList.remove('hidden');
                    eyeClosed.classList.add('hidden');
                }
            });
        });

        if (session) {
            currentUserId = session.user.id;
            authContainer.classList.add('hidden');    
            appWrapper.classList.remove('hidden'); 
            
            await verificarStatusBiometria();
            
            mudarAba('tab-dashboard'); 
            await carregarDadosIniciais();
        } else {
            appWrapper.classList.add('hidden');      
            authContainer.classList.remove('hidden'); 
            
            if (recoverForm.classList.contains('hidden') && signupForm.classList.contains('hidden')) {
                loginForm.classList.remove('hidden');
            }
            showAuthLoading(false);                 
        }
    }
    
    await init();
});
