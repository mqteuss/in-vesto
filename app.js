

import * as supabaseDB from './supabase.js';

// --- FUNÇÃO GLOBAL DE EXCLUSÃO DE NOTIFICAÇÃO ---
window.dismissNotificationGlobal = function(id, btnElement) {
    const dismissed = JSON.parse(localStorage.getItem('vesto_dismissed_notifs') || '[]');
    if (!dismissed.includes(id)) {
        dismissed.push(id);
        localStorage.setItem('vesto_dismissed_notifs', JSON.stringify(dismissed));
    }
    
    // Animação de saída
    const card = btnElement.closest('.notif-item');
    if (card) {
        card.style.transform = 'translateX(100%)';
        card.style.opacity = '0';
        
        setTimeout(() => {
            card.remove();
            checkEmptyState();
        }, 250);
    }
};

// Verificar se a lista ficou vazia
function checkEmptyState() {
    const list = document.getElementById('notifications-list');
    const badge = document.getElementById('notification-badge');
    const emptyState = document.getElementById('notifications-empty');
    const btnClear = document.getElementById('btn-clear-notifications');
    const btnBell = document.getElementById('btn-notifications');

    if (!list || list.children.length === 0) {
        badge.classList.add('hidden');
        emptyState.classList.remove('hidden');
        if(btnClear) btnClear.classList.add('hidden');
        if(btnBell) btnBell.classList.remove('bell-ringing');
    } else {
        badge.classList.remove('hidden');
        emptyState.classList.add('hidden');
        if(btnClear) btnClear.classList.remove('hidden');
        if(btnBell) btnBell.classList.add('bell-ringing');
    }
}

// Limpar TODAS as notificações
function limparTodasNotificacoes() {
    const list = document.getElementById('notifications-list');
    if (!list) return;

    // Pega todos os IDs visíveis
    const visibleCards = list.querySelectorAll('.notif-item');
    const dismissed = JSON.parse(localStorage.getItem('vesto_dismissed_notifs') || '[]');

    visibleCards.forEach((card, index) => {
        // Efeito cascata na saída
        setTimeout(() => {
            card.style.transform = 'translateX(20px)';
            card.style.opacity = '0';
        }, index * 50);

        // Salva ID no localStorage
        const id = card.getAttribute('data-notif-id');
        if (id && !dismissed.includes(id)) {
            dismissed.push(id);
        }
    });

    localStorage.setItem('vesto_dismissed_notifs', JSON.stringify(dismissed));

    setTimeout(() => {
        list.innerHTML = '';
        checkEmptyState();
    }, (visibleCards.length * 50) + 200);
}

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
const isAcao = (symbol) => {
    if (!symbol) return false;
    return !isFII(symbol);
};


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

// --- FUNÇÃO DE LAZY LOADING (Carrega o Excel só quando precisa) ---
function loadSheetJS() {
    return new Promise((resolve, reject) => {
        // Se a biblioteca já existe na janela, não baixa de novo
        if (typeof XLSX !== 'undefined') {
            return resolve();
        }

        const script = document.createElement('script');
        script.src = "https://cdn.sheetjs.com/xlsx-0.20.0/package/dist/xlsx.full.min.js";
        script.onload = () => {
            console.log("Biblioteca XLSX carregada com sucesso.");
            resolve();
        };
        script.onerror = () => reject(new Error("Falha ao baixar a biblioteca Excel. Verifique sua conexão."));
        document.body.appendChild(script);
    });
}

