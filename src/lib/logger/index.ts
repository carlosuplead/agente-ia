/**
 * Logger estruturado minimalista — JSON no stdout para consumo por Vercel Log Drain / Datadog / etc.
 *
 * Uso:
 *   const log = createLogger({ tag: 'ai_process', workspace: 'slug', contact: 'id' })
 *   log.info('start', { source: 'buffer' })
 *   log.error('llm_failed', { error: err.message })
 *
 * Com correlation_id:
 *   const log = createLogger({ tag: 'webhook', correlation_id: crypto.randomUUID() })
 *
 * Em desenvolvimento, imprime de forma mais legível; em produção, JSON puro.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogContext = Record<string, string | number | boolean | null | undefined>

const IS_PROD = process.env.NODE_ENV === 'production'

function emit(level: LogLevel, message: string, ctx: LogContext, extra?: unknown) {
    const record: Record<string, unknown> = {
        ts: new Date().toISOString(),
        level,
        msg: message,
        ...ctx
    }
    if (extra !== undefined) record.data = extra

    if (IS_PROD) {
        // JSON single-line para parsing por drain
        const line = JSON.stringify(record)
        if (level === 'error') console.error(line)
        else if (level === 'warn') console.warn(line)
        else console.log(line)
    } else {
        // Humano-legível em dev
        const ctxStr = Object.entries(ctx)
            .filter(([, v]) => v !== undefined && v !== null)
            .map(([k, v]) => `${k}=${v}`)
            .join(' ')
        const prefix = `[${level.toUpperCase()}]`
        const suffix = extra !== undefined ? ` ${JSON.stringify(extra)}` : ''
        const line = `${prefix} ${ctxStr ? `(${ctxStr}) ` : ''}${message}${suffix}`
        if (level === 'error') console.error(line)
        else if (level === 'warn') console.warn(line)
        else console.log(line)
    }
}

export type Logger = {
    debug: (msg: string, extra?: unknown) => void
    info: (msg: string, extra?: unknown) => void
    warn: (msg: string, extra?: unknown) => void
    error: (msg: string, extra?: unknown) => void
    child: (extra: LogContext) => Logger
    context: LogContext
}

export function createLogger(baseCtx: LogContext = {}): Logger {
    const ctx = { ...baseCtx }
    return {
        context: ctx,
        debug: (msg, extra) => emit('debug', msg, ctx, extra),
        info: (msg, extra) => emit('info', msg, ctx, extra),
        warn: (msg, extra) => emit('warn', msg, ctx, extra),
        error: (msg, extra) => emit('error', msg, ctx, extra),
        child: (extra) => createLogger({ ...ctx, ...extra })
    }
}

/** Gera correlation ID (UUID v4 simples — sem lib). */
export function newCorrelationId(): string {
    // Usa crypto.randomUUID quando disponível (Node 19+, runtime Edge/Node)
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID()
    }
    // Fallback para timestamp + random
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
