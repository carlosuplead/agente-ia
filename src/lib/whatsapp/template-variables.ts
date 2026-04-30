import type { TemplateMessageComponent } from '@/lib/meta/templates'

/**
 * Substitui placeholders do tipo `{{var:nome_coluna}}` em todos os parâmetros
 * de texto dos componentes de um template Meta, usando os campos extras do
 * contacto + nome/telefone como fallback.
 *
 * Exemplo:
 *   components = [{ type:'body', parameters:[{ type:'text', text:'{{var:nome}}' }] }]
 *   contact = { name:'Maria', phone:'+5521987654321', extra_fields:{ pedido:'4521' } }
 *   → [{ type:'body', parameters:[{ type:'text', text:'Maria' }] }]
 *
 * Variáveis especiais reservadas:
 *   - {{var:nome}}     → contact.name (se não estiver em extra_fields)
 *   - {{var:telefone}} → contact.phone (se não estiver em extra_fields)
 *
 * Se a variável não for encontrada, é substituída por string vazia (em vez
 * de manter o `{{var:xxx}}` literal, que enviaria lixo ao cliente).
 */
export function applyVariablesToComponents(
    components: TemplateMessageComponent[],
    contact: { name?: string | null; phone?: string | null; extra_fields?: Record<string, unknown> | null }
): TemplateMessageComponent[] {
    const extras = (contact.extra_fields || {}) as Record<string, unknown>
    const fallbacks: Record<string, string> = {
        nome: String(contact.name || '').trim(),
        name: String(contact.name || '').trim(),
        telefone: String(contact.phone || '').trim(),
        phone: String(contact.phone || '').trim()
    }

    function lookup(key: string): string {
        const k = key.trim().toLowerCase()
        if (k in extras) {
            const v = extras[k]
            if (v === null || v === undefined) return ''
            return String(v)
        }
        if (k in fallbacks) return fallbacks[k]
        return ''
    }

    function substitute(text: string): string {
        return text.replace(/\{\{\s*var\s*:\s*([a-zA-Z0-9_-]+)\s*\}\}/gi, (_m, key: string) => lookup(key))
    }

    function processComponent(c: TemplateMessageComponent): TemplateMessageComponent {
        if (!c || typeof c !== 'object') return c
        const cloned: TemplateMessageComponent = JSON.parse(JSON.stringify(c))
        const params = (cloned as { parameters?: unknown }).parameters
        if (!Array.isArray(params)) return cloned
        for (const p of params as Array<Record<string, unknown>>) {
            if (p && typeof p === 'object' && typeof p.text === 'string') {
                p.text = substitute(p.text)
            }
        }
        return cloned
    }

    return components.map(processComponent)
}

/**
 * Devolve a lista de chaves usadas dentro dos placeholders `{{var:xxx}}` num
 * conjunto de components. Útil para a UI mostrar quais variáveis o template
 * está a usar e validar que existem no CSV importado.
 */
export function extractVariableKeys(components: TemplateMessageComponent[]): string[] {
    const found = new Set<string>()
    const rx = /\{\{\s*var\s*:\s*([a-zA-Z0-9_-]+)\s*\}\}/gi
    function walk(value: unknown) {
        if (typeof value === 'string') {
            for (const m of value.matchAll(rx)) found.add(m[1].trim().toLowerCase())
        } else if (Array.isArray(value)) {
            for (const v of value) walk(v)
        } else if (value && typeof value === 'object') {
            for (const v of Object.values(value as Record<string, unknown>)) walk(v)
        }
    }
    walk(components)
    return Array.from(found).sort()
}
