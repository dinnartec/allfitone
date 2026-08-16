'use client'

import {
  QueryClientProvider,
  useMutation,
  type UseMutationOptions,
  type UseMutationResult,
} from '@tanstack/react-query'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

import {
  parseStudioSessionActivity,
  readStudioSessionActivity,
  studioSessionEvents,
} from '@/lib/session-activity'
import { createStudioQueryRuntime, type StudioQueryRuntime } from '@/lib/studio-query'

const StudioQueryRuntimeContext = createContext<StudioQueryRuntime | null>(null)

export function StudioQueryProvider({ children }: { children: ReactNode }) {
  const [runtime] = useState(createStudioQueryRuntime)

  useEffect(() => {
    const stop = () => runtime.stop()
    const syncStorage = (event: StorageEvent) => {
      if (event.key !== studioSessionEvents.storageKey) return
      const activity = parseStudioSessionActivity(event.newValue)
      if (activity?.status === 'ended') runtime.stop()
      else if (activity?.status === 'active') runtime.start()
    }
    const stored = readStudioSessionActivity()
    if (stored?.status === 'ended') runtime.stop()
    else runtime.start()
    window.addEventListener(studioSessionEvents.unauthenticated, stop)
    window.addEventListener(studioSessionEvents.logout, stop)
    window.addEventListener('storage', syncStorage)
    return () => {
      window.removeEventListener(studioSessionEvents.unauthenticated, stop)
      window.removeEventListener(studioSessionEvents.logout, stop)
      window.removeEventListener('storage', syncStorage)
      runtime.stop()
    }
  }, [runtime])

  return (
    <StudioQueryRuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={runtime.queryClient}>{children}</QueryClientProvider>
    </StudioQueryRuntimeContext.Provider>
  )
}

export type StudioMutationOptions<TData, TVariables, TOnMutateResult = unknown> = Omit<
  UseMutationOptions<TData, Error, TVariables, TOnMutateResult>,
  'mutationFn'
> & {
  mutationFn: (variables: TVariables, signal: AbortSignal) => Promise<TData>
}

export function useStudioSessionMutation<TData, TVariables, TOnMutateResult = unknown>(
  options: StudioMutationOptions<TData, TVariables, TOnMutateResult>,
): UseMutationResult<TData, Error, TVariables, TOnMutateResult> {
  const runtime = useContext(StudioQueryRuntimeContext)
  if (!runtime) throw new Error('useStudioSessionMutation requires StudioQueryProvider')
  const { mutationFn, ...mutationOptions } = options
  return useMutation({
    ...mutationOptions,
    mutationFn: (variables) => runtime.runMutation((signal) => mutationFn(variables, signal)),
  })
}
