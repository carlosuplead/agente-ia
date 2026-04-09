'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'
import {
    followupStepsToUiRows,
    newFollowupStepRow,
    parseFollowupStepsFromConfig,
    type FollowupStepUi
} from '@/lib/ai-agent/followup-steps'
import type { AiConfigFieldErrors } from '@/lib/dashboard/validate-ai-config'
import { validateAiConfigForm } from '@/lib/dashboard/validate-ai-config'
import { AI_CONFIG_FALLBACK, normalizeAiConfig } from '@/lib/dashboard/ai-config'
import { buildAiConfigPostBody, snapshotAiConfigForm } from '@/lib/dashboard/ai-config-payload'
import type { MessageStatsPayload } from '@/lib/dashboard/message-stats'
import type { TokenUsagePayload } from '@/lib/dashboard/token-usage'
import { configToN8nUiRows, newN8nToolRow } from '@/lib/dashboard/n8n-ui'
import type {
    AiConfigRow,
    DashboardTab,
    GoogleCalendarPickerItem,
    GoogleCalendarStatus,
    InstanceRow,
    MessageRow,
    N8nToolUiRow,
    WorkspaceMembershipRow,
    WorkspaceRow
} from '@/lib/dashboard/types'

function applyAiConfigToForm(
    merged: AiConfigRow,
    setters: {
        setCfgEnabled: (v: boolean) => void
        setCfgProvider: (v: string) => void
        setCfgModel: (v: string) => void
        setCfgTemp: (v: number) => void
        setCfgMax: (v: number) => void
        setCfgPrompt: (v: string) => void
        setCfgContextMax: (v: number) => void
        setCfgWaExtra: (v: string) => void
        setCfgSendDelay: (v: number) => void
        setCfgSendPresence: (v: string) => void
        setCfgLabelTeam: (v: string) => void
        setCfgLabelAssistant: (v: string) => void
        setCfgBufferDelay: (v: number) => void
        setCfgGreeting: (v: string) => void
        setCfgN8nOn: (v: boolean) => void
        setCfgN8nTools: (v: N8nToolUiRow[]) => void
        setCfgInactivity: (v: number) => void
        setCfgFollowup: (v: boolean) => void
        setCfgFollowupSteps: (v: FollowupStepUi[]) => void
        setCfgFollowupPrompt: (v: string) => void
        setCfgElevenVoice: (v: boolean) => void
        setCfgElevenVoiceId: (v: string) => void
        setCfgElevenModelId: (v: string) => void
        setCfgElevenVoiceDesc: (v: string) => void
        setCfgOpenaiKeyInput: (v: string) => void
        setCfgGoogleKeyInput: (v: string) => void
        setCfgClearOpenaiKey: (v: boolean) => void
        setCfgClearGoogleKey: (v: boolean) => void
        setCfgChunkMessages: (v: boolean) => void
        setCfgChunkSplitMode: (v: string) => void
        setCfgChunkMaxParts: (v: number) => void
        setCfgTestMode: (v: boolean) => void
        setCfgTestAllowlist: (v: string) => void
        setCfgTeamNotify: (v: boolean) => void
        setCfgTeamNotifyAllowlist: (v: string) => void
        setCfgTeamNotifyDesc: (v: string) => void
        setCfgTeamNotifyAppendTranscript: (v: boolean) => void
        setCfgTeamNotifyTemplate: (v: string) => void
        setCfgAnthropicKeyInput: (v: string) => void
        setCfgClearAnthropicKey: (v: boolean) => void
        setCfgElevenApiKeyInput: (v: string) => void
        setCfgClearElevenApiKey: (v: boolean) => void
        setCfgFallbackProvider: (v: string | null) => void
    }
) {
    setters.setCfgEnabled(merged.enabled)
    setters.setCfgProvider(merged.provider)
    setters.setCfgModel(merged.model)
    setters.setCfgTemp(merged.temperature)
    setters.setCfgMax(merged.max_messages_per_conversation)
    setters.setCfgPrompt(merged.system_prompt)
    setters.setCfgContextMax(merged.context_max_messages ?? 20)
    setters.setCfgWaExtra(merged.whatsapp_formatting_extra ?? '')
    setters.setCfgSendDelay(merged.send_delay_ms ?? 1200)
    setters.setCfgSendPresence(merged.send_presence || 'composing')
    setters.setCfgLabelTeam(merged.label_team ?? 'Equipe')
    setters.setCfgLabelAssistant(merged.label_assistant ?? 'Assistente')
    setters.setCfgBufferDelay(merged.buffer_delay_seconds ?? 30)
    setters.setCfgGreeting(merged.greeting_message ?? '')
    setters.setCfgN8nOn(merged.n8n_webhook_enabled === true)
    setters.setCfgN8nTools(configToN8nUiRows(merged))
    setters.setCfgInactivity(merged.inactivity_timeout_hours ?? 24)
    setters.setCfgFollowup(merged.ai_followup_enabled === true)
    setters.setCfgFollowupSteps(
        followupStepsToUiRows(parseFollowupStepsFromConfig(merged as unknown as Record<string, unknown>))
    )
    setters.setCfgFollowupPrompt(merged.ai_followup_prompt ?? '')
    setters.setCfgElevenVoice(merged.elevenlabs_voice_enabled === true)
    setters.setCfgElevenVoiceId(merged.elevenlabs_voice_id ?? '')
    setters.setCfgElevenModelId(merged.elevenlabs_model_id ?? '')
    setters.setCfgElevenVoiceDesc(merged.elevenlabs_voice_tool_description ?? '')
    setters.setCfgOpenaiKeyInput('')
    setters.setCfgGoogleKeyInput('')
    setters.setCfgClearOpenaiKey(false)
    setters.setCfgClearGoogleKey(false)
    setters.setCfgAnthropicKeyInput('')
    setters.setCfgClearAnthropicKey(false)
    setters.setCfgElevenApiKeyInput('')
    setters.setCfgClearElevenApiKey(false)
    setters.setCfgFallbackProvider((merged as Record<string, unknown>).fallback_provider as string ?? null)
    setters.setCfgChunkMessages(merged.ai_chunk_messages_enabled === true)
    setters.setCfgChunkSplitMode(merged.ai_chunk_split_mode === 'lines' ? 'lines' : 'paragraph')
    setters.setCfgChunkMaxParts(
        typeof merged.ai_chunk_max_parts === 'number' && Number.isFinite(merged.ai_chunk_max_parts)
            ? merged.ai_chunk_max_parts
            : 8
    )
    setters.setCfgTestMode(merged.ai_test_mode === true)
    setters.setCfgTestAllowlist(merged.ai_test_allowlist_phones ?? '')
    setters.setCfgTeamNotify(merged.team_notification_enabled === true)
    setters.setCfgTeamNotifyAllowlist(merged.team_notification_allowlist_phones ?? '')
    setters.setCfgTeamNotifyDesc(merged.team_notification_tool_description ?? '')
    setters.setCfgTeamNotifyAppendTranscript(merged.team_notification_append_transcript !== false)
    setters.setCfgTeamNotifyTemplate(merged.team_notification_template ?? '')
}

