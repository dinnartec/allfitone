import {
  QueryClient,
  infiniteQueryOptions,
  queryOptions,
  type InfiniteData,
} from '@tanstack/react-query'

import {
  StudioApiError,
  studioApi,
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

export const STUDIO_QUERY_GC_TIME_MS = 5 * 60 * 1000
export const STUDIO_TEAM_STALE_TIME_MS = 30 * 1000
export const STUDIO_PROFILE_STALE_TIME_MS = 2 * 60 * 1000
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

export function shouldRetryStudioQuery(failureCount: number, error: Error): boolean {
  if (failureCount >= 1) return false
  if (error instanceof StudioApiError) return error.status === 503
  return error instanceof TypeError
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

export function nextPageCursor(page: { page: { next_cursor: string | null } }): string | undefined {
  return page.page.next_cursor ?? undefined
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

export function markInvitationRevoked(
  current: InfiniteData<TeamInvitationPage, unknown> | undefined,
  invitationId: string,
  decidedAt: string,
): InfiniteData<TeamInvitationPage, unknown> | undefined {
  if (!current) return current
  return {
    ...current,
    pages: current.pages.map((page) => ({
      ...page,
      data: page.data.map((invitation) =>
        invitation.id === invitationId
          ? {
              ...invitation,
              status: 'revoked',
              intents: invitation.intents.map((intent) => ({
                ...intent,
                status: 'revoked',
                decided_at: decidedAt,
              })),
            }
          : invitation,
      ),
    })),
  }
}
