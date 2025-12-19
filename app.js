

import * as supabaseDB from './supabase.js';

let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log('Instalação disponível');
});

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

const REFRESH_INTERVAL = 300000; 
const CACHE_PRECO_MERCADO_ABERTO = 1000 * 60 * 5; 
const CACHE_PRECO_MERCADO_FECHADO = 1000 * 60 * 60 * 12; 
const CACHE_NOTICIAS = 1000 * 60 * 15; 
const CACHE_IA_HISTORICO = 1000 * 60 * 60 * 24; 
const CACHE_PROVENTOS = 1000 * 60 * 60 * 12; 

const DB_NAME = 'vestoCacheDB';
const DB_VERSION = 1; 

function toggleDrawer(symbol) {
    const drawer = document.getElementById(`drawer-${symbol}`);
    
    // Fecha outros drawers abertos (efeito sanfona)
    document.querySelectorAll('.card-drawer.open').forEach(d => {
        if (d.id !== `drawer-${symbol}`) {
            d.classList.remove('open');
        }
    });

    // Alterna o atual
    if (drawer) {
        drawer.classList.toggle('open');
    }
}

// --- CRIAR ITEM DA CARTEIRA (TICKETS NO PROVENTO) ---
function criarCardElemento(ativo, dados) {
    const {
        dadoPreco, precoFormatado, variacaoFormatada, corVariacao,
        totalPosicao, custoTotal, lucroPrejuizo, lucroPrejuizoPercent,
        corPL, dadoProvento, proventoReceber, percentWallet // <--- Certifique-se que percentWallet vem do renderizarCarteira
    } = dados;

    const sigla = ativo.symbol.substring(0, 2);
    
    // Tag de Lucro/Prejuízo (Pill)
    const bgBadge = lucroPrejuizo >= 0 ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500';
    const plArrow = lucroPrejuizo >= 0 ? '▲' : '▼';
    const plTagHtml = dadoPreco 
        ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${bgBadge} border border-white/5 flex items-center gap-1">
             ${plArrow} ${Math.abs(lucroPrejuizoPercent).toFixed(1)}%
           </span>` 
        : '';

    // Lógica de Proventos (MANTIDA IGUAL AO SEU PRINT)
    let proventoHtml = '';
    if (isFII(ativo.symbol) && dadoProvento && dadoProvento.value > 0) {
        const parts = dadoProvento.paymentDate.split('-');
        const dataPag = new Date(parts[0], parts[1] - 1, parts[2]);
        const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
        const foiPago = dataPag <= hoje;
        
        // Badges "Old School"
        let labelBadge = foiPago 
            ? `<span class="px-2 py-0.5 rounded bg-green-900/20 text-green-500 text-[10px] font-bold border border-green-900/30 uppercase tracking-wide">PAGO</span>`
            : `<span class="px-2 py-0.5 rounded bg-yellow-900/20 text-yellow-500 text-[10px] font-bold border border-yellow-900/30 uppercase tracking-wide">AGENDADO</span>`;
        
        let valorDisplay = proventoReceber > 0
            ? `<span class="text-base font-bold ${foiPago ? 'text-green-500' : 'text-yellow-500'}">+ ${formatBRL(proventoReceber)}</span>`
            : `<span class="text-xs font-bold text-gray-500">Sem posição na data com</span>`;

        proventoHtml = `
        <div class="mt-4 pt-3 border-t border-[#2C2C2E]">
            <div class="flex justify-between items-center mb-1">
                <span class="text-[10px] text-gray-500 font-bold uppercase">Provento</span>
                <span class="text-xs text-gray-400">Com: ${formatDate(dadoProvento.dataCom)} • Pag: ${formatDate(dadoProvento.paymentDate)}</span>
            </div>
            <div class="flex justify-between items-center bg-[#111] p-2 rounded-lg border border-[#2C2C2E] mt-2">
                ${labelBadge}
                ${valorDisplay}
            </div>
        </div>`;
    }

    // CRIAÇÃO DO CARD (ESTRUTURA MODERNA)
    const card = document.createElement('div');
    card.className = 'wallet-card group cursor-pointer select-none'; // Usa a classe nova do CSS
    card.setAttribute('data-symbol', ativo.symbol);
    
    // Click Listener direto
    card.onclick = function(e) {
        if (e.target.closest('button')) return;
        toggleDrawer(ativo.symbol);
    };

    card.innerHTML = `
        <div class="p-3 relative pb-4">
            <div class="flex justify-between items-start mb-1">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl bg-[#151515] border border-[#2C2C2E] flex items-center justify-center flex-shrink-0 text-white font-bold text-xs shadow-sm">
                        ${sigla}
                    </div>
                    
                    <div>
                        <div class="flex items-center gap-2">
                            <span class="font-bold text-white text-sm tracking-tight">${ativo.symbol}</span>
                            ${plTagHtml}
                        </div>
                        <div class="text-[11px] text-gray-500 mt-1 flex items-center">
                            <span data-field="cota-qtd">${ativo.quantity} cotas</span>
                            <span class="mx-1">•</span>
                            <span data-field="preco-unitario" class="font-medium text-gray-400">${precoFormatado}</span>
                        </div>
                    </div>
                </div>

                <div class="text-right">
                    <p data-field="posicao-valor" class="text-base font-bold text-white tracking-tight money-value">
                        ${dadoPreco ? formatBRL(totalPosicao) : '...'}
                    </p>
                    <p data-field="variacao-valor" class="text-xs font-medium ${corVariacao} mt-0.5">
                        ${dadoPreco ? variacaoFormatada : '0.00%'}
                    </p>
                </div>
            </div>
            
            <div class="allocation-track">
                <div class="allocation-bar" style="width: ${percentWallet || 0}%;"></div>
            </div>
        </div>

        <div id="drawer-${ativo.symbol}" class="card-drawer">
            <div class="drawer-content px-4 pb-4 pt-1 bg-[#0f0f0f] border-t border-[#2C2C2E]">
                
                <div class="grid grid-cols-2 gap-4 mt-3">
                    <div>
                        <span class="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Custo Total</span>
                        <p data-field="custo-valor" class="text-sm text-gray-300 font-medium">${formatBRL(custoTotal)}</p>
                    </div>
                    <div class="text-right">
                         <span class="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Lucro/Prejuízo</span>
                         <p data-field="pl-valor" class="text-sm font-bold ${corPL}">${dadoPreco ? formatBRL(lucroPrejuizo) : '...'}</p>
                    </div>
                </div>
                
                <div data-field="provento-container">
                    ${proventoHtml}
                </div>

                <div class="flex gap-2 mt-4 pt-2">
                     <button class="flex-1 py-2 text-xs font-bold text-gray-300 bg-[#1C1C1E] border border-[#2C2C2E] rounded-lg hover:bg-[#252525]" onclick="window.abrirDetalhesAtivo('${ativo.symbol}')">
                        Ver Detalhes
                    </button>
                    <button class="py-2 px-3 text-red-400 bg-red-900/10 border border-red-900/20 rounded-lg hover:bg-red-900/20" onclick="window.confirmarExclusao('${ativo.symbol}')">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                </div>
            </div>
        </div>
    `;

    return card;
}

// --- ATUALIZAR ITEM (TICKETS NO PROVENTO) ---
function atualizarCardElemento(card, ativo, dados) {
    const {
        dadoPreco, precoFormatado, variacaoFormatada, corVariacao,
        totalPosicao, custoTotal, lucroPrejuizo, lucroPrejuizoPercent,
        corPL, dadoProvento, proventoReceber, percentWallet
    } = dados;

    // 1. Atualiza Textos Básicos da Lista Principal
    card.querySelector('[data-field="cota-qtd"]').textContent = `${ativo.quantity} cotas`;
    card.querySelector('[data-field="preco-unitario"]').textContent = precoFormatado;
    
    // 2. Atualiza o Destaque (Total da Posição)
    card.querySelector('[data-field="posicao-valor"]').textContent = dadoPreco ? formatBRL(totalPosicao) : '...';
    
    // 3. Atualiza Variação (Texto e Cor)
    const varEl = card.querySelector('[data-field="variacao-valor"]');
    varEl.className = `text-xs font-medium ${corVariacao} mt-0.5 flex justify-end items-center gap-1`;
    varEl.textContent = dadoPreco ? variacaoFormatada : '0.00%';

    // 4. Atualiza Drawer (Custo e PL)
    card.querySelector('[data-field="custo-valor"]').textContent = formatBRL(custoTotal);
    
    const plEl = card.querySelector('[data-field="pl-valor"]');
    plEl.textContent = dadoPreco ? formatBRL(lucroPrejuizo) : '...';
    plEl.className = `text-sm font-bold ${corPL}`;

    // 5. Atualiza Barra de Alocação (Largura e Cor)
    const barColor = lucroPrejuizo >= 0 ? '#22c55e' : '#ef4444';
    const barEl = card.querySelector('.allocation-bar');
    if(barEl) {
        barEl.style.width = `${percentWallet}%`;
        barEl.style.backgroundColor = barColor;
    }

    // 6. Atualiza Badge de % L/P ao lado do ticker
    // Selecionamos o elemento da pílula de lucro, se existir, e recriamos
    const plTagContainer = card.querySelector('.profit-pill');
    if (dadoPreco) {
        const bgBadge = lucroPrejuizo >= 0 ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500';
        const plArrow = lucroPrejuizo >= 0 ? '▲' : '▼';
        const novoHtml = `${plArrow} ${Math.abs(lucroPrejuizoPercent).toFixed(1)}%`;
        
        if (plTagContainer) {
            // Se já existe, atualiza classes e texto
            plTagContainer.className = `profit-pill ${bgBadge}`;
            plTagContainer.innerHTML = novoHtml;
        } else {
            // Se não existe (ex: carregou preço depois), insere após o ticker
            const tickerPill = card.querySelector('.ticker-pill');
            if (tickerPill) {
                const span = document.createElement('span');
                span.className = `profit-pill ${bgBadge}`;
                span.innerHTML = novoHtml;
                tickerPill.parentNode.insertBefore(span, tickerPill.nextSibling);
            }
        }
    }

    // 7. Atualiza HTML de Proventos (Re-inject)
    // Se for FII e tiver dados, recriamos o bloco de proventos para garantir status atualizado
    if (isFII(ativo.symbol) && dadoProvento) {
        const proventoContainer = card.querySelector('[data-field="provento-container"]');
        if (proventoContainer && dadoProvento.value > 0) {
            const parts = dadoProvento.paymentDate.split('-');
            const dataPag = new Date(parts[0], parts[1] - 1, parts[2]);
            const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
            const foiPago = dataPag <= hoje;
            
            let labelBadge = foiPago 
                ? `<span class="px-1.5 py-0.5 rounded-md bg-green-500/10 border border-green-500/20 text-[9px] font-bold text-green-400 uppercase tracking-wide">PAGO</span>`
                : `<span class="px-1.5 py-0.5 rounded-md bg-yellow-500/10 border border-yellow-500/20 text-[9px] font-bold text-yellow-400 uppercase tracking-wide">AGENDADO</span>`;
            
            let valorDisplay = proventoReceber > 0
                ? `<span class="text-base font-bold ${foiPago ? 'text-green-500' : 'text-yellow-500'}">+ ${formatBRL(proventoReceber)}</span>`
                : `<span class="text-xs font-bold text-orange-400">Sem direito</span>`;

            const dataComTexto = dadoProvento.dataCom ? formatDate(dadoProvento.dataCom) : '-';
            const dataPagTexto = formatDate(dadoProvento.paymentDate);

            proventoContainer.innerHTML = `
            <div class="mt-3 pt-3 border-t border-[#2C2C2E]">
                <div class="flex justify-between items-center mb-1">
                    <span class="text-[10px] text-gray-500 uppercase font-bold">Provento</span>
                    <span class="text-xs font-medium text-gray-300">${formatBRL(dadoProvento.value)}/cota</span>
                </div>
                <div class="flex justify-between items-center text-[10px] text-gray-500 mb-2">
                    <span>Com: ${dataComTexto}</span>
                    <span>Pag: ${dataPagTexto}</span>
                </div>
                <div class="flex justify-between items-center bg-[#151515] p-2 rounded-lg border border-[#2C2C2E]">
                    ${labelBadge}
                    ${valorDisplay}
                </div>
            </div>`;
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
	
	// --- MOVA ESTAS VARIÁVEIS PARA CÁ (TOPO) ---
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
    let detalhesChartInstance = null;
    let onConfirmCallback = null; 
    let precosAtuais = [];
    let proventosAtuais = [];
    let mesesProcessados = [];
    const todayString = new Date().toLocaleDateString('pt-BR', { year: 'numeric', month: 'long', day: 'numeric' });
    let lastAlocacaoData = null; 
    let lastHistoricoData = null;
    let lastPatrimonioData = null; 
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
    let lastNewsSignature = ''; 
    let lastProventosCalcSignature = ''; 
    let cachedSaldoCaixa = 0;
    // -------------------------------------------
    
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
    
	const btnNotifications = document.getElementById('btn-notifications');
    const notificationBadge = document.getElementById('notification-badge');
    const notificationsDrawer = document.getElementById('notifications-drawer');
    const notificationsList = document.getElementById('notifications-list');
    const notificationsEmpty = document.getElementById('notifications-empty');
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
    const toggleBioBtn = document.getElementById('toggle-bio-btn');
    const bioToggleKnob = document.getElementById('bio-toggle-knob'); 
    const bioStatusIcon = document.getElementById('bio-status-icon');
    const toggleThemeBtn = document.getElementById('toggle-theme-btn');
    const themeToggleKnob = document.getElementById('theme-toggle-knob');
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
	const listaHistoricoProventos = document.getElementById('lista-historico-proventos');
    const btnHistTransacoes = document.getElementById('btn-hist-transacoes');
    const btnHistProventos = document.getElementById('btn-hist-proventos');
    const detalhesFavoritoBtn = document.getElementById('detalhes-favorito-btn');
	const detalhesShareBtn = document.getElementById('detalhes-share-btn');
    const detalhesFavoritoIconEmpty = document.getElementById('detalhes-favorito-icon-empty'); 
    const detalhesFavoritoIconFilled = document.getElementById('detalhes-favorito-icon-filled');  
    const biometricLockScreen = document.getElementById('biometric-lock-screen');
    const btnDesbloquear = document.getElementById('btn-desbloquear');
    const btnSairLock = document.getElementById('btn-sair-lock');
    const installSection = document.getElementById('install-section');
    const installBtn = document.getElementById('install-app-btn');

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

function updateThemeUI() {
        const isLight = localStorage.getItem('vesto_theme') === 'light';
        const metaTheme = document.querySelector('meta[name="theme-color"]');
        
        // 1. Configurações Globais do Chart.js
        if (isLight) {
            document.body.classList.add('light-mode');
            if (metaTheme) metaTheme.setAttribute('content', '#f9fafb');
            
            Chart.defaults.color = '#374151'; 
            Chart.defaults.borderColor = 'transparent'; // Remove bordas globais
        } else {
            document.body.classList.remove('light-mode');
            if (metaTheme) metaTheme.setAttribute('content', '#000000');
            
            Chart.defaults.color = '#9ca3af'; 
            Chart.defaults.borderColor = 'transparent'; // Remove bordas globais
        }

        // Ajuste dos botões de Toggle de Tema
        if (toggleThemeBtn && themeToggleKnob) {
            if (isLight) {
                toggleThemeBtn.className = "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none bg-purple-600";
                themeToggleKnob.className = "inline-block h-4 w-4 transform rounded-full bg-white transition-transform translate-x-6";
            } else {
                toggleThemeBtn.className = "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none bg-gray-700";
                themeToggleKnob.className = "inline-block h-4 w-4 transform rounded-full bg-white transition-transform translate-x-1";
            }
        }

        // 2. Função para forçar atualização profunda nas instâncias já criadas
        const updateChartColors = (chart) => {
            if (!chart || !chart.options) return;

            const textColor = isLight ? '#374151' : '#9ca3af';
            const tooltipBg = isLight ? 'rgba(255, 255, 255, 0.95)' : 'rgba(28, 28, 30, 0.95)';
            const tooltipText = isLight ? '#1f2937' : '#f3f4f6';
            const tooltipBorder = isLight ? '#e5e7eb' : '#374151';
            const doughnutBorder = isLight ? '#ffffff' : '#000000'; 

            // REMOVE AS LINHAS DE GRADE (GRID LINES)
            if (chart.options.scales) {
                Object.keys(chart.options.scales).forEach(key => {
                    const scale = chart.options.scales[key];
                    if (scale.grid) {
                        scale.grid.display = false;    // Desliga a grade
                        scale.grid.drawBorder = false; // Desliga a linha do eixo
                        scale.grid.color = 'transparent';
                    }
                    if (scale.ticks) scale.ticks.color = textColor;
                });
            }

            // Atualiza Legendas
            if (chart.options.plugins && chart.options.plugins.legend && chart.options.plugins.legend.labels) {
                chart.options.plugins.legend.labels.color = textColor;
            }

            // Atualiza Tooltips
            if (chart.options.plugins && chart.options.plugins.tooltip) {
                chart.options.plugins.tooltip.backgroundColor = tooltipBg;
                chart.options.plugins.tooltip.titleColor = tooltipText;
                chart.options.plugins.tooltip.bodyColor = tooltipText;
                chart.options.plugins.tooltip.borderColor = tooltipBorder;
                chart.options.plugins.tooltip.borderWidth = 1;
            }

            // Borda do Gráfico de Rosca
            if (chart.config.type === 'doughnut') {
                if (chart.data.datasets[0]) {
                    chart.data.datasets[0].borderColor = doughnutBorder;
                }
            }

            chart.update();
        };

        // 3. Aplica a correção em todos os gráficos ativos
        if (typeof alocacaoChartInstance !== 'undefined') updateChartColors(alocacaoChartInstance);
        if (typeof patrimonioChartInstance !== 'undefined') updateChartColors(patrimonioChartInstance);
        if (typeof historicoChartInstance !== 'undefined') updateChartColors(historicoChartInstance);
        if (typeof detalhesChartInstance !== 'undefined') updateChartColors(detalhesChartInstance);
    }

    updateThemeUI();

    if (toggleThemeBtn) {
        toggleThemeBtn.addEventListener('click', () => {
            const current = localStorage.getItem('vesto_theme') === 'light';
            localStorage.setItem('vesto_theme', current ? 'dark' : 'light');
            updateThemeUI();
            
            if (typeof alocacaoChartInstance !== 'undefined' && alocacaoChartInstance) alocacaoChartInstance.update();
            if (typeof patrimonioChartInstance !== 'undefined' && patrimonioChartInstance) patrimonioChartInstance.update();
            if (typeof historicoChartInstance !== 'undefined' && historicoChartInstance) historicoChartInstance.update();
            if (typeof detalhesChartInstance !== 'undefined' && detalhesChartInstance) detalhesChartInstance.update();
        });
    }

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
                showToast('Biometria ativada com sucesso!', 'success');            }
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
        
        // Reset do Total
        document.getElementById('total-transacao-preview').textContent = "R$ 0,00";

        // Reset do Toggle para Compra
        const btnCompra = document.getElementById('btn-opt-compra');
        if(btnCompra) btnCompra.click(); // Simula clique para resetar animação e valor
        
        transacaoEmEdicao = null;
        tickerInput.disabled = false;
        addModalTitle.textContent = 'Nova Transação'; // Texto genérico melhor
        addButton.textContent = 'Salvar';
        
        // Remove erros visuais
        tickerInput.parentElement.classList.remove('ring-2', 'ring-red-500');
        // ...
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

// 2. SUBSTITUA A FUNÇÃO renderizarWatchlist ATUAL POR ESTA:
function renderizarWatchlist() {
    // 1. Apenas Carrossel Horizontal
    const carouselEl = document.getElementById('dashboard-favorites-list');
    if (!carouselEl) return;
    
    carouselEl.innerHTML = '';

    // Card de "Adicionar" se estiver vazio
    if (watchlist.length === 0) {
        carouselEl.innerHTML = `
            <div onclick="document.getElementById('carteira-search-input').focus(); mudarAba('tab-carteira');" class="fav-card border-dashed border-gray-700 cursor-pointer opacity-70">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-500 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
                <span class="text-[9px] text-gray-500 font-bold uppercase">Add</span>
            </div>`;
        return;
    }

    const precosMap = new Map(precosAtuais.map(p => [p.symbol, p]));

    watchlist.forEach(item => {
        const symbol = item.symbol;
        const dadoPreco = precosMap.get(symbol);
        
        // CORREÇÃO: Começa com vazio ('') em vez de '---'
        // Se não tiver preço carregado, ficará um espaço em branco limpo.
        let preco = ''; 
        if (dadoPreco) {
            preco = formatBRL(dadoPreco.regularMarketPrice);
        }

        const card = document.createElement('div');
        // Usa a classe CSS fav-card
        card.className = 'fav-card cursor-pointer group select-none relative';
        card.onclick = () => window.abrirDetalhesAtivo(symbol);

        // HTML LIMPO: Ticker Branco e Preço (ou vazio)
        card.innerHTML = `
            <div class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-purple-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
            
            <span class="text-[10px] font-bold text-white mb-0.5 tracking-wider uppercase">${symbol}</span>
            
            <span class="text-sm font-bold text-gray-300 tracking-tight">${preco}</span>
        `;
        carouselEl.appendChild(card);
    });
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
        const hojeString = hoje.toISOString().split('T')[0];

        const currentSignature = `${hojeString}-${proventosConhecidos.length}-${transacoes.length}`;

        if (currentSignature === lastProventosCalcSignature) {
            saldoCaixa = cachedSaldoCaixa;
            if (totalCaixaValor) totalCaixaValor.textContent = formatBRL(saldoCaixa);
            return;
        }

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
        cachedSaldoCaixa = novoSaldoCalculado;
        lastProventosCalcSignature = currentSignature;

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
            const symbol = t.symbol;
            let ativo = ativosMap.get(symbol) || { 
                symbol: symbol, quantity: 0, totalCost: 0, dataCompra: t.date
            };

            if (t.type === 'buy') {
                ativo.quantity += t.quantity;
                ativo.totalCost += t.quantity * t.price;
            } else if (t.type === 'sell') {
                // LÓGICA DE VENDA: Reduz quantidade e custo proporcional
                if (ativo.quantity > 0) {
                    const pmAtual = ativo.totalCost / ativo.quantity;
                    ativo.quantity -= t.quantity;
                    ativo.totalCost -= t.quantity * pmAtual;
                }
            }
            
            if (ativo.quantity < 0) { ativo.quantity = 0; ativo.totalCost = 0; }
            ativosMap.set(symbol, ativo);
        }
        
        carteiraCalculada = Array.from(ativosMap.values())
            .filter(a => a.quantity > 0.0001) // Remove o que foi zerado
            .map(a => ({
                symbol: a.symbol,
                quantity: a.quantity,
                precoMedio: a.quantity > 0 ? parseFloat((a.totalCost / a.quantity).toFixed(2)) : 0,
                dataCompra: a.dataCompra
            }));
    }

// Substitua a função inteira em app.js

// --- FUNÇÃO AUXILIAR PARA AGRUPAR POR MÊS ---
function agruparPorMes(itens, dateField) {
    const grupos = {};
    itens.forEach(item => {
        if (!item[dateField]) return;
        
        // Ajuste de fuso horário simples para garantir o mês correto
        const dataObj = new Date(item[dateField]);
        // Formata como "Dezembro 2025"
        const mesAno = dataObj.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        // Capitaliza a primeira letra
        const chave = mesAno.charAt(0).toUpperCase() + mesAno.slice(1);
        
        if (!grupos[chave]) grupos[chave] = [];
        grupos[chave].push(item);
    });
    return grupos;
}

// --- RENDERIZAR HISTÓRICO DE TRANSAÇÕES (VISUAL LIMPO E UNIFORME) ---
// Em app.js

// Substitua a função renderizarHistorico existente em app.js

function renderizarHistorico() {
    listaHistorico.innerHTML = '';
    
    if (transacoes.length === 0) {
        historicoStatus.classList.remove('hidden');
        return;
    }
    
    historicoStatus.classList.add('hidden');
    
    const transacoesOrdenadas = [...transacoes].sort((a, b) => new Date(b.date) - new Date(a.date));
    const grupos = agruparPorMes(transacoesOrdenadas, 'date');
    const fragment = document.createDocumentFragment();

    Object.keys(grupos).forEach(mes => {
        // 1. Header Sticky
        const header = document.createElement('div');
        header.className = 'history-header-sticky';
        
        const totalMes = grupos[mes].reduce((acc, t) => acc + (t.quantity * t.price), 0);
        
        header.innerHTML = `
            <h3 class="text-[11px] font-bold text-gray-300 uppercase tracking-widest flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 text-purple-500" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clip-rule="evenodd" /></svg>
                ${mes}
            </h3>
            <span class="text-[10px] font-mono font-medium text-gray-400 bg-neutral-900 px-2 py-0.5 rounded-md border border-neutral-800">
                Mov: ${formatBRL(totalMes)}
            </span>
        `;
        fragment.appendChild(header);

        // 2. Lista de Cards
        const listaGrupo = document.createElement('div');
        listaGrupo.className = 'px-3 pb-2'; 

        grupos[mes].forEach(t => {
            const isVenda = t.type === 'sell';
            const item = document.createElement('div');
            const totalTransacao = t.quantity * t.price;
            const dia = new Date(t.date).getDate().toString().padStart(2, '0');
            
            const labelTipo = isVenda ? 'VENDA' : 'COMPRA';
            const badgeBg = isVenda 
                ? 'bg-red-900/20 text-red-400 border border-red-500/20' 
                : 'bg-purple-900/20 text-purple-400 border border-purple-500/20';

            const sigla = t.symbol.substring(0, 2);

            // AQUI: Mudado de py-2.5 para py-3 (Aumenta levemente a altura interna)
            item.className = 'history-card flex items-center justify-between py-3 px-3 relative group';
            item.setAttribute('data-action', 'edit-row');
            item.setAttribute('data-id', t.id);

            item.innerHTML = `
                <div class="flex items-center gap-3 flex-1 min-w-0">
                    <div class="w-9 h-9 rounded-xl bg-[#151515] border border-[#2C2C2E] flex items-center justify-center flex-shrink-0">
                        <span class="text-[10px] font-bold text-gray-300 tracking-wider">${sigla}</span>
                    </div>
                    
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                            <h4 class="text-sm font-bold text-gray-200 tracking-tight leading-none">${t.symbol}</h4>
                            <span class="badge-type ${badgeBg}">${labelTipo}</span>
                        </div>
                        <div class="flex items-center gap-1.5 mt-1 text-[11px] text-gray-500 leading-none">
                            <span class="font-medium text-gray-400">Dia ${dia}</span>
                            <span>•</span>
                            <span>${t.quantity} cotas a ${formatBRL(t.price)}</span>
                        </div>
                    </div>
                </div>
                
                <div class="text-right flex flex-col items-end justify-center">
                    <span class="text-sm font-bold text-white tracking-tight">${formatBRL(totalTransacao)}</span>
                    
                    <button class="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-black/80 text-red-400 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" data-action="delete" data-id="${t.id}" data-symbol="${t.symbol}">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    </button>
                </div>
            `;
            listaGrupo.appendChild(item);
        });
        fragment.appendChild(listaGrupo);
    });
    listaHistorico.appendChild(fragment);
}

// Substitua a função renderizarHistoricoProventos existente em app.js

// Substitua a função renderizarHistoricoProventos existente em app.js

function renderizarHistoricoProventos() {
    listaHistoricoProventos.innerHTML = '';
    const hoje = new Date(); hoje.setHours(0,0,0,0);

    const proventosPagos = proventosConhecidos.filter(p => {
        if (!p.paymentDate) return false;
        const parts = p.paymentDate.split('-');
        const dPag = new Date(parts[0], parts[1]-1, parts[2]);
        return dPag <= hoje;
    }).sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));

    if (proventosPagos.length === 0) {
        listaHistoricoProventos.innerHTML = `
            <div class="flex flex-col items-center justify-center mt-12 opacity-50">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-gray-600 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p class="text-xs text-gray-500">Nenhum provento recebido ainda.</p>
            </div>`;
        return;
    }

    const grupos = agruparPorMes(proventosPagos, 'paymentDate');
    const fragment = document.createDocumentFragment();

    Object.keys(grupos).forEach(mes => {
        let totalMes = 0;
        grupos[mes].forEach(p => {
            const dataRef = p.dataCom || p.paymentDate;
            const qtd = getQuantidadeNaData(p.symbol, dataRef);
            if (qtd > 0) totalMes += (p.value * qtd);
        });

        const header = document.createElement('div');
        header.className = 'history-header-sticky';
        header.innerHTML = `
            <h3 class="text-[11px] font-bold text-gray-300 uppercase tracking-widest flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 text-green-500" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" /></svg>
                ${mes}
            </h3>
            <span class="text-[10px] font-mono font-medium text-gray-400 bg-neutral-900 px-2 py-0.5 rounded-md border border-neutral-800">
                Recebido: ${formatBRL(totalMes)}
            </span>
        `;
        fragment.appendChild(header);

        const listaGrupo = document.createElement('div');
        listaGrupo.className = 'px-3 pb-2'; 

        grupos[mes].forEach(p => {
            const dataRef = p.dataCom || p.paymentDate;
            const qtd = getQuantidadeNaData(p.symbol, dataRef);
            
            if (qtd > 0) {
                const total = p.value * qtd;
                const dia = new Date(p.paymentDate).getDate().toString().padStart(2, '0');
                const sigla = p.symbol.substring(0, 2);
                const badgeBg = 'bg-green-900/20 text-green-400 border border-green-500/20';

                const item = document.createElement('div');
                // AQUI: Mudado de py-2.5 para py-3
                item.className = 'history-card flex items-center justify-between py-3 px-3 relative group';

                item.innerHTML = `
                    <div class="flex items-center gap-3 flex-1 min-w-0">
                        <div class="w-9 h-9 rounded-xl bg-[#151515] border border-[#2C2C2E] flex items-center justify-center flex-shrink-0">
                            <span class="text-[10px] font-bold text-gray-300 tracking-wider">${sigla}</span>
                        </div>
                        
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2">
                                <h4 class="text-sm font-bold text-gray-200 tracking-tight leading-none">${p.symbol}</h4>
                                <span class="badge-type ${badgeBg}">PAGO</span>
                            </div>
                            <div class="flex items-center gap-1.5 mt-1 text-[11px] text-gray-500 leading-none">
                                <span class="font-medium text-gray-400">Dia ${dia}</span>
                                <span>•</span>
                                <span>${qtd} cotas</span>
                                <span>•</span>
                                <span>${formatBRL(p.value)}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="text-right flex flex-col items-end justify-center">
                        <span class="text-sm font-bold text-white tracking-tight">+ ${formatBRL(total)}</span>
                    </div>
                `;
                listaGrupo.appendChild(item);
            }
        });
        
        if (listaGrupo.children.length > 0) {
            fragment.appendChild(listaGrupo);
        }
    });

    listaHistoricoProventos.appendChild(fragment);
}

    // --- LISTENER DOS BOTÕES DE HISTÓRICO ---
// --- LISTENER DOS BOTÕES DE HISTÓRICO (TOGGLE ANIMADO) ---
    if (btnHistTransacoes && btnHistProventos) {
        const toggleBg = document.getElementById('historico-toggle-bg');

        btnHistTransacoes.addEventListener('click', () => {
            // Move a pílula para a esquerda (remove o translate)
            toggleBg.classList.remove('translate-x-full');
            
            // Ajusta as cores do texto
            btnHistTransacoes.classList.replace('text-gray-500', 'text-white');
            btnHistProventos.classList.replace('text-white', 'text-gray-500');
            
            // Troca o conteúdo da lista
            listaHistorico.classList.remove('hidden');
            listaHistoricoProventos.classList.add('hidden');
            renderizarHistorico();
        });

        btnHistProventos.addEventListener('click', () => {
            // Move a pílula para a direita (adiciona translate de 100% da largura dela)
            toggleBg.classList.add('translate-x-full');

            // Ajusta as cores do texto
            btnHistProventos.classList.replace('text-gray-500', 'text-white');
            btnHistTransacoes.classList.replace('text-white', 'text-gray-500');

            // Troca o conteúdo da lista
            listaHistorico.classList.add('hidden');
            listaHistoricoProventos.classList.remove('hidden');
            renderizarHistoricoProventos();
        });
    }

// --- FUNÇÃO AUXILIAR: Agrupar notícias por dia ---
// --- FUNÇÃO AUXILIAR: Agrupar notícias (Robusta contra Invalid Date) ---
function agruparNoticiasPorData(articles) {
    const grupos = {};
    const hoje = new Date();
    hoje.setHours(0,0,0,0);
    
    const ontem = new Date(hoje);
    ontem.setDate(ontem.getDate() - 1);

    articles.forEach(article => {
        // Tenta criar data. Se falhar, usa "DATA DESCONHECIDA" para não quebrar o app
        let d = new Date(article.publicationDate);
        if (isNaN(d.getTime())) {
            d = new Date(); // Fallback para hoje se a data for inválida
        }

        const dZero = new Date(d);
        dZero.setHours(0,0,0,0);

        let labelData = '';
        if (dZero.getTime() === hoje.getTime()) {
            labelData = 'HOJE';
        } else if (dZero.getTime() === ontem.getTime()) {
            labelData = 'ONTEM';
        } else {
            // Formata: "17 DE DEZEMBRO"
            labelData = d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' }).toUpperCase();
            // Adiciona ano se não for o ano atual
            if (d.getFullYear() !== hoje.getFullYear()) {
                labelData += ` DE ${d.getFullYear()}`;
            }
        }

        if (!grupos[labelData]) grupos[labelData] = [];
        grupos[labelData].push(article);
    });
    return grupos;
}

// --- RENDERIZAR NOTÍCIAS (VISUAL IDÊNTICO AO HISTÓRICO) ---
// --- RENDERIZAR NOTÍCIAS (AJUSTES FINAIS: TAMANHO, BORDAS E COR) ---
function renderizarNoticias(articles) { 
    fiiNewsSkeleton.classList.add('hidden');
    
    const newSignature = JSON.stringify(articles);
    if (newSignature === lastNewsSignature && fiiNewsList.children.length > 0) {
        return;
    }
    lastNewsSignature = newSignature;

    fiiNewsList.innerHTML = ''; 
    fiiNewsMensagem.classList.add('hidden');

    if (!articles || articles.length === 0) {
        fiiNewsMensagem.textContent = 'Nenhuma notícia recente encontrada.';
        fiiNewsMensagem.classList.remove('hidden');
        return;
    }
    
    const sortedArticles = [...articles].sort((a, b) => new Date(b.publicationDate) - new Date(a.publicationDate));
    const grupos = agruparNoticiasPorData(sortedArticles);
    
    const fragment = document.createDocumentFragment();
    let isGlobalFirstItem = true;

    Object.keys(grupos).forEach(dataLabel => {
        // Header
        const header = document.createElement('div');
        header.className = 'sticky top-0 z-10 bg-black/95 backdrop-blur-md py-3 px-1 border-b border-neutral-800 mb-2';
        header.innerHTML = `<h3 class="text-xs font-bold text-neutral-400 uppercase tracking-widest pl-1">${dataLabel}</h3>`;
        fragment.appendChild(header);

        // Lista
        const listaGrupo = document.createElement('div');
        listaGrupo.className = 'mb-8';

        grupos[dataLabel].forEach((article, index) => {
            const sourceName = article.sourceName || 'Fonte';
            const faviconUrl = article.favicon || `https://www.google.com/s2/favicons?domain=${article.sourceHostname || 'google.com'}&sz=64`;
            let horaPub = '';
            try { horaPub = new Date(article.publicationDate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute:'2-digit' }); } catch(e) { horaPub = '--:--'; }
            const safeLabel = dataLabel.replace(/[^a-zA-Z0-9]/g, '');
            const drawerId = `news-drawer-${safeLabel}-${index}`;
            
            // Tickers
            const tickerRegex = /[A-Z]{4}11/g;
            const foundTickers = [...new Set(article.title.match(tickerRegex) || [])];
            let tickersHtml = '';
            if (foundTickers.length > 0) {
                foundTickers.forEach(ticker => {
                    tickersHtml += `<span class="news-ticker-tag text-[10px] py-0.5 px-2 bg-neutral-800 text-neutral-400 rounded-md border border-neutral-700 mr-2 mb-1 inline-block" data-action="view-ticker" data-symbol="${ticker}">${ticker}</span>`;
                });
            }

            const item = document.createElement('div');
            
            // --- ESTILOS ---
            let itemWrapperClass = 'group relative transition-all news-card-interactive ';
            let titleClass = 'font-bold text-gray-100 leading-snug mb-2 group-hover:text-white transition-colors ';
            let badgeDestaque = '';

            if (isGlobalFirstItem) {
                // DESTAQUE (Ajustado para ser menor)
                itemWrapperClass += 'bg-gradient-to-r from-purple-900/30 to-transparent border-l-[3px] border-purple-500 py-1 my-2 rounded-r-lg';
                // Mudado de text-lg para text-base (diminuiu um pouco)
                titleClass += 'text-base'; 
                badgeDestaque = '<span class="inline-block bg-purple-600 text-white text-[9px] font-bold uppercase tracking-wider px-1.5 py-[2px] rounded-sm mb-2">Destaque</span>';
                isGlobalFirstItem = false;
            } else {
                // NORMAL
                itemWrapperClass += 'border-b border-neutral-800 last:border-0 hover:bg-neutral-900/40';
                titleClass += 'text-sm';
            }

            item.className = itemWrapperClass;
            item.setAttribute('data-action', 'toggle-news');
            item.setAttribute('data-target', drawerId);

            item.innerHTML = `
                <div class="flex items-start gap-4 py-4 px-3 cursor-pointer">
                    <div class="flex-shrink-0 mt-1.5">
                        <img src="${faviconUrl}" alt="${sourceName}" 
                             class="w-10 h-10 rounded-2xl bg-[#1C1C1E] object-contain p-0.5 border border-neutral-800 transition-all"
                             loading="lazy"
                             onerror="this.src='https://www.google.com/s2/favicons?domain=google.com&sz=64';" 
                        />
                    </div>
                    
                    <div class="flex-1 min-w-0 pointer-events-none">
                        ${badgeDestaque}
                        <div class="flex items-center gap-2 mb-1.5">
                            <span class="text-[10px] font-bold uppercase tracking-wider text-neutral-500">${sourceName}</span>
                            <span class="text-[10px] text-neutral-600">•</span>
                            <span class="text-[10px] text-neutral-500">${horaPub}</span>
                        </div>
                        
                        <h4 class="${titleClass}">
                            ${article.title || 'Título indisponível'}
                        </h4>
                        
                        <div class="pointer-events-auto mt-2">
                            ${tickersHtml ? `<div class="flex flex-wrap">${tickersHtml}</div>` : ''}
                        </div>
                    </div>

                    <div class="text-neutral-600 group-hover:text-neutral-400 mt-2 transition-colors">
                         <svg class="card-arrow-icon w-5 h-5 transition-transform duration-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                        </svg>
                    </div>
                </div>
                
                <div id="${drawerId}" class="card-drawer">
                    <div class="drawer-content px-3 pb-5 pl-14">
                        <div class="text-sm text-neutral-400 leading-relaxed border-l-2 border-neutral-700 pl-4">
                            ${article.summary ? article.summary : 'Resumo não disponível.'}
                        </div>
                        <div class="mt-4 pl-4">
                            <a href="${article.link}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-xs font-bold text-purple-400 hover:text-purple-300 transition-colors bg-purple-500/10 px-3 py-1.5 rounded-md">
                                Ler notícia completa
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                            </a>
                        </div>
                    </div>
                </div>
            `;
            listaGrupo.appendChild(item);
        });
        fragment.appendChild(listaGrupo);
    });
    
    fiiNewsList.appendChild(fragment);
}

