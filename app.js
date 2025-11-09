// Configurações padrão do Chart.js
Chart.defaults.color = '#9ca3af'; 
Chart.defaults.borderColor = '#374151'; 

// Adiciona o listener para 'DOMContentLoaded' para garantir que o HTML
// seja carregado antes de o script rodar, já que estamos usando 'defer'.
document.addEventListener('DOMContentLoaded', async () => {
    
    // Constantes
    const REFRESH_INTERVAL = 1860000; // 31 minutos
    const CACHE_DURATION = 1000 * 60 * 30; // 30 minutos
    const CACHE_24_HORAS = 1000 * 60 * 60 * 24; // 24 horas
    const CACHE_6_HORAS = 1000 * 60 * 60 * 6; // 6 HORAS
    
    // ==========================================================
    // IndexedDB Wrapper
    // ==========================================================
    
    const DB_NAME = 'vestoDB';
    const DB_VERSION = 1;

    const vestoDB = {
        db: null,
        
        init() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, DB_VERSION);
                
                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    console.log('[IDB] Executando onupgradeneeded...');
                    
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
                        // ID será 'SYMBOL_PAYMENTDATE'
                        db.createObjectStore('proventosConhecidos', { keyPath: 'id' });
                    }
                    if (!db.objectStoreNames.contains('apiCache')) {
                        db.createObjectStore('apiCache', { keyPath: 'key' });
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
    
    // Elementos DOM
    const refreshButton = document.getElementById('refresh-button');
    const refreshNoticiasButton = document.getElementById('refresh-noticias-button');
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    const toastElement = document.getElementById('toast-notification');
    const toastMessageElement = document.getElementById('toast-message');
    const fiiNewsList = document.getElementById('fii-news-list');
    const fiiNewsSkeleton = document.getElementById('fii-news-skeleton');
    const fiiNewsMensagem = document.getElementById('fii-news-mensagem');
    const dashboardStatus = document.getElementById('dashboard-status');
    const dashboardLoading = document.getElementById('dashboard-loading');
    const dashboardMensagem = document.getElementById('dashboard-mensagem');
    const dashboardDrawers = document.getElementById('dashboard-drawers');
    const notifyButton = document.getElementById('request-notify-btn');
    const skeletonTotalValor = document.getElementById('skeleton-total-valor');
    const skeletonTotalCusto = document.getElementById('skeleton-total-custo');
    const skeletonTotalPL = document.getElementById('skeleton-total-pl');
    const skeletonTotalProventos = document.getElementById('skeleton-total-proventos');
    const totalCarteiraValor = document.getElementById('total-carteira-valor');
    const totalCarteiraCusto = document.getElementById('total-carteira-custo');
    const totalCarteiraPL = document.getElementById('total-carteira-pl');
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
    const tickerInput = document.getElementById('ticker-input');
    const quantityInput = document.getElementById('quantity-input');
    const precoMedioInput = document.getElementById('preco-medio-input'); 
    const addButton = document.getElementById('add-button');
    const updateNotification = document.getElementById('update-notification');
    const updateButton = document.getElementById('update-button');
    const copiarDadosBtn = document.getElementById('copiar-dados-btn');
    const abrirImportarModalBtn = document.getElementById('abrir-importar-modal-btn');
    const importTextModal = document.getElementById('import-text-modal');
    const importTextModalContent = document.getElementById('import-text-modal-content');
    const importTextTextarea = document.getElementById('import-text-textarea');
    const importTextConfirmBtn = document.getElementById('import-text-confirm-btn');
    const importTextCancelBtn = document.getElementById('import-text-cancel-btn');

    // Estado da App
    let transacoes = [];        
    let carteiraCalculada = []; 
    let patrimonio = [];
    let saldoCaixa = 0;
    let proventosConhecidos = [];
    let alocacaoChartInstance = null;
    let historicoChartInstance = null;
    let patrimonioChartInstance = null; 
    let onConfirmCallback = null; 
    let precosAtuais = [];
    let proventosAtuais = []; // Apenas proventos futuros
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
    
    let currentDetalhesSymbol = null;
    let currentDetalhesMeses = 3; 
    let currentDetalhesHistoricoJSON = null; 

    // ==========================================================
    // Notificações Toast
    // ==========================================================
    
    function showToast(message, type = 'error') {
        clearTimeout(toastTimer);
        toastMessageElement.textContent = message;

        // Reseta classes de cor
        toastElement.classList.remove(
            'bg-red-800', 'border-red-600',       // Classes de Erro
            'bg-green-700', 'border-green-500'    // Classes de Sucesso (AGORA VERDE)
        );
        
        // Aplica classes de cor com base no 'type'
        if (type === 'success') {
            toastElement.classList.add('bg-green-700', 'border-green-500'); // SUCESSO (VERDE)
        } else { // 'error' ou default
            toastElement.classList.add('bg-red-800', 'border-red-600'); // ERRO (VERMELHO)
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
        }, 1500); 
    }

    // ==========================================================
    // Service Worker (PWA)
    // ==========================================================
    
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
    
    // ==========================================================
    // Notificações Push
    // ==========================================================
    
    function checkNotificationPermission() {
        if (!('Notification' in window)) {
            console.warn('Este navegador não suporta notificações.');
            notifyButton.classList.add('hidden'); 
            return;
        }
        if (Notification.permission === 'granted') {
            notifyButton.classList.add('notify-on'); 
            notifyButton.title = "Notificações ativadas! Clique para testar.";
        } else if (Notification.permission === 'denied') {
            notifyButton.classList.add('notify-off'); 
            notifyButton.title = "Notificações bloqueadas.";
            notifyButton.disabled = true;
        } else {
            notifyButton.classList.remove('notify-on'); 
            notifyButton.title = "Clique para ativar as notificações.";
        }
    }

    function requestNotificationPermission() {
         if (Notification.permission === 'granted') {
            console.log('Permissão já concedida. Testando notificação...');
            testNotification();
            return;
         }
         if (Notification.permission === 'denied') {
            console.error('Notificações bloqueadas pelo usuário.');
            return;
         }
         Notification.requestPermission().then(permission => {
            console.log('Resultado da permissão:', permission);
            checkNotificationPermission(); 
            if (permission === 'granted') {
                testNotification(); 
            }
         });
    }
    
    function testNotification() {
        if (!('Notification' in window) || Notification.permission !== 'granted') {
            console.warn('Não é possível testar notificações. Permissão não concedida.');
            return;
        }
        const options = {
            body: 'Tudo pronto! Você será notificado sobre suas finanças.',
            icon: 'icons/icon-192x192.png',
            badge: 'icons/icon-192x192.png', 
            vibrate: [100, 50, 100],
        };
        navigator.serviceWorker.ready.then(registration => {
            registration.showNotification('Vesto está Ativado!', options);
        });
    }
    
    // ==========================================================
    // Funções de Cache (IndexedDB)
    // ==========================================================
    
    async function setCache(key, data, duration = CACHE_DURATION) { 
        const cacheItem = { key: key, timestamp: Date.now(), data: data, duration: duration };
        try { 
            await vestoDB.put('apiCache', cacheItem);
        } 
        catch (e) { 
            console.error("Erro ao salvar no cache IDB:", e); 
            await clearBrapiCache(); // Limpa cache em caso de erro (ex: QuotaExceeded)
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
    
    async function getCache(key) {
        const cacheItem = await vestoDB.get('apiCache', key);
        if (!cacheItem) return null;
        
        const duration = cacheItem.duration ?? CACHE_DURATION; 
        if (duration === -1) { return cacheItem.data; } // Cache perpétuo
        
        const isExpired = (Date.now() - cacheItem.timestamp) > duration;
        if (isExpired) { 
            await vestoDB.delete('apiCache', key); 
            return null; 
        }
        return cacheItem.data;
    }
    
    async function clearBrapiCache() {
        console.warn("A limpar cache da Brapi e Notícias (IDB)...");
        await vestoDB.clear('apiCache');
    }

    // ==========================================================
    // Funções Auxiliares
    // ==========================================================
    
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
            '#8B5CF6', '#6D28D9', '#A78BFA', '#4C1D95', '#3b82f6', 
            '#22c55e', '#f97316', '#ef4444', '#14b8a6', '#eab308'
        ];
        let cores = [];
        for (let i = 0; i < num; i++) { cores.push(PALETA_CORES[i % PALETA_CORES.length]); }
        return cores;
    }
    
    // ==========================================================
    // Funções dos Modais
    // ==========================================================
    
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
        tickerInput.focus();
    }
    
    function hideAddModal() {
        addAtivoModalContent.classList.add('modal-out');
        setTimeout(() => {
            addAtivoModal.classList.remove('visible');
            addAtivoModalContent.classList.remove('modal-out');
            tickerInput.value = '';
            quantityInput.value = '';
            precoMedioInput.value = '';
            tickerInput.classList.remove('border-red-500');
            quantityInput.classList.remove('border-red-500');
            precoMedioInput.classList.remove('border-red-500');
        }, 200);
    }
    
    function showImportModal() {
        importTextModal.classList.add('visible');
        importTextModalContent.classList.remove('modal-out');
        importTextTextarea.focus();
    }
    
    function hideImportModal() {
        importTextModalContent.classList.add('modal-out');
        setTimeout(() => {
            importTextModal.classList.remove('visible');
            importTextModalContent.classList.remove('modal-out');
            importTextTextarea.value = ''; // Limpa o textarea
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
    
    // ==========================================================
    // Funções de Dados (IndexedDB)
    // ==========================================================
    
    async function carregarTransacoes() {
        transacoes = await vestoDB.getAll('transacoes');
    }
    
    async function carregarPatrimonio() {
         let allPatrimonio = await vestoDB.getAll('patrimonio');
         allPatrimonio.sort((a, b) => new Date(a.date) - new Date(b.date));
         
         if (allPatrimonio.length > 365) {
            const toDelete = allPatrimonio.slice(0, allPatrimonio.length - 365);
            for (const item of toDelete) {
                await vestoDB.delete('patrimonio', item.date);
            }
            patrimonio = allPatrimonio.slice(allPatrimonio.length - 365);
         } else {
            patrimonio = allPatrimonio;
         }
    }
    
    async function salvarSnapshotPatrimonio(totalValor) {
        if (totalValor <= 0 && patrimonio.length === 0) return; 
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        
        const snapshot = { date: today, value: totalValor };
        await vestoDB.put('patrimonio', snapshot);
        
        // Atualiza o array em memória
        const index = patrimonio.findIndex(p => p.date === today);
        if (index > -1) {
            patrimonio[index].value = totalValor;
        } else {
            patrimonio.push(snapshot);
        }
    }

    async function carregarCaixa() {
        const caixaState = await vestoDB.get('appState', 'saldoCaixa');
        saldoCaixa = caixaState ? caixaState.value : 0;
    }

    async function salvarCaixa() {
        await vestoDB.put('appState', { key: 'saldoCaixa', value: saldoCaixa });
    }

    async function carregarProventosConhecidos() {
        proventosConhecidos = await vestoDB.getAll('proventosConhecidos');
    }

    /** Processa dividendos que já foram pagos e os move para o "Caixa" */
    async function processarDividendosPagos() {
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0); // Compara apenas com o início do dia
        
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
                        console.log(`Processado pagamento de ${provento.symbol}: ${formatBRL(valorRecebido)}`);
                    }
                    
                    provento.processado = true; // Marca como processado
                    proventosParaSalvar.push(provento);
                }
            }
        });

        if (precisaSalvarCaixa) {
            await salvarCaixa();
        }
        if (proventosParaSalvar.length > 0) {
            for (const provento of proventosParaSalvar) {
                await vestoDB.put('proventosConhecidos', provento);
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

    // ==========================================================
    // Funções de Renderização
    // ==========================================================
    
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
        gradient.addColorStop(0, 'rgba(167, 139, 250, 0.9)'); 
        gradient.addColorStop(1, 'rgba(109, 40, 217, 0.9)'); 
        
        const hoverGradient = ctx.createLinearGradient(0, 0, 0, 256);
        hoverGradient.addColorStop(0, 'rgba(196, 181, 253, 1)'); 
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
                        borderColor: 'rgba(167, 139, 250, 0.3)', 
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
        gradient.addColorStop(0, 'rgba(139, 92, 246, 0.6)'); 
        gradient.addColorStop(1, 'rgba(139, 92, 246, 0.0)'); 

        if (patrimonioChartInstance) {
            patrimonioChartInstance.data.labels = labels;
            patrimonioChartInstance.data.datasets[0].data = data;
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
                        borderColor: '#8B5CF6', 
                        tension: 0.1,
                        pointRadius: 2,
                        pointBackgroundColor: '#A78BFA'
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
        const skeletons = [skeletonTotalValor, skeletonTotalCusto, skeletonTotalPL, skeletonTotalProventos];
        const dataElements = [totalCarteiraValor, totalCarteiraCusto, totalCarteiraPL, totalProventosEl];
        
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
            listaCarteira.innerHTML = ''; 
        } else {
            skeletonListaCarteira.classList.add('hidden');
        }
    }
    
    async function renderizarCarteira() {
        renderizarCarteiraSkeletons(false);
        
        const precosMap = new Map(precosAtuais.map(p => [p.symbol, p]));
        const proventosMap = new Map(proventosAtuais.map(p => [p.symbol, p])); // Apenas futuros
        const carteiraOrdenada = [...carteiraCalculada].sort((a, b) => a.symbol.localeCompare(b.symbol));

        let totalValorCarteira = 0; // Apenas ativos
        let totalCustoCarteira = 0;
        let dadosGrafico = [];

        if (carteiraOrdenada.length === 0) {
            carteiraStatus.classList.remove('hidden');
            renderizarDashboardSkeletons(false);
            
            const corPLTotal = saldoCaixa > 0 ? 'text-green-500' : 'text-gray-500';
            totalCarteiraValor.textContent = formatBRL(saldoCaixa); // Mostra o caixa se não houver ativos
            totalCarteiraCusto.textContent = formatBRL(0);
            totalCarteiraPL.textContent = `${formatBRL(saldoCaixa)} (---%)`;
            totalCarteiraPL.className = `text-lg font-semibold ${corPLTotal}`;
            
            dashboardMensagem.textContent = 'A sua carteira está vazia. Adicione ativos na aba "Carteira" para começar.';
            dashboardLoading.classList.add('hidden');
            dashboardStatus.classList.remove('hidden');
            
            renderizarGraficoAlocacao([]); 
            renderizarGraficoHistorico({ labels: [], data: [] }); 
            await salvarSnapshotPatrimonio(saldoCaixa); // Salva o caixa como patrimônio
            renderizarGraficoPatrimonio();
        } else {
            carteiraStatus.classList.add('hidden');
            dashboardStatus.classList.add('hidden');
        }

        listaCarteira.innerHTML = ''; 
        carteiraOrdenada.forEach(ativo => {
            const dadoPreco = precosMap.get(ativo.symbol);
            const dadoProvento = proventosMap.get(ativo.symbol); // Futuro
            
            const card = document.createElement('div');
            card.className = 'card-bg p-4 rounded-2xl shadow-lg card-animate-in';
            
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
            let corPL = 'text-gray-500';
            if (lucroPrejuizo > 0.01) corPL = 'text-green-500';
            else if (lucroPrejuizo < -0.01) corPL = 'text-red-500';

            totalValorCarteira += totalPosicao; // Soma apenas o valor dos ativos
            totalCustoCarteira += custoTotal;
            if (totalPosicao > 0) { dadosGrafico.push({ symbol: ativo.symbol, totalPosicao: totalPosicao }); }
            
            let proventoHtml = '';
            if (isFII(ativo.symbol)) { 
                if (dadoProvento && dadoProvento.value > 0) {
                    proventoHtml = `
                    <div class="flex justify-between items-center mt-3">
                        <span class="text-sm text-gray-500">Provento</span>
                        <span class="text-base font-semibold accent-text">${formatBRL(dadoProvento.value)}</span>
                    </div>
                    <div class="flex justify-between items-center -mt-2">
                        <span class="text-sm text-gray-500">Pagamento</span>
                        <span class="text-sm font-medium text-gray-400">${formatDate(dadoProvento.paymentDate)}</span>
                    </div>`;
                } else {
                    proventoHtml = `
                    <div class="flex justify-between items-center mt-3">
                        <span class="text-sm text-gray-500">Provento</span>
                        <span class="text-sm font-medium text-gray-400">Sem provento futuro.</span>
                    </div>`;
                }
            }
            
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
                            <p class="text-sm text-gray-500">${ativo.quantity} cota(s)</p>
                        </div>
                    </div>
                    <div class="text-right flex-shrink-0 ml-2">
                        <span class="${corVariacao} font-semibold text-lg">${dadoPreco ? variacaoFormatada : '...'}</span>
                        <p class="text-gray-100 text-lg">${precoFormatado}</p>
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
                            <span class="text-base font-semibold text-white">${dadoPreco ? formatBRL(totalPosicao) : 'A calcular...'}</span>
                        </div>
                        <div class="flex justify-between items-center">
                            <span class="text-sm text-gray-500">Custo (P.M. ${formatBRL(ativo.precoMedio)})</span>
                            <span class="text-base font-semibold text-gray-300">${formatBRL(custoTotal)}</span>
                        </div>
                        <div class="flex justify-between items-center">
                            <span class="text-sm text-gray-500">L/P</span>
                            <span class="text-base font-semibold ${corPL}">${dadoPreco ? `${formatBRL(lucroPrejuizo)} (${lucroPrejuizoPercent.toFixed(2)}%)` : 'A calcular...'}</span>
                        </div>
                        ${proventoHtml} 
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
            listaCarteira.appendChild(card);
        });
        
        if (carteiraOrdenada.length > 0) {
            const patrimonioTotal = totalValorCarteira + saldoCaixa;
            const totalLucroPrejuizo = (totalValorCarteira - totalCustoCarteira) + saldoCaixa;
            const totalLucroPrejuizoPercent = (totalCustoCarteira === 0) ? 0 : (totalLucroPrejuizo / totalCustoCarteira) * 100;
            
            let corPLTotal = 'text-gray-500';
            if (totalLucroPrejuizo > 0.01) corPLTotal = 'text-green-500';
            else if (totalLucroPrejuizo < -0.01) corPLTotal = 'text-red-500';
            
            renderizarDashboardSkeletons(false);
            totalCarteiraValor.textContent = formatBRL(patrimonioTotal);
            totalCarteiraCusto.textContent = formatBRL(totalCustoCarteira);
            totalCarteiraPL.textContent = `${formatBRL(totalLucroPrejuizo)} (${totalLucroPrejuizoPercent.toFixed(2)}%)`;
            totalCarteiraPL.className = `text-lg font-semibold ${corPLTotal}`;
            
            await salvarSnapshotPatrimonio(patrimonioTotal);
        }
        
        renderizarGraficoAlocacao(dadosGrafico);
        renderizarGraficoPatrimonio(); 
    }

    function renderizarProventos() {
        // Esta função agora renderiza apenas os *próximos* proventos
        let totalEstimado = 0;
        const carteiraMap = new Map(carteiraCalculada.map(a => [a.symbol, a.quantity]));
        
        proventosAtuais.forEach(provento => { // proventosAtuais contém apenas futuros
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
        [...transacoes].reverse().forEach(t => {
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
                        <p class="text-sm text-gray-400">${formatDate(t.date, true)}</p>
                    </div>
                </div>
                <div class="text-right">
                    <p class="text-base font-semibold ${cor}">${sinal}${t.quantity} Cotas</p>
                    <p class="text-sm text-gray-400">${formatBRL(t.price)}</p>
                </div>
            `;
            listaHistorico.appendChild(card);
        });
    }

    // ==========================================================
    // Funções de Notícias (ATUALIZADA com Tickers Clicáveis)
    // ==========================================================
    
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
        
        // 1. Tenta ler o cache primeiro, SE não for forçado
        if (!force) {
            const cache = await getCache(cacheKey);
            if (cache) {
                console.log("Usando notícias do cache (sem skeleton).");
                renderizarNoticias(cache);
                return; // Encontrou no cache, para aqui.
            }
        }
        
        // 2. Se o cache estiver vazio ou se force=true, mostra o skeleton
        fiiNewsSkeleton.classList.remove('hidden');
        fiiNewsList.innerHTML = '';
        fiiNewsMensagem.classList.add('hidden');

        const refreshIcon = refreshNoticiasButton.querySelector('svg');
        if (force) {
            refreshIcon.classList.add('spin-animation');
        }

        try {
            // 3. Busca na rede
            console.log("Buscando notícias na rede (BFF)...");
            const articles = await fetchAndCacheNoticiasBFF_NetworkOnly(); // Nova função
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

    /** * Busca o JSON de resumos de notícias APENAS DA REDE e salva no cache.
     * A verificação de cache foi movida para handleAtualizarNoticias.
     */
    async function fetchAndCacheNoticiasBFF_NetworkOnly() {
        const cacheKey = 'noticias_json_v4';
        
        // 1. Deleta o cache antigo (necessário se for atualização forçada)
        await vestoDB.delete('apiCache', cacheKey);
        
        // 2. Busca na rede
        try {
            const response = await fetchBFF('/api/news', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ todayString: todayString }) 
            });
            const articles = response.json;
            
            // 3. Salva no cache
            if (articles && Array.isArray(articles)) {
                await setCache(cacheKey, articles, CACHE_6_HORAS);
            }
            return articles;
        } catch (error) {
            console.error("Erro ao buscar notícias (BFF):", error);
            throw error;
        }
    }
    
    // ==========================================================
    // Funções de Fetch (API)
    // ==========================================================

    /** Wrapper de Fetch para o BFF com timeout */
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
            if (error.name === 'AbortError') {
                console.error(`Erro ao chamar o BFF ${url}:`, "Timeout de 30s excedido");
                throw new Error("O servidor demorou muito para responder.");
            }
            console.error(`Erro ao chamar o BFF ${url}:`, error);
            throw error;
        }
    }
    
    /** * Busca preços, usando cache individual por ativo
     * (Já estava respeitando 'force')
     */
    async function buscarPrecosCarteira(force = false) { 
        if (carteiraCalculada.length === 0) return [];
        console.log("A buscar preços na API (cache por ativo)...");
        
        const promessas = carteiraCalculada.map(async (ativo) => {
            const cacheKey = `preco_${ativo.symbol}`;
            if (force) {
                await vestoDB.delete('apiCache', cacheKey);
            }
            
            if (!force) {
                const precoCache = await getCache(cacheKey);
                if (precoCache && !isB3Open()) return precoCache;
                if (precoCache) return precoCache;
            }
            try {
const tickerParaApi = isFII(ativo.symbol) ? `${ativo.symbol}.SA` : ativo.symbol;
                const data = await fetchBFF(`/api/brapi?path=/quote/${tickerParaApi}?range=1d&interval=1d`);
                const result = data.results?.[0];

                if (result && !result.error) {
                    if (result.symbol.endsWith('.SA')) result.symbol = result.symbol.replace('.SA', '');
                    await setCache(cacheKey, result); 
                    return result;
                } else {
                    console.warn(`Ativo ${tickerParaApi} retornou erro ou sem dados.`);
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

    /** Filtra proventos da IA para datas futuras */
    function processarProventosIA(proventosDaIA = []) {
        const hoje = new Date(); 
        hoje.setHours(0, 0, 0, 0);
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

        return proventosDaIA
            .map(proventoIA => {
                const ativoCarteira = carteiraCalculada.find(a => a.symbol === proventoIA.symbol);
                if (!ativoCarteira) return null;
                
                // Aceita o cache "vazio" (value=0) e proventos reais
                if (proventoIA.paymentDate && typeof proventoIA.value === 'number' && proventoIA.value > 0 && dateRegex.test(proventoIA.paymentDate)) {
                    const parts = proventoIA.paymentDate.split('-');
                    const dataPagamento = new Date(parts[0], parts[1] - 1, parts[2]); 
                    
                    // Apenas futuros (igual ou depois de hoje)
                    if (!isNaN(dataPagamento) && dataPagamento >= hoje) {
                        return proventoIA;
                    }
                }
                return null; 
            })
            .filter(p => p !== null);
    }

    // *** INÍCIO DA CORREÇÃO (BUG CACHE ANTIGO) ***
    async function buscarProventosFuturos(force = false, fiisParaBuscarOverride = null) {
        const fiiNaCarteira = carteiraCalculada
            .filter(a => isFII(a.symbol))
            .map(a => a.symbol);
        
        // Usa a lista override (se fornecida) ou a carteira inteira
        const fiiList = fiisParaBuscarOverride || fiiNaCarteira;
            
        if (fiiList.length === 0) return [];

        let proventosPool = []; // Pool de proventos para filtrar
        let fiisParaBuscar = [];

        // NOVO: Se for 'force', limpa proventos futuros do IndexedDB 'proventosConhecidos'
        if (force) {
            console.log("Forçando atualização, limpando proventos futuros conhecidos...");
            const proventosAntigos = proventosConhecidos.filter(p => !p.processado);
            for (const provento of proventosAntigos) {
                await vestoDB.delete('proventosConhecidos', provento.id);
            }
            // Atualiza o array em memória
            proventosConhecidos = proventosConhecidos.filter(p => p.processado);
        }

        // 1. Processa o que já está em cache
        for (const symbol of fiiList) {
            const cacheKey = `provento_ia_${symbol}`;
            if (force) {
                await vestoDB.delete('apiCache', cacheKey);
            }
            
            const proventoCache = await getCache(cacheKey);
            if (proventoCache) {
                proventosPool.push(proventoCache);
            } else {
                fiisParaBuscar.push(symbol);
            }
        }
        
        if (!fiisParaBuscarOverride) {
            console.log("Proventos em cache (para filtrar):", proventosPool.map(p => p.symbol));
            console.log("Proventos para buscar (API):", fiisParaBuscar);
        }

        // 2. Busca novos na API
        if (fiisParaBuscar.length > 0) {
            try {
                const novosProventos = await callGeminiProventosCarteiraAPI(fiisParaBuscar, todayString);
                const fiisEncontrados = new Set();
                
                if (novosProventos && Array.isArray(novosProventos)) {
                    for (const provento of novosProventos) {
                        if (provento && provento.symbol && provento.paymentDate) {
                            fiisEncontrados.add(provento.symbol);
                            const cacheKey = `provento_ia_${provento.symbol}`;
                            await setCache(cacheKey, provento, CACHE_24_HORAS); 
                            proventosPool.push(provento); 

                            // Adiciona à lista de proventos conhecidos
                            const idUnico = provento.symbol + '_' + provento.paymentDate;
                            const existe = proventosConhecidos.some(p => p.id === idUnico);
                            
                            if (!existe) {
                                const novoProvento = { ...provento, processado: false, id: idUnico };
                                await vestoDB.put('proventosConhecidos', novoProvento);
                                proventosConhecidos.push(novoProvento); 
                            }
                        }
                    }
                }
                
                // Salva um cache "vazio" para FIIs buscados que não retornaram proventos
                for (const fiiBuscado of fiisParaBuscar) {
                    if (!fiisEncontrados.has(fiiBuscado)) {
                        console.log(`Cache "vazio" salvo para ${fiiBuscado} por 24h.`);
                        const cacheKey = `provento_ia_${fiiBuscado}`;
                        const proventoVazio = { symbol: fiiBuscado, value: 0, paymentDate: null };
                        await setCache(cacheKey, proventoVazio, CACHE_24_HORAS);
                        proventosPool.push(proventoVazio); 
                    }
                }
                
            } catch (error) {
                console.error("Erro ao buscar novos proventos com IA:", error);
            }
        }
        
        // 3. Retorna apenas os proventos que são REALMENTE futuros
        return processarProventosIA(proventosPool); 
    }
    // *** FIM DA CORREÇÃO ***

    async function buscarHistoricoProventosAgregado(force = false) {
        const fiiNaCarteira = carteiraCalculada.filter(a => isFII(a.symbol));
        if (fiiNaCarteira.length === 0) return { labels: [], data: [] };

        const fiiSymbols = fiiNaCarteira.map(a => a.symbol);
        
        const cacheKey = 'cache_grafico_historico';
        
        if (force) {
            await vestoDB.delete('apiCache', cacheKey);
        }
        
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
            return totalMes;
        });

        return { labels, data };
    }

    // ==========================================================
    // Funções Principais (Handlers)
    // ==========================================================
    
     async function atualizarTodosDados(force = false) { 
        // *** INÍCIO DA CORREÇÃO (Problema 1) ***
        // Só mostra o skeleton se for uma atualização FORÇADA
        if (force) {
            renderizarDashboardSkeletons(true);
            renderizarCarteiraSkeletons(true);
        }
        // *** FIM DA CORREÇÃO ***
        
        calcularCarteira();
        await processarDividendosPagos(); 
        
        // Otimização 1: Renderiza proventos do cache imediatamente
        const proventosFuturosCache = processarProventosIA(proventosConhecidos);
        proventosAtuais = proventosFuturosCache;
        renderizarProventos();
        skeletonTotalProventos.classList.add('hidden');
        totalProventosEl.classList.remove('hidden');
        
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
        const promessaHistorico = buscarHistoricoProventosAgregado(force);
        
        // *** INÍCIO DA CORREÇÃO (Problema 2) ***
        // Só busca proventos na rede se for uma atualização FORÇADA
        let promessaProventos = null;
        if (force) {
            promessaProventos = buscarProventosFuturos(true); // 'true' para limpar cache
        }
        // *** FIM DA CORREÇÃO ***

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

        // *** INÍCIO DA CORREÇÃO (Problema 2) ***
        // Só processa a promessa de proventos se ela foi iniciada (force = true)
        if (promessaProventos) {
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
        }
        // *** FIM DA CORREÇÃO ***
        
        promessaHistorico.then(({ labels, data }) => {
            renderizarGraficoHistorico({ labels, data });
        }).catch(err => {
            console.error("Erro ao buscar histórico agregado (BFF):", err);
            showToast("Erro ao buscar histórico."); 
            renderizarGraficoHistorico({ labels: [], data: [] }); 
        });
        
        try {
            // *** INÍCIO DA CORREÇÃO (Problema 2) ***
            // Adiciona a promessa de proventos ao 'allSettled' apenas se ela existir
            const promessas = [promessaPrecos, promessaHistorico];
            if (promessaProventos) {
                promessas.push(promessaProventos);
            }
            await Promise.allSettled(promessas); 
            // *** FIM DA CORREÇÃO ***
        } finally {
            console.log("Sincronização de CARTEIRA terminada.");
            refreshIcon.classList.remove('spin-animation');
            dashboardStatus.classList.add('hidden');
            dashboardLoading.classList.add('hidden');
        }
    }
    
    /** Adiciona uma nova transação de compra */
    async function handleAdicionarAtivo() {
        let ticker = tickerInput.value.trim().toUpperCase();
        let novaQuantidade = parseInt(quantityInput.value, 10);
        let novoPreco = parseFloat(precoMedioInput.value.replace(',', '.')); 

        if (ticker.endsWith('.SA')) ticker = ticker.replace('.SA', '');

        if (!ticker || !novaQuantidade || novaQuantidade <= 0 || !novoPreco || novoPreco < 0) { 
            showToast("Preencha todos os campos."); 
            tickerInput.classList.add('border-red-500');
            quantityInput.classList.add('border-red-500');
            precoMedioInput.classList.add('border-red-500'); 
            setTimeout(() => {
                tickerInput.classList.remove('border-red-500');
                quantityInput.classList.remove('border-red-500');
                precoMedioInput.classList.remove('border-red-500'); 
            }, 2000);
            return;
        }
        
        const ativoExistente = carteiraCalculada.find(a => a.symbol === ticker);
        
        if (!ativoExistente) {
            addButton.innerHTML = `<span class="loader-sm"></span>`;
            addButton.disabled = true;
            
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
        
        const novaTransacao = {
            id: 'tx_' + Date.now(),
            date: new Date().toISOString(),
            symbol: ticker,
            type: 'buy',
            quantity: novaQuantidade,
            price: novoPreco
        };
        
        await vestoDB.put('transacoes', novaTransacao);
        transacoes.push(novaTransacao); // Atualiza array em memória

        addButton.innerHTML = `Adicionar`;
        addButton.disabled = false;
        hideAddModal();
        
        await removerCacheAtivo(ticker); 
        await atualizarTodosDados(false); // Roda sem proventos e sem piscar
        
        // *** INÍCIO DA CORREÇÃO (Problema 2) ***
        // Agora, busca o provento SÓ do ativo novo, em segundo plano.
        if (isFII(ticker)) {
            console.log(`Buscando provento (em background) apenas para: ${ticker}`);
            // Usa 'false' para não forçar (caso já tenha cache "vazio")
            buscarProventosFuturos(false, [ticker]).then(async (novosProventos) => {
                // Verifica se algo mudou (novo provento ou era um cache "vazio")
                const proventoAtual = proventosAtuais.find(p => p.symbol === ticker);
                const novoProvento = novosProventos.find(p => p.symbol === ticker);
                
                const mudou = (proventoAtual?.value !== novoProvento?.value) || (proventoAtual?.paymentDate !== novoProvento?.paymentDate);
                
                if (mudou) {
                     console.log(`Provento de ${ticker} atualizado, renderizando...`);
                     // Atualiza o pool global e renderiza
                     proventosAtuais = processarProventosIA(proventosConhecidos);
                     renderizarProventos();
                     await renderizarCarteira(); // Re-renderiza a carteira com o novo provento
                } else {
                     console.log(`Provento de ${ticker} não mudou (ou continua vazio).`);
                }
            });
        }
        // *** FIM DA CORREÇÃO ***
    }

    /** Remove um ativo (e todas as suas transações) */
    function handleRemoverAtivo(symbol) {
        showModal(
            'Remover Ativo', 
            `Tem certeza? Isso removerá ${symbol} e TODO o seu histórico de compras deste ativo.`, 
            async () => { 
                transacoes = transacoes.filter(t => t.symbol !== symbol);
                
                const transacoesParaRemover = await vestoDB.getAllFromIndex('transacoes', 'bySymbol', symbol);
                for (const t of transacoesParaRemover) {
                    await vestoDB.delete('transacoes', t.id);
                }

                await removerCacheAtivo(symbol); 
                
                await atualizarTodosDados(false); // Roda sem proventos e sem piscar
            }
        );
    }
    
    /** Limpa a página de detalhes */
    function limparDetalhes() {
        detalhesMensagem.classList.remove('hidden');
        detalhesLoading.classList.add('hidden');
        detalhesTituloTexto.textContent = 'Detalhes'; 
        detalhesNomeLongo.textContent = ''; 
        detalhesPreco.innerHTML = '';
        detalhesHistoricoContainer.classList.add('hidden');
        detalhesAiProvento.innerHTML = ''; 
        
        currentDetalhesSymbol = null;
        currentDetalhesMeses = 3; 
        currentDetalhesHistoricoJSON = null; 
        
        periodoSelectorGroup.querySelectorAll('.periodo-selector-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.meses === '3'); 
        });
    }
    
    // *** INÍCIO DA OTIMIZAÇÃO 2 ***

    /** Busca e exibe os dados da página de detalhes */
    async function handleMostrarDetalhes(symbol) {
        // 1. Limpa e prepara o modal imediatamente
        detalhesMensagem.classList.add('hidden');
        detalhesLoading.classList.remove('hidden'); // Mostra o loader principal
        detalhesPreco.innerHTML = '';
        detalhesAiProvento.innerHTML = ''; 
        detalhesHistoricoContainer.classList.add('hidden'); // Esconde o container de IA
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
        
        // 2. Dispara as duas promessas em paralelo
        fetchAndRenderDetalhesPreco(symbol, tickerParaApi, cacheKeyPreco);
        
        if (isFII(symbol)) {
            detalhesHistoricoContainer.classList.remove('hidden'); 
            fetchHistoricoIA(symbol); // Dispara a busca da IA
        }
        
        // 3. Esconde o loader principal
        // (As funções filhas controlarão seus próprios loaders internos)
        detalhesLoading.classList.add('hidden');
    }
    
    /** (Função Auxiliar Otimização 2) Busca e renderiza apenas os dados de PREÇO */
    async function fetchAndRenderDetalhesPreco(symbol, tickerParaApi, cacheKeyPreco) {
        let precoData = await getCache(cacheKeyPreco);
        
        if (!precoData) {
            try {
                const data = await fetchBFF(`/api/brapi?path=/quote/${tickerParaApi}?range=1d&interval=1d`);
                precoData = data.results?.[0];
                if (precoData && !precoData.error) await setCache(cacheKeyPreco, precoData); 
                else throw new Error(precoData?.error || 'Ativo não encontrado');
            } catch (e) { 
                precoData = null; 
                showToast("Erro ao buscar preço."); 
            }
        }
        
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
    }
    
    // *** FIM DA OTIMIZAÇÃO 2 ***

    // 1. Função que BUSCA o JSON de 12 meses (apenas 1 vez)
    async function fetchHistoricoIA(symbol) {
        // Mostra o skeleton de loading
        detalhesAiProvento.innerHTML = `
            <div id="historico-periodo-loading" class="space-y-3 animate-pulse pt-2">
                <div class="h-4 bg-gray-700 rounded-md w-3/4"></div>
                <div class="h-4 bg-gray-700 rounded-md w-1/2"></div>
                <div class="h-4 bg-gray-700 rounded-md w-2/3"></div>
            </div>
        `;
        
        try {
            // A chave de cache agora é estática para 12 meses
            const cacheKey = `hist_ia_${symbol}_12`;
            let aiResultJSON = await getCache(cacheKey);

            if (!aiResultJSON) {
                console.log(`Buscando histórico JSON de 12 meses para ${symbol} na API...`);
                aiResultJSON = await callGeminiHistoricoAPI(symbol, todayString); 
                
                if (aiResultJSON && Array.isArray(aiResultJSON)) {
                    await setCache(cacheKey, aiResultJSON, CACHE_24_HORAS);
                } else {
                    aiResultJSON = []; // Garante que é um array
                }
            } else {
                console.log(`Usando cache para histórico JSON de ${symbol}.`);
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
    
    // 2. Função que RENDERIZA o texto a partir do JSON filtrado (instantâneo)
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
            return;
        }

        const dadosFiltrados = currentDetalhesHistoricoJSON.slice(0, meses);
        const textoFormatado = dadosFiltrados
            .map(item => `${item.mes}: ${formatBRL(item.valor)}`)
            .join('\n'); 

        detalhesAiProvento.innerHTML = `
            <p class="text-sm text-gray-100 bg-gray-800 p-3 rounded-lg whitespace-pre-wrap">${textoFormatado}</p>
        `;
    }
    
    /** Muda a aba visível */
    function mudarAba(tabId) {
        tabContents.forEach(content => {
            content.classList.toggle('active', content.id === tabId);
        });
        tabButtons.forEach(button => {
            button.classList.toggle('active', button.dataset.tab === tabId);
        });
        
        showAddModalBtn.classList.toggle('hidden', tabId !== 'tab-carteira');
    }
    
    // ==========================================================
    // Event Listeners
    // ==========================================================

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
    
    addButton.addEventListener('click', handleAdicionarAtivo);
    tickerInput.addEventListener('keypress', (e) => e.key === 'Enter' && handleAdicionarAtivo());
    quantityInput.addEventListener('keypress', (e) => e.key === 'Enter' && handleAdicionarAtivo());
    precoMedioInput.addEventListener('keypress', (e) => e.key === 'Enter' && handleAdicionarAtivo()); 
    
    notifyButton.addEventListener('click', requestNotificationPermission);

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
    
    dashboardDrawers.addEventListener('click', (e) => {
        const target = e.target.closest('button');
        if (!target || !target.dataset.targetDrawer) return;
        
        const drawerId = target.dataset.targetDrawer;
        const drawer = document.getElementById(drawerId);
        const icon = target.querySelector('.card-arrow-icon');
        
        drawer?.classList.toggle('open');
        icon?.classList.toggle('open');
    });

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

    copiarDadosBtn.addEventListener('click', handleCopiarDados);
    abrirImportarModalBtn.addEventListener('click', showImportModal);
    
    importTextCancelBtn.addEventListener('click', hideImportModal);
    importTextConfirmBtn.addEventListener('click', handleImportarTexto);
    importTextModal.addEventListener('click', (e) => {
        if (e.target === importTextModal) { hideImportModal(); } 
    });

    // ==========================================================
    // Funções da API Gemini (BFF)
    // ==========================================================

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

    // ==========================================================
    // Funções de Backup (Copiar/Colar)
    // ==========================================================

    async function handleCopiarDados() {
        console.log("Iniciando cópia para o clipboard...");
        copiarDadosBtn.disabled = true;

        try {
            const storesToExport = ['transacoes', 'patrimonio', 'appState', 'proventosConhecidos'];
            const exportData = {};
            
            for (const storeName of storesToExport) {
                exportData[storeName] = await vestoDB.getAll(storeName);
            }
            
            const bundle = {
                version: 'vesto-v1',
                exportedAt: new Date().toISOString(),
                data: exportData
            };

            const jsonString = JSON.stringify(bundle); 
            
            await navigator.clipboard.writeText(jsonString);
            
            showToast("Dados copiados para a área de transferência!", 'success'); 

        } catch (err) {
            console.error("Erro ao copiar dados para o clipboard:", err);
            showToast("Erro ao copiar dados."); 
        } finally {
            copiarDadosBtn.disabled = false;
        }
    }

    function handleImportarTexto() {
        const texto = importTextTextarea.value;
        if (!texto || texto.trim() === '') {
            showToast("Área de texto vazia."); 
            return;
        }

        let backup;
        try {
            backup = JSON.parse(texto);
            
            if (!backup.version || backup.version !== 'vesto-v1' || !backup.data || !Array.isArray(backup.data.transacoes)) {
                throw new Error("Texto de backup inválido ou corrompido.");
            }
            
            hideImportModal(); 
            
            setTimeout(() => { 
                 showModal(
                    'Importar Backup?',
                    'Atenção: Isso irá APAGAR todos os seus dados atuais e substituí-los pelo backup. Esta ação não pode ser desfeita.',
                    () => { 
                        importarDados(backup.data); 
                    }
                );
            }, 250);

        } catch (err) {
            console.error("Erro ao ler texto de backup:", err);
            showToast(err.message || "Erro ao ler texto."); 
        }
    }

    async function importarDados(data) {
        console.log("Iniciando importação...");
        importTextConfirmBtn.textContent = 'A importar...';
        importTextConfirmBtn.disabled = true;

        try {
            const stores = ['transacoes', 'patrimonio', 'appState', 'proventosConhecidos'];
            
            const clearPromises = stores.map(store => vestoDB.clear(store));
            await Promise.all(clearPromises);
            console.log("Stores limpos.");

            const populatePromises = [];
            for (const storeName of stores) {
                if (data[storeName] && Array.isArray(data[storeName])) {
                    for (const item of data[storeName]) {
                        populatePromises.push(vestoDB.put(storeName, item));
                    }
                }
            }
            await Promise.all(populatePromises);
            console.log("Stores populados.");

            await carregarTransacoes();
            await carregarPatrimonio();
            await carregarCaixa();
            await carregarProventosConhecidos();
            
            await atualizarTodosDados(true);
            
            showToast("Dados importados com sucesso!", 'success'); 

        } catch (err) {
            console.error("Erro grave durante a importação:", err);
            showToast("Erro grave ao importar dados."); 
        } finally {
            importTextConfirmBtn.textContent = 'Restaurar';
            importTextConfirmBtn.disabled = false;
        }
    }

    // ==========================================================
    // Inicialização
    // ==========================================================
    
    async function init() {
        try {
            await vestoDB.init();
            console.log("[IDB] Inicialização concluída.");
        } catch (e) {
            console.error("[IDB] Falha fatal ao inicializar o DB.", e);
            showToast("Erro crítico: Banco de dados não pôde ser carregado."); 
            return; 
        }
        
        checkNotificationPermission(); 
        await carregarTransacoes();
        await carregarPatrimonio();
        await carregarCaixa();
        await carregarProventosConhecidos();
        mudarAba('tab-dashboard'); 
        
        // Dispara as duas funções em paralelo, sem esperar uma pela outra.
        atualizarTodosDados(false); 
        handleAtualizarNoticias(false); 
        
        setInterval(() => atualizarTodosDados(false), REFRESH_INTERVAL); 
    }
    
    // Inicia a aplicação
    await init();
});

