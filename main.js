// main.js

// Configurações padrão do Chart.js
Chart.defaults.color = '#9ca3af'; 
Chart.defaults.borderColor = '#374151'; 

// Importa módulos
import { isFII } from './utils.js';
import { removerCacheAtivo, CACHE_PREFIX } from './cache.js';
import {
    verificarAtivo,
    fetchNoticiasBFF,
    buscarPrecosCarteira,
    processarProventosIA,
    buscarProventosFuturos,
    buscarHistoricoProventosAgregado
} from './api.js';
import {
    initUI,
    showToast,
    showModal,
    hideAddModal,
    mudarAba,
    renderizarDashboardSkeletons,
    renderizarCarteiraSkeletons,
    renderizarSkeletonsNoticias,
    renderizarCarteira,
    renderizarProventos,
    renderizarHistorico,
    renderizarNoticias,
    renderizarErroNoticias,
    setBotaoCarregando,
    setDashboardStatus,
    setBotaoAdicionarCarregando,
    setErroTickerInput
} from './ui.js';

// ==========================================================
// Constantes de Lógica
// ==========================================================
const REFRESH_INTERVAL = 1860000; // 31 minutos
const DB_KEY_TRANSACOES = 'vesto_transacoes_v1';
const DB_KEY_PATRIMONIO = 'vesto_patrimonio_v1';
const DB_KEY_CAIXA = 'vesto_caixa_v1';
const DB_KEY_PROVENTOS_CONHECIDOS = 'vesto_proventos_conhecidos_v1';
const todayString = new Date().toLocaleDateString('pt-BR', { year: 'numeric', month: 'long', day: 'numeric' });

// ==========================================================
// Estado Central da Aplicação
// ==========================================================
let transacoes = [];        
let carteiraCalculada = []; 
let patrimonio = [];
let saldoCaixa = 0;
let proventosConhecidos = [];
let precosAtuais = [];
let proventosAtuais = []; // Apenas proventos futuros

// ==========================================================
// Funções de Dados (Lógica Local)
// ==========================================================

function salvarTransacoes() {
    localStorage.setItem(DB_KEY_TRANSACOES, JSON.stringify(transacoes));
}

function carregarTransacoes() {
    const transacoesSalvas = localStorage.getItem(DB_KEY_TRANSACOES);
    transacoes = transacoesSalvas ? JSON.parse(transacoesSalvas) : [];
}

function carregarPatrimonio() {
     const patrimonioSalvo = localStorage.getItem(DB_KEY_PATRIMONIO);
     patrimonio = patrimonioSalvo ? JSON.parse(patrimonioSalvo) : [];
}

function salvarSnapshotPatrimonio(totalValor) {
    if (totalValor <= 0 && patrimonio.length === 0) return; 
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const index = patrimonio.findIndex(p => p.date === today);
    
    if (index > -1) {
        patrimonio[index].value = totalValor;
    } else {
        patrimonio.push({ date: today, value: totalValor });
    }
    
    if (patrimonio.length > 365) {
        patrimonio = patrimonio.slice(patrimonio.length - 365);
    }
    localStorage.setItem(DB_KEY_PATRIMONIO, JSON.stringify(patrimonio));
}

function carregarCaixa() {
    const caixaSalvo = localStorage.getItem(DB_KEY_CAIXA);
    saldoCaixa = caixaSalvo ? parseFloat(caixaSalvo) : 0;
}

function salvarCaixa() {
    localStorage.setItem(DB_KEY_CAIXA, saldoCaixa.toString());
}

function carregarProventosConhecidos() {
    const proventosSalvos = localStorage.getItem(DB_KEY_PROVENTOS_CONHECIDOS);
    proventosConhecidos = proventosSalvos ? JSON.parse(proventosSalvos) : [];
}

function salvarProventosConhecidos() {
    localStorage.setItem(DB_KEY_PROVENTOS_CONHECIDOS, JSON.stringify(proventosConhecidos));
}

