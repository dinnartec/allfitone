/**
 * The countdown between sets (ADR-035).
 *
 * **It is measured from when it ends, not counted down.** A counter that loses a second
 * per tick loses every tick the phone slept through; the end time does not move, so a
 * screen that comes back after a minute in a pocket shows a minute less. It is the same
 * reason the session's own clock is measured from its start.
 *
 * **It belongs to the phone, not to the session record.** The rest actually taken is not
 * stored in V1, so there is nothing to send: the countdown lives here, kept per session
 * so that setting the session aside and coming back does not lose it.
 */

export interface Rest {
  /** When it is over, in epoch milliseconds. */
  readonly endsAt: number
  /** How long it is in all, in seconds: what a progress bar is drawn against. */
  readonly total: number
}

export function started(now: number, seconds: number): Rest {
  return { endsAt: now + seconds * 1000, total: seconds }
}

/** Seconds left, never below zero. */
export function remaining(rest: Rest, now: number): number {
  return Math.max(0, (rest.endsAt - now) / 1000)
}

/** Fifteen seconds more or less of what is left; less than nothing is finished. */
export function adjusted(rest: Rest, seconds: number, now: number): Rest {
  const left = Math.max(0, remaining(rest, now) + seconds)
  return { endsAt: now + left * 1000, total: Math.max(rest.total + seconds, left) }
}

/** «1:30». Rounded up, so the label reads 0:00 only when it really is over. */
export function countdownLabel(seconds: number): string {
  const whole = Math.ceil(seconds)
  const minutes = Math.floor(whole / 60)
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`
}

const running = new Map<string, Rest>()

/** Kept for the process, so leaving the screen and coming back finds it still going. */
export function rememberRest(executionId: string, rest: Rest | undefined): void {
  if (rest) running.set(executionId, rest)
  else running.delete(executionId)
}

/** The one still going for this session, or nothing once it is over. */
export function restFor(executionId: string, now: number): Rest | undefined {
  const rest = running.get(executionId)
  if (!rest || remaining(rest, now) <= 0) return undefined
  return rest
}