// --- RENDERIZAR GRÁFICO DE ALOCAÇÃO (VISUAL PREMIUM / ROXOS) ---
// --- RENDERIZAR GRÁFICO DE ALOCAÇÃO (ANEL MAIS GROSSO E MAIOR) ---
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
    
    // Ordena do maior para o menor
    dadosGrafico.sort((a, b) => b.totalPosicao - a.totalPosicao);

    const labels = dadosGrafico.map(d => d.symbol);
    const data = dadosGrafico.map(d => d.totalPosicao);
    const newDataString = JSON.stringify({ labels, data });

    if (newDataString === lastAlocacaoData) { return; }
    lastAlocacaoData = newDataString; 
    
    // PALETA VESTO PREMIUM (Roxos/Violetas)
    const gerarPaletaPremium = (num) => {
        const coresBase = [
            '#7c3aed', // Violet 600
            '#a855f7', // Purple 500
            '#4c1d95', // Violet 900
            '#c084fc', // Purple 400
            '#5b21b6', // Violet 800
            '#e879f9', // Fuchsia 400
            '#2e1065', // Violet 950
            '#8b5cf6', // Violet 500
            '#6366f1', // Indigo 500
            '#312e81'  // Indigo 900
        ];
        let cores = [];
        for (let i = 0; i < num; i++) {
            cores.push(coresBase[i % coresBase.length]);
        }
        return cores;
    };

    const colors = gerarPaletaPremium(labels.length);

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
                    borderWidth: 3, // Borda um pouco mais fina para não "comer" o gráfico
                    borderColor: '#000000', 
                    hoverOffset: 4 
                }] 
            },
            options: {
                responsive: true, 
                maintainAspectRatio: false,
                // ALTERAÇÃO: 60% deixa o anel mais grosso (era 75%)
                cutout: '60%', 
                layout: {
                    // ALTERAÇÃO: Padding 0 faz o gráfico ocupar todo o espaço disponível
                    padding: 10
                },
                plugins: {
                    legend: { 
                        display: true, 
                        position: 'bottom', // Mudei para a direita para ganhar altura vertical
                        labels: { 
                            color: '#9ca3af', 
                            boxWidth: 8, 
                            boxHeight: 8,
                            padding: 15,
                            usePointStyle: true, 
                            font: { size: 10 }
                        } 
                    },
                    tooltip: {
                        backgroundColor: '#1C1C1E',
                        titleColor: '#fff',
                        bodyColor: '#e5e7eb',
                        borderColor: '#374151',
                        borderWidth: 1,
                        padding: 10,
                        cornerRadius: 8,
                        callbacks: {
                            label: function(context) {
                                const label = context.label || '';
                                const value = context.parsed || 0;
                                const total = context.chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
                                const percent = ((value / total) * 100).toFixed(1);
                                return ` ${label}: ${percent}%`;
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
        const dataValor = patrimonio.map(p => p.value);
    
    
        const dataCusto = patrimonio.map(p => {
            const dataSnapshot = new Date(p.date + 'T23:59:59');
            
            const transacoesAteData = transacoes.filter(t => new Date(t.date) <= dataSnapshot);
            
            const carteiraTemp = new Map();
            
            transacoesAteData.sort((a, b) => new Date(a.date) - new Date(b.date)).forEach(t => {
                let ativo = carteiraTemp.get(t.symbol) || { qtd: 0, custoTotal: 0 };
                
                if (t.type === 'buy') {
                    ativo.qtd += t.quantity;
                    ativo.custoTotal += (t.quantity * t.price);
                } else if (t.type === 'sell' && ativo.qtd > 0) {
                    const precoMedio = ativo.custoTotal / ativo.qtd;
                    ativo.qtd -= t.quantity;
                    ativo.custoTotal -= (t.quantity * precoMedio);
                }
                carteiraTemp.set(t.symbol, ativo);
            });

            let custoTotalDia = 0;
            carteiraTemp.forEach(ativo => {
                if (ativo.qtd > 0) custoTotalDia += ativo.custoTotal;
            });
            
            return custoTotalDia;
        });

        const newDataString = JSON.stringify({ labels, dataValor, dataCusto });

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
            patrimonioChartInstance.data.datasets[0].data = dataValor;
            
            if (patrimonioChartInstance.data.datasets[1]) {
                patrimonioChartInstance.data.datasets[1].data = dataCusto;
            } else {
                patrimonioChartInstance.data.datasets.push({
                    label: 'Custo Total',
                    data: dataCusto,
                    borderColor: '#6b7280',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    fill: false,
                    tension: 0.1
                });
            }
            patrimonioChartInstance.update();
        } else {
            patrimonioChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: 'Patrimônio',
                            data: dataValor,
                            fill: true,
                            backgroundColor: gradient,
                            borderColor: '#c084fc',
                            tension: 0.3,
                            pointRadius: 3, 
                            pointBackgroundColor: '#c084fc', 
                            pointHitRadius: 15, 
                            pointHoverRadius: 5 
                        },
                        {
                            label: 'Custo Investido',
                            data: dataCusto,
                            fill: false,
                            borderColor: '#6b7280',
                            borderWidth: 2,
                            borderDash: [5, 5],
                            tension: 0.3,
                            pointRadius: 0,
                            pointHoverRadius: 4
                        }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    interaction: {
                        mode: 'index',
                        intersect: false,
                    },
                    plugins: {
                        legend: { 
                            display: true,
                            labels: { color: '#9ca3af', boxWidth: 12, usePointStyle: true }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            titleColor: '#fff',
                            bodyColor: '#fff',
                            borderColor: '#374151',
                            borderWidth: 1,
                            callbacks: {
                                label: (context) => {
                                    return `${context.dataset.label}: ${formatBRL(context.parsed.y)}`;
                                }
                            }
                        }
                    },
                    scales: {
                        y: { 
                            beginAtZero: false, 
                            ticks: { 
                                display: true,
                                color: '#4b5563',
                                font: { size: 10 },
                                callback: function(value) { return value >= 1000 ? `${value/1000}k` : value; }
                            }, 
                            grid: { color: '#2A2A2A' } 
                        },
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
        // Se a lista estiver vazia (primeiro load), usamos o skeleton genérico
        if (listaCarteira.children.length === 0 && show) {
            skeletonListaCarteira.classList.remove('hidden');
            return;
        }

        // Se já tem cards, aplicamos o efeito neles
        skeletonListaCarteira.classList.add('hidden'); // Garante que o genérico suma
        listaCarteira.classList.remove('hidden');      // Garante que a lista real apareça

        const cards = listaCarteira.querySelectorAll('.wallet-card');
        
        cards.forEach(card => {
            // Selecionamos apenas os elementos que vão mudar de valor
            const camposDinamicos = card.querySelectorAll(`
                [data-field="preco-valor"], 
                [data-field="variacao-valor"], 
                [data-field="posicao-valor"], 
                [data-field="custo-valor"], 
                [data-field="pl-valor"],
                [data-field="pl-tag"] span  /* Pega o span dentro da tag */
            `);

            camposDinamicos.forEach(el => {
                if (show) {
                    el.classList.add('skeleton-text');
                    // Opcional: Se quiser limpar o texto antigo imediatamente
                    // el.dataset.oldText = el.textContent; 
                    // el.textContent = ''; 
                } else {
                    el.classList.remove('skeleton-text');
                }
            });
        });
    }
    
function getQuantidadeNaData(symbol, dataLimiteStr) {
        if (!dataLimiteStr) return 0;
        
        // Define o limite como o final do dia da "Data Com"
        const dataLimite = new Date(dataLimiteStr + 'T23:59:59');

        return transacoes.reduce((total, t) => {
            // Verifica se é o mesmo ativo
            if (t.symbol === symbol) {
                const dataTransacao = new Date(t.date);
                
                // Só considera transações feitas ATÉ a data limite (Data Com)
                if (dataTransacao <= dataLimite) {
                    if (t.type === 'buy') {
                        return total + t.quantity;
                    } else if (t.type === 'sell') {
                        // CORREÇÃO: Subtrai a quantidade se for venda
                        return total - t.quantity;
                    }
                }
            }
            return total;
        }, 0);
    }

async function renderizarCarteira() {
    // Esconde os skeletons de carregamento
    renderizarCarteiraSkeletons(false);

    // Cria Mapas para acesso rápido a preços e proventos
    const precosMap = new Map(precosAtuais.map(p => [p.symbol, p]));
    const proventosOrdenados = [...proventosAtuais].sort((a, b) => new Date(a.paymentDate) - new Date(b.paymentDate));
    const proventosMap = new Map(proventosOrdenados.map(p => [p.symbol, p]));
    
    // Ordena a carteira alfabeticamente
    const carteiraOrdenada = [...carteiraCalculada].sort((a, b) => a.symbol.localeCompare(b.symbol));

    let totalValorCarteira = 0;
    let totalCustoCarteira = 0;
    let dadosGrafico = [];

    // PASS 1: Calcular totais globais da carteira (necessário para a % de alocação)
    carteiraOrdenada.forEach(ativo => {
        const dadoPreco = precosMap.get(ativo.symbol);
        const precoAtual = dadoPreco ? (dadoPreco.regularMarketPrice ?? 0) : 0;
        
        totalValorCarteira += (precoAtual * ativo.quantity);
        totalCustoCarteira += (ativo.precoMedio * ativo.quantity);
    });

    // Verifica se a carteira está vazia
    if (carteiraOrdenada.length === 0) {
        listaCarteira.innerHTML = ''; 
        carteiraStatus.classList.remove('hidden');
        renderizarDashboardSkeletons(false);
        
        // Zera os valores do Dashboard
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

    // Limpeza de cards que foram removidos (Garbage Collection visual)
    const symbolsNaCarteira = new Set(carteiraOrdenada.map(a => a.symbol));
    const cardsNaTela = listaCarteira.querySelectorAll('[data-symbol]');
    cardsNaTela.forEach(card => {
        const symbol = card.dataset.symbol;
        if (!symbolsNaCarteira.has(symbol)) {
            card.remove();
        }
    });

    // PASS 2: Renderizar ou Atualizar cada Card
    carteiraOrdenada.forEach((ativo, index) => { 
        const dadoPreco = precosMap.get(ativo.symbol);
        const dadoProvento = proventosMap.get(ativo.symbol);

        // Dados de Mercado
        let precoAtual = 0, variacao = 0;
        let precoFormatado = 'N/A', variacaoFormatada = '0.00%', corVariacao = 'text-gray-500';
        
        if (dadoPreco) {
            precoAtual = dadoPreco.regularMarketPrice ?? 0;
            variacao = dadoPreco.regularMarketChangePercent ?? 0;
            precoFormatado = formatBRL(precoAtual);
            variacaoFormatada = formatPercent(variacao);
            corVariacao = variacao > 0 ? 'text-green-500' : (variacao < 0 ? 'text-red-500' : 'text-gray-500');
        } else {
            precoFormatado = '...';
            corVariacao = 'text-yellow-500';
        }
        
        // Cálculos Financeiros do Ativo
        const totalPosicao = precoAtual * ativo.quantity;
        const custoTotal = ativo.precoMedio * ativo.quantity;
        const lucroPrejuizo = totalPosicao - custoTotal;
        const lucroPrejuizoPercent = (custoTotal === 0 || totalPosicao === 0) ? 0 : (lucroPrejuizo / custoTotal) * 100;
        
        // Cálculo da Alocação (%)
        const percentWallet = totalValorCarteira > 0 ? (totalPosicao / totalValorCarteira) * 100 : 0;

        // Estilos de Lucro/Prejuízo
        let corPL = 'text-gray-500';
        if (lucroPrejuizo > 0.01) { corPL = 'text-green-500'; }
        else if (lucroPrejuizo < -0.01) { corPL = 'text-red-500'; }

        // Proventos Futuros
        let proventoReceber = 0;
        if (dadoProvento && dadoProvento.value > 0) {
             const dataReferencia = dadoProvento.dataCom || dadoProvento.paymentDate;
             const qtdElegivel = getQuantidadeNaData(ativo.symbol, dataReferencia);
             proventoReceber = qtdElegivel * dadoProvento.value;
        }

        const dadosRender = {
            dadoPreco, precoFormatado, variacaoFormatada, corVariacao,
            totalPosicao, custoTotal, lucroPrejuizo, lucroPrejuizoPercent,
            corPL, dadoProvento, proventoReceber, percentWallet
        };

        // Popula dados para o gráfico de rosca
        if (totalPosicao > 0) { 
            dadosGrafico.push({ symbol: ativo.symbol, totalPosicao: totalPosicao }); 
        }

        // DOM: Cria ou Atualiza
        let card = listaCarteira.querySelector(`[data-symbol="${ativo.symbol}"]`);
        
        if (card) {
            atualizarCardElemento(card, ativo, dadosRender);
        } else {
            card = criarCardElemento(ativo, dadosRender);
            
            // Animação de entrada (Stagger)
            card.classList.add('card-stagger');
            const delay = Math.min(index * 50, 500); 
            card.style.animationDelay = `${delay}ms`;
            
            card.addEventListener('animationend', () => {
                card.classList.remove('card-stagger');
                card.style.animationDelay = '';
                card.style.opacity = '1';
            }, { once: true });
            
            listaCarteira.appendChild(card);
        }
    });

    // Atualiza Totais do Dashboard
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
        
        // Salva Snapshot para o gráfico de histórico
        const patrimonioRealParaSnapshot = patrimonioTotalAtivos + saldoCaixa; 
        await salvarSnapshotPatrimonio(patrimonioRealParaSnapshot);
    }
    
    // Renderiza Gráficos
    renderizarGraficoAlocacao(dadosGrafico);
    renderizarGraficoPatrimonio();
    
    // Filtro de Busca (caso o usuário esteja digitando)
    if (carteiraSearchInput && carteiraSearchInput.value) {
        const term = carteiraSearchInput.value.trim().toUpperCase();
        const cards = listaCarteira.querySelectorAll('.wallet-card'); // Atualizado class name
        cards.forEach(card => {
            const symbol = card.dataset.symbol;
            if (symbol && symbol.includes(term)) {
                card.classList.remove('hidden');
            } else {
                card.classList.add('hidden');
            }
        });
    }
}

    function renderizarProventos() {
        let totalEstimado = 0;
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        
        proventosAtuais.forEach(provento => {
            if (provento && typeof provento.value === 'number' && provento.value > 0) {
                 const parts = provento.paymentDate.split('-');
                 const dataPagamento = new Date(parts[0], parts[1] - 1, parts[2]);

                 if (dataPagamento > hoje) {
                     const dataReferencia = provento.dataCom || provento.paymentDate;
                     const qtdElegivel = getQuantidadeNaData(provento.symbol, dataReferencia);
                     
                     if (qtdElegivel > 0) {
                         totalEstimado += (qtdElegivel * provento.value);
                     }
                 }
            }
        });
        totalProventosEl.textContent = formatBRL(totalEstimado);
    }

    async function handleAtualizarNoticias(force = false) {
        const cacheKey = 'noticias_json_v5_filtered';
        
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
            const articles = await fetchAndCacheNoticiasBFF_NetworkOnly(cacheKey);
            renderizarNoticias(articles);
        } catch (e) {
            console.error("Erro ao buscar notícias (função separada):", e);
            fiiNewsSkeleton.classList.add('hidden');
            fiiNewsMensagem.textContent = 'Erro ao carregar notícias. Tente novamente.';
            fiiNewsMensagem.classList.remove('hidden');
        } finally {
            refreshIcon.classList.remove('spin-animation');
        }
    }

    async function fetchAndCacheNoticiasBFF_NetworkOnly(cacheKey) {
        await vestoDB.delete('apiCache', cacheKey);
        
        try {
            const url = `/api/news?t=${Date.now()}`;
            const response = await fetchBFF(url, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });
            const articles = response; 
            
            if (articles && Array.isArray(articles) && articles.length > 0) {
                await setCache(cacheKey, articles, CACHE_NOTICIAS);
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
                const errorBody = await response.json().catch(() => ({}));
                throw new Error(errorBody.error || `Erro do servidor: ${response.statusText}`);
            }
            return response.json();
        } catch (error) {
            if (error.name === 'AbortError') {
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

    function processarProventosScraper(proventosScraper = []) {
        const hoje = new Date(); 
        hoje.setHours(0, 0, 0, 0);
        const dataLimitePassado = new Date();
        dataLimitePassado.setDate(hoje.getDate() - 45);
        dataLimitePassado.setHours(0, 0, 0, 0);

        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

        return proventosScraper
            .map(provento => {
                const ativoCarteira = carteiraCalculada.find(a => a.symbol === provento.symbol);
                if (!ativoCarteira) return null;
                
                if (provento.paymentDate && typeof provento.value === 'number' && provento.value > 0 && dateRegex.test(provento.paymentDate)) {
                    const parts = provento.paymentDate.split('-');
                    const dataPagamento = new Date(parts[0], parts[1] - 1, parts[2]); 
                    
                    if (!isNaN(dataPagamento) && dataPagamento >= dataLimitePassado) {
                        return provento;
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
                const novosProventos = await callScraperProventosCarteiraAPI(fiisParaBuscar);
                
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
                console.error("Erro ao buscar novos proventos com Scraper:", error);
            }
        }
        
        return processarProventosScraper(proventosPool); 
    }
	async function callScraperProximoProventoAPI(ticker) {
        const body = { mode: 'proximo_provento', payload: { ticker } };
        const response = await fetchBFF('/api/scraper', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return response.json; 
    }
	
	async function callScraperFundamentosAPI(ticker) {
        const body = { 
            mode: 'fundamentos', 
            payload: { ticker } 
        };
        const response = await fetchBFF('/api/scraper', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return response.json;
    }

    async function buscarHistoricoProventosAgregado(force = false) {
        const fiiNaCarteira = carteiraCalculada.filter(a => isFII(a.symbol));
        if (fiiNaCarteira.length === 0) return { labels: [], data: [] };

        const fiiSymbols = fiiNaCarteira.map(a => a.symbol);
        const cacheKey = `cache_grafico_historico_${currentUserId}`;
        
        if (force) {
            await vestoDB.delete('apiCache', cacheKey);
        }
        
        let rawDividends = await getCache(cacheKey);

        if (!rawDividends) {
            try {
                rawDividends = await callScraperHistoricoPortfolioAPI(fiiSymbols);
                if (rawDividends && rawDividends.length > 0) {
                    await setCache(cacheKey, rawDividends, CACHE_IA_HISTORICO);
                }
            } catch (e) {
                console.error("Erro ao buscar histórico agregado:", e);
                return { labels: [], data: [] }; 
            }
        }

        if (!rawDividends || rawDividends.length === 0) return { labels: [], data: [] };

        const aggregator = {};

        rawDividends.forEach(item => {
            const dataVisualizacao = item.paymentDate || item.dataCom;
            const dataDireito = item.dataCom || item.paymentDate;
            
            if (dataVisualizacao) {
                const [ano, mes] = dataVisualizacao.split('-'); 
                const chaveMes = `${mes}/${ano.substring(2)}`; 
                
                const qtdNaData = getQuantidadeNaData(item.symbol, dataDireito);

                if (qtdNaData > 0) {
                    if (!aggregator[chaveMes]) aggregator[chaveMes] = 0;
                    aggregator[chaveMes] += (item.value * qtdNaData);
                }
            }
        });

        const labels = Object.keys(aggregator).sort((a, b) => {
            const [mesA, anoA] = a.split('/');
            const [mesB, anoB] = b.split('/');
            return new Date(`20${anoA}-${mesA}-01`) - new Date(`20${anoB}-${mesB}-01`);
        });

        const data = labels.map(label => aggregator[label]);

        return { labels, data };
    }
    
// --- FUNÇÃO AUXILIAR: GERENCIAR NOTIFICAÇÕES EXCLUÍDAS ---
function isNotificationDismissed(id) {
    const dismissed = JSON.parse(localStorage.getItem('vesto_dismissed_notifs') || '[]');
    return dismissed.includes(id);
}

function dismissNotification(id, element) {
    // 1. Salva no navegador para não voltar mais
    const dismissed = JSON.parse(localStorage.getItem('vesto_dismissed_notifs') || '[]');
    if (!dismissed.includes(id)) {
        dismissed.push(id);
        localStorage.setItem('vesto_dismissed_notifs', JSON.stringify(dismissed));
    }
    
    // 2. Animação visual de saída
    element.style.transition = 'opacity 0.3s, transform 0.3s';
    element.style.opacity = '0';
    element.style.transform = 'translateX(20px)';
    
    setTimeout(() => {
        element.remove();
        // Se a lista ficou vazia, esconde o badge
        const list = document.getElementById('notifications-list');
        if (!list || list.children.length === 0) {
            document.getElementById('notification-badge').classList.add('hidden');
            document.getElementById('notifications-empty').classList.remove('hidden');
        }
    }, 300);
}

// --- FUNÇÃO PRINCIPAL CORRIGIDA ---
// --- FUNÇÃO DE NOTIFICAÇÕES (VISUAL REMODELADO + LÓGICA MANTIDA) ---
function verificarNotificacoesFinanceiras() {
    const list = document.getElementById('notifications-list');
    const badge = document.getElementById('notification-badge');
    const emptyState = document.getElementById('notifications-empty');
    const btnNotif = document.getElementById('btn-notifications');

    // 1. Limpeza
    list.innerHTML = '';
    let temNotificacao = false;

    // 2. Datas para comparação (Mesma lógica do seu código)
    const hoje = new Date();
    const offset = hoje.getTimezoneOffset() * 60000;
    const hojeLocal = new Date(hoje.getTime() - offset).toISOString().split('T')[0];
    const hojeDateObj = new Date(hojeLocal + 'T00:00:00'); 

    // --- HELPER DE RENDERIZAÇÃO (NOVO DESIGN) ---
    const renderNotificationItem = (id, type, title, message, highlightColor) => {
        const div = document.createElement('div');
        
        // Configuração de Estilos por Tipo
        let iconSvg = '';
        let gradientClass = '';
        let bgIconClass = '';
        
        if (type === 'payment') { // Verde (Pagamento)
            gradientClass = 'from-green-500 to-emerald-700';
            bgIconClass = 'text-green-500 bg-green-500/10 border-green-500/20';
            iconSvg = `<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />`;
        } else if (type === 'datacom') { // Amarelo (Data Com)
            gradientClass = 'from-amber-400 to-orange-600';
            bgIconClass = 'text-amber-500 bg-amber-500/10 border-amber-500/20';
            iconSvg = `<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />`;
        } else { // Azul (Novo Anúncio)
            gradientClass = 'from-blue-400 to-indigo-600';
            bgIconClass = 'text-blue-500 bg-blue-500/10 border-blue-500/20';
            iconSvg = `<path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />`;
        }

        // Estrutura HTML Nova (Card Neon)
        div.className = 'relative group overflow-hidden rounded-2xl bg-[#151515] border border-[#2C2C2E] p-3 transition-all hover:bg-[#1A1A1A] hover:border-neutral-700';
        div.innerHTML = `
            <div class="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b ${gradientClass}"></div>
            
            <div class="flex items-start gap-3 pl-2">
                <div class="w-8 h-8 rounded-lg ${bgIconClass} border flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        ${iconSvg}
                    </svg>
                </div>
                
                <div class="flex-1 min-w-0">
                    <p class="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-0.5">${title}</p>
                    <div class="text-sm text-gray-300 leading-snug">
                        ${message}
                    </div>
                </div>

                <button class="text-gray-700 hover:text-white transition-colors p-1 -mt-1 -mr-1" onclick="window.dismissNotificationGlobal('${id}', this)">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>
        `;
        return div;
    };

    // Helper de Props (Mantido)
    const getProps = (p) => ({
        paymentDate: p.paymentDate || p.paymentdate,
        dataCom: p.dataCom || p.datacom,
        createdAt: p.created_at || new Date().toISOString()
    });

    // --- 1. PAGAMENTOS (Verde) ---
    const pagamentosHoje = proventosConhecidos.filter(p => {
        const props = getProps(p);
        return props.paymentDate === hojeLocal;
    });

    pagamentosHoje.forEach(p => {
        const notifId = `pay_${p.id || p.symbol + Date.now()}`;
        if (isNotificationDismissed(notifId)) return;

        const props = getProps(p);
        const qtd = getQuantidadeNaData(p.symbol, props.dataCom || props.paymentDate);
        
        if (qtd > 0) {
            temNotificacao = true;
            const totalRecebido = p.value * qtd;
            // Mensagem com HTML injetado
            const msg = `<span class="text-white font-bold">${p.symbol}</span> pagou <span class="text-green-400 font-bold">${formatBRL(totalRecebido)}</span>.`;
            
            const card = renderNotificationItem(notifId, 'payment', 'Pagamento Recebido', msg);
            list.appendChild(card);
        }
    });

    // --- 2. DATA COM (Amarelo) ---
    const dataComHoje = proventosConhecidos.filter(p => {
        const props = getProps(p);
        return props.dataCom === hojeLocal;
    });
    
    dataComHoje.forEach(p => {
        const notifId = `com_${p.id || p.symbol + 'com'}`;
        if (isNotificationDismissed(notifId)) return;

        temNotificacao = true;
        const msg = `Garanta <span class="text-amber-400 font-bold">${formatBRL(p.value)}</span>/cota de <span class="text-white font-bold">${p.symbol}</span> até hoje.`;
        
        const card = renderNotificationItem(notifId, 'datacom', 'Data Com (Limite)', msg);
        list.appendChild(card);
    });

    // --- 3. NOVOS ANÚNCIOS (Azul) - LÓGICA CRÍTICA MANTIDA ---
    const novosAnuncios = proventosConhecidos.filter(p => {
        const props = getProps(p);
        
        // Mesma lógica de validação que você enviou:
        const dataCriacao = props.createdAt.split('T')[0];
        const isCreatedToday = dataCriacao === hojeLocal;
        const isNotDuplicate = props.paymentDate !== hojeLocal && props.dataCom !== hojeLocal;
        
        if (!props.paymentDate) return false;
        const dataPagamentoObj = new Date(props.paymentDate + 'T00:00:00');
        const isFuturo = dataPagamentoObj >= hojeDateObj;

        return isCreatedToday && isNotDuplicate && isFuturo;
    });

    novosAnuncios.forEach(p => {
        const notifId = `news_${p.id}`;
        if (isNotificationDismissed(notifId)) return;

        temNotificacao = true;
        const msg = `<span class="text-white font-bold">${p.symbol}</span> anunciou <span class="text-blue-400 font-bold">${formatBRL(p.value)}</span> p/ ${formatDate(getProps(p).paymentDate)}.`;

        const card = renderNotificationItem(notifId, 'news', 'Novo Anúncio', msg);
        list.appendChild(card);
    });

    // Atualiza badges
    if (temNotificacao) {
        badge.classList.remove('hidden');
        btnNotif.classList.add('bell-ringing');
        emptyState.classList.add('hidden');
    } else {
        badge.classList.add('hidden');
        btnNotif.classList.remove('bell-ringing');
        emptyState.classList.remove('hidden');
    }
}
	
async function atualizarTodosDados(force = false) { 

        if (force) {
            // 1. Feedback Tátil (Vibração leve em Android)
            if (navigator.vibrate) navigator.vibrate(50);

            // 2. Feedback Visual (Mostra os esqueletos de carregamento)
            renderizarDashboardSkeletons(true);
            renderizarCarteiraSkeletons(true);
            
            // Opcional: Esconder status antigos enquanto carrega
            dashboardStatus.classList.add('hidden'); 
        }
        
        // --- CÁLCULOS LOCAIS (RÁPIDOS) ---
        calcularCarteira();
        await processarDividendosPagos(); 
        renderizarHistorico();
        renderizarGraficoPatrimonio(); 
        
        // Mostra loading se tiver carteira e não for um refresh forçado (que já tratou acima)
        if (carteiraCalculada.length > 0 && !force) {
            dashboardStatus.classList.remove('hidden');
            dashboardLoading.classList.remove('hidden');
        }
        
        // Animação do ícone de refresh
        const refreshIcon = refreshButton.querySelector('svg'); 
        if (force) {
            refreshIcon.classList.add('spin-animation');
        }

        // Se não for forçado, tenta usar cache de proventos primeiro para agilizar
        if (!force) {
            const proventosFuturosCache = processarProventosScraper(proventosConhecidos);
            if (proventosFuturosCache.length > 0) {
                proventosAtuais = proventosFuturosCache;
                renderizarProventos();
            }
        }
        
        // Se a carteira estiver vazia, reseta tudo e para por aqui
        if (carteiraCalculada.length === 0) {
             precosAtuais = []; 
             proventosAtuais = []; 
             await renderizarCarteira(); 
             renderizarProventos(); 
             renderizarGraficoHistorico({ labels: [], data: [] }); 
             refreshIcon.classList.remove('spin-animation');
             return;
        }

        // --- BUSCA DE DADOS EXTERNOS (PARALELO) ---
        // Iniciamos todas as requisições ao mesmo tempo para ganhar tempo
        const promessaPrecos = buscarPrecosCarteira(force); 
        const promessaProventos = buscarProventosFuturos(force);
        const promessaHistorico = buscarHistoricoProventosAgregado(force);

        // Tratamento individual das promessas para renderizar assim que chegarem
        promessaPrecos.then(async precos => {
            if (precos.length > 0) {
                precosAtuais = precos; 
                await renderizarCarteira(); // Atualiza a lista assim que os preços chegam
            } else if (precosAtuais.length === 0) { 
                await renderizarCarteira(); 
            }
        }).catch(async err => {
            console.error("Erro ao buscar preços (BFF):", err);
            showToast("Erro ao buscar preços."); 
            if (precosAtuais.length === 0) { await renderizarCarteira(); }
        });

        promessaProventos.then(async proventosFuturos => {
            proventosAtuais = processarProventosScraper(proventosConhecidos);
            renderizarProventos(); // Atualiza o widget de proventos
            
            // Re-renderiza a carteira para atualizar as tags de "Data Com" nos cards
            if (precosAtuais.length > 0) { 
                await renderizarCarteira(); 
            }
        }).catch(async err => {
            console.error("Erro ao buscar proventos (BFF):", err);
            if (proventosConhecidos.length > 0) {
                 proventosAtuais = processarProventosScraper(proventosConhecidos);
                 renderizarProventos();
                 if (precosAtuais.length > 0) { await renderizarCarteira(); }
            } else if (proventosAtuais.length === 0) { 
                 totalProventosEl.textContent = "Erro"; 
            }
        });
        
        promessaHistorico.then(({ labels, data }) => {
            renderizarGraficoHistorico({ labels, data }); // Atualiza o gráfico de barras
        }).catch(err => {
            console.error("Erro ao buscar histórico agregado (BFF):", err);
            renderizarGraficoHistorico({ labels: [], data: [] }); 
        });
        
        // --- FINALIZAÇÃO ---
try {
            // Espera tudo terminar (sucesso ou falha) para limpar o estado de loading
            await Promise.allSettled([promessaPrecos, promessaProventos, promessaHistorico]); 
        } finally {
            refreshIcon.classList.remove('spin-animation');
            dashboardStatus.classList.add('hidden');
            dashboardLoading.classList.add('hidden');
            
            // Garante que os skeletons sumam no final de tudo
            renderizarDashboardSkeletons(false);
            renderizarCarteiraSkeletons(false);

            // CHAMA A FUNÇÃO NOVA AQUI:
            verificarNotificacoesFinanceiras();
        }
    } // Fim da função atualizarTodosDados

    async function handleToggleFavorito() {
        const symbol = detalhesFavoritoBtn.dataset.symbol;
        if (!symbol) return;

        const isFavorite = watchlist.some(item => item.symbol === symbol);

        try {
            if (isFavorite) {
                await supabaseDB.deleteWatchlist(symbol);
                watchlist = watchlist.filter(item => item.symbol !== symbol);
            } else {
                const newItem = { symbol: symbol, addedAt: new Date().toISOString() };
                await supabaseDB.addWatchlist(newItem);
                watchlist.push(newItem);
            }
            
            atualizarIconeFavorito(symbol); 
            renderizarWatchlist(); 
        } catch (e) {
            console.error("Erro ao salvar favorito:", e);
            showToast("Erro ao salvar favorito.");
        }
    }

async function handleCompartilharAtivo() {
        if (!currentDetalhesSymbol) return;

        let precoTexto = document.querySelector('#detalhes-preco h2')?.textContent || '';
        let dyTexto = 'N/A';
        let pvpTexto = 'N/A';

        const cards = document.querySelectorAll('#detalhes-preco span');
        cards.forEach(span => {
            if (span.textContent.includes('DY')) {
                dyTexto = span.nextElementSibling?.textContent || 'N/A';
            }
            if (span.textContent.includes('P/VP')) {
                pvpTexto = span.nextElementSibling?.textContent || 'N/A';
            }
        });

        const baseUrl = window.location.origin + window.location.pathname;
        const deepLink = `${baseUrl}?ativo=${currentDetalhesSymbol}`;
        
        const textoBase = `Confira ${currentDetalhesSymbol} no Vesto!\nPreço: ${precoTexto}\nDY (12m): ${dyTexto}\nP/VP: ${pvpTexto}`;
        
        const textoCompleto = `${textoBase}\n\nVer detalhes: ${deepLink}`;

        if (navigator.share) {
            try {
                await navigator.share({
                    title: `Vesto - ${currentDetalhesSymbol}`,
                    text: textoBase,
                    url: deepLink
                });
            } catch (err) {
                if (err.name !== 'AbortError') {

                    copiarParaClipboard(textoCompleto);
                }
            }
        } else {

            copiarParaClipboard(textoCompleto);
        }
    }

    function copiarParaClipboard(texto) {
        navigator.clipboard.writeText(texto).then(() => {
            showToast('Link copiado para a área de transferência!', 'success');
        }).catch(err => {
            console.error('Erro ao copiar', err);
            showToast('Erro ao copiar link.');
        });
    }
    
async function handleSalvarTransacao() {
        let ticker = tickerInput.value.trim().toUpperCase();
        let novaQuantidade = parseInt(quantityInput.value, 10);
        let novoPreco = parseFloat(precoMedioInput.value.replace(',', '.')); 
        let dataTransacao = dateInput.value;
        let transacaoID = transacaoIdInput.value;

        // Captura o valor do botão de rádio selecionado (buy ou sell)
        const tipoOperacao = document.getElementById('tipo-operacao-input').value;

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
                     showToast("Ativo não encontrado."); 
                     tickerInput.value = '';
                     tickerInput.placeholder = "Ativo não encontrado";
                     tickerInput.classList.add('border-red-500');
                     setTimeout(() => { 
                        tickerInput.placeholder = "Pesquisar ativo"; 
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
                type: tipoOperacao, // Usa o valor selecionado (buy/sell)
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
                type: tipoOperacao, // Usa o valor selecionado (buy/sell)
                quantity: novaQuantidade,
                price: novoPreco
            };
            
            await supabaseDB.addTransacao(novaTransacao);
            transacoes.push(novaTransacao);
            
            // Mensagem personalizada para compra ou venda
            const msg = tipoOperacao === 'sell' ? "Venda registrada!" : "Compra registrada!";
            showToast(msg, 'success');
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
    if (!tx) { showToast("Erro: Transação não encontrada."); return; }
    
    transacaoEmEdicao = tx;
    addModalTitle.textContent = tx.type === 'sell' ? 'Editar Venda' : 'Editar Compra';
    
    transacaoIdInput.value = tx.id;
    tickerInput.value = tx.symbol;
    tickerInput.disabled = true;
    dateInput.value = formatDateToInput(tx.date);
    quantityInput.value = tx.quantity;
    precoMedioInput.value = tx.price;
    
    // Atualiza Total Inicial
    const totalPreview = document.getElementById('total-transacao-preview');
    if(totalPreview) totalPreview.textContent = formatBRL(tx.quantity * tx.price);

    // ALTERAÇÃO: Aciona o botão correto para animar o toggle
    if (tx.type === 'sell') {
        document.getElementById('btn-opt-venda').click();
    } else {
        document.getElementById('btn-opt-compra').click();
    }

    addButton.textContent = 'Atualizar';
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
                                'Manter nos Favoritos?',
                                `${symbol} não está mais na sua carteira. Deseja mantê-lo na sua lista de favoritos?`,
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
    
    async function handleAlterarSenha(e) {
        e.preventDefault();

        const currentPassword = currentPasswordInput.value;
        const newPassword = changeNewPasswordInput.value;
        const confirmPassword = changeConfirmPasswordInput.value;
        
        if (newPassword.length < 6) {
            showToast("A nova senha deve ter no mínimo 6 caracteres.");
            return;
        }

        if (newPassword !== confirmPassword) {
            showToast("As senhas não coincidem.");
            return;
        }
        
        changePasswordSubmitBtn.innerHTML = '<span class="loader-sm"></span>';
        changePasswordSubmitBtn.disabled = true;
        
        try {
            const session = await supabaseDB.initialize();
            if (!session || !session.user || !session.user.email) {
                 throw new Error("Erro de sessão. Faça login novamente.");
            }
            const userEmail = session.user.email;

            const signInError = await supabaseDB.signIn(userEmail, currentPassword);
            
            if (signInError) {
                showToast("Senha atual incorreta.");
            } else {
                await supabaseDB.updateUserPassword(newPassword);
                showToast("Senha alterada com sucesso!", 'success');
                
                setTimeout(() => {
                    changePasswordModal.classList.remove('visible');
                    changePasswordForm.reset();
                }, 1500);
            }

        } catch (error) {
            console.error("Erro ao alterar senha:", error);
            showToast(error.message || "Erro ao alterar senha.");
        } finally {
            changePasswordSubmitBtn.textContent = 'Atualizar Senha';
            changePasswordSubmitBtn.disabled = false;
        }
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
    
    // --- 1. INJEÇÃO DO ÍCONE ---
    const iconContainer = document.getElementById('detalhes-icone-container');
    const sigla = symbol.substring(0, 2);
    
    if (iconContainer) {
        iconContainer.innerHTML = `
            <div class="w-12 h-12 rounded-2xl bg-[#1C1C1E] border border-neutral-800 flex items-center justify-center flex-shrink-0 shadow-sm">
                <span class="text-base font-bold text-white tracking-wider">${sigla}</span>
            </div>
        `;
    }
    
    detalhesTituloTexto.textContent = symbol;
    detalhesNomeLongo.textContent = 'Carregando...';
    
    currentDetalhesSymbol = symbol;
    currentDetalhesMeses = 3; 
    currentDetalhesHistoricoJSON = null; 
    
    // --- 2. CORES DOS BOTÕES (NEUTRO ABSOLUTO) ---
    const btnsPeriodo = periodoSelectorGroup.querySelectorAll('.periodo-selector-btn');
    btnsPeriodo.forEach(btn => {
        const isActive = btn.dataset.meses === '3';
        // Fundo preto puro, borda cinza escura neutra, texto cinza neutro
        btn.className = `periodo-selector-btn py-1.5 px-4 rounded-xl text-xs font-bold transition-all duration-200 border ${
            isActive 
            ? 'bg-purple-600 border-purple-600 text-white shadow-md active' 
            : 'bg-black border-[#2C2C2E] text-[#888888] hover:text-white hover:border-[#444]'
        }`;
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

    let fundamentos = {};
    let nextProventoData = null;

    if (isFII(symbol)) {
        detalhesHistoricoContainer.classList.remove('hidden'); 
        fetchHistoricoScraper(symbol);
        
        try {
            const [fundData, provData] = await Promise.all([
                callScraperFundamentosAPI(symbol),
                callScraperProximoProventoAPI(symbol)
            ]);
            fundamentos = fundData || {};
            nextProventoData = provData;
        } catch (e) { console.error("Erro dados extras", e); }
    } else {
        try {
            fundamentos = await callScraperFundamentosAPI(symbol) || {};
        } catch(e) {}
    }
    
    detalhesLoading.classList.add('hidden');

    if (precoData) {
        detalhesNomeLongo.textContent = precoData.longName || 'Nome não disponível';
        
        const varPercent = precoData.regularMarketChangePercent || 0;
        let variacaoCor = 'text-[#888888]';
        let variacaoIcone = '';
        const arrowUp = `<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 inline-block mb-0.5 mr-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" /></svg>`;
        const arrowDown = `<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 inline-block mb-0.5 mr-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>`;

        if (varPercent > 0) { variacaoCor = 'text-green-500'; variacaoIcone = arrowUp; } 
        else if (varPercent < 0) { variacaoCor = 'text-red-500'; variacaoIcone = arrowDown; }
        
        // Posição do Usuário
        const ativoCarteira = carteiraCalculada.find(a => a.symbol === symbol);
        let userPosHtml = '';
        if (ativoCarteira) {
            const totalPosicao = precoData.regularMarketPrice * ativoCarteira.quantity;
            userPosHtml = `
                <div class="w-full p-4 bg-black border border-[#2C2C2E] rounded-2xl flex justify-between items-center shadow-sm">
                    <div class="text-left">
                        <span class="text-[10px] text-[#666666] uppercase tracking-widest font-bold">Sua Posição</span>
                        <div class="flex items-baseline gap-2 mt-0.5">
                            <p class="text-xl font-bold text-white tracking-tight">${formatBRL(totalPosicao)}</p>
                            <span class="text-xs text-[#888888] font-medium">(${ativoCarteira.quantity} cotas)</span>
                        </div>
                    </div>
                </div>
            `;
        }

        // --- 3. CORREÇÃO DA LINHA DO PROVENTO ---
        let proximoProventoHtml = '';
        if (nextProventoData && nextProventoData.value > 0) {
            const dataComFmt = nextProventoData.dataCom ? formatDate(nextProventoData.dataCom) : '-';
            const dataPagFmt = nextProventoData.paymentDate ? formatDate(nextProventoData.paymentDate) : '-';
            const hoje = new Date(); hoje.setHours(0,0,0,0);
            let isFuturo = false;
            if(nextProventoData.paymentDate) {
                const parts = nextProventoData.paymentDate.split('-');
                const pDate = new Date(parts[0], parts[1]-1, parts[2]);
                if(pDate >= hoje) isFuturo = true;
            }
            const tituloCard = isFuturo ? "Próximo Pagamento" : "Último Anúncio";
            const borderClass = isFuturo ? "border-green-500/30 bg-green-900/10" : "border-[#2C2C2E] bg-black";
            const textClass = isFuturo ? "text-green-400" : "text-[#666666]";

            // AQUI: border-b border-[#2C2C2E] (Cinza Neutro, sem azul)
            proximoProventoHtml = `
                <div class="w-full p-3 rounded-2xl border ${borderClass} flex flex-col gap-2 shadow-sm">
                    <div class="flex justify-between items-center border-b border-[#2C2C2E] pb-2 mb-1">
                        <span class="text-[10px] uppercase tracking-widest font-bold ${textClass}">${tituloCard}</span>
                        <span class="text-lg font-bold text-white">${formatBRL(nextProventoData.value)}</span>
                    </div>
                    <div class="flex justify-between text-xs">
                        <div class="text-center">
                            <span class="block text-[#666666] mb-0.5">Data Com</span>
                            <span class="text-[#cccccc] font-medium">${dataComFmt}</span>
                        </div>
                        <div class="text-center">
                            <span class="block text-[#666666] mb-0.5">Pagamento</span>
                            <span class="text-[#cccccc] font-medium">${dataPagFmt}</span>
                        </div>
                    </div>
                </div>
            `;
        }

        const dados = { 
            pvp: fundamentos.pvp || '-', 
            dy: fundamentos.dy || '-', 
            segmento: fundamentos.segmento || '-', 
            mandato: fundamentos.mandato || '-',          
            tipo_fundo: fundamentos.tipo_fundo || '-',    
            vacancia: fundamentos.vacancia || '-', 
            vp_cota: fundamentos.vp_cota || '-', 
            liquidez: fundamentos.liquidez || '-', 
            val_mercado: fundamentos.val_mercado || '-', 
            ultimo_rendimento: fundamentos.ultimo_rendimento || '-', 
            patrimonio_liquido: fundamentos.patrimonio_liquido || '-', 
            variacao_12m: fundamentos.variacao_12m || '-',
            cnpj: fundamentos.cnpj || '-', 
            num_cotistas: fundamentos.num_cotistas || '-', 
            tipo_gestao: fundamentos.tipo_gestao || '-',
            prazo_duracao: fundamentos.prazo_duracao || '-', 
            taxa_adm: fundamentos.taxa_adm || '-',           
            cotas_emitidas: fundamentos.cotas_emitidas || '-' 
        };
        
        let corVar12m = 'text-[#888888]'; let icon12m = '';
        if (dados.variacao_12m && dados.variacao_12m !== '-' && dados.variacao_12m.includes('-')) {
            corVar12m = 'text-red-500'; icon12m = arrowDown;
        } else if (dados.variacao_12m !== '0.00%' && dados.variacao_12m !== '-') {
            corVar12m = 'text-green-500'; icon12m = arrowUp;
        }

        const renderRow = (label, value, isLast = false) => `
            <div class="flex justify-between items-center py-3.5 ${isLast ? '' : 'border-b border-[#2C2C2E]'}">
                <span class="text-sm text-[#888888] font-medium">${label}</span>
                <span class="text-sm font-semibold text-[#e5e5e5] text-right max-w-[60%] truncate">${value}</span>
            </div>
        `;

        detalhesPreco.innerHTML = `
            <div class="col-span-12 w-full flex flex-col gap-3">
                
                <div class="text-center pb-4 pt-2">
                    <h2 class="text-5xl font-bold text-white tracking-tighter">${formatBRL(precoData.regularMarketPrice)}</h2>
                    <span class="text-lg font-bold ${variacaoCor} mt-1 flex items-center justify-center gap-0.5 tracking-tight">
                        ${variacaoIcone}
                        ${formatPercent(precoData.regularMarketChangePercent)} Hoje
                    </span>
                </div>

                ${userPosHtml}
                
                ${proximoProventoHtml} 

                <div class="grid grid-cols-3 gap-3 w-full">
                    <div class="p-3 bg-black border border-[#2C2C2E] rounded-2xl flex flex-col justify-center items-center shadow-sm">
                        <span class="text-[10px] text-[#666666] uppercase font-bold tracking-wider mb-1">DY (12m)</span>
                        <span class="text-lg font-bold text-purple-400">${dados.dy}</span>
                    </div>
                    <div class="p-3 bg-black border border-[#2C2C2E] rounded-2xl flex flex-col justify-center items-center shadow-sm">
                        <span class="text-[10px] text-[#666666] uppercase font-bold tracking-wider mb-1">P/VP</span>
                        <span class="text-lg font-bold text-white">${dados.pvp}</span>
                    </div>
                    <div class="p-3 bg-black border border-[#2C2C2E] rounded-2xl flex flex-col justify-center items-center shadow-sm">
                        <span class="text-[10px] text-[#666666] uppercase font-bold tracking-wider mb-1">Últ. Rend.</span>
                        <span class="text-lg font-bold text-green-400">${dados.ultimo_rendimento}</span>
                    </div>
                </div>

                <div class="w-full bg-black border border-[#2C2C2E] rounded-2xl overflow-hidden px-4">
                    ${renderRow('Liquidez Diária', dados.liquidez)}
                    ${renderRow('Patrimônio Líquido', dados.patrimonio_liquido)}
                    ${renderRow('VP por Cota', dados.vp_cota)}
                    ${renderRow('Valor de Mercado', dados.val_mercado)}
                    ${renderRow('Vacância', dados.vacancia)}
                    <div class="flex justify-between items-center py-3.5">
                        <span class="text-sm text-[#888888] font-medium">Var. 12 Meses</span>
                        <span class="text-sm font-bold ${corVar12m} text-right flex items-center gap-1">
                            ${icon12m} ${dados.variacao_12m}
                        </span>
                    </div>
                </div>
                
                <h3 class="text-sm font-bold text-[#666666] uppercase tracking-wider mb-1 mt-2 ml-1">Dados Gerais</h3>
                
                <div class="w-full bg-black border border-[#2C2C2E] rounded-2xl px-4 pt-2">
                    ${renderRow('Segmento', dados.segmento)}
                    ${renderRow('Tipo de Fundo', dados.tipo_fundo)}
                    ${renderRow('Mandato', dados.mandato)}
                    ${renderRow('Gestão', dados.tipo_gestao)}
                    ${renderRow('Prazo', dados.prazo_duracao)}
                    ${renderRow('Taxa Adm.', dados.taxa_adm)}
                    ${renderRow('Cotistas', dados.num_cotistas)}
                    ${renderRow('Cotas Emitidas', dados.cotas_emitidas)}
                    <div class="flex justify-between items-center py-3.5">
                        <span class="text-sm text-[#888888] font-medium">CNPJ</span>
                        <span class="text-xs font-mono text-[#666666] select-all bg-[#1A1A1A] px-2 py-1 rounded truncate max-w-[150px] text-right border border-[#2C2C2E]">${dados.cnpj}</span>
                    </div>
                </div>

            </div>
        `;

    } else {
        detalhesPreco.innerHTML = '<p class="text-center text-red-500 py-4">Erro ao buscar preço.</p>';
    }
    
    renderizarTransacoesDetalhes(symbol);
    atualizarIconeFavorito(symbol);
}


// Substitua a função inteira em app.js

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
            // Estilo do card
            card.className = 'bg-black p-3.5 rounded-2xl flex items-center justify-between border border-[#2C2C2E] mb-2 shadow-sm w-full'; 
            
            // --- LÓGICA VISUAL ---
            const isVenda = t.type === 'sell';
            const cor = isVenda ? 'text-red-500' : 'text-green-500'; // Vermelho/Verde
            const sinal = isVenda ? '-' : '+';
            const textoTipo = isVenda ? 'Venda' : 'Compra';
            
            // Ícone: seta pra baixo (venda) ou seta pra cima/plus (compra)
            const svgContent = isVenda 
                ? '<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 12h-15" />' // Menos
                : '<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />'; // Mais

            // ---------------------------

            card.innerHTML = `
                <div class="flex items-center gap-3">
                    <div class="p-2 bg-[#1A1A1A] rounded-full ${cor} flex-shrink-0 border border-[#2C2C2E]">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                            ${svgContent}
                        </svg>
                    </div>
                    <div>
                        <p class="text-sm font-bold text-gray-200">${textoTipo}</p>
                        <p class="text-xs text-gray-500 font-medium">${formatDate(t.date)}</p>
                    </div>
                </div>
                <div class="text-right">
                    <p class="text-sm font-bold ${cor}">${sinal}${t.quantity} Cotas</p>
                    <p class="text-xs text-gray-400 font-medium">${formatBRL(t.price)}</p>
                </div>
            `;
            fragment.appendChild(card);
        });
        listaContainer.appendChild(fragment);
    }
    
    container.classList.remove('hidden');
}
    
    async function fetchHistoricoScraper(symbol) {
        detalhesAiProvento.innerHTML = `
            <div id="historico-periodo-loading" class="space-y-3 animate-shimmer-parent pt-2 h-48">
                <div class="h-4 bg-gray-800 rounded-md w-3/4"></div>
                <div class="h-4 bg-gray-800 rounded-md w-1/2"></div>
            </div>
        `;
        
        try {
            const cacheKey = `hist_ia_${symbol}_12`;
            let scraperResultJSON = await getCache(cacheKey);

            if (!scraperResultJSON) {
                scraperResultJSON = await callScraperHistoricoAPI(symbol); 
                
                if (scraperResultJSON && Array.isArray(scraperResultJSON)) {
                    await setCache(cacheKey, scraperResultJSON, CACHE_IA_HISTORICO);
                } else {
                    scraperResultJSON = [];
                }
            }

            currentDetalhesHistoricoJSON = scraperResultJSON;
            
            renderHistoricoIADetalhes(3);

        } catch (e) {
            showToast("Erro na consulta de dados."); 
            detalhesAiProvento.innerHTML = `
                <div class="p-4 text-center text-red-400 text-sm">Erro ao carregar gráfico</div>
            `;
        }
    }
    
    function renderHistoricoIADetalhes(meses) {
        if (!currentDetalhesHistoricoJSON) {
            return;
        }

        if (currentDetalhesHistoricoJSON.length === 0) {
            detalhesAiProvento.innerHTML = `
                <p class="text-sm text-gray-500 text-center py-4">
                    Sem histórico recente.
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
    
// Ordem exata das telas (deve bater com a ordem das divs no HTML)
    const tabOrder = ['tab-dashboard', 'tab-carteira', 'tab-noticias', 'tab-historico', 'tab-config'];

function mudarAba(tabId) {
        const index = tabOrder.indexOf(tabId);
        if (index === -1) return;

        // --- MOVIMENTO DO SLIDER ---
        const slider = document.getElementById('tabs-slider');
        if (slider) {
            slider.style.transform = `translateX(-${index * 100}%)`;
        }

        // --- ATUALIZAÇÃO DE ESTADO DAS ABAS ---
        tabContents.forEach(content => {
            if (content.id === tabId) {
                content.classList.add('active');
                content.scrollTop = content.scrollTop; 
            } else {
                content.classList.remove('active');
            }
        });

        // --- ATUALIZAÇÃO DOS ÍCONES DA NAV ---
        tabButtons.forEach(button => {
            button.classList.toggle('active', button.dataset.tab === tabId);
        });
        
        // --- LÓGICA DO BOTÃO ADICIONAR (COM ANIMAÇÃO) ---
        if (showAddModalBtn) {
            if (tabId === 'tab-carteira') {
                // Pequeno delay para esperar o slider começar a mover
                setTimeout(() => {
                    showAddModalBtn.classList.remove('hidden');
                    
                    // 1. Remove a classe de animação (reset)
                    showAddModalBtn.classList.remove('fab-animate');
                    
                    // 2. Força um 'Reflow' (reinicia o ciclo de renderização do CSS)
                    void showAddModalBtn.offsetWidth;
                    
                    // 3. Adiciona a classe novamente para tocar a animação
                    showAddModalBtn.classList.add('fab-animate');
                }, 150); 
            } else {
                showAddModalBtn.classList.add('hidden');
                showAddModalBtn.classList.remove('fab-animate');
            }
        }
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
    
listaHistorico.addEventListener('click', (e) => {
        // 1. Verifica se clicou no botão de EXCLUIR
        const deleteBtn = e.target.closest('[data-action="delete"]');
        if (deleteBtn) {
            e.stopPropagation(); // Impede que o clique propague para a linha (evita abrir o modal)
            const id = deleteBtn.dataset.id;
            const symbol = deleteBtn.dataset.symbol;
            handleExcluirTransacao(id, symbol);
            return;
        }

        // 2. Verifica se clicou na LINHA da transação (para EDITAR)
        const itemRow = e.target.closest('[data-action="edit-row"]');
        if (itemRow) {
            const id = itemRow.dataset.id;
            handleAbrirModalEdicao(id);
        }
    });
    
const tabDashboard = document.getElementById('tab-dashboard');

    if (tabDashboard) {
        tabDashboard.addEventListener('click', (e) => {
            // 1. Procura qualquer elemento com o atributo 'data-toggle-drawer' dentro do Dashboard
            const toggleCard = e.target.closest('[data-toggle-drawer]');
            
            if (toggleCard) {
                // Se clicou dentro do conteúdo expandido (ex: listas ou gráficos), NÃO fecha
                if (e.target.closest('.drawer-content')) return;

                const drawerId = toggleCard.dataset.toggleDrawer;
                const drawer = document.getElementById(drawerId);
                const icon = toggleCard.querySelector('.card-arrow-icon');
                
                // Abre/Fecha com a animação
                drawer?.classList.toggle('open');
                icon?.classList.toggle('open');
                return;
            }

            // (Opcional) Mantém compatibilidade com botões antigos que usam data-target-drawer
            const targetBtn = e.target.closest('button');
            if (targetBtn && targetBtn.dataset.targetDrawer) {
                const drawerId = targetBtn.dataset.targetDrawer;
                const drawer = document.getElementById(drawerId);
                const icon = targetBtn.querySelector('.card-arrow-icon');
                
                drawer?.classList.toggle('open');
                icon?.classList.toggle('open');
            }
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

// --- LISTENER DE NOTÍCIAS (CORRIGIDO PARA O NOVO LAYOUT) ---
    fiiNewsList.addEventListener('click', (e) => {
        // 1. Verifica se clicou numa TAG de ticker
        const tickerTag = e.target.closest('.news-ticker-tag');
        if (tickerTag) {
            e.stopPropagation(); 
            const symbol = tickerTag.dataset.symbol;
            if (symbol) {
                showDetalhesModal(symbol);
            }
            return;
        }

        // 2. Verifica se clicou no LINK externo
        if (e.target.closest('a')) {
            e.stopPropagation(); 
            return; 
        }

        // 3. Verifica se clicou no CARD da notícia (para abrir o drawer)
        // Agora procura por 'data-action="toggle-news"' OU a classe antiga 'news-card-interactive'
        const card = e.target.closest('[data-action="toggle-news"]') || e.target.closest('.news-card-interactive');
        
        if (card) {
            const targetId = card.dataset.target; // Pega o ID do drawer (ex: news-drawer-HOJE-0)
            
            // Como mudamos o ID para ser dinâmico, usamos getElementById
            const drawer = document.getElementById(targetId);
            const icon = card.querySelector('.card-arrow-icon');
            
            if (drawer) {
                drawer.classList.toggle('open');
                if (icon) icon.classList.toggle('open');
            } else {
                console.error('Drawer não encontrado para o ID:', targetId);
            }
        }
    });
    
    detalhesFavoritoBtn.addEventListener('click', handleToggleFavorito);
	
	if (detalhesShareBtn) {
        detalhesShareBtn.addEventListener('click', handleCompartilharAtivo);
    }
    
    if (carteiraSearchInput) {
        carteiraSearchInput.addEventListener('input', (e) => {
            const term = e.target.value.trim().toUpperCase();
            const cards = listaCarteira.querySelectorAll('.wallet-card');
            
            cards.forEach(card => {
                const symbol = card.dataset.symbol;
                if (symbol && symbol.includes(term)) {
                    card.classList.remove('hidden');
                } else {
                    card.classList.add('hidden');
                }
            });
        });

        carteiraSearchInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') {
                const term = carteiraSearchInput.value.trim().toUpperCase();
                
                if (!term) return;

                saveSearchHistory(term);
                suggestionsContainer.classList.add('hidden');

                carteiraSearchInput.blur(); 
                showDetalhesModal(term);

                carteiraSearchInput.value = '';
                carteiraSearchInput.dispatchEvent(new Event('input'));
            }
        });
    }
    
periodoSelectorGroup.addEventListener('click', (e) => {
    const target = e.target.closest('.periodo-selector-btn');
    if (!target) return;

    const meses = parseInt(target.dataset.meses, 10);
    if (meses === currentDetalhesMeses) return;

    currentDetalhesMeses = meses;
    
    periodoSelectorGroup.querySelectorAll('.periodo-selector-btn').forEach(btn => {
        const isTarget = btn === target;
        // Mesma lógica neutra
        btn.className = `periodo-selector-btn py-1.5 px-4 rounded-xl text-xs font-bold transition-all duration-200 border ${
            isTarget
            ? 'bg-purple-600 border-purple-600 text-white shadow-md active' 
            : 'bg-black border-[#2C2C2E] text-[#888888] hover:text-white hover:border-[#444]'
        }`;
    });

    renderHistoricoIADetalhes(currentDetalhesMeses);
});

    if (toggleBioBtn) {
        toggleBioBtn.addEventListener('click', () => {
            const isEnabled = localStorage.getItem('vesto_bio_enabled') === 'true';
            if (isEnabled) {
                showModal("Desativar Biometria?", "Deseja remover o bloqueio por impressão digital?", () => {                    desativarBiometria();
                });
            } else {
                showModal("Ativar Biometria?", "Isso usará o sensor do seu dispositivo para proteger o app.", () => {
                    ativarBiometria();
                });
            }
        });
    }

    function updatePrivacyUI() {
        const isPrivacyOn = localStorage.getItem('vesto_privacy_mode') === 'true';
        if (isPrivacyOn) {
            document.body.classList.add('privacy-mode');
            togglePrivacyBtn.classList.remove('bg-gray-700');
            togglePrivacyBtn.classList.add('bg-purple-600');
            privacyToggleKnob.classList.remove('translate-x-1');
            privacyToggleKnob.classList.add('translate-x-6');
        } else {
            document.body.classList.remove('privacy-mode');
            togglePrivacyBtn.classList.remove('bg-purple-600');
            togglePrivacyBtn.classList.add('bg-gray-700');
            privacyToggleKnob.classList.remove('translate-x-6');
            privacyToggleKnob.classList.add('translate-x-1');
        }
    }

    if (togglePrivacyBtn) {
        updatePrivacyUI();
        
        togglePrivacyBtn.addEventListener('click', () => {
            const current = localStorage.getItem('vesto_privacy_mode') === 'true';
            localStorage.setItem('vesto_privacy_mode', !current);
            updatePrivacyUI();
        });
    }

    if (exportCsvBtn) {
        exportCsvBtn.addEventListener('click', () => {
            if (!transacoes || transacoes.length === 0) {
                showToast("Sem dados para exportar.");
                return;
            }

            let csvContent = "data:text/csv;charset=utf-8,";
            csvContent += "Data,Ativo,Tipo,Quantidade,Preco,ID\n"; 

            transacoes.forEach(t => {
                const dataFmt = t.date.split('T')[0];
                const row = `${dataFmt},${t.symbol},${t.type},${t.quantity},${t.price},${t.id}`;
                csvContent += row + "\n";
            });

            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `vesto_export_${new Date().toISOString().split('T')[0]}.csv`);
            document.body.appendChild(link);
            
            link.click();
            document.body.removeChild(link);
        });
    }

if (clearCacheBtn) {
        clearCacheBtn.addEventListener('click', () => {
            showModal(
                "Limpar Cache e Reparar?", 
                "Isso apagará dados temporários (preços, notícias) e baixará a versão mais recente do app. Suas configurações (Tema, Biometria) serão mantidas.", 
                async () => {
             
                    try {

                        try {
                            await vestoDB.clear('apiCache');
                        } catch (e) {
                            console.warn("Falha ao limpar store, tentando deletar DB completo...", e);
                            const req = indexedDB.deleteDatabase(DB_NAME);
                            req.onsuccess = () => console.log("DB Deletado com sucesso");
                        }

                        if ('caches' in window) {
                            const keys = await caches.keys();
                            await Promise.all(keys.map(key => caches.delete(key)));
                        }

                        if ('serviceWorker' in navigator) {
                            const registrations = await navigator.serviceWorker.getRegistrations();
                            for(let registration of registrations) {
                                await registration.unregister();
                            }
                        }

                        window.location.reload(true);

                    } catch (e) {
                        console.error("Erro fatal ao limpar:", e);
                        showToast("Erro ao limpar. Tente reiniciar o navegador.");
                    }
                }
            );
        });
    }

    if (openChangePasswordBtn) {
        openChangePasswordBtn.addEventListener('click', () => {
            changePasswordModal.classList.add('visible');
            const modalContent = changePasswordModal.querySelector('.modal-content');
            modalContent.classList.remove('modal-out');
            currentPasswordInput.focus();
        });
    }

    if (closeChangePasswordBtn) {
        closeChangePasswordBtn.addEventListener('click', () => {
            const modalContent = changePasswordModal.querySelector('.modal-content');
            modalContent.classList.add('modal-out');
            setTimeout(() => {
                changePasswordModal.classList.remove('visible');
                changePasswordForm.reset();
            }, 200);
        });
    }
    
    if (changePasswordForm) {
        changePasswordForm.addEventListener('submit', handleAlterarSenha);
    }

    if (logoutBtn) {
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
    }

    async function callScraperHistoricoAPI(ticker) { 
        const body = { 
            mode: 'historico_12m', 
            payload: { ticker } 
        };
        const response = await fetchBFF('/api/scraper', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return response.json; 
    }
    
    async function callScraperProventosCarteiraAPI(fiiList) {
        const body = { mode: 'proventos_carteira', payload: { fiiList } };
        const response = await fetchBFF('/api/scraper', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return response.json; 
    }
    
    async function callScraperHistoricoPortfolioAPI(fiiList) {
         const body = { mode: 'historico_portfolio', payload: { fiiList } };
         const response = await fetchBFF('/api/scraper', {
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
	
	// --- LÓGICA DE NOTIFICAÇÕES PUSH ---
    
    // SUA CHAVE PÚBLICA (Preenchida com a que você enviou)
    const VAPID_PUBLIC_KEY = 'BHsn3oIOqeyV80WVlU7yw7528e9EPrJ3KI7mgaX_aMcAtrE0qrfRFuYbT1RL46X34tkxXB_MLCStRrmIYVh6tVY'; 

    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    const toggleNotifBtn = document.getElementById('toggle-notif-btn');
    const notifToggleKnob = document.getElementById('notif-toggle-knob');
    const notifStatusIcon = document.getElementById('notif-status-icon');

    function atualizarUINotificacao(ativado) {
        if (!toggleNotifBtn || !notifToggleKnob) return;
        if (ativado) {
            toggleNotifBtn.classList.remove('bg-gray-700');
            toggleNotifBtn.classList.add('bg-purple-600');
            notifToggleKnob.classList.remove('translate-x-1');
            notifToggleKnob.classList.add('translate-x-6');
            if(notifStatusIcon) notifStatusIcon.classList.replace('text-gray-500', 'text-purple-400');
        } else {
            toggleNotifBtn.classList.remove('bg-purple-600');
            toggleNotifBtn.classList.add('bg-gray-700');
            notifToggleKnob.classList.remove('translate-x-6');
            notifToggleKnob.classList.add('translate-x-1');
            if(notifStatusIcon) notifStatusIcon.classList.replace('text-purple-400', 'text-gray-500');
        }
    }

    async function verificarStatusPush() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            if(toggleNotifBtn) toggleNotifBtn.disabled = true; // Navegador não suporta
            return;
        }
        
        // Se já tem permissão e SW ativo, marca o botão como ligado
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        
        if (sub && Notification.permission === 'granted') {
            atualizarUINotificacao(true);
            // Garante que o servidor tenha a chave atualizada
            await supabaseDB.salvarPushSubscription(sub);
        } else {
            atualizarUINotificacao(false);
        }
    }

    async function assinarNotificacoesPush() {
        if (!currentUserId) return; 

        try {
            const registration = await navigator.serviceWorker.ready;
            
            // Pede permissão
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                showToast('Permissão negada. Ative nas configurações do navegador.');
                atualizarUINotificacao(false);
                return;
            }

            // Assina
            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
            });

            // Salva no banco
            await supabaseDB.salvarPushSubscription(subscription);
            showToast('Notificações ativadas!', 'success');
            atualizarUINotificacao(true);

        } catch (e) {
            console.error('Erro ao assinar push:', e);
            showToast('Erro ao ativar notificações.');
            atualizarUINotificacao(false);
        }
    }
	
	async function desativarNotificacoesPush() {
        try {
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            
            if (sub) {
                // 1. Remove do Banco de Dados
                await supabaseDB.removerPushSubscription(sub);
                
                // 2. Cancela a inscrição no navegador
                await sub.unsubscribe();
            }

            atualizarUINotificacao(false);
            showToast("Notificações desativadas.");

        } catch (e) {
            console.error("Erro ao desativar:", e);
            showToast("Erro ao desativar notificações.");
        }
    }
	
	// --- LÓGICA DO MODAL DE TRANSAÇÃO (Cole aqui) ---
function setupTransactionModalLogic() {
        const btnCompra = document.getElementById('btn-opt-compra');
        const btnVenda = document.getElementById('btn-opt-venda');
        const toggleBg = document.getElementById('transacao-toggle-bg');
        const inputOperacao = document.getElementById('tipo-operacao-input');
        
        const inputQtd = document.getElementById('quantity-input');
        const inputPreco = document.getElementById('preco-medio-input');
        const totalPreview = document.getElementById('total-transacao-preview');

        // Toggle Compra/Venda
        if (btnCompra && btnVenda) {
            btnCompra.addEventListener('click', () => {
                inputOperacao.value = 'buy';
                toggleBg.classList.remove('translate-x-full', 'bg-red-600', 'shadow-[0_0_10px_rgba(220,38,38,0.4)]');
                toggleBg.classList.add('bg-green-600', 'shadow-[0_0_10px_rgba(22,163,74,0.4)]');
                
                btnCompra.classList.replace('text-gray-500', 'text-white');
                btnVenda.classList.replace('text-white', 'text-gray-500');
            });

            btnVenda.addEventListener('click', () => {
                inputOperacao.value = 'sell';
                toggleBg.classList.remove('bg-green-600', 'shadow-[0_0_10px_rgba(22,163,74,0.4)]');
                toggleBg.classList.add('translate-x-full', 'bg-red-600', 'shadow-[0_0_10px_rgba(220,38,38,0.4)]');
                
                btnVenda.classList.replace('text-gray-500', 'text-white');
                btnCompra.classList.replace('text-white', 'text-gray-500');
            });
        }

        // Cálculo Automático
        function calcularTotal() {
            const qtd = parseFloat(inputQtd.value) || 0;
            const preco = parseFloat(inputPreco.value) || 0;
            const total = qtd * preco;
            if(totalPreview) totalPreview.textContent = formatBRL(total);
        }

        if (inputQtd && inputPreco) {
            inputQtd.addEventListener('input', calcularTotal);
            inputPreco.addEventListener('input', calcularTotal);
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
        
        // Listeners de Formulários (Recuperação e Login)
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
        
        // Verificação de Nova Senha via URL
        if (window.location.hash && window.location.hash.includes('type=recovery')) {
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

        // Inicialização do Supabase
        let session;
        try {
            session = await supabaseDB.initialize();
        } catch (e) {
            console.error("Erro na inicialização:", e);
            showAuthLoading(false);
            showLoginError("Erro ao conectar com o servidor. Tente novamente.");
            return; 
        }
        
        // Listeners de Login/Cadastro
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

        // LÓGICA DE SESSÃO E ROTEAMENTO
        if (session) {
			await verificarStatusPush();
            currentUserId = session.user.id;
            authContainer.classList.add('hidden');    
            appWrapper.classList.remove('hidden'); 
            
            await verificarStatusBiometria();
            
            // 1. Captura parâmetros da URL (Atalhos e Compartilhamento)
            const urlParams = new URLSearchParams(window.location.search);
            const tabParam = urlParams.get('tab');
            const ativoShared = urlParams.get('ativo');

            // 2. Lógica de Atalhos (App Shortcuts)
            if (tabParam && document.getElementById(tabParam)) {
                mudarAba(tabParam);
                window.history.replaceState({}, document.title, window.location.pathname);
            } else {
                mudarAba('tab-dashboard'); 
            }

// --- BLOQUEIO DE SWIPE NO CARROSSEL (FIX DEFINITIVO) ---
    const carouselWrapper = document.getElementById('carousel-wrapper');
    if (carouselWrapper) {
        // Impede que o evento de toque suba para o documento (onde está o listener do swipe de abas)
        carouselWrapper.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
        carouselWrapper.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
        carouselWrapper.addEventListener('touchend', (e) => e.stopPropagation(), { passive: true });
    }

            await carregarDadosIniciais();

            // 3. Lógica de Ativo Compartilhado (Deep Link)
            if (ativoShared) {
                const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
                window.history.replaceState({path: newUrl}, '', newUrl);
                
                setTimeout(() => {
                    let symbolClean = ativoShared.toUpperCase().replace('.SA', '').trim();
                    if (symbolClean) {
                        showDetalhesModal(symbolClean);
                    }
                }, 800);
            }
            
        } else {
            // Caso NÃO tenha sessão
            appWrapper.classList.add('hidden');      
            authContainer.classList.remove('hidden'); 
            
            if (recoverForm.classList.contains('hidden') && signupForm.classList.contains('hidden')) {
                loginForm.classList.remove('hidden');
            }
            showAuthLoading(false);                 
        }
    }
    
    const STORAGE_KEY_SEARCH = 'vesto_search_history';
    const MAX_HISTORY_ITEMS = 5;

    const suggestionsContainer = document.createElement('ul');
    suggestionsContainer.id = 'search-suggestions';

    suggestionsContainer.className = 'absolute top-full left-0 w-full bg-[#1C1C1E] border border-[#2C2C2E] rounded-2xl mt-2 z-[60] hidden overflow-hidden shadow-[0_10px_40px_-10px_rgba(0,0,0,0.8)]';
    
    if (carteiraSearchInput && carteiraSearchInput.parentNode) {

        const parentStyle = window.getComputedStyle(carteiraSearchInput.parentNode);
        if (parentStyle.position === 'static') {
            carteiraSearchInput.parentNode.style.position = 'relative';
        }
        carteiraSearchInput.parentNode.appendChild(suggestionsContainer);
    } else {
        console.error("Erro Vesto: Input de pesquisa não encontrado para anexar sugestões.");
    }

function getSearchHistory() {
        try {
            const history = localStorage.getItem(STORAGE_KEY_SEARCH);

            return history ? JSON.parse(history) : [];
        } catch (e) { return []; }
    }

function saveSearchHistory(term) {
        if (!term || term.length < 3) return;
        term = term.toUpperCase().trim();
        
        let history = getSearchHistory();
        history = history.filter(item => item !== term);
        history.unshift(term); 
        if (history.length > MAX_HISTORY_ITEMS) history.pop(); 
        
        localStorage.setItem(STORAGE_KEY_SEARCH, JSON.stringify(history));
        
        renderSuggestions();
    }

    function removeSearchHistoryItem(term) {
        let history = getSearchHistory();
        history = history.filter(item => item !== term);
        localStorage.setItem(STORAGE_KEY_SEARCH, JSON.stringify(history));
        
        if (history.length === 0) {
            suggestionsContainer.classList.add('hidden');
        } else {
            renderSuggestions();
        }
        carteiraSearchInput.focus();
    }

// --- LÓGICA DE SUGESTÕES DE PESQUISA ---
    function renderSuggestions() {
        const history = getSearchHistory();
        suggestionsContainer.innerHTML = '';

        if (history.length === 0) {
            suggestionsContainer.classList.add('hidden');
            return;
        }

        const fragment = document.createDocumentFragment();

        history.forEach(term => {
            const li = document.createElement('li');
            li.className = 'flex justify-between items-center bg-[#1C1C1E] active:bg-gray-800 hover:bg-gray-800 transition-colors cursor-pointer border-b border-[#2C2C2E] last:border-0 group';
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'flex items-center gap-3 flex-1 p-4';
            contentDiv.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span class="text-sm text-gray-200 font-medium">${term}</span>
            `;
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'p-4 text-gray-600 hover:text-red-400 active:text-red-400 transition-colors border-l border-[#2C2C2E]';
            deleteBtn.title = "Remover do histórico";
            deleteBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
            `;

            contentDiv.addEventListener('mousedown', (e) => {
                e.preventDefault(); 
                carteiraSearchInput.value = term;
                suggestionsContainer.classList.add('hidden');
                carteiraSearchInput.dispatchEvent(new Event('input'));
                showDetalhesModal(term);
            });

            deleteBtn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                removeSearchHistoryItem(term);
            });

            li.appendChild(contentDiv);
            li.appendChild(deleteBtn);
            fragment.appendChild(li);
        });

        suggestionsContainer.appendChild(fragment);
    }

    if (carteiraSearchInput) {
        carteiraSearchInput.addEventListener('focus', () => {
            const history = getSearchHistory();
            if (history.length > 0) {
                renderSuggestions();
                suggestionsContainer.classList.remove('hidden');
            }
        });

        carteiraSearchInput.addEventListener('input', () => {
            if (carteiraSearchInput.value.length > 0) {
                suggestionsContainer.classList.add('hidden');
            } else {
                renderSuggestions();
                suggestionsContainer.classList.remove('hidden');
            }
        });

        carteiraSearchInput.addEventListener('blur', () => {
            setTimeout(() => {
                suggestionsContainer.classList.add('hidden');
            }, 200);
        });

        carteiraSearchInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') {
                const term = carteiraSearchInput.value.trim();
                if (term) {
                    saveSearchHistory(term);
                    suggestionsContainer.classList.add('hidden');
                }
            }
        });
    }

    // --- GESTOS (SWIPE) PARA NAVEGAÇÃO ---
let swipeStartX = 0;
    let swipeStartY = 0;

document.addEventListener('touchstart', (e) => {
        // Bloqueia se houver modal aberto
        if (document.querySelector('.custom-modal.visible') || 
            document.querySelector('.page-modal.visible') || 
            document.querySelector('#ai-modal.visible')) {
            return;
        }
        
        // --- NOVA CORREÇÃO: Bloqueia swipe se tocar no carrossel de favoritos ---
        if (e.target.closest('.overflow-x-auto') || e.target.closest('#dashboard-favorites-list')) {
            return; 
        }
        // -----------------------------------------------------------------------

        swipeStartX = e.changedTouches[0].screenX;
        swipeStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
        if (document.querySelector('.custom-modal.visible') || 
            document.querySelector('.page-modal.visible') || 
            document.querySelector('#ai-modal.visible')) {
            return;
        }

        const swipeEndX = e.changedTouches[0].screenX;
        const swipeEndY = e.changedTouches[0].screenY;
        const diffX = swipeEndX - swipeStartX;
        const diffY = swipeEndY - swipeStartY;

        // Verifica se o movimento foi horizontal e longo o suficiente (> 50px)
        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
            const currentTab = document.querySelector('.tab-content.active');
            if (!currentTab) return;

            // AQUI: Usamos tabOrder (minúsculo) conforme sua preferência
            const currentIndex = tabOrder.indexOf(currentTab.id);
            if (currentIndex === -1) return;

            if (diffX < 0) {
                // Deslizou para ESQUERDA (<<) -> Próxima Aba
                if (currentIndex < tabOrder.length - 1) {
                    mudarAba(tabOrder[currentIndex + 1]);
                }
            } else {
                // Deslizou para DIREITA (>>) -> Aba Anterior
                if (currentIndex > 0) {
                    mudarAba(tabOrder[currentIndex - 1]);
                }
            }
        }
    }, { passive: true });
	
// --- LÓGICA DE EVENTOS DAS NOTIFICAÇÕES (SUBSTITUIR ESTE BLOCO) ---

    // 1. Abrir/Fechar ao clicar no Sininho
    if (btnNotifications) {
        btnNotifications.addEventListener('click', () => {
            notificationsDrawer.classList.toggle('open');
            
            if (notificationsDrawer.classList.contains('open')) {
                notificationBadge.classList.add('hidden');
                btnNotifications.classList.remove('bell-ringing');
            }
        });
    }

    // 2. Fechar ao clicar no botão "X" interno (NOVO)
    const closeNotifDrawerBtn = document.getElementById('close-notif-drawer-btn');
    if (closeNotifDrawerBtn) {
        closeNotifDrawerBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Evita conflitos de clique
            notificationsDrawer.classList.remove('open');
        });
    }

    // 3. Fechar a gaveta de notificações se clicar fora dela
    document.addEventListener('click', (e) => {
        if (notificationsDrawer && notificationsDrawer.classList.contains('open') && 
            !notificationsDrawer.contains(e.target) && 
            !btnNotifications.contains(e.target)) {
            notificationsDrawer.classList.remove('open');
        }
    });
	
if (toggleNotifBtn) {
        toggleNotifBtn.addEventListener('click', () => {
            // Verifica se visualmente está ligado (bg-purple-600)
            const estaAtivado = toggleNotifBtn.classList.contains('bg-purple-600');

            if (estaAtivado) {
                // Lógica de DESATIVAR
                showModal(
                    "Desativar Notificações?", 
                    "Você deixará de receber alertas sobre proventos e datas de corte.", 
                    () => {
                        desativarNotificacoesPush();
                    }
                );
            } else {
                // Lógica de ATIVAR
                assinarNotificacoesPush();
            }
        });
    }
	window.confirmarExclusao = handleRemoverAtivo;
    window.abrirDetalhesAtivo = showDetalhesModal;
	setupTransactionModalLogic();

    await init();
});