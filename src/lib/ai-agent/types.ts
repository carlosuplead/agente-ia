export type AiAgentConfig = {
    id: string
    workspace_id: string
    enabled: boolean
    provider: 'gemini' | 'openai'
    model: string
    temperature: number
    system_prompt: string
    max_messages_per_conversation: number
}

export type LLMResponse = {
    text: string
    shouldHandoff: boolean
    handoffReason?: string
}

export type BuiltContext = {
    contactId: string
    contactName: string
    contactPhone: string
    transcript: string
}
