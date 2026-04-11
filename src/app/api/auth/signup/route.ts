import { NextResponse } from 'next/server'

/**
 * Signup público desativado permanentemente.
 * Apenas o admin cria contas pelo painel administrativo.
 */
export async function POST() {
    return NextResponse.json(
        { error: 'Criação de conta desativada. Entre em contato com o administrador.' },
        { status: 403 }
    )
}
