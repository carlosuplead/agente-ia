import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceRole } from '@/lib/auth/workspace-access'
import { getTenantSql, quotedSchema } from '@/lib/db/tenant-sql'

const MAX_ROWS = 5000
const MAX_ERRORS_RETURNED = 50

function parseCsvLines(text: string): { phone: string; name: string; lineNum: number }[] {
    const lines = text.split(/\r?\n/)
    const out: { phone: string; name: string; lineNum: number }[] = []
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue
        const lineNum = i + 1
        const parts = line.split(/[,;]/).map(p => p.replace(/^\s*"|"\s*$/g, '').trim())
        const phoneRaw = parts[0] || ''
        if (/^phone$/i.test(phoneRaw) || /^telefone$/i.test(phoneRaw) || /^tel$/i.test(phoneRaw)) {
            continue
        }
        const name = (parts[1] || 'Sem nome').slice(0, 500)
        if (!phoneRaw) continue
        const phone = normalizePhone(phoneRaw)
        if (phone) out.push({ phone, name, lineNum })
    }
    return out
}

/** E.164-style: apenas dígitos com + opcional; 9–15 dígitos. */
function normalizePhone(raw: string): string | null {
    const s = raw.trim().replace(/\s/g, '')
    const digits = s.replace(/\D/g, '')
    if (digits.length < 9 || digits.length > 15) return null
    return `+${digits}`
}

export async function POST(request: Request) {
    try {
        const ct = request.headers.get('content-type') || ''
        let workspace_slug: string | undefined
        let csvText: string

        if (ct.includes('multipart/form-data')) {
            const form = await request.formData()
            workspace_slug = (form.get('workspace_slug') as string | null)?.trim()
            const file = form.get('file')
            if (!file || typeof (file as Blob).arrayBuffer !== 'function') {
                return NextResponse.json({ error: 'Ficheiro CSV em falta (campo file)' }, { status: 400 })
            }
            const buf = Buffer.from(await (file as Blob).arrayBuffer())
            csvText = buf.toString('utf-8')
        } else {
            const body = (await request.json().catch(() => null)) as {
                workspace_slug?: string
                csv?: string
            } | null
            workspace_slug = body?.workspace_slug?.trim()
            csvText = typeof body?.csv === 'string' ? body.csv : ''
        }

        if (!workspace_slug) {
            return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })
        }
        if (!csvText.trim()) {
            return NextResponse.json({ error: 'CSV vazio' }, { status: 400 })
        }

        const supabase = await createClient()
        const access = await requireWorkspaceRole(supabase, workspace_slug, ['owner', 'admin'])
        if (!access.ok) return access.response

        const parsed = parseCsvLines(csvText)
        if (parsed.length === 0) {
            return NextResponse.json({ error: 'Nenhuma linha válida com telefone' }, { status: 400 })
        }
        if (parsed.length > MAX_ROWS) {
            return NextResponse.json(
                { error: `Máximo de ${MAX_ROWS} linhas por importação` },
                { status: 400 }
            )
        }

        const sql = getTenantSql()
        const sch = quotedSchema(workspace_slug)
        let upserted = 0
        const errors: string[] = []
        const seen = new Set<string>()

        for (const row of parsed) {
            if (seen.has(row.phone)) {
                if (errors.length < MAX_ERRORS_RETURNED) {
                    errors.push(`Linha ${row.lineNum}: telefone duplicado no ficheiro (${row.phone})`)
                }
                continue
            }
            seen.add(row.phone)

            try {
                await sql.unsafe(
                    `INSERT INTO ${sch}.contacts (phone, name) VALUES ($1, $2)
                     ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()`,
                    [row.phone, row.name]
                )
                upserted++
            } catch (e) {
                if (errors.length < MAX_ERRORS_RETURNED) {
                    const msg = e instanceof Error ? e.message : String(e)
                    errors.push(`Linha ${row.lineNum}: ${msg}`)
                }
            }
        }

        return NextResponse.json({
            upserted,
            skipped_duplicates_in_file: parsed.length - seen.size,
            errors,
            total_processed: seen.size
        })
    } catch (e) {
        console.error('workspace contacts import POST', e)
        const msg = e instanceof Error ? e.message : 'Internal Server Error'
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
