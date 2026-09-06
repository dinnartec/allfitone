import type { AllfitV1Schemas } from '@allfitone/contracts'
import type { ClientOperation } from '@allfitone/telemetry'

import { captureBackofficeApiRequest, setBackofficeTelemetryIdentity } from './telemetry'

export type BackofficeAuthenticationAttempt = AllfitV1Schemas['BackofficeAuthenticationAttempt']
export type BackofficeSession = AllfitV1Schemas['BackofficeSession']
export type BackofficeLogoutReason = 'manual' | 'inactivity' | 'recovery'
export type PlatformRoleAssignment = AllfitV1Schemas['PlatformRoleAssignment']
export type PlatformDutyAssignment = AllfitV1Schemas['PlatformDutyAssignment']
export type PlatformDutyCode = AllfitV1Schemas['PlatformDutyCode']
export type PlatformRoleAssignmentPage = AllfitV1Schemas['PlatformRoleAssignmentPage']
export type PlatformDutyAssignmentPage = AllfitV1Schemas['PlatformDutyAssignmentPage']

export interface PlatformDutyFilters {
  personId?: string
  dutyCode?: PlatformDutyCode
  status?: PlatformDutyAssignment['status']
  cursor?: string
}

export interface BackofficeCommand {
  idempotencyKey: string
  commandId: string
}

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080').replace(/\/$/, '')

export class BackofficeApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAfterMs?: number,
  ) {
    super(code)
    this.name = 'BackofficeApiError'
  }
}

export class BackofficeNetworkError extends Error {
  constructor() {
    super('network-unavailable')
    this.name = 'BackofficeNetworkError'
  }
}

export const backofficeApi = {
  apiUrl: API_URL,

  password: (email: string, password: string) =>
    requestJson<BackofficeAuthenticationAttempt>('/backoffice/v1/auth/password', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  attempt: (signal?: AbortSignal) =>
    requestJson<BackofficeAuthenticationAttempt>(
      '/backoffice/v1/auth/attempt',
      signal ? { signal } : {},
    ),

  verifyTotp: (code: string, command: BackofficeCommand) =>
    requestVoid('/backoffice/v1/auth/totp/verification', {
      method: 'POST',
      headers: commandHeaders(command),
      body: JSON.stringify({ code }),
    }),

  session: async (signal?: AbortSignal) => {
    const session = await requestJson<BackofficeSession>(
      '/backoffice/v1/session',
      signal ? { signal } : {},
    )
    setBackofficeTelemetryIdentity(session.analytics?.distinct_id ?? null)
    return session
  },

  logout: async (reason: BackofficeLogoutReason) => {
    await requestVoid('/backoffice/v1/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ reason }),
    })
    setBackofficeTelemetryIdentity(null)
  },

  platformRoles: (cursor?: string, signal?: AbortSignal) =>
    requestJson<PlatformRoleAssignmentPage>(
      `/backoffice/v1/platform/role-assignments${query({ cursor })}`,
      signal ? { signal } : {},
    ),

  platformDuties: (filters: PlatformDutyFilters = {}, signal?: AbortSignal) =>
    requestJson<PlatformDutyAssignmentPage>(
      `/backoffice/v1/platform/duty-assignments${query({
        person_id: filters.personId,
        duty_code: filters.dutyCode,
        status: filters.status,
        cursor: filters.cursor,
      })}`,
      signal ? { signal } : {},
    ),

  grantPlatformRole: (personId: string, command: BackofficeCommand) =>
    requestJson<PlatformRoleAssignment>('/backoffice/v1/platform/role-assignments', {
      method: 'POST',
      headers: commandHeaders(command),
      body: JSON.stringify({ person_id: personId, platform_role: 'allfit_admin' }),
    }),

  revokePlatformRole: (assignmentId: string, command: BackofficeCommand) =>
    requestJson<PlatformRoleAssignment>(
      `/backoffice/v1/platform/role-assignments/${assignmentId}/revocation`,
      { method: 'POST', headers: commandHeaders(command), body: '{}' },
    ),

  grantPlatformDuty: (
    input: { personId: string; dutyCode: PlatformDutyCode; validTo: string; reasonCode: string },
    command: BackofficeCommand,
  ) =>
    requestJson<PlatformDutyAssignment>('/backoffice/v1/platform/duty-assignments', {
      method: 'POST',
      headers: commandHeaders(command),
      body: JSON.stringify({
        person_id: input.personId,
        duty_code: input.dutyCode,
        valid_to: input.validTo,
        reason_code: input.reasonCode,
      }),
    }),

  suspendPlatformDuty: (assignmentId: string, command: BackofficeCommand) =>
    requestJson<PlatformDutyAssignment>(
      `/backoffice/v1/platform/duty-assignments/${assignmentId}/suspension`,
      { method: 'POST', headers: commandHeaders(command), body: '{}' },
    ),

  revokePlatformDuty: (assignmentId: string, command: BackofficeCommand) =>
    requestJson<PlatformDutyAssignment>(
      `/backoffice/v1/platform/duty-assignments/${assignmentId}/revocation`,
      { method: 'POST', headers: commandHeaders(command), body: '{}' },
    ),

  passwordReset: (email: string) =>
    requestVoid('/backoffice/v1/auth/password-resets', {
      method: 'POST',
      body: JSON.stringify({ email }),
      acceptedStatus: 202,
    }),
}

