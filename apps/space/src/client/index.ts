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
 * rebuild the disclosure the server went to some trouble to prevent. For the
 * same reason 503 and anything unexpected collapse into `unavailable`: the only
 * sensible response to either is to offer a retry.
 *
 * Where the API lives is resolved, not assumed. `localhost` on a physical device
 * means the device, not the machine running the API, so a hardcoded default
 * works in the simulator and fails on a phone with what reads as an offline
 * error. Metro already solved this: `hostUri` is the address the bundle was
 * fetched from — localhost in the simulator, the LAN address on a device — so
 * one build works in both with no configuration and no IP to update.
 * `EXPO_PUBLIC_API_URL` wins when set. A release build has neither, and rather
 * than guess localhost and ship an app that calls the handset itself, it throws
 * at startup: that reaches us as a crash in QA instead of reaching every user as
 * "no internet". The variable is supplied per EAS build profile.
 *
 * `AbortSignal.timeout` is absent from the React Native runtime, so the timeout
 * is driven by a controller. Without one a request on a dead network hangs until
 * the platform gives up, which on cellular is a minute of spinner.
 */

import Constants from 'expo-constants'

import type { AllfitV1Schemas } from '@allfitone/contracts'

import { readJsonBody } from './response'
import { captureSpaceApiRequest, captureSpaceTelemetry, spaceTelemetryCommon } from './telemetry'

export type RegistrationAccepted = AllfitV1Schemas['SpaceRegistrationAccepted']
export type SessionTokens = AllfitV1Schemas['SpaceSessionTokens']
export type SessionRefreshed = AllfitV1Schemas['SpaceSessionRefreshed']

export { ApiError, type ApiFailure } from './api-error'
import { ApiError, type ApiFailure } from './api-error'

/** The port the API listens on. Only the host varies between simulator and device. */
const API_PORT = 8080

function resolveBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL
  if (configured) return configured

  const hostUri = Constants.expoConfig?.hostUri
  const host = hostUri?.split(':')[0]
  if (host) return `http://${host}:${API_PORT}`

  // Nothing configured and no Metro host to borrow: in a release build that is
  // a missing variable, and guessing would be worse than failing.
  if (!__DEV__) throw new Error('EXPO_PUBLIC_API_URL is not set')

  return `http://localhost:${API_PORT}`
}

const BASE_URL = resolveBaseUrl()

/**
 * Where the API is, for the one thing that is fetched by the platform and not by us.
 *
 * `expo-image` loads its own bytes, so a cover photograph cannot go through the helpers
 * below: the screen hands it a uri and the bearer header instead. `ADR-031` serves the
 * bytes through the API, so there is no public url to point at.
 */
export function apiBaseUrl(): string {
  return BASE_URL
}

/** Long enough for a cold provider call, short enough to not feel hung. */
const TIMEOUT_MS = 15_000

function timeoutSignal(ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, done: () => clearTimeout(timer) }
}

async function post<T>(
  path: string,
  body: unknown,
  operation:
    | 'space.auth.registration'
    | 'space.auth.registration_verification'
    | 'space.auth.session'
    | 'space.auth.session_refresh'
    | 'space.auth.password_reset',
): Promise<T> {
  const { signal, done } = timeoutSignal(TIMEOUT_MS)
  const startedAt = Date.now()
  let response: Response | undefined
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    // Offline, DNS or timeout: indistinguishable from here, identical in
    // consequence.
    throw new ApiError('unavailable')
  } finally {
    done()
    captureSpaceApiRequest({
      operation,
      durationMs: Date.now() - startedAt,
      ...(response ? { response } : {}),
    })
  }

  if (!response.ok) throw new ApiError(failureFor(response.status))

  return (await readJsonBody<T>(response)) as T
}

function failureFor(status: number): ApiFailure {
  if (status === 400) return 'invalid-request'
  if (status === 401) return 'unauthenticated'
  if (status === 404) return 'not-found'
  if (status === 409) return 'conflict'
  if (status === 422) return 'validation-failed'
  return 'unavailable'
}

export function register(email: string, password: string): Promise<RegistrationAccepted> {
  const startedAt = Date.now()
  return post<RegistrationAccepted>(
    '/space/v1/auth/registrations',
    { email, password },
    'space.auth.registration',
  ).then((result) => {
    captureSpaceTelemetry({
      event: 'product.flow_step.completed.v1',
      properties: {
        ...spaceTelemetryCommon(),
        flow: 'space.registration',
        step: 'registration_requested',
        outcome: 'success',
        duration_ms: Date.now() - startedAt,
      },
    })
    return result
  })
}

export async function verifyRegistration(
  email: string,
  password: string,
  code: string,
): Promise<SessionTokens> {
  const startedAt = Date.now()
  const result = await post<SessionTokens>(
    '/space/v1/auth/registrations/verification',
    { email, password, code },
    'space.auth.registration_verification',
  )
  captureSpaceTelemetry({
    event: 'product.flow_step.completed.v1',
    properties: {
      ...spaceTelemetryCommon(),
      flow: 'space.registration',
      step: 'session_issued',
      outcome: 'success',
      duration_ms: Date.now() - startedAt,
    },
  })
  return result
}

