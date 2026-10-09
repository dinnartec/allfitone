import {
  QueryClient,
  infiniteQueryOptions,
  queryOptions,
  type InfiniteData,
} from '@tanstack/react-query'

import {
  StudioApiError,
  studioApi,
  type ClientDirectoryGroup,
  type OfferableScopeCatalog,
  type ClientDirectoryItem,
  type ClientDirectoryPage,
  type OrganizationMembership,
  type OrganizationMembershipPage,
  type OrganizationMembershipStatus,
  type ProfessionalCredential,
  type ProfessionalProfile,
  type StudioMe,
  type TeamInvitationPage,
  type TeamInvitationStatus,
} from './studio-api'

export type MembershipFilter = OrganizationMembershipStatus | 'all'
export type InvitationFilter = TeamInvitationStatus | 'all'
export type ClientFilter = ClientDirectoryGroup | 'all'

export const STUDIO_QUERY_GC_TIME_MS = 5 * 60 * 1000
export const STUDIO_TEAM_STALE_TIME_MS = 30 * 1000
export const STUDIO_PROFILE_STALE_TIME_MS = 2 * 60 * 1000
export const STUDIO_ORGANIZATION_STALE_TIME_MS = 2 * 60 * 1000
export const STUDIO_ROLE_STALE_TIME_MS = 5 * 60 * 1000
export const STUDIO_CATALOG_STALE_TIME_MS = 60 * 60 * 1000

const ROOT_KEY = ['studio'] as const

export const studioQueryKeys = {
  all: ROOT_KEY,
  organizationTypes: () => [...ROOT_KEY, 'organization-types'] as const,
  me: () => [...ROOT_KEY, 'me'] as const,
  professionalSpecialties: () => [...ROOT_KEY, 'catalog', 'professional-specialties'] as const,
  professionalCredentialTypes: () =>
    [...ROOT_KEY, 'catalog', 'professional-credential-types'] as const,
  organization: (organizationId: string) => [...ROOT_KEY, 'organization', organizationId] as const,
  organizationRoles: (organizationId: string) =>
    [...ROOT_KEY, 'organization', organizationId, 'roles'] as const,
  organizationMembershipsRoot: (organizationId: string) =>
    [...ROOT_KEY, 'organization', organizationId, 'memberships'] as const,
  organizationMemberships: (organizationId: string, status: MembershipFilter, limit: number) =>
    [...ROOT_KEY, 'organization', organizationId, 'memberships', { status, limit }] as const,
  offerableScopes: () => [...ROOT_KEY, 'offerable-scopes'] as const,
  organizationClientsRoot: (organizationId: string) =>
    [...ROOT_KEY, 'organization', organizationId, 'clients'] as const,
  organizationClients: (organizationId: string, status: ClientFilter, limit: number) =>
    [...ROOT_KEY, 'organization', organizationId, 'clients', { status, limit }] as const,
  relationship: (organizationId: string, relationshipId: string) =>
    [...ROOT_KEY, 'organization', organizationId, 'relationship', relationshipId] as const,
  relationshipHistory: (organizationId: string, relationshipId: string, limit: number) =>
    [
      ...ROOT_KEY,
      'organization',
      organizationId,
      'relationship',
      relationshipId,
      'history',
      { limit },
    ] as const,
  organizationInvitationsRoot: (organizationId: string) =>
    [...ROOT_KEY, 'organization', organizationId, 'invitations'] as const,
  organizationInvitations: (organizationId: string, status: InvitationFilter, limit: number) =>
    [...ROOT_KEY, 'organization', organizationId, 'invitations', { status, limit }] as const,
} as const

export function createStudioQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: STUDIO_QUERY_GC_TIME_MS,
        refetchOnReconnect: true,
        refetchOnWindowFocus: true,
        retry: shouldRetryStudioQuery,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

export interface StudioQueryRuntime {
  readonly queryClient: QueryClient
  start(): void
  stop(): void
  runMutation<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T>
}

export class StudioQuerySessionCancelledError extends Error {
  constructor() {
    super('studio-query-session-cancelled')
    this.name = 'StudioQuerySessionCancelledError'
  }
}

export function isStudioQuerySessionCancelled(
  error: unknown,
): error is StudioQuerySessionCancelledError {
  return error instanceof StudioQuerySessionCancelledError
}

export function createStudioQueryRuntime(
  queryClient: QueryClient = createStudioQueryClient(),
): StudioQueryRuntime {
  let active = true
  let generation = 0
  const controllers = new Set<AbortController>()

  return {
    queryClient,
    start() {
      if (active) return
      generation += 1
      queryClient.clear()
      active = true
    },
    stop() {
      if (active) {
        active = false
        generation += 1
      }
      for (const controller of controllers) controller.abort()
      controllers.clear()
      queryClient.clear()
    },
    async runMutation<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
      if (!active) throw new StudioQuerySessionCancelledError()
      const operationGeneration = generation
      const controller = new AbortController()
      controllers.add(controller)
      try {
        const result = await operation(controller.signal)
        if (!active || operationGeneration !== generation || controller.signal.aborted) {
          throw new StudioQuerySessionCancelledError()
        }
        return result
      } catch (error) {
        if (
          !active ||
          operationGeneration !== generation ||
          controller.signal.aborted ||
          isStudioQuerySessionCancelled(error)
        ) {
          throw new StudioQuerySessionCancelledError()
        }
        throw error
      } finally {
        controllers.delete(controller)
      }
    },
  }
}

