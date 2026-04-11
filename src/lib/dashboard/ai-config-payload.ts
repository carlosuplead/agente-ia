import type { AiConfigRow, N8nToolUiRow } from './types'
import type { FollowupStepUi } from '@/lib/ai-agent/followup-steps'
import { normalizeAiConfig } from './ai-config'

export type AiConfigFormSnapshotInput = {
    selectedSlug: string
    aiConfig: AiConfigRow | null
    cfgEnabled: boolean
    cfgProvider: string
    cfgModel: string
    cfgTemp: number
    cfgMax: number
    cfgPrompt: string
    cfgContextMax: number
    cfgWaExtra: string
    cfgSendDelay: number
    cfgSendPresence: string
    cfgLabelTeam: string
    cfgLabelAssistant: string
    cfgBufferDelay: number
    cfgGreeting: string
    cfgN8nOn: boolean
    cfgN8nTools: N8nToolUiRow[]
    cfgInactivity: number
    cfgFollowup: boolean
    cfgFollowupSteps: FollowupStepUi[]
    cfgFollowupPrompt: string
    cfgElevenVoice: boolean
    cfgElevenVoiceId: string
    cfgElevenModelId: string
    cfgElevenVoiceDesc: string
    cfgOpenaiKeyInput: string
    cfgGoogleKeyInput: string
    cfgClearOpenaiKey: boolean
    cfgClearGoogleKey: boolean
    cfgAnthropicKeyInput: string
    cfgClearAnthropicKey: boolean
    cfgVertexProject: string
    cfgVertexLocation: string
    cfgVertexSaJson: string
    cfgElevenApiKeyInput: string
    cfgClearElevenApiKey: boolean
    cfgFallbackProvider: string | null
    cfgChunkMessages: boolean
    cfgChunkSplitMode: string
    cfgChunkMaxParts: number
    cfgTestMode: boolean
    cfgTestAllowlist: string
    cfgTeamNotify: boolean
    cfgTeamNotifyAllowlist: string
    cfgTeamNotifyDesc: string
    cfgTeamNotifyAppendTranscript: boolean
    cfgTeamNotifyTemplate: string
}

export function buildAiConfigPostBody(i: AiConfigFormSnapshotInput) {
    const handoffPersisted = normalizeAiConfig(i.aiConfig ?? undefined)
    const out: Record<string, unknown> = {
        workspace_slug: i.selectedSlug,
        enabled: i.cfgEnabled,
        provider: i.cfgProvider,
        model: i.cfgModel,
        temperature: i.cfgTemp,
        max_messages_per_conversation: i.cfgMax,
        system_prompt: i.cfgPrompt,
        context_max_messages: i.cfgContextMax,
        human_handoff_enabled: handoffPersisted.human_handoff_enabled !== false,
        transfer_tool_description: handoffPersisted.transfer_tool_description ?? null,
        handoff_default_reply: handoffPersisted.handoff_default_reply ?? null,
        whatsapp_formatting_extra: i.cfgWaExtra || null,
        send_delay_ms: i.cfgSendDelay,
        send_presence: i.cfgSendPresence,
        handoff_keywords: handoffPersisted.handoff_keywords ?? null,
        label_team: i.cfgLabelTeam,
        label_assistant: i.cfgLabelAssistant,
        buffer_delay_seconds: i.cfgBufferDelay,
        greeting_message: i.cfgGreeting || null,
        n8n_webhook_enabled: i.cfgN8nOn,
        n8n_tools: i.cfgN8nOn
            ? i.cfgN8nTools
                  .filter(t => t.url.trim())
                  .map(t => ({
                      slug: t.slug.trim(),
                      url: t.url.trim(),
                      timeout_seconds: t.timeout_seconds,
                      description: t.description.trim() || undefined
                  }))
            : [],
        inactivity_timeout_hours: i.cfgInactivity,
        ai_followup_enabled: i.cfgFollowup,
        ai_followup_prompt: i.cfgFollowupPrompt?.trim() || null,
        ai_followup_steps: i.cfgFollowup
            ? i.cfgFollowupSteps
                  .filter(r => r.message.trim())
                  .map(r => ({
                      amount: r.amount,
                      unit: r.unit,
                      message: r.message.trim()
                  }))
            : [],
        elevenlabs_voice_enabled: i.cfgElevenVoice,
        elevenlabs_voice_id: i.cfgElevenVoiceId.trim() || null,
        elevenlabs_model_id: i.cfgElevenModelId.trim() || null,
        elevenlabs_voice_tool_description: i.cfgElevenVoiceDesc.trim() || null,
        ai_chunk_messages_enabled: i.cfgChunkMessages,
        ai_chunk_split_mode: i.cfgChunkSplitMode,
        ai_chunk_max_parts: i.cfgChunkMaxParts,
        ai_test_mode: i.cfgTestMode,
        ai_test_allowlist_phones: i.cfgTestAllowlist.trim() || null,
        team_notification_enabled: i.cfgTeamNotify,
        team_notification_allowlist_phones: i.cfgTeamNotifyAllowlist.trim() || null,
        team_notification_tool_description: i.cfgTeamNotifyDesc.trim() || null,
        team_notification_append_transcript: i.cfgTeamNotifyAppendTranscript,
        team_notification_template: i.cfgTeamNotifyTemplate?.trim() || null
    }
    if (i.cfgClearOpenaiKey) {
        out.openai_api_key = null
    } else if (i.cfgOpenaiKeyInput.trim()) {
        out.openai_api_key = i.cfgOpenaiKeyInput.trim()
    }
    if (i.cfgClearGoogleKey) {
        out.google_api_key = null
    } else if (i.cfgGoogleKeyInput.trim()) {
        out.google_api_key = i.cfgGoogleKeyInput.trim()
    }
    if (i.cfgClearAnthropicKey) {
        out.anthropic_api_key = null
    } else if (i.cfgAnthropicKeyInput.trim()) {
        out.anthropic_api_key = i.cfgAnthropicKeyInput.trim()
    }
    if (i.cfgClearElevenApiKey) {
        out.elevenlabs_api_key = null
    } else if (i.cfgElevenApiKeyInput.trim()) {
        out.elevenlabs_api_key = i.cfgElevenApiKeyInput.trim()
    }
    // Vertex AI
    out.google_vertex_project = i.cfgVertexProject?.trim() || null
    out.google_vertex_location = i.cfgVertexLocation?.trim() || null
    if (i.cfgVertexSaJson?.trim()) {
        out.google_service_account_json = i.cfgVertexSaJson.trim()
    }
    out.fallback_provider = i.cfgFallbackProvider || null
    return out
}

export function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value)
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`
    }
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

export function snapshotAiConfigForm(i: AiConfigFormSnapshotInput): string {
    return stableStringify(buildAiConfigPostBody(i))
}