export async function signIn(email: string, password: string): Promise<SessionTokens> {
  const startedAt = Date.now()
  const result = await post<SessionTokens>(
    '/space/v1/auth/sessions',
    { email, password },
    'space.auth.session',
  )
  captureSpaceTelemetry({
    event: 'product.flow_step.completed.v1',
    properties: {
      ...spaceTelemetryCommon(),
      flow: 'space.sign_in',
      step: 'session_issued',
      outcome: 'success',
      duration_ms: Date.now() - startedAt,
    },
  })
  return result
}

/** Rotates the pair. A 401 here means the session is gone, not that it degraded. */
export function refreshSession(refreshToken: string): Promise<SessionRefreshed> {
  return post<SessionRefreshed>(
    '/space/v1/auth/sessions/refresh',
    { refreshToken },
    'space.auth.session_refresh',
  )
}

/**
 * Authenticated POST. Command headers travel here because almost every authenticated
 * command in this contract carries them.
 *
 * `undefined` is for the ones that do not, and there is exactly one: skipping an
 * onboarding step, whose idempotency is the primary key of the record rather than a
 * durable receipt. Sending headers the route does not read would be noise on the
 * wire pretending to be a guarantee.
 */
export async function authorizedPost<T>(
  path: string,
  command: { idempotencyKey: string; commandId: string } | undefined,
  body: unknown,
  token?: string,
  ifMatch?: string,
): Promise<T> {
  const { signal, done } = timeoutSignal(TIMEOUT_MS)
  let response: Response | undefined
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(command
          ? { 'Idempotency-Key': command.idempotencyKey, 'Command-Id': command.commandId }
          : {}),
        // Publishing is a precondition on the draft, not on a revision: an etag is
        // what says which draft this press meant.
        ...(ifMatch === undefined ? {} : { 'If-Match': ifMatch }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    })
  } catch {
    throw new ApiError('unavailable')
  } finally {
    done()
  }

  if (!response.ok) throw new ApiError(failureFor(response.status))

  return (await readJsonBody<T>(response)) as T
}

/**
 * Authenticated PUT, optionally with a precondition.
 *
 * `If-Match` carries the revision the client believes it is editing, for the
 * resources that have one. It is a precondition on the resource, not a field of the
 * body: in the body a client could send one number and mean another, and the server
 * would have no way to tell.
 *
 * It is omitted where there is no revision to carry — reordering a list has no
 * optimistic lock because the whole list is the write, and sending a made-up number
 * would be worse than sending none.
 */
export async function authorizedPut<T>(
  path: string,
  command: { idempotencyKey: string; commandId: string },
  body: unknown,
  token: string | undefined,
  ifMatch?: number | string,
): Promise<T> {
  const { signal, done } = timeoutSignal(TIMEOUT_MS)
  let response: Response | undefined
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': command.idempotencyKey,
        'Command-Id': command.commandId,
        ...(ifMatch === undefined ? {} : { 'If-Match': String(ifMatch) }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    throw new ApiError('unavailable')
  } finally {
    done()
  }

  if (!response.ok) throw new ApiError(failureFor(response.status))

  return (await readJsonBody<T>(response)) as T
}

/**
 * Authenticated GET. No command headers: a read is not a command, and sending
 * them would claim an idempotency key for something that changes nothing.
 */
/**
 * `OP-IDN-048`. Resolves whatever happens, because the operation has no rejection and
 * the device erases regardless — see `sign-out.ts`.
 */
export async function revokeSpaceSession(token: string | undefined): Promise<void> {
  const { signal, done } = timeoutSignal(TIMEOUT_MS)
  try {
    await fetch(`${BASE_URL}/space/v1/auth/sessions`, {
      method: 'DELETE',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal,
    })
  } catch {
    // Deliberate. A phone with no network still has to be able to sign out.
  } finally {
    done()
  }
}

export async function authorizedGet<T>(path: string, token?: string): Promise<T> {
  const { signal, done } = timeoutSignal(TIMEOUT_MS)
  let response: Response | undefined
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: 'GET',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal,
    })
  } catch {
    throw new ApiError('unavailable')
  } finally {
    done()
  }

  if (!response.ok) throw new ApiError(failureFor(response.status))

  return (await readJsonBody<T>(response)) as T
}

/** Resolves for an unknown address too: the API answers 202 either way. */
export async function requestPasswordReset(email: string): Promise<void> {
  const startedAt = Date.now()
  await post<null>('/space/v1/auth/password-resets', { email }, 'space.auth.password_reset')
  captureSpaceTelemetry({
    event: 'product.flow_step.completed.v1',
    properties: {
      ...spaceTelemetryCommon(),
      flow: 'space.password_reset',
      step: 'password_reset_requested',
      outcome: 'success',
      duration_ms: Date.now() - startedAt,
    },
  })
}
