// ==========================================================
// Funções Auxiliares (Utilitários)
// ==========================================================

export const formatBRL = (value) => value?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) ?? 'N/A';

export const formatNumber = (value) => value?.toLocaleString('pt-BR') ?? 'N/A';

export const formatPercent = (value) => `${(value ?? 0).toFixed(2)}%`;

export const formatDate = (dateString, includeTime = false) => {
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

export const isFII = (symbol) => symbol && (symbol.endsWith('11') || symbol.endsWith('12'));

export function parseMesAno(mesAnoStr) { 
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

export function getSaoPauloDateTime() {
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

export function isB3Open() {
    const { dayOfWeek, hour } = getSaoPauloDateTime();
    if (dayOfWeek === 0 || dayOfWeek === 6) { return false; } 
    if (hour >= 10 && hour < 18) { return true; } 
    return false;
}

export const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export function gerarCores(num) {
    const PALETA_CORES = [
        '#8B5CF6', '#6D28D9', '#A78BFA', '#4C1D95', '#3b82f6', 
        '#22c55e', '#f97316', '#ef4444', '#14b8a6', '#eab308'
    ];
    let cores = [];
    for (let i = 0; i < num; i++) { cores.push(PALETA_CORES[i % PALETA_CORES.length]); }
    return cores;
}