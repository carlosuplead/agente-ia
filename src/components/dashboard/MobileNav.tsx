'use client'

import { useEffect } from 'react'
import type { DashboardTab } from '@/lib/dashboard/types'
import { useDashboard } from './dashboard-context'

const baseTabs: { id: DashboardTab; label: string; emoji: string }[] = [
    { id: 'workspaces', label: 'Workspaces', emoji: '🏢' },
    { id: 'connection', label: 'WhatsApp', emoji: '📱' },
    { id: 'config', label: 'Agente IA', emoji: '🤖' }
]

const settingsTab: { id: DashboardTab; label: string; emoji: string } = {
    id: 'workspace_settings',
    label: 'Definições',
    emoji: '⚙️'
}

export function MobileNav() {
    const d = useDashboard()

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
                    <span aria-hidden="true">☰</span>
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
                    {d.workspaces.length > 0 && (
                        <div className="input-group" style={{ marginBottom: 12 }}>
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
                        {[...baseTabs, ...(d.showWorkspaceSettingsNav ? [settingsTab] : [])].map(t => (
                            <button
                                key={t.id}
                                type="button"
                                className={`nav-item ${d.activeTab === t.id ? 'active' : ''}`}
                                aria-current={d.activeTab === t.id ? 'page' : undefined}
                                onClick={() => d.requestTab(t.id)}
                            >
                                <span className="nav-item-icon" aria-hidden="true">
                                    {t.emoji}
                                </span>
                                <span>{t.label}</span>
                            </button>
                        ))}
                    </nav>
                    <button type="button" className="btn btn-secondary" style={{ width: '100%' }} onClick={d.logout}>
                        Sair
                    </button>
                </div>
            </div>
        </div>
    )
}
