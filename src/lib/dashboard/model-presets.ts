/**
 * IDs alinhados à documentação oficial (texto + function calling).
 * Gemini: https://ai.google.dev/gemini-api/docs/models/gemini
 * OpenAI: https://platform.openai.com/docs/models
 *
 * gemini-2.0-* está em descontinuação (ver deprecations Google); mantido para migração.
 */
export const GEMINI_MODEL_PRESETS = [
    'gemini-3.1-pro-preview',
    'gemini-3.1-pro-preview-customtools',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite-preview',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-1.5-pro'
] as const

export const OPENAI_MODEL_PRESETS = [
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.4-nano',
    'gpt-5.2',
    'gpt-5',
    'gpt-5-mini',
    'gpt-5-nano',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'o3',
    'o4-mini',
    'o3-mini',
    'o1',
    'o1-mini'
] as const

export const MODEL_CUSTOM = '__custom__' as const

export function presetsForProvider(provider: string): readonly string[] {
    return provider === 'openai' ? OPENAI_MODEL_PRESETS : GEMINI_MODEL_PRESETS
}

export function modelSelectValue(cfgProvider: string, cfgModel: string): string {
    const list = presetsForProvider(cfgProvider) as readonly string[]
    return list.includes(cfgModel) ? cfgModel : MODEL_CUSTOM
}
