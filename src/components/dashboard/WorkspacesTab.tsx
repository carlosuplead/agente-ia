'use client'

import { useState } from 'react'
import { slugColor } from '@/lib/dashboard/slug-color'
import { useDashboard } from './dashboard-context'
import { LayoutGrid, Copy, Check, Database, Globe, Settings, MessageCircle } from 'lucide-react'

export function WorkspacesTab() {
    const d = useDashboard()
    const [expandedSlug, setExpandedSlug] = useState<string | null>(null)
    const [copied, setCopied] = useState<string | null>(null)

    function copyToClipboard(text: string, label: string) {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(label)
            setTimeout(() => setCopied(null), 2000)
        })
    }

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
                                Ainda sem acesso a nenhum workspace. Um administrador da plataforma precisa aprovar
                                sua conta e atribuir um workspace.
                            </p>
                        )}
                    </div>
                )}
                {d.workspaces.map(ws => {
                    const isExpanded = expandedSlug === ws.slug
                    return (
                        <div key={ws.id} className="workspace-card" style={{ cursor: 'default' }}>
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
                                    {d.isPlatformAdmin && (
                                        <div className="workspace-card-slug">{ws.slug}</div>
                                    )}
                                </div>
                            </div>

                            {/* Action buttons */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                                <button
                                    type="button"
                                    className="btn btn-primary btn-compact"
                                    onClick={() => {
                                        if (!d.requestWorkspaceSlug(ws.slug)) return
                                        d.requestTab('connection')
                                    }}
                                >
                                    <MessageCircle size={14} />
                                    WhatsApp
                                </button>
                                {d.isPlatformAdmin && (
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-compact"
                                        onClick={e => {
                                            e.stopPropagation()
                                            setExpandedSlug(prev => prev === ws.slug ? null : ws.slug)
                                        }}
                                    >
                                        <Database size={14} />
                                        {isExpanded ? 'Ocultar info' : 'Ver detalhes'}
                                    </button>
                                )}
                                {d.canManageWorkspaceSlug(ws.slug) && (
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-compact"
                                        onClick={e => {
                                            e.stopPropagation()
                                            if (!d.requestWorkspaceSlug(ws.slug)) return
                                            d.requestTab('workspace_settings')
                                        }}
                                    >
                                        <Settings size={14} />
                                        Definições
                                    </button>
                                )}
                            </div>

                            {/* Expanded detail view — only visible to platform admins */}
                            {d.isPlatformAdmin && isExpanded && (
                                <div style={{
                                    marginTop: 16,
                                    padding: 16,
                                    background: 'var(--surface-secondary)',
                                    borderRadius: 'var(--radius)',
                                    border: '1px solid var(--border-subtle)',
                                    fontSize: 13
                                }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                        <div className="ws-detail-row">
                                            <span style={{ color: 'var(--text-muted)', fontWeight: 600, minWidth: 120, display: 'inline-block' }}>
                                                Workspace ID
                                            </span>
                                            <code className="inline-code" style={{ fontSize: 12 }}>{ws.id}</code>
                                            <button
                                                type="button"
                                                className="ws-detail-copy-btn"
                                                title="Copiar ID"
                                                onClick={() => copyToClipboard(ws.id, `id-${ws.slug}`)}
                                            >
                                                {copied === `id-${ws.slug}` ? <Check size={12} /> : <Copy size={12} />}
                                            </button>
                                        </div>
                                        <div className="ws-detail-row">
                                            <span style={{ color: 'var(--text-muted)', fontWeight: 600, minWidth: 120, display: 'inline-block' }}>
                                                Schema (slug)
                                            </span>
                                            <code className="inline-code" style={{ fontSize: 12 }}>{ws.slug}</code>
                                            <button
                                                type="button"
                                                className="ws-detail-copy-btn"
                                                title="Copiar slug"
                                                onClick={() => copyToClipboard(ws.slug, `slug-${ws.slug}`)}
                                            >
                                                {copied === `slug-${ws.slug}` ? <Check size={12} /> : <Copy size={12} />}
                                            </button>
                                        </div>
                                        <div className="ws-detail-row">
                                            <span style={{ color: 'var(--text-muted)', fontWeight: 600, minWidth: 120, display: 'inline-block' }}>
                                                Supabase
                                            </span>
                                            <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                                                Tabelas em <code className="inline-code">{ws.slug}.*</code>
                                            </span>
                                        </div>
                                        <div className="ws-detail-row">
                                            <span style={{ color: 'var(--text-muted)', fontWeight: 600, minWidth: 120, display: 'inline-block' }}>
                                                SQL rápido
                                            </span>
                                            <code className="inline-code" style={{ fontSize: 11 }}>
                                                SELECT * FROM &quot;{ws.slug}&quot;.ai_agent_config
                                            </code>
                                            <button
                                                type="button"
                                                className="ws-detail-copy-btn"
                                                title="Copiar SQL"
                                                onClick={() => copyToClipboard(`SELECT * FROM "${ws.slug}".ai_agent_config`, `sql-${ws.slug}`)}
                                            >
                                                {copied === `sql-${ws.slug}` ? <Check size={12} /> : <Copy size={12} />}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </>
    )
}
