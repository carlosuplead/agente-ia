'use client'

import type { ReactNode } from 'react'
import { DashboardSidebar } from './DashboardSidebar'
import { MobileNav } from './MobileNav'

type DashboardChromeProps = {
    children: ReactNode
    /** Conteúdo após o main (ex.: modais, toast) — fica dentro de app-container */
    trailing?: ReactNode
}

export function DashboardChrome({ children, trailing }: DashboardChromeProps) {
    return (
        <div className="app-container">
            <DashboardSidebar />
            <MobileNav />
            <main className="main-content">{children}</main>
            {trailing}
        </div>
    )
}
