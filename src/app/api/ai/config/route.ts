import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceInternal } from '@/lib/auth/workspace-access'
import { getTenantSql, quotedSchema } from '@/lib/db/tenant-sql'
import { defaultN8nToolDescription, normalizeToolNameFromUi } from '@/lib/ai-agent/n8n-tools'
import { parseFollowupStepsFromBody } from '@/lib/ai-agent/followup-steps'
import { sanitizeAiConfigForClient } from '@/lib/dashboard/ai-config'
import { hasValidAllowlistEntry } from '@/lib/ai-agent/test-mode-allowlist'
import { encryptWorkspaceLlmKeyIfConfigured } from '@/lib/crypto/workspace-llm-keys'

type N8nToolRow = {
    tool_name: string
    url: string
    timeout_seconds: number
    description: string
}

function parseN8nToolsBody(
    body: Record<string, unknown>,
    n8nOn: boolean
): N8nToolRow[] {
    const raw = body.n8n_tools
    let rows: unknown[] = []
    if (Array.isArray(raw)) rows = raw

    const out: N8nToolRow[] = []
    const seen = new Set<string>()

    for (let i = 0; i < rows.length && out.length < 20; i++) {
        const row = rows[i]
        if (!row || typeof row !== 'object') continue
        const o = row as Record<string, unknown>
        const url = String(o.url || '').trim()
        if (!url) continue
        const slugRaw = String(o.slug ?? o.tool_name ?? '').trim()
        const tool_name = normalizeToolNameFromUi(slugRaw, out.length)
        if (seen.has(tool_name)) continue
        seen.add(tool_name)
        const to = Number(o.timeout_seconds)
        const timeout = Number.isFinite(to) ? Math.min(120, Math.max(5, Math.floor(to))) : 30
        const desc = String(o.description || '').trim() || defaultN8nToolDescription()
        out.push({ tool_name, url, timeout_seconds: timeout, description: desc })
    }

    const trimOrNull = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
    if (out.length === 0 && n8nOn) {
        const legacyUrl = trimOrNull(body.n8n_webhook_url)
        if (legacyUrl) {
            const rawN8t = Number(body.n8n_webhook_timeout_seconds)
            const timeout = Number.isFinite(rawN8t) ? Math.min(120, Math.max(5, Math.floor(rawN8t))) : 30
            const desc = trimOrNull(body.n8n_tool_description) || defaultN8nToolDescription()
            out.push({
                tool_name: 'call_n8n_webhook',
                url: legacyUrl,
                timeout_seconds: timeout,
                description: desc
            })
        }
    }

    return out
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url)
        const workspaceSlug = searchParams.get('workspace_slug')

        if (!workspaceSlug) {
            return NextResponse.json({ error: 'workspace_slug is required' }, { status: 400 })
        }

        const supabase = await createClient()
        const access = await requireWorkspaceInternal(supabase, workspaceSlug)
        if (!access.ok) return access.response

        const sql = getTenantSql()
        const sch = quotedSchema(workspaceSlug)
        const rows = await sql.unsafe(`SELECT * FROM ${sch}.ai_agent_config LIMIT 1`, [])
        const raw = rows[0] as Record<string, unknown> | undefined
        const config = raw ? sanitizeAiConfigForClient(raw) : null

        return NextResponse.json({ config })
    } catch (e) {
        console.error('ai config GET', e)
        const msg = e instanceof Error ? e.message : 'Internal Server Error'
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}

