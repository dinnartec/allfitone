export const STUDIO_IDLE_TIMEOUT_MS = 30 * 60 * 1000

const STORAGE_KEY = 'allfit-studio-session:v1'
const AUTHENTICATED_EVENT = 'allfit:studio-authenticated'
const UNAUTHENTICATED_EVENT = 'allfit:studio-unauthenticated'
const LOGOUT_EVENT = 'allfit:studio-logout'

export type StudioSessionActivity =
  | { version: 1; status: 'active'; lastActivityAt: number }
  | {
      version: 1
      status: 'ended'
      endedAt: number
      confirmedAt?: number
      reason?: StudioSessionEndReason
    }

export type StudioSessionEndReason = 'inactivity' | 'manual' | 'unknown'

export function notifyStudioAuthenticated(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(AUTHENTICATED_EVENT))
}

export function notifyStudioUnauthenticated(): void {
  if (typeof window === 'undefined') return
  const stored = readStudioSessionActivity()
  writeStudioSessionActivity({
    version: 1,
    status: 'ended',
    endedAt: stored?.status === 'ended' ? stored.endedAt : Date.now(),
    confirmedAt: Date.now(),
    ...(stored?.status === 'ended' && stored.reason ? { reason: stored.reason } : {}),
  })
  delete document.documentElement.dataset.sessionLocked
  window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT))
}

export function announceStudioLogout(reason: StudioSessionEndReason = 'manual'): void {
  if (typeof window === 'undefined') return
  // A manual logout is the present person's own request on their own screen, so the
  // workspace goes inert and illegible instead of vanishing. Every other reason means
  // nobody asked and nobody may be watching: hide the content outright.
  if (reason !== 'manual') document.documentElement.dataset.sessionLocked = 'true'
  writeStudioSessionActivity({ version: 1, status: 'ended', endedAt: Date.now(), reason })
  clearStudioSessionCaches()
  window.dispatchEvent(new Event(LOGOUT_EVENT))
}

export function prepareStudioAuthentication(): void {
  clearStudioSessionActivity()
}

export function clearStudioSessionActivity(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // A disabled store must not block authentication.
  }
}

export function readStudioSessionActivity(): StudioSessionActivity | undefined {
  if (typeof window === 'undefined') return undefined
  let raw: string | null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return undefined
  }
  return parseStudioSessionActivity(raw)
}

export function writeStudioSessionActivity(record: StudioSessionActivity): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
  } catch {
    // The in-memory idle guard remains active when storage is unavailable.
  }
}

export function parseStudioSessionActivity(raw: string | null): StudioSessionActivity | undefined {
  if (!raw) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return undefined
    const candidate = parsed as Record<string, unknown>
    if (candidate.version !== 1) return undefined
    if (
      candidate.status === 'active' &&
      typeof candidate.lastActivityAt === 'number' &&
      Number.isFinite(candidate.lastActivityAt)
    ) {
      return { version: 1, status: 'active', lastActivityAt: candidate.lastActivityAt }
    }
    if (
      candidate.status === 'ended' &&
      typeof candidate.endedAt === 'number' &&
      Number.isFinite(candidate.endedAt) &&
      (candidate.reason === undefined ||
        candidate.reason === 'inactivity' ||
        candidate.reason === 'manual' ||
        candidate.reason === 'unknown') &&
      (candidate.confirmedAt === undefined ||
        (typeof candidate.confirmedAt === 'number' && Number.isFinite(candidate.confirmedAt)))
    ) {
      return {
        version: 1,
        status: 'ended',
        endedAt: candidate.endedAt,
        ...(candidate.confirmedAt === undefined ? {} : { confirmedAt: candidate.confirmedAt }),
        ...(candidate.reason === undefined ? {} : { reason: candidate.reason }),
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

export const studioSessionEvents = {
  authenticated: AUTHENTICATED_EVENT,
  unauthenticated: UNAUTHENTICATED_EVENT,
  logout: LOGOUT_EVENT,
  storageKey: STORAGE_KEY,
} as const

function clearStudioSessionCaches(): void {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index)
      if (key?.startsWith('allfit-studio:')) sessionStorage.removeItem(key)
    }
  } catch {
    // Cached catalog data is optional and never blocks logout.
  }
}
