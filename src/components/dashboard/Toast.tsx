'use client'

import { useEffect, useRef } from 'react'

type ToastProps = {
    message: string
    variant?: 'success' | 'error'
    onDismiss: () => void
    durationMs?: number
}

export function Toast({ message, variant = 'success', onDismiss, durationMs = 4500 }: ToastProps) {
    const dismissRef = useRef(onDismiss)
    dismissRef.current = onDismiss

    useEffect(() => {
        const t = window.setTimeout(() => dismissRef.current(), durationMs)
        return () => window.clearTimeout(t)
    }, [durationMs, message])

    return (
        <div
            className={`toast toast-${variant}`}
            role="status"
            aria-live="polite"
        >
            <span>{message}</span>
            <button type="button" className="toast-close" onClick={onDismiss} aria-label="Fechar">
                ×
            </button>
        </div>
    )
}
