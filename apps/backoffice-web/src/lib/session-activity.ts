export const BACKOFFICE_HEARTBEAT_INTERVAL_MS = 60 * 1000

const STORAGE_KEY = 'allfit-backoffice-session:v1'

export type BackofficeSessionEndReason = 'manual' | 'inactivity' | 'unknown'

export type BackofficeSessionActivity =
  | {
      version: 1
      status: 'active'
      lastVerifiedAt: number
      inactivityExpiresAt: number
      absoluteExpiresAt: number
    }
  | {
      version: 1
      status: 'ended'
      endedAt: number
      reason: BackofficeSessionEndReason
      confirmedAt?: number
    }

export function activeSessionActivity(input: {
  inactivityExpiresAt: string
  absoluteExpiresAt: string
  verifiedAt?: number
}): Extract<BackofficeSessionActivity, { status: 'active' }> {
  return {
    version: 1,
    status: 'active',
    lastVerifiedAt: input.verifiedAt ?? Date.now(),
    inactivityExpiresAt: Date.parse(input.inactivityExpiresAt),
    absoluteExpiresAt: Date.parse(input.absoluteExpiresAt),
  }
}

export function sessionDeadline(
  record: Extract<BackofficeSessionActivity, { status: 'active' }>,
): number {
  return Math.min(record.inactivityExpiresAt, record.absoluteExpiresAt)
}

export function readBackofficeSessionActivity(): BackofficeSessionActivity | undefined {
  if (typeof localStorage === 'undefined') return undefined
  try {
    return parseBackofficeSessionActivity(localStorage.getItem(STORAGE_KEY))
  } catch {
    return undefined
  }
}

export function writeBackofficeSessionActivity(record: BackofficeSessionActivity): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
  } catch {
    // In-memory session enforcement remains active when storage is unavailable.
  }
}

export function clearBackofficeSessionActivity(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // A disabled store must not block authentication.
  }
}

export function parseBackofficeSessionActivity(
  raw: string | null,
): BackofficeSessionActivity | undefined {
  if (!raw) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return undefined
    const candidate = parsed as Record<string, unknown>
    if (candidate.version !== 1) return undefined
    if (
      candidate.status === 'active' &&
      finiteNumber(candidate.lastVerifiedAt) &&
      finiteNumber(candidate.inactivityExpiresAt) &&
      finiteNumber(candidate.absoluteExpiresAt)
    ) {
      return {
        version: 1,
        status: 'active',
        lastVerifiedAt: candidate.lastVerifiedAt,
        inactivityExpiresAt: candidate.inactivityExpiresAt,
        absoluteExpiresAt: candidate.absoluteExpiresAt,
      }
    }
    if (
      candidate.status === 'ended' &&
      finiteNumber(candidate.endedAt) &&
      (candidate.reason === 'manual' ||
        candidate.reason === 'inactivity' ||
        candidate.reason === 'unknown') &&
      (candidate.confirmedAt === undefined || finiteNumber(candidate.confirmedAt))
    ) {
      return {
        version: 1,
        status: 'ended',
        endedAt: candidate.endedAt,
        reason: candidate.reason,
        ...(candidate.confirmedAt === undefined ? {} : { confirmedAt: candidate.confirmedAt }),
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

export const backofficeSessionStorageKey = STORAGE_KEY

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