function criarCardElemento(ativo, dados) {
    const {
        dadoPreco, precoFormatado, variacaoFormatada, corVariacao,
        totalPosicao, custoTotal, lucroPrejuizo, lucroPrejuizoPercent,
        corPL, dadoProvento, percentWallet, 
        listaProventos = [] 
    } = dados;

    const sigla = ativo.symbol.substring(0, 2);
    const ehFii = isFII(ativo.symbol);
    const bgIcone = ehFii ? 'bg-black' : 'bg-[#151515]';

    const iconUrl = `https://raw.githubusercontent.com/thefintz/icones-b3/main/icones/${ativo.symbol}.png`;
    const iconHtml = !ehFii 
        ? `<img src="${iconUrl}" alt="${ativo.symbol}" class="w-full h-full object-contain p-0.5 rounded-xl relative z-10" onerror="this.style.display='none'; this.nextElementSibling.classList.remove('hidden');" />
           <span class="hidden w-full h-full flex items-center justify-center text-xs font-bold text-white tracking-wider absolute inset-0 z-0">${sigla}</span>`
        : `<span class="text-xs font-bold text-white tracking-wider">${sigla}</span>`;

    const bgBadge = lucroPrejuizo >= 0 ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500';
    const plArrow = lucroPrejuizo >= 0 ? '▲' : '▼';
    const plTagHtml = dadoPreco 
        ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${bgBadge} border border-white/5 flex items-center gap-1">
             ${plArrow} ${Math.abs(lucroPrejuizoPercent).toFixed(1)}%
           </span>` 
        : '';

    // HTML Proventos
    let proventosHtml = '';
    let proventosParaExibir = (listaProventos && listaProventos.length > 0) ? listaProventos : (dadoProvento ? [dadoProvento] : []);
    proventosParaExibir.sort((a, b) => new Date(a.paymentDate) - new Date(b.paymentDate));

    if (proventosParaExibir.length > 0) {
        const totalReceberGeral = proventosParaExibir.reduce((acc, p) => acc + (p.value * ativo.quantity), 0);
        const linhasHtml = proventosParaExibir.map(p => {
            const parts = p.paymentDate.split('-');
            const dataPag = new Date(parts[0], parts[1] - 1, parts[2]);
            const hoje = new Date(); hoje.setHours(0,0,0,0);
            const isPago = dataPag <= hoje;
            const dataFormatada = formatDate(p.paymentDate).substring(0, 5); 
            const valorTotalParcela = p.value * ativo.quantity;

            return `
                <div class="flex justify-between items-center py-2 border-b border-[#2C2C2E] last:border-0 text-xs">
                    <div class="flex items-center gap-2">
                        <div class="w-1.5 h-1.5 rounded-full ${isPago ? 'bg-green-500' : 'bg-yellow-500'}"></div>
                        <span class="text-gray-400 font-medium">${dataFormatada}</span>
                        <span class="text-[10px] px-1.5 rounded bg-[#222] text-gray-500 border border-[#333] uppercase">${p.type || 'DIV'}</span>
                    </div>
                    <span class="font-bold ${isPago ? 'text-green-500/70 line-through' : 'text-gray-200'}">
                        ${formatBRL(valorTotalParcela)}
                    </span>
                </div>`;
        }).join('');

        proventosHtml = `
        <div class="mt-4 pt-3 border-t border-[#2C2C2E]">
            <div class="flex justify-between items-center mb-2">
                <span class="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Provisão Futura</span>
                <span class="text-xs font-bold text-green-400 bg-green-900/10 px-2 py-0.5 rounded border border-green-900/20">
                    Total: ${formatBRL(totalReceberGeral)}
                </span>
            </div>
            <div class="bg-[#151515] rounded-lg border border-[#2C2C2E] px-3 max-h-[120px] overflow-y-auto custom-scroll">
                ${linhasHtml}
            </div>
        </div>`;
    } else {
        proventosHtml = `
             <div class="mt-4 pt-3 border-t border-[#2C2C2E] text-center">
                 <span class="text-[10px] text-gray-600 uppercase font-bold">Sem proventos anunciados</span>
             </div>`;
    }

    const card = document.createElement('div');
    
    // --- ALTERAÇÃO: Removido 'transition-transform' e 'active:scale' ---
    // O card agora é estático no clique, apenas a seta vai girar.
    card.className = 'wallet-card group cursor-pointer select-none';
    card.setAttribute('data-symbol', ativo.symbol);
    
    card.onclick = function(e) {
        if (e.target.closest('button')) return;
        
        // 1. Identifica a seta deste card
        const currentArrow = this.querySelector('.drawer-arrow');

        // 2. Reseta TODAS as outras setas da página para baixo
        const allArrows = document.querySelectorAll('.drawer-arrow');
        allArrows.forEach(arrow => {
            if (arrow !== currentArrow) {
                arrow.classList.remove('rotate-180');
            }
        });

        // 3. Abre/Fecha gaveta
        toggleDrawer(ativo.symbol);

        // 4. Gira a seta atual
        if (currentArrow) {
            currentArrow.classList.toggle('rotate-180');
        }
    };

    card.innerHTML = `
        <div class="p-3 pb-1"> 
            <div class="flex justify-between items-center">
                
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl ${bgIcone} border border-[#2C2C2E] flex items-center justify-center flex-shrink-0 shadow-sm relative overflow-hidden">
                        ${iconHtml}
                    </div>
                    
                    <div>
                        <div class="flex items-center gap-2">
                            <span class="font-bold text-white text-sm tracking-tight">${ativo.symbol}</span>
                            ${plTagHtml}
                        </div>
                        <div class="text-[11px] text-gray-500 mt-0.5 flex items-center">
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

            <div class="flex justify-center mt-2 mb-1">
                <div class="bg-[#1A1A1C] border border-[#2C2C2E] rounded-full px-3 py-0.5 flex items-center justify-center group-hover:bg-[#252525] group-hover:border-gray-600 transition-colors duration-300">
                    <svg xmlns="http://www.w3.org/2000/svg" class="drawer-arrow h-3 w-3 text-gray-600 group-hover:text-gray-300 transition-transform duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                    </svg>
                </div>
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
                    <div>
                        <span class="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Preço Médio</span>
                        <p class="text-sm text-gray-300 font-medium">${formatBRL(ativo.precoMedio)}</p>
                    </div>
                    <div class="text-right">
                         <span class="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Peso Carteira</span>
                         <p data-field="peso-valor" class="text-sm text-gray-300 font-medium">${formatPercent(percentWallet)}</p>
                    </div>
                </div>
                
                <div data-field="provento-container">
                    ${proventosHtml} 
                </div>

                <div class="flex gap-2 mt-4 pt-2">
                     <button class="flex-1 py-2 text-xs font-bold text-gray-300 bg-[#1C1C1E] border border-[#2C2C2E] rounded-lg hover:bg-[#252525]" onclick="window.abrirDetalhesAtivo('${ativo.symbol}')">
                        Ver Detalhes
                     </button>
                     <button class="py-2 px-3 text-red-400 bg-red-900/10 border border-red-900/20 rounded-lg hover:bg-red-900/20" onclick="window.confirmarExclusao('${ativo.symbol}')">
                        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
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
        corPL, dadoProvento, percentWallet,
        listaProventos = [] 
    } = dados;

    // Atualiza Cabeçalho
    card.querySelector('[data-field="cota-qtd"]').textContent = `${ativo.quantity} cotas`;
    card.querySelector('[data-field="preco-unitario"]').textContent = precoFormatado;
    
    // Atualiza Valores Principais
    card.querySelector('[data-field="posicao-valor"]').textContent = dadoPreco ? formatBRL(totalPosicao) : '...';
    
    // Atualiza Variação
    const varEl = card.querySelector('[data-field="variacao-valor"]');
    varEl.className = `text-xs font-medium ${corVariacao} mt-0.5`;
    varEl.textContent = dadoPreco ? variacaoFormatada : '0.00%';

    // Atualiza Badge L/P
    const headerDiv = card.querySelector('.flex.items-center.gap-2 > span.px-1\\.5');
    if (dadoPreco && headerDiv) {
        const bgBadge = lucroPrejuizo >= 0 ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500';
        const plArrow = lucroPrejuizo >= 0 ? '▲' : '▼';
        headerDiv.className = `px-1.5 py-0.5 rounded text-[10px] font-bold ${bgBadge} border border-white/5 flex items-center gap-1`;
        headerDiv.innerHTML = `${plArrow} ${Math.abs(lucroPrejuizoPercent).toFixed(1)}%`;
    }

    // --- Atualização do Drawer ---
    const custoValorEl = card.querySelector('[data-field="custo-valor"]');
    if (custoValorEl) custoValorEl.textContent = formatBRL(custoTotal);
    
    const plEl = card.querySelector('[data-field="pl-valor"]');
    if (plEl) {
        plEl.textContent = dadoPreco ? formatBRL(lucroPrejuizo) : '...';
        plEl.className = `text-sm font-bold ${corPL}`;
    }

    const pesoEl = card.querySelector('[data-field="peso-valor"]');
    if (pesoEl) {
        pesoEl.textContent = formatPercent(percentWallet);
    }

    // Atualização dos Proventos
    const containerProventos = card.querySelector('[data-field="provento-container"]');
    let proventosParaExibir = (listaProventos && listaProventos.length > 0) ? listaProventos : (dadoProvento ? [dadoProvento] : []);

    if (containerProventos) {
        if (proventosParaExibir.length > 0) {
            proventosParaExibir.sort((a, b) => new Date(a.paymentDate) - new Date(b.paymentDate));

            const totalReceberGeral = proventosParaExibir.reduce((acc, p) => {
                const valorParcela = p.totalValue || (p.value * ativo.quantity);
                return acc + valorParcela;
            }, 0);

            const linhasHtml = proventosParaExibir.map(p => {
                const parts = p.paymentDate.split('-');
                const dataPag = new Date(parts[0], parts[1] - 1, parts[2]);
                const hoje = new Date(); hoje.setHours(0,0,0,0);
                const isPago = dataPag <= hoje;
                const dataFormatada = formatDate(p.paymentDate).substring(0, 5); 
                const valorParcela = p.totalValue || (p.value * ativo.quantity);

                return `
                    <div class="flex justify-between items-center py-2 border-b border-[#2C2C2E] last:border-0 text-xs">
                        <div class="flex items-center gap-2">
                            <div class="w-1.5 h-1.5 rounded-full ${isPago ? 'bg-green-500' : 'bg-yellow-500'}"></div>
                            <span class="text-gray-400 font-medium">${dataFormatada}</span>
                            <span class="text-[10px] px-1.5 rounded bg-[#222] text-gray-500 border border-[#333] uppercase">${p.type || 'DIV'}</span>
                        </div>
                        <span class="font-bold ${isPago ? 'text-green-500/70 line-through' : 'text-gray-200'}">
                            ${formatBRL(valorParcela)}
                        </span>
                    </div>`;
            }).join('');

            containerProventos.innerHTML = `
            <div class="mt-4 pt-3 border-t border-[#2C2C2E]">
                <div class="flex justify-between items-center mb-2">
                    <span class="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Provisão Futura</span>
                    <span class="text-xs font-bold text-green-400 bg-green-900/10 px-2 py-0.5 rounded border border-green-900/20">
                        Total: ${formatBRL(totalReceberGeral)}
                    </span>
                </div>
                <div class="bg-[#151515] rounded-lg border border-[#2C2C2E] px-3 max-h-[120px] overflow-y-auto custom-scroll">
                    ${linhasHtml}
                </div>
            </div>`;
        } else {
            containerProventos.innerHTML = `
             <div class="mt-4 pt-3 border-t border-[#2C2C2E] text-center">
                 <span class="text-[10px] text-gray-600 uppercase font-bold">Sem proventos anunciados</span>
             </div>`;
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
	
	// --- MOVA ESTAS VARIÁVEIS PARA CÁ (TOPO) ---
	let historicoVirtualizer = null;
    let proventosVirtualizer = null;
    const ROW_HEIGHT_CARD = 84;   // Altura estimada do card de transação (pixels)
    const ROW_HEIGHT_HEADER = 50; // Altura estimada do cabeçalho do mês (pixels)
	let lastTransacoesSignature = '';    
    let lastPatrimonioCalcSignature = ''; 
    let lastHistoricoListSignature = '';
    let lastHistoricoProventosSignature = '';	
    let lastAlocacaoData = '';
	let currentPatrimonioRange = '1M';
	let histFilterType = 'all';
    let histSearchTerm = '';
	let provSearchTerm = '';
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
	const btnOpenPatrimonio = document.getElementById('btn-open-patrimonio');
const patrimonioPageModal = document.getElementById('patrimonio-page-modal');
const patrimonioPageContent = document.getElementById('tab-patrimonio-content');
const patrimonioVoltarBtn = document.getElementById('patrimonio-voltar-btn');
const modalPatrimonioValor = document.getElementById('modal-patrimonio-valor');
const modalCustoValor = document.getElementById('modal-custo-valor');

// Variáveis de controle de arrastar (Swipe Down)
let isDraggingPatrimonio = false;
let touchStartPatrimonioY = 0;
let touchMovePatrimonioY = 0;

// --- REFERÊNCIAS DO MODAL DE PROVENTOS ---
const btnOpenProventos = document.getElementById('btn-open-proventos');
const proventosPageModal = document.getElementById('proventos-page-modal');
const proventosPageContent = document.getElementById('tab-proventos-content');
const proventosVoltarBtn = document.getElementById('proventos-voltar-btn');

// Controle de arrastar (Swipe Down) - Proventos
let isDraggingProventos = false;
let touchStartProventosY = 0;
let touchMoveProventosY = 0;

	// --- REFERÊNCIAS DO MODAL DE ALOCAÇÃO ---
const btnOpenAlocacao = document.getElementById('btn-open-alocacao');
const alocacaoPageModal = document.getElementById('alocacao-page-modal');
const alocacaoPageContent = document.getElementById('tab-alocacao-content');
const alocacaoVoltarBtn = document.getElementById('alocacao-voltar-btn');

// Controle de Swipe (Alocação)
let isDraggingAlocacao = false;
let touchStartAlocacaoY = 0;
let touchMoveAlocacaoY = 0;

// --- REFERÊNCIAS MODAL IPCA ---
const btnOpenIpca = document.getElementById('btn-open-ipca');
const ipcaPageModal = document.getElementById('ipca-page-modal');
const ipcaPageContent = document.getElementById('tab-ipca-content');
const ipcaVoltarBtn = document.getElementById('ipca-voltar-btn');
let ipcaChartInstance = null;
let isDraggingIpca = false;
let touchStartIpcaY = 0;
let touchMoveIpcaY = 0;
// Variável para armazenar cache simples do IPCA
let ipcaCacheData = null;
    
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
	const updateNotification = document.getElementById('update-notification');
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
	const patrimonioRangeButtons = document.querySelectorAll('.patrimonio-range-btn');
    patrimonioRangeButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            patrimonioRangeButtons.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentPatrimonioRange = e.target.dataset.range;
            renderizarGraficoPatrimonio();
        });
    });

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
    
    // 1. Alterna classe no Body
    if (isLight) {
        document.body.classList.add('light-mode');
        if (metaTheme) metaTheme.setAttribute('content', '#f2f2f7');
        
        // Cores globais do Chart.js para Light Mode
        Chart.defaults.color = '#4b5563'; // Gray 600
        Chart.defaults.borderColor = 'rgba(0,0,0,0.05)'; // Linhas de grade sutis
    } else {
        document.body.classList.remove('light-mode');
        if (metaTheme) metaTheme.setAttribute('content', '#000000');
        
        // Cores globais do Chart.js para Dark Mode
        Chart.defaults.color = '#9ca3af'; // Gray 400
        Chart.defaults.borderColor = 'rgba(255,255,255,0.05)';
    }

    // Toggle Botão Visual
    if (toggleThemeBtn && themeToggleKnob) {
        if (isLight) {
            toggleThemeBtn.className = "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none bg-purple-600";
            themeToggleKnob.className = "inline-block h-4 w-4 transform rounded-full bg-white transition-transform translate-x-6 shadow-sm";
        } else {
            toggleThemeBtn.className = "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none bg-gray-700";
            themeToggleKnob.className = "inline-block h-4 w-4 transform rounded-full bg-white transition-transform translate-x-1";
        }
    }

    // 2. Função para forçar atualização profunda nas instâncias já criadas
    const updateChartColors = (chart) => {
        if (!chart || !chart.options) return;

        const textColor = isLight ? '#374151' : '#9ca3af';
        const tooltipBg = isLight ? 'rgba(255, 255, 255, 0.98)' : 'rgba(28, 28, 30, 0.95)';
        const tooltipText = isLight ? '#1f2937' : '#f3f4f6';
        const tooltipBorder = isLight ? '#e5e7eb' : '#374151';
        
        // Borda do Donut: Branco no light mode para "cortar" as fatias, Preto no dark
        const doughnutBorder = isLight ? '#ffffff' : '#121212'; 

        if (chart.options.scales) {
            Object.keys(chart.options.scales).forEach(key => {
                const scale = chart.options.scales[key];
                if (scale.ticks) scale.ticks.color = textColor;
                if (scale.grid) {
                    // Remove grade no eixo X geralmente, mantem sutil no Y
                    scale.grid.color = 'transparent'; 
                }
            });
        }

        // Atualiza Legendas
        if (chart.options.plugins && chart.options.plugins.legend && chart.options.plugins.legend.labels) {
            chart.options.plugins.legend.labels.color = textColor;
        }

        // Atualiza Tooltips (Sombra e Contraste)
        if (chart.options.plugins && chart.options.plugins.tooltip) {
            chart.options.plugins.tooltip.backgroundColor = tooltipBg;
            chart.options.plugins.tooltip.titleColor = tooltipText;
            chart.options.plugins.tooltip.bodyColor = tooltipText;
            chart.options.plugins.tooltip.borderColor = tooltipBorder;
            chart.options.plugins.tooltip.borderWidth = 1;
            
            // Adiciona sombra no tooltip light mode via CSS (ChartJS não suporta shadow nativo fácil, mas o bg ajuda)
        }

        // Borda do Gráfico de Rosca (Alocação)
        if (chart.config.type === 'doughnut') {
            if (chart.data.datasets[0]) {
                chart.data.datasets[0].borderColor = doughnutBorder;
                chart.data.datasets[0].borderWidth = 2;
            }
        }
        
        // Cores do Gráfico de Patrimônio (Linha)
        if (chart.config.type === 'line' && chart.data.datasets.length > 1) {
             // Linha de "Investido" (tracejada) precisa escurecer no light mode
             const colorInvestido = isLight ? '#6b7280' : '#525252';
             chart.data.datasets[1].borderColor = colorInvestido;
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
    
    // Pega a data local do usuário (Brasil) em vez de UTC
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const today = `${year}-${month}-${day}`; // Formato YYYY-MM-DD
    
    const snapshot = { date: today, value: totalValor };
    
    // Salva no banco
    await supabaseDB.savePatrimonioSnapshot(snapshot);
    
    // Atualiza o gráfico localmente sem precisar recarregar
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
    const carouselEl = document.getElementById('dashboard-favorites-list');
    if (!carouselEl) return;
    
    carouselEl.innerHTML = '';

    // 1. ESTADO VAZIO (BOTÃO "ADD")
    if (watchlist.length === 0) {
        carouselEl.innerHTML = `
            <div onclick="mudarAba('tab-carteira'); setTimeout(() => document.getElementById('carteira-search-input').focus(), 400);" 
                 class="w-16 h-16 rounded-full bg-[#151515] border border-dashed border-gray-700 flex flex-col items-center justify-center flex-shrink-0 cursor-pointer opacity-70 hover:opacity-100 transition-opacity active:scale-95">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-500 mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
                <span class="text-[8px] text-gray-500 font-bold uppercase tracking-wider">Add</span>
            </div>`;
        return;
    }

    const precosMap = new Map(precosAtuais.map(p => [p.symbol, p]));

    // --- NOVA ORDEM: ALFABÉTICA (A-Z) ---
    // Isso garante que os ícones fiquem sempre na mesma posição
    watchlist.sort((a, b) => a.symbol.localeCompare(b.symbol));

    watchlist.forEach(item => {
        const symbol = item.symbol;
        const dadoPreco = precosMap.get(symbol);
        
        let preco = ''; 
        let corTexto = 'text-gray-400';

        if (dadoPreco && dadoPreco.regularMarketPrice) {
            preco = formatBRL(dadoPreco.regularMarketPrice);
            corTexto = 'text-gray-300';
        }

        const card = document.createElement('div');
        
        // Estilo Circular sem bordas
        card.className = 'w-16 h-16 rounded-full bg-[#151515] flex flex-col items-center justify-center flex-shrink-0 cursor-pointer active:scale-90 transition-all shadow-sm relative group overflow-hidden';
        
        card.onclick = () => window.abrirDetalhesAtivo(symbol);

        card.innerHTML = `
            <span class="text-[10px] font-bold text-white tracking-widest leading-none mb-0.5">${symbol}</span>
            <span class="text-[9px] font-medium ${corTexto} tracking-tighter scale-90">${preco}</span>
        `;
        carouselEl.appendChild(card);
    });
    
    // Botão "Add" no final
    const btnAdd = document.createElement('div');
    btnAdd.className = "w-16 h-16 rounded-full bg-[#1C1C1E] flex items-center justify-center flex-shrink-0 cursor-pointer active:scale-90 transition-all text-gray-500 hover:text-white hover:bg-gray-800";
    btnAdd.onclick = () => {
        mudarAba('tab-carteira'); 
        setTimeout(() => document.getElementById('carteira-search-input').focus(), 400);
    };
    btnAdd.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>`;
    carouselEl.appendChild(btnAdd);
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

        // Cria uma assinatura única para evitar re-cálculos desnecessários se nada mudou
        const currentSignature = `${hojeString}-${proventosConhecidos.length}-${transacoes.length}`;

        if (currentSignature === lastProventosCalcSignature) {
            saldoCaixa = cachedSaldoCaixa;
            if (totalCaixaValor) totalCaixaValor.textContent = formatBRL(saldoCaixa);
            return;
        }

        let novoSaldoCalculado = 0; 
        let proventosParaMarcarComoProcessado = [];

        // 1. Cálculo em Memória (Rápido, pode manter o loop síncrono)
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

        // Atualiza UI e Salva Saldo Localmente
        await salvarCaixa();
        if (totalCaixaValor) totalCaixaValor.textContent = formatBRL(saldoCaixa);
        
        // 2. OTIMIZAÇÃO AQUI: Atualização em Massa no Supabase
        // Em vez de esperar um por um (await no loop), disparamos todos juntos.
        if (proventosParaMarcarComoProcessado.length > 0) {
            try {
                // Promise.all executa todas as requisições de update em paralelo
                await Promise.all(proventosParaMarcarComoProcessado.map(provento => 
                    supabaseDB.updateProventoProcessado(provento.id)
                ));
            } catch (error) {
                console.error("Erro ao atualizar status dos proventos:", error);
                // Não bloqueia o fluxo visual se falhar a atualização no servidor
            }
        }
    }

function calcularCarteira() {
    // 1. Snapshot: Verificamos o tamanho do array e o ID da última transação
    const lastId = transacoes.length > 0 ? transacoes[transacoes.length - 1].id : 'none';
    const currentSignature = `${transacoes.length}-${lastId}`;

    // 2. Trava de Cache: Se a "assinatura" for idêntica, nada mudou desde o último cálculo
    if (currentSignature === lastTransacoesSignature && carteiraCalculada.length > 0) {
        return; // Interrompe a função aqui para economizar processamento
    }

    const ativosMap = new Map();
    // Ordenamos por data para garantir que o cálculo do Preço Médio siga a ordem real das operações
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
            if (ativo.quantity > 0) {
                // O custo total é reduzido proporcionalmente ao Preço Médio atual
                const pmAtual = ativo.totalCost / ativo.quantity;
                ativo.quantity -= t.quantity;
                ativo.totalCost -= t.quantity * pmAtual;
            }
        }
        
        // Proteção contra dízimas periódicas (resíduos matemáticos do JS)
        if (ativo.quantity < 0.0001) { ativo.quantity = 0; ativo.totalCost = 0; }
        ativosMap.set(symbol, ativo);
    }
    
    // Converte o Mapa consolidado em um array para a interface
    carteiraCalculada = Array.from(ativosMap.values())
        .filter(a => a.quantity > 0.0001)
        .map(a => ({
            symbol: a.symbol,
            quantity: a.quantity,
            precoMedio: a.quantity > 0 ? parseFloat((a.totalCost / a.quantity).toFixed(2)) : 0,
            dataCompra: a.dataCompra
        }));

    // 3. Salva a nova assinatura para o próximo ciclo de atualização
    lastTransacoesSignature = currentSignature;
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

// --- CLASSE DE VIRTUALIZAÇÃO V11 (ESTÁVEL - SEM HEADER FLUTUANTE) ---
class VirtualScroller {
    constructor(scrollContainer, listContainer, items, renderRowFn) {
        // 1. Inicializa variáveis CRÍTICAS primeiro para evitar crash
        this.visibleItems = new Map();
        this.positions = [];
        this.totalHeight = 0;
        
        this.scrollContainer = scrollContainer;
        this.listContainer = listContainer;
        this.items = items;
        this.renderRowFn = renderRowFn;
        
        // Configurações de altura
        this.headerHeight = 50; 
        this.rowHeight = 72;
        
        // Limpeza de estilos conflitantes do container original
        this.listContainer.classList.remove('px-4', 'pt-2', 'pb-20');
        this.listContainer.style.marginTop = '0px'; 
        
        // Removemos qualquer lógica de header fixo/sticky aqui.
        // O código fica muito mais leve.

        this.init();
    }

init() {
        let currentY = 0; 
        
        // Mapeia posições de TODOS os itens
        this.positions = this.items.map(item => {
            const height = item.type === 'header' ? this.headerHeight : this.rowHeight; 
            const pos = { top: currentY, height, item };
            currentY += height;
            return pos;
        });
        
        // AUMENTEI DE 120 PARA 180 AQUI
        // Isso garante que o último item suba acima da navbar
        this.totalHeight = currentY + 100; 
        
        this.listContainer.style.height = `${this.totalHeight}px`;
        this.listContainer.classList.add('virtual-list-container');
        
        this.boundOnScroll = this.onScroll.bind(this);
        this.scrollContainer.addEventListener('scroll', this.boundOnScroll, { passive: true });
        
        this.onScroll();
    }

    onScroll() {
        // Verificação de segurança: se a lista foi destruída ou não existe, para.
        if (!this.listContainer.isConnected || !this.visibleItems) return;

        const scrollTop = this.scrollContainer.scrollTop;
        const viewportHeight = this.scrollContainer.clientHeight;
        const buffer = 600; // Renderiza 600px a mais para cima e para baixo (scroll suave)

        const startY = Math.max(0, scrollTop - buffer);
        const endY = scrollTop + viewportHeight + buffer;
        
        const activeIndices = new Set();

        // Loop principal: decide o que desenhar
        for (let i = 0; i < this.positions.length; i++) {
            const pos = this.positions[i];
            const bottom = pos.top + pos.height;

            // Se o item está dentro da área visível (+ buffer)
            if (bottom >= startY && pos.top <= endY) {
                activeIndices.add(i);
                
                // Se ainda não está no DOM, cria
                if (!this.visibleItems.has(i)) {
                    const el = document.createElement('div');
                    el.className = 'virtual-item';
                    el.style.transform = `translateY(${pos.top}px)`;
                    el.style.height = `${pos.height}px`;
                    
                    if (pos.item.type === 'header') {
                         // Renderiza o header como um item normal da lista
                         el.innerHTML = `<div class="virtual-header-row">${pos.item.htmlContent}</div>`;
                         // Headers não precisam de padding lateral extra
                    } else {
                        // Cards precisam de padding lateral
                        el.style.paddingLeft = '16px';
                        el.style.paddingRight = '16px';
                        el.innerHTML = this.renderRowFn(pos.item.data);
                    }

                    this.listContainer.appendChild(el);
                    this.visibleItems.set(i, el);
                }
            }
        }

        // Limpeza: remove itens que saíram da tela
        for (const [index, el] of this.visibleItems.entries()) {
            if (!activeIndices.has(index)) {
                el.remove();
                this.visibleItems.delete(index);
            }
        }
    }

    destroy() {
        if (this.scrollContainer) {
            this.scrollContainer.removeEventListener('scroll', this.boundOnScroll);
        }
        
        // Limpa DOM e Estilos
        this.listContainer.innerHTML = '';
        this.listContainer.style.height = '';
        this.listContainer.classList.remove('virtual-list-container');
        this.listContainer.style.marginTop = '';
        
        // Restaura estilo original (Opcional, caso você desligue a virtualização)
        this.listContainer.classList.add('px-4', 'pt-2', 'pb-20');
        
        this.visibleItems.clear();
        this.visibleItems = null; // Evita memory leak
    }
}
// Helper Simplificado e Robusto
function flattenHistoricoData(grupos) {
    const flatList = [];
    Object.keys(grupos).forEach(mes => {
        
        // SOMA DO CABEÇALHO
        const totalMes = grupos[mes].reduce((acc, item) => {
            if (item.totalCalculado !== undefined) {
                return acc + Number(item.totalCalculado);
            }
            if (item.price && item.quantity) {
                return acc + (Number(item.price) * Number(item.quantity));
            }
            return acc + Number(item.value || 0);
        }, 0);
        
        // HTML do Header (COM FUNDO VERDE E TEXTO VERDE)
        const headerHtml = `
            <h3 class="text-xs font-bold text-neutral-400 uppercase tracking-widest pl-1">${mes}</h3>
            <span class="text-[10px] font-mono font-bold text-green-400 bg-green-500/10 px-2 py-0.5 rounded-md border border-green-500/20">
                Total: ${formatBRL(totalMes)}
            </span>
        `;

        flatList.push({ type: 'header', month: mes, total: totalMes, htmlContent: headerHtml });

        // Items
        grupos[mes].forEach(item => {
            flatList.push({ type: 'row', data: item });
        });
    });
    return flatList;
}

function renderizarHistorico() {
    const listaHistorico = document.getElementById('lista-historico');
    const scrollContainer = document.getElementById('tab-historico'); 
    const historicoStatus = document.getElementById('historico-status');
    const historicoMensagem = document.getElementById('historico-mensagem');

    if (!listaHistorico) return;

    if (historicoVirtualizer) {
        const lastId = transacoes.length > 0 ? transacoes[transacoes.length - 1].id : 'none';
        const currentSignature = `${transacoes.length}-${lastId}-${histFilterType}-${histSearchTerm}`;
        
        if (currentSignature !== lastHistoricoListSignature) {
            historicoVirtualizer.destroy();
            historicoVirtualizer = null;
            lastHistoricoListSignature = currentSignature;
        } else {
            return; 
        }
    } else {
        const lastId = transacoes.length > 0 ? transacoes[transacoes.length - 1].id : 'none';
        lastHistoricoListSignature = `${transacoes.length}-${lastId}-${histFilterType}-${histSearchTerm}`;
    }
    
    let dadosFiltrados = transacoes.filter(t => {
        const matchType = histFilterType === 'all' || t.type === histFilterType;
        const matchSearch = histSearchTerm === '' || t.symbol.includes(histSearchTerm);
        return matchType && matchSearch;
    });

    if (dadosFiltrados.length === 0) {
        historicoStatus.classList.remove('hidden');
        historicoMensagem.textContent = transacoes.length > 0 ? "Nenhum resultado para o filtro." : "Nenhum registro encontrado.";
        return;
    }
    
    historicoStatus.classList.add('hidden');
    
    dadosFiltrados.sort((a, b) => new Date(b.date) - new Date(a.date));
    const grupos = agruparPorMes(dadosFiltrados, 'date');
    
    // Flatten (calcula automaticamente price * quantity)
    const flatItems = flattenHistoricoData(grupos);

    const rowRenderer = (t) => {
        const isVenda = t.type === 'sell';
        const totalTransacao = t.quantity * t.price;
        const dia = new Date(t.date).getDate().toString().padStart(2, '0');
        
        // Ícones de Seta
        const arrowDownGreen = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>`;
        const arrowUpRed = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>`;
        
        const mainIconHtml = isVenda ? arrowUpRed : arrowDownGreen;
        
        // CORRIGIDO:
        // Card = bg-black (Preto Puro)
        // Ícone = bg-[#141414] (Cinza Escuro)
        const cardBg = 'bg-black'; 
        const iconBg = 'bg-[#141414]'; 

        return `
            <div class="history-card flex items-center justify-between py-2 px-3 mb-1 rounded-xl relative group h-full w-full ${cardBg}" style="background-color: black !important;" data-action="edit-row" data-id="${t.id}">
                <div class="flex items-center gap-3 flex-1 min-w-0">
                    
                    <div class="w-10 h-10 rounded-full ${iconBg} border border-[#2C2C2E] flex items-center justify-center flex-shrink-0 relative overflow-hidden">
                        ${mainIconHtml}
                    </div>

                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                            <h4 class="text-sm font-bold text-white tracking-tight leading-none">${t.symbol}</h4>
                        </div>
                        <div class="flex items-center gap-1.5 mt-1 text-[11px] text-gray-500 leading-none">
                            <span class="font-medium text-gray-400">Dia ${dia}</span>
                            <span>•</span>
                            <span>${t.quantity} cotas</span>
                        </div>
                    </div>
                </div>
                <div class="text-right flex flex-col items-end justify-center">
                    <span class="text-[15px] font-bold text-white tracking-tight">${formatBRL(totalTransacao)}</span>
                    <span class="text-[11px] text-gray-500 mt-0.5">${formatBRL(t.price)}</span>
                </div>
            </div>
        `;
    };

    historicoVirtualizer = new VirtualScroller(scrollContainer, listaHistorico, flatItems, rowRenderer);
}

function renderizarHistoricoProventos() {
    const listaHistoricoProventos = document.getElementById('lista-historico-proventos');
    const scrollContainer = document.getElementById('tab-historico');
    
    const lastProvId = proventosConhecidos.length > 0 ? proventosConhecidos[proventosConhecidos.length - 1].id : 'none';
    const termoBusca = provSearchTerm || ''; 
    const currentSignature = `${proventosConhecidos.length}-${lastProvId}-${termoBusca}`;

    if (currentSignature === lastHistoricoProventosSignature && proventosVirtualizer) {
        return; 
    }
    lastHistoricoProventosSignature = currentSignature;

    if (proventosVirtualizer) {
        proventosVirtualizer.destroy();
        proventosVirtualizer = null;
    }
    
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const proventosIniciais = proventosConhecidos.filter(p => {
        if (!p.paymentDate) return false;
        const parts = p.paymentDate.split('-');
        if(parts.length !== 3) return false;
        const dataPag = new Date(parts[0], parts[1] - 1, parts[2]);
        if (dataPag > hoje) return false;

        const buscaValida = termoBusca === '' || p.symbol.includes(termoBusca);
        return buscaValida;
    }).sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));

    if (proventosIniciais.length === 0) {
        listaHistoricoProventos.innerHTML = `
            <div class="flex flex-col items-center justify-center mt-12 opacity-50">
                <p class="text-xs text-gray-500">Nenhum provento efetivado.</p>
            </div>`;
        return;
    }

    const grupos = agruparPorMes(proventosIniciais, 'paymentDate');
    const gruposLimpos = {};

    Object.keys(grupos).forEach(mes => {
        const itensValidos = [];
        grupos[mes].forEach(p => {
            const dataRef = p.dataCom || p.paymentDate;
            const qtd = getQuantidadeNaData(p.symbol, dataRef);
            if (qtd > 0) {
                p.qtdCalculada = qtd; 
                p.totalCalculado = Number(p.value) * Number(qtd); 
                itensValidos.push(p);
            }
        });
        if (itensValidos.length > 0) {
            gruposLimpos[mes] = itensValidos;
        }
    });

    const flatItems = flattenHistoricoData(gruposLimpos);

// --- RENDERIZADOR DE LINHA (PROVENTOS) ---
    const rowRenderer = (p) => {
        const qtd = p.qtdCalculada; 
        const dia = p.paymentDate.split('-')[2]; 
        const total = p.totalCalculado; 
        const sigla = p.symbol.substring(0, 2);
        
        const ehFii = isFII(p.symbol);
        
        // CORRIGIDO: Ícone Cinza Escuro (#141414)
        const bgIcone = 'bg-[#141414]';

        const iconUrl = `https://raw.githubusercontent.com/thefintz/icones-b3/main/icones/${p.symbol}.png`;
        
        const imageHtml = !ehFii 
            ? `<img src="${iconUrl}" alt="${p.symbol}" class="w-full h-full object-contain p-0.5 rounded-full" onerror="this.style.display='none'; this.nextElementSibling.classList.remove('hidden');" />` 
            : '';
        const fallbackClass = !ehFii ? 'hidden' : 'flex';

        let tagHtml = '';
        const rawType = (p.type || '').toUpperCase();
        if (rawType.includes('JCP')) {
            tagHtml = `<span class="text-[9px] font-extrabold text-amber-400 bg-amber-900/20 border border-amber-900/30 px-1.5 py-[1px] rounded-[4px] uppercase tracking-wider leading-none">JCP</span>`;
        } else if (rawType.includes('DIV')) {
            tagHtml = `<span class="text-[9px] font-extrabold text-sky-400 bg-sky-900/20 border border-sky-900/30 px-1.5 py-[1px] rounded-[4px] uppercase tracking-wider leading-none">DIV</span>`;
        } else {
            tagHtml = `<span class="text-[9px] font-extrabold text-gray-300 bg-gray-700/40 border border-gray-600/50 px-1.5 py-[1px] rounded-[4px] uppercase tracking-wider leading-none">REND</span>`;
        }

        return `
            <div class="history-card flex items-center justify-between py-2 px-3 mb-1 rounded-xl relative group h-full w-full bg-black" style="background-color: black !important;">
                <div class="flex items-center gap-3 flex-1 min-w-0">
                    <div class="w-10 h-10 rounded-full ${bgIcone} border border-[#2C2C2E] flex items-center justify-center flex-shrink-0 shadow-sm relative overflow-hidden">
                        ${imageHtml}
                        <span class="${fallbackClass} w-full h-full items-center justify-center text-xs font-bold text-gray-300 tracking-wider absolute inset-0 ${bgIcone}">${sigla}</span>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 h-5">
                            <h4 class="text-sm font-bold text-white tracking-tight leading-none">${p.symbol}</h4>
                            ${tagHtml}
                        </div>
                        <div class="flex items-center gap-1.5 mt-1 text-[11px] text-gray-500 leading-none">
                            <span class="font-medium text-gray-400">Dia ${dia}</span>
                            <span>•</span>
                            <span>${qtd} cotas</span>
                        </div>
                    </div>
                </div>
                <div class="text-right flex flex-col items-end justify-center">
                    <span class="text-[15px] font-bold text-green-400 tracking-tight">+ ${formatBRL(total)}</span>
                </div>
            </div>
        `;
    };

    proventosVirtualizer = new VirtualScroller(scrollContainer, listaHistoricoProventos, flatItems, rowRenderer);
}
    if (btnHistTransacoes && btnHistProventos) {
        const viewTransacoes = document.getElementById('view-transacoes');
        const viewProventos = document.getElementById('view-proventos');
        const statusEl = document.getElementById('historico-status');
        
        // NOVO: Elemento da linha deslizante
        const tabIndicator = document.getElementById('tab-indicator');

        btnHistTransacoes.addEventListener('click', () => {
            // Atualiza botões
            btnHistTransacoes.classList.add('active');
            btnHistProventos.classList.remove('active');
            
            // Move a linha para a ESQUERDA (remove a classe que joga p/ direita)
            if(tabIndicator) tabIndicator.classList.remove('indicator-right');
            
            // Troca views
            viewTransacoes.classList.remove('hidden');
            viewProventos.classList.add('hidden');
            
            if(statusEl) statusEl.classList.add('hidden');
            renderizarHistorico();
        });

        btnHistProventos.addEventListener('click', () => {
            // Atualiza botões
            btnHistProventos.classList.add('active');
            btnHistTransacoes.classList.remove('active');

            // Move a linha para a DIREITA
            if(tabIndicator) tabIndicator.classList.add('indicator-right');

            // Troca views
            viewTransacoes.classList.add('hidden');
            viewProventos.classList.remove('hidden');
            
            if(statusEl) statusEl.classList.add('hidden');
            renderizarHistoricoProventos();
        });
    }

    // 2. Busca no Histórico
    const histSearchInput = document.getElementById('historico-search-input');
    if (histSearchInput) {
        histSearchInput.addEventListener('input', (e) => {
            histSearchTerm = e.target.value.trim().toUpperCase();
            renderizarHistorico();
        });
    }
	
	// 2.1 Busca nos Proventos (Faltava este bloco)
    const provSearchInput = document.getElementById('proventos-search-input');
    if (provSearchInput) {
        provSearchInput.addEventListener('input', (e) => {
            // Atualiza a variável global definida no início do arquivo
            provSearchTerm = e.target.value.trim().toUpperCase();
            // Chama a renderização novamente para aplicar o filtro
            renderizarHistoricoProventos();
        });
    }

    // 3. NOVO: Lógica do Menu de Filtro (Funil) - Substitui os Chips antigos
    const btnFilter = document.getElementById('btn-history-filter');
    const filterMenu = document.getElementById('history-filter-menu');
    const filterItems = document.querySelectorAll('.filter-dropdown-item');

    if (btnFilter && filterMenu) {
        // Abrir/Fechar Menu
        btnFilter.addEventListener('click', (e) => {
            e.stopPropagation();
            filterMenu.classList.toggle('visible');
        });

        // Clique nas opções do menu
        filterItems.forEach(item => {
            item.addEventListener('click', () => {
                const value = item.dataset.value; // 'all', 'buy', 'sell'
                
                // Atualiza visual (Check icon)
                filterItems.forEach(i => {
                    i.classList.remove('selected');
                    i.querySelector('.check-icon').classList.remove('opacity-100');
                    i.querySelector('.check-icon').classList.add('opacity-0');
                });
                item.classList.add('selected');
                item.querySelector('.check-icon').classList.remove('opacity-0');
                item.querySelector('.check-icon').classList.add('opacity-100');

                // Atualiza variável global e renderiza
                histFilterType = value;
                renderizarHistorico();

                // Muda a cor do funil se tiver filtro ativo
                if (value !== 'all') {
                    btnFilter.classList.add('has-filter');
                } else {
                    btnFilter.classList.remove('has-filter');
                }

                // Fecha o menu
                filterMenu.classList.remove('visible');
            });
        });

        // Fechar ao clicar fora
        document.addEventListener('click', (e) => {
            if (filterMenu.classList.contains('visible') && !filterMenu.contains(e.target) && !btnFilter.contains(e.target)) {
                filterMenu.classList.remove('visible');
            }
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
            const tickerRegex = /[A-Z]{4}(3|4|5|6|11)/g; 
            const foundTickers = [...new Set(article.title.match(tickerRegex) || [])];
            let tickersHtml = '';
            if (foundTickers.length > 0) {
                foundTickers.forEach(ticker => {
                    tickersHtml += `<span class="news-ticker-tag text-[10px] py-0.5 px-2 bg-neutral-800 text-neutral-400 rounded-md border border-neutral-700 mr-2 mb-1 inline-block active:bg-neutral-800 active:text-neutral-400 active:border-neutral-700 transition-colors" data-action="view-ticker" data-symbol="${ticker}">${ticker}</span>`;
                });
            }

            const item = document.createElement('div');
            
            // --- ESTILOS ALTERADOS AQUI (DE ROXO PARA AZUL) ---
            let itemWrapperClass = 'group relative transition-all news-card-interactive ';
            let titleClass = 'font-bold text-gray-100 leading-snug mb-2 group-hover:text-white transition-colors ';
            let badgeDestaque = '';

            if (isGlobalFirstItem) {
                // DESTAQUE: Mudado de purple para blue
                itemWrapperClass += 'bg-gradient-to-r from-blue-900/30 to-transparent border-l-[3px] border-blue-500 py-1 my-2 rounded-r-lg';
                titleClass += 'text-base'; 
                // BADGE: Mudado de bg-purple-600 para bg-blue-600
                badgeDestaque = '<span class="inline-block bg-blue-600 text-white text-[9px] font-bold uppercase tracking-wider px-1.5 py-[2px] rounded-sm mb-2">Destaque</span>';
                isGlobalFirstItem = false;
            } else {
                // NORMAL
                itemWrapperClass += 'border-b border-neutral-800 last:border-0 hover:bg-neutral-900/40';
                titleClass += 'text-sm';
            }

            item.className = itemWrapperClass;
            item.setAttribute('data-action', 'toggle-news');
            item.setAttribute('data-target', drawerId);

            // BOTÃO LER NOTÍCIA: Mudado de purple para blue
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
                            <a href="${article.link}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-xs font-bold text-white hover:text-gray-200 transition-colors bg-white/10 border border-white/10 px-3 py-1.5 rounded-md hover:bg-white/20">
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

function renderizarGraficoAlocacao(isRetry = false) {
    const canvas = document.getElementById('alocacao-chart');
    if (!canvas) return;

    // --- 1. REMOÇÃO VISUAL DAS BORDAS ---
    const cardContainer = canvas.closest('.border'); 
    if (cardContainer) {
        cardContainer.classList.remove('border', 'border-[#2C2C2E]');
        cardContainer.style.border = 'none';
        cardContainer.style.boxShadow = 'none';
    }

    // --- 2. DETECÇÃO DE PREÇOS (AUTORRECUPERAÇÃO) ---
    const temPrecos = typeof precosAtuais !== 'undefined' && Array.isArray(precosAtuais) && precosAtuais.length > 0;
    
    if (!window.alocacaoRetryCount) window.alocacaoRetryCount = 0;

    if (!temPrecos && window.alocacaoRetryCount < 5) {
        window.alocacaoRetryTimer = setTimeout(() => {
            window.alocacaoRetryCount++;
            renderizarGraficoAlocacao(true);
        }, 800);
    } else if (temPrecos) {
        window.alocacaoRetryCount = 0;
        if (window.alocacaoRetryTimer) clearTimeout(window.alocacaoRetryTimer);
    }

    // --- 3. MAPA DE PREÇOS ROBUSTO ---
    const mapPrecos = new Map();
    if (temPrecos) {
        precosAtuais.forEach(p => {
            const sym = p.symbol || p.ticker || p.codigo;
            const val = p.regularMarketPrice || p.price || p.cotacao || p.valor;
            if (sym && val) {
                mapPrecos.set(sym.toUpperCase().trim(), parseFloat(val));
            }
        });
    }

    // --- 4. CÁLCULO DOS TOTAIS ---
    let totalGeral = 0;
    const dadosAtivos = [];

    if (typeof carteiraCalculada !== 'undefined' && Array.isArray(carteiraCalculada)) {
        carteiraCalculada.forEach(ativo => {
            const ticker = (ativo.symbol || ativo.ticker).toUpperCase().trim();
            const qtd = parseFloat(ativo.quantity || ativo.quantidade || 0);
            const precoMedio = parseFloat(ativo.precoMedio || ativo.averagePrice || 0);

            // Tenta pegar o preço na ordem: Ao Vivo Global -> Do Ativo (Cache) -> Preço Médio (Fallback)
            let precoLive = mapPrecos.get(ticker);
            if (!precoLive) precoLive = parseFloat(ativo.regularMarketPrice || ativo.price || 0);
            if (!precoLive || isNaN(precoLive) || precoLive === 0) precoLive = precoMedio;

            const valorTotal = precoLive * qtd;

            if (valorTotal > 0.01) { 
                totalGeral += valorTotal;
                dadosAtivos.push({
                    label: ticker,
                    value: valorTotal,
                    qtd: qtd,
                    color: '' // Será preenchido depois
                });
            }
        });
    }

    // Ordenar do maior para o menor valor
    dadosAtivos.sort((a, b) => b.value - a.value);

    // --- 5. CORES ---
    const paletaCores = [
        '#8B5CF6', '#10B981', '#3B82F6', '#F59E0B', 
        '#EC4899', '#6366F1', '#EF4444', '#14B8A6'
    ];
    
    dadosAtivos.forEach((d, i) => {
        d.color = paletaCores[i % paletaCores.length];
    });

    const sortedLabels = dadosAtivos.map(d => d.label);
    const sortedValues = dadosAtivos.map(d => d.value);
    const sortedColors = dadosAtivos.map(d => d.color);

    // --- 6. ATUALIZA TEXTO CENTRAL (TOTAL) ---
    const elTotalCenter = document.getElementById('alocacao-total-center');
    if(elTotalCenter) {
        elTotalCenter.textContent = totalGeral.toLocaleString('pt-BR', { 
            style: 'currency', currency: 'BRL'
        });
    }

    if (dadosAtivos.length === 0) {
        if (typeof alocacaoChartInstance !== 'undefined' && alocacaoChartInstance) {
            alocacaoChartInstance.destroy();
            alocacaoChartInstance = null;
        }
        return;
    }

    // --- 7. RENDERIZAÇÃO DO GRÁFICO ---
    if (typeof alocacaoChartInstance !== 'undefined' && alocacaoChartInstance) {
        alocacaoChartInstance.destroy();
    }

    const ctx = canvas.getContext('2d');
    const isLight = document.body.classList.contains('light-mode');
    const borderColor = isLight ? '#ffffff' : '#151515'; 

    alocacaoChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: sortedLabels,
            datasets: [{
                data: sortedValues,
                backgroundColor: sortedColors,
                borderWidth: 2, 
                borderColor: borderColor,
                hoverOffset: 10, 
                borderRadius: 5 
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '75%', 
            plugins: {
                legend: { display: false }, 
                tooltip: {
                    backgroundColor: isLight ? 'rgba(255,255,255,0.95)' : 'rgba(20, 20, 20, 0.95)',
                    titleColor: isLight ? '#333' : '#fff',
                    bodyColor: isLight ? '#555' : '#ccc',
                    borderColor: isLight ? '#ddd' : '#333',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 12,
                    bodyFont: { family: "'Inter', sans-serif" },
                    titleFont: { family: "'Inter', sans-serif" },
                    callbacks: {
                        label: function(context) {
                            const val = context.raw;
                            const pct = totalGeral > 0 ? ((val / totalGeral) * 100).toFixed(1) + '%' : '0%';
                            return ` ${pct} (${val.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})})`;
                        }
                    }
                }
            },
            animation: { animateScale: true, animateRotate: true }
        }
    });

    // --- 8. ATUALIZA A LEGENDA ABAIXO (LAYOUT AJUSTADO) ---
    const legendContainer = document.getElementById('alocacao-legend-container');
    if (legendContainer) {
        legendContainer.innerHTML = ''; 

        dadosAtivos.forEach(item => {
            const percent = totalGeral > 0 ? ((item.value / totalGeral) * 100).toFixed(1) : 0;
            const valorFormatado = item.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

            const div = document.createElement('div');
            // Container flex para separar Esquerda e Direita
            div.className = 'flex items-center justify-between p-3 bg-[#151515] rounded-2xl mb-2';
            
            // --- AQUI ESTÁ A MUDANÇA: Adicionado 'gap-1' na div flex-col ---
            div.innerHTML = `
                <div class="flex items-center gap-3">
                    <div class="w-1.5 h-8 rounded-full" style="background-color: ${item.color}"></div>
                    
                    <div class="flex flex-col gap-1"> <span class="text-sm font-bold text-white tracking-tight leading-none">${item.label}</span>
                        <span class="text-xs text-gray-500 font-medium">${percent}%</span>
                    </div>
                </div>

                <div class="text-right">
                    <span class="text-sm font-bold text-white tracking-tight">${valorFormatado}</span>
                </div>
            `;
            legendContainer.appendChild(div);
        });
    }
}

// --- EM app.js: Adicione esta função auxiliar (pode ser antes da renderizarGraficoHistorico) ---

function exibirDetalhesProventos(anoMes, labelAmigavel) {
    // 1. Filtrar e Agrupar
    const agrupado = {};
    let totalMes = 0;

    proventosConhecidos.forEach(p => {
        if (!p.paymentDate || !p.paymentDate.startsWith(anoMes)) return;
        const dataRef = p.dataCom || p.paymentDate;
        const qtd = getQuantidadeNaData(p.symbol, dataRef);
        
        if (qtd > 0) {
            const total = p.value * qtd;
            if (!agrupado[p.symbol]) agrupado[p.symbol] = 0;
            agrupado[p.symbol] += total;
            totalMes += total;
        }
    });

    const lista = Object.entries(agrupado).sort(([, a], [, b]) => b - a);

    // 2. HTML da Lista (SEM BORDAS NOS ITENS)
    let html = `<div class="w-full text-left space-y-2 max-h-[50vh] overflow-y-auto custom-scroll pr-1 mt-2">`;
    
    if (lista.length === 0) {
        html += `<p class="text-center text-gray-500 text-sm py-4">Sem dados detalhados.</p>`;
    } else {
        lista.forEach(([ticker, valor]) => {
            html += `
                <div class="flex justify-between items-center p-3 bg-[#151515] rounded-xl">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-lg bg-[#1C1C1E] flex items-center justify-center font-bold text-[10px] text-gray-400">
                            ${ticker.substring(0,2)}
                        </div>
                        <span class="font-bold text-gray-200 text-sm">${ticker}</span>
                    </div>
                    <span class="font-bold text-white text-sm tracking-tight">${formatBRL(valor)}</span>
                </div>
            `;
        });
    }
    
    html += `</div>
        <div class="mt-4 pt-3 border-t border-[#2C2C2E] flex justify-between items-center">
            <span class="text-xs font-bold text-gray-500 uppercase tracking-widest">Total do Mês</span>
            <span class="text-lg font-bold text-purple-400">${formatBRL(totalMes)}</span>
        </div>`;

    // 3. Configurar Modal
    const modal = document.getElementById('custom-modal');
    const modalContent = document.getElementById('custom-modal-content'); // Captura o container
    const title = document.getElementById('custom-modal-title');
    const msg = document.getElementById('custom-modal-message');
    const btnCancel = document.getElementById('custom-modal-cancel');
    const btnOk = document.getElementById('custom-modal-ok');

    // --- REMOVE BORDA DO MODAL TEMPORARIAMENTE ---
    if(modalContent) {
        modalContent.style.border = 'none';
        modalContent.style.boxShadow = '0 25px 50px -12px rgba(0, 0, 0, 0.9)'; // Sombra mais forte para compensar
    }
    // ---------------------------------------------

    title.textContent = `Proventos de ${labelAmigavel}`;
    msg.innerHTML = html; 
    
    btnCancel.style.display = 'none';
    btnOk.textContent = 'Fechar';
    
    btnOk.onclick = () => {
        modal.classList.remove('visible');
        setTimeout(() => {
            // --- RESTAURA BORDA ORIGINAL AO FECHAR ---
            if(modalContent) {
                modalContent.style.border = ''; // Volta ao padrão do CSS/HTML
                modalContent.style.boxShadow = ''; 
            }
            // -----------------------------------------
            
            btnCancel.style.display = 'block';
            btnOk.textContent = 'Confirmar';
            msg.innerHTML = ''; 
            btnOk.onclick = null; 
        }, 300);
    };

    modal.classList.add('visible');
}


function renderizarGraficoHistorico(dadosExternos = null) {
    const canvas = document.getElementById('historico-proventos-chart');
    if (!canvas) return;

    // --- PROCESSAMENTO DE DADOS ---
    let labelsFiltrados, dataRecebidoFiltrados, dataAReceberFiltrados, keysFiltrados;

    if (dadosExternos && dadosExternos.labels) {
        labelsFiltrados = dadosExternos.labels;
        dataRecebidoFiltrados = dadosExternos.data; 
        dataAReceberFiltrados = new Array(labelsFiltrados.length).fill(0); 
    }
    
    // Dados Locais (Padrão)
    const grupos = {};
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);

    proventosConhecidos.forEach(p => {
        if (!p.paymentDate || p.value <= 0) return;
        const key = p.paymentDate.substring(0, 7); // YYYY-MM
        const dataRef = p.dataCom || p.paymentDate;
        const qtd = getQuantidadeNaData(p.symbol, dataRef);
        
        if (qtd > 0) {
            if (!grupos[key]) grupos[key] = { recebido: 0, aReceber: 0 };
            const [ano, mes, dia] = p.paymentDate.split('-');
            const dataPagamento = new Date(ano, mes - 1, dia);
            const valorTotal = p.value * qtd;

            if (dataPagamento <= hoje) grupos[key].recebido += valorTotal;
            else grupos[key].aReceber += valorTotal;
        }
    });

    let mesesOrdenados = Object.keys(grupos).sort();
    const labelsRaw = [];
    const dataR = [];
    const dataA = [];
    const keysRaw = [];

    mesesOrdenados.forEach(mesIso => {
        const [anoFull, mesNum] = mesIso.split('-');
        const dateObj = new Date(parseInt(anoFull), parseInt(mesNum) - 1, 1);
        const nomeMes = dateObj.toLocaleString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase();
        const anoCurto = anoFull.slice(-2);
        
        labelsRaw.push(`${nomeMes}/${anoCurto}`);
        dataR.push(grupos[mesIso].recebido);
        dataA.push(grupos[mesIso].aReceber);
        keysRaw.push(mesIso);
    });

    labelsFiltrados = labelsRaw.slice(-12);
    dataRecebidoFiltrados = dataR.slice(-12);
    dataAReceberFiltrados = dataA.slice(-12);
    keysFiltrados = keysRaw.slice(-12);

    if (historicoChartInstance) {
        historicoChartInstance.destroy();
    }

    const ctx = canvas.getContext('2d');
    
    // Cores (Roxo para Recebido, Cinza Escuro para Futuro)
    const colorRecebido = '#8B5CF6'; 
    const colorAReceber = '#333333'; 

    historicoChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labelsFiltrados,
            datasets: [
                {
                    label: 'A Receber', 
                    data: dataAReceberFiltrados,
                    backgroundColor: colorAReceber,
                    borderRadius: 4,
                    barPercentage: 0.6,
                    stack: 'Stack 0',
                    rawKeys: keysFiltrados 
                },
                {
                    label: 'Recebido',
                    data: dataRecebidoFiltrados,
                    backgroundColor: colorRecebido,
                    borderRadius: 4,
                    barPercentage: 0.6,
                    stack: 'Stack 0',
                    rawKeys: keysFiltrados
                }
            ]
        },
        options: {
            responsive: true, 
            maintainAspectRatio: false,
            animation: { duration: 600 },
            layout: { padding: { top: 10, bottom: 0 } },
            interaction: { mode: 'nearest', axis: 'x', intersect: false },
            
            onClick: (e, elements) => {
                if (!elements || elements.length === 0) return;
                
                const index = elements[0].index;
                const labelAmigavel = labelsFiltrados[index]; 
                const rawKey = keysFiltrados[index]; 
                
                renderizarListaProventosMes(rawKey, labelAmigavel);
            },

            plugins: {
                legend: { display: false }, 
                
                // --- CUSTOMIZAÇÃO DO TOOLTIP (FONTE INTER + TAMANHO REDUZIDO) ---
                tooltip: { 
                    enabled: true,
                    backgroundColor: 'rgba(20, 20, 20, 0.95)',
                    titleColor: '#ffffff',
                    bodyColor: '#cccccc',
                    borderColor: '#333333',
                    borderWidth: 1,
                    padding: 8,              // Reduzi o padding de 10 para 8
                    displayColors: true,
                    boxWidth: 6,             // Reduzi a caixa de cor de 8 para 6
                    boxHeight: 6,
                    usePointStyle: true,
                    
                    // Configurações de Fonte
                    titleFont: {
                        family: "'Inter', sans-serif",
                        size: 11,            // Título menor
                        weight: 'bold'
                    },
                    bodyFont: {
                        family: "'Inter', sans-serif",
                        size: 11,            // Corpo menor
                        weight: '500'
                    },

                    callbacks: {
                        title: function(context) {
                            return context[0].label;
                        },
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                if(context.parsed.y === 0) return null;
                                label += formatBRL(context.parsed.y);
                            }
                            return label;
                        }
                    }
                } 
            },
            scales: {
                y: { display: false, stacked: true },
                x: { 
                    stacked: true, 
                    grid: { display: false }, 
                    ticks: {
                        color: '#666',
                        // Fonte do Eixo X também ajustada para Inter
                        font: { 
                            family: "'Inter', sans-serif",
                            size: 10, 
                            weight: '600' 
                        }
                    }
                }
            }
        }
    });
    
    if (keysFiltrados.length > 0) {
        const lastIdx = keysFiltrados.length - 1;
        renderizarListaProventosMes(keysFiltrados[lastIdx], labelsFiltrados[lastIdx]);
    }
}
    
