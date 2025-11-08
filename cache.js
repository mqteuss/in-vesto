// cache.js

// Importa dependências que este módulo precisa
import { isFII } from './utils.js';

// Constantes de Cache
// Esta é local, usada como padrão apenas dentro deste módulo
const CACHE_DURATION = 1000 * 60 * 30; // 30 minutos

// Estas são exportadas para serem usadas nas funções de fetch
export const CACHE_24_HORAS = 1000 * 60 * 60 * 24; // 24 horas
export const CACHE_6_HORAS = 1000 * 60 * 60 * 6; // 6 HORAS
export const CACHE_PREFIX = 'vestoBrapiCache_v1_'; 

// ==========================================================
// Funções de Cache
// ==========================================================

export function setCache(key, data, duration = CACHE_DURATION) { 
    const cacheItem = { timestamp: Date.now(), data: data, duration: duration };
    try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(cacheItem)); } 
    catch (e) { console.error("Erro ao salvar no cache:", e); clearBrapiCache(); }
}

export function removerCacheAtivo(symbol) {
    console.log(`A limpar cache específico para: ${symbol}`);
    localStorage.removeItem(CACHE_PREFIX + `preco_${symbol}`);
    localStorage.removeItem(CACHE_PREFIX + `provento_ia_${symbol}`);
    localStorage.removeItem(CACHE_PREFIX + `detalhe_preco_${symbol}`);
    
    // Esta função depende de isFII
    if (isFII(symbol)) {
        Object.keys(localStorage)
            .filter(key => key.startsWith(CACHE_PREFIX + 'hist_agregado_v4_'))
            .forEach(key => localStorage.removeItem(key));
    }
}

export function getCache(key) {
    const cacheItem = localStorage.getItem(CACHE_PREFIX + key);
    if (!cacheItem) return null;
    try {
        const parsed = JSON.parse(cacheItem);
        const duration = parsed.duration ?? CACHE_DURATION; 
        if (duration === -1) { return parsed.data; }
        const isExpired = (Date.now() - parsed.timestamp) > duration;
        if (isExpired) { localStorage.removeItem(CACHE_PREFIX + key); return null; }
        return parsed.data;
    } catch (e) { localStorage.removeItem(CACHE_PREFIX + key); return null; }
}

export function clearBrapiCache() {
    console.warn("A limpar cache da Brapi e Notícias...");
    Object.keys(localStorage)
        .filter(key => key.startsWith(CACHE_PREFIX))
        .forEach(key => localStorage.removeItem(key));
}