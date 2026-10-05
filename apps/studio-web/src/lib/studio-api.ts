import type { AllfitV1Schemas } from '@allfitone/contracts'
import { newCommand as createCommand, type CommandHeaders } from '@allfitone/contracts/commands'
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
export type OwnershipInvitationPresentation = AllfitV1Schemas['OwnershipInvitationPresentation']
export type OwnershipInvitationDecisionCreate = AllfitV1Schemas['OwnershipInvitationDecisionCreate']
export type OwnershipInvitationDecisionResult = AllfitV1Schemas['OwnershipInvitationDecisionResult']
export type TeamInvitationPage = AllfitV1Schemas['TeamInvitationPage']
export type TeamInvitationListItem = AllfitV1Schemas['TeamInvitationListItem']
export type TeamInvitationStatus = AllfitV1Schemas['TeamInvitationStatus']
export type OrganizationMembership = AllfitV1Schemas['OrganizationMembershipListItem']
export type OrganizationMembershipPage = AllfitV1Schemas['OrganizationMembershipPage']
export type OrganizationMembershipStatus = AllfitV1Schemas['OrganizationMembershipStatus']
export type OfferableScopeCatalog = AllfitV1Schemas['OfferableScopeCatalog']
export type OfferableScope = AllfitV1Schemas['OfferableScope']
export type ClientInvitationCreate = AllfitV1Schemas['ClientInvitationCreate']
export type ClientInvitation = AllfitV1Schemas['ClientInvitation']
export type ClientDirectoryPage = AllfitV1Schemas['ClientDirectoryPage']
export type ClientDirectoryItem = AllfitV1Schemas['ClientDirectoryItem']
export type ClientDirectoryRelationship = AllfitV1Schemas['ClientDirectoryRelationship']
export type ClientDirectoryInvitation = AllfitV1Schemas['ClientDirectoryInvitation']
export type ClientDirectoryGroup = AllfitV1Schemas['ClientDirectoryGroup']
export type RelationshipState = AllfitV1Schemas['RelationshipState']
export type RelationshipProfessional = AllfitV1Schemas['RelationshipProfessional']
export type RelationshipSubstitution = AllfitV1Schemas['RelationshipSubstitution']
export type RelationshipGrant = AllfitV1Schemas['RelationshipGrant']
export type RelationshipHolder = AllfitV1Schemas['RelationshipHolder']
export type RelationshipHolderAssignment = AllfitV1Schemas['RelationshipHolderAssignment']
export type RelationshipReassignment = AllfitV1Schemas['RelationshipReassignment']
export type Organization = AllfitV1Schemas['Organization']
export type OrganizationSite = AllfitV1Schemas['OrganizationSite']
export type OrganizationSiteStatus = AllfitV1Schemas['OrganizationSiteStatus']
export type OrganizationSiteCreate = AllfitV1Schemas['OrganizationSiteCreate']
export type OrganizationSiteUpdate = AllfitV1Schemas['OrganizationSiteUpdate']
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
    request<AllfitV1Schemas['ProfessionalSpecialtyList']>(
      '/studio/v1/professional-specialties',
      signal ? { signal } : {},
    ),

  professionalCredentialTypes: (signal?: AbortSignal) =>
    request<AllfitV1Schemas['ProfessionalCredentialTypeList']>(
      '/studio/v1/professional-credential-types',
      signal ? { signal } : {},
    ),

  updateProfessionalProfile: (
    body: ProfessionalProfilePut,
    command: CommandHeaders,
    signal?: AbortSignal,
  ) =>
    request<ProfessionalProfile>('/studio/v1/me/professional-profile', {
      method: 'PUT',
      headers: commandHeaders(command),
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    }),

  declareProfessionalCredential: (
    body: ProfessionalCredentialWrite,
    command: CommandHeaders,
    signal?: AbortSignal,
  ) =>
    request<ProfessionalCredential>('/studio/v1/me/professional-credentials', {
      method: 'POST',
      headers: commandHeaders(command),
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    }),

  reviseProfessionalCredential: (
    credentialId: string,
    body: ProfessionalCredentialWrite,
    command: CommandHeaders,
    signal?: AbortSignal,
  ) =>
    request<ProfessionalCredential>(
      `/studio/v1/me/professional-credentials/${credentialId}/revisions`,
      {
        method: 'POST',
        headers: commandHeaders(command),
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      },
    ),

  retireProfessionalCredential: (
    credentialId: string,
    command: CommandHeaders,
    signal?: AbortSignal,
  ) =>
    request<ProfessionalCredential>(
      `/studio/v1/me/professional-credentials/${credentialId}/retirement`,
      {
        method: 'POST',
        headers: commandHeaders(command),
        ...(signal ? { signal } : {}),
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
    signal?: AbortSignal,
  ) =>
    request<TeamInvitation>(`/studio/v1/organizations/${organizationId}/invitations`, {
      method: 'POST',
      headers: commandHeaders(command),
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
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

  // An organization Allfit hands over arrives at the same invitation page, so the page
  // asks for it when the token is not a team invitation.
  resolveOwnershipInvitation: (token: string) =>
    request<OwnershipInvitationPresentation>('/studio/v1/ownership-invitations/resolve', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  decideOwnershipInvitation: (body: OwnershipInvitationDecisionCreate, command: CommandHeaders) =>
    request<OwnershipInvitationDecisionResult>(
      '/studio/v1/ownership-invitations/decisions',
      {
        method: 'POST',
        headers: commandHeaders(command),
        body: JSON.stringify(body),
      },
      telemetryContext(invitationDecisionFlowStep(body.decision)),
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

  organizationClients: (
    organizationId: string,
    options: { status?: ClientDirectoryGroup; limit?: number; cursor?: string } = {},
    signal?: AbortSignal,
  ) => {
    const query = new URLSearchParams()
    if (options.status) query.set('status', options.status)
    if (options.limit) query.set('limit', String(options.limit))
    if (options.cursor) query.set('cursor', options.cursor)
    const suffix = query.size ? `?${query.toString()}` : ''
    return request<ClientDirectoryPage>(
      `/studio/v1/organizations/${organizationId}/clients${suffix}`,
      {
        cache: 'no-store',
        ...(signal ? { signal } : {}),
      },
    )
  },

  relationshipState: (organizationId: string, relationshipId: string, signal?: AbortSignal) =>
    request<RelationshipState>(
      `/studio/v1/organizations/${organizationId}/relationships/${relationshipId}`,
      {
        cache: 'no-store',
        ...(signal ? { signal } : {}),
      },
    ),

  offerableScopes: (signal?: AbortSignal) =>
    request<OfferableScopeCatalog>('/studio/v1/offerable-scopes', {
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),

  createClientInvitation: (
    organizationId: string,
    body: ClientInvitationCreate,
    command: CommandHeaders,
  ) =>
    request<ClientInvitation>(`/studio/v1/organizations/${organizationId}/client-invitations`, {
      method: 'POST',
      headers: commandHeaders(command),
      body: JSON.stringify(body),
    }),

  assignRelationshipHolder: (
    organizationId: string,
    relationshipId: string,
    body: RelationshipHolderAssignment,
    command: CommandHeaders,
  ) =>
    request<RelationshipHolder>(
      `/studio/v1/organizations/${organizationId}/relationships/${relationshipId}/professional-assignments`,
      {
        method: 'POST',
        headers: commandHeaders(command),
        body: JSON.stringify(body),
      },
    ),

  reassignRelationshipHolder: (
    organizationId: string,
    relationshipId: string,
    body: RelationshipHolderAssignment,
    command: CommandHeaders,
  ) =>
    request<RelationshipReassignment>(
      `/studio/v1/organizations/${organizationId}/relationships/${relationshipId}/professional-assignments/reassignment`,
      {
        method: 'POST',
        headers: commandHeaders(command),
        body: JSON.stringify(body),
      },
    ),

  organization: (organizationId: string, signal?: AbortSignal) =>
    request<Organization>(`/studio/v1/organizations/${organizationId}`, signal ? { signal } : {}),

  createOrganizationSite: (
    organizationId: string,
    body: OrganizationSiteCreate,
    command: CommandHeaders,
    signal?: AbortSignal,
  ) =>
    request<OrganizationSite>(`/studio/v1/organizations/${organizationId}/sites`, {
      method: 'POST',
      headers: commandHeaders(command),
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    }),

  updateOrganizationSite: (
    organizationId: string,
    siteId: string,
    body: OrganizationSiteUpdate,
    expectedRevision: string,
    command: CommandHeaders,
    signal?: AbortSignal,
  ) =>
    request<OrganizationSite>(`/studio/v1/organizations/${organizationId}/sites/${siteId}`, {
      method: 'PATCH',
      // The revision this edit was based on. Without it the server answers 428
      // rather than guessing that the screen was current.
      headers: { ...commandHeaders(command), 'If-Match': expectedRevision },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    }),

  organizationRoles: (organizationId: string, signal?: AbortSignal) =>
    request<OrganizationRoleCatalog>(
      `/studio/v1/organizations/${organizationId}/roles`,
      signal ? { signal } : {},
    ),

  revokeTeamInvitation: (
    organizationId: string,
    invitationId: string,
    command: CommandHeaders,
    signal?: AbortSignal,
  ) =>
    request<AllfitV1Schemas['TeamInvitationRevoked']>(
      `/studio/v1/organizations/${organizationId}/invitations/${invitationId}/revocation`,
      {
        method: 'POST',
        headers: commandHeaders(command),
        body: JSON.stringify({}),
        ...(signal ? { signal } : {}),
      },
    ),
}

export type { CommandHeaders }

/**
 * The formats live in the contract package because Space needs them too, and an
 * app may never import another app. Only the web sources of randomness and time
 * stay here.
 */
export function newCommand(): CommandHeaders {
  return createCommand(
    { randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)) },
    Date.now(),
  )
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
    '/studio/v1/ownership-invitations/resolve': 'studio.invitation.resolve',
    '/studio/v1/ownership-invitations/decisions': 'studio.invitation.decide',
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