function renderizarListaProventosMes(anoMes, labelAmigavel) {
    const container = document.getElementById('proventos-lista-container');
    const labelMes = document.getElementById('proventos-mes-selecionado');
    
    if (!container) return;
    if (labelMes) labelMes.textContent = labelAmigavel;

    const agrupado = {};
    let totalMes = 0;

    proventosConhecidos.forEach(p => {
        if (!p.paymentDate || !p.paymentDate.startsWith(anoMes)) return;
        const dataRef = p.dataCom || p.paymentDate;
        const qtd = getQuantidadeNaData(p.symbol, dataRef);
        if (qtd > 0) {
            const total = p.value * qtd;
            if (!agrupado[p.symbol]) {
                agrupado[p.symbol] = {
                    symbol: p.symbol,
                    valorTotal: 0,
                    qtd: qtd,
                    dataPag: p.paymentDate // Formato YYYY-MM-DD
                };
            }
            agrupado[p.symbol].valorTotal += total;
            totalMes += total;
        }
    });

    const lista = Object.values(agrupado).sort((a, b) => b.valorTotal - a.valorTotal);
    container.innerHTML = ''; 

    if (lista.length === 0) {
        container.innerHTML = `<p class="text-center text-gray-600 text-xs py-8">Nenhum pagamento registrado.</p>`;
        return;
    }

    // Data de hoje zerada (00:00:00) para comparação justa
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    lista.forEach(item => {
        const percent = ((item.valorTotal / totalMes) * 100).toFixed(1);
        const [ano, mes, dia] = item.dataPag.split('-').map(Number); // Separa YYYY-MM-DD
        
        // Cria objeto data do pagamento
        const dataPagamentoObj = new Date(ano, mes - 1, dia);

        // Lógica: Se a data do pagamento for menor ou igual a hoje, foi recebido.
        const foiRecebido = dataPagamentoObj <= hoje;

        const tickerInitials = item.symbol.substring(0, 2);
        
        // --- ALTERAÇÃO SOLICITADA ---
        // 1. Definimos a cor apenas para o STATUS, não para o valor.
        const corStatus = foiRecebido ? 'text-green-500' : 'text-amber-400'; 
        const textoStatus = foiRecebido ? 'Recebido' : 'A Receber';

        // 2. O Valor monetário agora é fixo 'text-white'
        const cardHTML = `
            <div class="flex items-center gap-3 p-3 bg-[#151515] rounded-2xl mb-2 active:scale-[0.98] transition-transform">
                
                <div class="w-10 h-10 rounded-xl bg-black flex items-center justify-center border border-[#2C2C2E] flex-shrink-0">
                     <span class="text-xs font-bold text-white tracking-wider">${tickerInitials}</span>
                </div>

                <div class="flex-1 min-w-0">
                    <div class="flex justify-between items-center mb-0.5">
                        <span class="text-sm font-bold text-white uppercase">${item.symbol}</span>
                        <span class="text-sm font-bold text-white tracking-tight">${formatBRL(item.valorTotal)}</span>
                    </div>
                    
                    <div class="flex justify-between items-center">
                        <span class="text-[10px] text-gray-500 font-medium">Dia ${dia} • ${item.qtd} cotas</span>
                        <span class="text-[10px] ${corStatus} font-medium flex items-center gap-1">
                           ${!foiRecebido ? '<span class="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block"></span>' : ''} 
                           ${textoStatus}
                        </span>
                    </div>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', cardHTML);
    });

    const totalHTML = `
        <div class="mt-4 pt-4 border-t border-[#2C2C2E] flex justify-between items-center px-2 pb-8">
            <span class="text-xs font-bold text-gray-500 uppercase tracking-widest">Total ${labelAmigavel}</span>
            <span class="text-lg font-bold text-white tracking-tight">${formatBRL(totalMes)}</span>
        </div>
    `;
    container.insertAdjacentHTML('beforeend', totalHTML);
}
    
function openPatrimonioModal() {
    if(!patrimonioPageModal) return;

    // 1. Mostra o modal
    patrimonioPageModal.classList.add('visible');
    patrimonioPageContent.style.transform = ''; 
    patrimonioPageContent.classList.remove('closing');
    document.body.style.overflow = 'hidden';
    
    // 2. Atualiza textos do Header do modal
    if(modalPatrimonioValor && totalCarteiraValor) {
        modalPatrimonioValor.textContent = totalCarteiraValor.textContent;
        // Mantém a classe de blur/privacidade se houver
        if(totalCarteiraValor.classList.contains('blur-sm')) {
            modalPatrimonioValor.classList.add('blur-sm');
        } else {
            modalPatrimonioValor.classList.remove('blur-sm');
        }
    }
    if(modalCustoValor && totalCarteiraCusto) {
        modalCustoValor.textContent = totalCarteiraCusto.textContent;
    }
    requestAnimationFrame(() => {
        setTimeout(() => {
            if (patrimonioChartInstance) {
                // Força o Chart.js a reler o tamanho do container pai
                patrimonioChartInstance.resize();
                patrimonioChartInstance.update('none'); // Update sem animação para ser rápido
            } else {
                // Se o gráfico ainda não existia (primeira vez), cria ele
                renderizarGraficoPatrimonio();
            }
        }, 50); // 50ms é suficiente
    });
}

function closePatrimonioModal() {
        if(!patrimonioPageContent) return;
        
        // 1. Remove qualquer transformação manual feita pelo dedo (reset)
        patrimonioPageContent.style.transform = '';
        
        // 2. Adiciona a classe que faz a animação de descer (definida no CSS)
        patrimonioPageContent.classList.add('closing');
        
        // 3. Remove a visibilidade do fundo escuro
        patrimonioPageModal.classList.remove('visible');
        
        // 4. Libera o scroll da página principal
        document.body.style.overflow = '';
    }
	
	function openProventosModal() {
    if(!proventosPageModal) return;

    proventosPageModal.classList.add('visible');
    proventosPageContent.style.transform = ''; 
    proventosPageContent.classList.remove('closing');
    document.body.style.overflow = 'hidden';

    // Redimensiona o gráfico de histórico (Barras)
    requestAnimationFrame(() => {
        setTimeout(() => {
            if (historicoChartInstance) {
                historicoChartInstance.resize();
                historicoChartInstance.update('none');
            } else {
                // Se não existir ainda, renderiza
                renderizarGraficoHistorico(); 
            }
        }, 50);
    });
}

function closeProventosModal() {
    if(!proventosPageContent) return;
    
    proventosPageContent.style.transform = '';
    proventosPageContent.classList.add('closing');
    proventosPageModal.classList.remove('visible');
    document.body.style.overflow = '';
}

function openAlocacaoModal() {
    if(!alocacaoPageModal) return;

    alocacaoPageModal.classList.add('visible');
    alocacaoPageContent.style.transform = ''; 
    alocacaoPageContent.classList.remove('closing');
    document.body.style.overflow = 'hidden';

    // Redimensiona o gráfico de Rosca
    requestAnimationFrame(() => {
        setTimeout(() => {
            if (alocacaoChartInstance) {
                alocacaoChartInstance.resize();
                alocacaoChartInstance.update('none');
            } else {
                renderizarGraficoAlocacao(); 
            }
        }, 50);
    });
}

function closeAlocacaoModal() {
    if(!alocacaoPageContent) return;
    
    alocacaoPageContent.style.transform = '';
    alocacaoPageContent.classList.add('closing');
    alocacaoPageModal.classList.remove('visible');
    document.body.style.overflow = '';
}

function renderizarGraficoPatrimonio(isRetry = false) {
    const canvas = document.getElementById('patrimonio-chart');
    if (!canvas) return;

    // --- 1. DETECÇÃO DE PREÇOS (AUTORRECUPERAÇÃO) ---
    const temPrecos = typeof precosAtuais !== 'undefined' && Array.isArray(precosAtuais) && precosAtuais.length > 0;
    
    if (!window.patrimonioRetryCount) window.patrimonioRetryCount = 0;

    if (!temPrecos && window.patrimonioRetryCount < 5) {
        window.patrimonioRetryTimer = setTimeout(() => {
            window.patrimonioRetryCount++;
            renderizarGraficoPatrimonio(true);
        }, 800);
    } else if (temPrecos) {
        window.patrimonioRetryCount = 0;
        if (window.patrimonioRetryTimer) clearTimeout(window.patrimonioRetryTimer);
    }

    // --- 2. MAPA DE PREÇOS ROBUSTO ---
    const mapPrecos = new Map();
    if (temPrecos) {
        precosAtuais.forEach(p => {
            const sym = p.symbol || p.ticker || p.codigo;
            const val = p.regularMarketPrice || p.price || p.cotacao || p.valor;
            if (sym && val) {
                mapPrecos.set(sym.toUpperCase().trim(), parseFloat(val));
            }
        });
    }

    // --- 3. CÁLCULO DOS TOTAIS ---
    let totalAtualLive = 0;
    let custoTotalLive = 0;

    if (typeof carteiraCalculada !== 'undefined' && Array.isArray(carteiraCalculada)) {
        carteiraCalculada.forEach(ativo => {
            const ticker = (ativo.symbol || ativo.ticker).toUpperCase().trim();
            const qtd = parseFloat(ativo.quantity || ativo.quantidade || 0);
            const precoMedio = parseFloat(ativo.precoMedio || ativo.averagePrice || 0);

            let precoLive = mapPrecos.get(ticker);
            if (!precoLive) precoLive = parseFloat(ativo.regularMarketPrice || ativo.price || 0);
            if (!precoLive || isNaN(precoLive) || precoLive === 0) precoLive = precoMedio;

            totalAtualLive += precoLive * qtd;
            custoTotalLive += precoMedio * qtd;
        });
    }

    // --- 4. ATUALIZA CARDS SUPERIORES ---
    const elLive = document.getElementById('modal-patrimonio-live');
    if (elLive) {
        elLive.textContent = totalAtualLive.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        elLive.className = "text-sm font-bold text-white mt-1 truncate";
    }

    const elCusto = document.getElementById('modal-custo-valor');
    if (elCusto) {
        elCusto.textContent = custoTotalLive.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    // --- 5. PREPARAÇÃO DO GRÁFICO (DADOS HISTÓRICOS) ---
    const hoje = new Date();
    hoje.setHours(23, 59, 59, 999);
    let dataCorte;

    // --- LÓGICA DE DATAS (ADICIONADO 7D) ---
    if (currentPatrimonioRange === '7D') {
        dataCorte = new Date(hoje);
        dataCorte.setDate(hoje.getDate() - 7);
    } else if (currentPatrimonioRange === '1M') {
        dataCorte = new Date(hoje);
        dataCorte.setDate(hoje.getDate() - 30);
    } else if (currentPatrimonioRange === '6M') {
        dataCorte = new Date(hoje);
        dataCorte.setMonth(hoje.getMonth() - 6);
    } else if (currentPatrimonioRange === '1Y') {
        dataCorte = new Date(hoje);
        dataCorte.setFullYear(hoje.getFullYear() - 1);
    } else {
        dataCorte = new Date('2000-01-01'); // ALL
    }
    dataCorte.setHours(0, 0, 0, 0);

    let dadosOrdenados = [...patrimonio]
        .filter(p => {
             const parts = p.date.split('-'); 
             const dataPonto = new Date(parts[0], parts[1] - 1, parts[2]);
             return dataPonto >= dataCorte;
        })
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    // --- 6. CÁLCULO DAS ESTATÍSTICAS ---
    let variacaoPercent = 0;
    if (dadosOrdenados.length > 0) {
        const valorInicial = dadosOrdenados[0].value;
        const valorFinal = dadosOrdenados[dadosOrdenados.length - 1].value;
        if (valorInicial > 0) {
            variacaoPercent = ((valorFinal - valorInicial) / valorInicial) * 100;
        }
    }

    let maxDrawdown = 0;
    let pico = -Infinity;
    dadosOrdenados.forEach(p => {
        if (p.value > pico) pico = p.value;
        const queda = (p.value - pico) / pico; 
        if (queda < maxDrawdown) maxDrawdown = queda;
    });
    const drawdownDisplay = (maxDrawdown * 100).toFixed(2);

    let volatilidade = 0;
    if (dadosOrdenados.length > 1) {
        const retornos = [];
        for (let i = 1; i < dadosOrdenados.length; i++) {
            const ret = (dadosOrdenados[i].value - dadosOrdenados[i-1].value) / dadosOrdenados[i-1].value;
            retornos.push(ret);
        }
        const mediaRetornos = retornos.reduce((a, b) => a + b, 0) / retornos.length;
        const variancia = retornos.reduce((a, b) => a + Math.pow(b - mediaRetornos, 2), 0) / retornos.length;
        volatilidade = (Math.sqrt(variancia) * Math.sqrt(252)) * 100;
    }

// --- 7. ATUALIZA OS CARDS DE ESTATÍSTICAS (ESTILO BLOOMBERG / MINIMALISTA) ---
    const elVariacao = document.getElementById('stat-variacao');
    const elVariacaoBadge = document.getElementById('stat-variacao-badge');
    
    const elDrawdown = document.getElementById('stat-drawdown');
    
    const elVolatilidade = document.getElementById('stat-volatilidade');
    const elVolTag = document.getElementById('stat-vol-tag');

    // 1. Rentabilidade (Hero) - Verde ou Vermelho Fosco
    if (elVariacao) {
        const sinal = variacaoPercent >= 0 ? '+' : '';
        elVariacao.textContent = `${sinal}${variacaoPercent.toFixed(2)}%`;
        
        // Cores financeiras sóbrias (sem neon)
        // Verde: #4ade80 (Green 400) | Vermelho: #ef4444 (Red 500)
        const corVar = variacaoPercent >= 0 ? '#4ade80' : '#ef4444'; 
        elVariacao.style.color = corVar;

        // Badge de Status (Pílula Sólida)
        if (elVariacaoBadge) {
            // Reset classes
            elVariacaoBadge.className = 'px-3 py-1 rounded text-[10px] font-bold uppercase tracking-wide border';
            
            if (variacaoPercent >= 0) {
                elVariacaoBadge.textContent = 'LUCRO';
                // Fundo verde muito escuro, borda verde escura, texto verde claro
                elVariacaoBadge.classList.add('bg-[#052e16]', 'border-[#14532d]', 'text-[#4ade80]');
            } else {
                elVariacaoBadge.textContent = 'PREJUÍZO';
                // Fundo vermelho muito escuro, borda vermelha escura, texto vermelho claro
                elVariacaoBadge.classList.add('bg-[#450a0a]', 'border-[#7f1d1d]', 'text-[#f87171]');
            }
        }
    }

    // 2. Drawdown (Numérico Puro)
    if (elDrawdown) {
        // Se drawdown for insignificante (< 0.1%), mostra 0.00%
        const displayVal = Math.abs(maxDrawdown) < 0.001 ? 0 : (maxDrawdown * 100).toFixed(2);
        elDrawdown.textContent = `${displayVal}%`;
        
        // Se houver queda relevante (>1%), pinta de vermelho fosco. Senão, cinza neutro.
        if (parseFloat(displayVal) < -0.01 || parseFloat(displayVal) > 1.00) {
             elDrawdown.style.color = '#ef4444'; 
        } else {
             elDrawdown.style.color = '#a1a1aa'; // Zinc 400 (Cinza neutro)
        }
    }

    // 3. Volatilidade (Tag Descritiva)
    if (elVolatilidade) {
        elVolatilidade.textContent = `${volatilidade.toFixed(1)}%`;
        
        let labelVol = 'Baixa';
        let colorClass = 'text-[#a1a1aa]'; // Cinza padrão
        
        if (volatilidade < 10) {
            labelVol = 'Conservadora';
            colorClass = 'text-[#4ade80]'; // Verde
        } else if (volatilidade < 25) {
            labelVol = 'Moderada';
            colorClass = 'text-[#facc15]'; // Amarelo Ouro (não laranja neon)
        } else {
            labelVol = 'Agressiva';
            colorClass = 'text-[#ef4444]'; // Vermelho
        }

        if (elVolTag) {
            elVolTag.textContent = labelVol;
            // Remove classes antigas e aplica a nova cor
            elVolTag.className = `text-[9px] font-bold uppercase tracking-wider ${colorClass}`;
        }
    }

    // --- 8. AGRUPAMENTO MENSAL (APENAS 6M E 1Y) ---
    // 7D e 1M mostram todos os dias disponíveis
    if (['6M', '1Y'].includes(currentPatrimonioRange)) {
        const grupos = {};
        dadosOrdenados.forEach(p => {
            const chaveMes = p.date.substring(0, 7); 
            grupos[chaveMes] = p; 
        });
        dadosOrdenados = Object.values(grupos);
        dadosOrdenados.sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    if (dadosOrdenados.length === 0) {
        if (patrimonioChartInstance) {
            patrimonioChartInstance.destroy();
            patrimonioChartInstance = null;
        }
        const elChartVal = document.getElementById('modal-patrimonio-chart-val');
        if (elChartVal) elChartVal.textContent = "R$ 0,00";
        return;
    }

    // --- 9. GERAÇÃO DE DADOS DO CHART ---
    const labels = [];
    const dataValor = [];
    const dataCusto = [];
    
    const txOrdenadas = [...transacoes].sort((a, b) => new Date(a.date) - new Date(b.date));
    let custoAcumulado = 0;
    let txIndex = 0;

    dadosOrdenados.forEach(p => {
        const parts = p.date.split('-');
        const d = new Date(parts[0], parts[1]-1, parts[2]);
        const dia = String(d.getDate()).padStart(2, '0');
        const mes = d.toLocaleString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase();
        const ano = d.getFullYear().toString().slice(-2);

        // FORMATAÇÃO DE LABELS: 7D e 1M mostram dia/mês
        if (['7D', '1M'].includes(currentPatrimonioRange)) labels.push([dia, mes]); 
        else if (['6M', '1Y'].includes(currentPatrimonioRange)) labels.push([mes, ano]); 
        else labels.push([dia, mes, ano]); 

        dataValor.push(parseFloat(p.value.toFixed(2)));

        const dataPontoLimite = new Date(p.date + 'T23:59:59');
        while(txIndex < txOrdenadas.length) {
            const tx = txOrdenadas[txIndex];
            const dataTx = new Date(tx.date);
            if (dataTx <= dataPontoLimite) {
                let operacao = (tx.quantity * tx.price);
                if (tx.type === 'buy') custoAcumulado += operacao;
                if (tx.type === 'sell') custoAcumulado -= operacao;
                custoAcumulado = parseFloat(custoAcumulado.toFixed(2));
                txIndex++;
            } else {
                break;
            }
        }
        dataCusto.push(custoAcumulado);
    });

    // --- 10. ATUALIZA CARD "GRÁFICO" ---
    const elChartVal = document.getElementById('modal-patrimonio-chart-val');
    if (elChartVal) {
        if (dataValor.length > 0) {
            const ultimoValorGrafico = dataValor[dataValor.length - 1];
            elChartVal.textContent = ultimoValorGrafico.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        } else {
            elChartVal.textContent = "R$ 0,00";
        }
    }

    // --- 11. RENDERIZAÇÃO ---
    const ctx = canvas.getContext('2d');
    const isLight = document.body.classList.contains('light-mode');
    const colorLinePatrimonio = '#c084fc'; 
    const colorLineInvestido = isLight ? '#9ca3af' : '#525252'; 
    const colorGrid = isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)'; 
    const colorText = isLight ? '#6b7280' : '#737373'; 

    const gradientFill = ctx.createLinearGradient(0, 0, 0, 400);
    gradientFill.addColorStop(0, 'rgba(192, 132, 252, 0.25)');
    gradientFill.addColorStop(1, 'rgba(192, 132, 252, 0)');

    if (patrimonioChartInstance) {
        patrimonioChartInstance.data.labels = labels;
        patrimonioChartInstance.data.datasets[0].data = dataValor;
        patrimonioChartInstance.data.datasets[1].data = dataCusto;
        patrimonioChartInstance.update('none'); 
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
                        backgroundColor: gradientFill,
                        borderColor: colorLinePatrimonio,
                        borderWidth: 1.8,
                        tension: 0.4,
                        pointRadius: 0, 
                        pointHitRadius: 30,
                        pointHoverRadius: 4,
                        pointHoverBackgroundColor: '#fff',
                        pointHoverBorderColor: colorLinePatrimonio,
                        pointHoverBorderWidth: 3,
                        order: 1
                    },
                    {
                        label: 'Investido',
                        data: dataCusto,
                        fill: false,
                        borderColor: colorLineInvestido,
                        borderWidth: 1.3,
                        borderDash: [4, 4],
                        tension: 0.4,
                        pointRadius: 0,
                        pointHitRadius: 10,
                        pointHoverRadius: 0,
                        order: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { left: 0, right: 0, top: 10, bottom: 0 } },
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        enabled: true,
                        backgroundColor: '#151515',
                        titleColor: '#9ca3af',
                        bodyColor: '#fff',
                        bodyFont: { weight: 'bold', size: 13 },
                        borderColor: '#2C2C2E',
                        borderWidth: 1,
                        padding: 10,
                        displayColors: true,
                        callbacks: {
                            title: function(context) {
                                const label = context[0].label;
                                return Array.isArray(label) ? label.join(' ') : label;
                            },
                            label: function(context) {
                                return context.dataset.label + ': ' + context.parsed.y.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                            }
                        }
                    }
                },
                scales: {
                    y: { 
                        display: true,
                        position: 'right',
                        grid: { color: colorGrid, borderDash: [4, 4], drawBorder: false },
                        ticks: {
                            color: colorText,
                            font: { size: 10, family: 'monospace' },
                            maxTicksLimit: 6,
                            callback: function(value) {
                                if(value >= 1000) return 'R$ ' + (value/1000).toFixed(1) + 'k';
                                return value;
                            }
                        }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { 
                            display: true,
                            maxRotation: 0,
                            autoSkip: true,
                            maxTicksLimit: 6, 
                            color: colorText,
                            font: { size: 10, weight: 'bold' }
                        } 
                    }
                }
            }
        });
    }

    const lastTxId = (typeof transacoes !== 'undefined' && transacoes.length > 0) ? transacoes[transacoes.length - 1].id : 'none';
    const txCount = (typeof transacoes !== 'undefined') ? transacoes.length : 0;
    const currentSignature = `${currentPatrimonioRange}-${txCount}-${lastTxId}-${totalAtualLive.toFixed(2)}`;
    lastPatrimonioCalcSignature = currentSignature;
}

// No seu arquivo app.js, substitua a função inteira:

function renderizarTimelinePagamentos() {
    const container = document.getElementById('timeline-pagamentos-container');
    const lista = document.getElementById('timeline-lista');
    
    // Configura container para Grid
    lista.className = 'payment-static-list'; 
    
    // --- CORREÇÃO 1: ESPAÇAMENTO ---
    // Usamos paddingTop para evitar colapso de margem. 32px garante o "descanso".
    container.style.marginTop = '0px'; 
    container.style.paddingTop = '32px'; 

    // Verificações iniciais
    if (!proventosAtuais || proventosAtuais.length === 0) {
        container.classList.add('hidden');
        return;
    }

    const hoje = new Date();
    hoje.setHours(0,0,0,0);

    // 1. Filtra (Futuros ou Hoje + Ativo na Carteira) e Ordena
    const pagamentosReais = proventosAtuais.filter(p => {
        if (!p.paymentDate) return false;
        
        const parts = p.paymentDate.split('-');
        const dataPag = new Date(parts[0], parts[1] - 1, parts[2]);
        
        // Ignora passados
        if (dataPag < hoje) return false;

        // Verifica carteira
        const ativoNaCarteira = carteiraCalculada.find(c => c.symbol === p.symbol);
        return ativoNaCarteira && ativoNaCarteira.quantity > 0;
    }).sort((a, b) => new Date(a.paymentDate) - new Date(b.paymentDate));

    if (pagamentosReais.length === 0) {
        container.classList.add('hidden');
        return;
    }

    lista.innerHTML = '';
    const totalItems = pagamentosReais.length;
    
    // Regra: Se tem até 3, mostra 3. Se tem mais, mostra 2 + botão.
    let itemsToRender = [];
    let showMoreButton = false;

    if (totalItems <= 3) {
        itemsToRender = pagamentosReais;
    } else {
        itemsToRender = pagamentosReais.slice(0, 2);
        showMoreButton = true;
    }

    // Renderiza os Cards Normais
    itemsToRender.forEach(prov => {
        const parts = prov.paymentDate.split('-');
        const dataObj = new Date(parts[0], parts[1] - 1, parts[2]);
        
        const dia = parts[2];
        const mes = dataObj.toLocaleString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase();
        const diaSemana = dataObj.toLocaleString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase();
        
        // Verifica se é hoje
        const diffTime = Math.abs(dataObj - hoje);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
        const isHoje = diffDays === 0 || (dataObj.getTime() === hoje.getTime());

        // Cálculos
        const ativoNaCarteira = carteiraCalculada.find(c => c.symbol === prov.symbol);
        const qtd = ativoNaCarteira ? ativoNaCarteira.quantity : 0;
        const totalReceber = prov.value * qtd;

        const classeHoje = isHoje ? 'is-today' : '';
        const textoHeader = isHoje ? 'HOJE' : mes;

        const item = document.createElement('div');
        item.className = `agenda-card ${classeHoje}`; 
        
        // Clique no card abre detalhes do ativo
        item.onclick = () => {
             if(typeof abrirDetalhesAtivo === 'function') abrirDetalhesAtivo(prov.symbol);
        };
        
        const valorFormatado = totalReceber.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

        // --- CORREÇÃO 2: REMOVIDO O STYLE INLINE ---
        // Removemos style="color:..." para que o CSS (style.css) controle as cores (Verde se for hoje, Amarelo padrão)
        item.innerHTML = `
            <div class="agenda-header">${textoHeader}</div>
            
            <div class="agenda-body">
                <span class="agenda-day">${dia}</span>
                <span class="agenda-weekday">${diaSemana}</span>
            </div>
            
            <div class="agenda-footer">
                <span class="agenda-ticker">${prov.symbol}</span>
                <span class="agenda-value">+${valorFormatado}</span>
            </div>
        `;
        lista.appendChild(item);
    });

    // Renderiza o Botão "Ver Todos" (+X)
    if (showMoreButton) {
        const remaining = totalItems - 2;
        const moreBtn = document.createElement('div');
        moreBtn.className = 'agenda-card more-card';
        
        moreBtn.onclick = () => {
            openPagamentosModal(pagamentosReais);
        };
        
        moreBtn.innerHTML = `
            <div class="agenda-body">
                <span class="more-count">+${remaining}</span>
                <span class="more-label">VER TODOS</span>
            </div>
        `;
        lista.appendChild(moreBtn);
    }

    container.classList.remove('hidden');
}

function renderizarDashboardSkeletons(show) {
    const skeletons = [skeletonTotalValor, skeletonTotalCusto, skeletonTotalPL, skeletonTotalProventos, skeletonTotalCaixa];
    const dataElements = [totalCarteiraValor, totalCarteiraCusto, totalCarteiraPL, totalProventosEl, totalCaixaValor];
    
    if (show) {
        skeletons.forEach(el => { if(el) el.classList.remove('hidden'); });
        dataElements.forEach(el => { if(el) el.classList.add('hidden'); });
    } else {
        skeletons.forEach(el => { if(el) el.classList.add('hidden'); });
        dataElements.forEach(el => { if(el) el.classList.remove('hidden'); });
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

    // Cria Mapas para acesso rápido a preços
    const precosMap = new Map(precosAtuais.map(p => [p.symbol, p]));

    // Cria Mapa de Proventos (Agrupados em Lista)
    const proventosMap = new Map();
    proventosAtuais.forEach(p => {
        if (!proventosMap.has(p.symbol)) {
            proventosMap.set(p.symbol, []);
        }
        proventosMap.get(p.symbol).push(p);
    });
    
    // Ordena a carteira alfabeticamente
    const carteiraOrdenada = [...carteiraCalculada].sort((a, b) => a.symbol.localeCompare(b.symbol));

    let totalValorCarteira = 0;
    let totalCustoCarteira = 0;
    let dadosGrafico = [];

    // PASS 1: Calcular totais globais
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
        
        // Zera Dashboard
        if(totalCarteiraValor) totalCarteiraValor.textContent = formatBRL(0);
        if(totalCaixaValor) totalCaixaValor.textContent = formatBRL(saldoCaixa);
        if(totalCarteiraCusto) totalCarteiraCusto.textContent = formatBRL(0);
        if(totalCarteiraPL) {
            totalCarteiraPL.textContent = `${formatBRL(0)} (---%)`;
            totalCarteiraPL.className = `text-lg font-semibold text-gray-500`;
        }
        
        dashboardMensagem.textContent = 'A sua carteira está vazia. Adicione ativos na aba "Carteira" para começar.';
        dashboardLoading.classList.add('hidden');
        dashboardStatus.classList.remove('hidden');
        
        // --- LAZY LOAD: COMENTADO PARA NÃO INICIAR AUTOMATICAMENTE ---
        // renderizarGraficoAlocacao([]);
        // renderizarGraficoHistorico({ labels: [], data: [] });
        // renderizarGraficoPatrimonio();

        await salvarSnapshotPatrimonio(saldoCaixa);
        return; 
    } else {
        carteiraStatus.classList.add('hidden');
        dashboardStatus.classList.add('hidden');
    }

    // Limpeza de cards antigos
    const symbolsNaCarteira = new Set(carteiraOrdenada.map(a => a.symbol));
    const cardsNaTela = listaCarteira.querySelectorAll('[data-symbol]');
    cardsNaTela.forEach(card => {
        const symbol = card.dataset.symbol;
        if (!symbolsNaCarteira.has(symbol)) {
            card.remove();
        }
    });

    // Define HOJE (zerando horas para comparação correta)
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    // PASS 2: Renderizar ou Atualizar cada Card
    carteiraOrdenada.forEach((ativo, index) => { 
        const dadoPreco = precosMap.get(ativo.symbol);
        
        // 1. Pega TODOS os proventos (passados e futuros) desse ativo
        const listaTodosProventos = proventosMap.get(ativo.symbol) || [];

        // 2. FILTRO: Mantém APENAS os futuros (Data >= Hoje) para exibição na carteira
        const listaProventosFuturos = listaTodosProventos.filter(p => {
            if (!p.paymentDate) return false;
            const parts = p.paymentDate.split('-');
            const dataPag = new Date(parts[0], parts[1] - 1, parts[2]);
            return dataPag >= hoje;
        });

        const dadoProvento = listaProventosFuturos.length > 0 ? listaProventosFuturos[0] : null;

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
        
        // Cálculos Financeiros
        const totalPosicao = precoAtual * ativo.quantity;
        const custoTotal = ativo.precoMedio * ativo.quantity;
        const lucroPrejuizo = totalPosicao - custoTotal;
        const lucroPrejuizoPercent = (custoTotal === 0 || totalPosicao === 0) ? 0 : (lucroPrejuizo / custoTotal) * 100;
        const percentWallet = totalValorCarteira > 0 ? (totalPosicao / totalValorCarteira) * 100 : 0;

        let corPL = 'text-gray-500';
        if (lucroPrejuizo > 0.01) { corPL = 'text-green-500'; }
        else if (lucroPrejuizo < -0.01) { corPL = 'text-red-500'; }

        // 3. CALCULA O TOTAL A RECEBER (Somando apenas a lista FILTRADA de futuros)
        let proventoReceber = 0;
        listaProventosFuturos.forEach(p => {
             const dataReferencia = p.dataCom || p.paymentDate;
             const qtdElegivel = getQuantidadeNaData(ativo.symbol, dataReferencia);
             if (qtdElegivel > 0) {
                 proventoReceber += (qtdElegivel * p.value);
             }
        });

        const dadosRender = {
            dadoPreco, precoFormatado, variacaoFormatada, corVariacao,
            totalPosicao, custoTotal, lucroPrejuizo, lucroPrejuizoPercent,
            corPL, 
            dadoProvento,       
            listaProventos: listaProventosFuturos, // Passa APENAS os futuros para o renderizador do card
            proventoReceber, 
            percentWallet
        };

        if (totalPosicao > 0) { 
            dadosGrafico.push({ symbol: ativo.symbol, totalPosicao: totalPosicao }); 
        }

        // DOM: Cria ou Atualiza
        let card = listaCarteira.querySelector(`[data-symbol="${ativo.symbol}"]`);
        
        if (card) {
            atualizarCardElemento(card, ativo, dadosRender);
        } else {
            card = criarCardElemento(ativo, dadosRender);
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
        
        if(totalCarteiraValor) totalCarteiraValor.textContent = formatBRL(patrimonioTotalAtivos);
        if(totalCaixaValor) totalCaixaValor.textContent = formatBRL(saldoCaixa);
        if(totalCarteiraCusto) totalCarteiraCusto.textContent = formatBRL(totalCustoCarteira);
        
        if(totalCarteiraPL) {
            totalCarteiraPL.innerHTML = `${formatBRL(totalLucroPrejuizo)} <span class="text-xs opacity-60 ml-1">(${totalLucroPrejuizoPercent.toFixed(2)}%)</span>`;
            totalCarteiraPL.className = `text-sm font-semibold ${corPLTotal === 'text-green-500' ? 'text-green-400' : 'text-red-400'}`; 
        }
        
        const patrimonioRealParaSnapshot = patrimonioTotalAtivos + saldoCaixa; 
        renderizarTimelinePagamentos(); // Mantido pois é a timeline visual no dashboard, não o gráfico pesado
        await salvarSnapshotPatrimonio(patrimonioRealParaSnapshot);
    }
    
    // --- LAZY LOAD: COMENTADO PARA NÃO INICIAR AUTOMATICAMENTE ---
    // renderizarGraficoAlocacao(dadosGrafico);
    // renderizarGraficoPatrimonio();
    
    if (carteiraSearchInput && carteiraSearchInput.value) {
        const term = carteiraSearchInput.value.trim().toUpperCase();
        const cards = listaCarteira.querySelectorAll('.wallet-card'); 
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
				window.noticiasCache = cache;
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
			window.noticiasCache = articles;
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

// --- NOVA FUNÇÃO AUXILIAR: Calcula quantos meses buscar ---
    function calcularLimiteMeses(symbol) {
        // Encontra a primeira transação (compra ou venda) deste ativo
        const txsDoAtivo = transacoes
            .filter(t => t.symbol === symbol)
            .sort((a, b) => new Date(a.date) - new Date(b.date));

        // Se não achar transação (ex: acabou de adicionar), busca 12 meses por segurança
        if (txsDoAtivo.length === 0) return 12; 

        const dataPrimeiraCompra = new Date(txsDoAtivo[0].date);
        const hoje = new Date();

        // Cálculo da diferença em meses
        const anosDiff = hoje.getFullYear() - dataPrimeiraCompra.getFullYear();
        const mesesDiff = (anosDiff * 12) + (hoje.getMonth() - dataPrimeiraCompra.getMonth());
        
        // Retorna a quantidade exata + 2 meses de margem (com mínimo de 3)
        return Math.max(3, mesesDiff + 2);
    }

// EM app.js - Substitua a função buscarProventosFuturos por esta versão corrigida:

async function buscarProventosFuturos(force = false) {
    const ativosParaBuscar = carteiraCalculada.map(a => a.symbol); 
    if (ativosParaBuscar.length === 0) return [];

    const proventosPool = [];
    const listaParaAPI = [];

    // 1. Verifica Cache
    await Promise.all(ativosParaBuscar.map(async (symbol) => {
        const cacheKey = `provento_ia_${symbol}`;
        if (force) {
            await vestoDB.delete('apiCache', cacheKey);
        }
        
        const proventoCache = await getCache(cacheKey);
        // CORREÇÃO: Verifica se é Array (versão nova) ou Objeto (versão antiga bugada)
        if (proventoCache && !force) {
            if (Array.isArray(proventoCache)) {
                proventosPool.push(...proventoCache); // Adiciona todos os itens do array
            } else {
                proventosPool.push(proventoCache); // Fallback para cache antigo
            }
        } else {
            const limiteCalculado = calcularLimiteMeses(symbol);
            listaParaAPI.push({ ticker: symbol, limit: limiteCalculado });
        }
    }));
    
    // 2. Busca na API
    if (listaParaAPI.length > 0) {
        try {
            const novosProventos = await callScraperProventosCarteiraAPI(listaParaAPI);
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/; 

            if (novosProventos && Array.isArray(novosProventos)) {
                
                // --- NOVA LÓGICA DE CACHE: Agrupar por Ticker ---
                const proventosPorTicker = {};
                
                // Filtra inválidos e agrupa
                const proventosValidos = novosProventos.filter(p => p && p.symbol && dateRegex.test(p.paymentDate));
                
                proventosValidos.forEach(p => {
                    if (!proventosPorTicker[p.symbol]) {
                        proventosPorTicker[p.symbol] = [];
                    }
                    proventosPorTicker[p.symbol].push(p);
                });

                // Salva no Cache (Array por Ticker)
                await Promise.all(Object.keys(proventosPorTicker).map(async (symbol) => {
                    const lista = proventosPorTicker[symbol];
                    const cacheKey = `provento_ia_${symbol}`;
                    await setCache(cacheKey, lista, CACHE_PROVENTOS);
                    proventosPool.push(...lista);
                }));

                // --- PROCESSAMENTO DE IDs (Mantido e Ajustado) ---
                const idsNesteLote = new Set();

                for (const provento of proventosValidos) {
                    const safeType = provento.type || 'REND';
                    const safeValue = (provento.value || 0).toFixed(4);
                    
                    // Gera ID base
                    let idUnico = `${provento.symbol}_${provento.paymentDate}_${safeType}_${safeValue}`;

                    // Se esse ID já foi gerado neste loop (colisão), adiciona sufixo
                    let contador = 2;
                    while (idsNesteLote.has(idUnico)) {
                        idUnico = `${provento.symbol}_${provento.paymentDate}_${safeType}_${safeValue}_v${contador}`;
                        contador++;
                    }
                    idsNesteLote.add(idUnico);

                    // Verifica se já temos esse ID salvo na memória global
                    const existe = proventosConhecidos.some(p => p.id === idUnico);
                    
                    if (!existe) {
                        const novoProvento = { 
                            ...provento, 
                            processado: false, 
                            id: idUnico,
                            type: safeType 
                        };
                        
                        await supabaseDB.addProventoConhecido(novoProvento);
                        proventosConhecidos.push(novoProvento);
                    }
                }
            }
        } catch (error) {
            console.error("Erro Scraper:", error);
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
        // ALTERAÇÃO: Remove o filtro exclusivo de FIIs
        const ativosCarteira = carteiraCalculada.map(a => a.symbol);
        
        if (ativosCarteira.length === 0) return { labels: [], data: [] };

        const cacheKey = `cache_grafico_historico_${currentUserId}`;
        
        if (force) {
            await vestoDB.delete('apiCache', cacheKey);
        }
        
        let rawDividends = await getCache(cacheKey);

        if (!rawDividends) {
            try {
                rawDividends = await callScraperHistoricoPortfolioAPI(ativosCarteira);
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

// --- FUNÇÃO DE NOTIFICAÇÕES (REMODELADA: CLEAN & PREMIUM) ---
function verificarNotificacoesFinanceiras() {
    const list = document.getElementById('notifications-list');
    const btnClear = document.getElementById('btn-clear-notifications');

    // Setup do botão limpar
    if (btnClear && !btnClear.dataset.hasListener) {
        btnClear.addEventListener('click', limparTodasNotificacoes);
        btnClear.dataset.hasListener = 'true';
    }

    list.innerHTML = '';
    let count = 0;
    const dismissed = JSON.parse(localStorage.getItem('vesto_dismissed_notifs') || '[]');

    // --- Datas e Helpers ---
    const hoje = new Date();
    const offset = hoje.getTimezoneOffset() * 60000;
    const hojeLocal = new Date(hoje.getTime() - offset).toISOString().split('T')[0];
    const hojeDateObj = new Date(hojeLocal + 'T00:00:00'); 
    
    const fmtDia = (dataStr) => {
        if (!dataStr) return '?';
        const parts = dataStr.split('-');
        return `${parts[2]}/${parts[1]}`;
    };

    // Helper CreateCard (Seu código original mantido)
    const createCard = (id, type, title, htmlMsg, iconSvg, linkUrl = null) => {
        const div = document.createElement('div');
        div.className = `notif-item notif-type-${type} notif-animate-enter group cursor-default`;
        div.setAttribute('data-notif-id', id);
        
        let iconColorClass = 'text-gray-400'; 
        if (type === 'payment') iconColorClass = 'text-green-500';
        if (type === 'datacom') iconColorClass = 'text-yellow-500';
        if (type === 'news')    iconColorClass = 'text-blue-400';

        const linkHtml = linkUrl 
            ? `<a href="${linkUrl}" target="_blank" class="text-blue-400 hover:text-blue-300 underline decoration-blue-500/30 ml-1">Ler</a>` 
            : '';

        div.innerHTML = `
            <div class="notif-icon-box">
                <div class="${iconColorClass} w-4 h-4">${iconSvg}</div>
            </div>
            <div class="flex-1 min-w-0 pt-0.5">
                <div class="notif-title flex justify-between">
                    <span>${title}</span>
                    ${linkUrl ? `<span class="opacity-0 group-hover:opacity-100 transition-opacity text-[9px] text-gray-500">Externo ↗</span>` : ''}
                </div>
                <div class="notif-msg text-[11px] leading-relaxed text-gray-300">
                    ${htmlMsg} ${linkHtml}
                </div>
            </div>
            <button onclick="window.dismissNotificationGlobal('${id}', this)" class="notif-close-btn z-10">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
            </button>
        `;
        
        if (linkUrl) {
            div.addEventListener('click', (e) => {
                if(!e.target.closest('button') && !e.target.closest('a')) { window.open(linkUrl, '_blank'); }
            });
            div.classList.add('cursor-pointer', 'hover:bg-[#18181b]');
        }
        return div;
    };

    const getProps = (p) => ({
        paymentDate: p.paymentDate || p.paymentdate,
        dataCom: p.dataCom || p.datacom,
        createdAt: p.created_at || new Date().toISOString()
    });

    // 1. PAGAMENTOS HOJE
    const pagamentosHoje = proventosConhecidos.filter(p => getProps(p).paymentDate === hojeLocal);
    pagamentosHoje.forEach(p => {
        const notifId = `pay_${p.id || p.symbol + p.paymentDate}`;
        if (dismissed.includes(notifId)) return;

        const props = getProps(p);
        const qtd = getQuantidadeNaData(p.symbol, props.dataCom || props.paymentDate);
        
        if (qtd > 0) {
            count++;
            const msg = `Recebeu <strong class="text-white">${formatBRL(p.value * qtd)}</strong> de <strong class="text-white">${p.symbol}</strong> (${qtd} cotas).`;
            const icon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>`;
            list.appendChild(createCard(notifId, 'payment', 'Pagamento Recebido', msg, icon));
        }
    });

    // 2. DATA COM HOJE
    const dataComHoje = proventosConhecidos.filter(p => getProps(p).dataCom === hojeLocal);
    dataComHoje.forEach(p => {
        const notifId = `com_${p.id || p.symbol + 'com'}`;
        if (dismissed.includes(notifId)) return;

        const props = getProps(p);
        count++;
        const msg = `Data Com de <strong class="text-white">${p.symbol}</strong> hoje (${fmtDia(hojeLocal)}).<br>Valor: <strong class="text-white">${formatBRL(p.value)}</strong> • Paga em: ${fmtDia(props.paymentDate)}`;
        const icon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
        list.appendChild(createCard(notifId, 'datacom', 'Data de Corte', msg, icon));
    });

    // 3. NOVOS ANÚNCIOS
    const novosAnuncios = proventosConhecidos.filter(p => {
        const props = getProps(p);
        const dataCriacao = props.createdAt.split('T')[0];
        if (dataCriacao !== hojeLocal) return false;
        if (props.paymentDate === hojeLocal || props.dataCom === hojeLocal) return false; 
        const dataPagamentoObj = new Date((props.paymentDate || '') + 'T00:00:00');
        return dataPagamentoObj >= hojeDateObj;
    });

    novosAnuncios.forEach(p => {
        const notifId = `news_${p.id || p.symbol + 'news'}`;
        if (dismissed.includes(notifId)) return;
        const props = getProps(p);
        count++;
        const msg = `<strong class="text-white">${p.symbol}</strong> anunciou <strong class="text-white">${formatBRL(p.value)}</strong>.<br>Com: ${fmtDia(props.dataCom)} • Pag: ${fmtDia(props.paymentDate)}`;
        const icon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
        list.appendChild(createCard(notifId, 'news', 'Novo Anúncio', msg, icon));
    });

    // 4. NOTÍCIAS DE MERCADO (CORRIGIDO: USA carteiraCalculada)
    if (window.noticiasCache && window.noticiasCache.length > 0 && carteiraCalculada.length > 0) {
        
        const meusTickers = [...new Set(carteiraCalculada.map(item => item.symbol.toUpperCase()))];
        
        window.noticiasCache.slice(0, 30).forEach(noticia => {
            const tickerEncontrado = meusTickers.find(ticker => {
                return noticia.title.toUpperCase().includes(ticker); 
            });

            if (tickerEncontrado) {
                const safeId = 'news_mkt_' + noticia.title.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
                if (dismissed.includes(safeId)) return;

                count++;
                let dataPub = '';
                if (noticia.pubDate) {
                   const d = new Date(noticia.pubDate);
                   dataPub = !isNaN(d) ? ` • ${d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}` : '';
                }

                const msg = `Notícia sobre <strong class="text-white">${tickerEncontrado}</strong> saiu no mercado.${dataPub}<br><span class="text-gray-400 italic">"${noticia.title.slice(0, 50)}..."</span>`;
                const icon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" /></svg>`;
                
                list.appendChild(createCard(safeId, 'news', 'Radar de Notícias', msg, icon, noticia.link));
            }
        });
    }

    checkEmptyState();
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
    // Fazemos isso primeiro para mostrar algo imediatamente (mesmo que velho)
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
        // Atualiza a lista com o que veio da API
        proventosAtuais = processarProventosScraper(proventosConhecidos);
        
        // --- CORREÇÃO IMPORTANTE AQUI ---
        // Força o recálculo do saldo "Recebidos" agora que temos dados novos da nuvem
        await processarDividendosPagos(); 
        // --------------------------------

        renderizarProventos(); // Atualiza o widget de proventos
        
        // Re-renderiza a carteira para atualizar as tags de "Data Com" nos cards
        if (precosAtuais.length > 0) { 
            await renderizarCarteira(); 
        }
        
        // Atualiza gráfico histórico se houver dados novos
        if (typeof renderizarHistoricoProventos === 'function') {
             renderizarHistoricoProventos();
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

        // Atualiza as notificações
        if (typeof verificarNotificacoesFinanceiras === 'function') {
            verificarNotificacoesFinanceiras();
        }
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

// ======================================================
//  LÓGICA DO GRÁFICO DE COTAÇÃO (VISUAL MELHORADO & SEM CACHE PERSISTENTE)
// ======================================================

let cotacaoChartInstance = null;
// Cache agora usa chave composta: "PETR4_1D", "VALE3_5A"
window.tempChartCache = {}; 

async function callScraperCotacaoHistoricaAPI(ticker, range) {
    const body = { 
        mode: 'cotacao_historica', 
        payload: { ticker, range } // Envia o range
    };
    const data = await fetchBFF('/api/scraper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return data.json; 
}

async function fetchCotacaoHistorica(symbol) {
    let container = document.getElementById('detalhes-cotacao-container');
    
    if (!container) {
        // ... (código de criação do container igual ao anterior) ...
        const detalhesPreco = document.getElementById('detalhes-preco');
        if (detalhesPreco && detalhesPreco.parentNode) {
            container = document.createElement('div');
            container.id = 'detalhes-cotacao-container';
            container.className = "mt-6 mb-6 border-t border-[#2C2C2E] pt-4";
            detalhesPreco.parentNode.insertBefore(container, detalhesPreco.nextSibling);
        } else { return; }
    }

    container.innerHTML = `
        <div class="flex flex-col mb-2 px-1">
            <span class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Histórico de Preço</span>
            
            <div class="flex justify-between items-center mb-3 bg-[#1C1C1E] p-2 rounded-lg border border-[#2C2C2E]">
                <div class="flex flex-col">
                    <span class="text-[9px] text-gray-500 uppercase font-bold">Abertura</span>
                    <span id="stat-open" class="text-xs font-mono text-gray-300">--</span>
                </div>

                <div class="flex flex-col items-center">
                    <span class="text-[9px] text-gray-500 uppercase font-bold">Variação</span>
                    <span id="stat-var" class="text-xs font-bold text-gray-300">--</span>
                </div>

                <div class="flex flex-col items-end">
                    <span class="text-[9px] text-gray-500 uppercase font-bold">Fechamento</span>
                    <span id="stat-close" class="text-xs font-mono text-white">--</span>
                </div>
            </div>

            <div class="flex overflow-x-auto no-scrollbar gap-2 pb-1 mb-2" id="chart-filters">
                ${gerarBotaoFiltro('1D', symbol, true)}
                ${gerarBotaoFiltro('5D', symbol)}
                ${gerarBotaoFiltro('1M', symbol)}
                ${gerarBotaoFiltro('6M', symbol)}
                ${gerarBotaoFiltro('YTD', symbol)}
                ${gerarBotaoFiltro('1A', symbol)}
                ${gerarBotaoFiltro('5A', symbol)}
                ${gerarBotaoFiltro('Tudo', symbol)}
            </div>
        </div>
        
        <div class="relative h-72 w-full bg-[#151515] rounded-xl border border-[#2C2C2E] p-2" id="chart-area-wrapper">
             <div class="flex flex-col items-center justify-center h-full animate-pulse">
                <span class="text-[10px] text-gray-600 tracking-wider">CARREGANDO...</span>
            </div>
        </div>
    `;

    await carregarDadosGrafico('1D', symbol);
}

// Helper para gerar HTML dos botões
function gerarBotaoFiltro(label, symbol, isActive = false) {
    const activeClass = "bg-[#3A3A3C] text-white shadow";
    const inactiveClass = "text-gray-500 hover:text-gray-300";
    
    return `<button 
        onclick="mudarPeriodoGrafico('${label}', '${symbol}')" 
        id="btn-${label}" 
        class="px-3 py-1 text-[10px] font-bold rounded transition-all whitespace-nowrap min-w-[35px] ${isActive ? activeClass : inactiveClass}">
        ${label}
    </button>`;
}

// Função orquestradora de dados (Cache vs API)
async function carregarDadosGrafico(range, symbol) {
    const cacheKey = `${symbol}_${range}`;
    
    try {
        let data = window.tempChartCache[cacheKey];

        if (!data) {
            // UI Loading state se necessário (opcional aqui pois já iniciou com skeleton)
            const wrapper = document.getElementById('chart-area-wrapper');
            if(wrapper && !wrapper.querySelector('.animate-pulse')) {
                 wrapper.innerHTML = `<div class="flex flex-col items-center justify-center h-full animate-pulse"><span class="text-[10px] text-gray-600">CARREGANDO...</span></div>`;
            }

            // Busca API
            const response = await callScraperCotacaoHistoricaAPI(symbol, range);
            
            if (response && response.points && response.points.length > 0) {
                data = response.points;
                window.tempChartCache[cacheKey] = data; // Salva no cache específico
            } else {
                throw new Error("Dados vazios");
            }
        }
        
        renderPriceChart(data, range);

    } catch (e) {
        console.error("Erro gráfico:", e);
        const wrapper = document.getElementById('chart-area-wrapper');
        if(wrapper) wrapper.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full text-gray-500">
                <span class="text-xs">Indisponível para ${range}</span>
                <button onclick="carregarDadosGrafico('${range}', '${symbol}')" class="mt-2 text-[10px] text-blue-500">Tentar novamente</button>
            </div>`;
    }
}

// Gerencia clique nos botões
window.mudarPeriodoGrafico = function(range, symbol) {
    // Atualiza classes visuais
    const botoes = document.querySelectorAll('#chart-filters button');
    botoes.forEach(btn => {
        btn.className = "px-3 py-1 text-[10px] font-bold rounded text-gray-500 hover:text-gray-300 transition-all whitespace-nowrap min-w-[35px]";
    });

    const activeBtn = document.getElementById(`btn-${range}`);
    if (activeBtn) {
        activeBtn.className = "px-3 py-1 text-[10px] font-bold rounded bg-[#3A3A3C] text-white shadow transition-all whitespace-nowrap min-w-[35px]";
    }

    // Chama carga de dados
    carregarDadosGrafico(range, symbol);
};

function renderPriceChart(dataPoints, range) {
    const wrapper = document.getElementById('chart-area-wrapper');
    if (!wrapper) return;

    wrapper.innerHTML = '<canvas id="canvas-cotacao" style="width: 100%; height: 100%;"></canvas>';
    const ctx = document.getElementById('canvas-cotacao').getContext('2d');

    if (cotacaoChartInstance) {
        cotacaoChartInstance.destroy();
    }

    // --- DADOS ---
    const labels = dataPoints.map(p => p.date);
    const values = dataPoints.map(p => p.price);
    const startPrice = values[0];
    const endPrice = values[values.length - 1];
    const isPositive = endPrice >= startPrice;
    
    // Cores
    const colorLine = isPositive ? '#00C805' : '#FF3B30'; 
    const colorFillStart = isPositive ? 'rgba(0, 200, 5, 0.15)' : 'rgba(255, 59, 48, 0.15)';
    const colorCrosshairLine = '#A3A3A3'; 
    const colorBadgeBackground = '#404040'; 
    const colorBadgeText = '#FFFFFF'; 

    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, colorFillStart);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    const isIntraday = (range === '1D' || range === '5D');

    // --- FUNÇÃO AUXILIAR: ATUALIZAR HEADER HTML ---
    const updateHeaderStats = (currentPrice) => {
        const elOpen = document.getElementById('stat-open');
        const elClose = document.getElementById('stat-close');
        const elVar = document.getElementById('stat-var');

        if (!elOpen || !elClose || !elVar) return;

        // Abertura é sempre fixa (início do gráfico)
        elOpen.innerText = startPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

        // Fechamento é dinâmico (ou o último, ou o do dedo)
        elClose.innerText = currentPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        elClose.style.color = (currentPrice >= startPrice) ? '#00C805' : '#FF3B30';

        // Variação
        const diff = currentPrice - startPrice;
        const percent = (diff / startPrice) * 100;
        const sign = diff >= 0 ? '+' : '';
        
        elVar.innerText = `${sign}${percent.toFixed(2)}%`;
        elVar.className = `text-xs font-bold ${diff >= 0 ? 'text-[#00C805]' : 'text-[#FF3B30]'}`;
    };

    // Inicializa o Header com os dados finais (Repouso)
    updateHeaderStats(endPrice);

    // Posicionador
    Chart.Tooltip.positioners.followFinger = function(elements, eventPosition) {
        if (!elements.length) return false;
        return { x: elements[0].element.x, y: eventPosition.y };
    };

    // =================================================================
    // PLUGIN A: LINHA DE PREÇO ATUAL (Badge Fixo)
    // =================================================================
    const lastPricePlugin = {
        id: 'lastPriceLine',
        afterDraw: (chart) => {
            const ctx = chart.ctx;
            const meta = chart.getDatasetMeta(0);
            if (!meta.data || meta.data.length === 0) return;
            
            const lastPoint = meta.data[meta.data.length - 1];
            const y = lastPoint.y; 
            const rightEdge = chart.chartArea.right; 
            const leftEdge = chart.chartArea.left;

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(leftEdge, y);
            ctx.lineTo(rightEdge, y);
            ctx.lineWidth = 1;
            ctx.strokeStyle = colorLine; 
            ctx.setLineDash([2, 2]); 
            ctx.stroke();
            ctx.setLineDash([]);

            // Badge
            const text = endPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            ctx.font = 'bold 9px sans-serif'; 
            const textWidth = ctx.measureText(text).width;
            const paddingX = 4;
            const badgeHeight = 16; 
            const badgeWidth = textWidth + (paddingX * 2);
            const badgeX = rightEdge; 
            const badgeY = y - (badgeHeight / 2);

            ctx.fillStyle = colorLine;
            ctx.beginPath();
            ctx.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, 3);
            ctx.fill();

            ctx.fillStyle = '#FFFFFF';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, badgeX + paddingX, y + 1); 
            ctx.restore();
        }
    };

    // =================================================================
    // PLUGIN B: MIRA LIVRE + ATUALIZAÇÃO DO HEADER
    // =================================================================
    const activeCrosshairPlugin = {
        id: 'activeCrosshair',
        afterDraw: (chart) => {
            // Se NÃO estiver tocando, reseta o header para o valor final
            if (!chart.tooltip?._active?.length) {
                if (chart.lastHeaderUpdate !== 'end') {
                    updateHeaderStats(endPrice);
                    chart.lastHeaderUpdate = 'end';
                }
                return;
            }

            // Se ESTIVER tocando:
            if (!chart.tooltip._eventPosition) return;
            const event = chart.tooltip._eventPosition;
            const ctx = chart.ctx;
            const x = event.x; 
            const y = event.y; 
            
            const topY = chart.scales.y.top;
            const bottomY = chart.scales.y.bottom;
            const leftX = chart.scales.x.left;
            const rightX = chart.scales.x.right;

            if (x < leftX || x > rightX || y < topY || y > bottomY) return;

            // --- ATUALIZA O HEADER COM O PREÇO FOCADO ---
            // Pega o valor real do ponto mais próximo (activePoint) para precisão no header
            const activePoint = chart.tooltip._active[0];
            const focusedPrice = dataPoints[activePoint.index].price;
            
            if (chart.lastHeaderValue !== focusedPrice) {
                updateHeaderStats(focusedPrice);
                chart.lastHeaderValue = focusedPrice;
                chart.lastHeaderUpdate = 'active';
            }
            // ---------------------------------------------

            ctx.save();
            ctx.lineWidth = 1;
            ctx.strokeStyle = colorCrosshairLine; 
            ctx.setLineDash([4, 4]);

            // 1. Eixo X (Linha + Data)
            ctx.beginPath();
            ctx.moveTo(x, topY);
            ctx.lineTo(x, bottomY);
            ctx.stroke();

            const xIndex = chart.scales.x.getValueForPixel(x);
            const validIndex = Math.max(0, Math.min(xIndex, dataPoints.length - 1));
            const rawDate = new Date(dataPoints[validIndex].date);
            
            let dateText = "";
            if (isIntraday) {
                 dateText = rawDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + 
                            rawDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute:'2-digit' });
            } else {
                 dateText = rawDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
            }

            ctx.font = 'bold 9px sans-serif';
            const dateWidth = ctx.measureText(dateText).width + 12; 
            const dateHeight = 16;
            let dateBadgeX = x - (dateWidth / 2);
            if (dateBadgeX < leftX) dateBadgeX = leftX;
            if (dateBadgeX + dateWidth > rightX) dateBadgeX = rightX - dateWidth;
            const dateBadgeY = bottomY + 2; 

            ctx.fillStyle = colorBadgeBackground; 
            ctx.beginPath();
            ctx.roundRect(dateBadgeX, dateBadgeY, dateWidth, dateHeight, 3);
            ctx.fill();
            
            ctx.fillStyle = colorBadgeText;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(dateText, dateBadgeX + (dateWidth / 2), dateBadgeY + (dateHeight / 2) + 1);

            // 2. Eixo Y (Linha + Preço da Mira)
            ctx.beginPath();
            ctx.moveTo(leftX, y); 
            ctx.lineTo(rightX, y);
            ctx.stroke();

            const cursorPrice = chart.scales.y.getValueForPixel(y);
            const priceText = cursorPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const priceWidth = ctx.measureText(priceText).width + 8;
            const priceHeight = 16;
            const priceBadgeX = rightX;
            const priceBadgeY = y - (priceHeight / 2);

            ctx.fillStyle = colorBadgeBackground; 
            ctx.beginPath();
            let finalPriceY = priceBadgeY;
            if (finalPriceY < topY) finalPriceY = topY;
            if (finalPriceY + priceHeight > bottomY) finalPriceY = bottomY - priceHeight;

            ctx.roundRect(priceBadgeX, finalPriceY, priceWidth, priceHeight, 3);
            ctx.fill();

            ctx.fillStyle = colorBadgeText;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(priceText, priceBadgeX + 4, finalPriceY + (priceHeight / 2) + 1);

            ctx.restore();
        }
    };

    cotacaoChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                borderColor: colorLine,
                backgroundColor: gradient,
                borderWidth: 1.5,
                pointRadius: 0,
                pointHitRadius: 20, 
                pointHoverRadius: 4,
                pointHoverBackgroundColor: colorLine,
                pointHoverBorderWidth: 0,
                fill: true,
                tension: 0.05
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { 
                padding: { left: 0, right: 38, top: 10, bottom: 20 } 
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: true,
                    position: 'followFinger', 
                    yAlign: 'bottom',
                    caretPadding: 60,
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(28, 28, 30, 0.95)',
                    titleColor: '#9CA3AF',
                    bodyColor: '#FFF',
                    borderColor: '#333',
                    borderWidth: 1,
                    padding: 8,
                    cornerRadius: 6,
                    displayColors: false,
                    callbacks: {
                        // Título com data no tooltip flutuante
                        title: function(context) {
                            const date = new Date(context[0].label);
                            if (isIntraday) {
                                return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + 
                                       date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                            }
                            return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
                        },
                        label: function(context) {
                            return context.parsed.y.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                        }
                    }
                }
            },
            scales: {
                x: { display: false },
                y: { display: false } 
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            },
            animation: { duration: 0 }
        },
        plugins: [lastPricePlugin, activeCrosshairPlugin]
    });
}
    
async function handleMostrarDetalhes(symbol) {
    detalhesMensagem.classList.add('hidden');
    detalhesLoading.classList.remove('hidden');
    detalhesPreco.innerHTML = '';
    detalhesAiProvento.innerHTML = ''; 
    detalhesHistoricoContainer.classList.remove('hidden'); 
    
    // --- 1. ÍCONE E CABEÇALHO ---
    const iconContainer = document.getElementById('detalhes-icone-container');
    const sigla = symbol.substring(0, 2);
    const ehFii = isFII(symbol);
    const ehAcao = !ehFii;
    
    const bgIcone = ehFii ? 'bg-black' : 'bg-[#1C1C1E]';
    const iconUrl = `https://raw.githubusercontent.com/thefintz/icones-b3/main/icones/${symbol}.png`;
    
    const iconHtml = !ehFii 
        ? `<img src="${iconUrl}" alt="${symbol}" class="w-full h-full object-contain p-0.5 rounded-xl relative z-10" onerror="this.style.display='none'; this.nextElementSibling.classList.remove('hidden');" />
           <span class="hidden w-full h-full flex items-center justify-center text-base font-bold text-white tracking-wider absolute inset-0 z-0 ${bgIcone}">${sigla}</span>`
        : `<span class="text-base font-bold text-white tracking-wider">${sigla}</span>`;
    
    if (iconContainer) {
        iconContainer.innerHTML = `
            <div class="w-12 h-12 rounded-2xl ${bgIcone} flex items-center justify-center flex-shrink-0 relative overflow-hidden">
                ${iconHtml}
            </div>
        `;
    }
    
    detalhesTituloTexto.textContent = symbol;
    detalhesNomeLongo.textContent = 'Carregando...';
    
    currentDetalhesSymbol = symbol;
    currentDetalhesMeses = 3; 
    currentDetalhesHistoricoJSON = null; 
    
    const btnsPeriodo = periodoSelectorGroup.querySelectorAll('.periodo-selector-btn');
    btnsPeriodo.forEach(btn => {
        const isActive = btn.dataset.meses === '3';
        btn.className = `periodo-selector-btn py-1.5 px-4 rounded-xl text-xs font-bold transition-all duration-200 ${
            isActive ? 'bg-purple-600 text-white shadow-md active' : 'bg-[#151515] text-[#888888]'
        }`;
    });
    
    // --- 2. BUSCA DE DADOS ---
    const tickerParaApi = ehFii ? `${symbol}.SA` : symbol;
    const cacheKeyPreco = `detalhe_preco_${symbol}`;
    let precoData = await getCache(cacheKeyPreco);
    
    if (!precoData) {
        try {
            const data = await fetchBFF(`/api/brapi?path=/quote/${tickerParaApi}?range=1d&interval=1d`);
            precoData = data.results?.[0];
            if (precoData && !precoData.error) await setCache(cacheKeyPreco, precoData, isB3Open() ? CACHE_PRECO_MERCADO_ABERTO : CACHE_PRECO_MERCADO_FECHADO); 
            else throw new Error(precoData?.error || 'Ativo não encontrado');
        } catch (e) { 
            precoData = null; 
            showToast("Erro ao buscar preço."); 
        }
    }

    let fundamentos = {};
    let nextProventoData = null;

    fetchHistoricoScraper(symbol); 
	fetchCotacaoHistorica(symbol);
    
    try {
        const [fundData, provData] = await Promise.all([
            callScraperFundamentosAPI(symbol),
            callScraperProximoProventoAPI(symbol)
        ]);
        fundamentos = fundData || {};
        nextProventoData = provData;
    } catch (e) { console.error("Erro dados extras", e); }
    
    detalhesLoading.classList.add('hidden');

    // --- 3. CONSTRUÇÃO DO HTML ---
    if (precoData) {
        detalhesNomeLongo.textContent = precoData.longName || 'Nome não disponível';
        const varPercent = precoData.regularMarketChangePercent || 0;
        let variacaoCor = varPercent > 0 ? 'text-green-500' : (varPercent < 0 ? 'text-red-500' : 'text-[#888888]');
        const variacaoIcone = varPercent > 0 ? '▲' : (varPercent < 0 ? '▼' : '');

        const dados = { 
            pvp: fundamentos.pvp || '-', dy: fundamentos.dy || '-', val_mercado: fundamentos.val_mercado || '-', 
            liquidez: fundamentos.liquidez || '-', variacao_12m: fundamentos.variacao_12m || '-', vp_cota: fundamentos.vp_cota || '-',
            pl: fundamentos.pl || '-', roe: fundamentos.roe || '-', lpa: fundamentos.lpa || '-', 
            margem_liquida: fundamentos.margem_liquida || '-', margem_bruta: fundamentos.margem_bruta || '-', margem_ebit: fundamentos.margem_ebit || '-',
            divida_liquida_ebitda: fundamentos.divida_liquida_ebitda || '-', divida_liquida_pl: fundamentos.divida_liquida_pl || '-',
            ev_ebitda: fundamentos.ev_ebitda || '-', payout: fundamentos.payout || '-', 
            cagr_receita: fundamentos.cagr_receita_5a || '-', cagr_lucros: fundamentos.cagr_lucros_5a || '-',
            segmento: fundamentos.segmento || '-', tipo_fundo: fundamentos.tipo_fundo || '-', vacancia: fundamentos.vacancia || '-', 
            ultimo_rendimento: fundamentos.ultimo_rendimento || '-', patrimonio_liquido: fundamentos.patrimonio_liquido || '-', 
            cnpj: fundamentos.cnpj || '-', num_cotistas: fundamentos.num_cotistas || '-', tipo_gestao: fundamentos.tipo_gestao || '-',
            taxa_adm: fundamentos.taxa_adm || '-', mandato: fundamentos.mandato || '-', publico_alvo: fundamentos.publico_alvo || '-',
            cotas_emitidas: fundamentos.cotas_emitidas || '-'
        };

        // --- CÁLCULO DE VALUATION (AÇÕES) ---
        let valuationHtml = '';
        let magicNumberHtml = '';
        
        if (ehAcao) {
            const parseVal = (s) => parseFloat(s?.replace(/[^0-9,-]+/g, '').replace(',', '.')) || 0;
            const lpa = parseVal(dados.lpa);
            const vpa = parseVal(dados.vp_cota);
            const dyVal = parseVal(dados.dy);
            const preco = precoData.regularMarketPrice;

            // 1. Graham
            if (lpa > 0 && vpa > 0) {
                const vi = Math.sqrt(22.5 * lpa * vpa);
                const margemSeguranca = ((vi - preco) / preco) * 100;
                const corGraham = margemSeguranca > 0 ? 'text-green-400' : 'text-red-400';
                
                valuationHtml += `
                    <div class="details-group-card mt-3 relative overflow-hidden">
                        <div class="flex justify-between items-center py-3 px-1">
                            <div>
                                <span class="text-[10px] text-blue-400 font-bold uppercase tracking-wider block mb-0.5">Graham</span>
                                <span class="text-xs text-[#888] font-medium block">Preço Justo</span>
                            </div>
                            <div class="text-right">
                                <span class="text-xl font-bold text-white tracking-tighter">${formatBRL(vi)}</span>
                                <span class="text-[10px] ${corGraham} block font-medium">Upside: ${margemSeguranca.toFixed(1)}%</span>
                            </div>
                        </div>
                    </div>
                `;
            }

            // 2. Bazin
            if (dyVal > 0) {
                const dividendosAnuais = preco * (dyVal / 100);
                const bazinPrice = dividendosAnuais / 0.06;
                const upsideBazin = ((bazinPrice - preco) / preco) * 100;
                const corBazin = upsideBazin > 0 ? 'text-green-400' : 'text-red-400';

                valuationHtml += `
                    <div class="details-group-card mt-2 mb-2 relative overflow-hidden">
                        <div class="flex justify-between items-center py-3 px-1">
                            <div>
                                <span class="text-[10px] text-yellow-500 font-bold uppercase tracking-wider block mb-0.5">Bazin</span>
                                <span class="text-xs text-[#888] font-medium block">Preço Teto (6%)</span>
                            </div>
                            <div class="text-right">
                                <span class="text-xl font-bold text-white tracking-tighter">${formatBRL(bazinPrice)}</span>
                                <span class="text-[10px] ${corBazin} block font-medium">Upside: ${upsideBazin.toFixed(1)}%</span>
                            </div>
                        </div>
                    </div>
                `;
            }
        }

        // --- CÁLCULO MAGIC NUMBER (FIIs) ---
        if (ehFii && dados.ultimo_rendimento !== '-' && dados.ultimo_rendimento !== 'N/A') {
            try {
                const rendStr = dados.ultimo_rendimento.replace('R$', '').replace('.', '').replace(',', '.').trim();
                const rendimento = parseFloat(rendStr);
                const precoAtual = precoData.regularMarketPrice;
                if (rendimento > 0 && precoAtual > 0) {
                    const magicNumber = Math.ceil(precoAtual / rendimento);
                    const custoMagic = magicNumber * precoAtual;
                    
                    magicNumberHtml = `
                        <div class="details-group-card mt-3 mb-2 relative overflow-hidden group">
                            <div class="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                                <svg class="w-16 h-16 text-yellow-500" fill="currentColor" viewBox="0 0 20 20"><path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z"/></svg>
                            </div>
                            <div class="flex justify-between items-center py-3">
                                <div>
                                    <span class="text-[10px] text-yellow-500 font-bold uppercase tracking-wider block mb-0.5">Magic Number</span>
                                    <span class="text-xs text-[#888] font-medium block">Cotas para reinvestir</span>
                                </div>
                                <div class="text-right z-10">
                                    <span class="text-2xl font-bold text-white tracking-tighter">${magicNumber}</span>
                                    <span class="text-[10px] text-[#666] block font-medium">Investimento: ~${formatBRL(custoMagic)}</span>
                                </div>
                            </div>
                        </div>
                    `;
                }
            } catch(e) { console.log('Erro calc magic number', e); }
        }

        // Posição do Usuário
        const ativoCarteira = carteiraCalculada.find(a => a.symbol === symbol);
        let userPosHtml = '';
        if (ativoCarteira) {
            const totalPosicao = precoData.regularMarketPrice * ativoCarteira.quantity;
            userPosHtml = `
                <h4 class="details-category-title">Sua Posição</h4>
                <div class="details-group-card flex justify-between items-center py-4 px-5">
                    <div>
                        <span class="text-xs text-gray-500 font-medium block">Total Investido</span>
                        <div class="flex items-baseline gap-2 mt-0.5">
                            <p class="text-xl font-bold text-white tracking-tight">${formatBRL(totalPosicao)}</p>
                        </div>
                    </div>
                    <div class="text-right">
                         <span class="text-xs text-gray-500 font-medium block">Quantidade</span>
                         <span class="text-base text-gray-200 font-bold">${ativoCarteira.quantity} cotas</span>
                    </div>
                </div>`;
        }

        // Próximo Provento
        let proximoProventoHtml = '';
        if (nextProventoData && nextProventoData.value > 0) {
            const dataPagFmt = nextProventoData.paymentDate ? formatDate(nextProventoData.paymentDate) : '-';
            const dataComFmt = nextProventoData.dataCom ? formatDate(nextProventoData.dataCom) : '-';
            const hoje = new Date(); hoje.setHours(0,0,0,0);
            let isFuturo = false;
            if(nextProventoData.paymentDate) {
                const parts = nextProventoData.paymentDate.split('-');
                if(new Date(parts[0], parts[1]-1, parts[2]) >= hoje) isFuturo = true;
            }
            const bgClass = isFuturo ? "bg-[#0f291e]" : "bg-[#151515]"; 
            const textClass = isFuturo ? "text-green-400" : "text-[#888888]";
            const valueClass = isFuturo ? "text-green-400" : "text-white";

            proximoProventoHtml = `
                <h4 class="details-category-title">Proventos</h4>
                <div class="w-full p-4 rounded-[1.5rem] ${bgClass} flex flex-col gap-3">
                    <div class="flex justify-between items-center pb-2 border-b border-white/5">
                        <span class="text-[10px] uppercase tracking-widest font-bold ${textClass}">${isFuturo ? "Próximo Pagamento" : "Último Anúncio"}</span>
                        <span class="text-xl font-bold ${valueClass}">${formatBRL(nextProventoData.value)}</span>
                    </div>
                    <div class="flex justify-between text-xs pt-1">
                        <div class="text-left"><span class="block text-[#666] mb-0.5 font-medium">Data Com</span><span class="text-[#e5e5e5] font-bold">${dataComFmt}</span></div>
                        <div class="text-right"><span class="block text-[#666] mb-0.5 font-medium">Pagamento</span><span class="text-[#e5e5e5] font-bold">${dataPagFmt}</span></div>
                    </div>
                </div>`;
        }

        // Grid Destaques
        let gridTopo = ehAcao ? 
            `<div class="details-highlight-card"><span class="text-[9px] text-[#666] uppercase font-bold tracking-wider mb-1">P/L</span><span class="text-base font-bold text-white">${dados.pl}</span></div>
             <div class="details-highlight-card"><span class="text-[9px] text-[#666] uppercase font-bold tracking-wider mb-1">P/VP</span><span class="text-base font-bold text-white">${dados.pvp}</span></div>
             <div class="details-highlight-card"><span class="text-[9px] text-[#666] uppercase font-bold tracking-wider mb-1">DY (12m)</span><span class="text-base font-bold text-white">${dados.dy}</span></div>` :
            `<div class="details-highlight-card"><span class="text-[9px] text-[#666] uppercase font-bold tracking-wider mb-1">DY (12m)</span><span class="text-base font-bold text-white">${dados.dy}</span></div>
             <div class="details-highlight-card"><span class="text-[9px] text-[#666] uppercase font-bold tracking-wider mb-1">P/VP</span><span class="text-base font-bold text-white">${dados.pvp}</span></div>
             <div class="details-highlight-card"><span class="text-[9px] text-[#666] uppercase font-bold tracking-wider mb-1">Últ. Rend.</span><span class="text-base font-bold text-white">${dados.ultimo_rendimento}</span></div>`;

        const renderRow = (l, v) => `<div class="details-row"><span class="details-label">${l}</span><span class="details-value">${v}</span></div>`;

        // Listas Categorizadas
        let listasHtml = '';
        if (ehAcao) {
            listasHtml = `
                ${valuationHtml}
                <h4 class="details-category-title">Valuation</h4>
                <div class="details-group-card">
                    ${renderRow('P/L', dados.pl)}
                    ${renderRow('P/VP', dados.pvp)}
                    ${renderRow('EV / EBITDA', dados.ev_ebitda)}
                    ${renderRow('Valor de Mercado', dados.val_mercado)}
                </div>
                <h4 class="details-category-title">Rentabilidade & Eficiência</h4>
                <div class="details-group-card">
                    ${renderRow('ROE', dados.roe)}
                    ${renderRow('Margem Bruta', dados.margem_bruta)}
                    ${renderRow('Margem EBIT', dados.margem_ebit)}
                    ${renderRow('Margem Líquida', dados.margem_liquida)}
                    ${renderRow('Payout', dados.payout)}
                </div>
                <h4 class="details-category-title">Crescimento (5 Anos)</h4>
                <div class="details-group-card">
                    ${renderRow('CAGR Receitas', dados.cagr_receita)}
                    ${renderRow('CAGR Lucros', dados.cagr_lucros)}
                </div>
                <h4 class="details-category-title">Saúde Financeira</h4>
                <div class="details-group-card">
                    ${renderRow('Dív. Líq / PL', dados.divida_liquida_pl)}
                    ${renderRow('Dív. Líq / EBITDA', dados.divida_liquida_ebitda)}
                    ${renderRow('Liquidez Diária', dados.liquidez)}
                </div>`;
        } else {
            listasHtml = `
                ${magicNumberHtml}
                <h4 class="details-category-title">Métricas</h4>
                <div class="details-group-card">
                    ${renderRow('Liquidez Diária', dados.liquidez)}
                    ${renderRow('Patrimônio Líq.', dados.patrimonio_liquido)}
                    ${renderRow('VP por Cota', dados.vp_cota)}
                    ${renderRow('Valor de Mercado', dados.val_mercado)}
                </div>
                <h4 class="details-category-title">Sobre o Fundo</h4>
                <div class="details-group-card">
                    ${renderRow('Segmento', dados.segmento)}
                    ${renderRow('Tipo', dados.tipo_fundo)}
                    ${renderRow('Público Alvo', dados.publico_alvo)}
                    ${renderRow('Vacância', dados.vacancia)}
                    ${renderRow('Gestão', dados.tipo_gestao)}
                </div>
                <h4 class="details-category-title">Taxas & Infos</h4>
                <div class="details-group-card">
                    ${renderRow('Taxa Adm.', dados.taxa_adm)}
                    ${renderRow('Num. Cotistas', dados.num_cotistas)}
                    ${renderRow('CNPJ', `<span class="font-mono text-xs">${dados.cnpj}</span>`)}
                </div>`;
        }

        detalhesPreco.innerHTML = `
            <div class="col-span-12 w-full flex flex-col">
                <div class="text-center pb-6 pt-4">
                    <h2 class="text-[3.5rem] font-bold text-white tracking-tighter leading-none">${formatBRL(precoData.regularMarketPrice)}</h2>
                    <span class="text-base font-bold ${variacaoCor} mt-2 flex items-center justify-center gap-1 tracking-tight">
                        ${variacaoIcone} ${formatPercent(varPercent)} Hoje
                    </span>
                    <span class="text-xs font-medium text-[#444] mt-1 block tracking-wide">
                        Variação 12m: <span class="${dados.variacao_12m?.includes('-') ? 'text-red-500' : 'text-green-500'}">${dados.variacao_12m}</span>
                    </span>
                </div>
                ${userPosHtml}
                ${proximoProventoHtml}
                <h4 class="details-category-title">Indicadores</h4>
                <div class="grid grid-cols-3 gap-2 w-full mb-2">${gridTopo}</div>
                ${listasHtml}
            </div>`;

    } else {
        detalhesPreco.innerHTML = '<p class="text-center text-red-500 py-4">Erro ao buscar preço.</p>';
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
        container.classList.remove('hidden');
        return;
    } 
    
    vazioMsg.classList.add('hidden');
    listaContainer.classList.remove('hidden');
    container.classList.remove('hidden');

    const grupos = agruparPorMes(txsDoAtivo, 'date');
    const fragment = document.createDocumentFragment();

    Object.keys(grupos).forEach(mes => {
        const totalMes = grupos[mes].reduce((acc, t) => acc + (t.quantity * t.price), 0);

        const header = document.createElement('div');
        // Mudei mb-2 para mb-4 aqui também, para alinhar com o "respiro" que você pediu antes
        header.className = 'sticky top-0 z-10 bg-black/95 backdrop-blur-md py-3 px-1 border-b border-neutral-800 mb-4 flex justify-between items-center'; 
        header.style.top = '-1px'; 
        header.style.margin = '0 -8px 8px -8px'; 
        header.style.borderRadius = '12px'; 
        
        header.innerHTML = `
            <h3 class="text-xs font-bold text-neutral-400 uppercase tracking-widest pl-1">
                ${mes}
            </h3>
            <span class="text-[10px] font-mono font-medium text-neutral-500 bg-neutral-900 px-2 py-0.5 rounded-md border border-neutral-800">
                Mov: ${formatBRL(totalMes)}
            </span>
        `;
        fragment.appendChild(header);

        const listaGrupo = document.createElement('div');
        listaGrupo.className = 'pb-2'; 

        grupos[mes].forEach(t => {
            const isVenda = t.type === 'sell';
            const totalTransacao = t.quantity * t.price;
            const dia = new Date(t.date).getDate().toString().padStart(2, '0');
            const sigla = t.symbol.substring(0, 2);
            
            // --- LÓGICA DE ÍCONE ---
            const ehFii = isFII(t.symbol);
            
            // --- ALTERAÇÃO: Lógica de Fundo do Ícone ---
            const bgIcone = ehFii ? 'bg-black' : 'bg-[#151515]';
            // ------------------------------------------
            
            const iconUrl = `https://raw.githubusercontent.com/thefintz/icones-b3/main/icones/${t.symbol}.png`;
            const iconHtml = !ehFii 
                ? `<img src="${iconUrl}" alt="${t.symbol}" class="w-full h-full object-contain p-0.5 rounded-xl relative z-10" onerror="this.style.display='none'; this.nextElementSibling.classList.remove('hidden');" />
                   <span class="hidden w-full h-full flex items-center justify-center text-[10px] font-bold text-gray-300 tracking-wider absolute inset-0 z-0 ${bgIcone}">${sigla}</span>`
                : `<span class="text-[10px] font-bold text-gray-300 tracking-wider">${sigla}</span>`;
            
            // Ícones de Compra/Venda
            const iconCompra = `<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3" /></svg>`;
            const iconVenda = `<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" /></svg>`;

            const labelContent = isVenda ? iconVenda : iconCompra;
            
            const badgeBg = isVenda 
                ? 'bg-red-500/10 border border-red-500/20' 
                : 'bg-green-500/10 border border-green-500/20';

            const item = document.createElement('div');
            item.className = 'history-card flex items-center justify-between py-3 px-3 mb-2 relative group';
            
            item.innerHTML = `
                <div class="flex items-center gap-3 flex-1 min-w-0">
                     <div class="w-9 h-9 rounded-xl ${bgIcone} border border-[#2C2C2E] flex items-center justify-center flex-shrink-0 relative overflow-hidden">
                        ${iconHtml}
                    </div>
                    
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                             <div class="${badgeBg} w-6 h-6 flex items-center justify-center rounded-md shrink-0">
                                ${labelContent}
                            </div>
                            <span class="text-[10px] font-medium text-gray-500">Dia ${dia}</span>
                        </div>
                        <div class="flex items-center gap-1.5 mt-0.5 text-xs text-gray-300 leading-none">
                            <span>${t.quantity} cotas</span>
                            <span class="text-gray-600">•</span>
                            <span>${formatBRL(t.price)}</span>
                        </div>
                    </div>
                </div>
                
                <div class="text-right flex flex-col items-end justify-center">
                    <span class="text-sm font-bold text-white tracking-tight">${formatBRL(totalTransacao)}</span>
                </div>
            `;
            listaGrupo.appendChild(item);
        });
        fragment.appendChild(listaGrupo);
    });

    listaContainer.appendChild(fragment);
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
	
	function renderizarGraficoProventosDetalhes(dados) {
    const canvas = document.getElementById('detalhes-proventos-chart');
    if (!canvas) return;

    // Destrói gráfico anterior se existir para evitar sobreposição
    if (detalhesChartInstance) {
        detalhesChartInstance.destroy();
        detalhesChartInstance = null;
    }

    const ctx = canvas.getContext('2d');
    
    // Configuração visual (Barra roxa vibrante)
    const corBarra = '#8b5cf6'; 
    const corBarraHover = '#7c3aed';

    detalhesChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: dados.labels,
            datasets: [{
                label: 'Proventos',
                data: dados.data,
                backgroundColor: corBarra,
                hoverBackgroundColor: corBarraHover,
                borderRadius: 4,
                barPercentage: 0.6,
                categoryPercentage: 0.8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }, // Esconde legenda
                tooltip: {
                    backgroundColor: '#151515',
                    titleColor: '#fff',
                    bodyColor: '#ccc',
                    borderColor: '#333',
                    borderWidth: 1,
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            return formatBRL(context.parsed.y);
                        }
                    }
                }
            },
            scales: {
                y: {
                    display: false, // Esconde eixo Y para visual mais limpo
                    grid: { display: false }
                },
                x: {
                    grid: { display: false, drawBorder: false },
                    ticks: {
                        color: '#666',
                        font: { size: 10, weight: 'bold' }
                    }
                }
            },
            animation: {
                duration: 500,
                easing: 'easeOutQuart'
            }
        }
    });
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

