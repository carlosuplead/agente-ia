'use client'

import { slugColor } from '@/lib/dashboard/slug-color'
import { useDashboard } from './dashboard-context'

export function WorkspacesTab() {
    const d = useDashboard()

    return (
        <>
            <div className="page-header">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h2>Workspaces</h2>
                        <p>Gerencie clientes e instâncias</p>
                    </div>
                    {d.isPlatformAdmin && (
                        <button type="button" className="btn btn-primary" onClick={() => d.setShowNewWs(true)}>
                            + Novo Cliente
                        </button>
                    )}
                </div>
            </div>

            <div className="workspace-grid">
                {d.workspaces.length === 0 && (
                    <div className="card" style={{ maxWidth: 520 }}>
                        {d.isPlatformAdmin ? (
                            <>
                                <p style={{ marginBottom: 12, color: 'var(--text-primary)' }}>
                                    Ainda não há clientes (workspaces). Cria o primeiro com o botão{' '}
                                    <strong>+ Novo Cliente</strong> acima (nome + slug do schema PostgreSQL).
                                </p>
                                <button type="button" className="btn btn-primary" onClick={() => d.setShowNewWs(true)}>
                                    Criar primeiro workspace
                                </button>
                            </>
                        ) : (
                            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                                Não tens acesso a nenhum workspace. Um administrador da plataforma tem de te adicionar em{' '}
                                <code>workspace_members</code> no Supabase (SQL Editor) ou criar um workspace contigo como
                                membro.
                            </p>
                        )}
                    </div>
                )}
                {d.workspaces.map(ws => (
                    <div
                        key={ws.id}
                        className="workspace-card"
                        role="button"
                        tabIndex={0}
                        onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                if (!d.requestWorkspaceSlug(ws.slug)) return
                                d.requestTab('connection')
                            }
                        }}
                        onClick={() => {
                            if (!d.requestWorkspaceSlug(ws.slug)) return
                            d.requestTab('connection')
                        }}
                    >
                        <div className="workspace-card-header">
                            <div
                                className="workspace-avatar"
                                style={{
                                    background: `linear-gradient(135deg, ${slugColor(ws.slug)}, ${slugColor(ws.slug)}dd)`
                                }}
                                aria-hidden="true"
                            >
                                {ws.name[0]}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div className="workspace-card-name">{ws.name}</div>
                                <div className="workspace-card-slug">{ws.slug}</div>
                            </div>
                            {d.canManageWorkspaceSlug(ws.slug) && (
                                <button
                                    type="button"
                                    className="btn btn-secondary workspace-card-settings-btn"
                                    onClick={e => {
                                        e.stopPropagation()
                                        if (!d.requestWorkspaceSlug(ws.slug)) return
                                        d.requestTab('workspace_settings')
                                    }}
                                >
                                    Definições
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </>
    )
}