export function useDashboardController() {
    const router = useRouter()
    const [activeTab, setActiveTabRaw] = useState<DashboardTab>(() => {
        if (typeof window === 'undefined') return 'workspaces'
        const sp = new URLSearchParams(window.location.search)
        const t = sp.get('tab') as DashboardTab | null
        const validTabs: DashboardTab[] = ['workspaces', 'connection', 'conversas', 'disparos', 'relatorios', 'atividade', 'config', 'workspace_settings']
        return t && validTabs.includes(t) ? t : 'workspaces'
    })
    const setActiveTab = useCallback((tab: DashboardTab) => {
        setActiveTabRaw(tab)
        if (typeof window !== 'undefined') {
            const u = new URL(window.location.href)
            if (tab === 'workspaces') {
                u.searchParams.delete('tab')
            } else {
                u.searchParams.set('tab', tab)
            }
            window.history.replaceState({}, '', u.toString())
        }
    }, [])
    const [mobileNavOpen, setMobileNavOpen] = useState(false)
    const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([])
    const [selectedSlug, setSelectedSlugRaw] = useState<string | null>(() => {
        if (typeof window === 'undefined') return null
        return new URLSearchParams(window.location.search).get('ws') || null
    })
    const setSelectedSlug = useCallback((slug: string | null) => {
        setSelectedSlugRaw(slug)
        if (typeof window !== 'undefined') {
            const u = new URL(window.location.href)
            if (slug) {
                u.searchParams.set('ws', slug)
            } else {
                u.searchParams.delete('ws')
            }
            window.history.replaceState({}, '', u.toString())
        }
    }, [])
    const selectedSlugRef = useRef(selectedSlug)
    selectedSlugRef.current = selectedSlug
    const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
    const [portalOnly, setPortalOnly] = useState(false)
    const [memberships, setMemberships] = useState<WorkspaceMembershipRow[]>([])
    const [userEmail, setUserEmail] = useState<string | null>(null)
    const [userDisplayName, setUserDisplayName] = useState<string | null>(null)
    const [instance, setInstance] = useState<InstanceRow>(null)
    const [aiConfig, setAiConfig] = useState<AiConfigRow | null>(null)
    const [messages, setMessages] = useState<MessageRow[]>([])
    const [stats, setStats] = useState<MessageStatsPayload | null>(null)
    const [statsLoadFailed, setStatsLoadFailed] = useState(false)
    const [statsDays, setStatsDays] = useState(7)
    const [tokenUsage, setTokenUsage] = useState<TokenUsagePayload | null>(null)
    const [tokenUsageLoadFailed, setTokenUsageLoadFailed] = useState(false)
    const [tokenUsageForbidden, setTokenUsageForbidden] = useState(false)
    const [tokenUsageDays, setTokenUsageDays] = useState(30)
    const [googleCalendar, setGoogleCalendar] = useState<GoogleCalendarStatus | null>(null)
    const [googleCalendarCalendars, setGoogleCalendarCalendars] = useState<GoogleCalendarPickerItem[] | null>(null)
    const [googleCalendarCalendarsLoading, setGoogleCalendarCalendarsLoading] = useState(false)
    const [googleCalendarCalendarsError, setGoogleCalendarCalendarsError] = useState<string | null>(null)
    const [oauthGoogleCalendarRedirect, setOauthGoogleCalendarRedirect] = useState<{
        workspace?: string
        tab?: string
        status: string
        error?: string
    } | null>(null)
    const [loadError, setLoadError] = useState('')
    const [busy, setBusy] = useState(false)
    const [showNewWs, setShowNewWs] = useState(false)
    const [newWsName, setNewWsName] = useState('')
    const [newWsSlug, setNewWsSlug] = useState('')
    const [qrPayload, setQrPayload] = useState<{ qrcode?: string; pairingCode?: string } | null>(null)
    const [metaPendingPhones, setMetaPendingPhones] = useState<
        Array<{ phone_number_id: string; display_phone_number?: string; verified_name?: string }>
    >([])
    const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(null)
    const [cfgFieldErrors, setCfgFieldErrors] = useState<AiConfigFieldErrors>({})
    const [baselineConfigSnapshot, setBaselineConfigSnapshot] = useState('')
    const loadedConfigSlugRef = useRef<string | null>(null)

    const [cfgEnabled, setCfgEnabled] = useState(true)
    const [cfgProvider, setCfgProvider] = useState('gemini')
    const [cfgModel, setCfgModel] = useState('gemini-2.5-flash')
    const [cfgTemp, setCfgTemp] = useState(0.7)
    const [cfgMax, setCfgMax] = useState(50)
    const [cfgPrompt, setCfgPrompt] = useState('')
    const [cfgContextMax, setCfgContextMax] = useState(20)
    const [cfgWaExtra, setCfgWaExtra] = useState('')
    const [cfgSendDelay, setCfgSendDelay] = useState(1200)
    const [cfgSendPresence, setCfgSendPresence] = useState('composing')
    const [cfgLabelTeam, setCfgLabelTeam] = useState('Equipe')
    const [cfgLabelAssistant, setCfgLabelAssistant] = useState('Assistente')
    const [cfgBufferDelay, setCfgBufferDelay] = useState(30)
    const [cfgGreeting, setCfgGreeting] = useState('')
    const [cfgN8nOn, setCfgN8nOn] = useState(false)
    const [cfgN8nTools, setCfgN8nTools] = useState<N8nToolUiRow[]>([])
    const [cfgInactivity, setCfgInactivity] = useState(24)
    const [cfgFollowup, setCfgFollowup] = useState(false)
    const [cfgFollowupSteps, setCfgFollowupSteps] = useState<FollowupStepUi[]>([])
    const [cfgFollowupPrompt, setCfgFollowupPrompt] = useState('')
    const [cfgElevenVoice, setCfgElevenVoice] = useState(false)
    const [cfgElevenVoiceId, setCfgElevenVoiceId] = useState('')
    const [cfgElevenModelId, setCfgElevenModelId] = useState('')
    const [cfgElevenVoiceDesc, setCfgElevenVoiceDesc] = useState('')
    const [cfgOpenaiKeyInput, setCfgOpenaiKeyInput] = useState('')
    const [cfgGoogleKeyInput, setCfgGoogleKeyInput] = useState('')
    const [cfgClearOpenaiKey, setCfgClearOpenaiKey] = useState(false)
    const [cfgClearGoogleKey, setCfgClearGoogleKey] = useState(false)
    const [cfgAnthropicKeyInput, setCfgAnthropicKeyInput] = useState('')
    const [cfgClearAnthropicKey, setCfgClearAnthropicKey] = useState(false)
    const [cfgElevenApiKeyInput, setCfgElevenApiKeyInput] = useState('')
    const [cfgClearElevenApiKey, setCfgClearElevenApiKey] = useState(false)
    const [cfgFallbackProvider, setCfgFallbackProvider] = useState<string | null>(null)
    const [cfgChunkMessages, setCfgChunkMessages] = useState(false)
    const [cfgChunkSplitMode, setCfgChunkSplitMode] = useState('paragraph')
    const [cfgChunkMaxParts, setCfgChunkMaxParts] = useState(8)
    const [cfgTestMode, setCfgTestMode] = useState(false)
    const [cfgTestAllowlist, setCfgTestAllowlist] = useState('')
    const [cfgTeamNotify, setCfgTeamNotify] = useState(false)
    const [cfgTeamNotifyAllowlist, setCfgTeamNotifyAllowlist] = useState('')
    const [cfgTeamNotifyDesc, setCfgTeamNotifyDesc] = useState('')
    const [cfgTeamNotifyAppendTranscript, setCfgTeamNotifyAppendTranscript] = useState(true)
    const [cfgTeamNotifyTemplate, setCfgTeamNotifyTemplate] = useState('')

    const selectedWs = workspaces.find(w => w.slug === selectedSlug)

    const showWorkspaceSettingsNav = useMemo(
        () => !portalOnly && isPlatformAdmin,
        [portalOnly, isPlatformAdmin]
    )

    /** Abrir definições (nome +/ou convites portal) — equipa interna. */
    const canManageWorkspaceSlug = useCallback(
        (slug: string | null) => {
            if (!slug) return false
            if (isPlatformAdmin) return true
            const m = memberships.find(x => x.workspace_slug === slug)
            return m?.role === 'owner' || m?.role === 'admin' || m?.role === 'member'
        },
        [isPlatformAdmin, memberships]
    )

    const canEditWorkspaceIdentity = useCallback(
        (slug: string | null) => {
            if (!slug) return false
            if (isPlatformAdmin) return true
            const m = memberships.find(x => x.workspace_slug === slug)
            return m?.role === 'owner' || m?.role === 'admin'
        },
        [isPlatformAdmin, memberships]
    )

    const canInvitePortalClients = useCallback(
        (slug: string | null) => {
            if (!slug) return false
            if (isPlatformAdmin) return true
            const m = memberships.find(x => x.workspace_slug === slug)
            return m?.role === 'owner' || m?.role === 'admin' || m?.role === 'member'
        },
        [isPlatformAdmin, memberships]
    )

    const canGoogleCalendarConnect = useMemo(() => {
        if (!selectedSlug) return false
        if (isPlatformAdmin) return true
        const m = memberships.find(x => x.workspace_slug === selectedSlug)
        return m?.role === 'owner' || m?.role === 'admin'
    }, [isPlatformAdmin, memberships, selectedSlug])

    const snapshotInput = useMemo(
        () => ({
            selectedSlug: selectedSlug || '',
            aiConfig,
            cfgEnabled,
            cfgProvider,
            cfgModel,
            cfgTemp,
            cfgMax,
            cfgPrompt,
            cfgContextMax,
            cfgWaExtra,
            cfgSendDelay,
            cfgSendPresence,
            cfgLabelTeam,
            cfgLabelAssistant,
            cfgBufferDelay,
            cfgGreeting,
            cfgN8nOn,
            cfgN8nTools,
            cfgInactivity,
            cfgFollowup,
            cfgFollowupSteps,
            cfgFollowupPrompt,
            cfgElevenVoice,
            cfgElevenVoiceId,
            cfgElevenModelId,
            cfgElevenVoiceDesc,
            cfgOpenaiKeyInput,
            cfgGoogleKeyInput,
            cfgClearOpenaiKey,
            cfgClearGoogleKey,
            cfgAnthropicKeyInput,
            cfgClearAnthropicKey,
            cfgElevenApiKeyInput,
            cfgClearElevenApiKey,
            cfgFallbackProvider,
            cfgChunkMessages,
            cfgChunkSplitMode,
            cfgChunkMaxParts,
            cfgTestMode,
            cfgTestAllowlist,
            cfgTeamNotify,
            cfgTeamNotifyAllowlist,
            cfgTeamNotifyDesc,
            cfgTeamNotifyAppendTranscript,
            cfgTeamNotifyTemplate
        }),
        [
            selectedSlug,
            aiConfig,
            cfgEnabled,
            cfgProvider,
            cfgModel,
            cfgTemp,
            cfgMax,
            cfgPrompt,
            cfgContextMax,
            cfgWaExtra,
            cfgSendDelay,
            cfgSendPresence,
            cfgLabelTeam,
            cfgLabelAssistant,
            cfgBufferDelay,
            cfgGreeting,
            cfgN8nOn,
            cfgN8nTools,
            cfgInactivity,
            cfgFollowup,
            cfgFollowupSteps,
            cfgFollowupPrompt,
            cfgElevenVoice,
            cfgElevenVoiceId,
            cfgElevenModelId,
            cfgElevenVoiceDesc,
            cfgOpenaiKeyInput,
            cfgGoogleKeyInput,
            cfgClearOpenaiKey,
            cfgClearGoogleKey,
            cfgAnthropicKeyInput,
            cfgClearAnthropicKey,
            cfgElevenApiKeyInput,
            cfgClearElevenApiKey,
            cfgFallbackProvider,
            cfgChunkMessages,
            cfgChunkSplitMode,
            cfgChunkMaxParts,
            cfgTestMode,
            cfgTestAllowlist,
            cfgTeamNotify,
            cfgTeamNotifyAllowlist,
            cfgTeamNotifyDesc,
            cfgTeamNotifyAppendTranscript,
            cfgTeamNotifyTemplate
        ]
    )

    const snapshotInputRef = useRef(snapshotInput)
    snapshotInputRef.current = snapshotInput

    const currentConfigSnapshot = useMemo(() => {
        if (!selectedSlug || !aiConfig) return ''
        return snapshotAiConfigForm(snapshotInput as Parameters<typeof snapshotAiConfigForm>[0])
    }, [snapshotInput, selectedSlug, aiConfig])

    const isConfigDirty =
        Boolean(selectedSlug && aiConfig && baselineConfigSnapshot) &&
        currentConfigSnapshot !== baselineConfigSnapshot

    useLayoutEffect(() => {
        if (!selectedSlug || !aiConfig) {
            setBaselineConfigSnapshot('')
            return
        }
        if (loadedConfigSlugRef.current !== selectedSlug) return
        setBaselineConfigSnapshot(
            snapshotAiConfigForm(snapshotInputRef.current as Parameters<typeof snapshotAiConfigForm>[0])
        )
    }, [aiConfig, selectedSlug])

    useEffect(() => {
        if (!isConfigDirty) return
        const fn = (e: BeforeUnloadEvent) => {
            e.preventDefault()
            e.returnValue = ''
        }
        window.addEventListener('beforeunload', fn)
        return () => window.removeEventListener('beforeunload', fn)
    }, [isConfigDirty])

    const closeMobileNav = useCallback(() => setMobileNavOpen(false), [])

    const confirmLeaveConfig = useCallback(() => {
        if (activeTab !== 'config' || !isConfigDirty) return true
        return window.confirm(
            'Tens alterações não guardadas na configuração do agente. Sair mesmo assim?'
        )
    }, [activeTab, isConfigDirty])

    const refreshWorkspaces = useCallback(async () => {
        const res = await fetch('/api/workspaces', { credentials: 'include' })
        if (!res.ok) {
            setLoadError('Não foi possível carregar workspaces')
            return
        }
        const json = await res.json()
        setWorkspaces(json.workspaces || [])
        setSelectedSlug(prev => {
            if (prev && json.workspaces?.some((w: WorkspaceRow) => w.slug === prev)) return prev
            return json.workspaces?.[0]?.slug ?? null
        })
    }, [])

    const loadMe = useCallback(async () => {
        const res = await fetch('/api/auth/me', { credentials: 'include' })
        if (!res.ok) return
        const json = await res.json()
        setIsPlatformAdmin(!!json.is_platform_admin)
        setPortalOnly(!!json.portal_only)
        setMemberships(
            Array.isArray(json.memberships)
                ? (json.memberships as WorkspaceMembershipRow[]).map((m: WorkspaceMembershipRow) => ({
                      workspace_slug: m.workspace_slug,
                      role: m.role
                  }))
                : []
        )
        setUserEmail(json.user?.email ?? null)
        setUserDisplayName(json.user?.full_name ?? null)
    }, [])

    const loadInstance = useCallback(async (slug: string, opts?: { syncUazapi?: boolean }) => {
        const params = new URLSearchParams({ workspace_slug: slug })
        if (opts?.syncUazapi) {
            params.set('sync_uazapi', '1')
        }
        const res = await fetch(`/api/whatsapp/instances?${params}`, { credentials: 'include' })
        if (!res.ok) {
            setInstance(null)
            return
        }
        const json = (await res.json()) as {
            instance?: InstanceRow | null
            uazapi_live?: { qrcode?: string; pairingCode?: string } | null
        }
        setInstance(json.instance ?? null)
        if (json.instance?.status === 'connected') {
            setQrPayload(null)
        } else if (json.uazapi_live?.qrcode || json.uazapi_live?.pairingCode) {
            setQrPayload({
                qrcode: json.uazapi_live.qrcode,
                pairingCode: json.uazapi_live.pairingCode
            })
        }
    }, [])

    const loadGoogleCalendar = useCallback(async (slug: string) => {
        const res = await fetch(`/api/workspace/google-calendar?workspace_slug=${encodeURIComponent(slug)}`, {
            credentials: 'include'
        })
        if (!res.ok) {
            setGoogleCalendar({
                oauth_configured: false,
                connected: false,
                account_email: null,
                calendar_id: null,
                default_timezone: null,
                updated_at: null
            })
            return
        }
        const j = (await res.json().catch(() => ({}))) as Record<string, unknown>
        const connected = !!j.connected
        setGoogleCalendar({
            oauth_configured: !!j.oauth_configured,
            connected,
            account_email: typeof j.account_email === 'string' ? j.account_email : null,
            calendar_id: typeof j.calendar_id === 'string' ? j.calendar_id : null,
            default_timezone: typeof j.default_timezone === 'string' ? j.default_timezone : null,
            updated_at: typeof j.updated_at === 'string' ? j.updated_at : null
        })
        if (!connected) {
            setGoogleCalendarCalendars(null)
            setGoogleCalendarCalendarsError(null)
        }
    }, [])

    const loadGoogleCalendarCalendars = useCallback(async (slug: string) => {
        setGoogleCalendarCalendarsLoading(true)
        setGoogleCalendarCalendarsError(null)
        const res = await fetch(
            `/api/workspace/google-calendar/calendars?workspace_slug=${encodeURIComponent(slug)}`,
            { credentials: 'include' }
        )
        const j = (await res.json().catch(() => ({}))) as {
            error?: string
            calendars?: GoogleCalendarPickerItem[]
        }
        setGoogleCalendarCalendarsLoading(false)
        if (!res.ok) {
            setGoogleCalendarCalendars([])
            setGoogleCalendarCalendarsError(j.error || 'Falha ao carregar agendas')
            return
        }
        setGoogleCalendarCalendars(Array.isArray(j.calendars) ? j.calendars : [])
    }, [])

    const updateGoogleCalendarId = useCallback(
        async (slug: string, calendar_id: string) => {
            setBusy(true)
            const res = await fetch('/api/workspace/google-calendar', {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workspace_slug: slug, calendar_id })
            })
            setBusy(false)
            const j = (await res.json().catch(() => ({}))) as { error?: string; calendar_id?: string }
            if (!res.ok) {
                setToast({
                    message: j.error || 'Falha ao guardar a agenda selecionada',
                    variant: 'error'
                })
                return false
            }
            setGoogleCalendar(prev =>
                prev
                    ? {
                          ...prev,
                          calendar_id: typeof j.calendar_id === 'string' ? j.calendar_id : calendar_id,
                          updated_at: new Date().toISOString()
                      }
                    : prev
            )
            setToast({ message: 'Agenda do agente atualizada.', variant: 'success' })
            return true
        },
        []
    )

    const setters = useMemo(
        () => ({
            setCfgEnabled,
            setCfgProvider,
            setCfgModel,
            setCfgTemp,
            setCfgMax,
            setCfgPrompt,
            setCfgContextMax,
            setCfgWaExtra,
            setCfgSendDelay,
            setCfgSendPresence,
            setCfgLabelTeam,
            setCfgLabelAssistant,
            setCfgBufferDelay,
            setCfgGreeting,
            setCfgN8nOn,
            setCfgN8nTools,
            setCfgInactivity,
            setCfgFollowup,
            setCfgFollowupSteps,
            setCfgFollowupPrompt,
            setCfgElevenVoice,
            setCfgElevenVoiceId,
            setCfgElevenModelId,
            setCfgElevenVoiceDesc,
            setCfgOpenaiKeyInput,
            setCfgGoogleKeyInput,
            setCfgClearOpenaiKey,
            setCfgClearGoogleKey,
            setCfgChunkMessages,
            setCfgChunkSplitMode,
            setCfgChunkMaxParts,
            setCfgTestMode,
            setCfgTestAllowlist,
            setCfgTeamNotify,
            setCfgTeamNotifyAllowlist,
            setCfgTeamNotifyDesc,
            setCfgTeamNotifyAppendTranscript,
            setCfgTeamNotifyTemplate,
            setCfgAnthropicKeyInput,
            setCfgClearAnthropicKey,
            setCfgElevenApiKeyInput,
            setCfgClearElevenApiKey,
            setCfgFallbackProvider
        }),
        []
    )

    const requestTab = useCallback(
        (tab: DashboardTab) => {
            if (tab === activeTab) {
                closeMobileNav()
                return
            }
            if (activeTab === 'config' && tab !== 'config' && isConfigDirty) {
                if (!confirmLeaveConfig()) return
                if (aiConfig) applyAiConfigToForm(aiConfig, setters)
                setCfgFieldErrors({})
            }
            setActiveTab(tab)
            closeMobileNav()
        },
        [activeTab, closeMobileNav, confirmLeaveConfig, isConfigDirty, aiConfig, setters]
    )

    const requestWorkspaceSlug = useCallback(
        (slug: string | null): boolean => {
            if (slug === selectedSlug) {
                closeMobileNav()
                return true
            }
            if (isConfigDirty) {
                if (
                    !window.confirm(
                        'Tens alterações não guardadas na configuração do agente. Mudar de workspace mesmo assim?'
                    )
                ) {
                    return false
                }
                if (aiConfig) applyAiConfigToForm(aiConfig, setters)
                setCfgFieldErrors({})
            }
            setSelectedSlug(slug)
            setLoadError('')
            closeMobileNav()
            return true
        },
        [selectedSlug, isConfigDirty, aiConfig, setters, closeMobileNav]
    )

    useEffect(() => {
        if (!oauthGoogleCalendarRedirect) return
        const { workspace, tab, status, error } = oauthGoogleCalendarRedirect
        setOauthGoogleCalendarRedirect(null)
        if (workspace) {
            void requestWorkspaceSlug(workspace)
        }
        if (tab === 'config') {
            void requestTab('config')
        }
        if (status === 'success') {
            setToast({ message: 'Google Agenda ligada ao workspace.', variant: 'success' })
            if (workspace) void loadGoogleCalendar(workspace)
        } else {
            setToast({ message: error || 'Não foi possível ligar a Google Agenda.', variant: 'error' })
        }
    }, [oauthGoogleCalendarRedirect, requestWorkspaceSlug, requestTab, loadGoogleCalendar])

    const loadAiConfig = useCallback(
        async (slug: string, signal?: AbortSignal) => {
            loadedConfigSlugRef.current = null
            const isAbortError = (e: unknown) =>
                (e instanceof DOMException && e.name === 'AbortError') ||
                (e instanceof Error && e.name === 'AbortError')

            const applyMerged = (merged: AiConfigRow) => {
                if (selectedSlugRef.current !== slug) return
                if (signal?.aborted) return
                loadedConfigSlugRef.current = slug
                setAiConfig(merged)
                try {
                    applyAiConfigToForm(merged, setters)
                } catch (formErr) {
                    console.error('applyAiConfigToForm', formErr)
                }
            }

            const inner = new AbortController()
            let timedOut = false
            /* Pedido prioritário + carga sequencial no dashboard (ver efeito do selectedSlug). */
            const tid = setTimeout(() => {
                timedOut = true
                inner.abort()
            }, 180_000)
            const onParentAbort = () => inner.abort()
            signal?.addEventListener('abort', onParentAbort, { once: true })

            try {
                const res = await fetch(`/api/ai/config?workspace_slug=${encodeURIComponent(slug)}`, {
                    credentials: 'include',
                    signal: inner.signal,
                    priority: 'high' as RequestPriority
                })
                clearTimeout(tid)
                signal?.removeEventListener('abort', onParentAbort)

                if (signal?.aborted) return
                const json = (await res.json().catch(() => ({}))) as {
                    error?: string
                    config?: AiConfigRow | null
                }

                if (!res.ok) {
                    const hint =
                        typeof json.error === 'string'
                            ? json.error
                            : 'Falha ao ler a config IA. Verifica DATABASE_URL no .env.local (password real do Postgres no Supabase, não o placeholder).'
                    setLoadError(hint)
                    applyMerged(AI_CONFIG_FALLBACK)
                    return
                }

                setLoadError('')
                const merged = normalizeAiConfig(json.config ?? undefined)
                applyMerged(merged)
            } catch (e) {
                clearTimeout(tid)
                signal?.removeEventListener('abort', onParentAbort)

                if (isAbortError(e)) {
                    if (signal?.aborted) return
                    if (timedOut && selectedSlugRef.current === slug) {
                        setLoadError(prev =>
                            prev ||
                            'O pedido da config IA excedeu o tempo limite (3 min). Se messages for grande, aplica a migração 20260328160000 (índice created_at) e/ou POSTGRES_STATEMENT_TIMEOUT_SEC no .env.local.'
                        )
                        loadedConfigSlugRef.current = slug
                        setAiConfig(AI_CONFIG_FALLBACK)
                        try {
                            applyAiConfigToForm(AI_CONFIG_FALLBACK, setters)
                        } catch {
                            /* ignore */
                        }
                    }
                    return
                }
                console.error('loadAiConfig', e)
                if (selectedSlugRef.current !== slug) return
                setLoadError(prev =>
                    prev ||
                    'Falha de rede ao ler a config IA. Verifica a ligação ou recarrega a página.'
                )
                loadedConfigSlugRef.current = slug
                setAiConfig(AI_CONFIG_FALLBACK)
                try {
                    applyAiConfigToForm(AI_CONFIG_FALLBACK, setters)
                } catch {
                    /* ignore */
                }
            }
        },
        [setters]
    )

    const loadMessages = useCallback(async (slug: string) => {
        const res = await fetch(`/api/messages/recent?workspace_slug=${encodeURIComponent(slug)}&limit=15`, {
            credentials: 'include'
        })
        const json = (await res.json().catch(() => ({}))) as { error?: string; messages?: MessageRow[] }
        if (!res.ok) {
            setMessages([])
            setLoadError(prev => {
                const msg =
                    typeof json.error === 'string'
                        ? json.error
                        : 'Não foi possível carregar mensagens (mesma causa que config IA: DATABASE_URL / Postgres).'
                return prev ? `${prev} — ${msg}` : msg
            })
            return
        }
        setMessages(json.messages || [])
    }, [])

    const loadStats = useCallback(async (slug: string, days: number) => {
        setStatsLoadFailed(false)
        const res = await fetch(
            `/api/messages/stats?workspace_slug=${encodeURIComponent(slug)}&days=${days}`,
            { credentials: 'include' }
        )
        const json = (await res.json().catch(() => ({}))) as { error?: string } & Partial<MessageStatsPayload>
        if (!res.ok || json.error || !json.totals || !json.previous_totals || !json.daily) {
            setStats(null)
            setStatsLoadFailed(true)
            return
        }
        setStatsLoadFailed(false)
        setStats({
            range_days: json.range_days ?? days,
            agent_enabled: json.agent_enabled ?? null,
            totals: json.totals,
            previous_totals: json.previous_totals,
            daily: json.daily
        })
    }, [])

    const loadTokenUsage = useCallback(async (slug: string, days: number) => {
        setTokenUsageLoadFailed(false)
        setTokenUsageForbidden(false)
        const res = await fetch(
            `/api/messages/token-stats?workspace_slug=${encodeURIComponent(slug)}&days=${days}`,
            { credentials: 'include' }
        )
        if (res.status === 403) {
            setTokenUsage(null)
            setTokenUsageForbidden(true)
            return
        }
        const json = (await res.json().catch(() => ({}))) as { error?: string } & Partial<TokenUsagePayload>
        if (!res.ok || json.error || json.grand_total_tokens === undefined || !Array.isArray(json.by_model)) {
            setTokenUsage(null)
            setTokenUsageLoadFailed(true)
            return
        }
        setTokenUsageLoadFailed(false)
        setTokenUsage({
            range_days: json.range_days ?? days,
            grand_total_tokens: json.grand_total_tokens,
            by_model: json.by_model ?? [],
            by_day: json.by_day ?? [],
            by_month: json.by_month ?? [],
            by_conversation: json.by_conversation ?? []
        })
    }, [])

    useEffect(() => {
        loadMe()
        refreshWorkspaces()
    }, [loadMe, refreshWorkspaces])

    useLayoutEffect(() => {
        if (typeof window === 'undefined') return
        const sp = new URLSearchParams(window.location.search)
        const st = sp.get('google_calendar_oauth')
        if (!st) return
        setOauthGoogleCalendarRedirect({
            workspace: sp.get('workspace') || undefined,
            tab: sp.get('tab') || undefined,
            status: st,
            error: sp.get('google_calendar_oauth_error') || undefined
        })
        const u = new URL(window.location.href)
        for (const k of ['google_calendar_oauth', 'google_calendar_oauth_error', 'workspace', 'tab']) {
            u.searchParams.delete(k)
        }
        const qs = u.searchParams.toString()
        window.history.replaceState({}, '', qs ? `${u.pathname}?${qs}` : u.pathname)
    }, [])

    useEffect(() => {
        if (!selectedSlug) {
            setInstance(null)
            setMessages([])
            setAiConfig(null)
            setStats(null)
            setStatsLoadFailed(false)
            setTokenUsage(null)
            setTokenUsageLoadFailed(false)
            setTokenUsageForbidden(false)
            setGoogleCalendar(null)
            setGoogleCalendarCalendars(null)
            setGoogleCalendarCalendarsError(null)
        }
    }, [selectedSlug])

    /**
     * Config IA primeiro (await), depois o resto — evita fila HTTP (~6 ligações) e contenção do pool
     * com recent/stats/token-stats a bloquear /api/ai/config.
     */
    useEffect(() => {
        if (!selectedSlug) return
        const slug = selectedSlug
        const rangeDays = statsDays
        const tokDays = tokenUsageDays
        setLoadError('')
        setAiConfig(null)
        setCfgFieldErrors({})
        setGoogleCalendarCalendars(null)
        setGoogleCalendarCalendarsError(null)
        const ac = new AbortController()
        let cancelled = false
        ;(async () => {
            await loadAiConfig(slug, ac.signal)
            if (cancelled || selectedSlugRef.current !== slug) return
            loadInstance(slug, { syncUazapi: true })
            loadMessages(slug)
            void loadMetaPendingPhones(slug)
            void loadGoogleCalendar(slug)
            void loadStats(slug, rangeDays)
            void loadTokenUsage(slug, tokDays)
        })()
        return () => {
            cancelled = true
            ac.abort()
        }
    }, [
        selectedSlug,
        loadInstance,
        loadAiConfig,
        loadMessages,
        loadGoogleCalendar,
        loadStats,
        loadTokenUsage
    ])

    /** Só mudança de intervalo — mudança de workspace trata loadStats no efeito do slug. */
    useEffect(() => {
        const slug = selectedSlugRef.current
        if (!slug) return
        void loadStats(slug, statsDays)
    }, [statsDays, loadStats])

    useEffect(() => {
        const slug = selectedSlugRef.current
        if (!slug) return
        void loadTokenUsage(slug, tokenUsageDays)
    }, [tokenUsageDays, loadTokenUsage])

    async function logout() {
        const sb = createBrowserSupabaseClient()
        await sb.auth.signOut()
        router.push('/login')
        router.refresh()
    }

    async function createWorkspace(e: React.FormEvent) {
        e.preventDefault()
        setBusy(true)
        setLoadError('')
        const res = await fetch('/api/workspaces', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newWsName, slug: newWsSlug })
        })
        setBusy(false)
        if (!res.ok) {
            const j = await res.json().catch(() => ({}))
            setLoadError((j as { error?: string }).error || 'Falha ao criar workspace')
            return
        }
        setShowNewWs(false)
        setNewWsName('')
        setNewWsSlug('')
        await refreshWorkspaces()
    }

    async function provisionInstance() {
        if (!selectedSlug) return
        setBusy(true)
        setLoadError('')
        const res = await fetch('/api/whatsapp/instances', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspace_slug: selectedSlug, display_name: selectedWs?.name })
        })
        setBusy(false)
        if (!res.ok) {
            const j = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
            if (res.status === 409) {
                await loadInstance(selectedSlug, { syncUazapi: true })
                setLoadError('')
                setToast({
                    message:
                        j.error ||
                        'Este workspace já tinha uma instância guardada. O estado foi atualizado — usa «Gerar QR Code» se ainda não estiver ligado, ou «Remover ligação Uazapi» para criar outra.',
                    variant: 'success'
                })
                return
            }
            setLoadError(j.error || 'Falha ao criar instância')
            return
        }
        await loadInstance(selectedSlug, { syncUazapi: true })
    }

    async function removeUazapiInstance() {
        if (!selectedSlug) return
        if (
            !window.confirm(
                'Isto apaga o registo desta instância no Agente Central e tenta remover na Uazapi. Depois podes criar uma instância nova. Continuar?'
            )
        ) {
            return
        }
        setBusy(true)
        setLoadError('')
        const res = await fetch(
            `/api/whatsapp/instances?workspace_slug=${encodeURIComponent(selectedSlug)}`,
            { method: 'DELETE', credentials: 'include' }
        )
        setBusy(false)
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) {
            setLoadError(j.error || 'Falha ao remover a instância')
            setToast({ message: j.error || 'Não foi possível remover.', variant: 'error' })
            return
        }
        setInstance(null)
        setQrPayload(null)
        setToast({ message: 'Ligação Uazapi removida. Podes criar uma instância nova.', variant: 'success' })
    }

    async function connectWhatsapp() {
        if (!selectedSlug) return
        setBusy(true)
        setQrPayload(null)
        const res = await fetch('/api/whatsapp/connect', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspace_slug: selectedSlug })
        })
        setBusy(false)
        const j = (await res.json().catch(() => ({}))) as {
            error?: string
            hint?: string
            code?: string
        }
        if (!res.ok) {
            const base = j.error || 'Falha ao pedir QR'
            setLoadError(j.hint ? `${base}\n\n${j.hint}` : base)
            return
        }
        if ((j as { qrcode?: string }).qrcode || (j as { pairingCode?: string }).pairingCode) {
            setQrPayload({
                qrcode: (j as { qrcode?: string }).qrcode,
                pairingCode: (j as { pairingCode?: string }).pairingCode
            })
        }
        // Atualiza estado em background — não bloqueia a exibição do QR
        loadInstance(selectedSlug, { syncUazapi: true }).catch(() => {})
    }

    async function refreshInstanceWithFeedback() {
        if (!selectedSlug) return
        setBusy(true)
        await loadInstance(selectedSlug, { syncUazapi: true })
        setBusy(false)
        setToast({ message: 'Estado atualizado', variant: 'success' })
    }

    function startMetaOfficialOAuth() {
        if (!selectedSlug) return
        window.location.href = `/api/auth/meta/whatsapp/start?workspace_slug=${encodeURIComponent(selectedSlug)}`
    }

    async function loadMetaPendingPhones(expectedSlug?: string | null) {
        const slug = expectedSlug ?? selectedSlug
        const res = await fetch('/api/whatsapp/meta/pending-phones', { credentials: 'include' })
        if (!res.ok) {
            setMetaPendingPhones([])
            return
        }
        const j = (await res.json().catch(() => ({}))) as {
            workspace_slug?: string
            phones?: Array<{ phone_number_id: string; display_phone_number?: string; verified_name?: string }>
        }
        if (!slug || j.workspace_slug !== slug) {
            setMetaPendingPhones([])
            return
        }
        setMetaPendingPhones(Array.isArray(j.phones) ? j.phones : [])
    }

    async function completeMetaPhonePick(phone_number_id: string) {
        const res = await fetch('/api/whatsapp/meta/complete-pick', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone_number_id })
        })
        if (!res.ok) {
            const j = await res.json().catch(() => ({}))
            setLoadError((j as { error?: string }).error || 'Falha ao concluir ligação oficial')
            return
        }
        setMetaPendingPhones([])
        if (selectedSlug) await loadInstance(selectedSlug, { syncUazapi: true })
    }

    function startGoogleCalendarOAuth() {
        if (!selectedSlug) return
        window.location.href = `/api/auth/google/calendar/start?workspace_slug=${encodeURIComponent(selectedSlug)}`
    }

    async function disconnectGoogleCalendar() {
        if (!selectedSlug) return
        setBusy(true)
        const res = await fetch('/api/workspace/google-calendar', {
            method: 'DELETE',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspace_slug: selectedSlug })
        })
        setBusy(false)
        if (!res.ok) {
            const j = await res.json().catch(() => ({}))
            setToast({ message: (j as { error?: string }).error || 'Falha ao desligar a Google Agenda', variant: 'error' })
            return
        }
        setToast({ message: 'Google Agenda desligada.', variant: 'success' })
        await loadGoogleCalendar(selectedSlug)
    }

    async function saveAiConfig() {
        if (!selectedSlug) return
        setCfgFieldErrors({})
        const v = validateAiConfigForm({
            cfgMax,
            cfgContextMax,
            cfgSendDelay,
            cfgBufferDelay,
            cfgInactivity,
            cfgModel,
            cfgN8nOn,
            cfgN8nTools,
            cfgFollowup,
            cfgFollowupSteps,
            cfgChunkMaxParts,
            cfgTestMode,
            cfgTestAllowlist,
            cfgTeamNotify,
            cfgTeamNotifyAllowlist
        })
        if (!v.ok) {
            setCfgFieldErrors(v.errors)
            setToast({ message: 'Corrige os campos assinalados antes de guardar.', variant: 'error' })
            return
        }

        setBusy(true)
        setLoadError('')
        const body = buildAiConfigPostBody(snapshotInput as Parameters<typeof buildAiConfigPostBody>[0])
        const res = await fetch('/api/ai/config', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
        setBusy(false)
        if (!res.ok) {
            const j = await res.json().catch(() => ({}))
            setLoadError((j as { error?: string }).error || 'Falha ao guardar')
            setToast({ message: 'Não foi possível guardar.', variant: 'error' })
            return
        }
        await loadAiConfig(selectedSlug)
        setToast({ message: 'Configuração guardada.', variant: 'success' })
    }

    const qrSrc =
        qrPayload?.qrcode &&
        (qrPayload.qrcode.startsWith('data:') ? qrPayload.qrcode : `data:image/png;base64,${qrPayload.qrcode}`)

    return {
        activeTab,
        requestTab,
        mobileNavOpen,
        setMobileNavOpen,
        closeMobileNav,
        workspaces,
        selectedSlug,
        requestWorkspaceSlug,
        setSelectedSlug: requestWorkspaceSlug,
        selectedWs,
        isPlatformAdmin,
        portalOnly,
        memberships,
        showWorkspaceSettingsNav,
        canManageWorkspaceSlug,
        canEditWorkspaceIdentity,
        canInvitePortalClients,
        userEmail,
        userDisplayName,
        instance,
        aiConfig,
        messages,
        stats,
        statsLoadFailed,
        statsDays,
        setStatsDays,
        loadStats,
        tokenUsage,
        tokenUsageLoadFailed,
        tokenUsageForbidden,
        tokenUsageDays,
        setTokenUsageDays,
        loadTokenUsage,
        loadError,
        setLoadError,
        googleCalendar,
        googleCalendarCalendars,
        googleCalendarCalendarsLoading,
        googleCalendarCalendarsError,
        loadGoogleCalendarCalendars,
        updateGoogleCalendarId,
        canGoogleCalendarConnect,
        startGoogleCalendarOAuth,
        disconnectGoogleCalendar,
        busy,
        showNewWs,
        setShowNewWs,
        newWsName,
        newWsSlug,
        setNewWsName,
        setNewWsSlug,
        qrPayload,
        qrSrc,
        toast,
        setToast,
        cfgFieldErrors,
        isConfigDirty,
        refreshWorkspaces,
        loadInstance,
        loadMessages,
        logout,
        createWorkspace,
        provisionInstance,
        removeUazapiInstance,
        connectWhatsapp,
        refreshInstanceWithFeedback,
        startMetaOfficialOAuth,
        metaPendingPhones,
        completeMetaPhonePick,
        saveAiConfig,
        cfgEnabled,
        setCfgEnabled,
        cfgProvider,
        setCfgProvider,
        cfgModel,
        setCfgModel,
        cfgTemp,
        setCfgTemp,
        cfgMax,
        setCfgMax,
        cfgPrompt,
        setCfgPrompt,
        cfgContextMax,
        setCfgContextMax,
        cfgWaExtra,
        setCfgWaExtra,
        cfgSendDelay,
        setCfgSendDelay,
        cfgSendPresence,
        setCfgSendPresence,
        cfgLabelTeam,
        setCfgLabelTeam,
        cfgLabelAssistant,
        setCfgLabelAssistant,
        cfgBufferDelay,
        setCfgBufferDelay,
        cfgGreeting,
        setCfgGreeting,
        cfgN8nOn,
        setCfgN8nOn,
        cfgN8nTools,
        setCfgN8nTools,
        cfgInactivity,
        setCfgInactivity,
        cfgFollowup,
        setCfgFollowup,
        cfgFollowupSteps,
        setCfgFollowupSteps,
        cfgFollowupPrompt,
        setCfgFollowupPrompt,
        cfgElevenVoice,
        setCfgElevenVoice,
        cfgElevenVoiceId,
        setCfgElevenVoiceId,
        cfgElevenModelId,
        setCfgElevenModelId,
        cfgElevenVoiceDesc,
        setCfgElevenVoiceDesc,
        cfgOpenaiKeyInput,
        setCfgOpenaiKeyInput,
        cfgGoogleKeyInput,
        setCfgGoogleKeyInput,
        cfgClearOpenaiKey,
        setCfgClearOpenaiKey,
        cfgClearGoogleKey,
        setCfgClearGoogleKey,
        cfgAnthropicKeyInput,
        setCfgAnthropicKeyInput,
        cfgClearAnthropicKey,
        setCfgClearAnthropicKey,
        cfgElevenApiKeyInput,
        setCfgElevenApiKeyInput,
        cfgClearElevenApiKey,
        setCfgClearElevenApiKey,
        cfgFallbackProvider,
        setCfgFallbackProvider,
        cfgChunkMessages,
        setCfgChunkMessages,
        cfgChunkSplitMode,
        setCfgChunkSplitMode,
        cfgChunkMaxParts,
        setCfgChunkMaxParts,
        cfgTestMode,
        setCfgTestMode,
        cfgTestAllowlist,
        setCfgTestAllowlist,
        cfgTeamNotify,
        setCfgTeamNotify,
        cfgTeamNotifyAllowlist,
        setCfgTeamNotifyAllowlist,
        cfgTeamNotifyDesc,
        setCfgTeamNotifyDesc,
        cfgTeamNotifyAppendTranscript,
        setCfgTeamNotifyAppendTranscript,
        cfgTeamNotifyTemplate,
        setCfgTeamNotifyTemplate,
        newN8nToolRow,
        newFollowupStepRow
    }
}

export type DashboardContextValue = ReturnType<typeof useDashboardController>
