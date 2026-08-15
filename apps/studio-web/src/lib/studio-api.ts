import type { AllfitV1Schemas } from '@allfitone/contracts'
import type { ClientOperation } from '@allfitone/telemetry'

import { notifyStudioAuthenticated, notifyStudioUnauthenticated } from './session-activity'
import { captureStudioApiRequest, setStudioTelemetryIdentity } from './telemetry'

export type StudioSession = AllfitV1Schemas['StudioSession']
export type StudioEntryContext = AllfitV1Schemas['StudioEntryContext']
export type OnboardingAttempt = AllfitV1Schemas['StudioOnboardingAttempt']
export type AdultEligibilityEvidence = AllfitV1Schemas['AdultEligibilityEvidence']
export type Membership = AllfitV1Schemas['StudioMembership']
export type OrganizationType = AllfitV1Schemas['OrganizationType']
export type OrganizationCreate = AllfitV1Schemas['OrganizationCreate']
export type OrganizationCreated = AllfitV1Schemas['OrganizationCreated']
export type Completion = AllfitV1Schemas['StudioOnboardingCompletion']
export type StudioMe = AllfitV1Schemas['StudioMe']
export type ProfessionalCatalogItem = AllfitV1Schemas['ProfessionalCatalogItem']
export type ProfessionalProfile = AllfitV1Schemas['ProfessionalProfile']
export type ProfessionalProfilePut = AllfitV1Schemas['ProfessionalProfilePut']
export type ProfessionalCredential = AllfitV1Schemas['ProfessionalCredential']
export type ProfessionalCredentialWrite = AllfitV1Schemas['ProfessionalCredentialWrite']
export type TeamInvitationCreate = AllfitV1Schemas['TeamInvitationCreate']
export type TeamInvitation = AllfitV1Schemas['TeamInvitation']
export type TeamInvitationPresentation = AllfitV1Schemas['TeamInvitationPresentation']
export type TeamInvitationDecisionCreate = AllfitV1Schemas['TeamInvitationDecisionCreate']
export type TeamInvitationDecisionResult = AllfitV1Schemas['TeamInvitationDecisionResult']
export type TeamInvitationPage = AllfitV1Schemas['TeamInvitationPage']
export type TeamInvitationListItem = AllfitV1Schemas['TeamInvitationListItem']
export type TeamInvitationStatus = AllfitV1Schemas['TeamInvitationStatus']
export type OrganizationMembership = AllfitV1Schemas['OrganizationMembershipListItem']
export type OrganizationMembershipPage = AllfitV1Schemas['OrganizationMembershipPage']
export type OrganizationMembershipStatus = AllfitV1Schemas['OrganizationMembershipStatus']
export type OrganizationRole = AllfitV1Schemas['OrganizationRole']
export type OrganizationRoleCatalog = AllfitV1Schemas['OrganizationRoleCatalog']
export type OrganizationRoleCode = AllfitV1Schemas['OrganizationRoleCode']

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080').replace(/\/$/, '')

export class StudioApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail?: string,
  ) {
    super(code)
    this.name = 'StudioApiError'
  }
}

