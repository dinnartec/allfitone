'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { AccessLanding } from './access-landing'
import { LoadingStage } from './studio-frame'
import {
  announceStudioLogout,
  readStudioSessionActivity,
  STUDIO_IDLE_TIMEOUT_MS,
  studioSessionEvents,
  writeStudioSessionActivity,
  type StudioSessionActivity,
  type StudioSessionEndReason,
} from '@/lib/session-activity'
import { StudioApiError, studioApi } from '@/lib/studio-api'

/**
 * `ending` and `closing` are the same fact seen from two places. `ending` belongs to
 * the tab where somebody just pressed the logout button: that person knows what they
 * asked for, so the workspace stays in place, inert and illegible, until the redirect
 * lands. `closing` belongs to every other surface — a second tab, or an idle timeout —
 * where the change was not requested and has to be explained.
 */
type GuardState =
  // `silent` marks the checks that run on the way out of a session. "Preparando tu
  // espacio…" under the full Studio chrome is the wrong promise there: a bare canvas
  // says nothing rather than saying the opposite of what is about to happen.
  | { kind: 'checking'; silent: boolean }
  | { kind: 'ready' }
  | { kind: 'ending' }
  | { kind: 'closing'; reason: StudioSessionEndReason }
  | { kind: 'locked'; reason: StudioSessionEndReason; retryable: boolean }

const CLOSING_RECOVERY_DELAY_MS = 10_000

