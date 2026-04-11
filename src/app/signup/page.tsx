import { redirect } from 'next/navigation'

/** Signup desativado — apenas admin cria contas pelo painel. */
export default function SignupPage() {
    redirect('/login')
}
