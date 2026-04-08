'use client'

import { useCallback } from 'react'
import { AgentConfigTab } from './AgentConfigTab'
import { DashboardSidebar } from './DashboardSidebar'
import { MobileNav } from './MobileNav'
import { NewWorkspaceModal } from './NewWorkspaceModal'
import { Toast } from './Toast'
import { DisparosTab } from './DisparosTab'
import { WhatsAppTab } from './WhatsAppTab'
import { WorkspacesTab } from './WorkspacesTab'
import { WorkspaceSettingsTab } from './WorkspaceSettingsTab'
import { useDashboard } from './dashboard-context'

export function DashboardApp() {
    const d = useDashboard()
    const dismissToast = useCallback(() => d.setToast(null), [d.setToast])

    // Usuário sem workspaces e não é admin → aguardando aprovação
    const pendingApproval = !d.isPlatformAdmin && d.workspaces.length === 0 && d.userEmail

    if (pendingApproval) {
        return (
            <div className="login-wrap">
                <div className="login-card" style={{ textAlign: 'center', maxWidth: 460 }}>
                    <div style={{ fontSize: 48, marginBottom: 16 }}>&#9203;</div>
                    <h1 style={{ marginBottom: 12 }}>Aguardando aprovação</h1>
                    <p className="login-sub" style={{ lineHeight: 1.6, marginBottom: 24 }}>
                        Sua conta <strong>{d.userEmail}</strong> foi criada com sucesso.<br />
                        Um administrador precisa aprovar seu acesso e atribuir um workspace para você.
                    </p>
                    <p className="login-sub" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                        Entre em contato com o administrador da plataforma para solicitar aprovação.
                    </p>
                    <button
                        className="btn btn-secondary"
                        style={{ marginTop: 20 }}
                        onClick={async () => {
                            const { createBrowserSupabaseClient } = await import('@/lib/supabase/client')
                            const sb = createBrowserSupabaseClient()
                            await sb.auth.signOut()
                            window.location.href = '/login'
                        }}
                    >
                        Sair
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div className="app-container">
            <DashboardSidebar />
            <MobileNav />

            <main className="main-content">
                {d.loadError && (
                    <div className="card alert-card" role="alert">
                        <p className="alert-card-text">{d.loadError}</p>
                    </div>
                )}

                {d.activeTab === 'workspaces' && <WorkspacesTab />}
                {d.activeTab === 'connection' && <WhatsAppTab />}
                {d.activeTab === 'disparos' && <DisparosTab />}
                {d.activeTab === 'config' && <AgentConfigTab />}
                {d.activeTab === 'workspace_settings' && <WorkspaceSettingsTab />}
            </main>

            <NewWorkspaceModal
                open={d.showNewWs}
                busy={d.busy}
                name={d.newWsName}
                slug={d.newWsSlug}
                onNameChange={d.setNewWsName}
                onSlugChange={d.setNewWsSlug}
                onSubmit={d.createWorkspace}
                onClose={() => d.setShowNewWs(false)}
            />

            {d.toast && (
                <div className="toast-region" aria-live="polite">
                    <Toast
                        message={d.toast.message}
                        variant={d.toast.variant}
                        onDismiss={dismissToast}
                    />
                </div>
            )}
        </div>
    )
}
