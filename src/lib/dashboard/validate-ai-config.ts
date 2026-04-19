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
        | 'cfgPrompt'
        | 'n8nTools'
        | 'followupSteps'
        | 'cfgChunkMax'
        | 'cfgTestAllowlist'
        | 'cfgTeamNotifyAllowlist'
        | 'cfgSellerNotifyUrl'
        | 'cfgSellerNotifyToken'
        | 'cfgSellerNotifyPhones',
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
    cfgPrompt: string
    cfgN8nOn: boolean
    cfgN8nTools: N8nToolUiRow[]
    cfgFollowup: boolean
    cfgFollowupSteps: FollowupStepUi[]
    cfgFollowupPrompt?: string
    cfgChunkMaxParts: number
    cfgTestMode: boolean
    cfgTestAllowlist: string
    cfgTeamNotify: boolean
    cfgTeamNotifyAllowlist: string
    cfgSellerNotify: boolean
    cfgSellerNotifyUrl: string
    cfgSellerNotifyTokenSet: boolean
    cfgSellerNotifyPhones: string
}): { ok: true } | { ok: false; errors: AiConfigFieldErrors } {
    const errors: AiConfigFieldErrors = {}

    if (!input.cfgPrompt.trim()) {
        errors.cfgPrompt = 'Indica o prompt do sistema (obrigatório).'
    }

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

    if (input.cfgSellerNotify) {
        const url = input.cfgSellerNotifyUrl.trim()
        if (!url) {
            errors.cfgSellerNotifyUrl = 'Indica a URL da UAZAPI (ex. https://atendsoft.uazapi.com).'
        } else {
            try {
                // eslint-disable-next-line no-new
                new URL(url)
            } catch {
                errors.cfgSellerNotifyUrl = 'URL inválida.'
            }
        }
        if (!input.cfgSellerNotifyTokenSet) {
            errors.cfgSellerNotifyToken = 'Cola o token UAZAPI (é guardado cifrado).'
        }
        if (!hasValidAllowlistEntry(input.cfgSellerNotifyPhones)) {
            errors.cfgSellerNotifyPhones =
                'Indica pelo menos um telefone do vendedor (um por linha ou separados por vírgula).'
        }
    }

    if (input.cfgFollowup) {
        const hasAiPrompt = !!input.cfgFollowupPrompt && input.cfgFollowupPrompt.trim().length > 0
        // Se não há prompt IA, pelo menos um passo precisa ter mensagem fixa
        if (!hasAiPrompt) {
            const hasFollowupMessage = input.cfgFollowupSteps.some(s => s.message.trim())
            if (!hasFollowupMessage) {
                errors.followupSteps =
                    'Follow-up ativo: adiciona pelo menos um passo com mensagem — ou preenche o "Prompt de follow-up" para a IA gerar.'
            }
        } else if (input.cfgFollowupSteps.length === 0) {
            errors.followupSteps =
                'Follow-up ativo: adiciona pelo menos um passo com o tempo de espera.'
        }
        for (let i = 0; i < input.cfgFollowupSteps.length; i++) {
            const s = input.cfgFollowupSteps[i]
            // Com prompt IA, a mensagem é opcional — mas o tempo continua obrigatório
            if (!s.message.trim() && !hasAiPrompt) continue
            if (!Number.isFinite(s.amount) || s.amount < 1 || s.amount > 9999) {
                errors.followupSteps = `Passo ${i + 1}: quantidade entre 1 e 9999.`
                break
            }
        }
    }

    return Object.keys(errors).length === 0 ? { ok: true } : { ok: false, errors }
}
