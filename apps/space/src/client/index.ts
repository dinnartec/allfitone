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

import {
  captureSpaceApiRequest,
  captureSpaceTelemetry,
  setSpaceTelemetryIdentity,
  spaceTelemetryCommon,
} from './telemetry'

export type RegistrationAccepted = AllfitV1Schemas['SpaceRegistrationAccepted']
export type SessionTokens = AllfitV1Schemas['SpaceSessionTokens']

export type ApiFailure =
  /** The request was malformed. Only reachable if client validation drifts. */
  | 'invalid-request'
  /** Wrong code, wrong password, unknown address — one answer, by design. */
  | 'unauthenticated'
  /** Too short for the provider's floor, or known to be breached. */
  | 'weak-password'
  /** The API or the provider did not answer. Retryable; nothing else is. */
  | 'unavailable'

export class ApiError extends Error {
  constructor(readonly failure: ApiFailure) {
    super(failure)
    this.name = 'ApiError'
  }
}

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
  operation: 'space.auth.registration' | 'space.auth.registration_verification',
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

  return (await response.json()) as T
}

function failureFor(status: number): ApiFailure {
  if (status === 400) return 'invalid-request'
  if (status === 401) return 'unauthenticated'
  if (status === 422) return 'weak-password'
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
  await setSpaceTelemetryIdentity(result.analytics.distinct_id)
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
