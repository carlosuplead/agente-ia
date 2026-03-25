'use client'

import { DashboardApp } from '@/components/dashboard/DashboardApp'
import { DashboardContext } from '@/components/dashboard/dashboard-context'
import { useDashboardController } from '@/components/dashboard/use-dashboard-state'

export default function HomePage() {
    const value = useDashboardController()
    return (
        <DashboardContext.Provider value={value}>
            <DashboardApp />
        </DashboardContext.Provider>
    )
}
