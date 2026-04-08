'use client'

import { useEffect, useState } from 'react'
import type { DashboardTab } from '@/lib/dashboard/types'
import { useDashboard } from './dashboard-context'
import {
    LayoutGrid,
    MessageCircle,
    Megaphone,
    BarChart3,
    Bot,
    Settings,
    Menu,
    Shield,
    Sun,
    Moon,
    LogOut,
    Zap
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const baseTabs: { id: DashboardTab; label: string; icon: LucideIcon }[] = [
    { id: 'workspaces', label: 'Workspaces', icon: LayoutGrid },
    { id: 'connection', label: 'WhatsApp', icon: MessageCircle },
    { id: 'disparos', label: 'Disparos', icon: Megaphone },
    { id: 'relatorios', label: 'Relatorios', icon: BarChart3 },
    { id: 'config', label: 'Agente IA', icon: Bot }
]

const settingsTab: { id: DashboardTab; label: string; icon: LucideIcon } = {
    id: 'workspace_settings',
    label: 'Definições',
    icon: Settings
}

export function MobileNav() {
    const d = useDashboard()
    const [theme, setTheme] = useState<'dark' | 'light'>('dark')

    useEffect(() => {
        const saved = localStorage.getItem('theme') as 'dark' | 'light' | null
        if (saved) setTheme(saved)
    }, [])

    function toggleTheme() {
        const next = theme === 'dark' ? 'light' : 'dark'
        setTheme(next)
        localStorage.setItem('theme', next)
        document.documentElement.setAttribute('data-theme', next)
    }

    useEffect(() => {
        if (!d.mobileNavOpen) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') d.closeMobileNav()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [d.mobileNavOpen, d.closeMobileNav])

    return (
        <div className="mobile-shell">
            <header className="mobile-topbar">
                <button
                    type="button"
                    className="mobile-menu-btn"
                    aria-expanded={d.mobileNavOpen}
                    aria-controls="mobile-drawer"
                    onClick={() => d.setMobileNavOpen(o => !o)}
                >
                    <span className="sr-only">Abrir menu</span>
                    <Menu size={20} aria-hidden="true" />
                </button>
                <span className="mobile-topbar-title">AI Agent</span>
                <span className="mobile-topbar-spacer" aria-hidden="true" />
            </header>

            {d.mobileNavOpen && (
                <div
                    className="mobile-drawer-backdrop"
                    role="presentation"
                    aria-hidden="true"
                    onClick={d.closeMobileNav}
                />
            )}

            <div
                id="mobile-drawer"
                className={`mobile-drawer ${d.mobileNavOpen ? 'mobile-drawer--open' : ''}`}
                role="dialog"
                aria-modal="true"
                aria-label="Menu"
                aria-hidden={!d.mobileNavOpen}
            >
                <div className="mobile-drawer-inner">
                    <div className="sidebar-brand" style={{ padding: '4px 8px', marginBottom: 4 }}>
                        <div className="sidebar-brand-icon" aria-hidden="true">
                            <Zap size={18} />
                        </div>
                        <h1 style={{ fontSize: 16, fontWeight: 700 }}>AI Agent</h1>
                    </div>

                    {d.workspaces.length > 0 && (
                        <div className="input-group" style={{ marginBottom: 12, padding: '0 4px' }}>
                            <label className="input-label" htmlFor="mobile-workspace-select">
                                Workspace
                            </label>
                            <select
                                id="mobile-workspace-select"
                                className="input select"
                                value={d.selectedSlug ?? d.workspaces[0]?.slug ?? ''}
                                onChange={e => d.requestWorkspaceSlug(e.target.value || null)}
                            >
                                {d.workspaces.map(ws => (
                                    <option key={ws.id} value={ws.slug}>
                                        {ws.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    <nav className="mobile-drawer-nav" aria-label="Secções">
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

                    <div className="sidebar-bottom" style={{ borderTop: 'none', paddingTop: 8 }}>
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
                </div>
            </div>
        </div>
    )
}
