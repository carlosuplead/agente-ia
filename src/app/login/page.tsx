import { Suspense } from 'react'
import { LoginForm } from './LoginForm'

export default function LoginPage() {
    return (
        <Suspense
            fallback={
                <div className="login-wrap">
                    <div className="login-card">
                        <p className="login-sub">A carregar…</p>
                    </div>
                </div>
            }
        >
            <LoginForm />
        </Suspense>
    )
}
