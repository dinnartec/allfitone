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

export type CatalogDiscipline = AllfitV1Schemas['CatalogDiscipline']
export type CatalogActivityType = AllfitV1Schemas['CatalogActivityType']
export type ActivityTypeResultContract = AllfitV1Schemas['ActivityTypeResultContract']
export type AccessEventPage = AllfitV1Schemas['AccessEventPage']
export type BackofficeOrganizationSummary = AllfitV1Schemas['BackofficeOrganizationSummary']
export type BackofficeOrganizationPage = AllfitV1Schemas['BackofficeOrganizationPage']
export type OrganizationHandover = AllfitV1Schemas['OrganizationHandover']
export type BackofficeOrganizationFile = AllfitV1Schemas['BackofficeOrganizationFile']
export type OrganizationHandoverCreate = AllfitV1Schemas['OrganizationHandoverCreate']
export type BackofficeTeamInvitation = AllfitV1Schemas['BackofficeTeamInvitation']
export type BackofficeTeamInvitationList = AllfitV1Schemas['BackofficeTeamInvitationList']
export type BackofficeTeamInvitationResend = AllfitV1Schemas['BackofficeTeamInvitationResend']
export type CredentialVerificationRequest = AllfitV1Schemas['CredentialVerificationRequest']
export type CredentialVerificationOutcome = AllfitV1Schemas['CredentialVerificationOutcome']
export type CredentialVerificationDecisionCreate =
  AllfitV1Schemas['CredentialVerificationDecisionCreate']
