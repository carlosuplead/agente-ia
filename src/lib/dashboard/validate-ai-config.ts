import type { N8nToolUiRow } from './types'
import type { FollowupStepUi } from '@/lib/ai-agent/followup-steps'
import { hasValidAllowlistEntry } from '@/lib/ai-agent/test-mode-allowlist'

export type AiConfigFieldErrors = Partial<
    Record<
        | 'cfgMax'
        | 'cfgContextMax'
        | 'cfgSendDelay'
        | 'cfgBufferDelay'
        | 'cfgInactivity'
        | 'cfgModel'
        | 'n8nTools'
        | 'followupSteps'
        | 'cfgChunkMax'
        | 'cfgTestAllowlist'
        | 'cfgTeamNotifyAllowlist',
        string
    >
>

export function validateAiConfigForm(input: {
    cfgMax: number
    cfgContextMax: number
    cfgSendDelay: number
    cfgBufferDelay: number
    cfgInactivity: number
    cfgModel: string
    cfgN8nOn: boolean
    cfgN8nTools: N8nToolUiRow[]
    cfgFollowup: boolean
    cfgFollowupSteps: FollowupStepUi[]
    cfgChunkMaxParts: number
    cfgTestMode: boolean
    cfgTestAllowlist: string
    cfgTeamNotify: boolean
    cfgTeamNotifyAllowlist: string
}): { ok: true } | { ok: false; errors: AiConfigFieldErrors } {
    const errors: AiConfigFieldErrors = {}

    if (!Number.isFinite(input.cfgMax) || input.cfgMax < 1) {
        errors.cfgMax = 'Indica pelo menos 1 mensagem.'
    }
    if (
        !Number.isFinite(input.cfgContextMax) ||
        input.cfgContextMax < 1 ||
        input.cfgContextMax > 100
    ) {
        errors.cfgContextMax = 'Usa um valor entre 1 e 100.'
    }
    if (!Number.isFinite(input.cfgSendDelay) || input.cfgSendDelay < 0 || input.cfgSendDelay > 120_000) {
        errors.cfgSendDelay = 'Atraso entre 0 e 120000 ms.'
    }
    if (!Number.isFinite(input.cfgBufferDelay) || input.cfgBufferDelay < 5 || input.cfgBufferDelay > 120) {
        errors.cfgBufferDelay = 'Buffer entre 5 e 120 segundos.'
    }
    if (!Number.isFinite(input.cfgInactivity) || input.cfgInactivity < 1 || input.cfgInactivity > 720) {
        errors.cfgInactivity = 'Inatividade entre 1 e 720 horas.'
    }
    if (!input.cfgModel.trim()) {
        errors.cfgModel = 'Indica o modelo.'
    }
    if (
        !Number.isFinite(input.cfgChunkMaxParts) ||
        input.cfgChunkMaxParts < 1 ||
        input.cfgChunkMaxParts > 20
    ) {
        errors.cfgChunkMax = 'Máx. partes entre 1 e 20.'
    }

    if (input.cfgN8nOn) {
        for (let i = 0; i < input.cfgN8nTools.length; i++) {
            const t = input.cfgN8nTools[i]
            if (!t.url.trim()) continue
            if (t.timeout_seconds < 5 || t.timeout_seconds > 120 || !Number.isFinite(t.timeout_seconds)) {
                errors.n8nTools = `Workflow ${i + 1}: timeout entre 5 e 120 s.`
                break
            }
            try {
                // eslint-disable-next-line no-new
                new URL(t.url.trim())
            } catch {
                errors.n8nTools = `Workflow ${i + 1}: URL inválida.`
                break
            }
        }
    }

    if (input.cfgTestMode && !hasValidAllowlistEntry(input.cfgTestAllowlist)) {
        errors.cfgTestAllowlist =
            'Modo testes: indica pelo menos um número válido (um por linha ou separados por vírgula).'
    }

    if (input.cfgTeamNotify && !hasValidAllowlistEntry(input.cfgTeamNotifyAllowlist)) {
        errors.cfgTeamNotifyAllowlist =
            'Notificações à equipa: indica pelo menos um número válido (um por linha ou separados por vírgula).'
    }

    if (input.cfgFollowup) {
        for (let i = 0; i < input.cfgFollowupSteps.length; i++) {
            const s = input.cfgFollowupSteps[i]
            if (!s.message.trim()) continue
            if (!Number.isFinite(s.amount) || s.amount < 1 || s.amount > 9999) {
                errors.followupSteps = `Passo ${i + 1}: quantidade entre 1 e 9999.`
                break
            }
        }
    }

    return Object.keys(errors).length === 0 ? { ok: true } : { ok: false, errors }
}
