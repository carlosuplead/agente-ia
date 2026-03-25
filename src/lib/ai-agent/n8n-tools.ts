/** Definição de uma ferramenta N8N exposta ao LLM (nome único + URL + timeout + descrição). */

export type N8nToolDef = {
    tool_name: string
    url: string
    timeout_seconds: number
    description: string
}

const MAX_TOOLS = 20

export function defaultN8nToolDescription(): string {
    return 'Aciona um workflow externo (N8N). Envie um payload em texto com os dados relevantes.'
}

/** Aceita nome já técnico (ex.: call_n8n_webhook) ou gera n8n_* a partir do slug. */
export function normalizeToolNameFromUi(input: string, index: number): string {
    const t = input.trim().toLowerCase()
    if (/^[a-z][a-z0-9_]{0,63}$/.test(t)) return t
    return sanitizeN8nToolName(input, index)
}

/** Gera nome seguro para function calling (OpenAI/Gemini). */
export function sanitizeN8nToolName(input: string, index: number): string {
    let s = input
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
    if (!s) s = `workflow_${index + 1}`
    if (/^\d/.test(s)) s = `w_${s}`
    if (!s.startsWith('n8n_')) s = `n8n_${s.replace(/^n8n_+/, '')}`
    if (!/^[a-z]/.test(s)) s = `n8n_${s}`
    return s.slice(0, 64)
}

/** Nomes aceites no LLM (letra inicial, só minúsculas, números e _). */
function isValidToolName(name: string): boolean {
    return /^[a-z][a-z0-9_]{0,63}$/.test(name)
}

/** Lê `n8n_tools` da BD (json/jsonb) e faz fallback para colunas legadas (uma URL). */
export function parseN8nToolsFromConfig(config: Record<string, unknown>): N8nToolDef[] {
    const raw = config.n8n_tools
    let arr: unknown[] = []
    if (Array.isArray(raw)) arr = raw
    else if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
        // jsonb às vezes já vem como objeto — ignorar
        arr = []
    } else if (typeof raw === 'string') {
        try {
            const p = JSON.parse(raw) as unknown
            if (Array.isArray(p)) arr = p
        } catch {
            arr = []
        }
    }

    const out: N8nToolDef[] = []
    const seen = new Set<string>()

    for (let i = 0; i < arr.length; i++) {
        const item = arr[i]
        if (!item || typeof item !== 'object') continue
        const o = item as Record<string, unknown>
        let name = String(o.tool_name || '').trim().toLowerCase()
        if (!isValidToolName(name)) name = sanitizeN8nToolName(String(o.tool_name || ''), i)
        if (!isValidToolName(name)) continue
        const url = String(o.url || '').trim()
        if (!url) continue
        if (seen.has(name)) continue
        seen.add(name)
        const to = Number(o.timeout_seconds)
        const timeout = Number.isFinite(to) ? Math.min(120, Math.max(5, Math.floor(to))) : 30
        const desc = String(o.description || '').trim() || defaultN8nToolDescription()
        out.push({ tool_name: name, url, timeout_seconds: timeout, description: desc })
        if (out.length >= MAX_TOOLS) break
    }

    const legacyUrl = String(config.n8n_webhook_url || '').trim()
    const legacyOn = config.n8n_webhook_enabled === true
    if (out.length === 0 && legacyOn && legacyUrl) {
        const to = Number(config.n8n_webhook_timeout_seconds)
        const timeout = Number.isFinite(to) ? Math.min(120, Math.max(5, Math.floor(to))) : 30
        const desc =
            String(config.n8n_tool_description || '').trim() || defaultN8nToolDescription()
        out.push({
            tool_name: 'call_n8n_webhook',
            url: legacyUrl,
            timeout_seconds: timeout,
            description: desc
        })
    }

    return out
}

export function n8nToolsActive(config: Record<string, unknown>, meta: boolean): boolean {
    return (
        meta &&
        config.n8n_webhook_enabled === true &&
        parseN8nToolsFromConfig(config).length > 0
    )
}
