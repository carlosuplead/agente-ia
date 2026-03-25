export type MessageStatsDaily = { date: string; ai: number; contact: number; team: number }

export type MessageStatsPayload = {
    range_days: number
    agent_enabled: boolean | null
    totals: {
        ai_messages: number
        contact_messages: number
        team_messages: number
        unique_contacts: number
    }
    previous_totals: {
        ai_messages: number
        contact_messages: number
    }
    daily: MessageStatsDaily[]
}
