'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'
import type { MessageStatsPayload } from '@/lib/dashboard/message-stats'
import type { InstanceRow, MessageRow, WorkspaceRow } from '@/lib/dashboard/types'

export function useClientPortalState() {
    const router = useRouter()
    const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([])
    const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
    const [userEmail, setUserEmail] = useState<string | null>(null)
    const [instance, setInstance] = useState<InstanceRow>(null)
    const [messages, setMessages] = useState<MessageRow[]>([])
    const [stats, setStats] = useState<MessageStatsPayload | null>(null)
    const [statsLoadFailed, setStatsLoadFailed] = useState(false)
    const [statsDays, setStatsDays] = useState(7)
    const [loadError, setLoadError] = useState('')
    const [busy, setBusy] = useState(false)
    const [qrPayload, setQrPayload] = useState<{ qrcode?: string; pairingCode?: string } | null>(null)
    const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(null)

    const selectedWs = workspaces.find(w => w.slug === selectedSlug)

    const refreshWorkspaces = useCallback(async () => {
        const res = await fetch('/api/workspaces', { credentials: 'include' })
        if (!res.ok) {
            setLoadError('Não foi possível carregar o seu acesso.')
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

    const loadMessages = useCallback(async (slug: string) => {
        const res = await fetch(`/api/messages/recent?workspace_slug=${encodeURIComponent(slug)}&limit=12`, {
            credentials: 'include'
        })
        const json = (await res.json().catch(() => ({}))) as { error?: string; messages?: MessageRow[] }
        if (!res.ok) {
            setMessages([])
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

    useEffect(() => {
        loadMe()
        refreshWorkspaces()
    }, [loadMe, refreshWorkspaces])

    useEffect(() => {
        if (!selectedSlug) {
            setInstance(null)
            setMessages([])
            setStats(null)
            setStatsLoadFailed(false)
            return
        }
        setLoadError('')
        loadInstance(selectedSlug)
        loadMessages(selectedSlug)
        void loadStats(selectedSlug, statsDays)
    }, [selectedSlug, loadInstance, loadMessages, loadStats, statsDays])

    async function logout() {
        const sb = createBrowserSupabaseClient()
        await sb.auth.signOut()
        router.push('/login')
        router.refresh()
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
            setLoadError((j as { error?: string }).error || 'Não foi possível preparar a ligação.')
            setToast({ message: 'Falha ao preparar WhatsApp.', variant: 'error' })
            return
        }
        setToast({ message: 'Ligação preparada. Gera o QR Code para associar o telemóvel.', variant: 'success' })
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
            setLoadError((j as { error?: string }).error || 'Não foi possível obter o QR Code.')
            setToast({ message: 'Não foi possível obter o QR Code.', variant: 'error' })
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

    const qrSrc =
        qrPayload?.qrcode &&
        (qrPayload.qrcode.startsWith('data:') ? qrPayload.qrcode : `data:image/png;base64,${qrPayload.qrcode}`)

    return {
        workspaces,
        selectedSlug,
        setSelectedSlug,
        selectedWs,
        userEmail,
        instance,
        messages,
        stats,
        statsLoadFailed,
        statsDays,
        setStatsDays,
        loadError,
        setLoadError,
        busy,
        qrPayload,
        qrSrc,
        toast,
        setToast,
        refreshWorkspaces,
        loadInstance,
        loadMessages,
        loadStats,
        logout,
        provisionInstance,
        connectWhatsapp
    }
}

export type ClientPortalContextValue = ReturnType<typeof useClientPortalState>
