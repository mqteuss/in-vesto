import * as supabaseDB from './supabase.js';

// --- LÓGICA DE INSTALAÇÃO PWA ---
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log('Instalação disponível');
});
// ---------------------------------------

// Configuração Inicial de Gráficos (Será sobrescrita pela função de tema)
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
        if (dateString.length === 10) {
            date.setMinutes(date.getMinutes() + date.getTimezoneOffset());
        }
        
        const options = { day: '2-digit', month: '2-digit', year: 'numeric' };
        if (includeTime) {
            options.hour = '2-digit';
            options.minute = '2-digit';
        }
        return date.toLocaleDateString('pt-BR', options);
    } catch (e) { return dateString; }
};

const formatDateToInput = (dateString) => {
    try {
        const date = new Date(dateString);
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
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

// --- CONSTANTES DE CONFIGURAÇÃO ---
const REFRESH_INTERVAL = 300000; 
const CACHE_PRECO_MERCADO_ABERTO = 1000 * 60 * 5; 
const CACHE_PRECO_MERCADO_FECHADO = 1000 * 60 * 60 * 12; 
const CACHE_NOTICIAS = 1000 * 60 * 15; 
const CACHE_IA_HISTORICO = 1000 * 60 * 60 * 24; 
const CACHE_PROVENTOS = 1000 * 60 * 60 * 12; 

const DB_NAME = 'vestoCacheDB';
const DB_VERSION = 1; 

function criarCardElemento(ativo, dados) {
    const {
        dadoPreco, precoFormatado, variacaoFormatada, corVariacao,
        totalPosicao, custoTotal, lucroPrejuizo, lucroPrejuizoPercent,
        corPL, bgPL, dadoProvento, proventoReceber
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
            const parts = dadoProvento.paymentDate.split('-');
            const dataPag = new Date(parts[0], parts[1] - 1, parts[2]);
            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);
            
            const foiPago = dataPag <= hoje;
            const labelTexto = foiPago ? "Último Pag." : "Sua Previsão";
            const valorClass = foiPago ? "text-gray-400" : "accent-text";
            const sinal = foiPago ? "" : "+";

            let valorTexto = '';
            if (proventoReceber > 0) {
                 valorTexto = `<span class="text-sm font-semibold ${valorClass}">${sinal}${formatBRL(proventoReceber)}</span>`;
            } else {
                 valorTexto = `<span class="text-[10px] font-medium text-orange-400 bg-orange-900/30 px-1.5 py-0.5 rounded-full">Sem direito</span>`;
            }
            
            const dataComTexto = dadoProvento.dataCom ? formatDate(dadoProvento.dataCom) : 'N/A';

            proventoHtml = `
            <div class="mt-2 space-y-1.5 border-t border-gray-800 pt-2">
                <div class="flex justify-between items-center">
                    <span class="text-xs text-gray-500 font-medium">Valor p/ Cota</span>
                    <span class="text-sm font-medium text-gray-400">${formatBRL(dadoProvento.value)}</span>
                </div>
                <div class="flex justify-between items-center">
                    <span class="text-xs text-gray-500 font-medium">${labelTexto}</span>
                    ${valorTexto}
                </div>
                <div class="flex justify-between items-center"> 
                    <span class="text-xs text-gray-500 font-medium" title="Data limite para compra">Data Com: ${dataComTexto}</span>
                    <span class="text-xs text-gray-400">Pag: ${formatDate(dadoProvento.paymentDate)}</span>
                </div>
            </div>`;
        } else {
            proventoHtml = `
            <div class="flex justify-between items-center mt-2 pt-2 border-t border-gray-800">
                <span class="text-xs text-gray-500 font-medium">Provento</span>
                <span class="text-sm font-medium text-gray-400">Aguardando anúncio.</span>
            </div>`;
        }
    }

    const card = document.createElement('div');
    card.className = 'card-bg p-4 rounded-3xl card-animate-in';
    card.setAttribute('data-symbol', ativo.symbol); 

    card.innerHTML = `
        <div class="flex justify-between items-start">
            <div class="flex items-center gap-3">
                <div class="w-12 h-12 rounded-full bg-[#1C1C1E] border border-gray-700 flex items-center justify-center flex-shrink-0 overflow-hidden shadow-sm">
                    <span class="text-xs font-bold text-purple-400 tracking-tight leading-none">${ativo.symbol}</span>
                </div>
                <div>
                    <h2 class="text-lg font-bold text-white leading-tight">${ativo.symbol}</h2>
                    <p class="text-xs text-gray-500" data-field="cota-qtd">${ativo.quantity} cota(s)</p>
                    <div class="mt-1" data-field="pl-tag">${plTagHtml}</div>
                </div>
            </div>
            <div class="text-right flex-shrink-0 ml-2">
                <span data-field="variacao-valor" class="${corVariacao} font-semibold text-base block">${dadoPreco ? variacaoFormatada : '...'}</span>
                <p data-field="preco-valor" class="text-gray-200 text-base font-medium money-value">${precoFormatado}</p>
            </div>
        </div>
        <div class="flex justify-center mt-1 pt-1">
            <button class="p-1 text-gray-600 hover:text-white transition-colors rounded-full hover:bg-gray-800" data-symbol="${ativo.symbol}" data-action="toggle" title="Mostrar mais">
                <svg class="card-arrow-icon w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
            </button>
        </div>
        <div id="drawer-${ativo.symbol}" class="card-drawer">
            <div class="drawer-content space-y-2 pt-1">
                <div class="flex justify-between items-center">
                    <span class="text-xs text-gray-500 font-medium">Posição</span>
                    <span data-field="posicao-valor" class="text-sm font-semibold text-white">${dadoPreco ? formatBRL(totalPosicao) : 'A calcular...'}</span>
                </div>
                <div class="flex justify-between items-center">
                    <span data-field="pm-label" class="text-xs text-gray-500 font-medium">Custo (P.M. ${formatBRL(ativo.precoMedio)})</span>
                    <span data-field="custo-valor" class="text-sm font-semibold text-white">${formatBRL(custoTotal)}</span>
                </div>
                <div class="flex justify-between items-center">
                    <span class="text-xs text-gray-500 font-medium">L/P</span>
                    <span data-field="pl-valor" class="text-sm font-semibold ${corPL}">${dadoPreco ? `${formatBRL(lucroPrejuizo)} (${lucroPrejuizoPercent.toFixed(2)}%)` : 'A calcular...'}</span>
                </div>
                <div data-field="provento-container">${proventoHtml}</div> 
                <div class="flex justify-end gap-3 pt-2">
                    <button class="py-1 px-3 text-xs font-medium text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-full transition-colors" data-symbol="${ativo.symbol}" data-action="details">
                        Detalhes
                    </button>
                    <button class="py-1 px-3 text-xs font-medium text-red-400 bg-red-900/50 hover:bg-red-900/80 rounded-full transition-colors" data-symbol="${ativo.symbol}" data-action="remove">
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
        corPL, bgPL, dadoProvento, proventoReceber
    } = dados;

    card.querySelector('[data-field="cota-qtd"]').textContent = `${ativo.quantity} cota(s)`;
    card.querySelector('[data-field="preco-valor"]').textContent = precoFormatado;
    card.querySelector('[data-field="posicao-valor"]').textContent = dadoPreco ? formatBRL(totalPosicao) : 'A calcular...';
    card.querySelector('[data-field="pm-label"]').textContent = `Custo (P.M. ${formatBRL(ativo.precoMedio)})`;
    card.querySelector('[data-field="custo-valor"]').textContent = formatBRL(custoTotal);

    const variacaoEl = card.querySelector('[data-field="variacao-valor"]');
    variacaoEl.textContent = dadoPreco ? variacaoFormatada : '...';
    variacaoEl.className = `${corVariacao} font-semibold text-base block`; 

    const plValorEl = card.querySelector('[data-field="pl-valor"]');
    plValorEl.textContent = dadoPreco ? `${formatBRL(lucroPrejuizo)} (${lucroPrejuizoPercent.toFixed(2)}%)` : 'A calcular...';
    plValorEl.className = `text-sm font-semibold ${corPL}`; 

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
            const parts = dadoProvento.paymentDate.split('-');
            const dataPag = new Date(parts[0], parts[1] - 1, parts[2]);
            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);
            
            const foiPago = dataPag <= hoje;
            const labelTexto = foiPago ? "Último Pag." : "Sua Previsão";
            const valorClass = foiPago ? "text-gray-400" : "accent-text";
            const sinal = foiPago ? "" : "+";

            let valorTexto = '';
            if (proventoReceber > 0) {
                 valorTexto = `<span class="text-sm font-semibold ${valorClass}">${sinal}${formatBRL(proventoReceber)}</span>`;
            } else {
                 valorTexto = `<span class="text-[10px] font-medium text-orange-400 bg-orange-900/30 px-1.5 py-0.5 rounded-full">Sem direito</span>`;
            }

            const dataComTexto = dadoProvento.dataCom ? formatDate(dadoProvento.dataCom) : 'N/A';
            
            proventoHtml = `
            <div class="mt-2 space-y-1.5 border-t border-gray-800 pt-2">
                <div class="flex justify-between items-center">
                    <span class="text-xs text-gray-500 font-medium">Valor p/ Cota</span>
                    <span class="text-sm font-medium text-gray-400">${formatBRL(dadoProvento.value)}</span>
                </div>
                <div class="flex justify-between items-center">
                    <span class="text-xs text-gray-500 font-medium">${labelTexto}</span>
                    ${valorTexto}
                </div>
                <div class="flex justify-between items-center"> 
                    <span class="text-xs text-gray-500 font-medium" title="Data limite para compra">Data Com: ${dataComTexto}</span>
                    <span class="text-xs text-gray-400">Pag: ${formatDate(dadoProvento.paymentDate)}</span>
                </div>
            </div>`;
        } else {
            proventoHtml = `
            <div class="flex justify-between items-center mt-2 pt-2 border-t border-gray-800">
                <span class="text-xs text-gray-500 font-medium">Provento</span>
                <span class="text-sm font-medium text-gray-400">Aguardando anúncio.</span>
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
    
    // --- SELETORES DO DOM ---
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

    const changePasswordModal = document.getElementById('change-password-modal');
    const changePasswordForm = document.getElementById('change-password-form');
    const currentPasswordInput = document.getElementById('current-password-input');
    const changeNewPasswordInput = document.getElementById('change-new-password-input');
    const changeConfirmPasswordInput = document.getElementById('change-confirm-password-input');
    const changePasswordSubmitBtn = document.getElementById('change-password-submit-btn');
    const openChangePasswordBtn = document.getElementById('open-change-password-btn');
    const closeChangePasswordBtn = document.getElementById('close-change-password-btn');
    
    // Configs - Biometria
    const toggleBioBtn = document.getElementById('toggle-bio-btn');
    const bioToggleKnob = document.getElementById('bio-toggle-knob'); 
    const bioStatusIcon = document.getElementById('bio-status-icon');
    
    // Configs - Tema (NOVO)
    const toggleThemeBtn = document.getElementById('toggle-theme-btn');
    const themeToggleKnob = document.getElementById('theme-toggle-knob');

    // Configs - Privacidade (NOVO)
    const togglePrivacyBtn = document.getElementById('toggle-privacy-btn');
    const privacyToggleKnob = document.getElementById('privacy-toggle-knob');
    const exportCsvBtn = document.getElementById('export-csv-btn');
    const clearCacheBtn = document.getElementById('clear-cache-btn');

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
    const carteiraSearchInput = document.getElementById('carteira-search-input');
    
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
    
    const btnIaAnalise = document.getElementById('btn-ia-analise');
    const aiModal = document.getElementById('ai-modal');
    const closeAiModal = document.getElementById('close-ai-modal');
    const aiContent = document.getElementById('ai-content');
    const aiLoading = document.getElementById('ai-loading');

    const installSection = document.getElementById('install-section');
    const installBtn = document.getElementById('install-app-btn');

    // --- LÓGICA DE INSTALAÇÃO DO PWA ---
    function verificarStatusInstalacao() {
        if (deferredPrompt) {
            installSection.classList.remove('hidden');
        }
    }
    
    verificarStatusInstalacao();

    window.addEventListener('beforeinstallprompt', () => {
        verificarStatusInstalacao();
    });

    window.addEventListener('appinstalled', () => {
        installSection.classList.add('hidden');
        deferredPrompt = null;
        showToast('App instalado com sucesso!', 'success');
    });

    if (installBtn) {
        installBtn.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log(`User response to the install prompt: ${outcome}`);
            deferredPrompt = null;
            if (outcome === 'accepted') {
                installSection.classList.add('hidden');
            }
        });
    }

    // --- LÓGICA DE TEMA (CLARO / ESCURO) ---
    function updateThemeUI() {
        const isLight = localStorage.getItem('vesto_theme') === 'light';
        const metaTheme = document.querySelector('meta[name="theme-color"]');
        
        if (isLight) {
            document.body.classList.add('light-mode');
            if (toggleThemeBtn && themeToggleKnob) {
                toggleThemeBtn.classList.remove('bg-gray-700');
                toggleThemeBtn.classList.add('bg-purple-600');
                themeToggleKnob.classList.remove('translate-x-1');
                themeToggleKnob.classList.add('translate-x-6');
            }
            if (metaTheme) metaTheme.setAttribute('content', '#f9fafb');
            
            // Atualiza cores padrão do Chart.js para Tema Claro
            Chart.defaults.color = '#374151'; 
            Chart.defaults.borderColor = '#e5e7eb';
        } else {
            document.body.classList.remove('light-mode');
            if (toggleThemeBtn && themeToggleKnob) {
                toggleThemeBtn.classList.remove('bg-purple-600');
                toggleThemeBtn.classList.add('bg-gray-700');
                themeToggleKnob.classList.remove('translate-x-6');
                themeToggleKnob.classList.add('translate-x-1');
            }
            if (metaTheme) metaTheme.setAttribute('content', '#000000');
            
            // Atualiza cores padrão do Chart.js para Tema Escuro
            Chart.defaults.color = '#9ca3af'; 
            Chart.defaults.borderColor = '#374151';
        }
    }

    // Inicializa o tema imediatamente
    updateThemeUI();

    if (toggleThemeBtn) {
        toggleThemeBtn.addEventListener('click', () => {
            const current = localStorage.getItem('vesto_theme') === 'light';
            localStorage.setItem('vesto_theme', current ? 'dark' : 'light');
            updateThemeUI();
            
            // Força atualização dos gráficos se existirem
            // (As variáveis são globais no escopo do DOMContentLoaded, definidas na Parte 2)
            if (typeof alocacaoChartInstance !== 'undefined' && alocacaoChartInstance) alocacaoChartInstance.update();
            if (typeof patrimonioChartInstance !== 'undefined' && patrimonioChartInstance) patrimonioChartInstance.update();
            if (typeof historicoChartInstance !== 'undefined' && historicoChartInstance) historicoChartInstance.update();
            if (typeof detalhesChartInstance !== 'undefined' && detalhesChartInstance) detalhesChartInstance.update();
        });
    }

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
        
        if (toggleBioBtn && bioToggleKnob) {
             if (bioEnabled) {
                 toggleBioBtn.classList.remove('bg-gray-700');
                 toggleBioBtn.classList.add('bg-purple-600');
                 bioToggleKnob.classList.remove('translate-x-1');
                 bioToggleKnob.classList.add('translate-x-6');
             } else {
                 toggleBioBtn.classList.remove('bg-purple-600');
                 toggleBioBtn.classList.add('bg-gray-700');
                 bioToggleKnob.classList.remove('translate-x-6');
                 bioToggleKnob.classList.add('translate-x-1');
             }
        }

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
	// --- FUNÇÃO: HANDLER DE IA ---
    async function handleAnaliseIA() {
        if (!carteiraCalculada || carteiraCalculada.length === 0) {
            showToast("Adicione ativos antes de pedir uma análise.");
            return;
        }

        // 1. Abre o Modal e mostra Loading
        aiModal.classList.add('visible');
        aiModal.querySelector('.modal-content').classList.remove('modal-out');
        aiContent.classList.add('hidden');
        aiLoading.classList.remove('hidden');

        // 2. Prepara os dados (Payload)
        const precosMap = new Map(precosAtuais.map(p => [p.symbol, p]));
        let valorTotalAtivos = 0;
        
        const carteiraParaEnvio = carteiraCalculada.map(ativo => {
            const dadosPreco = precosMap.get(ativo.symbol);
            const precoAtual = dadosPreco ? dadosPreco.regularMarketPrice : ativo.precoMedio;
            const total = precoAtual * ativo.quantity;
            valorTotalAtivos += total;

            return {
                ticker: ativo.symbol,
                qtd: ativo.quantity,
                pm: ativo.precoMedio,
                atual: precoAtual,
                total: total,
                tipo: isFII(ativo.symbol) ? 'FII' : 'Ação'
            };
        });

        const totalPatrimonio = valorTotalAtivos + saldoCaixa;

        try {
            // 3. Chama a API Serverless
            const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    carteira: carteiraParaEnvio,
                    totalPatrimonio: formatBRL(totalPatrimonio),
                    perfil: "Investidor focado em dividendos e longo prazo"
                })
            });

            if (!response.ok) throw new Error('Falha na comunicação com a IA');

            const data = await response.json();
            
            // 4. Renderiza o Markdown
            if (data.result && window.marked) {
                aiContent.innerHTML = marked.parse(data.result);
            } else {
                aiContent.textContent = data.result || "Sem resposta.";
            }

            aiLoading.classList.add('hidden');
            aiContent.classList.remove('hidden');

        } catch (error) {
            console.error("Erro IA:", error);
            aiLoading.classList.add('hidden');
            aiContent.classList.remove('hidden');
            aiContent.innerHTML = `<p class="text-red-400 text-center">Ocorreu um erro ao analisar sua carteira.<br><span class="text-xs text-gray-500">${error.message}</span></p>`;
        }
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
        if (!watchlistListaEl) return;
        watchlistListaEl.innerHTML = ''; 

        if (watchlist.length === 0) {
            if(watchlistStatusEl) watchlistStatusEl.classList.remove('hidden');
            return;
        }
        
        if(watchlistStatusEl) watchlistStatusEl.classList.add('hidden');
        
        watchlist.sort((a, b) => a.symbol.localeCompare(b.symbol));

        const fragment = document.createDocumentFragment();
        watchlist.forEach(item => {
            const symbol = item.symbol;
            const el = document.createElement('div');
            el.className = 'flex justify-between items-center p-3 bg-black rounded-2xl border border-[#2C2C2E] hover:border-purple-500/50 transition-colors';
            el.innerHTML = `
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full bg-[#1C1C1E] flex items-center justify-center text-[10px] font-bold text-purple-400">
                        ${symbol.substring(0, 4)}
                    </div>
                    <span class="font-semibold text-white">${symbol}</span>
                </div>
                <button class="py-1 px-3 text-xs font-medium text-purple-300 bg-purple-900/50 hover:bg-purple-900/80 rounded-full transition-colors" data-symbol="${symbol}" data-action="details">
                    Ver
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
        let novoSaldoCalculado = 0; 
        let proventosParaMarcarComoProcessado = [];

        for (const provento of proventosConhecidos) {
            if (provento.paymentDate && provento.value > 0) {
                const parts = provento.paymentDate.split('-');
                const dataPagamento = new Date(parts[0], parts[1] - 1, parts[2]);

                if (!isNaN(dataPagamento) && dataPagamento <= hoje) {
                    const dataReferencia = provento.dataCom || provento.paymentDate;
                    const qtdElegivel = getQuantidadeNaData(provento.symbol, dataReferencia);

                    if (qtdElegivel > 0) {
                        const valorRecebido = provento.value * qtdElegivel;
                        novoSaldoCalculado += valorRecebido;
                    }
                    
                    if (!provento.processado) {
                        provento.processado = true;
                        proventosParaMarcarComoProcessado.push(provento);
                    }
                }
            }
        }
        saldoCaixa = novoSaldoCalculado;
        await salvarCaixa();
        
        if (totalCaixaValor) totalCaixaValor.textContent = formatBRL(saldoCaixa);
        
        if (proventosParaMarcarComoProcessado.length > 0) {
            for (const provento of proventosParaMarcarComoProcessado) {
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
            card.className = 'card-bg p-4 rounded-3xl flex items-center justify-between';
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
                        <p class="text-xs text-gray-400">${formatBRL(t.price)}</p>
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
            fiiNewsMensagem.textContent = 'Nenhuma notícia recente encontrada nos últimos 30 dias.';
            fiiNewsMensagem.classList.remove('hidden');
            return;
        }
        
        articles.sort((a, b) => new Date(b.publicationDate) - new Date(a.publicationDate));
        
        const fragment = document.createDocumentFragment();

        articles.forEach((article, index) => {
            const sourceName = article.sourceName || 'Fonte';
            const faviconUrl = article.favicon || `https://www.google.com/s2/favicons?domain=${article.sourceHostname || 'google.com'}&sz=64`;
            const publicationDate = article.publicationDate ? formatDate(article.publicationDate, true) : 'Data indisponível';
            const drawerId = `news-drawer-${index}`;
            
            const tickerRegex = /[A-Z]{4}11/g;
            const foundTickers = [...new Set(article.title.match(tickerRegex) || [])];
            
            let tickersHtml = '';
            if (foundTickers.length > 0) {
                foundTickers.forEach(ticker => {
                    tickersHtml += `<span class="news-ticker-tag" data-action="view-ticker" data-symbol="${ticker}">${ticker}</span>`;
                });
            }

            const drawerContentHtml = `
                <div class="text-sm text-gray-300 leading-relaxed mb-4 border-l-2 border-purple-500 pl-3">
                    ${article.summary ? article.summary : 'Resumo não disponível.'}
                </div>
                <div class="flex justify-between items-end pt-2 border-t border-gray-800">
                    <div class="flex flex-wrap gap-2">
                        ${tickersHtml}
                    </div>
                    <a href="${article.link}" target="_blank" rel="noopener noreferrer" class="text-xs font-bold text-purple-400 hover:text-purple-300 hover:underline transition-colors flex-shrink-0">
                        Ler notícia completa
                    </a>
                </div>
            `;

            const newsCard = document.createElement('div');
            newsCard.className = 'card-bg rounded-3xl p-4 space-y-3 news-card-interactive'; 
            newsCard.setAttribute('data-action', 'toggle-news');
            newsCard.setAttribute('data-target', drawerId);

            newsCard.innerHTML = `
                <div class="flex items-start gap-3 pointer-events-none">
                    <img src="${faviconUrl}" alt="${sourceName}" 
                         class="w-9 h-9 rounded-2xl bg-[#1C1C1E] object-contain p-0.5 shadow-sm border border-gray-700 pointer-events-auto"
                         loading="lazy"
                         onerror="this.src='https://www.google.com/s2/favicons?domain=google.com&sz=64';" 
                    />
                    <div class="flex-1 min-w-0">
                        <h4 class="font-semibold text-white line-clamp-2 text-sm md:text-base leading-tight">${article.title || 'Título indisponível'}</h4>
                        <div class="flex items-center gap-2 mt-1.5">
                            <span class="text-xs text-gray-400 font-medium">${sourceName}</span>
                            <span class="text-[10px] text-gray-600">•</span>
                            <span class="text-xs text-gray-500">${publicationDate}</span>
                        </div>
                    </div>
                    <div class="flex-shrink-0 -mr-2 -mt-2">
                        <svg class="card-arrow-icon w-5 h-5 text-gray-500 transition-transform duration-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                        </svg>
                    </div>
                </div>
                
                <div id="${drawerId}" class="card-drawer pointer-events-auto">
                    <div class="drawer-content pt-3 mt-2">
                        ${drawerContentHtml}
                    </div>
                </div>
            `;
            fragment.appendChild(newsCard);
        });
        fiiNewsList.appendChild(fragment);
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
                data: { 
                    labels: labels, 
                    datasets: [{ 
                        data: data, 
                        backgroundColor: colors, 
                        borderWidth: 2, 
                        borderColor: Chart.defaults.borderColor 
                    }] 
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { display: true, position: 'bottom', labels: { color: Chart.defaults.color, boxWidth: 12, padding: 15, } },
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
                                color: Chart.defaults.color,
                                font: { size: 10 },
                                callback: function(value) {
                                    return formatBRL(value);
                                }
                            }
                        },
                        x: { 
                            grid: { display: false },
                            ticks: {
                                color: Chart.defaults.color,
                                font: { size: 10 }
                            }
                        }
                    }
                }
            });
        }
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
	// --- FUNÇÕES DE RENDERIZAÇÃO E LÓGICA ---

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
    
    function getQuantidadeNaData(symbol, dataLimiteStr) {
        if (!dataLimiteStr) return 0;
        const dataLimite = new Date(dataLimiteStr + 'T23:59:59');
        return transacoes.reduce((total, t) => {
            if (t.symbol === symbol && t.type === 'buy') {
                const dataTransacao = new Date(t.date);
                if (dataTransacao <= dataLimite) return total + t.quantity;
            }
            return total;
        }, 0);
    }

    async function renderizarCarteira() {
        renderizarCarteiraSkeletons(false);
        const precosMap = new Map(precosAtuais.map(p => [p.symbol, p]));
        const proventosOrdenados = [...proventosAtuais].sort((a, b) => new Date(a.paymentDate) - new Date(b.paymentDate));
        const proventosMap = new Map(proventosOrdenados.map(p => [p.symbol, p]));
        const carteiraOrdenada = [...carteiraCalculada].sort((a, b) => a.symbol.localeCompare(b.symbol));
        let totalValorCarteira = 0; let totalCustoCarteira = 0; let dadosGrafico = [];

        if (carteiraOrdenada.length === 0) {
            listaCarteira.innerHTML = ''; carteiraStatus.classList.remove('hidden');
            renderizarDashboardSkeletons(false);
            totalCarteiraValor.textContent = formatBRL(0);
            totalCaixaValor.textContent = formatBRL(saldoCaixa);
            totalCarteiraCusto.textContent = formatBRL(0);
            totalCarteiraPL.textContent = `${formatBRL(0)} (---%)`;
            totalCarteiraPL.className = `text-lg font-semibold text-gray-500`;
            dashboardMensagem.textContent = 'A sua carteira está vazia.';
            dashboardLoading.classList.add('hidden'); dashboardStatus.classList.remove('hidden');
            renderizarGraficoAlocacao([]); renderizarGraficoHistorico({ labels: [], data: [] });
            await salvarSnapshotPatrimonio(saldoCaixa); renderizarGraficoPatrimonio();
            return; 
        } else {
            carteiraStatus.classList.add('hidden'); dashboardStatus.classList.add('hidden');
        }

        const symbolsNaCarteira = new Set(carteiraOrdenada.map(a => a.symbol));
        const cardsNaTela = listaCarteira.querySelectorAll('[data-symbol]');
        cardsNaTela.forEach(card => { if (!symbolsNaCarteira.has(card.dataset.symbol)) card.remove(); });

        carteiraOrdenada.forEach(ativo => {
            const dadoPreco = precosMap.get(ativo.symbol);
            const dadoProvento = proventosMap.get(ativo.symbol);
            let precoAtual = 0, variacao = 0, precoFormatado = 'N/A', variacaoFormatada = '0.00%', corVariacao = 'text-gray-500';
            if (dadoPreco) {
                precoAtual = dadoPreco.regularMarketPrice ?? 0; variacao = dadoPreco.regularMarketChangePercent ?? 0;
                precoFormatado = formatBRL(precoAtual); variacaoFormatada = formatPercent(variacao);
                corVariacao = variacao > 0 ? 'text-green-500' : (variacao < 0 ? 'text-red-500' : 'text-gray-500');
            } else { precoFormatado = '...'; corVariacao = 'text-yellow-500'; }
            
            const totalPosicao = precoAtual * ativo.quantity; const custoTotal = ativo.precoMedio * ativo.quantity;
            const lucroPrejuizo = totalPosicao - custoTotal;
            const lucroPrejuizoPercent = (custoTotal === 0 || totalPosicao === 0) ? 0 : (lucroPrejuizo / custoTotal) * 100;
            let corPL = 'text-gray-500', bgPL = 'bg-gray-800';
            if (lucroPrejuizo > 0.01) { corPL = 'text-green-500'; bgPL = 'bg-green-900/50'; }
            else if (lucroPrejuizo < -0.01) { corPL = 'text-red-500'; bgPL = 'bg-red-900/50'; }

            let proventoReceber = 0;
            if (dadoProvento && dadoProvento.value > 0) {
                 const dataReferencia = dadoProvento.dataCom || dadoProvento.paymentDate;
                 const qtdElegivel = getQuantidadeNaData(ativo.symbol, dataReferencia);
                 proventoReceber = qtdElegivel * dadoProvento.value;
            }
            const dadosRender = { dadoPreco, precoFormatado, variacaoFormatada, corVariacao, totalPosicao, custoTotal, lucroPrejuizo, lucroPrejuizoPercent, corPL, bgPL, dadoProvento, proventoReceber };
            totalValorCarteira += totalPosicao; totalCustoCarteira += custoTotal;
            if (totalPosicao > 0) dadosGrafico.push({ symbol: ativo.symbol, totalPosicao: totalPosicao });
            let card = listaCarteira.querySelector(`[data-symbol="${ativo.symbol}"]`);
            if (card) atualizarCardElemento(card, ativo, dadosRender); else { card = criarCardElemento(ativo, dadosRender); listaCarteira.appendChild(card); }
        });

        if (carteiraOrdenada.length > 0) {
            const patrimonioTotalAtivos = totalValorCarteira; const totalLucroPrejuizo = totalValorCarteira - totalCustoCarteira;
            const totalLucroPrejuizoPercent = (totalCustoCarteira === 0) ? 0 : (totalLucroPrejuizo / totalCustoCarteira) * 100;
            let corPLTotal = 'text-gray-500';
            if (totalLucroPrejuizo > 0.01) corPLTotal = 'text-green-500'; else if (totalLucroPrejuizo < -0.01) corPLTotal = 'text-red-500';
            renderizarDashboardSkeletons(false);
            totalCarteiraValor.textContent = formatBRL(patrimonioTotalAtivos); totalCaixaValor.textContent = formatBRL(saldoCaixa);
            totalCarteiraCusto.textContent = formatBRL(totalCustoCarteira);
            totalCarteiraPL.textContent = `${formatBRL(totalLucroPrejuizo)} (${totalLucroPrejuizoPercent.toFixed(2)}%)`;
            totalCarteiraPL.className = `text-lg font-semibold ${corPLTotal}`;
            await salvarSnapshotPatrimonio(patrimonioTotalAtivos + saldoCaixa);
        }
        renderizarGraficoAlocacao(dadosGrafico); renderizarGraficoPatrimonio();
    }

    function renderizarProventos() {
        let totalEstimado = 0; const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
        proventosAtuais.forEach(provento => {
            if (provento && typeof provento.value === 'number' && provento.value > 0) {
                 const parts = provento.paymentDate.split('-'); const dataPagamento = new Date(parts[0], parts[1] - 1, parts[2]);
                 if (dataPagamento > hoje) {
                     const qtdElegivel = getQuantidadeNaData(provento.symbol, provento.dataCom || provento.paymentDate);
                     if (qtdElegivel > 0) totalEstimado += (qtdElegivel * provento.value);
                 }
            }
        });
        totalProventosEl.textContent = formatBRL(totalEstimado);
    }
    
    // --- FUNÇÕES DE FETCH ---
    async function handleAtualizarNoticias(force = false) {
        const cacheKey = 'noticias_json_v5_filtered';
        if (!force) { const cache = await getCache(cacheKey); if (cache) { renderizarNoticias(cache); return; } }
        fiiNewsSkeleton.classList.remove('hidden'); fiiNewsList.innerHTML = ''; fiiNewsMensagem.classList.add('hidden');
        const refreshIcon = refreshNoticiasButton.querySelector('svg'); if (force) refreshIcon.classList.add('spin-animation');
        try { const articles = await fetchAndCacheNoticiasBFF_NetworkOnly(cacheKey); renderizarNoticias(articles); } 
        catch (e) { fiiNewsSkeleton.classList.add('hidden'); fiiNewsMensagem.textContent = 'Erro ao carregar notícias.'; fiiNewsMensagem.classList.remove('hidden'); } 
        finally { refreshIcon.classList.remove('spin-animation'); }
    }

    async function fetchAndCacheNoticiasBFF_NetworkOnly(cacheKey) {
        await vestoDB.delete('apiCache', cacheKey);
        const url = `/api/news?t=${Date.now()}`;
        const response = await fetchBFF(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
        if (response && Array.isArray(response) && response.length > 0) await setCache(cacheKey, response, CACHE_NOTICIAS);
        return response;
    }
    
    async function fetchBFF(url, options = {}) {
        const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), 60000);
        try {
            const response = await fetch(url, { ...options, signal: controller.signal }); clearTimeout(timeoutId);
            if (!response.ok) throw new Error(`Erro do servidor: ${response.statusText}`);
            return response.json();
        } catch (error) { throw error; }
    }
    
    async function buscarPrecosCarteira(force = false) { 
        if (carteiraCalculada.length === 0) return [];
        const mercadoAberto = isB3Open(); const duracao = mercadoAberto ? CACHE_PRECO_MERCADO_ABERTO : CACHE_PRECO_MERCADO_FECHADO;
        const promessas = carteiraCalculada.map(async (ativo) => {
            const cacheKey = `preco_${ativo.symbol}`;
            if (force) await vestoDB.delete('apiCache', cacheKey);
            if (!force) { const c = await getCache(cacheKey); if (c) return c; }
            try {
                const ticker = isFII(ativo.symbol) ? `${ativo.symbol}.SA` : ativo.symbol;
                const data = await fetchBFF(`/api/brapi?path=/quote/${ticker}?range=1d&interval=1d`);
                const res = data.results?.[0];
                if (res && !res.error) { if (res.symbol.endsWith('.SA')) res.symbol = res.symbol.replace('.SA', ''); await setCache(cacheKey, res, duracao); return res; }
                return null;
            } catch (e) { return null; }
        });
        const res = await Promise.all(promessas); return res.filter(p => p !== null);
    }

    function processarProventosScraper(proventosScraper = []) {
        const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
        const dataLimite = new Date(); dataLimite.setDate(hoje.getDate() - 45); dataLimite.setHours(0, 0, 0, 0);
        return proventosScraper.map(p => {
            if (!carteiraCalculada.find(a => a.symbol === p.symbol)) return null;
            if (p.paymentDate && p.value > 0) {
                const d = new Date(p.paymentDate.split('-').map((v, i) => i === 1 ? v - 1 : v));
                if (d >= dataLimite) return p;
            } return null;
        }).filter(p => p !== null);
    }

    async function buscarProventosFuturos(force = false) {
        const fiiNaCarteira = carteiraCalculada.filter(a => isFII(a.symbol)).map(a => a.symbol);
        if (fiiNaCarteira.length === 0) return [];
        let proventosPool = []; let buscar = [];
        for (const s of fiiNaCarteira) {
            const k = `provento_ia_${s}`;
            if (force) { await vestoDB.delete('apiCache', k); await removerProventosConhecidos(s); }
            const c = await getCache(k);
            if (c) proventosPool.push(c); else buscar.push(s);
        }
        if (buscar.length > 0) {
            try {
                const novos = await callScraperProventosCarteiraAPI(buscar);
                if (novos && Array.isArray(novos)) {
                    for (const p of novos) {
                        if (p && p.symbol && p.paymentDate) {
                            await setCache(`provento_ia_${p.symbol}`, p, CACHE_PROVENTOS); proventosPool.push(p);
                            const id = p.symbol + '_' + p.paymentDate;
                            if (!proventosConhecidos.some(pc => pc.id === id)) {
                                await supabaseDB.addProventoConhecido({ ...p, processado: false, id });
                                proventosConhecidos.push({ ...p, processado: false, id });
                            }
                        }
                    }
                }
            } catch (e) { console.error(e); }
        }
        return processarProventosScraper(proventosPool);
    }
	
	async function callScraperFundamentosAPI(ticker) {
        const response = await fetchBFF('/api/scraper', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'fundamentos', payload: { ticker } }) });
        return response.json;
    }

    async function buscarHistoricoProventosAgregado(force = false) {
        const fiiNaCarteira = carteiraCalculada.filter(a => isFII(a.symbol));
        if (fiiNaCarteira.length === 0) return { labels: [], data: [] };
        const fiiSymbols = fiiNaCarteira.map(a => a.symbol);
        const cacheKey = `cache_grafico_historico_${currentUserId}`;
        if (force) await vestoDB.delete('apiCache', cacheKey);
        let raw = await getCache(cacheKey);
        if (!raw) {
            try { raw = await callScraperHistoricoPortfolioAPI(fiiSymbols); if (raw) await setCache(cacheKey, raw, CACHE_IA_HISTORICO); }
            catch (e) { return { labels: [], data: [] }; }
        }
        if (!raw || raw.length === 0) return { labels: [], data: [] };
        const agg = {};
        raw.forEach(item => {
            if (item.paymentDate) {
                const [ano, mes] = item.paymentDate.split('-'); const k = `${mes}/${ano.substring(2)}`;
                const qtd = getQuantidadeNaData(item.symbol, item.dataCom || item.paymentDate);
                if (qtd > 0) agg[k] = (agg[k] || 0) + (item.value * qtd);
            }
        });
        const labels = Object.keys(agg).sort((a, b) => {
            const [mA, aA] = a.split('/'); const [mB, aB] = b.split('/');
            return new Date(`20${aA}-${mA}-01`) - new Date(`20${aB}-${mB}-01`);
        });
        return { labels, data: labels.map(l => agg[l]) };
    }
    
    async function atualizarTodosDados(force = false) { 
        renderizarDashboardSkeletons(true); renderizarCarteiraSkeletons(true);
        calcularCarteira(); await processarDividendosPagos(); 
        renderizarHistorico(); renderizarGraficoPatrimonio();
        if (carteiraCalculada.length > 0) { dashboardStatus.classList.remove('hidden'); dashboardLoading.classList.remove('hidden'); }
        const refreshIcon = refreshButton.querySelector('svg'); if (force) refreshIcon.classList.add('spin-animation');
        if (!force) {
            const proventosFuturosCache = processarProventosScraper(proventosConhecidos);
            if (proventosFuturosCache.length > 0) { proventosAtuais = proventosFuturosCache; renderizarProventos(); }
        }
        if (carteiraCalculada.length === 0) {
             precosAtuais = []; proventosAtuais = []; await renderizarCarteira(); 
             renderizarProventos(); renderizarGraficoHistorico({ labels: [], data: [] }); 
             refreshIcon.classList.remove('spin-animation'); return;
        }
        const pPrecos = buscarPrecosCarteira(force); const pProventos = buscarProventosFuturos(force); const pHistorico = buscarHistoricoProventosAgregado(force);
        pPrecos.then(async precos => { if (precos.length > 0 || precosAtuais.length === 0) { precosAtuais = precos; await renderizarCarteira(); } }).catch(() => {});
        pProventos.then(async p => { proventosAtuais = processarProventosScraper(proventosConhecidos); renderizarProventos(); if (precosAtuais.length > 0) await renderizarCarteira(); }).catch(() => {});
        pHistorico.then(({ labels, data }) => renderizarGraficoHistorico({ labels, data })).catch(() => {});
        try { await Promise.allSettled([pPrecos, pProventos, pHistorico]); } 
        finally { refreshIcon.classList.remove('spin-animation'); dashboardStatus.classList.add('hidden'); dashboardLoading.classList.add('hidden'); }
    }
    
    // --- MANIPULADORES DE EVENTOS ---
    async function handleToggleFavorito() { const symbol = detalhesFavoritoBtn.dataset.symbol; if(!symbol) return; const isFavorite = watchlist.some(i => i.symbol === symbol); try { if(isFavorite) { await supabaseDB.deleteWatchlist(symbol); watchlist = watchlist.filter(i => i.symbol !== symbol); showToast(`${symbol} removido.`); } else { const n = {symbol, addedAt: new Date().toISOString()}; await supabaseDB.addWatchlist(n); watchlist.push(n); showToast(`${symbol} adicionado!`, 'success'); } atualizarIconeFavorito(symbol); renderizarWatchlist(); } catch(e){ showToast("Erro ao salvar."); } }
    async function handleSalvarTransacao() { let ticker = tickerInput.value.trim().toUpperCase(); let qtd = parseInt(quantityInput.value, 10); let preco = parseFloat(precoMedioInput.value.replace(',', '.')); let data = dateInput.value; let id = transacaoIdInput.value; if(ticker.endsWith('.SA')) ticker=ticker.replace('.SA',''); if(!ticker || !qtd || qtd<=0 || !preco || preco<0 || !data) { showToast("Preencha tudo."); return; } addButton.innerHTML = `<span class="loader-sm"></span>`; addButton.disabled = true; if(!id) { const existe = carteiraCalculada.find(a=>a.symbol===ticker); if(!existe && isFII(ticker)) { saldoCaixa=0; await salvarCaixa(); } if(!existe) { try { const d = await fetchBFF(`/api/brapi?path=/quote/${isFII(ticker)?ticker+'.SA':ticker}`); if(!d.results || d.results[0].error) throw new Error(); } catch(e) { showToast("Ativo não encontrado."); addButton.innerHTML=`Adicionar`; addButton.disabled=false; return; } } } const iso = new Date(data + 'T12:00:00').toISOString(); if(id) { await supabaseDB.updateTransacao(id, {date:iso, symbol:ticker, type:'buy', quantity:qtd, price:preco}); const idx = transacoes.findIndex(t=>t.id===id); if(idx>-1) transacoes[idx] = {...transacoes[idx], date:iso, symbol:ticker, quantity:qtd, price:preco}; showToast("Atualizado!", 'success'); } else { const nt = {id:'tx_'+Date.now(), date:iso, symbol:ticker, type:'buy', quantity:qtd, price:preco}; await supabaseDB.addTransacao(nt); transacoes.push(nt); showToast("Adicionado!", 'success'); } addButton.innerHTML=`Adicionar`; addButton.disabled=false; hideAddModal(); await removerCacheAtivo(ticker); await atualizarTodosDados((!carteiraCalculada.find(a=>a.symbol===ticker) && isFII(ticker))); }
    function handleRemoverAtivo(symbol) { showModal('Remover Ativo', `Remover ${symbol} e todo histórico?`, async () => { transacoes = transacoes.filter(t => t.symbol !== symbol); await supabaseDB.deleteTransacoesDoAtivo(symbol); await removerCacheAtivo(symbol); await removerProventosConhecidos(symbol); await supabaseDB.deleteWatchlist(symbol); watchlist = watchlist.filter(i => i.symbol !== symbol); renderizarWatchlist(); saldoCaixa=0; await salvarCaixa(); await atualizarTodosDados(true); }); }
    function handleAbrirModalEdicao(id) { const tx = transacoes.find(t => t.id === id); if (!tx) return; transacaoEmEdicao = tx; addModalTitle.textContent = 'Editar Compra'; transacaoIdInput.value = tx.id; tickerInput.value = tx.symbol; tickerInput.disabled = true; dateInput.value = formatDateToInput(tx.date); quantityInput.value = tx.quantity; precoMedioInput.value = tx.price; addButton.textContent = 'Salvar'; showAddModal(); }
    function handleExcluirTransacao(id, symbol) { const tx = transacoes.find(t => t.id === id); if (!tx) return; showModal('Excluir', `Excluir compra de ${tx.symbol}?`, async () => { await supabaseDB.deleteTransacao(id); transacoes = transacoes.filter(t => t.id !== id); await removerCacheAtivo(symbol); const hasMore = transacoes.some(t => t.symbol === symbol); saldoCaixa=0; await salvarCaixa(); if(!hasMore) await removerProventosConhecidos(symbol); await atualizarTodosDados(true); showToast("Excluído.", 'success'); }); }
    async function handleAlterarSenha(e) { e.preventDefault(); const current = currentPasswordInput.value; const newP = changeNewPasswordInput.value; const confirmP = changeConfirmPasswordInput.value; if(newP.length < 6) { showToast("Mínimo 6 caracteres."); return; } if(newP !== confirmP) { showToast("Senhas não conferem."); return; } changePasswordSubmitBtn.innerHTML = '<span class="loader-sm"></span>'; changePasswordSubmitBtn.disabled = true; try { const session = await supabaseDB.initialize(); const err = await supabaseDB.signIn(session.user.email, current); if(err) { showToast("Senha atual incorreta."); } else { await supabaseDB.updateUserPassword(newP); showToast("Senha alterada!", 'success'); setTimeout(() => { changePasswordModal.classList.remove('visible'); changePasswordForm.reset(); }, 1500); } } catch(e) { showToast("Erro."); } finally { changePasswordSubmitBtn.textContent='Atualizar Senha'; changePasswordSubmitBtn.disabled=false; } }

    function limparDetalhes() {
        detalhesMensagem.classList.remove('hidden'); detalhesLoading.classList.add('hidden');
        detalhesTituloTexto.textContent = 'Detalhes'; detalhesNomeLongo.textContent = ''; 
        detalhesPreco.innerHTML = ''; detalhesHistoricoContainer.classList.add('hidden'); detalhesAiProvento.innerHTML = '';
        document.getElementById('detalhes-transacoes-container').classList.add('hidden');
        document.getElementById('detalhes-lista-transacoes').innerHTML = '';
        document.getElementById('detalhes-transacoes-vazio').classList.add('hidden');
        if (detalhesChartInstance) { detalhesChartInstance.destroy(); detalhesChartInstance = null; }
        detalhesFavoritoIconEmpty.classList.remove('hidden'); detalhesFavoritoIconFilled.classList.add('hidden'); detalhesFavoritoBtn.dataset.symbol = '';
        currentDetalhesSymbol = null; currentDetalhesMeses = 3; currentDetalhesHistoricoJSON = null; 
        periodoSelectorGroup.querySelectorAll('.periodo-selector-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.meses === '3'));
    }
    
    // --- LÓGICA MINIMALISTA E LIMPA PARA O MODAL (Visual Premium) ---
    async function handleMostrarDetalhes(symbol) {
        detalhesMensagem.classList.add('hidden'); detalhesLoading.classList.remove('hidden');
        detalhesPreco.innerHTML = ''; detalhesAiProvento.innerHTML = ''; 
        detalhesHistoricoContainer.classList.add('hidden');
        detalhesTituloTexto.textContent = symbol; detalhesNomeLongo.textContent = 'A carregar...';
        
        currentDetalhesSymbol = symbol; currentDetalhesMeses = 3; currentDetalhesHistoricoJSON = null; 
        periodoSelectorGroup.querySelectorAll('.periodo-selector-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.meses === '3'));
        
        const tickerParaApi = isFII(symbol) ? `${symbol}.SA` : symbol;
        const cacheKeyPreco = `detalhe_preco_${symbol}`;
        let precoData = await getCache(cacheKeyPreco);
        
        if (!precoData) {
            try {
                const data = await fetchBFF(`/api/brapi?path=/quote/${tickerParaApi}?range=1d&interval=1d`);
                precoData = data.results?.[0];
                const isAberto = isB3Open();
                if (precoData && !precoData.error) await setCache(cacheKeyPreco, precoData, isAberto ? CACHE_PRECO_MERCADO_ABERTO : CACHE_PRECO_MERCADO_FECHADO); 
            } catch (e) { precoData = null; showToast("Erro ao buscar preço."); }
        }

        if (isFII(symbol)) {
            detalhesHistoricoContainer.classList.remove('hidden'); fetchHistoricoScraper(symbol); 
        }
        
        detalhesLoading.classList.add('hidden');

        if (precoData) {
            detalhesNomeLongo.textContent = precoData.longName || 'Nome não disponível';
            const variacaoCor = precoData.regularMarketChangePercent > 0 ? 'text-green-500' : (precoData.regularMarketChangePercent < 0 ? 'text-red-500' : 'text-gray-500');
            
            const ativoCarteira = carteiraCalculada.find(a => a.symbol === symbol);
            let userPosHtml = '';
            if (ativoCarteira) {
                const totalPosicao = precoData.regularMarketPrice * ativoCarteira.quantity;
                // Card "Sua Posição" com fundo diferenciado (Premium)
                userPosHtml = `
                    <div class="col-span-12 bg-[#1C1C1E] border border-purple-500/20 p-4 rounded-3xl flex justify-between items-center shadow-lg relative overflow-hidden">
                        <div class="absolute top-0 right-0 w-24 h-24 bg-purple-600/10 blur-2xl rounded-full -mr-10 -mt-10 pointer-events-none"></div>
                        <div>
                            <span class="text-xs text-gray-400 block mb-1">Sua Posição</span>
                            <p class="text-xl font-bold text-white">${formatBRL(totalPosicao)}</p>
                            <p class="text-xs text-gray-500 mt-0.5">${ativoCarteira.quantity} cotas</p>
                        </div>
                        <div class="text-right z-10">
                            <span class="text-xs text-gray-400 block mb-1">Custo Médio</span>
                            <p class="text-sm font-medium text-gray-300">${formatBRL(ativoCarteira.precoMedio)}</p>
                        </div>
                    </div>
                `;
            }

            // HTML MINIMALISTA
            detalhesPreco.innerHTML = `
                <div class="col-span-12 text-center pb-4 pt-2">
                    <h2 class="text-5xl font-bold text-white tracking-tighter">${formatBRL(precoData.regularMarketPrice)}</h2>
                    <span class="text-lg font-medium ${variacaoCor} mt-1 block">${formatPercent(precoData.regularMarketChangePercent)} Hoje</span>
                </div>

                ${userPosHtml}

                <div class="col-span-12 grid grid-cols-3 gap-3 text-center mb-2 mt-2" id="clean-stats-row">
                    <div class="bg-[#1C1C1E] rounded-2xl h-20 animate-pulse border border-[#2C2C2E]"></div>
                    <div class="bg-[#1C1C1E] rounded-2xl h-20 animate-pulse border border-[#2C2C2E]"></div>
                    <div class="bg-[#1C1C1E] rounded-2xl h-20 animate-pulse border border-[#2C2C2E]"></div>
                </div>

                <div class="col-span-12 space-y-0 bg-[#1C1C1E] rounded-3xl border border-[#2C2C2E] overflow-hidden" id="clean-details-list">
                    <div class="h-12 border-b border-[#2C2C2E] animate-pulse"></div>
                    <div class="h-12 border-b border-[#2C2C2E] animate-pulse"></div>
                    <div class="h-12 border-b border-[#2C2C2E] animate-pulse"></div>
                </div>
            `;

            // Preenchimento dos dados
            callScraperFundamentosAPI(symbol).then(fundamentos => {
                const rowStats = document.getElementById('clean-stats-row');
                const listDetails = document.getElementById('clean-details-list');

                if (rowStats && listDetails) {
                    const dados = fundamentos || { 
                        pvp: '-', dy: '-', segmento: '-', vacancia: '-', 
                        vp_cota: '-', liquidez: '-', val_mercado: '-', 
                        ultimo_rendimento: '-', patrimonio_liquido: '-', variacao_12m: '-',
                        cnpj: '-', num_cotistas: '-', tipo_gestao: '-'
                    };

                    // Linha de Destaques (3 Pilares) com visual de Card
                    rowStats.innerHTML = `
                        <div class="bg-[#1C1C1E] rounded-2xl p-3 border border-[#2C2C2E] flex flex-col justify-center">
                            <span class="text-[10px] text-gray-500 uppercase tracking-wide mb-1">DY (12m)</span>
                            <span class="text-base font-bold text-purple-400">${dados.dy || '-'}</span>
                        </div>
                        <div class="bg-[#1C1C1E] rounded-2xl p-3 border border-[#2C2C2E] flex flex-col justify-center">
                            <span class="text-[10px] text-gray-500 uppercase tracking-wide mb-1">P/VP</span>
                            <span class="text-base font-bold text-white">${dados.pvp || '-'}</span>
                        </div>
                        <div class="bg-[#1C1C1E] rounded-2xl p-3 border border-[#2C2C2E] flex flex-col justify-center">
                            <span class="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Últ. Rend.</span>
                            <span class="text-base font-bold text-green-400">${dados.ultimo_rendimento || '-'}</span>
                        </div>
                    `;

                    // Função para gerar linha da lista
                    const renderRow = (label, value, isLast = false) => `
                        <div class="flex justify-between items-center py-3.5 px-4 ${isLast ? '' : 'border-b border-[#2C2C2E]'}">
                            <span class="text-sm text-gray-400 font-medium">${label}</span>
                            <span class="text-sm font-semibold text-white text-right max-w-[60%] truncate">${value || '-'}</span>
                        </div>
                    `;

                    const corVar12m = dados.variacao_12m && dados.variacao_12m.includes('-') ? 'text-red-400' : 'text-green-400';

                    // Lista Limpa e Organizada
                    listDetails.innerHTML = `
                        ${renderRow('Liquidez Diária', dados.liquidez)}
                        ${renderRow('Patrimônio Líquido', dados.patrimonio_liquido)}
                        ${renderRow('VP por Cota', dados.vp_cota)}
                        ${renderRow('Valor de Mercado', dados.val_mercado)}
                        ${renderRow('Vacância', dados.vacancia)}
                        <div class="flex justify-between items-center py-3.5 px-4 border-b border-[#2C2C2E]">
                            <span class="text-sm text-gray-400 font-medium">Var. 12 Meses</span>
                            <span class="text-sm font-semibold ${corVar12m} text-right">${dados.variacao_12m || '-'}</span>
                        </div>
                        <div class="bg-black/20">
                            <div class="px-4 py-2 text-[10px] font-bold text-gray-600 uppercase tracking-widest bg-[#151517] border-b border-[#2C2C2E]">Dados Gerais</div>
                            ${renderRow('Segmento', dados.segmento)}
                            ${renderRow('Gestão', dados.tipo_gestao)}
                            ${renderRow('Cotistas', dados.num_cotistas)}
                            <div class="flex justify-between items-center py-3.5 px-4">
                                <span class="text-sm text-gray-400 font-medium">CNPJ</span>
                                <span class="text-xs font-mono text-gray-500 select-all bg-[#2C2C2E] px-2 py-1 rounded">${dados.cnpj || '-'}</span>
                            </div>
                        </div>
                    `;
                }
            }).catch(e => { console.error(e); });

        } else {
            detalhesPreco.innerHTML = '<p class="text-center text-red-500 col-span-12 py-4">Erro ao buscar preço.</p>';
        }
        
        renderizarTransacoesDetalhes(symbol);
        atualizarIconeFavorito(symbol);
    }
    
    function renderizarTransacoesDetalhes(symbol) { const listaContainer = document.getElementById('detalhes-lista-transacoes'); const vazioMsg = document.getElementById('detalhes-transacoes-vazio'); const container = document.getElementById('detalhes-transacoes-container'); listaContainer.innerHTML = ''; const txsDoAtivo = transacoes.filter(t => t.symbol === symbol).sort((a, b) => new Date(b.date) - new Date(a.date)); if (txsDoAtivo.length === 0) { vazioMsg.classList.remove('hidden'); listaContainer.classList.add('hidden'); } else { vazioMsg.classList.add('hidden'); listaContainer.classList.remove('hidden'); const fragment = document.createDocumentFragment(); txsDoAtivo.forEach(t => { const card = document.createElement('div'); card.className = 'card-bg p-3 rounded-2xl flex items-center justify-between border border-[#2C2C2E]'; const cor = 'text-green-500'; const sinal = '+'; card.innerHTML = `<div class="flex items-center gap-3"><div class="p-2 bg-[#1C1C1E] rounded-full text-green-500"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" /></svg></div><div><p class="text-sm font-semibold text-white">Compra</p><p class="text-xs text-gray-500">${formatDate(t.date)}</p></div></div><div class="text-right"><p class="text-sm font-semibold ${cor}">${sinal}${t.quantity} Cotas</p><p class="text-xs text-gray-400">${formatBRL(t.price)}</p></div>`; fragment.appendChild(card); }); listaContainer.appendChild(fragment); } container.classList.remove('hidden'); }
    async function fetchHistoricoScraper(symbol) { detalhesAiProvento.innerHTML = `<div id="historico-periodo-loading" class="space-y-3 animate-shimmer-parent pt-2 h-48"><div class="h-4 bg-[#1C1C1E] rounded-md w-3/4"></div><div class="h-4 bg-[#1C1C1E] rounded-md w-1/2"></div><div class="h-4 bg-[#1C1C1E] rounded-md w-2/3"></div></div>`; try { const cacheKey = `hist_ia_${symbol}_12`; let scraperResultJSON = await getCache(cacheKey); if (!scraperResultJSON) { scraperResultJSON = await callScraperHistoricoAPI(symbol); if (scraperResultJSON && Array.isArray(scraperResultJSON)) { await setCache(cacheKey, scraperResultJSON, CACHE_IA_HISTORICO); } else { scraperResultJSON = []; } } currentDetalhesHistoricoJSON = scraperResultJSON; renderHistoricoIADetalhes(3); } catch (e) { showToast("Erro na consulta de dados."); detalhesAiProvento.innerHTML = `<div class="border border-red-900/50 bg-[#1C1C1E] p-4 rounded-2xl flex items-center gap-3"><p class="text-red-400 text-sm">Erro</p></div>`; } }
    function renderHistoricoIADetalhes(meses) { if (!currentDetalhesHistoricoJSON) return; if (currentDetalhesHistoricoJSON.length === 0) { detalhesAiProvento.innerHTML = `<p class="text-sm text-gray-500 text-center py-4 bg-[#1C1C1E] rounded-2xl border border-[#2C2C2E]">Sem histórico recente.</p>`; if (detalhesChartInstance) { detalhesChartInstance.destroy(); detalhesChartInstance = null; } return; } if (!document.getElementById('detalhes-proventos-chart')) { detalhesAiProvento.innerHTML = `<div class="relative h-48 w-full"><canvas id="detalhes-proventos-chart"></canvas></div>`; } const dadosFiltrados = currentDetalhesHistoricoJSON.slice(0, meses).reverse(); const labels = dadosFiltrados.map(item => item.mes); const data = dadosFiltrados.map(item => item.valor); renderizarGraficoProventosDetalhes({ labels, data }); }
    function mudarAba(tabId) { tabContents.forEach(content => { content.classList.toggle('active', content.id === tabId); }); tabButtons.forEach(button => { button.classList.toggle('active', button.dataset.tab === tabId); }); showAddModalBtn.classList.toggle('hidden', tabId !== 'tab-carteira'); }
    
    // Listeners (SETUP)
    refreshButton.addEventListener('click', async () => { await atualizarTodosDados(true); });
    refreshNoticiasButton.addEventListener('click', async () => { await handleAtualizarNoticias(true); });
    showAddModalBtn.addEventListener('click', showAddModal);
    emptyStateAddBtn.addEventListener('click', showAddModal);
    addAtivoCancelBtn.addEventListener('click', hideAddModal);
    addAtivoModal.addEventListener('click', (e) => { if (e.target === addAtivoModal) { hideAddModal(); } });
    addAtivoForm.addEventListener('submit', (e) => { e.preventDefault(); handleSalvarTransacao(); });
    listaCarteira.addEventListener('click', (e) => { const target = e.target.closest('button'); if (!target) return; const action = target.dataset.action; const symbol = target.dataset.symbol; if (action === 'remove') { handleRemoverAtivo(symbol); } else if (action === 'details') { showDetalhesModal(symbol); } else if (action === 'toggle') { const drawer = document.getElementById(`drawer-${symbol}`); const icon = target.querySelector('.card-arrow-icon'); drawer?.classList.toggle('open'); icon?.classList.toggle('open'); } });
    listaHistorico.addEventListener('click', (e) => { const target = e.target.closest('button'); if (!target) return; const action = target.dataset.action; const id = target.dataset.id; const symbol = target.dataset.symbol; if (action === 'edit') { handleAbrirModalEdicao(id); } else if (action === 'delete') { handleExcluirTransacao(id, symbol); } });
    dashboardDrawers.addEventListener('click', (e) => { const target = e.target.closest('button'); if (!target || !target.dataset.targetDrawer) return; const drawerId = target.dataset.targetDrawer; const drawer = document.getElementById(drawerId); const icon = target.querySelector('.card-arrow-icon'); drawer?.classList.toggle('open'); icon?.classList.toggle('open'); });
    if(watchlistToggleBtn) watchlistToggleBtn.addEventListener('click', (e) => { const target = e.currentTarget; const drawerId = target.dataset.targetDrawer; const drawer = document.getElementById(drawerId); const icon = target.querySelector('.card-arrow-icon'); drawer?.classList.toggle('open'); icon?.classList.toggle('open'); });
    tabButtons.forEach(button => { button.addEventListener('click', () => { mudarAba(button.dataset.tab); }); });
    if (btnIaAnalise) btnIaAnalise.addEventListener('click', handleAnaliseIA);
    if (closeAiModal) closeAiModal.addEventListener('click', () => { aiModal.classList.remove('visible'); aiContent.innerHTML = ''; });
    if (aiModal) aiModal.addEventListener('click', (e) => { if (e.target === aiModal) { aiModal.classList.remove('visible'); aiContent.innerHTML = ''; } });
    customModalCancel.addEventListener('click', hideModal);
    customModalOk.addEventListener('click', () => { if (typeof onConfirmCallback === 'function') { onConfirmCallback(); } hideModal(); });
    customModal.addEventListener('click', (e) => { if (e.target === customModal) { hideModal(); } });
    detalhesVoltarBtn.addEventListener('click', hideDetalhesModal);
    detalhesPageModal.addEventListener('click', (e) => { if (e.target === detalhesPageModal) { hideDetalhesModal(); } });
    detalhesPageContent.addEventListener('touchstart', (e) => { if (detalhesConteudoScroll.scrollTop === 0) { touchStartY = e.touches[0].clientY; touchMoveY = touchStartY; isDraggingDetalhes = true; detalhesPageContent.style.transition = 'none'; } }, { passive: true });
    detalhesPageContent.addEventListener('touchmove', (e) => { if (!isDraggingDetalhes) return; touchMoveY = e.touches[0].clientY; const diff = touchMoveY - touchStartY; if (diff > 0) { e.preventDefault(); detalhesPageContent.style.transform = `translateY(${diff}px)`; } }, { passive: false });
    detalhesPageContent.addEventListener('touchend', (e) => { if (!isDraggingDetalhes) return; isDraggingDetalhes = false; const diff = touchMoveY - touchStartY; detalhesPageContent.style.transition = 'transform 0.4s ease-in-out'; if (diff > 100) { hideDetalhesModal(); } else { detalhesPageContent.style.transform = ''; } touchStartY = 0; touchMoveY = 0; });
    fiiNewsList.addEventListener('click', (e) => { const tickerTag = e.target.closest('.news-ticker-tag'); if (tickerTag) { e.stopPropagation(); const symbol = tickerTag.dataset.symbol; if (symbol) { showDetalhesModal(symbol); } return; } if (e.target.closest('a')) { e.stopPropagation(); return; } const card = e.target.closest('.news-card-interactive'); if (card) { const targetId = card.dataset.target; const drawer = document.getElementById(targetId); const icon = card.querySelector('.card-arrow-icon'); drawer?.classList.toggle('open'); icon?.classList.toggle('open'); } });
    detalhesFavoritoBtn.addEventListener('click', handleToggleFavorito);
    if (watchlistListaEl) watchlistListaEl.addEventListener('click', (e) => { const target = e.target.closest('button'); if (target && target.dataset.action === 'details' && target.dataset.symbol) { showDetalhesModal(target.dataset.symbol); } });
    if (carteiraSearchInput) { carteiraSearchInput.addEventListener('input', (e) => { const term = e.target.value.trim().toUpperCase(); const cards = listaCarteira.querySelectorAll('.card-bg'); cards.forEach(card => { const symbol = card.dataset.symbol; if (symbol && symbol.includes(term)) { card.classList.remove('hidden'); } else { card.classList.add('hidden'); } }); }); carteiraSearchInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') { const term = carteiraSearchInput.value.trim().toUpperCase(); if (!term) return; carteiraSearchInput.blur(); showToast(`Buscando ${term}...`, 'success'); showDetalhesModal(term); carteiraSearchInput.value = ''; carteiraSearchInput.dispatchEvent(new Event('input')); } }); }
    periodoSelectorGroup.addEventListener('click', (e) => { const target = e.target.closest('.periodo-selector-btn'); if (!target) return; const meses = parseInt(target.dataset.meses, 10); if (meses === currentDetalhesMeses) return; currentDetalhesMeses = meses; periodoSelectorGroup.querySelectorAll('.periodo-selector-btn').forEach(btn => { btn.classList.remove('active'); }); target.classList.add('active'); renderHistoricoIADetalhes(currentDetalhesMeses); });
    if (toggleBioBtn) { toggleBioBtn.addEventListener('click', () => { const isEnabled = localStorage.getItem('vesto_bio_enabled') === 'true'; if (isEnabled) { showModal("Desativar Biometria?", "Deseja remover o bloqueio por Face ID/Digital?", () => { desativarBiometria(); }); } else { showModal("Ativar Biometria?", "Isso usará o sensor do seu dispositivo para proteger o app.", () => { ativarBiometria(); }); } }); }
    if (togglePrivacyBtn) { updatePrivacyUI(); togglePrivacyBtn.addEventListener('click', () => { const current = localStorage.getItem('vesto_privacy_mode') === 'true'; localStorage.setItem('vesto_privacy_mode', !current); updatePrivacyUI(); showToast(!current ? "Modo Privacidade Ativado" : "Modo Privacidade Desativado", "success"); }); }
    if (exportCsvBtn) { exportCsvBtn.addEventListener('click', () => { if (!transacoes || transacoes.length === 0) { showToast("Sem dados."); return; } let csvContent = "data:text/csv;charset=utf-8,Data,Ativo,Tipo,Quantidade,Preco,ID\n"; transacoes.forEach(t => { const dataFmt = t.date.split('T')[0]; const row = `${dataFmt},${t.symbol},${t.type},${t.quantity},${t.price},${t.id}`; csvContent += row + "\n"; }); const encodedUri = encodeURI(csvContent); const link = document.createElement("a"); link.setAttribute("href", encodedUri); link.setAttribute("download", `vesto_export.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link); showToast("Download iniciado!", "success"); }); }
    if (clearCacheBtn) { clearCacheBtn.addEventListener('click', () => { showModal("Limpar Cache?", "Isso pode corrigir erros.", async () => { try { await vestoDB.clear('apiCache'); if ('serviceWorker' in navigator) { const registrations = await navigator.serviceWorker.getRegistrations(); for(let registration of registrations) { await registration.unregister(); } } window.location.reload(); } catch (e) { console.error(e); showToast("Erro."); } }); }); }
    if (openChangePasswordBtn) { openChangePasswordBtn.addEventListener('click', () => { changePasswordModal.classList.add('visible'); changePasswordModal.querySelector('.modal-content').classList.remove('modal-out'); currentPasswordInput.focus(); }); }
    if (closeChangePasswordBtn) { closeChangePasswordBtn.addEventListener('click', () => { const modalContent = changePasswordModal.querySelector('.modal-content'); modalContent.classList.add('modal-out'); setTimeout(() => { changePasswordModal.classList.remove('visible'); changePasswordForm.reset(); }, 200); }); }
    if (changePasswordForm) { changePasswordForm.addEventListener('submit', handleAlterarSenha); }
    if (logoutBtn) { logoutBtn.addEventListener('click', () => { showModal("Sair?", "Tem certeza?", async () => { try { await vestoDB.clear('apiCache'); sessionStorage.clear(); } catch (e) {} sessionStorage.setItem('vesto_just_logged_out', 'true'); await supabaseDB.signOut(); window.location.reload(); }); }); }

    // --- FUNÇÕES DE UI QUE FALTAVAM (CORREÇÃO DO ERRO) ---
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

    // --- FUNÇÕES FINAIS ---
    async function init() {
        try { await vestoDB.init(); } catch (e) { showToast("Erro DB Local."); return; }
        if (showRecoverBtn) showRecoverBtn.addEventListener('click', () => { loginForm.classList.add('hidden'); signupForm.classList.add('hidden'); recoverForm.classList.remove('hidden'); recoverError.classList.add('hidden'); recoverMessage.classList.add('hidden'); });
        if (backToLoginBtn) backToLoginBtn.addEventListener('click', () => { recoverForm.classList.add('hidden'); loginForm.classList.remove('hidden'); });
        if (recoverForm) recoverForm.addEventListener('submit', async (e) => { e.preventDefault(); const email = recoverEmailInput.value; recoverError.classList.add('hidden'); recoverMessage.classList.add('hidden'); recoverSubmitBtn.innerHTML = '<span class="loader-sm"></span>'; recoverSubmitBtn.disabled = true; const result = await supabaseDB.sendPasswordResetEmail(email); if (result === 'success') { recoverMessage.classList.remove('hidden'); recoverForm.reset(); } else { recoverError.textContent = result; recoverError.classList.remove('hidden'); } recoverSubmitBtn.innerHTML = 'Enviar Link'; recoverSubmitBtn.disabled = false; });
        if (window.location.hash && window.location.hash.includes('type=recovery')) { newPasswordModal.classList.add('visible'); document.querySelector('#new-password-modal .modal-content').classList.remove('modal-out'); }
        if (newPasswordForm) newPasswordForm.addEventListener('submit', async (e) => { e.preventDefault(); const newPass = newPasswordInput.value; if (newPass.length < 6) { showToast("Mínimo 6 caracteres."); return; } newPasswordBtn.innerHTML = '<span class="loader-sm"></span>'; newPasswordBtn.disabled = true; try { await supabaseDB.updateUserPassword(newPass); showToast("Senha atualizada!", "success"); setTimeout(() => { newPasswordModal.classList.remove('visible'); window.location.href = "/"; }, 1500); } catch (error) { showToast("Erro: " + error.message); newPasswordBtn.innerHTML = 'Salvar Nova Senha'; newPasswordBtn.disabled = false; } });
        showAuthLoading(true);
        let session; try { session = await supabaseDB.initialize(); } catch (e) { showAuthLoading(false); showLoginError("Erro conexão."); return; }
        loginForm.addEventListener('submit', async (e) => { e.preventDefault(); loginSubmitBtn.innerHTML = '<span class="loader-sm"></span>'; loginSubmitBtn.disabled = true; loginError.classList.add('hidden'); const email = loginEmailInput.value; const password = loginPasswordInput.value; const error = await supabaseDB.signIn(email, password); if (error) { showLoginError(error); } else { window.location.reload(); } });
        signupForm.addEventListener('submit', async (e) => { e.preventDefault(); const email = signupEmailInput.value; const password = signupPasswordInput.value; const confirmPassword = signupConfirmPasswordInput.value; signupError.classList.add('hidden'); signupSuccess.classList.add('hidden'); if (password !== confirmPassword) { showSignupError("Senhas não conferem."); return; } if (password.length < 6) { showSignupError("Mínimo 6 caracteres."); return; } signupSubmitBtn.innerHTML = '<span class="loader-sm"></span>'; signupSubmitBtn.disabled = true; const result = await supabaseDB.signUp(email, password); if (result === 'success') { signupEmailInput.classList.add('hidden'); signupPasswordInput.parentElement.classList.add('hidden'); signupConfirmPasswordInput.parentElement.classList.add('hidden'); signupSubmitBtn.classList.add('hidden'); signupSuccess.classList.remove('hidden'); signupForm.reset(); signupSubmitBtn.innerHTML = 'Criar conta'; signupSubmitBtn.disabled = false; } else { showSignupError(result); } });
        showSignupBtn.addEventListener('click', () => { loginForm.classList.add('hidden'); signupForm.classList.remove('hidden'); recoverForm.classList.add('hidden'); loginError.classList.add('hidden'); signupError.classList.add('hidden'); signupSuccess.classList.add('hidden'); signupEmailInput.classList.remove('hidden'); signupPasswordInput.parentElement.classList.remove('hidden'); signupConfirmPasswordInput.parentElement.classList.remove('hidden'); signupSubmitBtn.classList.remove('hidden'); });
        showLoginBtn.addEventListener('click', () => { signupForm.classList.add('hidden'); recoverForm.classList.add('hidden'); loginForm.classList.remove('hidden'); signupError.classList.add('hidden'); });
        passwordToggleButtons.forEach(button => { button.addEventListener('click', () => { const targetId = button.dataset.target; const targetInput = document.getElementById(targetId); if (!targetInput) return; const eyeOpen = button.querySelector('.eye-icon-open'); const eyeClosed = button.querySelector('.eye-icon-closed'); if (targetInput.type === 'password') { targetInput.type = 'text'; eyeOpen.classList.add('hidden'); eyeClosed.classList.remove('hidden'); } else { targetInput.type = 'password'; eyeOpen.classList.remove('hidden'); eyeClosed.classList.add('hidden'); } }); });
        if (session) { currentUserId = session.user.id; authContainer.classList.add('hidden'); appWrapper.classList.remove('hidden'); await verificarStatusBiometria(); mudarAba('tab-dashboard'); await carregarDadosIniciais(); } else { appWrapper.classList.add('hidden'); authContainer.classList.remove('hidden'); if (recoverForm.classList.contains('hidden') && signupForm.classList.contains('hidden')) { loginForm.classList.remove('hidden'); } showAuthLoading(false); }
    }
    
    await init();
});
