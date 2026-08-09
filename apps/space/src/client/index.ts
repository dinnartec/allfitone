/**
 * HTTP client for `/space/v1`.
 *
 * Types come from `@allfitone/contracts`, generated from the OpenAPI document.
 * Space is a client repository: it never declares a domain shape by hand, so a
 * contract change surfaces here as a type error rather than at runtime.
 *
 * Errors are narrowed to what a screen can act on. The API deliberately answers
 * identically for cases a caller must not distinguish — a wrong code and an
 * unknown address are both `unauthenticated` — and widening that here would
 * rebuild the disclosure the server went to some trouble to prevent.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type RegistrationAccepted = AllfitV1Schemas['SpaceRegistrationAccepted']
export type SessionTokens = AllfitV1Schemas['SpaceSessionTokens']

export type ApiFailure =
  /** The request was malformed. Only reachable if client validation drifts. */
  | 'invalid-request'
  /** Wrong code, wrong password, unknown address — one answer, by design. */
  | 'unauthenticated'
  /**
   * The password was refused: too short for the provider's floor, or known to
   * be breached. The one failure worth naming precisely — it describes the
   * secret just chosen, not whether anyone else has an account.
   */
  | 'weak-password'
  /** The API or the provider did not answer. Retryable; nothing else is. */
  | 'unavailable'

export class ApiError extends Error {
  constructor(readonly failure: ApiFailure) {
    super(failure)
    this.name = 'ApiError'
  }
}

/**
 * The simulator reaches the host on localhost; a device needs the host's LAN
 * address, which is why this is configurable rather than hardcoded.
 */
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080'

/** Long enough for a cold provider call, short enough to not feel hung. */
const TIMEOUT_MS = 15_000

/**
 * `AbortSignal.timeout` is not in the React Native runtime, so the timeout is
 * driven by a controller. Without one a request on a dead network hangs until
 * the platform gives up, which on cellular can be a minute of a spinner.
 */
function timeoutSignal(ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, done: () => clearTimeout(timer) }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const { signal, done } = timeoutSignal(TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    // No response at all: offline, DNS, timeout. Indistinguishable from here
    // and identical in consequence — try again.
    throw new ApiError('unavailable')
  } finally {
    done()
  }

  if (!response.ok) throw new ApiError(failureFor(response.status))

  return (await response.json()) as T
}

function failureFor(status: number): ApiFailure {
  if (status === 400) return 'invalid-request'
  if (status === 401) return 'unauthenticated'
  if (status === 422) return 'weak-password'
  // 503 and anything unexpected are treated alike: the screen's only sensible
  // response to both is to offer a retry.
  return 'unavailable'
}

export function register(email: string, password: string): Promise<RegistrationAccepted> {
  return post<RegistrationAccepted>('/space/v1/auth/registrations', { email, password })
}

export function verifyRegistration(
  email: string,
  password: string,
  code: string,
): Promise<SessionTokens> {
  return post<SessionTokens>('/space/v1/auth/registrations/verification', {
    email,
    password,
    code,
  })
}
