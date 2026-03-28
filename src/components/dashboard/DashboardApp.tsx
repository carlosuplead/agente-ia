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
