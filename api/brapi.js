// ---------------------------------------------------------
// CONFIGURAÇÃO
// ---------------------------------------------------------
const CONFIG = {
    allowedOrigin: process.env.ALLOWED_ORIGIN || '*',
    baseUrl:       'https://brapi.dev/api',
    timeoutMs:     8000,

    // TTL de cache por prefixo de endpoint (em segundos)
    // Cotações mudam rápido; dados cadastrais são mais estáveis.
    cacheTTL: {
        'quote':      60,    // 1 min  — preços em tempo quase real
        'v2/finance': 120,   // 2 min  — dados financeiros
        'inflation':  3600,  // 1 hora — índices macroeconômicos
        'prime-rate': 3600,
        'exchange':   300,   // 5 min  — câmbio
        default:      300,   // 5 min  — tudo mais
    },

    // Prefixos de path permitidos — protege contra SSRF
    allowedPrefixes: [
        'quote/',
        'quote/list',
        'v2/finance',
        'inflation',
        'prime-rate',
        'exchange',
    ],
};

// ---------------------------------------------------------
// LOGGER ESTRUTURADO
// ---------------------------------------------------------
const log = {
    _w: (level, msg, meta) =>
        console[level === 'error' ? 'error' : 'log'](
            JSON.stringify({ level, msg, ...meta, ts: new Date().toISOString() })
        ),
    info:  (msg, meta = {}) => log._w('info',  msg, meta),
    warn:  (msg, meta = {}) => log._w('warn',  msg, meta),
    error: (msg, meta = {}) => log._w('error', msg, meta),
};

// ---------------------------------------------------------
// ERROS TIPADOS
// ---------------------------------------------------------
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

// ---------------------------------------------------------
// HELPERS
// ---------------------------------------------------------

// Gera um ID curto para rastrear cada request nos logs
function requestId() {
    return Math.random().toString(36).slice(2, 9);
}

// Resolve o TTL de cache pelo prefixo do path solicitado
function resolveTTL(path) {
    for (const [prefix, ttl] of Object.entries(CONFIG.cacheTTL)) {
        if (prefix !== 'default' && path.startsWith(prefix)) return ttl;
    }
    return CONFIG.cacheTTL.default;
}

// Valida o path contra o allowlist e sanitiza
function validatePath(raw) {
    if (!raw || typeof raw !== 'string') throw new ValidationError("Parâmetro 'path' ausente.");

    // Remove barra inicial e espaços
    const clean = raw.replace(/^\/+/, '').trim();

    if (!clean) throw new ValidationError("Parâmetro 'path' vazio.");

    // Bloqueia tentativas de path traversal
    if (clean.includes('..') || clean.includes('//')) {
        throw new ValidationError("Parâmetro 'path' inválido.");
    }

    // Verifica contra allowlist de prefixos
    const allowed = CONFIG.allowedPrefixes.some(prefix => clean.startsWith(prefix));
    if (!allowed) {
        throw new ValidationError(
            `Endpoint não permitido. Prefixos aceitos: ${CONFIG.allowedPrefixes.join(', ')}.`
        );
    }

    return clean;
}

// ---------------------------------------------------------
// HANDLER PRINCIPAL
// ---------------------------------------------------------
export default async function handler(request, response) {
    const rid = requestId();

    // CORS
    response.setHeader('Access-Control-Allow-Credentials', true);
    response.setHeader('Access-Control-Allow-Origin', CONFIG.allowedOrigin);
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('X-Request-Id', rid);

    if (request.method === 'OPTIONS') return response.status(200).end();

    // Só aceita GET
    if (request.method !== 'GET') {
        return response.status(405).json({ error: 'Método não permitido. Use GET.' });
    }

    const { BRAPI_API_TOKEN } = process.env;
    if (!BRAPI_API_TOKEN) {
        log.error('BRAPI_API_TOKEN não configurado', { rid });
        return response.status(500).json({ error: 'Configuração de servidor incompleta.' });
    }

    let cleanPath;
    try {
        const urlParts = new URL(request.url, `https://${request.headers.host}`);
        const pathArg  = urlParts.searchParams.get('path');
        cleanPath = validatePath(pathArg);
    } catch (err) {
        if (err instanceof AppError) {
            return response.status(err.statusCode).json({ error: err.message });
        }
        return response.status(400).json({ error: 'Requisição inválida.' });
    }

    const ttl = resolveTTL(cleanPath);

    try {
        // Monta URL de destino e injeta token
        const targetUrl = new URL(`${CONFIG.baseUrl}/${cleanPath}`);
        targetUrl.searchParams.append('token', BRAPI_API_TOKEN);

        // Timeout via AbortController — sem isso, requests podem travar indefinidamente
        const controller = new AbortController();
        const timeoutId  = setTimeout(() => controller.abort(), CONFIG.timeoutMs);

        log.info('Brapi request', { rid, path: cleanPath });

        let apiResponse;
        try {
            apiResponse = await fetch(targetUrl.toString(), {
                signal:  controller.signal,
                headers: { 'Accept': 'application/json' },
                next:    { revalidate: ttl }, // hint para cache do Next.js
            });
        } finally {
            clearTimeout(timeoutId);
        }

        // Lê o body uma única vez
        const data = await apiResponse.json().catch(() => null);

        if (!apiResponse.ok) {
            // Loga sem expor o token (a URL já tem o token, então logamos só o path)
            log.warn('Brapi upstream error', { rid, path: cleanPath, status: apiResponse.status });
            // Repassa o status da Brapi mas normaliza a resposta para não vazar detalhes internos
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
            return response.status(504).json({ error: 'A Brapi não respondeu a tempo. Tente novamente.' });
        }

        if (err instanceof AppError) {
            log.warn('Upstream error handled', { rid, status: err.statusCode, error: err.message });
            return response.status(err.statusCode).json({ error: err.message });
        }

        log.error('Unhandled error', { rid, error: err.message });
        return response.status(500).json({ error: 'Erro interno ao conectar na Brapi.' });
    }
}
