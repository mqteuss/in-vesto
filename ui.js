// ui.js

// Importa dependências de outros módulos
import { formatBRL, formatNumber, formatPercent, formatDate, isFII, gerarCores } from './utils.js';
import { callGeminiHistoricoAPI, verificarAtivo } from './api.js';
import { setCache, getCache } from './cache.js'; // Apenas para handleMostrarDetalhes

// ==========================================================
// Elementos DOM (Privados deste módulo)
// ==========================================================
const refreshButton = document.getElementById('refresh-button');
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

// ==========================================================
// Estado da UI (Privado deste módulo)
// ==========================================================
let alocacaoChartInstance = null;
let historicoChartInstance = null;
let patrimonioChartInstance = null; 
let onConfirmCallback = null; 
let lastAlocacaoData = null; 
let lastHistoricoData = null;
let lastPatrimonioData = null; 
let toastTimer = null;
let isToastShowing = false;
let touchStartY = 0;
let touchMoveY = 0;
let isDraggingDetalhes = false;
let newWorker; // Para o PWA

// ==========================================================
// Notificações Toast
// ==========================================================
export function showToast(message) {
    clearTimeout(toastTimer);
    toastMessageElement.textContent = message;

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
// Service Worker (PWA) e Notificações Push
// ==========================================================
function showUpdateBar() {
    console.log('Mostrando aviso de atualização.');
    updateNotification.classList.remove('hidden');
    setTimeout(() => {
        updateNotification.style.opacity = '1';
        updateNotification.style.transform = 'translateY(0) translateX(-50%)'; 
    }, 10);
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

export function checkNotificationPermission() {
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

function initPWA() {
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
}

// ==========================================================
// Funções dos Modais
// ==========================================================
export function showModal(title, message, onConfirm) {
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

export function showAddModal() {
    addAtivoModal.classList.add('visible');
    addAtivoModalContent.classList.remove('modal-out');
    tickerInput.focus();
}

export function hideAddModal() {
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

function showDetalhesModal(symbol, carteiraCalculada, todayString) {
    detalhesPageContent.style.transform = ''; 
    detalhesPageContent.classList.remove('closing'); 
    detalhesPageModal.classList.add('visible'); 
    document.body.style.overflow = 'hidden'; 
    detalhesConteudoScroll.scrollTop = 0; 
    // A lógica de "handle" foi movida para cá, pois é 100% UI
    handleMostrarDetalhes(symbol, carteiraCalculada, todayString); 
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

/** Muda a aba visível */
export function mudarAba(tabId) {
    tabContents.forEach(content => {
        content.classList.toggle('active', content.id === tabId);
    });
    tabButtons.forEach(button => {
        button.classList.toggle('active', button.dataset.tab === tabId);
    });
    
    // Mostra/esconde o botão FAB
    showAddModalBtn.classList.toggle('hidden', tabId !== 'tab-carteira');
}

// ==========================================================
// Funções de Renderização de Gráficos
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

function renderizarGraficoPatrimonio(patrimonio) {
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

// ==========================================================
// Funções de Renderização de Conteúdo
// ==========================================================

export function renderizarDashboardSkeletons(show) {
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

export function renderizarCarteiraSkeletons(show) {
    if (show) {
        skeletonListaCarteira.classList.remove('hidden');
        carteiraStatus.classList.add('hidden');
        listaCarteira.innerHTML = ''; 
    } else {
        skeletonListaCarteira.classList.add('hidden');
    }
}

export function renderizarCarteira(carteiraCalculada, precosAtuais, proventosAtuais, saldoCaixa, patrimonio) {
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
        renderizarGraficoPatrimonio(patrimonio);
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
        
        // Retorna o valor do patrimônio para o main.js salvar
        return patrimonioTotal;
    }
    
    renderizarGraficoAlocacao(dadosGrafico);
    renderizarGraficoPatrimonio(patrimonio); 
    return saldoCaixa; // Retorna o saldo do caixa se a carteira estiver vazia
}

export function renderizarProventos(carteiraCalculada, proventosAtuais) {
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

export function renderizarHistorico(transacoes) {
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

export function renderizarNoticias(articles) { 
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

export function renderizarSkeletonsNoticias(show) {
    if (show) {
        fiiNewsSkeleton.classList.remove('hidden');
        fiiNewsList.innerHTML = '';
        fiiNewsMensagem.classList.add('hidden');
    } else {
        fiiNewsSkeleton.classList.add('hidden');
    }
}

export function renderizarErroNoticias() {
    fiiNewsSkeleton.classList.add('hidden');
    fiiNewsMensagem.textContent = 'Erro ao carregar notícias.';
    fiiNewsMensagem.classList.remove('hidden');
}

export function setBotaoCarregando(carregando) {
    const refreshIcon = refreshButton.querySelector('svg');
    if (carregando) {
        refreshIcon.classList.add('spin-animation');
    } else {
        refreshIcon.classList.remove('spin-animation');
    }
}

export function setDashboardStatus(carregando) {
    if (carregando) {
        dashboardStatus.classList.remove('hidden');
        dashboardLoading.classList.remove('hidden');
    } else {
        dashboardStatus.classList.add('hidden');
        dashboardLoading.classList.add('hidden');
    }
}

export function setBotaoAdicionarCarregando(carregando) {
    if (carregando) {
        addButton.innerHTML = `<span class="loader-sm"></span>`;
        addButton.disabled = true;
    } else {
        addButton.innerHTML = `Adicionar`;
        addButton.disabled = false;
    }
}

export function setErroTickerInput() {
    tickerInput.value = '';
    tickerInput.placeholder = "Ativo não encontrado";
    tickerInput.classList.add('border-red-500');
    setTimeout(() => { 
       tickerInput.placeholder = "Ativo (ex: MXRF11)"; 
       tickerInput.classList.remove('border-red-500');
    }, 2000);
}

// ==========================================================
// Controller da Página de Detalhes (Componente de UI)
// ==========================================================

function limparDetalhes() {
    detalhesMensagem.classList.remove('hidden');
    detalhesLoading.classList.add('hidden');
    detalhesTituloTexto.textContent = 'Detalhes'; 
    detalhesNomeLongo.textContent = ''; 
    detalhesPreco.innerHTML = '';
    detalhesHistoricoContainer.classList.add('hidden');
    detalhesAiProvento.innerHTML = ''; 
}

/** Busca e exibe os dados da página de detalhes */
async function handleMostrarDetalhes(symbol, carteiraCalculada, todayString) {
    detalhesMensagem.classList.add('hidden');
    detalhesLoading.classList.remove('hidden');
    detalhesPreco.innerHTML = '';
    detalhesAiProvento.innerHTML = ''; 
    detalhesHistoricoContainer.classList.add('hidden');
    detalhesTituloTexto.textContent = symbol;
    detalhesNomeLongo.textContent = 'A carregar...';
    
    const tickerParaApi = isFII(symbol) ? `${symbol}.SA` : symbol;
    const cacheKeyPreco = `detalhe_preco_${symbol}`;
    let precoData = getCache(cacheKeyPreco);
    
    if (!precoData) {
        try {
            const data = await verificarAtivo(tickerParaApi); // Reusa a função da API
            precoData = data.results?.[0];
            if (precoData && !precoData.error) setCache(cacheKeyPreco, precoData); 
            else throw new Error(precoData?.error || 'Ativo não encontrado');
        } catch (e) { 
            precoData = null; 
            showToast("Erro ao buscar preço.");
        }
    }

    let promessaAi = null;
    
    if (isFII(symbol)) {
        detalhesHistoricoContainer.classList.remove('hidden'); 
        detalhesAiProvento.innerHTML = `
            <h4 class="text-base font-semibold text-white mb-2">Histórico de Proventos (12 Meses)</h4>
            <div id="historico-12m-loading" class="space-y-3 animate-pulse pt-2">
                <div class="h-4 bg-gray-700 rounded-md w-3/4"></div>
                <div class="h-4 bg-gray-700 rounded-md w-1/2"></div>
            </div>
        `;
        promessaAi = callGeminiHistoricoAPI(symbol, todayString); 
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

    detalhesHistoricoContainer.classList.remove('hidden'); 
    
    if (promessaAi) {
        try {
            const aiResult = await promessaAi;
            detalhesAiProvento.innerHTML = `
                <h4 class="text-base font-semibold text-white mb-2">Histórico de Proventos (12 Meses)</h4>
                <p class="text-sm text-gray-100 bg-gray-800 p-3 rounded-lg whitespace-pre-wrap">${aiResult}</p>
            `;
        } catch (e) {
            showToast("Erro na consulta IA.");
            detalhesAiProvento.innerHTML = `
                <h4 class="text-base font-semibold text-white mb-2">Histórico de Proventos (12 Meses)</h4>
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
}

// ==========================================================
// Função Principal de Inicialização da UI
// ==========================================================

export function initUI(handlers) {
    // Inicia PWA e Notificações
    initPWA();
    checkNotificationPermission();

    // Handlers de Eventos
    refreshButton.addEventListener('click', handlers.onRefresh);
    
    showAddModalBtn.addEventListener('click', showAddModal);
    emptyStateAddBtn.addEventListener('click', showAddModal);
    addAtivoCancelBtn.addEventListener('click', hideAddModal);
    addAtivoModal.addEventListener('click', (e) => {
        if (e.target === addAtivoModal) { hideAddModal(); } 
    });
    
    // Conecta o botão Adicionar ao handler de lógica do main.js
    addButton.addEventListener('click', () => {
        handlers.onAddAtivo(
            tickerInput.value,
            quantityInput.value,
            precoMedioInput.value
        );
    });
    // Adiciona handlers de "Enter"
    tickerInput.addEventListener('keypress', (e) => e.key === 'Enter' && addButton.click());
    quantityInput.addEventListener('keypress', (e) => e.key === 'Enter' && addButton.click());
    precoMedioInput.addEventListener('keypress', (e) => e.key === 'Enter' && addButton.click());
    
    notifyButton.addEventListener('click', requestNotificationPermission);

    // Handler de clique da lista da carteira (delegação de evento)
    listaCarteira.addEventListener('click', (e) => {
        const target = e.target.closest('button');
        if (!target) return;
        
        const action = target.dataset.action;
        const symbol = target.dataset.symbol;

        if (action === 'remove') {
            handlers.onRemoveAtivo(symbol);
        } else if (action === 'details') {
            // Chama a função de UI, passando o estado que ela precisa
            showDetalhesModal(symbol, handlers.getCarteira(), handlers.getTodayString());
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

    // Handlers de Gesto (Swipe) para fechar modal de detalhes
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

    // Handler de clique da lista de notícias (delegação de evento)
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
                // Chama a função de UI, passando o estado
                showDetalhesModal(symbol, handlers.getCarteira(), handlers.getTodayString());
            }
        }
    });
}