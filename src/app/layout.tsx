import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import './premium-refresh.css'

const inter = Inter({
    subsets: ['latin'],
    weight: ['400', '500', '600', '700'],
    display: 'swap',
    variable: '--font-inter'
})

export const metadata: Metadata = {
    title: 'WhatsApp AI Agent',
    description: 'Plataforma de atendimento automatizado via WhatsApp com IA'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="pt-BR" className={inter.variable}>
            <body className={inter.className}>{children}</body>
        </html>
    )
}