export function newBackofficeCommand(): BackofficeCommand {
  return { idempotencyKey: crypto.randomUUID(), commandId: uuidV7() }
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000)
  const date = Date.parse(value)
  if (!Number.isFinite(date)) return undefined
  return Math.max(0, date - now)
}

function uuidV7(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let timestamp = Date.now()
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp & 0xff
    timestamp = Math.floor(timestamp / 256)
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetchApi(path, init)
  return (await response.json()) as T
}

async function requestVoid(
  path: string,
  init: RequestInit & { acceptedStatus?: number } = {},
): Promise<void> {
  const { acceptedStatus, ...requestInit } = init
  const response = await fetchApi(path, requestInit)
  if (acceptedStatus !== undefined && response.status !== acceptedStatus) {
    throw await responseError(response)
  }
}

async function fetchApi(path: string, init: RequestInit): Promise<Response> {
  const startedAt = performance.now()
  const method = requestMethod(init.method)
  const operation = backofficeOperation(path)
  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  } catch (error) {
    captureBackofficeApiRequest({
      operation,
      method,
      durationMs: performance.now() - startedAt,
    })
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new BackofficeNetworkError()
  }
  captureBackofficeApiRequest({
    operation,
    method,
    durationMs: performance.now() - startedAt,
    response,
  })
  if (!response.ok) {
    if (response.status === 401) setBackofficeTelemetryIdentity(null)
    throw await responseError(response)
  }
  return response
}

function requestMethod(method: string | undefined): 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT' {
  return method === 'DELETE' || method === 'PATCH' || method === 'POST' || method === 'PUT'
    ? method
    : 'GET'
}

function backofficeOperation(path: string): ClientOperation {
  const operations: Record<string, ClientOperation> = {
    '/backoffice/v1/auth/password': 'backoffice.auth.password',
    '/backoffice/v1/auth/attempt': 'backoffice.auth.attempt',
    '/backoffice/v1/auth/totp/verification': 'backoffice.auth.totp_verification',
    '/backoffice/v1/session': 'backoffice.session',
    '/backoffice/v1/auth/logout': 'backoffice.auth.logout',
    '/backoffice/v1/auth/password-resets': 'backoffice.auth.password_reset',
  }
  const [route] = path.split('?')
  const platform = platformOperation(route ?? path)
  return platform ?? operations[route ?? path] ?? 'backoffice.session'
}

/** Assignment identifiers vary per row, so these routes are matched by shape. */
function platformOperation(route: string): ClientOperation | undefined {
  const segments = route.split('/').filter(Boolean)
  if (segments[0] !== 'backoffice' || segments[1] !== 'v1' || segments[2] !== 'platform') {
    return undefined
  }
  const resource = segments[3]
  const action = segments[5]
  if (segments.length === 4) {
    if (resource === 'role-assignments') return 'backoffice.platform.role_list'
    if (resource === 'duty-assignments') return 'backoffice.platform.duty_list'
    return undefined
  }
  if (segments.length !== 6) return undefined
  if (resource === 'role-assignments' && action === 'revocation') {
    return 'backoffice.platform.role_revoke'
  }
  if (resource === 'duty-assignments' && action === 'suspension') {
    return 'backoffice.platform.duty_suspend'
  }
  if (resource === 'duty-assignments' && action === 'revocation') {
    return 'backoffice.platform.duty_revoke'
  }
  return undefined
}

async function responseError(response: Response): Promise<BackofficeApiError> {
  const payload: unknown = await response.json().catch(() => undefined)
  return new BackofficeApiError(
    response.status,
    errorCode(payload) ?? `http-${response.status}`,
    parseRetryAfter(response.headers.get('Retry-After')),
  )
}

function commandHeaders(command: BackofficeCommand): HeadersInit {
  return {
    'Idempotency-Key': command.idempotencyKey,
    'Command-Id': command.commandId,
  }
}

function errorCode(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  if ('error' in value) {
    const error = value.error
    if (!error || typeof error !== 'object' || !('code' in error)) return undefined
    return typeof error.code === 'string' ? error.code : undefined
  }
  // RFC 9457: the code is the last segment of the problem type.
  if ('type' in value && typeof value.type === 'string') {
    const code = value.type.split('/').pop()
    return code && code.length > 0 ? code : undefined
  }
  return undefined
}

/** Absent filters are omitted, so an empty value never becomes a literal filter. */
function query(parameters: Record<string, string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== '') search.set(key, value)
  }
  const serialized = search.toString()
  return serialized ? `?${serialized}` : ''
}