export async function POST(request: Request) {
    try {
        const body = (await request.json()) as Record<string, unknown>
        const {
            workspace_slug,
            enabled,
            provider,
            model,
            temperature,
            system_prompt,
            max_messages_per_conversation,
            context_max_messages,
            human_handoff_enabled,
            transfer_tool_description,
            handoff_default_reply,
            whatsapp_formatting_extra,
            send_delay_ms,
            send_presence,
            handoff_keywords,
            label_team,
            label_assistant,
            buffer_delay_seconds,
            greeting_message,
            n8n_webhook_enabled,
            inactivity_timeout_hours,
            ai_followup_enabled,
            elevenlabs_voice_enabled,
            elevenlabs_voice_id,
            elevenlabs_model_id,
            elevenlabs_voice_tool_description,
            ai_chunk_messages_enabled,
            ai_chunk_split_mode,
            ai_chunk_max_parts,
            ai_test_mode,
            ai_test_allowlist_phones,
            team_notification_enabled,
            team_notification_allowlist_phones,
            team_notification_tool_description,
            team_notification_append_transcript,
            team_notification_template
        } = body

        if (
            typeof workspace_slug !== 'string' ||
            !workspace_slug.trim() ||
            typeof system_prompt !== 'string' ||
            !system_prompt.trim()
        ) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        const supabase = await createClient()
        const access = await requireWorkspaceInternal(supabase, workspace_slug)
        if (!access.ok) return access.response

        const sql = getTenantSql()
        const sch = quotedSchema(workspace_slug)

        const en = typeof enabled === 'boolean' ? enabled : true
        const prov = typeof provider === 'string' && provider.trim() ? provider.trim() : 'gemini'
        const mod = typeof model === 'string' && model.trim() ? model.trim() : 'gemini-2.5-flash'
        const temp =
            typeof temperature === 'number' && Number.isFinite(temperature) ? temperature : 0.7
        const maxMsg =
            typeof max_messages_per_conversation === 'number' && Number.isFinite(max_messages_per_conversation)
                ? max_messages_per_conversation
                : 50

        const rawCtx = Number(context_max_messages)
        const ctxMax = Number.isFinite(rawCtx) ? Math.min(100, Math.max(1, Math.floor(rawCtx))) : 20
        const handoffEn = human_handoff_enabled !== false
        const trimOrNull = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
        const transferDesc = trimOrNull(transfer_tool_description)
        const handoffReply = trimOrNull(handoff_default_reply)
        const waExtra = trimOrNull(whatsapp_formatting_extra)
        const keywords = trimOrNull(handoff_keywords)
        const rawDelay = Number(send_delay_ms)
        const delayMs = Number.isFinite(rawDelay) ? Math.min(120_000, Math.max(0, Math.floor(rawDelay))) : 1200
        const presenceRaw = typeof send_presence === 'string' && send_presence.trim() ? send_presence.trim() : 'composing'
        const team = typeof label_team === 'string' && label_team.trim() ? label_team.trim() : 'Equipe'
        const assistant = typeof label_assistant === 'string' && label_assistant.trim() ? label_assistant.trim() : 'Assistente'

        const rawBuf = Number(buffer_delay_seconds)
        const bufSec = Number.isFinite(rawBuf) ? Math.min(120, Math.max(5, Math.floor(rawBuf))) : 30
        const greet = trimOrNull(greeting_message)
        const n8nOn = n8n_webhook_enabled === true
        const n8nToolsClean = n8nOn ? parseN8nToolsBody(body, true) : []
        const first = n8nToolsClean[0]
        const n8nUrl = first?.url ?? null
        const n8nTimeout = first?.timeout_seconds ?? 30
        const n8nDesc = first?.description ?? null
        const rawInact = Number(inactivity_timeout_hours)
        const inactH = Number.isFinite(rawInact) ? Math.min(720, Math.max(1, Math.floor(rawInact))) : 24
        const followOn = ai_followup_enabled === true
        const elevenVoiceOn = elevenlabs_voice_enabled === true
        const elevenVoiceId = trimOrNull(elevenlabs_voice_id)
        const elevenModelId = trimOrNull(elevenlabs_model_id)
        const elevenVoiceDesc = trimOrNull(elevenlabs_voice_tool_description)
        const chunkMsgOn = ai_chunk_messages_enabled === true
        const chunkModeRaw =
            typeof ai_chunk_split_mode === 'string' && ai_chunk_split_mode.trim()
                ? ai_chunk_split_mode.trim()
                : 'paragraph'
        const chunkMode = chunkModeRaw === 'lines' ? 'lines' : 'paragraph'
        const rawChunkMax = Number(ai_chunk_max_parts)
        const chunkMaxParts = Number.isFinite(rawChunkMax)
            ? Math.min(20, Math.max(1, Math.floor(rawChunkMax)))
            : 8
        const followSteps = parseFollowupStepsFromBody(body, followOn)
        if (followOn && followSteps.length === 0) {
            return NextResponse.json(
                { error: 'Follow-up ativo: adiciona pelo menos um passo com mensagem.' },
                { status: 400 }
            )
        }
        const followStepsJson = JSON.stringify(followSteps)

        const n8nToolsJson = JSON.stringify(n8nToolsClean)

        const testModeOn = ai_test_mode === true
        const allowlistText =
            typeof ai_test_allowlist_phones === 'string' ? ai_test_allowlist_phones.trim() : ''
        const allowlistStore = allowlistText ? allowlistText : null
        if (testModeOn && !hasValidAllowlistEntry(allowlistText)) {
            return NextResponse.json(
                {
                    error:
                        'Modo testes ativo: indica pelo menos um número válido na allowlist (um por linha ou separados por vírgula).'
                },
                { status: 400 }
            )
        }

        const teamNotifyOn = team_notification_enabled === true
        const teamAllowText =
            typeof team_notification_allowlist_phones === 'string'
                ? team_notification_allowlist_phones.trim()
                : ''
        const teamAllowStore = teamAllowText ? teamAllowText : null
        if (teamNotifyOn && !hasValidAllowlistEntry(teamAllowText)) {
            return NextResponse.json(
                {
                    error:
                        'Notificações à equipa ativas: indica pelo menos um número válido na lista de destinatários.'
                },
                { status: 400 }
            )
        }
        const teamNotifyDesc = trimOrNull(team_notification_tool_description)
        const teamAppendTranscript = team_notification_append_transcript !== false
        const teamTemplate = trimOrNull(team_notification_template)

        const rows = await sql.unsafe(
            `INSERT INTO ${sch}.ai_agent_config (
               singleton_key, enabled, provider, model, temperature, system_prompt, max_messages_per_conversation,
               context_max_messages, human_handoff_enabled, transfer_tool_description, handoff_default_reply,
               whatsapp_formatting_extra, send_delay_ms, send_presence, handoff_keywords, label_team, label_assistant,
               buffer_delay_seconds, greeting_message, n8n_webhook_url, n8n_webhook_enabled, n8n_webhook_timeout_seconds,
               n8n_tool_description, inactivity_timeout_hours, ai_followup_enabled, ai_followup_steps, n8n_tools,
               elevenlabs_voice_enabled, elevenlabs_voice_id, elevenlabs_model_id, elevenlabs_voice_tool_description,
               ai_chunk_messages_enabled, ai_chunk_split_mode, ai_chunk_max_parts,
               ai_test_mode, ai_test_allowlist_phones,
               team_notification_enabled, team_notification_allowlist_phones,
               team_notification_tool_description, team_notification_append_transcript,
               team_notification_template,
               updated_at
             )
             VALUES (true, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25::jsonb, $26::jsonb, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, now())
             ON CONFLICT (singleton_key) DO UPDATE SET
               enabled = EXCLUDED.enabled,
               provider = EXCLUDED.provider,
               model = EXCLUDED.model,
               temperature = EXCLUDED.temperature,
               system_prompt = EXCLUDED.system_prompt,
               max_messages_per_conversation = EXCLUDED.max_messages_per_conversation,
               context_max_messages = EXCLUDED.context_max_messages,
               human_handoff_enabled = EXCLUDED.human_handoff_enabled,
               transfer_tool_description = EXCLUDED.transfer_tool_description,
               handoff_default_reply = EXCLUDED.handoff_default_reply,
               whatsapp_formatting_extra = EXCLUDED.whatsapp_formatting_extra,
               send_delay_ms = EXCLUDED.send_delay_ms,
               send_presence = EXCLUDED.send_presence,
               handoff_keywords = EXCLUDED.handoff_keywords,
               label_team = EXCLUDED.label_team,
               label_assistant = EXCLUDED.label_assistant,
               buffer_delay_seconds = EXCLUDED.buffer_delay_seconds,
               greeting_message = EXCLUDED.greeting_message,
               n8n_webhook_url = EXCLUDED.n8n_webhook_url,
               n8n_webhook_enabled = EXCLUDED.n8n_webhook_enabled,
               n8n_webhook_timeout_seconds = EXCLUDED.n8n_webhook_timeout_seconds,
               n8n_tool_description = EXCLUDED.n8n_tool_description,
               inactivity_timeout_hours = EXCLUDED.inactivity_timeout_hours,
               ai_followup_enabled = EXCLUDED.ai_followup_enabled,
               ai_followup_steps = EXCLUDED.ai_followup_steps,
               n8n_tools = EXCLUDED.n8n_tools,
               elevenlabs_voice_enabled = EXCLUDED.elevenlabs_voice_enabled,
               elevenlabs_voice_id = EXCLUDED.elevenlabs_voice_id,
               elevenlabs_model_id = EXCLUDED.elevenlabs_model_id,
               elevenlabs_voice_tool_description = EXCLUDED.elevenlabs_voice_tool_description,
               ai_chunk_messages_enabled = EXCLUDED.ai_chunk_messages_enabled,
               ai_chunk_split_mode = EXCLUDED.ai_chunk_split_mode,
               ai_chunk_max_parts = EXCLUDED.ai_chunk_max_parts,
               ai_test_mode = EXCLUDED.ai_test_mode,
               ai_test_allowlist_phones = EXCLUDED.ai_test_allowlist_phones,
               team_notification_enabled = EXCLUDED.team_notification_enabled,
               team_notification_allowlist_phones = EXCLUDED.team_notification_allowlist_phones,
               team_notification_tool_description = EXCLUDED.team_notification_tool_description,
               team_notification_append_transcript = EXCLUDED.team_notification_append_transcript,
               team_notification_template = EXCLUDED.team_notification_template,
               updated_at = now()
             RETURNING *`,
            [
                en,
                prov,
                mod,
                temp,
                system_prompt.trim(),
                maxMsg,
                ctxMax,
                handoffEn,
                transferDesc,
                handoffReply,
                waExtra,
                delayMs,
                presenceRaw,
                keywords,
                team,
                assistant,
                bufSec,
                greet,
                n8nUrl,
                n8nOn,
                n8nTimeout,
                n8nDesc,
                inactH,
                followOn,
                followStepsJson,
                n8nToolsJson,
                elevenVoiceOn,
                elevenVoiceId,
                elevenModelId,
                elevenVoiceDesc,
                chunkMsgOn,
                chunkMode,
                chunkMaxParts,
                testModeOn,
                allowlistStore,
                teamNotifyOn,
                teamAllowStore,
                teamNotifyDesc,
                teamAppendTranscript,
                teamTemplate
            ]
        )

        const updated = rows[0] as Record<string, unknown> | undefined
        if (!updated) {
            return NextResponse.json({ error: 'Failed to update configuration' }, { status: 500 })
        }

        if ('openai_api_key' in body) {
            const v = body.openai_api_key
            if (v === null) {
                await sql.unsafe(
                    `UPDATE ${sch}.ai_agent_config SET openai_api_key = NULL, updated_at = now() WHERE singleton_key = true`,
                    []
                )
            } else if (typeof v === 'string' && v.trim()) {
                const stored = encryptWorkspaceLlmKeyIfConfigured(v.trim())
                await sql.unsafe(
                    `UPDATE ${sch}.ai_agent_config SET openai_api_key = $1, updated_at = now() WHERE singleton_key = true`,
                    [stored]
                )
            }
        }
        if ('google_api_key' in body) {
            const v = body.google_api_key
            if (v === null) {
                await sql.unsafe(
                    `UPDATE ${sch}.ai_agent_config SET google_api_key = NULL, updated_at = now() WHERE singleton_key = true`,
                    []
                )
            } else if (typeof v === 'string' && v.trim()) {
                const stored = encryptWorkspaceLlmKeyIfConfigured(v.trim())
                await sql.unsafe(
                    `UPDATE ${sch}.ai_agent_config SET google_api_key = $1, updated_at = now() WHERE singleton_key = true`,
                    [stored]
                )
            }
        }
        if ('anthropic_api_key' in body) {
            const v = body.anthropic_api_key
            if (v === null) {
                await sql.unsafe(
                    `UPDATE ${sch}.ai_agent_config SET anthropic_api_key = NULL, updated_at = now() WHERE singleton_key = true`,
                    []
                )
            } else if (typeof v === 'string' && v.trim()) {
                const stored = encryptWorkspaceLlmKeyIfConfigured(v.trim())
                await sql.unsafe(
                    `UPDATE ${sch}.ai_agent_config SET anthropic_api_key = $1, updated_at = now() WHERE singleton_key = true`,
                    [stored]
                )
            }
        }
        if ('elevenlabs_api_key' in body) {
            const v = body.elevenlabs_api_key
            if (v === null) {
                await sql.unsafe(
                    `UPDATE ${sch}.ai_agent_config SET elevenlabs_api_key = NULL, updated_at = now() WHERE singleton_key = true`,
                    []
                )
            } else if (typeof v === 'string' && v.trim()) {
                const stored = encryptWorkspaceLlmKeyIfConfigured(v.trim())
                await sql.unsafe(
                    `UPDATE ${sch}.ai_agent_config SET elevenlabs_api_key = $1, updated_at = now() WHERE singleton_key = true`,
                    [stored]
                )
            }
        }

        const finalRows = await sql.unsafe(`SELECT * FROM ${sch}.ai_agent_config LIMIT 1`, [])
        const finalRaw = finalRows[0] as Record<string, unknown> | undefined
        const config = finalRaw ? sanitizeAiConfigForClient(finalRaw) : sanitizeAiConfigForClient(updated)

        return NextResponse.json({ success: true, config })
    } catch (e) {
        console.error('ai config POST', e)
        const msg = e instanceof Error ? e.message : 'Internal Server Error'
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
