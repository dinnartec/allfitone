'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react'

import { studioSessionEvents } from '@/lib/session-activity'
import type { Membership, StudioEntryContext } from '@/lib/studio-api'

const ENTRY_CONTEXT_TTL_MS = 30_000

interface EntrySnapshot {
  entry?: StudioEntryContext
  memberships: Membership[]
  capturedAt: number
}

interface StudioEntryContextValue {
  storeEntry: (entry: StudioEntryContext) => void
  storeMemberships: (memberships: Membership[]) => void
  freshMemberships: () => Membership[] | undefined
  clear: () => void
}

const EntryContext = createContext<StudioEntryContextValue | null>(null)

export function StudioEntryContextProvider({ children }: { children: ReactNode }) {
  const snapshot = useRef<EntrySnapshot | undefined>(undefined)

  const clear = useCallback(() => {
    snapshot.current = undefined
  }, [])

  const storeEntry = useCallback((entry: StudioEntryContext) => {
    snapshot.current = {
      entry,
      memberships: entry.memberships,
      capturedAt: Date.now(),
    }
  }, [])

  const storeMemberships = useCallback((memberships: Membership[]) => {
    snapshot.current = {
      ...(snapshot.current?.entry ? { entry: snapshot.current.entry } : {}),
      memberships,
      capturedAt: Date.now(),
    }
  }, [])

  const freshMemberships = useCallback(() => {
    const current = snapshot.current
    if (!current) return undefined
    if (Date.now() - current.capturedAt > ENTRY_CONTEXT_TTL_MS) {
      snapshot.current = undefined
      return undefined
    }
    return current.memberships
  }, [])

  useEffect(() => {
    window.addEventListener(studioSessionEvents.unauthenticated, clear)
    window.addEventListener(studioSessionEvents.logout, clear)
    return () => {
      window.removeEventListener(studioSessionEvents.unauthenticated, clear)
      window.removeEventListener(studioSessionEvents.logout, clear)
    }
  }, [clear])

  const value = useMemo(
    () => ({ storeEntry, storeMemberships, freshMemberships, clear }),
    [clear, freshMemberships, storeEntry, storeMemberships],
  )

  return <EntryContext value={value}>{children}</EntryContext>
}

export function useStudioEntryContext(): StudioEntryContextValue {
  const value = useContext(EntryContext)
  if (!value) throw new Error('useStudioEntryContext requires StudioEntryContextProvider')
  return value
}
