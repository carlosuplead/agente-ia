import { Suspense } from 'react'
import { AdminPanel } from './AdminPanel'

export default function AdminPage() {
    return (
        <Suspense
            fallback={
                <div className="login-wrap">
                    <div className="login-card">
                        <p className="login-sub">Carregando painel admin...</p>
                    </div>
                </div>
            }
        >
            <AdminPanel />
        </Suspense>
    )
}
