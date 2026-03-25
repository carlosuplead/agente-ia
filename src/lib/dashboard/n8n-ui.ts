import { parseN8nToolsFromConfig } from '@/lib/ai-agent/n8n-tools'
import type { AiConfigRow, N8nToolUiRow } from './types'

export function newN8nToolRow(): N8nToolUiRow {
    return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        slug: '',
        url: '',
        timeout_seconds: 30,
        description: ''
    }
}

function n8nToolNameToUiSlug(toolName: string): string {
    if (toolName === 'call_n8n_webhook') return 'call_n8n_webhook'
    if (toolName.startsWith('n8n_')) return toolName.slice(4)
    return toolName
}

export function configToN8nUiRows(merged: AiConfigRow): N8nToolUiRow[] {
    const defs = parseN8nToolsFromConfig(merged as unknown as Record<string, unknown>)
    return defs.map((d, i) => ({
        id: `loaded-${i}-${d.tool_name}`,
        slug: n8nToolNameToUiSlug(d.tool_name),
        url: d.url,
        timeout_seconds: d.timeout_seconds,
        description: d.description
    }))
}