// --- EM app.js (Substitua toda a parte do exportCsvBtn) ---

if (exportCsvBtn) {
        exportCsvBtn.addEventListener('click', async () => { // Note o 'async' aqui
            if (!transacoes || transacoes.length === 0) {
                showToast("Sem dados para exportar.");
                return;
            }

            const labelEl = exportCsvBtn.querySelector('.settings-label');
            const textoOriginal = labelEl.textContent;
            
            // Feedback Visual 1: Carregando a Lib
            labelEl.textContent = "Carregando lib...";
            exportCsvBtn.disabled = true;

            try {
                // 1. Baixa a biblioteca agora (se já não tiver baixado)
                await loadSheetJS();

                // Feedback Visual 2: Gerando arquivo
                labelEl.textContent = "Gerando Excel...";

                // 2. Prepara os dados (Lógica original mantida)
                const dadosParaExportar = transacoes.map(t => {
                    let dataFormatada = '';
                    try {
                        const dataObj = new Date(t.date);
                        const dia = String(dataObj.getDate()).padStart(2, '0');
                        const mes = String(dataObj.getMonth() + 1).padStart(2, '0');
                        const ano = dataObj.getFullYear();
                        dataFormatada = `${dia}/${mes}/${ano}`;
                    } catch (e) {
                        dataFormatada = t.date;
                    }

                    return {
                        "Data do Negócio": dataFormatada,
                        "Tipo de Movimentação": t.type === 'sell' ? 'Venda' : 'Compra',
                        "Mercado": "Mercado à Vista",
                        "Código de Negociação": t.symbol,
                        "Quantidade": t.quantity,
                        "Preço": t.price,
                        "Valor": t.quantity * t.price
                    };
                });

                // 3. Cria o arquivo usando a biblioteca que acabamos de carregar
                const worksheet = XLSX.utils.json_to_sheet(dadosParaExportar);
                const workbook = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(workbook, worksheet, "Negociações");

                const dataHoje = new Date().toISOString().split('T')[0];
                XLSX.writeFile(workbook, `vesto_backup_b3_${dataHoje}.xlsx`);

                showToast("Arquivo Excel gerado com sucesso!", "success");

            } catch (e) {
                console.error("Erro ao exportar Excel:", e);
                showToast("Erro: " + e.message);
            } finally {
                // Restaura o botão
                labelEl.textContent = textoOriginal;
                exportCsvBtn.disabled = false;
            }
        });
    }
	
	
