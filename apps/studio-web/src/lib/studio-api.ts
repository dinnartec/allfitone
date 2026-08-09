import type { AllfitV1Schemas } from '@allfitone/contracts'

export type StudioSession = AllfitV1Schemas['StudioSession']
export type OnboardingAttempt = AllfitV1Schemas['StudioOnboardingAttempt']
export type AdultEligibilityEvidence = AllfitV1Schemas['AdultEligibilityEvidence']
export type Membership = AllfitV1Schemas['StudioMembership']
export type OrganizationType = AllfitV1Schemas['OrganizationType']
export type OrganizationCreate = AllfitV1Schemas['OrganizationCreate']
export type OrganizationCreated = AllfitV1Schemas['OrganizationCreated']
export type Completion = AllfitV1Schemas['StudioOnboardingCompletion']

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080').replace(/\/$/, '')

export class StudioApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
    this.name = 'StudioApiError'
  }
}

export const studioApi = {
  apiUrl: API_URL,

  session: () => request<StudioSession>('/studio/v1/session'),

  startAttempt: (command: CommandHeaders) =>
    request<OnboardingAttempt>('/studio/v1/onboarding-attempts', {
      method: 'POST',
      headers: commandHeaders(command),
    }),

  recordAdultEligibility: (attemptId: string, declaredAdult: boolean, command: CommandHeaders) =>
    request<AdultEligibilityEvidence>(
      `/studio/v1/onboarding-attempts/${attemptId}/eligibility-evidence`,
      {
        method: 'POST',
        headers: commandHeaders(command),
        body: JSON.stringify({ declared_adult: declaredAdult }),
      },
    ),

  completeOnboarding: (attemptId: string, body: Completion, command: CommandHeaders) =>
    request<AllfitV1Schemas['StudioOnboardingCompletionResult']>(
      `/studio/v1/onboarding-attempts/${attemptId}/completion`,
      {
        method: 'POST',
        headers: commandHeaders(command),
        body: JSON.stringify(body),
      },
    ),

  memberships: () => request<AllfitV1Schemas['StudioMembershipList']>('/studio/v1/me/memberships'),

  organizationTypes: () =>
    request<AllfitV1Schemas['OrganizationTypeList']>('/studio/v1/organization-types'),

  createOrganization: (body: OrganizationCreate, command: CommandHeaders) =>
    request<OrganizationCreated>('/studio/v1/organizations', {
      method: 'POST',
      headers: commandHeaders(command),
      body: JSON.stringify(body),
    }),
}

export interface CommandHeaders {
  idempotencyKey: string
  commandId: string
}

export function newCommand(): CommandHeaders {
  return { idempotencyKey: crypto.randomUUID(), commandId: uuidV7() }
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined)
    const code = errorCode(payload) ?? `http-${response.status}`
    throw new StudioApiError(response.status, code)
  }
  return (await response.json()) as T
}

function commandHeaders(command: CommandHeaders): HeadersInit {
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
