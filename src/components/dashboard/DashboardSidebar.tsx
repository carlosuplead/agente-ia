'use client'

import type { DashboardTab } from '@/lib/dashboard/types'
import { useDashboard } from './dashboard-context'
import {
    LayoutGrid,
    MessageCircle,
    MessageSquare,
    Megaphone,
    BarChart3,
    Bot,
    Settings,
    Zap,
    Sun,
    Moon,
    Shield,
    LogOut
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState, useEffect } from 'react'

const baseTabs: { id: DashboardTab; label: string; icon: LucideIcon }[] = [
    { id: 'workspaces', label: 'Workspaces', icon: LayoutGrid },
    { id: 'connection', label: 'WhatsApp', icon: MessageCircle },
    { id: 'conversas', label: 'Conversas', icon: MessageSquare },
    { id: 'disparos', label: 'Disparos', icon: Megaphone },
    { id: 'relatorios', label: 'Relatorios', icon: BarChart3 },
    { id: 'config', label: 'Agente IA', icon: Bot }
]

const settingsTab: { id: DashboardTab; label: string; icon: LucideIcon } = {
    id: 'workspace_settings',
    label: 'Definições',
    icon: Settings
}

export function DashboardSidebar() {
    const d = useDashboard()
    const [theme, setTheme] = useState<'dark' | 'light'>('dark')

    useEffect(() => {
        const saved = localStorage.getItem('theme') as 'dark' | 'light' | null
        if (saved) {
            setTheme(saved)
            document.documentElement.setAttribute('data-theme', saved)
        }
    }, [])

    function toggleTheme() {
        const next = theme === 'dark' ? 'light' : 'dark'
        setTheme(next)
        localStorage.setItem('theme', next)
        document.documentElement.setAttribute('data-theme', next)
    }

    const displayLabel = d.userDisplayName || d.userEmail || '...'
    const userInitials = d.userDisplayName
        ? d.userDisplayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
        : d.userEmail
            ? d.userEmail.substring(0, 2).toUpperCase()
            : '??'

    return (
        <aside className="sidebar sidebar--desktop" aria-label="Navegação principal">
            <div className="sidebar-brand">
                <div className="sidebar-brand-icon" aria-hidden="true">
                    <Zap size={18} />
                </div>
                <h1>AI Agent</h1>
            </div>

            {d.workspaces.length > 0 && (
                <div className="input-group" style={{ padding: '0 4px', marginBottom: 12 }}>
                    <label className="input-label" htmlFor="dash-workspace-select">
                        Workspace
                    </label>
                    <select
                        id="dash-workspace-select"
                        className="input select"
                        value={d.selectedSlug ?? d.workspaces[0]?.slug ?? ''}
                        onChange={e => {
                            const v = e.target.value || null
                            d.requestWorkspaceSlug(v)
                        }}
                    >
                        {d.workspaces.map(ws => (
                            <option key={ws.id} value={ws.slug}>
                                {ws.name} ({ws.slug})
                            </option>
                        ))}
                    </select>
                </div>
            )}

            <div className="nav-section-label" id="nav-main-label">
                Menu
            </div>
            <nav className="sidebar-nav" aria-labelledby="nav-main-label">
                {[...baseTabs, ...(d.showWorkspaceSettingsNav ? [settingsTab] : [])].map(t => {
                    const Icon = t.icon
                    return (
                        <button
                            key={t.id}
                            type="button"
                            className={`nav-item ${d.activeTab === t.id ? 'active' : ''}`}
                            aria-current={d.activeTab === t.id ? 'page' : undefined}
                            onClick={() => d.requestTab(t.id)}
                        >
                            <span className="nav-item-icon" aria-hidden="true">
                                <Icon size={18} />
                            </span>
                            <span>{t.label}</span>
                        </button>
                    )
                })}
                {d.isPlatformAdmin && (
                    <a
                        href="/admin"
                        className="nav-item"
                        style={{ textDecoration: 'none' }}
                    >
                        <span className="nav-item-icon" aria-hidden="true">
                            <Shield size={18} />
                        </span>
                        <span>Painel Admin</span>
                    </a>
                )}
            </nav>

            <div className="sidebar-bottom">
                <div className="sidebar-user">
                    <div className="sidebar-user-avatar" aria-hidden="true">
                        {userInitials}
                    </div>
                    <span className="sidebar-user-email">{displayLabel}</span>
                </div>

                <button
                    type="button"
                    className="nav-item"
                    onClick={toggleTheme}
                    title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
                >
                    <span className="nav-item-icon" aria-hidden="true">
                        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                    </span>
                    <span>{theme === 'dark' ? 'Modo claro' : 'Modo escuro'}</span>
                </button>
                <button
                    type="button"
                    className="nav-item"
                    onClick={d.logout}
                    style={{ color: 'var(--red)' }}
                >
                    <span className="nav-item-icon" aria-hidden="true">
                        <LogOut size={18} />
                    </span>
                    <span>Sair</span>
                </button>
            </div>
        </aside>
    )
}
