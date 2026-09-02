import { describe, expect, test } from 'bun:test'

import {
  createStudioQueryRuntime,
  flattenMembershipPages,
  createStudioQueryClient,
  isStudioForbidden,
  isStudioQuerySessionCancelled,
  nextPageCursor,
  prependCredentialToMe,
  removeInvitationFromPages,
  replaceCredentialInMe,
  shouldRetryStudioQuery,
  studioQueryKeys,
  updateProfessionalProfileInMe,
} from './studio-query.js'
import {
  StudioApiError,
  type OrganizationMembership,
  type OrganizationMembershipPage,
  type ProfessionalCredential,
  type ProfessionalProfile,
  type StudioMe,
  type TeamInvitationListItem,
  type TeamInvitationPage,
} from './studio-api.js'

describe('Studio query keys', () => {
  test('isolates organization resources by organization and filter', () => {
    expect(studioQueryKeys.organizationMemberships('org-a', 'active', 50)).not.toEqual(
      studioQueryKeys.organizationMemberships('org-b', 'active', 50),
    )
    expect(studioQueryKeys.organizationMemberships('org-a', 'active', 50)).not.toEqual(
      studioQueryKeys.organizationMemberships('org-a', 'terminated', 50),
    )
    expect(studioQueryKeys.organizationInvitations('org-a', 'pending', 50)).not.toEqual(
      studioQueryKeys.organizationInvitations('org-a', 'completed', 50),
    )
  })

  test('keeps profile and catalog keys free of session identifiers', () => {
    expect(studioQueryKeys.me()).toEqual(['studio', 'me'])
    expect(studioQueryKeys.professionalSpecialties()).toEqual([
      'studio',
      'catalog',
      'professional-specialties',
    ])
  })
})

describe('Studio query retry policy', () => {
  test('retries one network or unavailable failure', () => {
    expect(shouldRetryStudioQuery(0, new TypeError('network failed'))).toBe(true)
    expect(shouldRetryStudioQuery(0, new StudioApiError(503, 'unavailable'))).toBe(true)
    expect(shouldRetryStudioQuery(1, new StudioApiError(503, 'unavailable'))).toBe(false)
  })

  test('does not retry authorization or functional failures', () => {
    expect(shouldRetryStudioQuery(0, new StudioApiError(401, 'unauthenticated'))).toBe(false)
    expect(shouldRetryStudioQuery(0, new StudioApiError(403, 'forbidden'))).toBe(false)
    expect(shouldRetryStudioQuery(0, new StudioApiError(422, 'invalid-cursor'))).toBe(false)
    expect(shouldRetryStudioQuery(0, new Error('unexpected'))).toBe(false)
  })
})

describe('Studio denial', () => {
  test('recognises a denial and nothing else', () => {
    expect(isStudioForbidden(new StudioApiError(403, 'forbidden'))).toBe(true)

    // An outage, a sign-out and a rejected payload are not denials: each one
    // leads to different copy and a different offer on screen.
    expect(isStudioForbidden(new StudioApiError(503, 'unavailable'))).toBe(false)
    expect(isStudioForbidden(new StudioApiError(401, 'unauthenticated'))).toBe(false)
    expect(isStudioForbidden(new StudioApiError(422, 'invalid-cursor'))).toBe(false)
  })

  test('survives whatever a catch block actually receives', () => {
    expect(isStudioForbidden(new TypeError('network failed'))).toBe(false)
    expect(isStudioForbidden(new Error('unexpected'))).toBe(false)
    expect(isStudioForbidden(undefined)).toBe(false)
    expect(isStudioForbidden(null)).toBe(false)
    expect(isStudioForbidden({ status: 403 })).toBe(false)
  })

  test('agrees with the retry policy: a denial is never retried', () => {
    const denial = new StudioApiError(403, 'forbidden')
    expect(isStudioForbidden(denial)).toBe(true)
    expect(shouldRetryStudioQuery(0, denial)).toBe(false)
  })
})

