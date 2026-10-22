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
export type InformationCategoryList = AllfitV1Schemas['CatalogInformationCategoryList']
export type InformationCategory = AllfitV1Schemas['CatalogInformationCategory']
export type OfferableScope = AllfitV1Schemas['OfferableScope']
export type ClientInvitationCreate = AllfitV1Schemas['ClientInvitationCreate']
export type ClientInvitation = AllfitV1Schemas['ClientInvitation']
export type ClientDirectoryPage = AllfitV1Schemas['ClientDirectoryPage']
export type StudioGuestQuota = AllfitV1Schemas['StudioGuestQuota']
export type ClientDirectoryItem = AllfitV1Schemas['ClientDirectoryItem']
export type ClientDirectoryRelationship = AllfitV1Schemas['ClientDirectoryRelationship']
export type ClientDirectoryInvitation = AllfitV1Schemas['ClientDirectoryInvitation']
export type ClientDirectoryGroup = AllfitV1Schemas['ClientDirectoryGroup']
export type RelationshipState = AllfitV1Schemas['RelationshipState']
export type RelationshipHistoryPage = AllfitV1Schemas['RelationshipHistoryPage']
export type RelationshipHistoryEvent = AllfitV1Schemas['RelationshipHistoryEvent']
export type RelationshipProfessional = AllfitV1Schemas['RelationshipProfessional']
export type RelationshipSubstitution = AllfitV1Schemas['RelationshipSubstitution']
export type RelationshipGrant = AllfitV1Schemas['RelationshipGrant']
export type RelationshipHolder = AllfitV1Schemas['RelationshipHolder']
export type RelationshipHolderAssignment = AllfitV1Schemas['RelationshipHolderAssignment']
export type RelationshipReassignment = AllfitV1Schemas['RelationshipReassignment']
export type RelationshipSubstitutionProposalCreate =
  AllfitV1Schemas['RelationshipSubstitutionProposalCreate']
export type RelationshipSubstitutionProposal = AllfitV1Schemas['RelationshipSubstitutionProposal']
export type RelationshipTermination = AllfitV1Schemas['RelationshipTermination']
export type RelationshipTerminationCreate = AllfitV1Schemas['RelationshipTerminationCreate']
export type RelationshipSubstitutionTermination =
  AllfitV1Schemas['RelationshipSubstitutionTermination']
