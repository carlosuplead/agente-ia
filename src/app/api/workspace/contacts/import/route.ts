import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceRole } from '@/lib/auth/workspace-access'
import { getTenantSql, quotedSchema } from '@/lib/db/tenant-sql'
import * as XLSX from 'xlsx'

const MAX_ROWS = 5000
const MAX_ERRORS_RETURNED = 50

type ParsedRow = { phone: string; name: string; lineNum: number }

// Aliases conhecidos para auto-detect das colunas (case-insensitive, sem acentos).
const PHONE_ALIASES = [
    'phone', 'telefone', 'tel', 'celular', 'cel', 'numero', 'number',
    'whatsapp', 'whats', 'zap', 'fone', 'mobile', 'msisdn', 'contato'
]
const NAME_ALIASES = [
    'name', 'nome', 'cliente', 'lead', 'contato_nome', 'fullname',
    'full name', 'nome completo', 'razao social', 'razao_social'
]

function stripAccents(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}
function normalizeHeader(s: string): string {
    return stripAccents(String(s || '').trim().toLowerCase())
}

/** E.164-style: apenas dígitos com + opcional; 9–15 dígitos. */
function normalizePhone(raw: unknown): string | null {
    if (raw === null || raw === undefined) return null
    const s = String(raw).trim()
    if (!s) return null
    const digits = s.replace(/\D/g, '')
    if (digits.length < 9 || digits.length > 15) return null
    return `+${digits}`
}

/** Procura, na primeira linha, qual coluna é telefone e qual é nome. */
function detectColumns(firstRow: unknown[]): { phoneIdx: number; nameIdx: number; hasHeader: boolean } {
    const headers = firstRow.map(c => normalizeHeader(String(c ?? '')))
    let phoneIdx = -1
    let nameIdx = -1
    for (let i = 0; i < headers.length; i++) {
        const h = headers[i]
        if (phoneIdx < 0 && PHONE_ALIASES.some(a => h === a || h.includes(a))) phoneIdx = i
        if (nameIdx < 0 && NAME_ALIASES.some(a => h === a || h.includes(a))) nameIdx = i
    }
    if (phoneIdx >= 0) {
        return { phoneIdx, nameIdx: nameIdx >= 0 ? nameIdx : (phoneIdx === 0 ? 1 : 0), hasHeader: true }
    }
    // Sem header detectável — assumir [phone, name].
    return { phoneIdx: 0, nameIdx: 1, hasHeader: false }
}

function parseRows(rows: unknown[][]): ParsedRow[] {
    if (rows.length === 0) return []
    const { phoneIdx, nameIdx, hasHeader } = detectColumns(rows[0] as unknown[])
    const out: ParsedRow[] = []
    const startIdx = hasHeader ? 1 : 0
    for (let i = startIdx; i < rows.length; i++) {
        const row = rows[i]
        if (!Array.isArray(row) || row.length === 0) continue
        const phoneRaw = row[phoneIdx]
        const nameRaw = row[nameIdx]
        const phone = normalizePhone(phoneRaw)
        if (!phone) continue
        const name = String(nameRaw ?? '').trim().slice(0, 500) || 'Sem nome'
        out.push({ phone, name, lineNum: i + 1 })
    }
    return out
}

/** Lê CSV ou TSV em texto, devolve matriz de células. Tolera BOM, vírgula, ponto-e-vírgula e tab. */
function parseDelimited(text: string): unknown[][] {
    // Remove BOM (Excel BR salva CSV com BOM UTF-8)
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    const lines = text.split(/\r?\n/)
    // Detecta separador olhando para a primeira linha não vazia
    const firstNonEmpty = lines.find(l => l.trim().length > 0) || ''
    const semicolons = (firstNonEmpty.match(/;/g) || []).length
    const commas = (firstNonEmpty.match(/,/g) || []).length
    const tabs = (firstNonEmpty.match(/\t/g) || []).length
    const sep = tabs > Math.max(commas, semicolons) ? '\t' : (semicolons > commas ? ';' : ',')
    const rows: unknown[][] = []
    for (const line of lines) {
        if (!line.trim()) continue
        // Parser simples respeitando aspas
        const cells: string[] = []
        let cur = ''
        let inQuotes = false
        for (let i = 0; i < line.length; i++) {
            const ch = line[i]
            if (ch === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    cur += '"'; i++
                } else {
                    inQuotes = !inQuotes
                }
            } else if (ch === sep && !inQuotes) {
                cells.push(cur.trim()); cur = ''
            } else {
                cur += ch
            }
        }
        cells.push(cur.trim())
        rows.push(cells)
    }
    return rows
}

/** Lê XLSX/XLS de um buffer (primeira folha). */
function parseSpreadsheet(buf: Buffer): unknown[][] {
    const wb = XLSX.read(buf, { type: 'buffer' })
    const sheetName = wb.SheetNames[0]
    if (!sheetName) return []
    const sheet = wb.Sheets[sheetName]
    // raw:true mantém números originais (telefones gravados como Number no Excel
    // não viram notação científica). normalizePhone já faz String(...) para parsear.
    return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true })
}

function looksLikeXlsxFilename(name: string): boolean {
    return /\.(xlsx|xlsm|xls|ods)$/i.test(name)
}

export async function POST(request: Request) {
    try {
        const ct = request.headers.get('content-type') || ''
        let workspace_slug: string | undefined
        let rows: unknown[][] = []

        if (ct.includes('multipart/form-data')) {
            const form = await request.formData()
            workspace_slug = (form.get('workspace_slug') as string | null)?.trim()
            const file = form.get('file')
            if (!file || typeof (file as Blob).arrayBuffer !== 'function') {
                return NextResponse.json({ error: 'Ficheiro em falta (campo file)' }, { status: 400 })
            }
            const blob = file as File
            const filename = (blob as File).name || ''
            const buf = Buffer.from(await blob.arrayBuffer())
            const blobType = blob.type || ''
            const isXlsx =
                looksLikeXlsxFilename(filename) ||
                blobType.includes('spreadsheetml') ||
                blobType.includes('excel') ||
                blobType.includes('opendocument.spreadsheet')
            if (isXlsx) {
                rows = parseSpreadsheet(buf)
            } else {
                rows = parseDelimited(buf.toString('utf-8'))
            }
        } else {
            const body = (await request.json().catch(() => null)) as {
                workspace_slug?: string
                csv?: string
            } | null
            workspace_slug = body?.workspace_slug?.trim()
            const csvText = typeof body?.csv === 'string' ? body.csv : ''
            if (!csvText.trim()) return NextResponse.json({ error: 'Ficheiro vazio' }, { status: 400 })
            rows = parseDelimited(csvText)
        }

        if (!workspace_slug) {
            return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })
        }
        if (rows.length === 0) {
            return NextResponse.json({ error: 'Ficheiro vazio ou sem linhas legíveis' }, { status: 400 })
        }

        const supabase = await createClient()
        const access = await requireWorkspaceRole(supabase, workspace_slug, ['owner', 'admin'])
        if (!access.ok) return access.response

        const parsed = parseRows(rows)
        if (parsed.length === 0) {
            return NextResponse.json({
                error: 'Nenhuma linha válida com telefone. Verifica que tens uma coluna de telefone (Phone, Telefone, WhatsApp, Celular, Número) com 9–15 dígitos.'
            }, { status: 400 })
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