export function shouldRetryStudioQuery(failureCount: number, error: Error): boolean {
  if (failureCount >= 1) return false
  if (error instanceof StudioApiError) return error.status === 503
  return error instanceof TypeError
}

/**
 * A denial, as opposed to an outage.
 *
 * The distinction decides what a surface may say and offer: a 403 is terminal,
 * shouldRetryStudioQuery above refuses to retry it, and a screen that presents
 * it as a temporary connection failure offers a retry that cannot succeed. That
 * defect reached the organization verification layer precisely because this
 * predicate was written inline in every component that needed it, so one of
 * them could be missing it without anywhere to notice.
 */
export function isStudioForbidden(error: unknown): boolean {
  return error instanceof StudioApiError && error.status === 403
}

/**
 * An organization this account cannot read, for either of two reasons.
 *
 * PostgreSQL answers the same 'organization not found' whether the row is
 * absent or the actor holds no active membership in it, so the two arrive here
 * as one 404 and must stay indistinguishable. A screen that told them apart
 * would turn the address bar into a directory of which organizations exist.
 */
export function isStudioNotFound(error: unknown): boolean {
  return error instanceof StudioApiError && error.status === 404
}

export function organizationQueryOptions(organizationId: string) {
  return queryOptions({
    queryKey: studioQueryKeys.organization(organizationId),
    queryFn: ({ signal }) => studioApi.organization(organizationId, signal),
    staleTime: STUDIO_ORGANIZATION_STALE_TIME_MS,
  })
}

/**
 * The team stale time, not the organization one. Who attends a client changes
 * when somebody reassigns them, and a permission disappears the moment the
 * person revokes it — both are decisions other people make while this screen is
 * open, so it must not sit on a two-minute-old answer.
 */
export function relationshipQueryOptions(organizationId: string, relationshipId: string) {
  return queryOptions({
    queryKey: studioQueryKeys.relationship(organizationId, relationshipId),
    queryFn: ({ signal }) => studioApi.relationshipState(organizationId, relationshipId, signal),
    staleTime: STUDIO_TEAM_STALE_TIME_MS,
  })
}

/**
 * A relationship's past, newest first.
 *
 * Unlike the state beside it, this does not go stale: what already happened does
 * not change. What can change is that something new is added to the end of it,
 * which a reader notices by coming back rather than by this screen refetching
 * under them mid-scroll.
 */
