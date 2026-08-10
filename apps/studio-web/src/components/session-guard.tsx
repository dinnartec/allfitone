'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

import { studioApi } from '@/lib/studio-api'
import {
  announceStudioLogout,
  readStudioSessionActivity,
  STUDIO_IDLE_TIMEOUT_MS,
  studioSessionEvents,
  writeStudioSessionActivity,
  type StudioSessionActivity,
} from '@/lib/session-activity'

type LockedReason = 'ended' | 'inactivity'

export function SessionGuard({ children }: { children: ReactNode }) {
  const [lockedReason, setLockedReason] = useState<LockedReason>()
  const activityRef = useRef<StudioSessionActivity | undefined>(undefined)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const inactivityFormRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    function clearTimer() {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = undefined
    }

    function lock(reason: LockedReason) {
      clearTimer()
      document.documentElement.dataset.sessionLocked = 'true'
      setLockedReason(reason)
    }

    function unlock() {
      delete document.documentElement.dataset.sessionLocked
      setLockedReason(undefined)
    }

    function expireForInactivity() {
      if (activityRef.current?.status !== 'active') return
      announceStudioLogout()
      activityRef.current = { version: 1, status: 'ended', endedAt: Date.now() }
      lock('inactivity')
      requestAnimationFrame(() => inactivityFormRef.current?.requestSubmit())
    }

    function schedule(record: Extract<StudioSessionActivity, { status: 'active' }>) {
      clearTimer()
      activityRef.current = record
      const remaining = record.lastActivityAt + STUDIO_IDLE_TIMEOUT_MS - Date.now()
      if (remaining <= 0) {
        expireForInactivity()
        return
      }
      timeoutRef.current = setTimeout(expireForInactivity, remaining)
    }

    function activateFromAuthentication() {
      const stored = readStudioSessionActivity()
      if (stored?.status === 'ended') return
      const active =
        stored?.status === 'active'
          ? stored
          : { version: 1 as const, status: 'active' as const, lastActivityAt: Date.now() }
      if (!stored) writeStudioSessionActivity(active)
      unlock()
      schedule(active)
    }

    function confirmUnauthenticated() {
      clearTimer()
      activityRef.current = readStudioSessionActivity()
      unlock()
    }

    function recordActivity() {
      if (activityRef.current?.status !== 'active') return
      const active = { version: 1 as const, status: 'active' as const, lastActivityAt: Date.now() }
      writeStudioSessionActivity(active)
      schedule(active)
    }

    function syncStorage(event: StorageEvent) {
      if (event.key !== studioSessionEvents.storageKey) return
      const stored = readStudioSessionActivity()
      if (stored?.status === 'ended') {
        activityRef.current = stored
        if (stored.confirmedAt !== undefined && window.location.pathname === '/') {
          unlock()
        } else {
          lock('ended')
          if (stored.confirmedAt !== undefined) window.location.replace('/')
        }
      } else if (stored?.status === 'active') {
        unlock()
        schedule(stored)
      }
    }

    function lockFromLocalLogout() {
      activityRef.current = readStudioSessionActivity()
      lock('ended')
    }

    function revalidateDeadline() {
      const stored = readStudioSessionActivity()
      if (stored?.status === 'ended') {
        activityRef.current = stored
        if (stored.confirmedAt !== undefined && window.location.pathname === '/') {
          unlock()
        } else {
          lock('ended')
          if (stored.confirmedAt !== undefined) window.location.replace('/')
        }
      } else if (stored?.status === 'active') {
        schedule(stored)
      }
    }

    function handleVisibility() {
      if (document.visibilityState === 'visible') revalidateDeadline()
    }

    window.addEventListener(studioSessionEvents.authenticated, activateFromAuthentication)
    window.addEventListener(studioSessionEvents.unauthenticated, confirmUnauthenticated)
    window.addEventListener(studioSessionEvents.logout, lockFromLocalLogout)
    window.addEventListener('storage', syncStorage)
    window.addEventListener('pointerdown', recordActivity)
    window.addEventListener('keydown', recordActivity)
    window.addEventListener('touchstart', recordActivity, { passive: true })
    window.addEventListener('pageshow', revalidateDeadline)
    document.addEventListener('visibilitychange', handleVisibility)
    revalidateDeadline()

    return () => {
      clearTimer()
      window.removeEventListener(studioSessionEvents.authenticated, activateFromAuthentication)
      window.removeEventListener(studioSessionEvents.unauthenticated, confirmUnauthenticated)
      window.removeEventListener(studioSessionEvents.logout, lockFromLocalLogout)
      window.removeEventListener('storage', syncStorage)
      window.removeEventListener('pointerdown', recordActivity)
      window.removeEventListener('keydown', recordActivity)
      window.removeEventListener('touchstart', recordActivity)
      window.removeEventListener('pageshow', revalidateDeadline)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  return (
    <>
      <div
        data-session-content
        data-locked={lockedReason ? 'true' : undefined}
        aria-hidden={lockedReason ? true : undefined}
        inert={lockedReason ? true : undefined}
      >
        {children}
      </div>
      <form
        ref={inactivityFormRef}
        action={`${studioApi.apiUrl}/studio/v1/auth/logout`}
        method="post"
        hidden
      >
        <input type="hidden" name="reason" value="inactivity" />
      </form>
      {lockedReason ? <div data-session-lock aria-hidden="true" /> : null}
    </>
  )
}