export type Organization = AllfitV1Schemas['Organization']
export type OrganizationSite = AllfitV1Schemas['OrganizationSite']
export type OrganizationSiteStatus = AllfitV1Schemas['OrganizationSiteStatus']
export type OrganizationSiteCreate = AllfitV1Schemas['OrganizationSiteCreate']
export type OrganizationSiteUpdate = AllfitV1Schemas['OrganizationSiteUpdate']
export type OrganizationRole = AllfitV1Schemas['OrganizationRole']
export type OrganizationRoleCatalog = AllfitV1Schemas['OrganizationRoleCatalog']
export type OrganizationRoleCode = AllfitV1Schemas['OrganizationRoleCode']
export type OrganizationRoleGrant = AllfitV1Schemas['OrganizationRoleGrant']
export type OrganizationRoleGrantCreate = AllfitV1Schemas['OrganizationRoleGrantCreate']
export type OrganizationSubscriptionPage = AllfitV1Schemas['OrganizationSubscriptionPage']
export type OrganizationSubscription = AllfitV1Schemas['OrganizationSubscription']
export type SubscriptionStatus = AllfitV1Schemas['SubscriptionStatus']
export type SubscriptionTransition = AllfitV1Schemas['SubscriptionTransition']

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

  organizationSubscriptions: (
    organizationId: string,
    options: { status?: SubscriptionStatus; limit?: number; cursor?: string } = {},
    signal?: AbortSignal,
  ) => {
    const query = new URLSearchParams()
    if (options.status) query.set('status', options.status)
    if (options.limit) query.set('limit', String(options.limit))
    if (options.cursor) query.set('cursor', options.cursor)
    const suffix = query.size ? `?${query.toString()}` : ''
    return request<OrganizationSubscriptionPage>(
      `/studio/v1/organizations/${organizationId}/subscriptions${suffix}`,
      {
        cache: 'no-store',
        ...(signal ? { signal } : {}),
      },
    )
  },

  /*
   * The three transitions carry no body: the subscription is in the path and there is
   * nothing to choose. They are separate methods rather than one with a verb argument so
   * that a typo cannot send `terminate` where `suspend` was meant and get a 404 instead
   * of a type error.
   */
  suspendSubscription: (organizationId: string, subscriptionId: string, command: CommandHeaders) =>
    request<SubscriptionTransition>(
      `/studio/v1/organizations/${organizationId}/subscriptions/${subscriptionId}/suspension`,
      { method: 'POST', headers: commandHeaders(command) },
    ),

  reactivateSubscription: (
    organizationId: string,
    subscriptionId: string,
    command: CommandHeaders,
  ) =>
    request<SubscriptionTransition>(
      `/studio/v1/organizations/${organizationId}/subscriptions/${subscriptionId}/reactivation`,
      { method: 'POST', headers: commandHeaders(command) },
    ),

  endSubscription: (organizationId: string, subscriptionId: string, command: CommandHeaders) =>
    request<SubscriptionTransition>(
      `/studio/v1/organizations/${organizationId}/subscriptions/${subscriptionId}/termination`,
      { method: 'POST', headers: commandHeaders(command) },
    ),

  relationshipState: (organizationId: string, relationshipId: string, signal?: AbortSignal) =>
    request<RelationshipState>(
      `/studio/v1/organizations/${organizationId}/relationships/${relationshipId}`,
      {
        cache: 'no-store',
        ...(signal ? { signal } : {}),
      },
    ),

  relationshipHistory: (
    organizationId: string,
    relationshipId: string,
    query: { limit: number; cursor?: string },
    signal?: AbortSignal,
  ) => {
    const search = new URLSearchParams({ limit: String(query.limit) })
    if (query.cursor) search.set('cursor', query.cursor)
    return request<RelationshipHistoryPage>(
      `/studio/v1/organizations/${organizationId}/relationships/${relationshipId}/events?${search}`,
      {
        cache: 'no-store',
        ...(signal ? { signal } : {}),
      },
    )
  },

  offerableScopes: (signal?: AbortSignal) =>
    request<OfferableScopeCatalog>('/studio/v1/offerable-scopes', {
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),

  /**
   * `OP-PRV-022`. The catalogue surface and not `/studio/v1`, because the same
   * seven rows are what a member reads to know what they may ask for and what
   * the person being asked reads to decide. Unlike `offerableScopes` it answers
   * before anyone curates the permission catalogue: it reads the wording alone.
   */
  informationCategories: (signal?: AbortSignal) =>
    request<InformationCategoryList>('/catalog/v1/information-categories', {
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

  proposeRelationshipSubstitution: (
    organizationId: string,
    relationshipId: string,
    body: RelationshipSubstitutionProposalCreate,
    command: CommandHeaders,
  ) =>
    request<RelationshipSubstitutionProposal>(
      `/studio/v1/organizations/${organizationId}/relationships/${relationshipId}/substitutions`,
      {
        method: 'POST',
        headers: commandHeaders(command),
        body: JSON.stringify(body),
      },
    ),

  /**
   * `OP-REL-006`. No body: what the command acts on is entirely in the path, so
   * the request hash that makes it idempotent is derived there too.
   */
  endRelationshipSubstitution: (
    organizationId: string,
    relationshipId: string,
    substitutionId: string,
    command: CommandHeaders,
  ) =>
    request<RelationshipSubstitutionTermination>(
      `/studio/v1/organizations/${organizationId}/relationships/${relationshipId}` +
        `/substitutions/${substitutionId}/termination`,
      {
        method: 'POST',
        headers: commandHeaders(command),
      },
    ),

  /**
   * `OP-REL-008`. The body is optional and carries at most a reason: a gym owes
   * the system no justification for ending a relationship.
   */
  terminateRelationship: (
    organizationId: string,
    relationshipId: string,
    body: RelationshipTerminationCreate,
    command: CommandHeaders,
  ) =>
    request<RelationshipTermination>(
      `/studio/v1/organizations/${organizationId}/relationships/${relationshipId}/termination`,
      {
        method: 'POST',
        headers: commandHeaders(command),
        body: JSON.stringify(body),
      },
    ),

  grantMembershipRole: (
    organizationId: string,
    membershipId: string,
    body: OrganizationRoleGrantCreate,
    command: CommandHeaders,
  ) =>
    request<OrganizationRoleGrant>(
      `/studio/v1/organizations/${organizationId}/memberships/${membershipId}/roles`,
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
    expectedRevision: number,
    command: CommandHeaders,
    signal?: AbortSignal,
  ) =>
    request<OrganizationSite>(`/studio/v1/organizations/${organizationId}/sites/${siteId}`, {
      method: 'PATCH',
      headers: commandHeaders(command),
      /*
       * The revision this edit was based on, in the body and not in `If-Match`.
       * Without it the server answers 428 rather than guessing the screen was
       * current.
       *
       * It used to be a header, and that broke the screen in production: this
       * API is one function mounted at `/`, and Vercel's Edge evaluates
       * conditional requests against that single cache key before the function
       * runs. A write carrying `If-Match` was answered `412` by the Edge after
       * the row had already been written, and with no CORS headers, so this
       * client could not read the refusal and reported a failure for a change
       * that was saved.
       */
      body: JSON.stringify({ ...body, expected_revision: expectedRevision }),
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