const importExcelBtn = document.getElementById('import-excel-btn');
    const importExcelInput = document.getElementById('import-excel-input');
    
    if (importExcelBtn && importExcelInput) {
        importExcelBtn.addEventListener('click', () => {
            importExcelInput.click();
        });

        importExcelInput.addEventListener('change', async (e) => { // Note o 'async'
            const file = e.target.files[0];
            if (!file) return;

            const labelEl = importExcelBtn.querySelector('.settings-label');
            const textoOriginal = labelEl.textContent;
            
            // Trava o botão
            importExcelBtn.disabled = true;

            try {
                // 1. Feedback e Carregamento da Lib
                labelEl.innerHTML = `<span class="loader-sm"></span> Carregando lib...`;
                await loadSheetJS();

                // 2. Feedback de Leitura
                labelEl.innerHTML = `<span class="loader-sm"></span> Lendo arquivo...`;

                const data = await file.arrayBuffer();
                // Agora é seguro chamar o XLSX
                const workbook = XLSX.read(data, { type: 'array', cellDates: true, dateNF: 'dd/mm/yyyy' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { raw: false });

                if (jsonData.length === 0) throw new Error("O arquivo está vazio.");

                let importadosCount = 0;
                let errosCount = 0;

                // Lógica original de processamento das linhas
                for (const row of jsonData) {
                    const dateRaw = row['Data do Negócio'] || row['Data'] || row['Date'];
                    const tickerRaw = row['Código de Negociação'] || row['Ativo'] || row['Ticker'];
                    const typeRaw = row['Tipo de Movimentação'] || row['Tipo'] || row['Type'];
                    const qtdRaw = row['Quantidade'] || row['Qtd'];
                    const priceRaw = row['Preço'] || row['Preco'] || row['Price'];

                    if (tickerRaw && qtdRaw && priceRaw) {
                        try {
                            let ticker = tickerRaw.toString().trim().toUpperCase();
                            if (ticker.endsWith('F')) ticker = ticker.slice(0, -1); 
                            
                            let type = 'buy';
                            const typeStr = typeRaw ? typeRaw.toString().toLowerCase() : 'compra';
                            if (typeStr.includes('vend') || typeStr.includes('sell')) type = 'sell';

                            // Tratamento de Data
                            let dataISO;
                            if (dateRaw && typeof dateRaw === 'string' && dateRaw.includes('/')) {
                                const parts = dateRaw.split('/'); 
                                dataISO = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00`).toISOString();
                            } else if (dateRaw instanceof Date) {
                                dataISO = dateRaw.toISOString();
                            } else {
                                dataISO = new Date().toISOString(); 
                            }

                            // Tratamento de Números
                            const cleanNumber = (val) => {
                                if (typeof val === 'number') return val;
                                if (typeof val === 'string') {
                                    let v = val.replace('R$', '').trim();
                                    if (v.includes(',') && v.includes('.')) v = v.replace(/\./g, '').replace(',', '.'); // 1.200,50 -> 1200.50
                                    else if (v.includes(',')) v = v.replace(',', '.');
                                    return parseFloat(v);
                                }
                                return 0;
                            };

                            const qtd = parseInt(cleanNumber(qtdRaw));
                            const preco = parseFloat(cleanNumber(priceRaw));

                            if (qtd > 0 && preco >= 0 && !isNaN(preco)) {
                                const novaTransacao = {
                                    id: 'tx_' + Date.now() + Math.random().toString(36).substr(2, 5),
                                    date: dataISO,
                                    symbol: ticker,
                                    type: type,
                                    quantity: qtd,
                                    price: preco
                                };

                                await supabaseDB.addTransacao(novaTransacao);
                                transacoes.push(novaTransacao);
                                importadosCount++;
                            }
                        } catch (err) {
                            console.error("Erro na linha:", row, err);
                            errosCount++;
                        }
                    }
                }

                if (importadosCount > 0) {
                    showToast(`${importadosCount} negociações importadas!`, 'success');
                    // Atualiza tudo
                    saldoCaixa = 0; 
                    await salvarCaixa();
                    mesesProcessados = [];
                    await salvarHistoricoProcessado();
                    await atualizarTodosDados(true);
                } else {
                    showToast("Nenhuma transação válida encontrada.", 'error');
                }

            } catch (e) {
                console.error("Erro na importação:", e);
                showToast("Erro ao ler arquivo: " + e.message);
            } finally {
                // Restaura o botão
                labelEl.textContent = textoOriginal;
                importExcelBtn.disabled = false;
                importExcelInput.value = ''; 
            }
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
        // Dispara todas as requisições ao mesmo tempo
        await Promise.all([
            carregarTransacoes(),
            carregarPatrimonio(),
            carregarCaixa(),
            carregarProventosConhecidos(),
            carregarHistoricoProcessado(),
            carregarWatchlist()
        ]);
        
        // Renderiza a watchlist (leve)
        renderizarWatchlist(); 
        
        // Inicia cálculos pesados e chamadas externas
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
// LÓGICA DE SESSÃO E ROTEAMENTO
// LÓGICA DE SESSÃO E ROTEAMENTO
        if (session) {
            await verificarStatusPush();
            currentUserId = session.user.id;
            authContainer.classList.add('hidden');    
            appWrapper.classList.remove('hidden'); 
            
            // --- NOVO: Preencher o email na tela de Ajustes ---
            const userEmailDisplay = document.getElementById('user-email-display');
            if (userEmailDisplay && session.user.email) {
                userEmailDisplay.textContent = session.user.email;
            }
            // -------------------------------------------------
            
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
            // --- CORREÇÃO: Se não há sessão, remove o loading e mostra o login ---
            showAuthLoading(false);
            loginForm.classList.remove('hidden');
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

// ======================================================
// SWIPE GLOBAL DE NAVEGAÇÃO ENTRE ABAS (CORRIGIDO)
// ======================================================

let swipeStartX = 0;
let swipeStartY = 0;

document.addEventListener('touchstart', (e) => {
    // 1. Bloqueia se houver qualquer modal aberto
    if (document.querySelector('.custom-modal.visible') || 
        document.querySelector('.page-modal.visible') || 
        document.querySelector('#ai-modal.visible')) {
        return;
    }
    
    // 2. TRAVA DE SEGURANÇA: Bloqueia o início do swipe em áreas de scroll horizontal ou gráficos
    // Usamos apenas classes genéricas que já existem no seu HTML
    if (e.target.closest('.overflow-x-auto') || 
        e.target.closest('#dashboard-favorites-list') || 
        e.target.closest('canvas')) { 
        return; 
    }

    swipeStartX = e.changedTouches[0].screenX;
    swipeStartY = e.changedTouches[0].screenY;
}, { passive: true });

document.addEventListener('touchend', (e) => {
    // Se swipeStartX for 0, o toque já foi ignorado no início
    if (swipeStartX === 0 && swipeStartY === 0) return;

    // Verificação dupla de modais
    if (document.querySelector('.custom-modal.visible') || 
        document.querySelector('.page-modal.visible') || 
        document.querySelector('#ai-modal.visible')) {
        swipeStartX = 0; swipeStartY = 0;
        return;
    }

    if (e.target.closest('.payment-carousel') || 
        e.target.closest('.overflow-x-auto')) {
        swipeStartX = 0; swipeStartY = 0; 
        return; 
    }

    const swipeEndX = e.changedTouches[0].screenX;
    const swipeEndY = e.changedTouches[0].screenY;
    
    const diffX = swipeEndX - swipeStartX;
    const diffY = swipeEndY - swipeStartY;

    // Reseta as variáveis
    swipeStartX = 0;
    swipeStartY = 0;

    // Lógica do Gesto:
    // 1. Mais horizontal que vertical
    // 2. Movimento mínimo de 50px
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
        const currentTab = document.querySelector('.tab-content.active');
        if (!currentTab) return;

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
	window.mudarAba = mudarAba;
	
	window.confirmarExclusao = handleRemoverAtivo;
    window.abrirDetalhesAtivo = showDetalhesModal;
	setupTransactionModalLogic();
	
	// ======================================================
//  LÓGICA DE CÁLCULO DE DY DA CARTEIRA (NOVO RECURSO)
// ======================================================

/**
 * Calcula o Dividend Yield (DY) Teórico da carteira atual.
 * Lógica: Pega a quantidade de cotas que você tem HOJE e aplica
 * aos proventos pagos por esses ativos nos últimos 12 meses.
 */
async function calcularDyCarteiraTeorico() {
    // 1. Verifica se a carteira já foi calculada e tem ativos
    if (!carteiraCalculada || carteiraCalculada.length === 0) return 0;
    
    // 2. Calcula o valor total financeiro da carteira hoje (Cotação Atual * Qtd)
    // Usamos 'precosAtuais' que já deve estar populado no app
    const mapPrecos = new Map(precosAtuais.map(p => [p.symbol, p.regularMarketPrice]));
    let valorTotalCarteira = 0;
    
    carteiraCalculada.forEach(ativo => {
        const preco = mapPrecos.get(ativo.symbol) || 0;
        valorTotalCarteira += (preco * ativo.quantity);
    });

    // Evita divisão por zero
    if (valorTotalCarteira === 0) return 0;

    // 3. Busca o histórico de proventos dos ativos da carteira
    // Tenta pegar do cache primeiro para ser rápido (mesma chave do gráfico de histórico)
    const cacheKey = `cache_grafico_historico_${currentUserId}`;
    let rawDividends = await getCache(cacheKey);

    // Se não tiver no cache, força uma busca na API
    if (!rawDividends) {
        const ativosCarteira = carteiraCalculada.map(a => a.symbol);
        try {
            // Chama sua função existente que busca histórico no backend/scraper
            rawDividends = await callScraperHistoricoPortfolioAPI(ativosCarteira);
            
            // Salva no cache se der certo
            if (rawDividends && rawDividends.length > 0) {
                await setCache(cacheKey, rawDividends, CACHE_IA_HISTORICO); // CACHE_IA_HISTORICO deve ser uma const existente
            }
        } catch (e) {
            console.error("Erro ao calcular DY (API):", e);
            return 0;
        }
    }

    if (!rawDividends || !Array.isArray(rawDividends)) return 0;

    // 4. Define a janela de tempo (Últimos 12 meses a partir de hoje)
    const hoje = new Date();
    const umAnoAtras = new Date();
    umAnoAtras.setFullYear(hoje.getFullYear() - 1);
    
    let totalDividendos12m = 0;
    
    // Mapa rápido de quantidades: { 'MXRF11': 100, ... }
    const mapQtd = new Map(carteiraCalculada.map(a => [a.symbol, a.quantity]));

    // 5. Itera sobre cada provento do histórico
    rawDividends.forEach(div => {
        // Usa paymentDate preferencialmente, ou dataCom como fallback
        const dataRefStr = div.paymentDate || div.dataCom;
        if (!dataRefStr) return;

        const dataRef = new Date(dataRefStr);
        
        // Verifica se o pagamento está dentro dos últimos 12 meses
        if (dataRef >= umAnoAtras && dataRef <= hoje) {
            // Pega a quantidade que o usuário tem HOJE desse ativo
            const qtdAtual = mapQtd.get(div.symbol) || 0;
            
            // Simula: Se eu tivesse essa quantidade na época, quanto teria recebido?
            if (qtdAtual > 0) {
                totalDividendos12m += (Number(div.value) * qtdAtual);
            }
        }
    });

    // 6. Retorna o objeto com % e Valor Absoluto
    const dyPercent = (totalDividendos12m / valorTotalCarteira) * 100;
    
    return { 
        dyPercent: dyPercent, 
        totalDiv12m: totalDividendos12m 
    };
}

window.mostrarDyCarteira = async function() {
    const btn = document.querySelector('button[title="Ver DY da Carteira"]');
    const originalText = btn ? btn.innerText : '?';
    if(btn) btn.innerText = '...';

    try {
        const dados = await calcularDyCarteiraTeorico();
        
        const dyVal = dados.dyPercent || 0;
        const totalVal = dados.totalDiv12m || 0;
        const dyFmt = dyVal.toFixed(2) + '%';
        const valFmt = formatBRL(totalVal);
        
        // --- CORES DINÂMICAS ---
        let corTitulo = '';
        let textoAvaliacao = '';
        let corTextoBadge = '';
        
        if (dyVal < 6) {
            corTitulo = 'text-red-500';
            textoAvaliacao = 'Baixo';
            corTextoBadge = '#ef4444';
        } else if (dyVal < 10) {
            corTitulo = 'text-yellow-400';
            textoAvaliacao = 'Bom';
            corTextoBadge = '#facc15';
        } else {
            corTitulo = 'text-green-500';
            textoAvaliacao = 'Excelente';
            corTextoBadge = '#22c55e';
        }

        // --- HTML ---
        const mensagemHtml = `
            <div class="flex flex-col items-center w-full pt-1">
                <span class="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1 block">
                    Dividend Yield (12m)
                </span>
                
                <div class="text-5xl font-bold ${corTitulo} tracking-tighter leading-none mb-5 drop-shadow-sm">
                    ${dyFmt}
                </div>

                <div class="details-group-card w-full" style="background-color: #1C1C1E !important; box-shadow: none;">
                    <div class="details-row" style="border-bottom-color: rgba(255,255,255,0.05);">
                        <span class="details-label" style="color: #9ca3af;">Classificação</span>
                        <span class="details-value font-bold" style="color: ${corTextoBadge}">${textoAvaliacao}</span>
                    </div>
                    <div class="details-row">
                        <span class="details-label" style="color: #9ca3af;">Retorno Aprox.</span>
                        <span class="details-value text-white">${valFmt}</span>
                    </div>
                </div>
            </div>
        `;

        // --- ABERTURA DO MODAL ---
        const modal = document.getElementById('custom-modal');
        const modalTitle = document.getElementById('custom-modal-title');
        const modalMessage = document.getElementById('custom-modal-message');
        const modalContent = document.getElementById('custom-modal-content');
        const btnOk = document.getElementById('custom-modal-ok');
        const btnCancel = document.getElementById('custom-modal-cancel');

        if(modalTitle) modalTitle.textContent = 'Performance';
        
        // --- ESTILIZAÇÃO DO MODAL ---
        // 1. Fundo #09090b (Cor exata do drawer de notificações)
        // 2. Borda removida (border: none)
        if(modalContent) {
            modalContent.style.backgroundColor = '#09090b';
            modalContent.style.border = 'none';
            // Sombra suave para destacar do backdrop, já que não tem borda
            modalContent.style.boxShadow = '0 25px 50px -12px rgba(0, 0, 0, 0.5)';
        }

        if(modalMessage) {
            modalMessage.innerHTML = mensagemHtml;
            modalMessage.style.textAlign = 'center'; 
        }

        if(btnCancel) btnCancel.style.display = 'none'; 
        
        if(btnOk) {
            const oldText = btnOk.innerText;
            const oldOnClick = btnOk.onclick;
            const oldClasses = btnOk.className;
            
            btnOk.innerText = 'Fechar';
            
            // Botão cinza escuro para combinar com o tema "stealth"
            btnOk.className = 'py-2 px-6 bg-[#1C1C1E] border border-[#27272a] text-white text-xs font-bold rounded-full shadow-sm active:scale-95 transition-transform hover:bg-[#27272a]';

            btnOk.onclick = function() {
                modalContent.classList.add('modal-out');
                setTimeout(() => {
                    modal.classList.remove('visible');
                    modalContent.classList.remove('modal-out');
                    
                    // --- LIMPEZA DE ESTILOS ---
                    // Restaura os estilos originais para não afetar outros modais
                    if(modalContent) {
                        modalContent.style.backgroundColor = '';
                        modalContent.style.border = '';
                        modalContent.style.boxShadow = '';
                    }

                    if(btnCancel) btnCancel.style.display = 'block';
                    btnOk.innerText = oldText;
                    btnOk.onclick = oldOnClick;
                    btnOk.className = oldClasses;
                    
                    if(modalMessage) modalMessage.innerHTML = '';
                }, 200);
            };
        }

        modal.classList.add('visible');
        modalContent.classList.remove('modal-out');

    } catch (e) {
        console.error("Erro DY:", e);
        showToast('Erro ao calcular.');
    } finally {
        if(btn) btn.innerText = originalText;
    }
};

// Adicione no app.js
async function openIpcaModal() {
    if(!ipcaPageModal) return;

    ipcaPageModal.classList.add('visible');
    ipcaPageContent.style.transform = ''; 
    ipcaPageContent.classList.remove('closing');
    document.body.style.overflow = 'hidden';

    // Se já tiver cache, renderiza direto. Senão busca.
    if (ipcaCacheData) {
        renderizarGraficoIpca(ipcaCacheData);
    } else {
        buscarDadosIpca();
    }
}

function closeIpcaModal() {
    if(!ipcaPageContent) return;
    ipcaPageContent.style.transform = '';
    ipcaPageContent.classList.add('closing');
    ipcaPageModal.classList.remove('visible');
    document.body.style.overflow = '';
}

// --- FUNÇÃO DE BUSCA OTIMIZADA DO IPCA (COM CACHE DE 24H) ---
async function buscarDadosIpca(force = false) {
    const CACHE_KEY = 'vesto_ipca_data';
    const CACHE_DURATION = 1000 * 60 * 60 * 24; // 24 Horas

    // 1. Tenta pegar do Cache primeiro (se não for forçado)
    if (!force) {
        const cached = await getCache(CACHE_KEY);
        if (cached) {
            // Se achou no cache, usa imediatamente e não chama a API
            atualizarInterfaceIpca(cached);
            ipcaCacheData = cached; 
            return;
        }
    }

    // 2. Se não tem cache ou expirou, busca na API (Scraper)
    try {
        // Mostra estado de carregamento no widget se estiver vazio
        const elValor12m = document.getElementById('ipca-valor-12m');
        if(elValor12m && elValor12m.textContent === '...') {
             // Opcional: Feedback visual sutil
        }

        const res = await fetch('/api/scraper', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'ipca', payload: {} })
        });
        
        const data = await res.json();
        
        if (data && data.json) {
            // Salva no Cache por 24 horas
            await setCache(CACHE_KEY, data.json, CACHE_DURATION);
            
            // Atualiza Interface e Variável Global
            ipcaCacheData = data.json;
            atualizarInterfaceIpca(data.json);
        }
    } catch (e) {
        console.error("Erro IPCA", e);
        // Em caso de erro, tenta mostrar cache antigo se existir (fallback)
        const oldCache = await getCache(CACHE_KEY);
        if (oldCache) {
            atualizarInterfaceIpca(oldCache);
        } else {
            const elBadge = document.getElementById('ipca-mes-badge');
            if(elBadge) elBadge.textContent = 'Erro ao carregar';
        }
    }
}

// --- FUNÇÃO AUXILIAR PARA ATUALIZAR O WIDGET E O MODAL ---
function atualizarInterfaceIpca(dados) {
    if (!dados) return;

    // 1. Atualiza Widget do Dashboard
    const elValor12m = document.getElementById('ipca-valor-12m');
    const elBadgeMes = document.getElementById('ipca-mes-badge');
    
    if(elValor12m) {
        // Animação simples de transição
        elValor12m.style.opacity = '0';
        setTimeout(() => {
            elValor12m.textContent = dados.acumulado_12m || '--';
            elValor12m.style.opacity = '1';
        }, 150);
    }
    
    // Pega o último mês disponível para o Badge
    if(dados.historico && dados.historico.length > 0) {
        const ultimo = dados.historico[dados.historico.length - 1]; // O array vem cronológico (Jan->Dez)
        // Se vier invertido do scraper, ajustamos:
        // No seu scraper atual: reverse() foi usado, então o último item é o mês mais recente.
        
        if(elBadgeMes) {
            // Ex: "Último: 0,56% (Jan)"
            let mesCurto = ultimo.mes.split('/')[0]; 
            // Se vier nome completo "Janeiro", corta para "Jan"
            if(mesCurto.length > 3) mesCurto = mesCurto.substring(0,3);
            
            elBadgeMes.textContent = `Último: ${ultimo.valor}% (${mesCurto})`;
        }
    }

    // 2. Se o modal estiver aberto (ou para deixar pronto), renderiza o gráfico
    renderizarGraficoIpca(dados);
}

function renderizarGraficoIpca(dados) {
    const canvas = document.getElementById('ipca-chart');
    const listaContainer = document.getElementById('ipca-lista-container');
    
    if (!dados || !dados.historico) return;

    // --- 1. PREPARAÇÃO DOS DADOS DE PATRIMÔNIO (Map: YYYY-MM -> Valor) ---
    const mapPatrimonio = {};
    if (typeof patrimonio !== 'undefined' && Array.isArray(patrimonio)) {
        patrimonio.forEach(p => {
            if (p.date && p.value) {
                const key = p.date.substring(0, 7); 
                mapPatrimonio[key] = p.value;
            }
        });
    }

    // --- 2. PREPARAÇÃO DOS DADOS DE PROVENTOS (Map: YYYY-MM -> Total Recebido) ---
    const mapProventos = {};
    if (typeof proventosConhecidos !== 'undefined' && Array.isArray(proventosConhecidos)) {
        proventosConhecidos.forEach(p => {
            // Verifica data válida
            if (!p.paymentDate) return;
            const key = p.paymentDate.substring(0, 7); // YYYY-MM
            
            // Calcula o total recebido neste pagamento (Valor * Qtd na data)
            // Usa a função global getQuantidadeNaData se disponível
            const qtd = (typeof getQuantidadeNaData === 'function') 
                ? getQuantidadeNaData(p.symbol, p.paymentDate) 
                : 0;
                
            if (qtd > 0) {
                const total = p.value * qtd;
                mapProventos[key] = (mapProventos[key] || 0) + total;
            }
        });
    }
    
    // Helper para datas
    const getYearMonthKey = (mesStr) => {
        if (!mesStr) return null;
        const parts = mesStr.includes('/') ? mesStr.split('/') : [mesStr];
        if (parts.length < 2) return null;
        
        let m = parts[0].toLowerCase().trim();
        let y = parts[1].trim();
        
        const monthMap = {
            'jan': '01', 'fev': '02', 'mar': '03', 'abr': '04', 'mai': '05', 'jun': '06',
            'jul': '07', 'ago': '08', 'set': '09', 'out': '10', 'nov': '11', 'dez': '12',
            'janeiro': '01', 'fevereiro': '02', 'março': '03', 'abril': '04', 'maio': '05', 'junho': '06',
            'julho': '07', 'agosto': '08', 'setembro': '09', 'outubro': '10', 'novembro': '11', 'dezembro': '12'
        };
        
        if (!isNaN(m)) return `${y}-${m.padStart(2, '0')}`;
        if (monthMap[m]) return `${y}-${monthMap[m]}`;
        return null;
    };

    // --- 3. RENDERIZAR A LISTA ---
    if(listaContainer) {
        listaContainer.innerHTML = '';
        
        [...dados.historico].reverse().forEach(item => {
            const valor = item.valor; // Inflação do mês
            const ymKey = getYearMonthKey(item.mes);
            
            // --- CÁLCULO DA EROSÃO DO PATRIMÔNIO ---
            let erosaoPatHtml = '';
            if (ymKey && mapPatrimonio[ymKey]) {
                const saldoMes = mapPatrimonio[ymKey];
                const impactoReais = saldoMes * (valor / 100);
                
                const isPerda = impactoReais > 0; 
                const sinal = isPerda ? '-' : '+';
                const corErosao = isPerda ? 'text-red-400' : 'text-green-400';
                const valorErosaoFmt = Math.abs(impactoReais).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                
                erosaoPatHtml = `
                    <div class="flex items-center gap-2 justify-end mt-0.5">
                        <span class="text-[10px] text-gray-500 font-medium uppercase tracking-wider">Patrimônio</span>
                        <span class="text-[11px] font-bold ${corErosao}">${sinal}${valorErosaoFmt}</span>
                    </div>
                `;
            } else {
                erosaoPatHtml = `
                    <div class="flex items-center gap-2 justify-end mt-0.5 opacity-40">
                        <span class="text-[10px] text-gray-500 font-medium uppercase tracking-wider">Patrimônio</span>
                        <span class="text-[11px] text-gray-500 font-bold">--</span>
                    </div>
                `;
            }

            // --- CÁLCULO DA EROSÃO DOS PROVENTOS (NOVO) ---
            let erosaoDivHtml = '';
            if (ymKey && mapProventos[ymKey]) {
                const proventosMes = mapProventos[ymKey];
                const impactoDiv = proventosMes * (valor / 100);
                
                const isPerdaDiv = impactoDiv > 0;
                const sinalDiv = isPerdaDiv ? '-' : '+';
                const corErosaoDiv = isPerdaDiv ? 'text-red-400' : 'text-green-400';
                const valorErosaoDivFmt = Math.abs(impactoDiv).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                
                erosaoDivHtml = `
                    <div class="flex items-center gap-2 justify-end mt-0.5">
                        <span class="text-[10px] text-gray-500 font-medium uppercase tracking-wider">Proventos</span>
                        <span class="text-[11px] font-bold ${corErosaoDiv}">${sinalDiv}${valorErosaoDivFmt}</span>
                    </div>
                `;
            } else {
                // Se não teve proventos no mês, mostra vazio ou traço (optei por traço suave)
                erosaoDivHtml = `
                    <div class="flex items-center gap-2 justify-end mt-0.5 opacity-30">
                        <span class="text-[10px] text-gray-500 font-medium uppercase tracking-wider">Proventos</span>
                        <span class="text-[11px] text-gray-500 font-bold">--</span>
                    </div>
                `;
            }

            // Cores do Badge de IPCA
            let corTexto = 'text-white';
            let barraCor = 'bg-orange-500';
            
            if (valor >= 0.5) {
                corTexto = 'text-red-400';
                barraCor = 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]';
            } else if (valor < 0) {
                corTexto = 'text-green-400';
                barraCor = 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]';
            } else {
                corTexto = 'text-orange-400';
                barraCor = 'bg-orange-500';
            }
            
            let [mesNome, ano] = item.mes.includes('/') ? item.mes.split('/') : [item.mes, ''];

            const html = `
            <div class="flex items-center justify-between p-3 bg-[#1A1A1C] rounded-2xl mb-2">
                <div class="flex items-center gap-3">
                    <div class="w-1.5 h-12 rounded-full ${barraCor}"></div> <div class="flex flex-col">
                        <span class="text-sm font-bold text-white capitalize">${mesNome}</span>
                        <span class="text-[10px] text-gray-500 font-medium">${ano}</span>
                    </div>
                </div>
                
                <div class="flex flex-col items-end">
                    <div class="flex items-center gap-2 mb-1">
                        <span class="text-[10px] text-gray-500 font-medium uppercase">IPCA</span>
                        <span class="text-sm font-bold ${corTexto}">${valor.toFixed(2)}%</span>
                    </div>
                    
                    ${erosaoPatHtml}

                    ${erosaoDivHtml}
                </div>
            </div>`;
            
            listaContainer.insertAdjacentHTML('beforeend', html);
        });
    }

    // --- 4. GRÁFICO (Mantém igual) ---
    if (!canvas) return;
    if (ipcaChartInstance) ipcaChartInstance.destroy();

    const ctx = canvas.getContext('2d');
    const labels = dados.historico.map(d => d.mes.split('/')[0].substring(0,3)); 
    const values = dados.historico.map(d => d.valor);
    const backgroundColors = values.map(v => v < 0 ? '#10B981' : '#F97316');

    ipcaChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: backgroundColors,
                borderRadius: 4,
                barPercentage: 0.6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#151515',
                    titleColor: '#fff',
                    borderColor: '#333',
                    borderWidth: 1,
                    displayColors: false,
                    callbacks: {
                        label: (ctx) => ` IPCA: ${ctx.raw}%`
                    }
                }
            },
            scales: {
                y: { display: false },
                x: { 
                    grid: { display: false },
                    ticks: { color: '#666', font: { size: 10 } }
                }
            }
        }
    });
}

// --- LISTENERS DO MODAL DE PATRIMÔNIO ---

    if (btnOpenPatrimonio) {
        btnOpenPatrimonio.addEventListener('click', openPatrimonioModal);
    }

    if (patrimonioVoltarBtn) {
        patrimonioVoltarBtn.addEventListener('click', closePatrimonioModal);
    }

    // Fechar ao clicar no fundo escuro
    if (patrimonioPageModal) {
        patrimonioPageModal.addEventListener('click', (e) => {
            if (e.target === patrimonioPageModal) closePatrimonioModal();
        });
    }

    // --- LÓGICA DE SWIPE DOWN (ARRASTAR PARA FECHAR) - IDENTICA AO DETALHES ---
// --- LÓGICA DE SWIPE DOWN (PATRIMÔNIO) ---
    if (patrimonioPageContent) {
        const scrollContainer = patrimonioPageContent.querySelector('.overflow-y-auto');

        patrimonioPageContent.addEventListener('touchstart', (e) => {
            // CORREÇÃO: Se tocar no gráfico, não inicia o arrasto do modal
            if (e.target.tagName === 'CANVAS') return;

            if (scrollContainer && scrollContainer.scrollTop === 0) {
                touchStartPatrimonioY = e.touches[0].clientY;
                touchMovePatrimonioY = touchStartPatrimonioY;
                isDraggingPatrimonio = true;
                patrimonioPageContent.style.transition = 'none'; 
            }
        }, { passive: true });

        patrimonioPageContent.addEventListener('touchmove', (e) => {
            if (!isDraggingPatrimonio) return;
            touchMovePatrimonioY = e.touches[0].clientY;
            const diff = touchMovePatrimonioY - touchStartPatrimonioY;
            
            if (diff > 0) {
                if (e.cancelable) e.preventDefault(); 
                patrimonioPageContent.style.transform = `translateY(${diff}px)`;
            }
        }, { passive: false });

        patrimonioPageContent.addEventListener('touchend', (e) => {
            if (!isDraggingPatrimonio) return;
            isDraggingPatrimonio = false;
            const diff = touchMovePatrimonioY - touchStartPatrimonioY;
            
            patrimonioPageContent.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
            
            if (diff > 120) {
                closePatrimonioModal();
            } else {
                patrimonioPageContent.style.transform = '';
            }
            touchStartPatrimonioY = 0;
            touchMovePatrimonioY = 0;
        });
    }
	
	// --- LISTENERS DO MODAL DE PROVENTOS ---

if (btnOpenProventos) {
    btnOpenProventos.addEventListener('click', openProventosModal);
}

if (proventosVoltarBtn) {
    proventosVoltarBtn.addEventListener('click', closeProventosModal);
}

if (proventosPageModal) {
    proventosPageModal.addEventListener('click', (e) => {
        if (e.target === proventosPageModal) closeProventosModal();
    });
}

// Swipe Down para fechar (Proventos)
// --- LÓGICA DE SWIPE DOWN (PROVENTOS) ---
    if (proventosPageContent) {
        const scrollContainerProv = proventosPageContent.querySelector('.overflow-y-auto');

        proventosPageContent.addEventListener('touchstart', (e) => {
            // CORREÇÃO: Se tocar no gráfico, não inicia o arrasto do modal
            if (e.target.tagName === 'CANVAS') return;

            if (scrollContainerProv && scrollContainerProv.scrollTop === 0) {
                touchStartProventosY = e.touches[0].clientY;
                touchMoveProventosY = touchStartProventosY;
                isDraggingProventos = true;
                proventosPageContent.style.transition = 'none'; 
            }
        }, { passive: true });

        proventosPageContent.addEventListener('touchmove', (e) => {
            if (!isDraggingProventos) return;
            touchMoveProventosY = e.touches[0].clientY;
            const diff = touchMoveProventosY - touchStartProventosY;
            
            if (diff > 0) {
                if (e.cancelable) e.preventDefault(); 
                proventosPageContent.style.transform = `translateY(${diff}px)`;
            }
        }, { passive: false });

        proventosPageContent.addEventListener('touchend', (e) => {
            if (!isDraggingProventos) return;
            isDraggingProventos = false;
            
            const diff = touchMoveProventosY - touchStartProventosY;
            
            proventosPageContent.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
            
            if (diff > 120) {
                closeProventosModal();
            } else {
                proventosPageContent.style.transform = '';
            }
            touchStartProventosY = 0;
            touchMoveProventosY = 0;
        });
    }

// --- LISTENERS DO MODAL DE ALOCAÇÃO ---

if (btnOpenAlocacao) {
    btnOpenAlocacao.addEventListener('click', openAlocacaoModal);
}

if (alocacaoVoltarBtn) {
    alocacaoVoltarBtn.addEventListener('click', closeAlocacaoModal);
}

if (alocacaoPageModal) {
    alocacaoPageModal.addEventListener('click', (e) => {
        if (e.target === alocacaoPageModal) closeAlocacaoModal();
    });
}

// Swipe Down Logic (Alocação)
// --- LÓGICA DE SWIPE DOWN (ALOCAÇÃO) ---
    if (alocacaoPageContent) {
        const scrollContainerAloc = alocacaoPageContent.querySelector('.overflow-y-auto');

        alocacaoPageContent.addEventListener('touchstart', (e) => {
            // CORREÇÃO: Se tocar no gráfico, não inicia o arrasto do modal
            if (e.target.tagName === 'CANVAS') return;

            if (scrollContainerAloc && scrollContainerAloc.scrollTop === 0) {
                touchStartAlocacaoY = e.touches[0].clientY;
                touchMoveAlocacaoY = touchStartAlocacaoY;
                isDraggingAlocacao = true;
                alocacaoPageContent.style.transition = 'none'; 
            }
        }, { passive: true });

        alocacaoPageContent.addEventListener('touchmove', (e) => {
            if (!isDraggingAlocacao) return;
            touchMoveAlocacaoY = e.touches[0].clientY;
            const diff = touchMoveAlocacaoY - touchStartAlocacaoY;
            
            if (diff > 0) {
                if (e.cancelable) e.preventDefault(); 
                alocacaoPageContent.style.transform = `translateY(${diff}px)`;
            }
        }, { passive: false });

        alocacaoPageContent.addEventListener('touchend', (e) => {
            if (!isDraggingAlocacao) return;
            isDraggingAlocacao = false;
            
            const diff = touchMoveAlocacaoY - touchStartAlocacaoY;
            
            alocacaoPageContent.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
            
            if (diff > 120) {
                closeAlocacaoModal();
            } else {
                alocacaoPageContent.style.transform = '';
            }
            touchStartAlocacaoY = 0;
            touchMoveAlocacaoY = 0;
        });
    }
	
	// --- LISTENERS IPCA ---

if (btnOpenIpca) {
    btnOpenIpca.addEventListener('click', openIpcaModal);
}

if (ipcaVoltarBtn) {
    ipcaVoltarBtn.addEventListener('click', closeIpcaModal);
}

// Swipe Down Logic IPCA
if (ipcaPageContent) {
    const scrollContainerIpca = ipcaPageContent.querySelector('.overflow-y-auto');

    ipcaPageContent.addEventListener('touchstart', (e) => {
        if (e.target.tagName === 'CANVAS') return;
        if (scrollContainerIpca && scrollContainerIpca.scrollTop === 0) {
            touchStartIpcaY = e.touches[0].clientY;
            touchMoveIpcaY = touchStartIpcaY;
            isDraggingIpca = true;
            ipcaPageContent.style.transition = 'none'; 
        }
    }, { passive: true });

    ipcaPageContent.addEventListener('touchmove', (e) => {
        if (!isDraggingIpca) return;
        touchMoveIpcaY = e.touches[0].clientY;
        const diff = touchMoveIpcaY - touchStartIpcaY;
        if (diff > 0) {
            if (e.cancelable) e.preventDefault(); 
            ipcaPageContent.style.transform = `translateY(${diff}px)`;
        }
    }, { passive: false });

    ipcaPageContent.addEventListener('touchend', (e) => {
        if (!isDraggingIpca) return;
        isDraggingIpca = false;
        const diff = touchMoveIpcaY - touchStartIpcaY;
        ipcaPageContent.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        if (diff > 120) {
            closeIpcaModal();
        } else {
            ipcaPageContent.style.transform = '';
        }
        touchStartIpcaY = 0; touchMoveIpcaY = 0;
    });
}

// Iniciar a busca silenciosa do IPCA ao carregar o app (para preencher o widget)
setTimeout(buscarDadosIpca, 2000);

const carousel = document.getElementById('dashboard-carousel');
const dots = document.querySelectorAll('.carousel-dot');

if (carousel) {
    carousel.addEventListener('scroll', () => {
        const index = Math.round(carousel.scrollLeft / carousel.offsetWidth);
        
        dots.forEach((dot, i) => {
            if (i === index) {
                dot.classList.add('active', 'bg-purple-600');
                dot.classList.remove('bg-gray-700', 'w-1.5');
                dot.style.width = '16px'; // Efeito pílula
            } else {
                dot.classList.remove('active', 'bg-purple-600');
                dot.classList.add('bg-gray-700');
                dot.style.width = '6px';
            }
        });
    });
}

function initCarouselSwipeBridge() {
    const carousel = document.getElementById('dashboard-carousel');
    if (!carousel) return;

    let startX = 0;
    let isAtEnd = false;

    carousel.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        // Verifica se está visualmente no final (com pequena tolerância)
        const maxScroll = carousel.scrollWidth - carousel.clientWidth;
        isAtEnd = carousel.scrollLeft >= (maxScroll - 5);
    }, { passive: true });

    carousel.addEventListener('touchend', (e) => {
        // Se não estava no final, deixa o scroll normal acontecer e sai
        if (!isAtEnd) return;

        const endX = e.changedTouches[0].clientX;
        const diff = startX - endX;

        // Se arrastou para a esquerda (tentando avançar)
        if (diff > 50) {
            // *** O SEGREDO ESTÁ AQUI ***
            // Impede que o 'tab-dashboard' perceba esse gesto, evitando o pulo duplo
            e.stopPropagation(); 
            
            console.log("Fim do carrossel -> Indo para Carteira");
            
            // Força a ida APENAS para a aba Carteira
            const btnCarteira = document.querySelector('button[data-tab="tab-carteira"]');
            if (btnCarteira) btnCarteira.click();
        }
    });
}

// Inicializa
document.addEventListener('DOMContentLoaded', initCarouselSwipeBridge);
// Caso o DOM já tenha carregado (recarregamento via SPA/Módulo)
initCarouselSwipeBridge();

function openPagamentosModal(todosPagamentos) {
    const modal = document.getElementById('pagamentos-page-modal');
    const content = document.getElementById('tab-pagamentos-content');
    const listaEl = document.getElementById('pagamentos-modal-lista');
    const totalEl = document.getElementById('agenda-total-modal');

    if (!modal || !content) return;

    if (listaEl && todosPagamentos) {
        listaEl.innerHTML = '';
        
        // 1. Cálculos
        let totalGeral = 0;
        const dadosCalculados = todosPagamentos.map(p => {
            const parts = p.paymentDate.split('-');
            const dataObj = new Date(parts[0], parts[1] - 1, parts[2]);
            const ativo = carteiraCalculada.find(c => c.symbol === p.symbol);
            const qtd = ativo ? ativo.quantity : 0;
            const valorTotal = p.value * qtd;
            totalGeral += valorTotal;
            return { ...p, dataObj, valorTotalCalculado: valorTotal, qtdCarteira: qtd };
        });

        // Atualiza Total
        if (totalEl) {
            totalEl.textContent = totalGeral.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        }

        // 2. Agrupamento
        const grupos = {};
        dadosCalculados.forEach(item => {
            const mesAno = item.dataObj.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
            const chave = mesAno.charAt(0).toUpperCase() + mesAno.slice(1);
            if (!grupos[chave]) grupos[chave] = [];
            grupos[chave].push(item);
        });

        // 3. Renderização
        Object.keys(grupos).forEach((mes) => {
            const itensMes = grupos[mes];

            // Título do Mês
            const wrapper = document.createElement('div');
            wrapper.innerHTML = `
                <div class="flex items-center gap-3 mb-3 pl-2 mt-4">
                    <span class="w-1.5 h-1.5 rounded-full bg-[#3f3f46]"></span>
                    <h3 class="text-xs font-bold text-[#71717a] uppercase tracking-widest">${mes}</h3>
                </div>
                <div class="space-y-2 lista-do-mes"></div>
            `;
            const containerMes = wrapper.querySelector('.lista-do-mes');

            itensMes.forEach(prov => {
                const dia = prov.dataObj.getDate().toString().padStart(2, '0');
                const sem = prov.dataObj.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase();
                const isJCP = prov.type && prov.type.toUpperCase().includes('JCP');
                
                // Cores de texto
                const corTextoValor = isJCP ? 'text-[#fbbf24]' : 'text-[#4ade80]'; // Amarelo (JCP) ou Verde (DIV)
                const tipoTexto = isJCP ? 'JCP' : 'Dividendos';
                const barraLateral = isJCP ? 'bg-amber-500' : 'bg-[#4ade80]';

                const card = document.createElement('div');
                
                // Design Clean: Fundo escuro suave, sem borda externa, cantos arredondados
                card.className = "relative flex items-center bg-[#141414] rounded-xl overflow-hidden mb-1";
                
                card.innerHTML = `
                    <div class="absolute left-0 top-0 bottom-0 w-1 ${barraLateral}"></div>

                    <div class="flex items-center w-full p-3 pl-4">
                        <div class="flex flex-col items-center justify-center pr-4 border-r border-[#27272a]">
                            <span class="text-lg font-bold text-white leading-none tracking-tight">${dia}</span>
                            <span class="text-[9px] font-bold text-[#525252] uppercase mt-0.5">${sem}</span>
                        </div>

                        <div class="flex-1 min-w-0 pl-4">
                            <div class="flex items-center gap-2 mb-0.5">
                                <span class="text-sm font-bold text-white tracking-wide">${prov.symbol}</span>
                            </div>
                            <p class="text-[10px] text-[#a1a1aa] font-medium truncate">
                                ${prov.qtdCarteira} cotas • ${tipoTexto}
                            </p>
                        </div>

                        <div class="text-right pr-1">
                            <span class="block text-sm font-bold ${corTextoValor} tabular-nums tracking-tight">
                                ${prov.valorTotalCalculado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                            </span>
                        </div>
                    </div>
                `;
                containerMes.appendChild(card);
            });

            listaEl.appendChild(wrapper);
        });
    }

    modal.classList.add('visible');
    content.classList.remove('closing');
    content.style.transform = ''; 
    document.body.style.overflow = 'hidden';
}

window.closePagamentosModal = function() {
    const modal = document.getElementById('pagamentos-page-modal');
    const content = document.getElementById('tab-pagamentos-content');
    if (!modal || !content) return;

    content.classList.add('closing');
    modal.classList.remove('visible');
    document.body.style.overflow = '';
};


// --- LÓGICA DE SWIPE DOWN PARA PAGAMENTOS (CORRIGIDO) ---
    
    const modalPagamentosRef = document.getElementById('pagamentos-page-modal');
    const contentPagamentosRef = document.getElementById('tab-pagamentos-content');
    const btnVoltarPagamentos = document.getElementById('pagamentos-voltar-btn');

    let isDraggingPagamentos = false;
    let touchStartPagamentosY = 0;
    let touchMovePagamentosY = 0;

    // 1. Fechar ao clicar no botão "X"
    if (btnVoltarPagamentos) {
        btnVoltarPagamentos.addEventListener('click', closePagamentosModal);
    }

    // 2. Fechar ao clicar no fundo escuro
    if (modalPagamentosRef) {
        modalPagamentosRef.addEventListener('click', (e) => {
            if (e.target === modalPagamentosRef) closePagamentosModal();
        });
    }

    // 3. Lógica do Gesto (Arrastar para baixo)
    if (contentPagamentosRef) {
        const scrollContainerPag = contentPagamentosRef.querySelector('.overflow-y-auto');

        contentPagamentosRef.addEventListener('touchstart', (e) => {
            if (scrollContainerPag && scrollContainerPag.scrollTop === 0) {
                touchStartPagamentosY = e.touches[0].clientY;
                touchMovePagamentosY = touchStartPagamentosY;
                isDraggingPagamentos = true;
                contentPagamentosRef.style.transition = 'none'; 
            }
        }, { passive: true });

        contentPagamentosRef.addEventListener('touchmove', (e) => {
            if (!isDraggingPagamentos) return;
            
            touchMovePagamentosY = e.touches[0].clientY;
            const diff = touchMovePagamentosY - touchStartPagamentosY;
            
            // Só move se for para baixo
            if (diff > 0) {
                if (e.cancelable) e.preventDefault(); 
                contentPagamentosRef.style.transform = `translateY(${diff}px)`;
            }
        }, { passive: false });

        contentPagamentosRef.addEventListener('touchend', (e) => {
            if (!isDraggingPagamentos) return;
            isDraggingPagamentos = false;
            
            const diff = touchMovePagamentosY - touchStartPagamentosY;
            const contentEl = contentPagamentosRef;
            const modalEl = modalPagamentosRef;

            // Restaura a transição suave
            contentEl.style.transition = 'transform 0.3s ease-out';

            if (diff > 100) {
                // --- AÇÃO DE FECHAR ---
                
                // 1. Desliza o painel para baixo (Visual)
                contentEl.style.transform = 'translateY(100%)';
                
                // 2. Desvanece o fundo escuro SIMULTANEAMENTE (Igual ao Detalhes)
                modalEl.style.transition = 'opacity 0.3s ease-out';
                modalEl.style.opacity = '0';

                // 3. Aguarda a animação terminar para limpar tudo e destravar a tela
                setTimeout(() => {
                    // Chama a função OFICIAL para destravar o scroll do body e limpar estados
                    if (typeof closePagamentosModal === 'function') {
                        closePagamentosModal();
                    } else {
                        // Fallback de segurança
                        modalEl.classList.remove('visible');
                        document.body.style.overflow = '';
                    }

                    // Limpa os estilos inline injetados pelo JS para não quebrar a próxima abertura
                    contentEl.style.transform = '';
                    contentEl.style.transition = '';
                    modalEl.style.transition = '';
                    modalEl.style.opacity = '';
                    
                }, 300); // Tempo da animação CSS

            } else {
                // --- CANCELA E VOLTA (BOUNCE BACK) ---
                contentEl.style.transform = 'translateY(0)';
                setTimeout(() => {
                    contentEl.style.transition = '';
                    contentEl.style.transform = '';
                }, 300);
            }
            
            touchStartPagamentosY = 0;
            touchMovePagamentosY = 0;
        });
    }
	
    await init();
});