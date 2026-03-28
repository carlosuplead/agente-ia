import { listMessageTemplates } from '@/lib/meta/templates'

function normalizeLang(code: string): string {
    return code.trim().replace(/-/g, '_').toLowerCase()
}

export async function assertTemplateApproved(
    wabaId: string,
    accessToken: string,
    templateName: string,
    languageCode: string
): Promise<void> {
    const wantLang = normalizeLang(languageCode)
    const list = await listMessageTemplates(wabaId, accessToken)
    const hit = list.find(
        t =>
            t.name === templateName &&
            normalizeLang(t.language || '') === wantLang &&
            String(t.status || '').toUpperCase() === 'APPROVED'
    )
    if (!hit) {
        throw new Error(
            'Nenhum template APPROVED encontrado com este nome e idioma. Cria e aprova o template na Meta Business Suite.'
        )
    }
}