/** Processa dividendos que já foram pagos e os move para o "Caixa" */
function processarDividendosPagos() {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0); // Compara apenas com o início do dia
    
    const carteiraMap = new Map(carteiraCalculada.map(a => [a.symbol, a.quantity]));
    let precisaSalvar = false;

    proventosConhecidos.forEach(provento => {
        if (provento.paymentDate && !provento.processado) {
            const parts = provento.paymentDate.split('-');
            const dataPagamento = new Date(parts[0], parts[1] - 1, parts[2]);

            if (!isNaN(dataPagamento) && dataPagamento < hoje) {
                const quantity = carteiraMap.get(provento.symbol) || 0;
                if (quantity > 0 && typeof provento.value === 'number' && provento.value > 0) {
                    const valorRecebido = provento.value * quantity;
                    saldoCaixa += valorRecebido;
                    provento.processado = true; // Marca como processado
                    precisaSalvar = true;
                    console.log(`Processado pagamento de ${provento.symbol}: ${formatBRL(valorRecebido)}`);
                } else {
                    provento.processado = true; 
                    precisaSalvar = true;
                }
            }
        }
    });

    if (precisaSalvar) {
        salvarCaixa();
        salvarProventosConhecidos();
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
// Funções Principais (Orquestradores)
// ==========================================================

 /** Função principal de atualização de dados */
 async function atualizarTodosDados(force = false) { 
    // 1. Mostra Skeletons (Estado de Carregamento)
    renderizarDashboardSkeletons(true);
    renderizarCarteiraSkeletons(true);
    renderizarSkeletonsNoticias(true);
    
    // 2. Carrega dados locais primeiro
    calcularCarteira();
    processarDividendosPagos();
    renderizarHistorico(transacoes);
    // renderizarGraficoPatrimonio(patrimonio); // Movido para dentro do renderizarCarteira
    
    if (carteiraCalculada.length > 0) {
        setDashboardStatus(true);
    }
    setBotaoCarregando(force);

    // 3. Carrega proventos do cache local ANTES da rede (se não for 'force')
    if (!force) {
        const proventosFuturosCache = processarProventosIA(proventosConhecidos, carteiraCalculada);
        if (proventosFuturosCache.length > 0) {
            proventosAtuais = proventosFuturosCache;
            renderizarProventos(carteiraCalculada, proventosAtuais);
        }
    }
    
    // 4. Se não houver carteira, renderiza o estado vazio e busca apenas notícias
    if (carteiraCalculada.length === 0) {
         precosAtuais = []; 
         proventosAtuais = []; 
         const patrimonioTotal = renderizarCarteira(carteiraCalculada, precosAtuais, proventosAtuais, saldoCaixa, patrimonio);
         salvarSnapshotPatrimonio(patrimonioTotal);
         renderizarProventos(carteiraCalculada, proventosAtuais);
         
         setBotaoCarregando(false);
         try {
             const articles = await fetchNoticiasBFF(todayString, force);
             renderizarNoticias(articles);
         } catch (e) {
             console.error("Erro ao buscar notícias (carteira vazia):", e);
             renderizarErroNoticias();
         }
         return;
    }

    // 5. Dispara as buscas de rede em paralelo
    const promessaPrecos = buscarPrecosCarteira(carteiraCalculada, force); 
    const promessaProventos = buscarProventosFuturos(carteiraCalculada, todayString, force);
    const promessaHistorico = buscarHistoricoProventosAgregado(carteiraCalculada, todayString, force);
    const promessaNoticias = fetchNoticiasBFF(todayString, force); 

    // 6. Handlers de Sincronização
    promessaPrecos.then(precos => {
        if (precos.length > 0) {
            precosAtuais = precos; 
            const patrimonioTotal = renderizarCarteira(carteiraCalculada, precosAtuais, proventosAtuais, saldoCaixa, patrimonio);
            salvarSnapshotPatrimonio(patrimonioTotal);
        } else if (precosAtuais.length === 0) { 
            const patrimonioTotal = renderizarCarteira(carteiraCalculada, precosAtuais, proventosAtuais, saldoCaixa, patrimonio);
            salvarSnapshotPatrimonio(patrimonioTotal);
        }
    }).catch(err => {
        console.error("Erro ao buscar preços (BFF):", err);
        showToast("Erro ao buscar preços.");
        if (precosAtuais.length === 0) { 
            const patrimonioTotal = renderizarCarteira(carteiraCalculada, precosAtuais, proventosAtuais, saldoCaixa, patrimonio);
            salvarSnapshotPatrimonio(patrimonioTotal);
        }
    });

    promessaProventos.then(({ proventosPool, novosParaSalvar }) => {
        if (novosParaSalvar.length > 0) {
            let mudou = false;
            for (const provento of novosParaSalvar) {
                const idUnico = provento.symbol + '_' + provento.paymentDate;
                if (!proventosConhecidos.some(p => (p.symbol + '_' + p.paymentDate) === idUnico)) {
                    proventosConhecidos.push({ ...provento, processado: false });
                    mudou = true;
                }
            }
            if (mudou) salvarProventosConhecidos();
        }
        
        proventosAtuais = processarProventosIA(proventosPool, carteiraCalculada); 
        renderizarProventos(carteiraCalculada, proventosAtuais); 
        if (precosAtuais.length > 0) {
            const patrimonioTotal = renderizarCarteira(carteiraCalculada, precosAtuais, proventosAtuais, saldoCaixa, patrimonio);
            salvarSnapshotPatrimonio(patrimonioTotal);
        }
    }).catch(err => {
        console.error("Erro ao buscar proventos (BFF):", err);
        showToast("Erro ao buscar proventos.");
        if (proventosAtuais.length === 0) { totalProventosEl.textContent = "Erro"; }
    });
    
    promessaHistorico.then(({ labels, data }) => {
        // Esta função de renderização está no ui.js, mas é chamada aqui
        renderizarGraficoHistorico({ labels, data });
    }).catch(err => {
        console.error("Erro ao buscar histórico agregado (BFF):", err);
        showToast("Erro ao buscar histórico.");
        renderizarGraficoHistorico({ labels: [], data: [] }); 
    });
    
    promessaNoticias.then(articles => {
        renderizarNoticias(articles);
    }).catch(err => {
        console.error("Erro ao buscar notícias (BFF):", err);
        renderizarErroNoticias();
    });

    // 7. Finaliza o estado de carregamento
    try {
        await Promise.allSettled([promessaPrecos, promessaProventos, promessaHistorico, promessaNoticias]); 
    } finally {
        console.log("Todas as sincronizações (BFF) terminaram.");
        setBotaoCarregando(false);
        setDashboardStatus(false);
    }
}

/** Lógica para adicionar uma nova transação */
async function handleAdicionarAtivo(tickerValor, qtdValor, precoValor) {
    let ticker = tickerValor.trim().toUpperCase();
    let novaQuantidade = parseInt(qtdValor, 10);
    let novoPreco = parseFloat(precoValor.replace(',', '.')); 

    if (ticker.endsWith('.SA')) ticker = ticker.replace('.SA', '');

    if (!ticker || !novaQuantidade || novaQuantidade <= 0 || !novoPreco || novoPreco < 0) { 
        showToast("Preencha todos os campos.");
        // A lógica de UI (bordas vermelhas) já está no ui.js, basta mostrar o toast.
        return;
    }
    
    const ativoExistente = carteiraCalculada.find(a => a.symbol === ticker);
    
    if (!ativoExistente) {
        setBotaoAdicionarCarregando(true);
        const tickerParaApi = isFII(ticker) ? `${ticker}.SA` : ticker;
        
        try {
             const quoteData = await verificarAtivo(tickerParaApi);
             if (!quoteData.results || quoteData.results[0].error) {
                 throw new Error(quoteData.results?.[0]?.error || 'Ativo não encontrado');
             }
             // Limpa o cache do gráfico de histórico para forçar recálculo
             Object.keys(localStorage)
                .filter(key => key.startsWith(CACHE_PREFIX + 'hist_agregado_v4_'))
                .forEach(key => localStorage.removeItem(key));

        } catch (error) {
             console.error(`Erro ao verificar ativo ${tickerParaApi}:`, error);
             showToast("Ativo não encontrado.");
             setErroTickerInput();
             setBotaoAdicionarCarregando(false);
             return;
        }
    } 
    
    transacoes.push({
        id: 'tx_' + Date.now(),
        date: new Date().toISOString(),
        symbol: ticker,
        type: 'buy',
        quantity: novaQuantidade,
        price: novoPreco
    });

    salvarTransacoes();
    
    setBotaoAdicionarCarregando(false);
    hideAddModal();
    
    atualizarTodosDados(true); // Força atualização
}

/** Lógica para remover um ativo */
function handleRemoverAtivo(symbol) {
    showModal(
        'Remover Ativo', 
        `Tem certeza? Isso removerá ${symbol} e TODO o seu histórico de compras deste ativo.`, 
        () => { // Esta é a callback onConfirm
            transacoes = transacoes.filter(t => t.symbol !== symbol);
            removerCacheAtivo(symbol); 
            salvarTransacoes();
            // Limpa o cache do gráfico de histórico
             Object.keys(localStorage)
                .filter(key => key.startsWith(CACHE_PREFIX + 'hist_agregado_v4_'))
                .forEach(key => localStorage.removeItem(key));
            atualizarTodosDados(true); // Força atualização
        }
    );
}

// ==========================================================
// Inicialização da Aplicação
// ==========================================================

function init() {
    // 1. Carrega dados locais
    carregarTransacoes();
    carregarPatrimonio();
    carregarCaixa();
    carregarProventosConhecidos();
    
    // 2. Define os handlers que a UI irá chamar
    const handlers = {
        onRefresh: () => atualizarTodosDados(true),
        onAddAtivo: handleAdicionarAtivo,
        onRemoveAtivo: handleRemoverAtivo,
        getCarteira: () => carteiraCalculada, // Permite que a UI leia o estado atual
        getTodayString: () => todayString
    };

    // 3. Inicializa a UI e passa os handlers
    initUI(handlers);

    // 4. Muda para a aba inicial
    mudarAba('tab-dashboard'); 
    
    // 5. Inicia a primeira carga de dados
    atualizarTodosDados(false); 
    
    // 6. Configura a atualização em background
    setInterval(() => atualizarTodosDados(false), REFRESH_INTERVAL);
}

// Inicia o app
init();