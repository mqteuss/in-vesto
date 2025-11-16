Chart.defaults.color = '#9ca3af'; 
Chart.defaults.borderColor = '#374151'; 

// ===================================================================
// FUNÇÕES UTILITÁRIAS GLOBAIS
// (Movidas para fora para estarem acessíveis globalmente)
// ===================================================================

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

// ===================================================================
// NOVAS FUNÇÕES DE RENDERIZAÇÃO (OTIMIZADAS)
// (Usadas pela nova renderizarCarteira)
// ===================================================================

function criarCardElemento(ativo, dados) {
    const {
        dadoPreco, precoFormatado, variacaoFormatada, corVariacao,
        totalPosicao, custoTotal, lucroPrejuizo, lucroPrejuizoPercent,
        corPL, bgPL, dadoProvento
    } = dados;

    // --- HTML da Tag P/L ---
    let plTagHtml = '';
    if (dadoPreco) {
        plTagHtml = `<span class="text-xs font-semibold px-2 py-0.5 rounded-full ${bgPL} ${corPL} inline-block">
            ${lucroPrejuizoPercent.toFixed(1)}% L/P
        </span>`;
    }
    
    // --- HTML do Provento ---
    let proventoHtml = '';
    if (isFII(ativo.symbol)) { 
        if (dadoProvento && dadoProvento.value > 0) {
            
            // DEPOIS (Corrigido): Agrupado com space-y-1
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

    // --- Cria o Elemento ---
    const card = document.createElement('div');
    card.className = 'card-bg p-4 rounded-2xl card-animate-in';
    card.setAttribute('data-symbol', ativo.symbol); // O ID principal!

    // --- O HTML (Note os 'data-field' adicionados) ---
    // A classe 'text-purple-400' no SVG é mantida, pois corresponde ao #c084fc do Tailwind CDN.
    card.innerHTML = `
        <div class="flex justify-between items-start">
            <div class="flex items-center gap-3">
                <div class="w-9 h-9 rounded-full bg-gray-700 p-1.5 flex items-center justify-center flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-full h-full text-purple-400">
                        <path d="M1.5 13.5a3 3 0 0 1 3-3h1.5a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H4.5a3 3 0 0 1-3-3v-6Zm16.5 0a3 3 0 0 1 3-3h1.5a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-1.5a3 3 0 0 1-3-3v-6Zm-8.25-9a3 3 0 0 1 3-3h1.5a3 3 0 0 1 3 3v15a3 3 0 0 1-3 3h-1.5a3 3 0 0 1-3-3V4.5Z" />
                    </svg>
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

    // --- Atualiza os campos simples ---
    card.querySelector('[data-field="cota-qtd"]').textContent = `${ativo.quantity} cota(s)`;
    card.querySelector('[data-field="preco-valor"]').textContent = precoFormatado;
    card.querySelector('[data-field="posicao-valor"]').textContent = dadoPreco ? formatBRL(totalPosicao) : 'A calcular...';
    card.querySelector('[data-field="pm-label"]').textContent = `Custo (P.M. ${formatBRL(ativo.precoMedio)})`;
    card.querySelector('[data-field="custo-valor"]').textContent = formatBRL(custoTotal);

    // --- Atualiza Variação (Valor e Cor) ---
    const variacaoEl = card.querySelector('[data-field="variacao-valor"]');
    variacaoEl.textContent = dadoPreco ? variacaoFormatada : '...';
    variacaoEl.className = `${corVariacao} font-semibold text-lg`; // Redefine as classes de cor

    // --- Atualiza P/L (Valor e Cor) ---
    const plValorEl = card.querySelector('[data-field="pl-valor"]');
    plValorEl.textContent = dadoPreco ? `${formatBRL(lucroPrejuizo)} (${lucroPrejuizoPercent.toFixed(2)}%)` : 'A calcular...';
    plValorEl.className = `text-base font-semibold ${corPL}`; // Redefine as classes de cor

    // --- Atualiza P/L Tag (HTML interno) ---
    let plTagHtml = '';
    if (dadoPreco) {
        plTagHtml = `<span class="text-xs font-semibold px-2 py-0.5 rounded-full ${bgPL} ${corPL} inline-block">
            ${lucroPrejuizoPercent.toFixed(1)}% L/P
        </span>`;
    }
    card.querySelector('[data-field="pl-tag"]').innerHTML = plTagHtml;

    // --- Atualiza Provento (HTML interno) ---
    if (isFII(ativo.symbol)) { 
        let proventoHtml = '';
        if (dadoProvento && dadoProvento.value > 0) {
            
            // DEPOIS (Corrigido): Agrupado com space-y-1
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


// ===================================================================
// INÍCIO DO CÓDIGO PRINCIPAL DA APLICAÇÃO
// ===================================================================

document.addEventListener('DOMContentLoaded', async () => {
    
    const REFRESH_INTERVAL = 1860000;
    const CACHE_DURATION = 1000 * 60 * 30;
    const CACHE_24_HORAS = 1000 * 60 * 60 * 24;
    const CACHE_6_HORAS = 1000 * 60 * 60 * 6;
    
    const DB_NAME = 'vestoDB';
    const DB_VERSION = 2;

    // --- NOVOS SELETORES DE AUTH ---
    const authPage = document.getElementById('auth-page');
    const authContent = document.getElementById('auth-content');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const loginError = document.getElementById('login-error');
    const registerError = document.getElementById('register-error');
    const registerSuccess = document.getElementById('register-success');
    const loginEmailInput = document.getElementById('login-email');
    const loginPasswordInput = document.getElementById('login-password');
    const registerEmailInput = document.getElementById('register-email');
    const registerPasswordInput = document.getElementById('register-password');
    const loginButton = document.getElementById('login-button');
    const registerButton = document.getElementById('register-button');
    const showRegisterBtn = document.getElementById('show-register-btn');
    const showLoginBtn = document.getElementById('show-login-btn');
    const logoutButton = document.getElementById('logout-button');
    const migrationButton = document.getElementById('migration-button'); // Adicionado seletor
    // --- FIM DOS NOVOS SELETORES ---

    const vestoDB = {
        db: null,
        
        init() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, DB_VERSION);
                
                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    
                    // Mantém apenas o apiCache e o watchlist (local, antes da migração)
                    if (!db.objectStoreNames.contains('apiCache')) {
                        db.createObjectStore('apiCache', { keyPath: 'key' });
                    }
                    if (!db.objectStoreNames.contains('watchlist')) {
                        db.createObjectStore('watchlist', { keyPath: 'symbol' });
                    }
                    
                    // Dados que serão migrados
                    if (!db.objectStoreNames.contains('transacoes')) {
                        const transStore = db.createObjectStore('transacoes', { keyPath: 'id' });
                        transStore.createIndex('bySymbol', 'symbol', { unique: false });
                    }
                    if (!db.objectStoreNames.contains('patrimonio')) {
                        db.createObjectStore('patrimonio', { keyPath: 'date' });
                    }
                    if (!db.objectStoreNames.contains('appState')) {
                        db.createObjectStore('appState', { keyPath: 'key' });
                    }
                    if (!db.objectStoreNames.contains('proventosConhecidos')) {
                        db.createObjectStore('proventosConhecidos', { keyPath: 'id' });
                    }
                };
                
                request.onsuccess = (event) => {
                    this.db = event.target.result;
                    console.log('[IDB] Conexão estabelecida.');
                    resolve();
                };
                
                request.onerror = (event) => {
                    console.error('[IDB] Erro ao abrir DB:', event.target.error);
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

        getAll(storeName) {
            return new Promise((resolve, reject) => {
                const store = this._getStore(storeName);
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = (e) => reject(e.target.error);
            });
        },
        
        getAllFromIndex(storeName, indexName, query) {
             return new Promise((resolve, reject) => {
                const store = this._getStore(storeName);
                const index = store.index(indexName);
                const request = index.getAll(query);
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
    
    const refreshButton = document.getElementById('refresh-button');
    const refreshNoticiasButton = document.getElementById('refresh-noticias-button');
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    const toastElement = document.getElementById('toast-notification');
    const toastMessageElement = document.getElementById('toast-message');
    // --- ALTERADO: Seletores dos ícones do Toast ---
    const toastIconError = document.getElementById('toast-icon-error');
    const toastIconSuccess = document.getElementById('toast-icon-success');
    // --- FIM DA ALTERAÇÃO ---
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
    const carteiraMensagem = document.getElementById('carteira-mensagem'); // Adicionado seletor
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
    const copiarDadosBtn = document.getElementById('copiar-dados-btn');
    const abrirImportarModalBtn = document.getElementById('abrir-importar-modal-btn');
    const compartilharCarteiraBtn = document.getElementById('compartilhar-carteira-btn'); // Adicionado seletor
    const importTextModal = document.getElementById('import-text-modal');
    const importTextModalContent = document.getElementById('import-text-modal-content');
    const importTextTextarea = document.getElementById('import-text-textarea');
    const importTextConfirmBtn = document.getElementById('import-text-confirm-btn');
    const importTextCancelBtn = document.getElementById('import-text-cancel-btn');
    
    // --- NOVOS SELETORES ---
    const detalhesFavoritoBtn = document.getElementById('detalhes-favorito-btn'); 
    const detalhesFavoritoIconEmpty = document.getElementById('detalhes-favorito-icon-empty'); 
    const detalhesFavoritoIconFilled = document.getElementById('detalhes-favorito-icon-filled'); 
    const watchlistListaEl = document.getElementById('watchlist-lista'); 
    const watchlistStatusEl = document.getElementById('watchlist-status'); 
    // --- FIM NOVOS SELETORES ---

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

    // --- NOVAS VARIÁVEIS GLOBAIS DE AUTH ---
    let supabase = null;
    let currentUser = null;
    let appStateInterval = null; // Timer para salvar o appState
    // --- FIM DAS NOVAS VARIÁVEIS ---

    // --- FUNÇÕES DE AUTH ---

    // 1. Busca as chaves e inicializa o Supabase
    async function initSupabase() {
        try {
            const response = await fetch('/api/config');
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Falha ao buscar configuração do servidor.');
            }
            const config = await response.json();
            
            if (!config.supabaseUrl || !config.supabaseKey) {
                throw new Error('Configuração do Supabase incompleta.');
            }

            // Inicializa o cliente Supabase
            // (Usando a sintaxe global do CDN: supabase.createClient)
            supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);
            console.log("Supabase inicializado.");
            return true;

        } catch (error) {
            console.error("Erro fatal ao inicializar Supabase:", error);
            showAuthError('login-error', `Erro de conexão: ${error.message}`);
            return false;
        }
    }

    // 2. Mostra erros nos formulários de login/registro
    function showAuthError(elementId, message) {
        const el = document.getElementById(elementId);
        if (el) {
            el.textContent = message;
            el.classList.remove('hidden');
        }
    }
    function hideAuthMessages() {
        loginError.classList.add('hidden');
        registerError.classList.add('hidden');
        registerSuccess.classList.add('hidden');
    }

    // 3. Funções para trocar entre os formulários
    function showAuthForm(formToShow) {
        hideAuthMessages();
        if (formToShow === 'register') {
            loginForm.classList.add('form-out');
            setTimeout(() => {
                loginForm.classList.add('hidden');
                loginForm.classList.remove('form-out');
                
                registerForm.classList.remove('hidden');
                registerForm.classList.add('form-in');
                registerEmailInput.focus();
            }, 300);
        } else {
            registerForm.classList.add('form-out');
            setTimeout(() => {
                registerForm.classList.add('hidden');
                registerForm.classList.remove('form-out');
                
                loginForm.classList.remove('hidden');
                loginForm.classList.add('form-in');
                loginEmailInput.focus();
            }, 300);
        }
    }

    // 4. Esconde a tela de login
    function hideAuthPage() {
        authPage.classList.add('auth-hidden');
        logoutButton.classList.remove('hidden'); // Mostra o botão de logout
    }

    // 5. Mostra a tela de login (para logout)
    function showAuthPage() {
        // Limpa a carteira da tela
        listaCarteira.innerHTML = '';
        renderizarDashboardSkeletons(true);
        renderizarCarteiraSkeletons(true);
        carteiraStatus.classList.remove('hidden');
        carteiraMensagem.textContent = "Você foi desconectado.";
        dashboardLoading.classList.add('hidden');
        logoutButton.classList.add('hidden'); // Esconde o botão de logout
        migrationButton.classList.add('hidden'); // Esconde o botão de migração
        
        // Reseta os forms
        loginEmailInput.value = '';
        loginPasswordInput.value = '';
        registerEmailInput.value = '';
        registerPasswordInput.value = '';
        showAuthForm('login');

        // Mostra a tela de login
        authPage.classList.remove('auth-hidden');

        // Para o timer de salvar o appState
        if (appStateInterval) clearInterval(appStateInterval);
    }

    // 6. Manipulador de Login
    async function handleLogin(e) {
        e.preventDefault();
        hideAuthMessages();
        loginButton.innerHTML = `<span class="loader-sm"></span>`;
        loginButton.disabled = true;

        const email = loginEmailInput.value;
        const password = loginPasswordInput.value;

        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email: email,
                password: password,
            });

            if (error) throw error;

            console.log("Login bem-sucedido:", data.user.email);
            currentUser = data.user;
            
            // Inicia o carregamento dos dados do usuário
            await loadUserSession();

        } catch (error) {
            console.error("Erro no login:", error.message);
            if (error.message.includes("Email not confirmed")) {
                 showAuthError('login-error', 'Email não confirmado. Verifique sua caixa de entrada.');
            } else {
                showAuthError('login-error', 'Email ou senha inválidos.');
            }
            loginButton.innerHTML = `Entrar`;
            loginButton.disabled = false;
        }
    }

    // 7. Manipulador de Registro
    async function handleRegister(e) {
        e.preventDefault();
        hideAuthMessages();
        registerButton.innerHTML = `<span class="loader-sm"></span>`;
        registerButton.disabled = true;

        const email = registerEmailInput.value;
        const password = registerPasswordInput.value;

        try {
            const { data, error } = await supabase.auth.signUp({
                email: email,
                password: password,
            });

            if (error) throw error;

            console.log("Registro bem-sucedido:", data.user.email);
            registerSuccess.textContent = "Sucesso! Verifique seu email para confirmar a conta.";
            registerSuccess.classList.remove('hidden');
            registerForm.reset();

        } catch (error) {
            console.error("Erro no registro:", error.message);
            let userMessage = "Erro ao criar conta.";
            if (error.message.includes("Password should be at least 6 characters")) {
                userMessage = "A senha deve ter pelo menos 6 caracteres.";
            } else if (error.message.includes("User already registered")) {
                userMessage = "Este email já está cadastrado.";
            }
            showAuthError('register-error', userMessage);
        } finally {
            registerButton.innerHTML = `Criar conta`;
            registerButton.disabled = false;
        }
    }

    // 8. Manipulador de Logout
    async function handleLogout() {
        showModal('Sair', 'Tem certeza que deseja sair?', async () => {
            const { error } = await supabase.auth.signOut();
            if (error) {
                console.error("Erro ao sair:", error);
                showToast("Erro ao tentar sair.");
            } else {
                currentUser = null;
                showAuthPage();
            }
        });
    }

    // --- FIM DAS FUNÇÕES DE AUTH ---

    function showUpdateBar() {
        console.log('Mostrando aviso de atualização.');
        updateNotification.classList.remove('hidden');
        setTimeout(() => {
            updateNotification.style.opacity = '1';
            updateNotification.style.transform = 'translateY(0) translateX(-50%)'; 
        }, 10);
    }

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').then(registration => {
            console.log('SW registrado com sucesso:', registration.scope);
            registration.addEventListener('updatefound', () => {
                console.log('[PWA] Nova versão do SW encontrada, instalando...');
                newWorker = registration.installing;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        console.log('[PWA] Novo SW está "esperando" para ativar.');
                        showUpdateBar();
                    }
                });
            });
        });

        updateButton.addEventListener('click', () => {
            console.log('[PWA] Usuário clicou em Atualizar. Enviando SKIP_WAITING...');
            updateButton.textContent = 'A atualizar...';
            updateButton.disabled = true;
            if (newWorker) {
                newWorker.postMessage({ action: 'SKIP_WAITING' });
            }
        });

        navigator.serviceWorker.addEventListener('controllerchange', () => {
            console.log('[PWA] Novo SW ativado! Recarregando a página...');
            window.location.reload();
        });
    } else {
        console.log('Service Worker não é suportado neste navegador.');
    }
    
    async function setCache(key, data, duration = CACHE_DURATION) { 
        const cacheItem = { key: key, timestamp: Date.now(), data: data, duration: duration };
        try { 
            await vestoDB.put('apiCache', cacheItem);
        } 
        catch (e) { 
            console.error("Erro ao salvar no cache IDB:", e); 
        }
    }
    
    async function removerCacheAtivo(symbol) {
        console.log(`A limpar cache específico para: ${symbol}`);
        try {
            await vestoDB.delete('apiCache', `preco_${symbol}`);
            await vestoDB.delete('apiCache', `provento_ia_${symbol}`);
            await vestoDB.delete('apiCache', `detalhe_preco_${symbol}`);
            
            await vestoDB.delete('apiCache', `hist_ia_${symbol}_12`); 
            
            if (isFII(symbol)) {
                 await vestoDB.delete('apiCache', 'cache_grafico_historico');
            }

        } catch (e) {
            console.error("Erro ao remover cache do ativo:", e);
        }
    }
    
    // REMOVIDO: removerProventosConhecidos (agora é tratado no Supabase)
    
    async function getCache(key) {
        try {
            const cacheItem = await vestoDB.get('apiCache', key);
            if (!cacheItem) return null;
            
            const duration = cacheItem.duration ?? CACHE_DURATION; 
            if (duration === -1) { return cacheItem.data; }
            
            const isExpired = (Date.now() - cacheItem.timestamp) > duration;
            if (isExpired) { 
                await vestoDB.delete('apiCache', key); 
                return null; 
            }
            return cacheItem.data;
        } catch (e) {
            console.error("Erro ao ler cache IDB:", e);
            return null;
        }
    }
    
    async function clearBrapiCache() {
        console.warn("A limpar cache da Brapi e Notícias (IDB)...");
        await vestoDB.clear('apiCache');
    }
    
    function getSaoPauloDateTime() {
        try {
            const spTimeStr = new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' });
            const spDate = new Date(spTimeStr);
            const dayOfWeek = spDate.getDay(); 
            const hour = spDate.getHours();
            return { dayOfWeek, hour };
        } catch (e) {
            console.error("Erro ao obter fuso horário de São Paulo, usando fuso local.", e);
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
    
    function showImportModal() {
        showModal(
            'Restaurar Backup (Nuvem)',
            'Isso irá apagar seus dados na nuvem e substituir pelo backup. Use "Copiar Dados" para gerar um backup primeiro.',
            () => {
                 importTextModal.classList.add('visible');
                 importTextModalContent.classList.remove('modal-out');
                 importTextTextarea.focus();
            }
        );
    }
    
    function hideImportModal() {
        importTextModalContent.classList.add('modal-out');
        setTimeout(() => {
            importTextModal.classList.remove('visible');
            importTextModalContent.classList.remove('modal-out');
            importTextTextarea.value = '';
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
    
    // --- FUNÇÕES DE CARREGAMENTO DE DADOS (SUPABASE) ---

    async function carregarTransacoesSupabase() {
        const { data, error } = await supabase
            .from('transacoes')
            .select('*')
            .order('date', { ascending: false });
            
        if (error) {
            console.error("Erro ao carregar transações:", error);
            showToast("Erro ao carregar transações.");
            return [];
        }
        // Converte o ID para o formato que o app espera (era 'id' e 'date')
        return data.map(tx => ({ ...tx, id: tx.id, date: tx.date })); 
    }
    
    async function carregarWatchlistSupabase() {
        const { data, error } = await supabase
            .from('watchlist')
            .select('symbol, created_at');
            
        if (error) {
            console.error("Erro ao carregar watchlist:", error);
            showToast("Erro ao carregar watchlist.");
            return [];
        }
        // Converte o nome da coluna para o que o app espera
        return data.map(item => ({ symbol: item.symbol, addedAt: item.created_at }));
    }
    
    async function carregarPatrimonioSupabase() {
        const { data, error } = await supabase
            .from('user_patrimonio')
            .select('date, value')
            .order('date', { ascending: true });
            
        if (error) {
            console.error("Erro ao carregar patrimônio:", error);
            showToast("Erro ao carregar patrimônio.");
            return [];
        }
        return data; // Formato já é (date, value)
    }
    
    async function carregarAppStateSupabase() {
        const { data, error } = await supabase
            .from('user_app_state')
            .select('saldo_caixa, meses_processados')
            .single(); // Espera apenas 1 resultado (ou nulo)

        if (error && error.code !== 'PGRST116') { // Ignora erro "0 rows"
            console.error("Erro ao carregar AppState:", error);
            showToast("Erro ao carregar perfil.");
            return { saldo: 0, meses: [] };
        }
        
        if (!data) {
             // Usuário novo, trigger ainda pode não ter rodado, ou falhou
             console.warn("Nenhum app_state encontrado (usuário novo).");
             return { saldo: 0, meses: [] };
        }

        // Converte nomes de colunas
        return { saldo: data.saldo_caixa, meses: data.meses_processados };
    }
    
    async function carregarProventosConhecidosSupabase() {
        const { data, error } = await supabase
            .from('user_proventos_conhecidos')
            .select('*');
            
        if (error) {
            console.error("Erro ao carregar proventos conhecidos:", error);
            showToast("Erro ao carregar proventos.");
            return [];
        }
        // Converte nomes de colunas
        return data.map(p => ({ ...p, paymentDate: p.payment_date }));
    }
    
    // --- FUNÇÕES DE ESCRITA DE DADOS (SUPABASE) ---

    let appStateDirty = false;
    async function salvarAppStateSupabase() {
        if (!appStateDirty) return; // Nada para salvar
        if (!currentUser) return;
        
        appStateDirty = false; // Reseta
        console.log("Salvando AppState na nuvem...", { saldoCaixa, mesesProcessados });
        
        const { error } = await supabase
            .from('user_app_state')
            .upsert({ 
                user_id: currentUser.id, // Chave primária
                saldo_caixa: saldoCaixa, 
                meses_processados: mesesProcessados,
                updated_at: new Date().toISOString()
            });
            
        if (error) {
            console.error("Erro ao salvar AppState:", error);
            showToast("Erro ao salvar perfil na nuvem.");
            appStateDirty = true; // Tenta salvar de novo no próximo ciclo
        }
    }
    // Função para "marcar" que precisa salvar
    function requestSalvarAppState() {
        appStateDirty = true;
    }
    
    async function salvarSnapshotPatrimonio(totalValor) {
        if (!currentUser) return;
        if (totalValor <= 0 && patrimonio.length === 0) return; 
        const today = new Date().toISOString().split('T')[0];
        
        const snapshot = { 
            user_id: currentUser.id,
            date: today, 
            value: totalValor 
        };
        
        const { error } = await supabase
            .from('user_patrimonio')
            .upsert(snapshot); // 'upsert' = insere ou atualiza se já existir

        if (error) {
            console.error("Erro ao salvar snapshot do patrimônio:", error);
            showToast("Erro ao salvar gráfico de patrimônio.");
        }
        
        // Atualiza o estado local (igual a antes)
        const index = patrimonio.findIndex(p => p.date === today);
        if (index > -1) {
            patrimonio[index].value = totalValor;
        } else {
            patrimonio.push(snapshot);
        }
    }

    // --- LÓGICA DE CÁLCULO (sem mudanças) ---
    function calcularCarteira() {
        const ativosMap = new Map();
        const transacoesOrdenadas = [...transacoes].sort((a, b) => new Date(a.date) - new Date(b.date));

        for (const t of transacoesOrdenadas) {
            // if (t.type !== 'buy') continue; // No futuro, podemos ter 'sell'
            const symbol = t.symbol;
            let ativo = ativosMap.get(symbol) || { 
                symbol: symbol, 
                quantity: 0, 
                totalCost: 0, 
                dataCompra: t.date // Usa a data da primeira transação
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

    // --- FUNÇÕES DE RENDERIZAÇÃO DE GRÁFICOS (sem mudanças) ---
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
    
    // --- FUNÇÕES DE RENDERIZAÇÃO DE UI (Skeletons, Carteira, etc.) ---
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
            if (!symbolsNaCarteira.has(card.dataset.symbol)) card.remove();
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
                dadoPreco, precoFormatado, variacaoFormatada, corVariacao,
                totalPosicao, custoTotal, lucroPrejuizo, lucroPrejuizoPercent,
                corPL, bgPL, dadoProvento
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
            listaHistorico.appendChild(card);
        });
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
            
            const drawerContentHtml = `
                <p class="news-card-summary">
                    ${article.summary || 'Resumo da notícia não disponível.'}
                </p>
                ${tagsHtml}
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
                     <button class"p-1 text-gray-500 hover:text-white transition-colors rounded-full hover:bg-gray-700 flex-shrink-0 ml-2" 
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
            fiiNewsList.appendChild(newsCard);
        });
    }

    async function handleAtualizarNoticias(force = false) {
        const cacheKey = 'noticias_json_v4';
        
        if (!force) {
            const cache = await getCache(cacheKey);
            if (cache) {
                console.log("Usando notícias do cache (sem skeleton).");
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
            console.log("Buscando notícias na rede (BFF)...");
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
            
            if (articles && Array.isArray(articles)) {
                await setCache(cacheKey, articles, CACHE_6_HORAS);
            }
            return articles;
        } catch (error) {
            console.error("Erro ao buscar notícias (BFF):", error);
            throw error;
        }
    }
    
    // --- LÓGICA DE PROVENTOS ---

    // **** FUNÇÃO RESTAURADA ****
    function processarProventosIA(proventosDaIA = []) {
        const hoje = new Date(); 
        hoje.setHours(0, 0, 0, 0);
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

        return proventosDaIA
            .map(proventoIA => {
                const ativoCarteira = carteiraCalculada.find(a => a.symbol === proventoIA.symbol);
                if (!ativoCarteira) return null;
                
                // Supabase envia payment_date, mas o app usa paymentDate
                const paymentDate = proventoIA.paymentDate || proventoIA.payment_date;

                if (paymentDate && typeof proventoIA.value === 'number' && proventoIA.value > 0 && dateRegex.test(paymentDate)) {
                    const parts = paymentDate.split('-');
                    const dataPagamento = new Date(parts[0], parts[1] - 1, parts[2]); 
                    
                    if (!isNaN(dataPagamento) && dataPagamento >= hoje) {
                        // Garante que o formato de retorno é o que o app espera
                        return { ...proventoIA, paymentDate: paymentDate };
                    }
                }
                return null; 
            })
            .filter(p => p !== null);
    }
    // **** FIM DA FUNÇÃO RESTAURADA ****

    async function buscarProventosFuturos(force = false) {
        const fiiNaCarteira = carteiraCalculada
            .filter(a => isFII(a.symbol))
            .map(a => a.symbol);
        if (fiiNaCarteira.length === 0) return [];

        let proventosPool = [...proventosConhecidos];
        let fiisParaBuscar = [];

        for (const symbol of fiiNaCarteira) {
            const cacheKey = `provento_ia_${symbol}`;
            if (force) {
                await vestoDB.delete('apiCache', cacheKey);
                proventosPool = proventosPool.filter(p => p.symbol !== symbol);
                // Deleta da nuvem (apenas os não processados)
                await supabase
                    .from('user_proventos_conhecidos')
                    .delete()
                    .match({ user_id: currentUser.id, symbol: symbol, processado: false });
            }
            
            const proventoCache = await getCache(cacheKey);
            if (proventoCache) {
                // Se está no cache, já deve estar no proventosPool (carregado da nuvem)
                // Apenas nos certificamos de que será buscado se não estiver
                if (!proventosPool.some(p => p.symbol === symbol && (p.paymentDate || p.payment_date) === proventoCache.paymentDate)) {
                    fiisParaBuscar.push(symbol);
                }
            } else {
                fiisParaBuscar.push(symbol);
            }
        }
        
        // Remove duplicatas
        fiisParaBuscar = [...new Set(fiisParaBuscar)];

        if (fiisParaBuscar.length > 0) {
            try {
                const novosProventos = await callGeminiProventosCarteiraAPI(fiisParaBuscar, todayString);
                
                if (novosProventos && Array.isArray(novosProventos)) {
                    let proventosParaSalvarNuvem = [];
                    
                    for (const provento of novosProventos) {
                        if (provento && provento.symbol && provento.paymentDate && provento.value > 0) {
                            const cacheKey = `provento_ia_${provento.symbol}`;
                            await setCache(cacheKey, provento, CACHE_24_HORAS); 
                            
                            const idUnico = provento.symbol + '_' + provento.paymentDate;
                            const existe = proventosPool.some(p => p.id === idUnico);
                            
                            if (!existe) {
                                const novoProvento = { 
                                    id: idUnico,
                                    user_id: currentUser.id,
                                    symbol: provento.symbol,
                                    paymentDate: provento.paymentDate, // app usa paymentDate
                                    value: provento.value,
                                    processado: false 
                                };
                                proventosPool.push(novoProvento);
                                // Prepara para salvar na nuvem
                                proventosParaSalvarNuvem.push({
                                    id: novoProvento.id,
                                    user_id: novoProvento.user_id,
                                    symbol: novoProvento.symbol,
                                    payment_date: novoProvento.paymentDate, // supabase usa payment_date
                                    value: novoProvento.value,
                                    processado: novoProvento.processado
                                });
                            }
                        }
                    }
                    
                    // Salva todos os novos proventos na nuvem de uma vez
                    if (proventosParaSalvarNuvem.length > 0) {
                        const { error } = await supabase.from('user_proventos_conhecidos').insert(proventosParaSalvarNuvem);
                        if (error) {
                            console.error("Erro ao salvar novos proventos:", error);
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
        const cacheKey = 'cache_grafico_historico';
        if (force) await vestoDB.delete('apiCache', cacheKey);
        
        let aiData = await getCache(cacheKey);

        if (!aiData) {
            try {
                aiData = await callGeminiHistoricoPortfolioAPI(fiiSymbols, todayString);
                if (aiData && aiData.length > 0) {
                    await setCache(cacheKey, aiData, CACHE_24_HORAS);
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
        
        const dataAtual = new Date();
        const mesAtual = dataAtual.getMonth();
        const anoAtual = dataAtual.getFullYear();

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
            }
            
            return totalMes;
        });

        if (precisaSalvarCaixa) {
            requestSalvarAppState(); // Marca para salvar na nuvem
            totalCaixaValor.textContent = formatBRL(saldoCaixa);
        }

        return { labels, data };
    }
    
    // --- LÓGICA DE ATUALIZAÇÃO PRINCIPAL ---
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
        if (force) refreshIcon.classList.add('spin-animation');

        if (!force) {
            // Usa a função corrigida
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
            if (precos.length > 0) precosAtuais = precos; 
            await renderizarCarteira(); 
        }).catch(async err => {
            console.error("Erro ao buscar preços (BFF):", err);
            showToast("Erro ao buscar preços."); 
            if (precosAtuais.length === 0) await renderizarCarteira();
        });

        promessaProventos.then(async proventosFuturos => {
            proventosAtuais = proventosFuturos; 
            renderizarProventos(); 
            if (precosAtuais.length > 0) await renderizarCarteira(); 
        }).catch(err => {
            console.error("Erro ao buscar proventos (BFF):", err);
            showToast("Erro ao buscar proventos."); 
            if (proventosAtuais.length === 0) totalProventosEl.textContent = "Erro";
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
            console.log("Sincronização de CARTEIRA terminada.");
            refreshIcon.classList.remove('spin-animation');
            dashboardStatus.classList.add('hidden');
            dashboardLoading.classList.add('hidden');
        }
    }
    
    // --- FUNÇÕES DE CRUD (SUPABASE) ---
    
    async function handleToggleFavorito() {
        const symbol = detalhesFavoritoBtn.dataset.symbol;
        if (!symbol || !currentUser) return;

        const isFavorite = watchlist.some(item => item.symbol === symbol);

        try {
            if (isFavorite) {
                // Remover do Supabase
                const { error } = await supabase
                    .from('watchlist')
                    .delete()
                    .match({ user_id: currentUser.id, symbol: symbol });
                
                if (error) throw error;
                
                watchlist = watchlist.filter(item => item.symbol !== symbol);
                showToast(`${symbol} removido dos favoritos.`);
            } else {
                // Adicionar ao Supabase
                const newItem = { user_id: currentUser.id, symbol: symbol };
                const { data, error } = await supabase
                    .from('watchlist')
                    .insert(newItem)
                    .select()
                    .single(); // Espera um único resultado
                
                if (error) throw error;

                // Adiciona o item retornado (com created_at) ao estado local
                watchlist.push({ symbol: data.symbol, addedAt: data.created_at });
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
        if (!currentUser) return;
        
        let ticker = tickerInput.value.trim().toUpperCase();
        let novaQuantidade = parseInt(quantityInput.value, 10);
        let novoPreco = parseFloat(precoMedioInput.value.replace(',', '.')); 
        let dataTransacao = dateInput.value;
        let transacaoID = transacaoIdInput.value; // Este será o UUID do Supabase se estiver editando

        if (ticker.endsWith('.SA')) ticker = ticker.replace('.SA', '');

        if (!ticker || !novaQuantidade || novaQuantidade <= 0 || !novoPreco || novoPreco < 0 || !dataTransacao) { 
            showToast("Preencha todos os campos."); 
            return;
        }
        
        addButton.innerHTML = `<span class="loader-sm"></span>`;
        addButton.disabled = true;

        // Validação de Ticker (só para novos ativos)
        if (!transacaoID) {
            const ativoExistente = carteiraCalculada.find(a => a.symbol === ticker);
            if (!ativoExistente) {
                try {
                     const tickerParaApi = isFII(ticker) ? `${ticker}.SA` : ticker;
                     const quoteData = await fetchBFF(`/api/brapi?path=/quote/${tickerParaApi}?range=1d&interval=1d`);
                     if (!quoteData.results || quoteData.results[0].error) {
                         throw new Error(quoteData.results?.[0]?.error || 'Ativo não encontrado');
                     }
                } catch (error) {
                     showToast("Ativo não encontrado."); 
                     tickerInput.value = '';
                     addButton.innerHTML = `Adicionar`;
                     addButton.disabled = false;
                     return;
                }
            } 
        }
        
        const dataISO = new Date(dataTransacao + 'T12:00:00').toISOString();

        try {
            if (transacaoID) {
                // MODO EDIÇÃO
                const transacaoAtualizada = {
                    date: dataISO,
                    symbol: ticker,
                    quantity: novaQuantidade,
                    price: novoPreco
                };
                
                const { data, error } = await supabase
                    .from('transacoes')
                    .update(transacaoAtualizada)
                    .match({ id: transacaoID, user_id: currentUser.id })
                    .select() // Pede ao Supabase para retornar o registro atualizado
                    .single(); // Espera um único resultado
                    
                if (error) throw error;
                
                // Atualiza o estado local
                const index = transacoes.findIndex(t => t.id === transacaoID);
                if (index > -1) transacoes[index] = data;
                
                showToast("Transação atualizada!", 'success');
                
            } else {
                // MODO ADIÇÃO
                const novaTransacao = {
                    user_id: currentUser.id,
                    date: dataISO,
                    symbol: ticker,
                    quantity: novaQuantidade,
                    price: novoPreco
                };
                
                const { data, error } = await supabase
                    .from('transacoes')
                    .insert(novaTransacao)
                    .select() // Pede ao Supabase para retornar o registro criado
                    .single(); // Espera um único resultado
                
                if (error) throw error;
                
                // Adiciona o novo registro (com o UUID gerado) ao estado local
                transacoes.push(data);
                showToast("Ativo adicionado!", 'success');
            }

            hideAddModal();
            await removerCacheAtivo(ticker); 
            await atualizarTodosDados(false);

        } catch (error) {
            console.error("Erro ao salvar transação:", error);
            showToast(`Erro ao salvar: ${error.message}`);
        } finally {
            addButton.innerHTML = `Adicionar`;
            addButton.disabled = false;
        }
    }

    function handleRemoverAtivo(symbol) {
        if (!currentUser) return;
        
        showModal(
            'Remover Ativo', 
            `Tem certeza? Isso removerá ${symbol} e TODO o seu histórico de compras deste ativo.`, 
            async () => { 
                
                // Deleta transações do Supabase
                const { error: txError } = await supabase
                    .from('transacoes')
                    .delete()
                    .match({ user_id: currentUser.id, symbol: symbol });
                    
                if (txError) {
                    showToast(`Erro ao remover transações: ${txError.message}`);
                    return;
                }
                
                // Atualiza estado local
                transacoes = transacoes.filter(t => t.symbol !== symbol);

                // Limpa caches
                await removerCacheAtivo(symbol); 
                
                // Deleta proventos conhecidos
                await supabase
                    .from('user_proventos_conhecidos')
                    .delete()
                    .match({ user_id: currentUser.id, symbol: symbol });
                
                // Deleta da watchlist
                await supabase
                    .from('watchlist')
                    .delete()
                    .match({ user_id: currentUser.id, symbol: symbol });
                
                // Atualiza estado local
                proventosConhecidos = proventosConhecidos.filter(p => p.symbol !== symbol);
                watchlist = watchlist.filter(item => item.symbol !== symbol);
                
                renderizarWatchlist();
                await atualizarTodosDados(false); 
                showToast(`${symbol} removido com sucesso.`, 'success');
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
        transacaoIdInput.value = tx.id; // Agora é o UUID do Supabase
        tickerInput.value = tx.symbol;
        tickerInput.disabled = true;
        dateInput.value = formatDateToInput(tx.date);
        quantityInput.value = tx.quantity;
        precoMedioInput.value = tx.price;
        addButton.textContent = 'Salvar';
        
        showAddModal();
    }
    
    function handleExcluirTransacao(id, symbol) {
        if (!currentUser) return;
        
        const tx = transacoes.find(t => t.id === id);
        if (!tx) {
             showToast("Erro: Transação não encontrada.");
             return;
        }

        const msg = `Excluir esta compra?\n\nAtivo: ${tx.symbol}\nData: ${formatDate(tx.date)}`;
        
        showModal('Excluir Transação', msg, async () => { 
            
            // Deleta do Supabase
            const { error } = await supabase
                .from('transacoes')
                .delete()
                .match({ id: id, user_id: currentUser.id });
                
            if (error) {
                showToast(`Erro ao excluir: ${error.message}`);
                return;
            }

            // Atualiza estado local
            transacoes = transacoes.filter(t => t.id !== id);
            
            await removerCacheAtivo(symbol);
            
            // Verifica se foi a última transação
            const outrasTransacoes = transacoes.some(t => t.symbol === symbol);
            if (!outrasTransacoes) {
                proventosConhecidos = proventosConhecidos.filter(p => p.symbol !== symbol);
                
                const isFavorite = watchlist.some(item => item.symbol === symbol);
                if (isFavorite) {
                    setTimeout(() => {
                         showModal(
                            'Manter na Watchlist?',
                            `${symbol} não está mais na sua carteira. Deseja mantê-lo na sua watchlist?`,
                            () => {} // Apenas fecha
                        );
                    }, 300);
                }
            }
            
            await atualizarTodosDados(false); 
            showToast("Transação excluída.", 'success');
        });
    }
    
    // --- LÓGICA DE DETALHES (sem mudanças, exceto watchlist) ---
    
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
        if (detalhesChartInstance) { detalhesChartInstance.destroy(); detalhesChartInstance = null; }
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
                if (precoData && !precoData.error) await setCache(cacheKeyPreco, precoData); 
                else throw new Error(precoData?.error || 'Ativo não encontrado');
            } catch (e) { precoData = null; showToast("Erro ao buscar preço."); }
        }

        if (isFII(symbol)) {
            detalhesHistoricoContainer.classList.remove('hidden'); 
            fetchHistoricoIA(symbol); 
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
        const txsDoAtivo = transacoes.filter(t => t.symbol === symbol).sort((a, b) => new Date(b.date) - new Date(a.date));
    
        if (txsDoAtivo.length === 0) {
            vazioMsg.classList.remove('hidden');
            listaContainer.classList.add('hidden');
        } else {
            vazioMsg.classList.add('hidden');
            listaContainer.classList.remove('hidden');
            txsDoAtivo.forEach(t => { 
                const card = document.createElement('div');
                card.className = 'card-bg p-3 rounded-lg flex items-center justify-between';
                card.innerHTML = `
                    <div class="flex items-center gap-3">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                            <p class="text-sm font-semibold text-white">Compra</p>
                            <p class="text-xs text-gray-400">${formatDate(t.date)}</p>
                        </div>
                    </div>
                    <div class="text-right">
                        <p class="text-sm font-semibold text-green-500">+${t.quantity} Cotas</p>
                        <p class="text-xs text-gray-400">${formatBRL(t.price)}</p>
                    </div>
                `;
                listaContainer.appendChild(card);
            });
        }
        container.classList.remove('hidden');
    }
    
    async function fetchHistoricoIA(symbol) {
        detalhesAiProvento.innerHTML = `<div id="historico-periodo-loading" class="space-y-3 animate-shimmer-parent pt-2 h-48"><div class="h-4 bg-gray-700 rounded-md w-3/4"></div><div class="h-4 bg-gray-700 rounded-md w-1/2"></div></div>`;
        try {
            const cacheKey = `hist_ia_${symbol}_12`;
            let aiResultJSON = await getCache(cacheKey);
            if (!aiResultJSON) {
                aiResultJSON = await callGeminiHistoricoAPI(symbol, todayString); 
                if (aiResultJSON && Array.isArray(aiResultJSON)) {
                    await setCache(cacheKey, aiResultJSON, CACHE_24_HORAS);
                } else { aiResultJSON = []; }
            }
            currentDetalhesHistoricoJSON = aiResultJSON;
            renderHistoricoIADetalhes(3);
        } catch (e) {
            showToast("Erro na consulta IA."); 
            detalhesAiProvento.innerHTML = `<div class="border border-red-700 bg-red-900/50 p-4 rounded-lg flex items-center gap-3"><svg ...></svg><div><h5 ...>Erro na Consulta</h5><p ...>${e.message}</p></div></div>`;
        }
    }
    
    function renderHistoricoIADetalhes(meses) {
        if (!currentDetalhesHistoricoJSON) return;
        if (currentDetalhesHistoricoJSON.length === 0) {
            detalhesAiProvento.innerHTML = `<p class="text-sm text-gray-100 bg-gray-800 p-3 rounded-lg">Não foi possível encontrar o histórico de proventos.</p>`;
            if (detalhesChartInstance) { detalhesChartInstance.destroy(); detalhesChartInstance = null; }
            return;
        }
        if (!document.getElementById('detalhes-proventos-chart')) {
             detalhesAiProvento.innerHTML = `<div class="relative h-48 w-full"><canvas id="detalhes-proventos-chart"></canvas></div>`;
        }
        const dadosFiltrados = currentDetalhesHistoricoJSON.slice(0, meses).reverse();
        const labels = dadosFiltrados.map(item => item.mes);
        const data = dadosFiltrados.map(item => item.valor);
        renderizarGraficoProventosDetalhes({ labels, data });
    }
    
    function mudarAba(tabId) {
        tabContents.forEach(content => content.classList.toggle('active', content.id === tabId));
        tabButtons.forEach(button => button.classList.toggle('active', button.dataset.tab === tabId));
        showAddModalBtn.classList.toggle('hidden', tabId !== 'tab-carteira');
    }
    
    // --- FUNÇÕES DA API (BFF) ---
    async function fetchBFF(url, options = {}) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); 
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeoutId); 
            if (!response.ok) {
                const errorBody = await response.json();
                throw new Error(errorBody.error || `Erro do servidor: ${response.statusText}`);
            }
            return response.json();
        } catch (error) {
            if (error.name === 'AbortError') throw new Error("O servidor demorou muito para responder.");
            throw error;
        }
    }
    
    async function callGeminiHistoricoAPI(ticker, todayString) { 
        const body = { mode: 'historico_12m', payload: { ticker, todayString } };
        const response = await fetchBFF('/api/gemini', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return response.json; 
    }
    
    async function callGeminiProventosCarteiraAPI(fiiList, todayString) {
        const body = { mode: 'proventos_carteira', payload: { fiiList, todayString } };
        const response = await fetchBFF('/api/gemini', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return response.json; 
    }
    
    async function callGeminiHistoricoPortfolioAPI(fiiList, todayString) {
         const body = { mode: 'historico_portfolio', payload: { fiiList, todayString } };
         const response = await fetchBFF('/api/gemini', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return response.json; 
    }

    // --- FUNÇÕES DE BACKUP/MIGRAÇÃO ---
    async function handleShareCarteira() {
        if (transacoes.length === 0) { showToast("Sua carteira está vazia."); return; }
        const loaderIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 spin-animation"><path d="M21 2v6h-6"></path><path d="M3 22v-6h6"></path><path d="M21 13a9 9 0 0 1-9 9H3"></path><path d="M3 11a9 9 0 0 1 9-9h9"></path></svg>`;
        const originalIcon = compartilharCarteiraBtn.innerHTML;
        compartilharCarteiraBtn.innerHTML = loaderIcon;
        compartilharCarteiraBtn.disabled = true;
        try {
            const transacoesPublicas = transacoes.map(t => ({
                symbol: t.symbol, date: t.date, quantity: t.quantity, price: t.price, type: 'buy'
            }));
            const response = await fetch('/api/set-share', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transacoes: transacoesPublicas })
            });
            if (!response.ok) { const e = await response.json(); throw new Error(e.error); }
            const { shareId } = await response.json();
            const url = `${window.location.origin}/public.html?id=${shareId}`;
            showModal('Link Gerado!', `Seu link público foi criado e irá expirar em 30 dias.\n\n ${url}`, () => {
                navigator.clipboard.writeText(url)
                    .then(() => showToast("Link copiado!", 'success'))
                    .catch(() => showToast("Não foi possível copiar o link."));
            });
            customModalOk.textContent = 'OK (Copiar Link)';
        } catch (error) {
            showToast(error.message || "Erro desconhecido ao gerar link.");
        } finally {
            compartilharCarteiraBtn.innerHTML = originalIcon;
            compartilharCarteiraBtn.disabled = false;
            customModalOk.textContent = 'Confirmar';
        }
    }

    async function handleCopiarDados() {
        if (!currentUser) return;
        copiarDadosBtn.disabled = true;
        try {
            const exportData = {
                transacoes: transacoes,
                watchlist: watchlist,
                user_patrimonio: patrimonio,
                user_proventos_conhecidos: proventosConhecidos,
                user_app_state: [{ saldo_caixa: saldoCaixa, meses_processados: mesesProcessados }]
            };
            const bundle = {
                version: 'vesto-v2-supabase', exportedAt: new Date().toISOString(), data: exportData
            };
            await navigator.clipboard.writeText(JSON.stringify(bundle));
            showToast("Backup da nuvem copiado!", 'success'); 
        } catch (err) {
            showToast("Erro ao copiar dados."); 
        } finally {
            copiarDadosBtn.disabled = false;
        }
    }

    async function handleImportarTexto() {
        if (!currentUser) return;
        const texto = importTextTextarea.value;
        if (!texto) { showToast("Área de texto vazia."); return; }
        try {
            const backup = JSON.parse(texto);
            if (!backup.version || !backup.data) throw new Error("Texto de backup inválido.");
            hideImportModal(); 
            setTimeout(() => { 
                 showModal(
                    'Importar Backup?',
                    'Atenção: Isso irá APAGAR todos os seus dados da NUVEM e substituí-los pelo backup. Esta ação não pode ser desfeita.',
                    () => { importarDadosSupabase(backup.data); }
                );
            }, 250);
        } catch (err) { showToast(err.message || "Erro ao ler texto."); }
    }

    async function importarDadosSupabase(data) {
        if (!currentUser) return;
        importTextConfirmBtn.textContent = 'A importar...';
        importTextConfirmBtn.disabled = true;
        try {
            // Limpa dados antigos da nuvem
            await supabase.from('transacoes').delete().eq('user_id', currentUser.id);
            await supabase.from('watchlist').delete().eq('user_id', currentUser.id);
            await supabase.from('user_patrimonio').delete().eq('user_id', currentUser.id);
            await supabase.from('user_proventos_conhecidos').delete().eq('user_id', currentUser.id);
            await supabase.from('user_app_state').delete().eq('user_id', currentUser.id);

            // Prepara novos dados com o user_id
            const userId = currentUser.id;
            const transacoesNovas = (data.transacoes || []).map(t => ({...t, id: undefined, user_id: userId, legacy_id: t.id || null}));
            const watchlistNova = (data.watchlist || []).map(w => ({...w, id: undefined, user_id: userId}));
            const patrimonioNovo = (data.user_patrimonio || data.patrimonio || []).map(p => ({...p, user_id: userId}));
            const proventosNovos = (data.user_proventos_conhecidos || data.proventosConhecidos || []).map(p => ({
                id: p.id, user_id: userId, symbol: p.symbol, 
                payment_date: p.paymentDate || p.payment_date, 
                value: p.value, processado: p.processado
            }));
            const appState = (data.user_app_state || [])[0] || (data.appState ? { saldo_caixa: data.appState[0]?.value || 0 } : { saldo_caixa: 0 });
            const appStateNovo = {
                user_id: userId,
                saldo_caixa: appState.saldo_caixa || 0,
                meses_processados: (data.historicoProcessado ? data.historicoProcessado[0]?.value : appState.meses_processados) || []
            };

            // Insere dados na nuvem
            if (transacoesNovas.length > 0) await supabase.from('transacoes').insert(transacoesNovas);
            if (watchlistNova.length > 0) await supabase.from('watchlist').insert(watchlistNova);
            if (patrimonioNovo.length > 0) await supabase.from('user_patrimonio').insert(patrimonioNovo);
            if (proventosNovos.length > 0) await supabase.from('user_proventos_conhecidos').insert(proventosNovos);
            await supabase.from('user_app_state').insert(appStateNovo);

            showToast("Dados importados com sucesso! Atualizando...", 'success');
            await loadUserSession();
        } catch (err) {
            showToast(`Erro grave ao importar dados: ${err.message}`); 
        } finally {
            importTextConfirmBtn.textContent = 'Restaurar';
            importTextConfirmBtn.disabled = false;
        }
    }
    
    // --- LÓGICA DE MIGRAÇÃO (IndexedDB -> Supabase) ---
    async function handleMigration() {
        if (!currentUser) return;
        migrationButton.innerHTML = `<span class="loader-sm"></span>`;
        migrationButton.disabled = true;

        try {
            console.log("Iniciando migração de dados locais...");
            const localDB = indexedDB.open(DB_NAME, DB_VERSION);
            localDB.onsuccess = async (event) => {
                const db = event.target.result;
                const getAllFromStore = (storeName) => {
                    return new Promise((resolve, reject) => {
                        if (!db.objectStoreNames.contains(storeName)) {
                            console.warn(`Store local ${storeName} não encontrado para migração.`);
                            return resolve([]);
                        }
                        const tx = db.transaction(storeName, 'readonly');
                        const request = tx.objectStore(storeName).getAll();
                        request.onsuccess = () => resolve(request.result);
                        request.onerror = (e) => reject(e.target.error);
                    });
                };

                // 2. Coleta dados locais
                const localTransacoes = await getAllFromStore('transacoes');
                const localWatchlist = await getAllFromStore('watchlist');
                const localPatrimonio = await getAllFromStore('patrimonio');
                const localProventos = await getAllFromStore('proventosConhecidos');
                const localAppState = (await getAllFromStore('appState')).find(s => s.key === 'saldoCaixa') || { value: 0 };
                const localHistProc = (await getAllFromStore('appState')).find(s => s.key === 'historicoProcessado') || { value: [] };

                // 3. Prepara para Supabase
                const userId = currentUser.id;
                const transacoesNovas = (localTransacoes || []).map(t => ({ user_id: userId, symbol: t.symbol, date: t.date, quantity: t.quantity, price: t.price, legacy_id: t.id }));
                const watchlistNova = (localWatchlist || []).map(w => ({ user_id: userId, symbol: w.symbol }));
                const patrimonioNovo = (localPatrimonio || []).map(p => ({ user_id: userId, date: p.date, value: p.value }));
                const proventosNovos = (localProventos || []).map(p => ({
                    id: p.id, user_id: userId, symbol: p.symbol, 
                    payment_date: p.paymentDate, value: p.value, processado: p.processado
                }));
                const appStateNovo = {
                    user_id: userId,
                    saldo_caixa: localAppState.value || 0,
                    meses_processados: localHistProc.value || []
                };

                // 4. Envia para Supabase (limpa antes)
                await supabase.from('transacoes').delete().eq('user_id', userId);
                await supabase.from('watchlist').delete().eq('user_id', userId);
                await supabase.from('user_patrimonio').delete().eq('user_id', userId);
                await supabase.from('user_proventos_conhecidos').delete().eq('user_id', userId);
                await supabase.from('user_app_state').delete().eq('user_id', userId);

                if (transacoesNovas.length > 0) await supabase.from('transacoes').insert(transacoesNovas);
                if (watchlistNova.length > 0) await supabase.from('watchlist').insert(watchlistNova);
                if (patrimonioNovo.length > 0) await supabase.from('user_patrimonio').insert(patrimonioNovo);
                if (proventosNovos.length > 0) await supabase.from('user_proventos_conhecidos').insert(proventosNovos);
                await supabase.from('user_app_state').insert(appStateNovo);
                
                showToast("Migração concluída! Atualizando...", 'success');
                migrationButton.classList.add('hidden');
                
                // 5. Deleta os stores locais antigos (exceto apiCache)
                const deleteDB = indexedDB.open(DB_NAME, DB_VERSION);
                deleteDB.onsuccess = (e) => {
                    const db = e.target.result;
                    db.close();
                    const nextVersion = db.version + 1;
                    const deleteReq = indexedDB.open(DB_NAME, nextVersion);
                    deleteReq.onupgradeneeded = (ev) => {
                        const upgradeDb = ev.target.result;
                        if (upgradeDb.objectStoreNames.contains('transacoes')) upgradeDb.deleteObjectStore('transacoes');
                        if (upgradeDb.objectStoreNames.contains('patrimonio')) upgradeDb.deleteObjectStore('patrimonio');
                        if (upgradeDb.objectStoreNames.contains('appState')) upgradeDb.deleteObjectStore('appState');
                        if (upgradeDb.objectStoreNames.contains('proventosConhecidos')) upgradeDb.deleteObjectStore('proventosConhecidos');
                        if (upgradeDb.objectStoreNames.contains('watchlist')) upgradeDb.deleteObjectStore('watchlist');
                        console.log("Stores locais antigos limpos após migração.");
                    };
                    deleteReq.onsuccess = (ev) => ev.target.result.close();
                };
                
                await loadUserSession();
            };
            localDB.onerror = (e) => { throw new Error('Não foi possível abrir o DB local para migração.'); };
        } catch (error) {
            console.error("Erro na migração:", error);
            showToast(`Erro na migração: ${error.message}`);
            migrationButton.innerHTML = `Migrar`;
            migrationButton.disabled = false;
        }
    }
    
    // --- LISTENERS DE UI ---
    refreshButton.addEventListener('click', () => atualizarTodosDados(true));
    refreshNoticiasButton.addEventListener('click', () => handleAtualizarNoticias(true));
    showAddModalBtn.addEventListener('click', showAddModal);
    emptyStateAddBtn.addEventListener('click', showAddModal);
    addAtivoCancelBtn.addEventListener('click', hideAddModal);
    addAtivoModal.addEventListener('click', (e) => { if (e.target === addAtivoModal) hideAddModal(); });
    addAtivoForm.addEventListener('submit', (e) => { e.preventDefault(); handleSalvarTransacao(); });
    listaCarteira.addEventListener('click', (e) => {
        const target = e.target.closest('button'); if (!target) return;
        const action = target.dataset.action, symbol = target.dataset.symbol;
        if (action === 'remove') handleRemoverAtivo(symbol);
        else if (action === 'details') showDetalhesModal(symbol);
        else if (action === 'toggle') {
            document.getElementById(`drawer-${symbol}`)?.classList.toggle('open');
            target.querySelector('.card-arrow-icon')?.classList.toggle('open');
        }
    });
    listaHistorico.addEventListener('click', (e) => {
        const target = e.target.closest('button'); if (!target) return;
        const action = target.dataset.action, id = target.dataset.id, symbol = target.dataset.symbol;
        if (action === 'edit') handleAbrirModalEdicao(id);
        else if (action === 'delete') handleExcluirTransacao(id, symbol);
    });
    dashboardDrawers.addEventListener('click', (e) => {
        const target = e.target.closest('button'); if (!target || !target.dataset.targetDrawer) return;
        document.getElementById(target.dataset.targetDrawer)?.classList.toggle('open');
        target.querySelector('.card-arrow-icon')?.classList.toggle('open');
    });
    if (watchlistToggleBtn) {
        watchlistToggleBtn.addEventListener('click', (e) => {
            const target = e.currentTarget;
            document.getElementById(target.dataset.targetDrawer)?.classList.toggle('open');
            target.querySelector('.card-arrow-icon')?.classList.toggle('open');
        });
    }
    tabButtons.forEach(button => button.addEventListener('click', () => mudarAba(button.dataset.tab)));
    customModalCancel.addEventListener('click', hideModal);
    customModalOk.addEventListener('click', () => { if (typeof onConfirmCallback === 'function') onConfirmCallback(); hideModal(); });
    customModal.addEventListener('click', (e) => { if (e.target === customModal) hideModal(); });
    detalhesVoltarBtn.addEventListener('click', hideDetalhesModal);
    detalhesPageModal.addEventListener('click', (e) => { if (e.target === detalhesPageModal) hideDetalhesModal(); });
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
        if (diff > 100) { hideDetalhesModal(); } 
        else { detalhesPageContent.style.transform = ''; }
        touchStartY = 0;
        touchMoveY = 0;
    });
    fiiNewsList.addEventListener('click', (e) => {
        const button = e.target.closest('button'); if (!button) return;
        const action = button.dataset.action;
        if (action === 'toggle-news') {
            document.getElementById(button.dataset.target)?.classList.toggle('open');
            button.querySelector('.card-arrow-icon')?.classList.toggle('open');
        } else if (action === 'view-ticker') {
            if (button.dataset.symbol) showDetalhesModal(button.dataset.symbol);
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
        const target = e.target.closest('.periodo-selector-btn'); if (!target) return;
        const meses = parseInt(target.dataset.meses, 10); if (meses === currentDetalhesMeses) return;
        currentDetalhesMeses = meses;
        periodoSelectorGroup.querySelectorAll('.periodo-selector-btn').forEach(btn => btn.classList.remove('active'));
        target.classList.add('active');
        renderHistoricoIADetalhes(currentDetalhesMeses);
    });
    
    // --- LISTENERS DE BACKUP E AUTH ---
    copiarDadosBtn.addEventListener('click', handleCopiarDados);
    abrirImportarModalBtn.addEventListener('click', showImportModal);
    compartilharCarteiraBtn.addEventListener('click', handleShareCarteira);
    importTextCancelBtn.addEventListener('click', hideImportModal);
    importTextConfirmBtn.addEventListener('click', handleImportarTexto);
    importTextModal.addEventListener('click', (e) => { if (e.target === importTextModal) hideImportModal(); });
    loginForm.addEventListener('submit', handleLogin);
    registerForm.addEventListener('submit', handleRegister);
    logoutButton.addEventListener('click', handleLogout);
    migrationButton.addEventListener('click', handleMigration); // Listener do botão de Migração
    showRegisterBtn.addEventListener('click', () => showAuthForm('register'));
    showLoginBtn.addEventListener('click', () => showAuthForm('login'));

    // --- FUNÇÕES DE INICIALIZAÇÃO ---
    
    async function loadUserSession() {
        hideAuthPage();
        renderizarDashboardSkeletons(true);
        renderizarCarteiraSkeletons(true);
        
        console.log("Sessão carregada, carregando dados da nuvem...");

        // 1. Carrega todos os dados do Supabase
        const [txData, wlData, patData, appStateData, provData] = await Promise.all([
            carregarTransacoesSupabase(),
            carregarWatchlistSupabase(),
            carregarPatrimonioSupabase(),
            carregarAppStateSupabase(),
            carregarProventosConhecidosSupabase()
        ]);

        transacoes = txData;
        watchlist = wlData;
        patrimonio = patData;
        saldoCaixa = appStateData.saldo;
        mesesProcessados = appStateData.meses;
        proventosConhecidos = provData;

        console.log("Dados da nuvem carregados:", { transacoes: transacoes.length, watchlist: watchlist.length, patrimonio: patrimonio.length, saldoCaixa, mesesProcessados: mesesProcessados.length, proventosConhecidos: proventosConhecidos.length });
        
        // 2. Inicia o loop para salvar o appState (saldo/meses)
        if (appStateInterval) clearInterval(appStateInterval);
        appStateInterval = setInterval(salvarAppStateSupabase, 10000);

        // 3. Renderiza o app com os dados da nuvem
        renderizarWatchlist();
        mudarAba('tab-dashboard'); 
        await atualizarTodosDados(false); 
        handleAtualizarNoticias(false); 
        
        // 4. Verifica se precisa de migração
        const localDBCheck = indexedDB.open(DB_NAME, DB_VERSION);
        localDBCheck.onsuccess = (event) => {
            const db = event.target.result;
            if (transacoes.length === 0 && db.objectStoreNames.contains('transacoes')) {
                const tx = db.transaction('transacoes', 'readonly');
                const countReq = tx.objectStore('transacoes').count();
                countReq.onsuccess = () => {
                    if (countReq.result > 0) {
                        console.log(`Dados locais encontrados (${countReq.result} transações). Oferecendo migração.`);
                        migrationButton.classList.remove('hidden');
                    }
                };
            }
        };
        localDBCheck.onerror = () => { /* falha silenciosa, não oferece migração */ };
    }

    async function checkUserSession() {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
            console.log("Usuário já está logado:", data.session.user.email);
            currentUser = data.session.user;
            await loadUserSession();
        } else {
            console.log("Nenhum usuário logado. Mostrando tela de login.");
            renderizarDashboardSkeletons(true);
            renderizarCarteiraSkeletons(true);
        }
    }

    async function init() {
        // 1. Inicializa o IndexedDB (APENAS PARA CACHE E MIGRAÇÃO)
        try {
            await vestoDB.init();
        } catch (e) {
            console.error("[IDB] Falha fatal ao inicializar o DB de Cache.", e);
            showAuthError('login-error', "Erro crítico: Banco de dados local não pôde ser carregado.");
            return; 
        }
        
        // 2. Inicializa o Supabase
        const supabaseReady = await initSupabase();
        
        // 3. Se o Supabase estiver pronto, verifica a sessão
        if (supabaseReady) {
            await checkUserSession();
            
            supabase.auth.onAuthStateChange((event, session) => {
                if (event === 'SIGNED_IN' && !currentUser) {
                    currentUser = session.user;
                    loadUserSession();
                } else if (event === 'SIGNED_OUT') {
                    currentUser = null;
                    showAuthPage();
                }
            });
        }
    }
    
    await init();
});
