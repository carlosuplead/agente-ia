import { Suspense } from 'react'
import { SignupForm } from './SignupForm'

export default function SignupPage() {
    return (
        <Suspense
            fallback={
                <div className="login-wrap">
                    <div className="login-card">
                        <p className="login-sub">A carregar...</p>
                    </div>
                </div>
            }
        >
            <SignupForm />
        </Suspense>
    )
}
