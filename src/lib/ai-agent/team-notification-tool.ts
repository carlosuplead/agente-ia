import type { AiAgentConfig, BuiltContext } from '@/lib/ai-agent/types'
import { createAdminClient } from '@/lib/supabase/server'
import { getProviderForWorkspace } from '@/lib/whatsapp/factory'
import type { WhatsAppSendOptions } from '@/lib/whatsapp/provider.interface'
import { normalizePhoneForBrazil } from '@/lib/phone'
import {
    contactPhoneMatchesAllowlist,
    normalizedAllowlistPhones
} from '@/lib/ai-agent/test-mode-allowlist'

export const NOTIFY_TEAM_WHATSAPP_TOOL_NAME = 'notify_team_whatsapp'

const MAX_OUT_CHARS = 3500
const MAX_SUMMARY_CHARS = 2000
const TRANSCRIPT_TAIL_CHARS = 2200

const DEFAULT_TOOL_DESC = `Envia uma notificação por WhatsApp (texto) da instância do workspace para um número da equipa autorizado no painel. Usa quando concluíres uma etapa importante (ex.: triagem feita, agendamento confirmado). Argumentos: recipient_phone (um dos números listados nas instruções), summary (resumo objetivo do que aconteceu e próximos passos), stage_label (opcional, ex. "Agendamento confirmado"). Só chama após a etapa estar realmente concluída.`

export function notifyTeamWhatsAppToolDescription(config: AiAgentConfig): string {
    const c = config.team_notification_tool_description?.trim()
    return c || DEFAULT_TOOL_DESC
}

function truncate(s: string, max: number): string {
    const t = s.trim()
    if (t.length <= max) return t
    return `${t.slice(0, max - 1)}…`
}

function buildNotificationBody(args: {
    contactName: string
    contactPhone: string
    stageLabel: string | null
    summary: string
    transcript: string
    appendTranscript: boolean
}): string {
    const stage = args.stageLabel?.trim() || '—'
    const summary = truncate(args.summary, MAX_SUMMARY_CHARS)
    const header = [
        '🔔 Notificação do agente',
        `Etapa: ${stage}`,
        `Lead: ${args.contactName} (${args.contactPhone})`,
        '',
        'Resumo:',
        summary
    ].join('\n')

    if (!args.appendTranscript || !args.transcript.trim()) {
        return truncate(header, MAX_OUT_CHARS)
    }

    const tail = args.transcript.trim()
    const excerpt =
        tail.length > TRANSCRIPT_TAIL_CHARS
            ? `…\n${tail.slice(-TRANSCRIPT_TAIL_CHARS)}`
            : tail
    const block = `${header}\n\n---\nConversa (excerto recente):\n${excerpt}`
    return truncate(block, MAX_OUT_CHARS)
}

export async function executeNotifyTeamWhatsApp(args: {
    config: AiAgentConfig
    context: BuiltContext
    workspaceSlug: string
    instanceToken: string
    recipientPhoneRaw: string
    summary: string
    stageLabel: string | null | undefined
    sendOpts: WhatsAppSendOptions
}): Promise<string> {
    const allowlist = normalizedAllowlistPhones(args.config.team_notification_allowlist_phones)
    if (allowlist.length === 0) {
        return 'Erro: não há números autorizados configurados para notificações internas.'
    }

    const recipientNorm = normalizePhoneForBrazil(args.recipientPhoneRaw.trim())
    if (!recipientNorm) {
        return 'Erro: recipient_phone inválido. Usa um dos números autorizados (com DDI, ex. 5511999990000).'
    }

    if (!contactPhoneMatchesAllowlist(recipientNorm, allowlist)) {
        return 'Erro: este número não está na lista de destinatários autorizados. Só podes notificar números configurados no painel.'
    }

    if (contactPhoneMatchesAllowlist(args.context.contactPhone, [recipientNorm])) {
        return 'Erro: não podes enviar esta notificação para o próprio contacto/lead. Escolhe um número da equipa.'
    }

    const summary = args.summary.trim()
    if (!summary) {
        return 'Erro: o argumento summary é obrigatório (resumo da etapa concluída).'
    }

    const body = buildNotificationBody({
        contactName: args.context.contactName,
        contactPhone: args.context.contactPhone,
        stageLabel: args.stageLabel ?? null,
        summary,
        transcript: args.context.transcript,
        appendTranscript: args.config.team_notification_append_transcript !== false
    })

    try {
        const supabase = await createAdminClient()
        const { provider } = await getProviderForWorkspace(supabase, args.workspaceSlug)
        const sent = await provider.sendText(args.instanceToken, recipientNorm, body, args.sendOpts)
        return sent.messageId
            ? `Notificação enviada com sucesso (id: ${sent.messageId}).`
            : 'Notificação enviada com sucesso.'
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Falha ao enviar'
        return `Erro ao enviar WhatsApp: ${msg}`
    }
}

export function teamNotificationLayerOn(
    config: AiAgentConfig,
    meta?: { whatsappInstanceToken?: string }
): boolean {
    if (config.team_notification_enabled !== true) return false
    if (!meta?.whatsappInstanceToken?.trim()) return false
    return normalizedAllowlistPhones(config.team_notification_allowlist_phones).length > 0
}
