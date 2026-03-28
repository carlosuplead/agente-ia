import type { AiConfigRow } from './types'

export const AI_CONFIG_FALLBACK: AiConfigRow = {
    enabled: true,
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    temperature: 0.7,
    system_prompt: 'Você é um assistente virtual. Seja cordial e objetivo.',
    max_messages_per_conversation: 50,
    context_max_messages: 20,
    human_handoff_enabled: true,
    transfer_tool_description: null,
    handoff_default_reply: null,
    whatsapp_formatting_extra: null,
    send_delay_ms: 1200,
    send_presence: 'composing',
    handoff_keywords: null,
    label_team: 'Equipe',
    label_assistant: 'Assistente',
    buffer_delay_seconds: 30,
    greeting_message: null,
    n8n_webhook_url: null,
    n8n_webhook_enabled: false,
    n8n_webhook_timeout_seconds: 30,
    n8n_tool_description: null,
    inactivity_timeout_hours: 24,
    ai_followup_enabled: false,
    ai_followup_steps: [],
    elevenlabs_voice_enabled: false,
    elevenlabs_voice_id: null,
    elevenlabs_model_id: null,
    elevenlabs_voice_tool_description: null,
    openai_api_key_set: false,
    google_api_key_set: false,
    ai_chunk_messages_enabled: false,
    ai_chunk_split_mode: 'paragraph',
    ai_chunk_max_parts: 8,
    ai_test_mode: false,
    ai_test_allowlist_phones: null,
    team_notification_enabled: false,
    team_notification_allowlist_phones: null,
    team_notification_tool_description: null,
    team_notification_append_transcript: true
}

export function normalizeAiConfig(c: Partial<AiConfigRow> | null | undefined): AiConfigRow {
    return { ...AI_CONFIG_FALLBACK, ...c }
}

/** Remove chaves secretas da linha da BD; expõe só flags para o browser. */
export function sanitizeAiConfigForClient(row: Record<string, unknown>): Record<string, unknown> {
    const openaiSet = typeof row.openai_api_key === 'string' && row.openai_api_key.length > 0
    const googleSet = typeof row.google_api_key === 'string' && row.google_api_key.length > 0
    const { openai_api_key: _o, google_api_key: _g, ...rest } = row
    return {
        ...rest,
        openai_api_key_set: openaiSet,
        google_api_key_set: googleSet
    }
}
