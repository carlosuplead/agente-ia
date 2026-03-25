export type TokenUsageByModelRow = {
    provider: string
    model: string
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
}

export type TokenUsageByDayRow = {
    date: string
    total_tokens: number
    by_model: Record<string, number>
}

export type TokenUsageByMonthRow = {
    month: string
    total_tokens: number
    by_model: Record<string, number>
}

export type TokenUsageByConversationRow = {
    ai_conversation_id: string
    contact_name: string
    contact_phone: string
    total_tokens: number
    last_activity_at: string
}

export type TokenUsagePayload = {
    range_days: number
    grand_total_tokens: number
    by_model: TokenUsageByModelRow[]
    by_day: TokenUsageByDayRow[]
    by_month: TokenUsageByMonthRow[]
    by_conversation: TokenUsageByConversationRow[]
}
