import type { AiAgentConfig } from './types'

/**
 * Extrai opções de envio (delay e presença) da configuração do agente.
 * Centralizado aqui para evitar duplicação em run-process, llm-router e followup-due.
 */
export function sendOptionsFromConfig(config: AiAgentConfig): { delayMs: number; presence: string | null } {
    const delayMs = config.send_delay_ms ?? 1200
    const p = config.send_presence
    if (p === undefined || p === null || String(p).trim() === '' || String(p).toLowerCase() === 'none') {
        return { delayMs, presence: null }
    }
    return { delayMs, presence: String(p) }
}
