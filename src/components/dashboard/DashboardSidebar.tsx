'use client'

import type { DashboardTab } from '@/lib/dashboard/types'
import { useDashboard } from './dashboard-context'
import {
    LayoutGrid,
    MessageCircle,
    Megaphone,
    Bot,
    Settings,
    Zap,
    Sun,
    Moon
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState, useEffect } from 'react'

const baseTabs: { id: DashboardTab; label: string; icon: LucideIcon }[] = [
    { id: 'workspaces', label: 'Workspaces', icon: LayoutGrid },
    { id: 'connection', label: 'WhatsApp', icon: MessageCircle },
    { id: 'disparos', label: 'Disparos', icon: Megaphone },
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

    return (
        <aside className="sidebar sidebar--desktop" aria-label="Navegação principal">
            <div className="sidebar-brand">
                <div className="sidebar-brand-icon" aria-hidden="true">
                    <Zap size={18} />
                </div>
                <h1>AI Agent</h1>
            </div>

            <div className="workspace-selector workspace-selector--readonly">
                <div className="workspace-selector-label">Sessão</div>
                <div className="workspace-selector-value" style={{ fontSize: 12 }}>
                    {d.userEmail || '…'}
                </div>
                {d.isPlatformAdmin && (
                    <div style={{ fontSize: 11, marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: 'var(--accent)' }}>Admin plataforma</span>
                        <a
                            href="/admin"
                            style={{ color: 'var(--accent)', textDecoration: 'underline', fontSize: 11 }}
                        >
                            Painel Admin
                        </a>
                    </div>
                )}
            </div>

            {d.workspaces.length > 0 && (
                <div className="input-group" style={{ marginBottom: 8 }}>
                    <label className="input-label" htmlFor="dash-workspace-select">
                        Workspace ativo
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
            </nav>

            <div style={{ marginTop: 'auto', paddingTop: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                <button type="button" className="btn btn-secondary" style={{ width: '100%' }} onClick={d.logout}>
                    Sair
                </button>
            </div>
        </aside>
    )
}
