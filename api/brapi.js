


const DEFAULT_ALLOWED_ORIGIN = 'https://appvesto.vercel.app';

const CONFIG = {
    allowedOrigin: process.env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN,
    baseUrl:       'https://brapi.dev/api',
    timeoutMs:     8000,

    
    
    cacheTTL: {
        'quote':      60,    
        'v2/finance': 120,   
        'inflation':  3600,  
        'prime-rate': 3600,
        'exchange':   300,   
        default:      300,   
    },

    
    allowedPrefixes: [
        'quote/',
        'quote/list',
        'v2/finance',
        'inflation',
        'prime-rate',
        'exchange',
    ],
};




const log = {
    _w: (level, msg, meta) =>
        console[level === 'error' ? 'error' : 'log'](
            JSON.stringify({ level, msg, ...meta, ts: new Date().toISOString() })
        ),
    info:  (msg, meta = {}) => log._w('info',  msg, meta),
    warn:  (msg, meta = {}) => log._w('warn',  msg, meta),
    error: (msg, meta = {}) => log._w('error', msg, meta),
};

function resolveAllowedOrigin(request) {
    const configured = (CONFIG.allowedOrigin || DEFAULT_ALLOWED_ORIGIN).trim();
    const requestOrigin = request.headers?.origin;
    if (
        typeof requestOrigin === 'string' &&
        /^https:\/\/appvesto(?:-[a-z0-9-]+)?\.vercel\.app$/i.test(requestOrigin)
    ) {
        return requestOrigin;
    }
    return configured || DEFAULT_ALLOWED_ORIGIN;
}

function applyCors(request, response) {
    const allowedOrigin = resolveAllowedOrigin(request);
    response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}




class AppError extends Error {
    constructor(message, statusCode = 500) {
        super(message);
        this.name = 'AppError';
        this.statusCode = statusCode;
    }
}
class ValidationError extends AppError {
    constructor(msg) { super(msg, 400); this.name = 'ValidationError'; }
}
class UpstreamError extends AppError {
    constructor(msg, statusCode = 502) { super(msg, statusCode); this.name = 'UpstreamError'; }
}






function requestId() {
    return Math.random().toString(36).slice(2, 9);
}


function resolveTTL(path) {
    for (const [prefix, ttl] of Object.entries(CONFIG.cacheTTL)) {
        if (prefix !== 'default' && path.startsWith(prefix)) return ttl;
    }
    return CONFIG.cacheTTL.default;
}


function validatePath(raw) {
    if (!raw || typeof raw !== 'string') throw new ValidationError("ParÃ¢metro 'path' ausente.");

    
    const clean = raw.replace(/^\/+/, '').trim();

    if (!clean) throw new ValidationError("ParÃ¢metro 'path' vazio.");

    
    if (clean.includes('..') || clean.includes('//')) {
        throw new ValidationError("ParÃ¢metro 'path' invÃ¡lido.");
    }

    
    const allowed = CONFIG.allowedPrefixes.some(prefix => clean.startsWith(prefix));
    if (!allowed) {
        throw new ValidationError(
            `Endpoint nÃ£o permitido. Prefixos aceitos: ${CONFIG.allowedPrefixes.join(', ')}.`
        );
    }

    return clean;
}

module.exports = async function handler(request, response) {
    const rid = requestId();

    applyCors(request, response);
    response.setHeader('X-Request-Id', rid);

    if (request.method === 'OPTIONS') return response.status(200).end();

    if (request.method !== 'GET') {
        return response.status(405).json({ error: 'MÃ©todo nÃ£o permitido. Use GET.' });
    }

    const { BRAPI_API_TOKEN } = process.env;
    if (!BRAPI_API_TOKEN) {
        log.error('BRAPI_API_TOKEN nÃ£o configurado', { rid });
        return response.status(500).json({ error: 'ConfiguraÃ§Ã£o de servidor incompleta.' });
    }

    let cleanPath;
    try {
        const pathArg = typeof request.query?.path === 'string'
            ? request.query.path
            : new URL(request.url, `https://${request.headers.host || 'localhost'}`).searchParams.get('path');
        cleanPath = validatePath(pathArg);
    } catch (err) {
        if (err instanceof AppError) {
            return response.status(err.statusCode).json({ error: err.message });
        }
        return response.status(400).json({ error: 'RequisiÃ§Ã£o invÃ¡lida.' });
    }

    const ttl = resolveTTL(cleanPath);

    try {
        
        const targetUrl = new URL(`${CONFIG.baseUrl}/${cleanPath}`);
        targetUrl.searchParams.append('token', BRAPI_API_TOKEN);

        const controller = new AbortController();
        const timeoutId  = setTimeout(() => controller.abort(), CONFIG.timeoutMs);

        log.info('Brapi request', { rid, path: cleanPath });

        let apiResponse;
        try {
            apiResponse = await fetch(targetUrl.toString(), {
                signal:  controller.signal,
                headers: { 'Accept': 'application/json' },
                next:    { revalidate: ttl },
            });
        } finally {
            clearTimeout(timeoutId);
        }

        const data = await apiResponse.json().catch(() => null);

        if (!apiResponse.ok) {
            log.warn('Brapi upstream error', { rid, path: cleanPath, status: apiResponse.status });
            throw new UpstreamError(
                data?.message || `Erro retornado pela Brapi (HTTP ${apiResponse.status}).`,
                apiResponse.status >= 500 ? 502 : apiResponse.status
            );
        }

        response.setHeader('Cache-Control', `s-maxage=${ttl}, stale-while-revalidate=${Math.floor(ttl / 2)}`);

        log.info('Brapi request ok', { rid, path: cleanPath, ttl });
        return response.status(200).json(data);

    } catch (err) {
        if (err.name === 'AbortError') {
            log.error('Brapi timeout', { rid, path: cleanPath, timeoutMs: CONFIG.timeoutMs });
            return response.status(504).json({ error: 'A Brapi nÃ£o respondeu a tempo. Tente novamente.' });
        }

        if (err instanceof AppError) {
            log.warn('Upstream error handled', { rid, status: err.statusCode, error: err.message });
            return response.status(err.statusCode).json({ error: err.message });
        }

        log.error('Unhandled error', { rid, error: err.message });
        return response.status(500).json({ error: 'Erro interno ao conectar na Brapi.' });
    }
}