export const studioApi = {
  apiUrl: API_URL,

  session: async () => {
    const session = await request<StudioSession>('/studio/v1/session')
    setStudioTelemetryIdentity(session.analytics?.distinct_id ?? null)
    return session
  },

  entryContext: async () => {
    const context = await request<StudioEntryContext>('/studio/v1/entry-context')
    setStudioTelemetryIdentity(context.analytics?.distinct_id ?? null)
    return context
  },

  startAttempt: (command: CommandHeaders, invitationToken?: string) =>
    request<OnboardingAttempt>('/studio/v1/onboarding-attempts', {
      method: 'POST',
      headers: commandHeaders(command),
      ...(invitationToken ? { body: JSON.stringify({ invitation_token: invitationToken }) } : {}),
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

  memberships: (signal?: AbortSignal) =>
    request<AllfitV1Schemas['StudioMembershipList']>(
      '/studio/v1/me/memberships',
      signal ? { signal } : {},
    ),

  organizationTypes: (signal?: AbortSignal) =>
    request<AllfitV1Schemas['OrganizationTypeList']>(
      '/studio/v1/organization-types',
      signal ? { signal } : {},
    ),

  me: (signal?: AbortSignal) => request<StudioMe>('/studio/v1/me', signal ? { signal } : {}),

  professionalSpecialties: (signal?: AbortSignal) =>
    catalogRequest<AllfitV1Schemas['ProfessionalSpecialtyList']>(
      '/studio/v1/professional-specialties',
      'professional-specialties',
      signal,
    ),

  professionalCredentialTypes: (signal?: AbortSignal) =>
    catalogRequest<AllfitV1Schemas['ProfessionalCredentialTypeList']>(
      '/studio/v1/professional-credential-types',
      'professional-credential-types',
      signal,
    ),

  updateProfessionalProfile: (body: ProfessionalProfilePut, command: CommandHeaders) =>
    request<ProfessionalProfile>('/studio/v1/me/professional-profile', {
      method: 'PUT',
      headers: commandHeaders(command),
      body: JSON.stringify(body),
    }),

  declareProfessionalCredential: (body: ProfessionalCredentialWrite, command: CommandHeaders) =>
    request<ProfessionalCredential>('/studio/v1/me/professional-credentials', {
      method: 'POST',
      headers: commandHeaders(command),
      body: JSON.stringify(body),
    }),

  reviseProfessionalCredential: (
    credentialId: string,
    body: ProfessionalCredentialWrite,
    command: CommandHeaders,
  ) =>
    request<ProfessionalCredential>(
      `/studio/v1/me/professional-credentials/${credentialId}/revisions`,
      {
        method: 'POST',
        headers: commandHeaders(command),
        body: JSON.stringify(body),
      },
    ),

  retireProfessionalCredential: (credentialId: string, command: CommandHeaders) =>
    request<ProfessionalCredential>(
      `/studio/v1/me/professional-credentials/${credentialId}/retirement`,
      {
        method: 'POST',
        headers: commandHeaders(command),
      },
    ),

  createOrganization: (body: OrganizationCreate, command: CommandHeaders) =>
    request<OrganizationCreated>('/studio/v1/organizations', {
      method: 'POST',
      headers: commandHeaders(command),
      body: JSON.stringify(body),
    }),

  createTeamInvitation: (
    organizationId: string,
    body: TeamInvitationCreate,
    command: CommandHeaders,
  ) =>
    request<TeamInvitation>(`/studio/v1/organizations/${organizationId}/invitations`, {
      method: 'POST',
      headers: commandHeaders(command),
      body: JSON.stringify(body),
    }),

  resolveTeamInvitation: (token: string) =>
    request<TeamInvitationPresentation>('/studio/v1/invitations/resolve', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  decideTeamInvitation: (body: TeamInvitationDecisionCreate, command: CommandHeaders) =>
    request<TeamInvitationDecisionResult>(
      '/studio/v1/invitations/decisions',
      {
        method: 'POST',
        headers: commandHeaders(command),
        body: JSON.stringify(body),
      },
      telemetryContext(invitationDecisionFlowStep(body.decisions[0]?.decision)),
    ),

  teamInvitations: (
    organizationId: string,
    options: { status?: TeamInvitationStatus; limit?: number; cursor?: string } = {},
    signal?: AbortSignal,
  ) => {
    const query = new URLSearchParams()
    if (options.status) query.set('status', options.status)
    if (options.limit) query.set('limit', String(options.limit))
    if (options.cursor) query.set('cursor', options.cursor)
    const suffix = query.size ? `?${query.toString()}` : ''
    return request<TeamInvitationPage>(
      `/studio/v1/organizations/${organizationId}/invitations${suffix}`,
      signal ? { signal } : {},
    )
  },

  organizationMemberships: (
    organizationId: string,
    options: { status?: OrganizationMembershipStatus; limit?: number; cursor?: string } = {},
    signal?: AbortSignal,
  ) => {
    const query = new URLSearchParams()
    if (options.status) query.set('status', options.status)
    if (options.limit) query.set('limit', String(options.limit))
    if (options.cursor) query.set('cursor', options.cursor)
    const suffix = query.size ? `?${query.toString()}` : ''
    return request<OrganizationMembershipPage>(
      `/studio/v1/organizations/${organizationId}/memberships${suffix}`,
      {
        cache: 'no-store',
        ...(signal ? { signal } : {}),
      },
    )
  },

  organizationRoles: (organizationId: string, signal?: AbortSignal) =>
    catalogRequest<OrganizationRoleCatalog>(
      `/studio/v1/organizations/${organizationId}/roles`,
      'organization-roles',
      signal,
    ),

  revokeTeamInvitation: (organizationId: string, invitationId: string, command: CommandHeaders) =>
    request<AllfitV1Schemas['TeamInvitationRevoked']>(
      `/studio/v1/organizations/${organizationId}/invitations/${invitationId}/revocation`,
      {
        method: 'POST',
        headers: commandHeaders(command),
        body: JSON.stringify({}),
      },
    ),
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

interface RequestTelemetryContext {
  flowStep?: 'invitation_accepted' | 'invitation_rejected'
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  telemetry: RequestTelemetryContext = {},
): Promise<T> {
  const response = await fetchApi(path, init, telemetry)
  if (!response.ok) throw await responseError(response)
  return (await response.json()) as T
}

const CATALOG_CACHE_VERSION = 1

interface CatalogCache<T> {
  version: typeof CATALOG_CACHE_VERSION
  etag: string
  payload: T
}

async function catalogRequest<T>(
  path: string,
  cacheName: string,
  signal?: AbortSignal,
): Promise<T> {
  const cacheKey = `allfit-studio:${cacheName}:v${CATALOG_CACHE_VERSION}`
  const cached = readCatalogCache<T>(cacheKey)
  let response = await fetchApi(path, {
    ...(cached ? { headers: { 'If-None-Match': cached.etag } } : {}),
    ...(signal ? { signal } : {}),
  })

  if (response.status === 304) {
    if (cached) return cached.payload
    response = await fetchApi(path, signal ? { signal } : {})
  }
  if (!response.ok) throw await responseError(response)

  const payload = (await response.json()) as T
  const etag = response.headers.get('ETag')
  if (etag) writeCatalogCache(cacheKey, { version: CATALOG_CACHE_VERSION, etag, payload })
  return payload
}

async function fetchApi(
  path: string,
  init: RequestInit = {},
  telemetry: RequestTelemetryContext = {},
): Promise<Response> {
  const startedAt = performance.now()
  const method = requestMethod(init.method)
  const operation = studioOperation(path, method)
  let response: Response | undefined
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
    if (response.status === 401) {
      setStudioTelemetryIdentity(null)
      notifyStudioUnauthenticated()
    } else if (response.ok) {
      notifyStudioAuthenticated()
    }
    return response
  } finally {
    if (operation) {
      captureStudioApiRequest({
        operation,
        method,
        durationMs: performance.now() - startedAt,
        ...telemetry,
        ...(response ? { response } : {}),
      })
    }
  }
}

export function invitationDecisionFlowStep(
  decision: string | undefined,
): RequestTelemetryContext['flowStep'] {
  if (decision === 'accepted') return 'invitation_accepted'
  if (decision === 'rejected') return 'invitation_rejected'
  return undefined
}

function telemetryContext(flowStep: RequestTelemetryContext['flowStep']): RequestTelemetryContext {
  return flowStep ? { flowStep } : {}
}

function requestMethod(method: string | undefined): 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT' {
  return method === 'DELETE' || method === 'PATCH' || method === 'POST' || method === 'PUT'
    ? method
    : 'GET'
}

function studioOperation(
  path: string,
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT',
): ClientOperation | undefined {
  const pathname = path.split('?')[0] ?? ''
  const exact: Record<string, ClientOperation> = {
    '/studio/v1/session': 'studio.session',
    '/studio/v1/entry-context': 'studio.entry_context',
    '/studio/v1/onboarding-attempts': 'studio.onboarding.start',
    '/studio/v1/me/memberships': 'studio.memberships',
    '/studio/v1/organization-types': 'studio.catalog.organization_types',
    '/studio/v1/me': 'studio.me',
    '/studio/v1/professional-specialties': 'studio.catalog.professional_specialties',
    '/studio/v1/professional-credential-types': 'studio.catalog.credential_types',
    '/studio/v1/me/professional-profile': 'studio.professional.profile_update',
    '/studio/v1/me/professional-credentials': 'studio.professional.credential_declare',
    '/studio/v1/organizations': 'studio.organization.create',
    '/studio/v1/invitations/resolve': 'studio.invitation.resolve',
    '/studio/v1/invitations/decisions': 'studio.invitation.decide',
  }
  if (exact[pathname]) return exact[pathname]
  if (/^\/studio\/v1\/onboarding-attempts\/[^/]+\/eligibility-evidence$/.test(pathname)) {
    return 'studio.onboarding.eligibility'
  }
  if (/^\/studio\/v1\/onboarding-attempts\/[^/]+\/completion$/.test(pathname)) {
    return 'studio.onboarding.complete'
  }
  if (/^\/studio\/v1\/me\/professional-credentials\/[^/]+\/revisions$/.test(pathname)) {
    return 'studio.professional.credential_revise'
  }
  if (/^\/studio\/v1\/me\/professional-credentials\/[^/]+\/retirement$/.test(pathname)) {
    return 'studio.professional.credential_retire'
  }
  if (/^\/studio\/v1\/organizations\/[^/]+\/memberships$/.test(pathname)) {
    return 'studio.organization.memberships'
  }
  if (/^\/studio\/v1\/organizations\/[^/]+\/roles$/.test(pathname)) {
    return 'studio.catalog.organization_roles'
  }
  if (/^\/studio\/v1\/organizations\/[^/]+\/invitations\/[^/]+\/revocation$/.test(pathname)) {
    return 'studio.invitation.revoke'
  }
  if (/^\/studio\/v1\/organizations\/[^/]+\/invitations$/.test(pathname)) {
    return method === 'POST' ? 'studio.invitation.create' : 'studio.invitation.list'
  }
  return undefined
}

async function responseError(response: Response): Promise<StudioApiError> {
  const payload = await response.json().catch(() => undefined)
  return new StudioApiError(
    response.status,
    errorCode(payload) ?? `http-${response.status}`,
    errorDetail(payload),
  )
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

function errorDetail(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('error' in value)) return undefined
  const error = value.error
  if (!error || typeof error !== 'object' || !('detail' in error)) return undefined
  return typeof error.detail === 'string' ? error.detail : undefined
}

function readCatalogCache<T>(key: string): CatalogCache<T> | undefined {
  if (typeof sessionStorage === 'undefined') return undefined
  let raw: string | null
  try {
    raw = sessionStorage.getItem(key)
  } catch {
    return undefined
  }
  if (!raw) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('version' in parsed) ||
      parsed.version !== CATALOG_CACHE_VERSION ||
      !('etag' in parsed) ||
      typeof parsed.etag !== 'string' ||
      parsed.etag.length === 0 ||
      !('payload' in parsed)
    ) {
      clearCatalogCache(key)
      return undefined
    }
    return parsed as CatalogCache<T>
  } catch {
    clearCatalogCache(key)
    return undefined
  }
}

function clearCatalogCache(key: string): void {
  try {
    sessionStorage.removeItem(key)
  } catch {
    // A disabled store behaves like an empty cache.
  }
}

function writeCatalogCache<T>(key: string, value: CatalogCache<T>): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // A disabled or full session store must never prevent catalog use.
  }
}
