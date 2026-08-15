'use client'

import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'

import { studioSessionEvents } from '@/lib/session-activity'
import { createStudioQueryClient } from '@/lib/studio-query'

export function StudioQueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createStudioQueryClient)

  useEffect(() => {
    const clear = () => queryClient.clear()
    window.addEventListener(studioSessionEvents.unauthenticated, clear)
    window.addEventListener(studioSessionEvents.logout, clear)
    return () => {
      window.removeEventListener(studioSessionEvents.unauthenticated, clear)
      window.removeEventListener(studioSessionEvents.logout, clear)
    }
  }, [queryClient])

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