describe('Studio query client cache', () => {
  test('coalesces concurrent requests and reuses fresh data', async () => {
    const client = createStudioQueryClient()
    let calls = 0
    const options = {
      queryKey: ['studio', 'test', 'deduplication'] as const,
      queryFn: async () => {
        calls += 1
        await Promise.resolve()
        return { value: 'ready' }
      },
      staleTime: 30_000,
    }

    const [first, second] = await Promise.all([
      client.fetchQuery(options),
      client.fetchQuery(options),
    ])
    const cached = await client.fetchQuery(options)

    expect(first).toEqual({ value: 'ready' })
    expect(second).toEqual(first)
    expect(cached).toEqual(first)
    expect(calls).toBe(1)
  })

  test('clears all cached server state', async () => {
    const client = createStudioQueryClient()
    client.setQueryData(['studio', 'test'], { value: 'sensitive' })

    client.clear()

    expect(client.getQueryCache().getAll()).toHaveLength(0)
    expect(client.getMutationCache().getAll()).toHaveLength(0)
  })
})

describe('Studio query session runtime', () => {
  test('aborts pending mutations and reports a session cancellation on stop', async () => {
    const client = createStudioQueryClient()
    const runtime = createStudioQueryRuntime(client)
    let observedSignal: AbortSignal | undefined
    const pending = runtime.runMutation(
      (signal) =>
        new Promise<string>((_resolve, reject) => {
          observedSignal = signal
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    )
    const rejection = pending.catch((error: unknown) => error)

    runtime.stop()

    expect(observedSignal?.aborted).toBe(true)
    expect(isStudioQuerySessionCancelled(await rejection)).toBe(true)
    expect(client.getQueryCache().getAll()).toHaveLength(0)
    expect(client.getMutationCache().getAll()).toHaveLength(0)
  })

  test('rejects a late mutation response even when the transport ignores abort', async () => {
    const client = createStudioQueryClient()
    const runtime = createStudioQueryRuntime(client)
    const deferred = createDeferred<{ profile: string }>()
    const pending = runtime
      .runMutation(() => deferred.promise)
      .then((value) => {
        client.setQueryData(['studio', 'me'], value)
      })
    const rejection = pending.catch((error: unknown) => error)

    runtime.stop()
    deferred.resolve({ profile: 'previous-session' })

    expect(isStudioQuerySessionCancelled(await rejection)).toBe(true)
    expect(client.getQueryData(['studio', 'me'])).toBeUndefined()
  })

  test('opens a clean generation without accepting an older response', async () => {
    const client = createStudioQueryClient()
    const runtime = createStudioQueryRuntime(client)
    const previous = createDeferred<string>()
    const stale = runtime.runMutation(() => previous.promise)
    const staleRejection = stale.catch((error: unknown) => error)

    runtime.stop()
    runtime.stop()
    runtime.start()
    client.setQueryData(['studio', 'me'], 'current-session')
    runtime.start()
    previous.resolve('previous-session')

    expect(isStudioQuerySessionCancelled(await staleRejection)).toBe(true)
    expect(await runtime.runMutation(async () => 'current-session')).toBe('current-session')
    expect(client.getQueryData<string>(['studio', 'me'])).toBe('current-session')
  })
})

describe('Studio infinite query data', () => {
  test('returns the next cursor and deduplicates memberships across pages', () => {
    const first = membershipPage([membership('membership-a')], 'next-page')
    const second = membershipPage([membership('membership-a'), membership('membership-b')], null)

    expect(nextPageCursor(first)).toBe('next-page')
    expect(nextPageCursor(second)).toBeUndefined()
    expect(
      flattenMembershipPages({ pages: [first, second], pageParams: [null, 'next-page'] }).map(
        (item) => item.membership_id,
      ),
    ).toEqual(['membership-a', 'membership-b'])
  })

  test('removes a revoked invitation from every cached page without changing other rows', () => {
    const first = invitationPage([invitation('invitation-a'), invitation('invitation-b')])
    const second = invitationPage([invitation('invitation-c'), invitation('invitation-a')])
    const current = { pages: [first, second], pageParams: [null, 'next-page'] }
    const updated = removeInvitationFromPages(current, 'invitation-a')

    expect(updated?.pages.flatMap((page) => page.data).map((item) => item.id)).toEqual([
      'invitation-b',
      'invitation-c',
    ])
    expect(updated?.pages[0]?.data[0]).toBe(first.data[1])
    expect(current.pages.flatMap((page) => page.data).map((item) => item.id)).toEqual([
      'invitation-a',
      'invitation-b',
      'invitation-c',
      'invitation-a',
    ])
  })
})

describe('Studio profile cache updates', () => {
  test('replaces the professional profile without changing memberships', () => {
    const current = me()
    const profile = professionalProfile({ headline: 'New headline' })
    const updated = updateProfessionalProfileInMe(current, profile)

    expect(updated?.profile).toEqual(profile)
    expect(updated?.memberships).toBe(current.memberships)
  })

  test('prepends and replaces confirmed credentials', () => {
    const original = credential('credential-a')
    const current = me(professionalProfile({ credentials: [original] }))
    const declared = credential('credential-b')
    const retired = credential('credential-a', { status: 'retired' })

    expect(prependCredentialToMe(current, declared)?.profile?.credentials).toEqual([
      declared,
      original,
    ])
    expect(replaceCredentialInMe(current, retired)?.profile?.credentials).toEqual([retired])
  })
})

function membership(id: string): OrganizationMembership {
  return {
    membership_id: id,
    display_name: 'Ada Lovelace',
    status: 'active',
    joined_at: '2026-01-01T00:00:00.000Z',
    ended_at: null,
    roles: ['owner'],
  }
}

function membershipPage(
  data: OrganizationMembership[],
  nextCursor: string | null,
): OrganizationMembershipPage {
  return { data, page: { next_cursor: nextCursor, has_more: nextCursor !== null } }
}

function invitation(id: string): TeamInvitationListItem {
  return {
    id,
    status: 'pending',
    channel: 'email',
    contact: 'technical@example.test',
    created_at: '2026-08-01T00:00:00.000Z',
    expires_at: '2026-08-22T00:00:00.000Z',
    intents: [
      {
        id: `${id}-intent`,
        kind: 'membership',
        status: 'pending',
        proposed_role_code: 'staff',
        decided_at: null,
      },
    ],
  }
}

function invitationPage(data: TeamInvitationListItem[]): TeamInvitationPage {
  return { data, page: { next_cursor: null, has_more: false } }
}

function credential(
  id: string,
  overrides: Partial<ProfessionalCredential> = {},
): ProfessionalCredential {
  return {
    id,
    credential_type_code: 'certification',
    credential_type_name: 'Certification',
    issuer: 'Technical issuer',
    name: 'Technical credential',
    identifier: null,
    issued_on: null,
    expires_on: null,
    verification_url: null,
    status: 'active',
    supersedes_credential_id: null,
    created_at: '2026-08-01T00:00:00.000Z',
    retired_at: null,
    verification: {
      state: 'unverified',
      valid_from: null,
      valid_to: null,
      effective: false,
    },
    ...overrides,
  }
}

function professionalProfile(overrides: Partial<ProfessionalProfile> = {}): ProfessionalProfile {
  return {
    id: 'profile-a',
    headline: 'Coach',
    bio: 'Technical profile',
    practice_started_year: 2020,
    experience_years: 6,
    specialties: [],
    credentials: [],
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

function me(profile: ProfessionalProfile | null = professionalProfile()): StudioMe {
  return { profile, memberships: [] }
}

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve: ((value: T) => void) | undefined
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return {
    promise,
    resolve: (value) => resolve?.(value),
  }
}