export function relationshipHistoryQueryOptions(
  organizationId: string,
  relationshipId: string,
  limit: number,
) {
  return infiniteQueryOptions({
    queryKey: studioQueryKeys.relationshipHistory(organizationId, relationshipId, limit),
    queryFn: ({ pageParam, signal }) =>
      studioApi.relationshipHistory(
        organizationId,
        relationshipId,
        { limit, ...(pageParam ? { cursor: pageParam } : {}) },
        signal,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: nextPageCursor,
    staleTime: STUDIO_TEAM_STALE_TIME_MS,
  })
}

export function organizationTypesQueryOptions() {
  return queryOptions({
    queryKey: studioQueryKeys.organizationTypes(),
    queryFn: ({ signal }) => studioApi.organizationTypes(signal),
    staleTime: STUDIO_CATALOG_STALE_TIME_MS,
  })
}

export function studioMeQueryOptions() {
  return queryOptions({
    queryKey: studioQueryKeys.me(),
    queryFn: ({ signal }) => studioApi.me(signal),
    staleTime: STUDIO_PROFILE_STALE_TIME_MS,
  })
}

export function professionalSpecialtiesQueryOptions() {
  return queryOptions({
    queryKey: studioQueryKeys.professionalSpecialties(),
    queryFn: ({ signal }) => studioApi.professionalSpecialties(signal),
    staleTime: STUDIO_CATALOG_STALE_TIME_MS,
  })
}

export function professionalCredentialTypesQueryOptions() {
  return queryOptions({
    queryKey: studioQueryKeys.professionalCredentialTypes(),
    queryFn: ({ signal }) => studioApi.professionalCredentialTypes(signal),
    staleTime: STUDIO_CATALOG_STALE_TIME_MS,
  })
}

export function organizationRolesQueryOptions(organizationId: string) {
  return queryOptions({
    queryKey: studioQueryKeys.organizationRoles(organizationId),
    queryFn: ({ signal }) => studioApi.organizationRoles(organizationId, signal),
    staleTime: STUDIO_ROLE_STALE_TIME_MS,
  })
}

export function organizationMembershipsQueryOptions(
  organizationId: string,
  status: MembershipFilter,
  limit: number,
) {
  return infiniteQueryOptions({
    queryKey: studioQueryKeys.organizationMemberships(organizationId, status, limit),
    queryFn: ({ pageParam, signal }) =>
      studioApi.organizationMemberships(
        organizationId,
        {
          ...(status === 'all' ? {} : { status }),
          limit,
          ...(pageParam ? { cursor: pageParam } : {}),
        },
        signal,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: nextPageCursor,
    staleTime: STUDIO_TEAM_STALE_TIME_MS,
  })
}

export function organizationInvitationsQueryOptions(
  organizationId: string,
  status: InvitationFilter,
  limit: number,
) {
  return infiniteQueryOptions({
    queryKey: studioQueryKeys.organizationInvitations(organizationId, status, limit),
    queryFn: ({ pageParam, signal }) =>
      studioApi.teamInvitations(
        organizationId,
        {
          ...(status === 'all' ? {} : { status }),
          limit,
          ...(pageParam ? { cursor: pageParam } : {}),
        },
        signal,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: nextPageCursor,
    staleTime: STUDIO_TEAM_STALE_TIME_MS,
  })
}

export function organizationClientsQueryOptions(
  organizationId: string,
  status: ClientFilter,
  limit: number,
) {
  return infiniteQueryOptions({
    queryKey: studioQueryKeys.organizationClients(organizationId, status, limit),
    queryFn: ({ pageParam, signal }) =>
      studioApi.organizationClients(
        organizationId,
        {
          ...(status === 'all' ? {} : { status }),
          limit,
          ...(pageParam ? { cursor: pageParam } : {}),
        },
        signal,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: nextPageCursor,
    staleTime: STUDIO_TEAM_STALE_TIME_MS,
  })
}

/*
 * The permission vocabulary changes when Backoffice publishes a new scope
 * version, which is rare and never mid-session, so it is held longer than a
 * directory page.
 */
export function offerableScopesQueryOptions() {
  return queryOptions({
    queryKey: studioQueryKeys.offerableScopes(),
    queryFn: ({ signal }): Promise<OfferableScopeCatalog> => studioApi.offerableScopes(signal),
    staleTime: STUDIO_ROLE_STALE_TIME_MS,
  })
}

export function nextPageCursor(page: { page: { next_cursor: string | null } }): string | undefined {
  return page.page.next_cursor ?? undefined
}

/**
 * Entries are keyed by whichever id their kind carries. A relationship and an
 * invitation can never collide, because one id comes from
 * `service_relationships` and the other from `invitations`.
 */
export function flattenClientPages(
  data: InfiniteData<ClientDirectoryPage, unknown> | undefined,
): ClientDirectoryItem[] {
  if (!data) return []
  const entries: ClientDirectoryItem[] = []
  const seen = new Set<string>()
  for (const page of data.pages) {
    for (const entry of page.data) {
      const id = entry.kind === 'invitation' ? entry.invitation_id : entry.relationship_id
      if (seen.has(id)) continue
      seen.add(id)
      entries.push(entry)
    }
  }
  return entries
}

export function flattenMembershipPages(
  data: InfiniteData<OrganizationMembershipPage, unknown> | undefined,
): OrganizationMembership[] {
  if (!data) return []
  const memberships: OrganizationMembership[] = []
  const seen = new Set<string>()
  for (const page of data.pages) {
    for (const membership of page.data) {
      if (seen.has(membership.membership_id)) continue
      seen.add(membership.membership_id)
      memberships.push(membership)
    }
  }
  return memberships
}

export function flattenInvitationPages(
  data: InfiniteData<TeamInvitationPage, unknown> | undefined,
): TeamInvitationPage['data'] {
  if (!data) return []
  const invitations: TeamInvitationPage['data'] = []
  const seen = new Set<string>()
  for (const page of data.pages) {
    for (const invitation of page.data) {
      if (seen.has(invitation.id)) continue
      seen.add(invitation.id)
      invitations.push(invitation)
    }
  }
  return invitations
}

export function updateProfessionalProfileInMe(
  current: StudioMe | undefined,
  profile: ProfessionalProfile,
): StudioMe | undefined {
  return current ? { ...current, profile } : current
}

export function prependCredentialToMe(
  current: StudioMe | undefined,
  credential: ProfessionalCredential,
): StudioMe | undefined {
  if (!current?.profile) return current
  const credentials = [
    credential,
    ...current.profile.credentials.filter((candidate) => candidate.id !== credential.id),
  ]
  return { ...current, profile: { ...current.profile, credentials } }
}

export function replaceCredentialInMe(
  current: StudioMe | undefined,
  credential: ProfessionalCredential,
): StudioMe | undefined {
  if (!current?.profile) return current
  return {
    ...current,
    profile: {
      ...current.profile,
      credentials: current.profile.credentials.map((candidate) =>
        candidate.id === credential.id ? credential : candidate,
      ),
    },
  }
}

export function removeInvitationFromPages(
  current: InfiniteData<TeamInvitationPage, unknown> | undefined,
  invitationId: string,
): InfiniteData<TeamInvitationPage, unknown> | undefined {
  if (!current) return current
  return {
    ...current,
    pages: current.pages.map((page) => ({
      ...page,
      data: page.data.filter((invitation) => invitation.id !== invitationId),
    })),
  }
}
