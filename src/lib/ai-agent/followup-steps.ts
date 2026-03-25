/** Passos de follow-up: vários atrasos desde a última mensagem nossa (âncora), até o cliente responder. */

export type FollowupStep = {
    delay_minutes: number
    message: string
}

const MAX_STEPS = 15
const MIN_MINUTES = 1
const MAX_MINUTES = 60 * 24 * 30 // 30 dias

function clampDelayMinutes(n: number): number {
    if (!Number.isFinite(n)) return MIN_MINUTES
    return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.floor(n)))
}

function unitToMinutes(unit: string, amount: number): number {
    const u = String(unit || 'hours').toLowerCase()
    const a = Number.isFinite(amount) ? amount : 0
    if (u === 'minutes' || u === 'minute' || u === 'min' || u === 'mins') return a
    if (u === 'days' || u === 'day') return a * 24 * 60
    return a * 60 // hours default
}

export function parseFollowupStepsFromConfig(config: Record<string, unknown>): FollowupStep[] {
    const raw = config.ai_followup_steps
    let arr: unknown[] = []
    if (Array.isArray(raw)) arr = raw
    else if (typeof raw === 'string') {
        try {
            const p = JSON.parse(raw) as unknown
            if (Array.isArray(p)) arr = p
        } catch {
            arr = []
        }
    }

    const out: FollowupStep[] = []
    for (let i = 0; i < arr.length && out.length < MAX_STEPS; i++) {
        const item = arr[i]
        if (!item || typeof item !== 'object') continue
        const o = item as Record<string, unknown>
        let delay = Number(o.delay_minutes)
        if (!Number.isFinite(delay)) {
            const amt = Number(o.amount ?? o.value)
            delay = unitToMinutes(String(o.unit || 'hours'), amt)
        }
        delay = clampDelayMinutes(delay)
        const msg = String(o.message || '').trim()
        if (!msg) continue
        out.push({ delay_minutes: delay, message: msg })
    }

    if (out.length === 0) {
        const legacyH = Number((config as Record<string, unknown>).ai_followup_after_hours)
        const legacyMsg = String((config as Record<string, unknown>).ai_followup_message || '').trim()
        if (legacyMsg && Number.isFinite(legacyH)) {
            out.push({
                delay_minutes: clampDelayMinutes(legacyH * 60),
                message: legacyMsg
            })
        }
    }

    out.sort((a, b) => a.delay_minutes - b.delay_minutes)
    return out
}

/** Corpo do POST /api/ai/config: `ai_followup_steps` com `delay_minutes` ou `amount`+`unit`. */
export function parseFollowupStepsFromBody(rawBody: unknown, enabled: boolean): FollowupStep[] {
    if (!enabled) return []
    if (!rawBody || typeof rawBody !== 'object') return []
    const body = rawBody as Record<string, unknown>
    const raw = body.ai_followup_steps
    if (!Array.isArray(raw)) return []
    const out: FollowupStep[] = []
    for (let i = 0; i < raw.length && out.length < MAX_STEPS; i++) {
        const item = raw[i]
        if (!item || typeof item !== 'object') continue
        const o = item as Record<string, unknown>
        let delay = Number(o.delay_minutes)
        if (!Number.isFinite(delay)) {
            const amt = Number(o.amount ?? o.value)
            delay = unitToMinutes(String(o.unit || 'hours'), amt)
        }
        delay = clampDelayMinutes(delay)
        const msg = String(o.message || '').trim()
        if (!msg) continue
        out.push({ delay_minutes: delay, message: msg })
    }
    out.sort((a, b) => a.delay_minutes - b.delay_minutes)
    return out
}

export type FollowupStepUi = {
    id: string
    amount: number
    unit: 'minutes' | 'hours' | 'days'
    message: string
}

function minutesToAmountUnit(m: number): { amount: number; unit: 'minutes' | 'hours' | 'days' } {
    if (m >= 1440 && m % 1440 === 0) return { amount: m / 1440, unit: 'days' }
    if (m >= 60 && m % 60 === 0) return { amount: m / 60, unit: 'hours' }
    return { amount: m, unit: 'minutes' }
}

export function followupStepsToUiRows(steps: FollowupStep[]): FollowupStepUi[] {
    return steps.map((s, i) => ({
        id: `loaded-${i}-${s.delay_minutes}`,
        ...minutesToAmountUnit(s.delay_minutes),
        message: s.message
    }))
}

export function newFollowupStepRow(): FollowupStepUi {
    return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        amount: 15,
        unit: 'minutes',
        message: ''
    }
}
