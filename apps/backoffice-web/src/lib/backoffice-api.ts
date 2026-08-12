import type { AllfitV1Schemas } from '@allfitone/contracts'

export type BackofficeAuthenticationAttempt = AllfitV1Schemas['BackofficeAuthenticationAttempt']
export type BackofficeSession = AllfitV1Schemas['BackofficeSession']
export type BackofficeLogoutReason = 'manual' | 'inactivity' | 'recovery'

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

  session: (signal?: AbortSignal) =>
    requestJson<BackofficeSession>('/backoffice/v1/session', signal ? { signal } : {}),

  logout: (reason: BackofficeLogoutReason) =>
    requestVoid('/backoffice/v1/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

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
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new BackofficeNetworkError()
  }
  if (!response.ok) throw await responseError(response)
  return response
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
  if (!value || typeof value !== 'object' || !('error' in value)) return undefined
  const error = value.error
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}
