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

    const [userName, setUserName] = useState<string | null>(null)

    const loadMe = useCallback(async () => {
        const res = await fetch('/api/auth/me', { credentials: 'include' })
        if (!res.ok) return
        const json = await res.json()
        setUserEmail(json.user?.email ?? null)
        setUserName(json.user?.full_name ?? null)
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
        loadInstance(selectedSlug, { syncUazapi: true })
        loadMessages(selectedSlug)
        void loadStats(selectedSlug, statsDays)
    }, [selectedSlug, loadInstance, loadMessages, loadStats, statsDays])

    useEffect(() => {
        if (!selectedSlug || !instance || instance.provider === 'official') return
        if (instance.status !== 'connecting') return
        const slug = selectedSlug
        const id = window.setInterval(() => {
            void loadInstance(slug, { syncUazapi: true })
        }, 4000)
        return () => window.clearInterval(id)
    }, [selectedSlug, instance?.provider, instance?.status, loadInstance])

    async function logout() {
        const sb = createBrowserSupabaseClient()
        await sb.auth.signOut()
        router.push('/login')
        router.refresh()
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
        await loadInstance(selectedSlug, { syncUazapi: true })
    }

    const qrSrc =
        qrPayload?.qrcode &&
        (qrPayload.qrcode.startsWith('data:') ? qrPayload.qrcode : `data:image/png;base64,${qrPayload.qrcode}`)

    async function updateProfile(newName: string): Promise<boolean> {
        setBusy(true)
        try {
            const res = await fetch('/api/auth/me', {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ full_name: newName })
            })
            if (!res.ok) {
                const j = (await res.json().catch(() => ({}))) as { error?: string }
                setToast({ message: j.error || 'Falha ao atualizar perfil.', variant: 'error' })
                return false
            }
            setUserName(newName)
            setToast({ message: 'Nome atualizado.', variant: 'success' })
            return true
        } catch {
            setToast({ message: 'Erro ao atualizar perfil.', variant: 'error' })
            return false
        } finally {
            setBusy(false)
        }
    }

    async function changePassword(currentPassword: string, newPassword: string): Promise<boolean> {
        setBusy(true)
        try {
            const res = await fetch('/api/auth/password', {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
            })
            const j = (await res.json().catch(() => ({}))) as { error?: string }
            if (!res.ok) {
                setToast({ message: j.error || 'Falha ao alterar senha.', variant: 'error' })
                return false
            }
            setToast({ message: 'Senha alterada com sucesso.', variant: 'success' })
            return true
        } catch {
            setToast({ message: 'Erro ao alterar senha.', variant: 'error' })
            return false
        } finally {
            setBusy(false)
        }
    }

    return {
        workspaces,
        selectedSlug,
        setSelectedSlug,
        selectedWs,
        userEmail,
        userName,
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
        connectWhatsapp,
        updateProfile,
        changePassword
    }
}

export type ClientPortalContextValue = ReturnType<typeof useClientPortalState>
