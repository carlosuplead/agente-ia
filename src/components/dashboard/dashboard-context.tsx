'use client'

import { createContext, useContext } from 'react'
import type { DashboardContextValue } from './use-dashboard-state'

export const DashboardContext = createContext<DashboardContextValue | null>(null)

export function useDashboard() {
    const v = useContext(DashboardContext)
    if (!v) throw new Error('useDashboard tem de estar dentro do provider.')
    return v
}
