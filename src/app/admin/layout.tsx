'use client'

import { DashboardChrome } from '@/components/dashboard/DashboardChrome'
import { DashboardContext } from '@/components/dashboard/dashboard-context'
import { useDashboardController } from '@/components/dashboard/use-dashboard-state'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const value = useDashboardController()
    return (
        <DashboardContext.Provider value={value}>
            <DashboardChrome>{children}</DashboardChrome>
        </DashboardContext.Provider>
    )
}
