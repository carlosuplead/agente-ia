'use client'

import { useEffect, useId, useRef } from 'react'

type NewWorkspaceModalProps = {
    open: boolean
    busy: boolean
    name: string
    slug: string
    onNameChange: (v: string) => void
    onSlugChange: (v: string) => void
    onSubmit: (e: React.FormEvent) => void
    onClose: () => void
}

export function NewWorkspaceModal({
    open,
    busy,
    name,
    slug,
    onNameChange,
    onSlugChange,
    onSubmit,
    onClose
}: NewWorkspaceModalProps) {
    const titleId = useId()
    const panelRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!open) return
        const t = window.setTimeout(() => {
            const el = panelRef.current?.querySelector<HTMLInputElement>('input')
            el?.focus()
        }, 0)
        return () => window.clearTimeout(t)
    }, [open])

    useEffect(() => {
        if (!open) return
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
            }
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [open, onClose])

    if (!open) return null

    return (
        <div className="modal-overlay" role="presentation" onClick={onClose}>
            <div
                ref={panelRef}
                className="modal-dialog card"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                onClick={e => e.stopPropagation()}
            >
                <h3 id={titleId} style={{ marginBottom: 16 }}>
                    Novo workspace
                </h3>
                <form onSubmit={onSubmit} className="login-form">
                    <div className="input-group">
                        <label className="input-label" htmlFor="new-ws-name">
                            Nome
                        </label>
                        <input
                            id="new-ws-name"
                            className="input"
                            value={name}
                            onChange={e => onNameChange(e.target.value)}
                            required
                            autoComplete="organization"
                        />
                    </div>
                    <div className="input-group">
                        <label className="input-label" htmlFor="new-ws-slug">
                            Slug (schema)
                        </label>
                        <input
                            id="new-ws-slug"
                            className="input"
                            value={slug}
                            onChange={e => onSlugChange(e.target.value)}
                            placeholder="moreli"
                            required
                            autoComplete="off"
                        />
                    </div>
                    <div className="modal-actions">
                        <button type="submit" className="btn btn-primary" disabled={busy}>
                            Criar
                        </button>
                        <button type="button" className="btn btn-secondary" onClick={onClose}>
                            Cancelar
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}
