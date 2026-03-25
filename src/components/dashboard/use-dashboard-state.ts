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
    setters.setCfgElevenVoice(merged.elevenlabs_voice_enabled === true)
    setters.setCfgElevenVoiceId(merged.elevenlabs_voice_id ?? '')
    setters.setCfgElevenModelId(merged.elevenlabs_model_id ?? '')
    setters.setCfgElevenVoiceDesc(merged.elevenlabs_voice_tool_description ?? '')
    setters.setCfgOpenaiKeyInput('')
    setters.setCfgGoogleKeyInput('')
    setters.setCfgClearOpenaiKey(false)
    setters.setCfgClearGoogleKey(false)
    setters.setCfgChunkMessages(merged.ai_chunk_messages_enabled === true)
    setters.setCfgChunkSplitMode(merged.ai_chunk_split_mode === 'lines' ? 'lines' : 'paragraph')
    setters.setCfgChunkMaxParts(
        typeof merged.ai_chunk_max_parts === 'number' && Number.isFinite(merged.ai_chunk_max_parts)
            ? merged.ai_chunk_max_parts
            : 8
    )
}

export function useDashboardController() {
    const router = useRouter()
    const [activeTab, setActiveTab] = useState<DashboardTab>('workspaces')
    const [mobileNavOpen, setMobileNavOpen] = useState(false)
    const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([])
    const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
    const selectedSlugRef = useRef(selectedSlug)
    selectedSlugRef.current = selectedSlug
    const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
    const [portalOnly, setPortalOnly] = useState(false)
    const [memberships, setMemberships] = useState<WorkspaceMembershipRow[]>([])
    const [userEmail, setUserEmail] = useState<string | null>(null)
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
    const [loadError, setLoadError] = useState('')
    const [busy, setBusy] = useState(false)
    const [showNewWs, setShowNewWs] = useState(false)
    const [newWsName, setNewWsName] = useState('')
    const [newWsSlug, setNewWsSlug] = useState('')
    const [qrPayload, setQrPayload] = useState<{ qrcode?: string; pairingCode?: string } | null>(null)
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
    const [cfgElevenVoice, setCfgElevenVoice] = useState(false)
    const [cfgElevenVoiceId, setCfgElevenVoiceId] = useState('')
    const [cfgElevenModelId, setCfgElevenModelId] = useState('')
    const [cfgElevenVoiceDesc, setCfgElevenVoiceDesc] = useState('')
    const [cfgOpenaiKeyInput, setCfgOpenaiKeyInput] = useState('')
    const [cfgGoogleKeyInput, setCfgGoogleKeyInput] = useState('')
    const [cfgClearOpenaiKey, setCfgClearOpenaiKey] = useState(false)
    const [cfgClearGoogleKey, setCfgClearGoogleKey] = useState(false)
    const [cfgChunkMessages, setCfgChunkMessages] = useState(false)
    const [cfgChunkSplitMode, setCfgChunkSplitMode] = useState('paragraph')
    const [cfgChunkMaxParts, setCfgChunkMaxParts] = useState(8)

    const selectedWs = workspaces.find(w => w.slug === selectedSlug)

    const showWorkspaceSettingsNav = useMemo(
        () =>
            !portalOnly &&
            (isPlatformAdmin ||
                memberships.some(m =>
                    ['owner', 'admin', 'member'].includes(m.role)
                )),
        [portalOnly, isPlatformAdmin, memberships]
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
            cfgElevenVoice,
            cfgElevenVoiceId,
            cfgElevenModelId,
            cfgElevenVoiceDesc,
            cfgOpenaiKeyInput,
            cfgGoogleKeyInput,
            cfgClearOpenaiKey,
            cfgClearGoogleKey,
            cfgChunkMessages,
            cfgChunkSplitMode,
            cfgChunkMaxParts
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
            cfgElevenVoice,
            cfgElevenVoiceId,
            cfgElevenModelId,
            cfgElevenVoiceDesc,
            cfgOpenaiKeyInput,
            cfgGoogleKeyInput,
            cfgClearOpenaiKey,
            cfgClearGoogleKey,
            cfgChunkMessages,
            cfgChunkSplitMode,
            cfgChunkMaxParts
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
    }, [])

    const loadInstance = useCallback(async (slug: string) => {
        const res = await fetch(`/api/whatsapp/instances?workspace_slug=${encodeURIComponent(slug)}`, {
            credentials: 'include'
        })
        if (!res.ok) {
            setInstance(null)
            return
        }
        const json = await res.json()
        setInstance(json.instance ?? null)
    }, [])

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
            setCfgChunkMaxParts
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
            closeMobileNav()
            return true
        },
        [selectedSlug, isConfigDirty, aiConfig, setters, closeMobileNav]
    )

    const loadAiConfig = useCallback(
        async (slug: string) => {
            loadedConfigSlugRef.current = null
            const res = await fetch(`/api/ai/config?workspace_slug=${encodeURIComponent(slug)}`, {
                credentials: 'include'
            })
            const json = (await res.json().catch(() => ({}))) as { error?: string; config?: AiConfigRow | null }

            const applyMerged = (merged: AiConfigRow) => {
                if (selectedSlugRef.current !== slug) return
                loadedConfigSlugRef.current = slug
                setAiConfig(merged)
                applyAiConfigToForm(merged, setters)
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
            return
        }
        setLoadError('')
        setAiConfig(null)
        setCfgFieldErrors({})
        loadInstance(selectedSlug)
        loadMessages(selectedSlug)
        void loadAiConfig(selectedSlug)
        void loadStats(selectedSlug, statsDays)
        void loadTokenUsage(selectedSlug, tokenUsageDays)
    }, [
        selectedSlug,
        statsDays,
        tokenUsageDays,
        loadInstance,
        loadAiConfig,
        loadMessages,
        loadStats,
        loadTokenUsage
    ])

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
            const j = await res.json().catch(() => ({}))
            setLoadError((j as { error?: string }).error || 'Falha ao criar instância')
            return
        }
        await loadInstance(selectedSlug)
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
        const j = await res.json().catch(() => ({}))
        if (!res.ok) {
            setLoadError((j as { error?: string }).error || 'Falha ao pedir QR')
            return
        }
        if ((j as { qrcode?: string }).qrcode || (j as { pairingCode?: string }).pairingCode) {
            setQrPayload({
                qrcode: (j as { qrcode?: string }).qrcode,
                pairingCode: (j as { pairingCode?: string }).pairingCode
            })
        }
        await loadInstance(selectedSlug)
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
            cfgChunkMaxParts
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
        connectWhatsapp,
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
        cfgChunkMessages,
        setCfgChunkMessages,
        cfgChunkSplitMode,
        setCfgChunkSplitMode,
        cfgChunkMaxParts,
        setCfgChunkMaxParts,
        newN8nToolRow,
        newFollowupStepRow
    }
}

export type DashboardContextValue = ReturnType<typeof useDashboardController>