export type CredentialRenewalDue = AllfitV1Schemas['CredentialRenewalDue']
export type BreakGlassRequest = AllfitV1Schemas['BreakGlassRequest']
export type BreakGlassRequestCreate = AllfitV1Schemas['BreakGlassRequestCreate']
export type BreakGlassExerciseOutcome = AllfitV1Schemas['BreakGlassExerciseOutcome']
export type ScopeDefinition = AllfitV1Schemas['ScopeDefinition']
export type ScopeDefinitionPublication = AllfitV1Schemas['ScopeDefinitionPublication']
export type SupportOperation = AllfitV1Schemas['SupportOperation']
export type SupportOperationPage = AllfitV1Schemas['SupportOperationPage']
export type SupportDeliveryCircuit = AllfitV1Schemas['SupportDeliveryCircuit']
export type SupportAttentionPanel = AllfitV1Schemas['SupportAttentionPanel']
export type SupportPersonMetadata = AllfitV1Schemas['SupportPersonMetadata']
export type SupportPeopleSearch = AllfitV1Schemas['SupportPeopleSearch']
export type ResultContract = AllfitV1Schemas['ResultContract']
export type ResultContractPublication = AllfitV1Schemas['ResultContractPublication']

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

  publishResultContract: (publication: ResultContractPublication, command: BackofficeCommand) =>
    requestJson<ResultContract>('/backoffice/v1/result-contracts', {
      method: 'POST',
      headers: commandHeaders(command),
      body: JSON.stringify(publication),
    }),

  deprecateResultContract: (contractId: string, command: BackofficeCommand) =>
    requestJson<ResultContract>(`/backoffice/v1/result-contracts/${contractId}/deprecation`, {
      method: 'POST',
      headers: commandHeaders(command),
      body: '{}',
    }),

  // The global catalogue is its own surface: it carries no tenant and no
  // subject, so Backoffice reads the same mount Studio and Space read.
  catalogDisciplines: (signal?: AbortSignal) =>
    requestJson<{ items: CatalogDiscipline[] }>(
      '/catalog/v1/disciplines',
      signal ? { signal } : {},
    ),

  catalogActivityTypes: (signal?: AbortSignal) =>
    requestJson<{ items: CatalogActivityType[] }>(
      '/catalog/v1/activity-types',
      signal ? { signal } : {},
    ),

  catalogActivityTypeResultContracts: (activityTypeId: string, signal?: AbortSignal) =>
    requestJson<{ items: ActivityTypeResultContract[] }>(
      `/catalog/v1/activity-types/${activityTypeId}/result-contracts`,
      signal ? { signal } : {},
    ),

  // The case reference travels on every support read: the server records it
  // beside the query, so a read nobody can trace back to a case is refused.
  searchSupportPeople: (
    input: { caseReference: string; kind: 'identifier' | 'email' | 'phone'; value: string },
    signal?: AbortSignal,
  ) =>
    requestJson<SupportPeopleSearch>(
      `/backoffice/v1/support/people${query({
        case_reference: input.caseReference,
        [input.kind]: input.value,
      })}`,
      signal ? { signal } : {},
    ),

  supportPersonMetadata: (personId: string, caseReference: string, signal?: AbortSignal) =>
    requestJson<SupportPersonMetadata>(
      `/backoffice/v1/support/people/${personId}${query({ case_reference: caseReference })}`,
      signal ? { signal } : {},
    ),

  // No case reference here, unlike the other support reads: this feed has no
  // subject, so there is nothing to trace back to a case.
  supportOperations: (
    filters: { source?: string; state?: string; aggregateId?: string; cursor?: string } = {},
    signal?: AbortSignal,
  ) =>
    requestJson<SupportOperationPage>(
      `/backoffice/v1/support/operations${query({
        source: filters.source,
        state: filters.state,
        aggregate_id: filters.aggregateId,
        cursor: filters.cursor,
      })}`,
      signal ? { signal } : {},
    ),

  supportDeliveryCircuits: (signal?: AbortSignal) =>
    requestJson<{ items: SupportDeliveryCircuit[] }>(
      '/backoffice/v1/support/delivery-circuits',
      signal ? { signal } : {},
    ),

  supportAttention: (signal?: AbortSignal) =>
    requestJson<SupportAttentionPanel>(
      '/backoffice/v1/support/attention',
      signal ? { signal } : {},
    ),

  verificationRequests: (signal?: AbortSignal) =>
    requestJson<{ items: CredentialVerificationRequest[] }>(
      '/backoffice/v1/verification-requests',
      signal ? { signal } : {},
    ),

  decideVerification: (
    decision: CredentialVerificationDecisionCreate,
    command: BackofficeCommand,
  ) =>
    requestJson<CredentialVerificationOutcome>('/backoffice/v1/verifications', {
      method: 'POST',
      headers: commandHeaders(command),
      body: JSON.stringify(decision),
    }),

  verificationRenewals: (signal?: AbortSignal) =>
    requestJson<{ items: CredentialRenewalDue[] }>(
      '/backoffice/v1/verification-renewals',
      signal ? { signal } : {},
    ),

  openVerificationRenewal: (credentialId: string, command: BackofficeCommand) =>
    requestJson<CredentialVerificationOutcome>('/backoffice/v1/verification-renewals', {
      method: 'POST',
      headers: commandHeaders(command),
      body: JSON.stringify({ credential_id: credentialId }),
    }),

  accessEvents: (
    filters: {
      actor_person_id?: string | undefined
      subject_person_id?: string | undefined
      from?: string | undefined
      to?: string | undefined
    },
    signal?: AbortSignal,
  ) =>
    requestJson<AccessEventPage>(
      `/backoffice/v1/access-events${query(filters)}`,
      signal ? { signal } : {},
    ),

  organizations: (
    filters: {
      q?: string | undefined
      status?: string | undefined
      cursor?: string | undefined
    } = {},
    signal?: AbortSignal,
  ) =>
    requestJson<BackofficeOrganizationPage>(
      `/backoffice/v1/organizations${query(filters)}`,
      signal ? { signal } : {},
    ),

  createOrganizationHandover: (body: OrganizationHandoverCreate, command: BackofficeCommand) =>
    requestJson<OrganizationHandover>('/backoffice/v1/organizations', {
      method: 'POST',
      headers: commandHeaders(command),
      body: JSON.stringify(body),
    }),

  organizationFile: (organizationId: string, signal?: AbortSignal) =>
    requestJson<BackofficeOrganizationFile>(
      `/backoffice/v1/organizations/${organizationId}`,
      signal ? { signal } : {},
    ),

  organizationHandover: (organizationId: string, signal?: AbortSignal) =>
    requestJson<OrganizationHandover>(
      `/backoffice/v1/organizations/${organizationId}/handover`,
      signal ? { signal } : {},
    ),

  organizationTeamInvitations: (organizationId: string, signal?: AbortSignal) =>
    requestJson<BackofficeTeamInvitationList>(
      `/backoffice/v1/organizations/${organizationId}/team-invitations`,
      signal ? { signal } : {},
    ),

  // No body: the contact, the role and the gym all come from the invitation itself.
  resendTeamInvitation: (
    organizationId: string,
    invitationId: string,
    command: BackofficeCommand,
  ) =>
    requestJson<BackofficeTeamInvitationResend>(
      `/backoffice/v1/organizations/${organizationId}/team-invitations/${invitationId}/resends`,
      { method: 'POST', headers: commandHeaders(command), body: '{}' },
    ),

  // No body: the resend always goes to the address the handover was created with.
  resendOrganizationHandover: (organizationId: string, command: BackofficeCommand) =>
    requestJson<OrganizationHandover>(
      `/backoffice/v1/organizations/${organizationId}/handover/resends`,
      { method: 'POST', headers: commandHeaders(command) },
    ),

  cancelOrganizationHandover: (organizationId: string, command: BackofficeCommand) =>
    requestJson<OrganizationHandover>(
      `/backoffice/v1/organizations/${organizationId}/cancellation`,
      { method: 'POST', headers: commandHeaders(command) },
    ),

  scopeDefinitions: (signal?: AbortSignal) =>
    requestJson<{ items: ScopeDefinition[] }>(
      '/backoffice/v1/scope-definitions',
      signal ? { signal } : {},
    ),

  publishScopeDefinition: (publication: ScopeDefinitionPublication, command: BackofficeCommand) =>
    requestJson<ScopeDefinition>('/backoffice/v1/scope-definitions', {
      method: 'POST',
      headers: commandHeaders(command),
      body: JSON.stringify(publication),
    }),

  breakGlassRequests: (filters: { mine?: boolean; status?: string } = {}, signal?: AbortSignal) =>
    requestJson<{ items: BreakGlassRequest[] }>(
      `/backoffice/v1/break-glass/requests${query({
        mine: filters.mine === undefined ? undefined : String(filters.mine),
        status: filters.status,
      })}`,
      signal ? { signal } : {},
    ),

  requestBreakGlass: (publication: BreakGlassRequestCreate, command: BackofficeCommand) =>
    requestJson<BreakGlassRequest>('/backoffice/v1/break-glass/requests', {
      method: 'POST',
      headers: commandHeaders(command),
      body: JSON.stringify(publication),
    }),

  decideBreakGlass: (
    requestId: string,
    decision: { decision: 'approved' | 'rejected'; reason_code: string },
    command: BackofficeCommand,
  ) =>
    requestJson<BreakGlassRequest>(`/backoffice/v1/break-glass/requests/${requestId}/decisions`, {
      method: 'POST',
      headers: commandHeaders(command),
      body: JSON.stringify(decision),
    }),

  // No command identifiers: each attempt is a new event rather than a command to
  // converge, so there is nothing to replay.
  exerciseBreakGlass: (
    requestId: string,
    exercise: { category: string; resource_type: string; resource_id?: string },
  ) =>
    requestJson<BreakGlassExerciseOutcome>(
      `/backoffice/v1/break-glass/requests/${requestId}/reads`,
      { method: 'POST', body: JSON.stringify(exercise) },
    ),

  closeBreakGlass: (requestId: string, command: BackofficeCommand) =>
    requestJson<BreakGlassRequest>(`/backoffice/v1/break-glass/requests/${requestId}/closure`, {
      method: 'POST',
      headers: commandHeaders(command),
      body: '{}',
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
  const startedAt = performance.now()
  const method = requestMethod(init.method)
  const operation = backofficeOperation(path, method)
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

function backofficeOperation(path: string, method: string): ClientOperation {
  const operations: Record<string, ClientOperation> = {
    '/backoffice/v1/auth/password': 'backoffice.auth.password',
    '/backoffice/v1/auth/attempt': 'backoffice.auth.attempt',
    '/backoffice/v1/auth/totp/verification': 'backoffice.auth.totp_verification',
    '/backoffice/v1/session': 'backoffice.session',
    '/backoffice/v1/auth/logout': 'backoffice.auth.logout',
    '/backoffice/v1/auth/password-resets': 'backoffice.auth.password_reset',
  }
  const [route] = path.split('?')
  const resolved = route ?? path
  const breakGlass = breakGlassOperation(resolved)
  if (breakGlass) return breakGlass
  if (resolved === '/backoffice/v1/verification-requests') return 'backoffice.verification.list'
  if (resolved === '/backoffice/v1/verifications') return 'backoffice.verification.decide'
  if (resolved === '/backoffice/v1/verification-renewals') return 'backoffice.verification.renewals'
  if (resolved === '/backoffice/v1/access-events') return 'backoffice.access_log.read'
  const organization = organizationOperation(resolved, method)
  if (organization) return organization
  if (resolved === '/backoffice/v1/scope-definitions') {
    return method === 'POST'
      ? 'backoffice.privacy.scope_definition_publish'
      : 'backoffice.privacy.scope_definition_list'
  }
  return (
    supportOperation(resolved) ??
    catalogOperation(resolved) ??
    platformOperation(resolved) ??
    operations[resolved] ??
    'backoffice.session'
  )
}

/** The organization identifier varies per row, so the handover routes are matched by shape. */
function organizationOperation(route: string, method: string): ClientOperation | undefined {
  const segments = route.split('/').filter(Boolean)
  if (segments[0] !== 'backoffice' || segments[1] !== 'v1' || segments[2] !== 'organizations') {
    return undefined
  }
  if (segments.length === 3) {
    return method === 'POST'
      ? 'backoffice.organization.handover_create'
      : 'backoffice.organization.directory'
  }
  if (segments.length === 4) return 'backoffice.organization.file'
  if (segments[4] === 'team-invitations') {
    return segments[6] === 'resends'
      ? 'backoffice.organization.team_invitation_resend'
      : 'backoffice.organization.team_invitations'
  }
  if (segments[4] === 'cancellation') return 'backoffice.organization.handover_cancel'
  if (segments[4] !== 'handover') return undefined
  return segments[5] === 'resends'
    ? 'backoffice.organization.handover_resend'
    : 'backoffice.organization.handover_read'
}

/** The file identifier varies per row, so these routes are matched by shape. */
function breakGlassOperation(route: string): ClientOperation | undefined {
  const segments = route.split('/').filter(Boolean)
  if (segments[0] !== 'backoffice' || segments[1] !== 'v1' || segments[2] !== 'break-glass') {
    return undefined
  }
  if (segments.length === 4) return 'backoffice.break_glass.list'
  if (segments[5] === 'decisions') return 'backoffice.break_glass.decide'
  if (segments[5] === 'reads') return 'backoffice.break_glass.exercise'
  if (segments[5] === 'closure') return 'backoffice.break_glass.close'
  return undefined
}

/** The person identifier varies per row, so the card is matched by shape. */
function supportOperation(route: string): ClientOperation | undefined {
  const segments = route.split('/').filter(Boolean)
  if (segments[0] !== 'backoffice' || segments[1] !== 'v1' || segments[2] !== 'support') {
    return undefined
  }
  if (segments[3] === 'attention') return 'backoffice.support.attention'
  if (segments[3] === 'operations') return 'backoffice.support.operations'
  if (segments[3] === 'delivery-circuits') return 'backoffice.support.delivery_circuits'
  if (segments[3] !== 'people') return undefined
  return segments.length === 4
    ? 'backoffice.support.people_search'
    : 'backoffice.support.person_metadata'
}

/** The catalogue surface is shared, so its operations carry no product prefix. */
function catalogOperation(route: string): ClientOperation | undefined {
  const segments = route.split('/').filter(Boolean)
  if (segments[0] !== 'catalog' || segments[1] !== 'v1') return undefined
  if (segments[2] === 'disciplines') return 'catalog.disciplines'
  if (segments[2] !== 'activity-types') return undefined
  return segments.length === 3 ? 'catalog.activity_types' : 'catalog.activity_type_result_contracts'
}

/** Assignment identifiers vary per row, so these routes are matched by shape. */
function platformOperation(route: string): ClientOperation | undefined {
  const segments = route.split('/').filter(Boolean)
  if (segments[0] === 'backoffice' && segments[1] === 'v1' && segments[2] === 'result-contracts') {
    return segments.length === 3
      ? 'backoffice.catalog.result_contract_publish'
      : 'backoffice.catalog.result_contract_deprecate'
  }
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
