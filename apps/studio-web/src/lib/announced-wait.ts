'use client'

import { useEffect, useState } from 'react'

/**
 * Waits shorter than a blink should not be announced.
 *
 * Studio resolves most entries without touching the network — a confirmed 401 is
 * remembered, so a reload knows where it is going before the first frame is
 * done. Painting a loading card for that reads as a glitch rather than as
 * progress: it appears and vanishes, and the eye registers the flicker without
 * ever registering the message.
 *
 * A wait long enough to feel is the opposite: saying nothing there leaves a
 * blank screen that looks broken. So the indicator is not removed, only delayed
 * until the wait has earned it.
 */
const DEFAULT_DELAY_MS = 300

export function useAnnouncedWait(pending: boolean, delayMs: number = DEFAULT_DELAY_MS): boolean {
  const [elapsed, setElapsed] = useState(false)

  useEffect(() => {
    if (!pending) {
      setElapsed(false)
      return
    }
    const timer = setTimeout(() => setElapsed(true), delayMs)
    return () => clearTimeout(timer)
  }, [pending, delayMs])

  return pending && elapsed
}