export function SessionGuard({ children }: { children: ReactNode }) {
  const [guard, setGuard] = useState<GuardState>({ kind: 'checking', silent: false })
  const activityRef = useRef<StudioSessionActivity | undefined>(undefined)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const closingRecoveryRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const inactivityFormRef = useRef<HTMLFormElement>(null)
  const retryVerificationRef = useRef<() => void>(() => undefined)

  useLayoutEffect(() => {
    delete document.documentElement.dataset.sessionLocked
  }, [guard])

  useEffect(() => {
    let disposed = false
    let verificationSequence = 0
    let logoutNavigationInFlight = false

    function commit(next: GuardState) {
      if (!disposed) setGuard(next)
    }

    function coverImmediately() {
      document.documentElement.dataset.sessionLocked = 'true'
    }

    function clearTimer() {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = undefined
    }

    function clearClosingRecovery() {
      if (closingRecoveryRef.current) clearTimeout(closingRecoveryRef.current)
      closingRecoveryRef.current = undefined
    }

    function lock(reason: StudioSessionEndReason, retryable: boolean) {
      clearTimer()
      clearClosingRecovery()
      coverImmediately()
      commit({ kind: 'locked', reason, retryable })
    }

    function scheduleClosingRecovery(record: Extract<StudioSessionActivity, { status: 'ended' }>) {
      closingRecoveryRef.current = setTimeout(() => {
        void verifyEndedSession(record, false)
      }, CLOSING_RECOVERY_DELAY_MS)
    }

    function closeInProgress(
      reason: StudioSessionEndReason,
      record?: Extract<StudioSessionActivity, { status: 'ended' }>,
    ) {
      clearTimer()
      clearClosingRecovery()
      coverImmediately()
      commit({ kind: 'closing', reason })
      if (record) scheduleClosingRecovery(record)
    }

    function endHere(record?: Extract<StudioSessionActivity, { status: 'ended' }>) {
      clearTimer()
      clearClosingRecovery()
      commit({ kind: 'ending' })
      // The workspace stays on screen here, so a redirect that never lands must not
      // leave it visible forever: verification turns it into the recovery lock.
      if (record) scheduleClosingRecovery(record)
    }

    function publicEntryIsCurrent() {
      return window.location.pathname === '/' || window.location.pathname === '/invitations'
    }

    function revealUnauthenticatedEntry() {
      clearTimer()
      clearClosingRecovery()
      activityRef.current = readStudioSessionActivity()
      if (publicEntryIsCurrent()) {
        commit({ kind: 'ready' })
        return
      }
      coverImmediately()
      commit({ kind: 'checking', silent: true })
      window.location.replace('/')
    }

    function expireForInactivity() {
      if (activityRef.current?.status !== 'active') return
      announceStudioLogout('inactivity')
      activityRef.current = readStudioSessionActivity()
      requestAnimationFrame(() => inactivityFormRef.current?.requestSubmit())
    }

    function schedule(record: Extract<StudioSessionActivity, { status: 'active' }>): boolean {
      clearTimer()
      activityRef.current = record
      const remaining = record.lastActivityAt + STUDIO_IDLE_TIMEOUT_MS - Date.now()
      if (remaining <= 0) {
        expireForInactivity()
        return false
      }
      timeoutRef.current = setTimeout(expireForInactivity, remaining)
      return true
    }

    async function verifyEndedSession(
      record: Extract<StudioSessionActivity, { status: 'ended' }>,
      showChecking = true,
    ) {
      const verification = ++verificationSequence
      if (showChecking) {
        coverImmediately()
        commit({ kind: 'checking', silent: true })
      }
      try {
        await studioApi.session()
        if (disposed || verification !== verificationSequence) return
        activityRef.current = record
        lock(record.reason ?? 'unknown', false)
      } catch (caught) {
        if (disposed || verification !== verificationSequence) return
        if (caught instanceof StudioApiError && caught.status === 401) {
          revealUnauthenticatedEntry()
          return
        }
        activityRef.current = record
        lock(record.reason ?? 'unknown', true)
      }
    }

    function revalidateStoredActivity() {
      const stored = readStudioSessionActivity()
      activityRef.current = stored
      if (stored?.status === 'ended') {
        if (stored.confirmedAt !== undefined) {
          revealUnauthenticatedEntry()
        } else {
          void verifyEndedSession(stored)
        }
        return
      }
      if (stored?.status === 'active') {
        if (schedule(stored)) commit({ kind: 'ready' })
        return
      }
      commit({ kind: 'ready' })
    }

    function activateFromAuthentication() {
      // The workspace stays mounted through a manual logout, so its in-flight requests
      // keep answering. Neither a 200 nor a 401 may move the guard while the logout
      // navigation is running: only the recovery verification below decides.
      if (logoutNavigationInFlight) return
      const stored = readStudioSessionActivity()
      if (stored?.status === 'ended') {
        activityRef.current = stored
        if (stored.confirmedAt !== undefined) {
          revealUnauthenticatedEntry()
        } else {
          lock(stored.reason ?? 'unknown', false)
        }
        return
      }
      const active =
        stored?.status === 'active'
          ? stored
          : { version: 1 as const, status: 'active' as const, lastActivityAt: Date.now() }
      if (!stored) writeStudioSessionActivity(active)
      if (schedule(active)) commit({ kind: 'ready' })
    }

    function confirmUnauthenticated() {
      // Replacing the location because a background request happened to see 401 would
      // cancel the logout navigation mid-flight and leave the provider session alive.
      if (logoutNavigationInFlight) return
      verificationSequence += 1
      revealUnauthenticatedEntry()
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
      activityRef.current = stored
      if (stored?.status === 'ended') {
        if (stored.confirmedAt !== undefined) {
          revealUnauthenticatedEntry()
        } else {
          closeInProgress(stored.reason ?? 'unknown', stored)
        }
      } else if (stored?.status === 'active' && schedule(stored)) {
        commit({ kind: 'ready' })
      }
    }

    function closeFromLocalLogout() {
      const stored = readStudioSessionActivity()
      activityRef.current = stored
      const record = stored?.status === 'ended' ? stored : undefined
      logoutNavigationInFlight = true
      if (record?.reason === 'manual') {
        endHere(record)
        return
      }
      closeInProgress(record?.reason ?? 'unknown', record)
    }

    function handleVisibility() {
      if (document.visibilityState === 'visible') revalidateStoredActivity()
    }

    retryVerificationRef.current = revalidateStoredActivity
    window.addEventListener(studioSessionEvents.authenticated, activateFromAuthentication)
    window.addEventListener(studioSessionEvents.unauthenticated, confirmUnauthenticated)
    window.addEventListener(studioSessionEvents.logout, closeFromLocalLogout)
    window.addEventListener('storage', syncStorage)
    window.addEventListener('pointerdown', recordActivity)
    window.addEventListener('keydown', recordActivity)
    window.addEventListener('touchstart', recordActivity, { passive: true })
    window.addEventListener('pageshow', revalidateStoredActivity)
    document.addEventListener('visibilitychange', handleVisibility)
    revalidateStoredActivity()

    return () => {
      disposed = true
      verificationSequence += 1
      clearTimer()
      clearClosingRecovery()
      retryVerificationRef.current = () => undefined
      window.removeEventListener(studioSessionEvents.authenticated, activateFromAuthentication)
      window.removeEventListener(studioSessionEvents.unauthenticated, confirmUnauthenticated)
      window.removeEventListener(studioSessionEvents.logout, closeFromLocalLogout)
      window.removeEventListener('storage', syncStorage)
      window.removeEventListener('pointerdown', recordActivity)
      window.removeEventListener('keydown', recordActivity)
      window.removeEventListener('touchstart', recordActivity)
      window.removeEventListener('pageshow', revalidateStoredActivity)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  return (
    <>
      {/* `ready` and `ending` must resolve to the same element in the same slot. A
          different branch would remount the whole workspace, restarting every request
          it makes at the exact moment the session is being torn down. */}
      {guard.kind === 'ready' || guard.kind === 'ending' ? (
        <div
          data-session-content
          data-session-ending={guard.kind === 'ending' ? '' : undefined}
          inert={guard.kind === 'ending'}
        >
          {children}
        </div>
      ) : guard.kind === 'checking' ? (
        <div data-session-checking data-session-blank={guard.silent ? '' : undefined}>
          {guard.silent ? null : <LoadingStage />}
        </div>
      ) : guard.kind === 'closing' ? (
        <div data-session-closing>
          <AccessLanding closing={{ reason: guard.reason }} />
        </div>
      ) : (
        <div data-session-lock>
          <AccessLanding
            recovery={{
              reason: guard.reason,
              retryable: guard.retryable,
              onRetry: () => retryVerificationRef.current(),
            }}
          />
        </div>
      )}
      {guard.kind === 'ending' ? (
        <p data-session-ending-status role="status" aria-live="polite">
          <span aria-hidden="true" />
          Cerrando tu sesión…
        </p>
      ) : null}
      <form
        ref={inactivityFormRef}
        action={`${studioApi.apiUrl}/studio/v1/auth/logout`}
        method="post"
        hidden
      >
        <input type="hidden" name="reason" value="inactivity" />
      </form>
    </>
  )
}
