import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { StudioSessionService } from '../../identity/index.js'
import type {
  ClientDirectoryService,
  HolderAssignmentService,
  HolderReassignmentService,
  RelationshipHistoryService,
  RelationshipStateService,
  SubstitutionProposalService,
  SubstitutionTerminationService,
} from '../application/index.js'
import type {
  DirectoryEntry,
  DirectoryPage,
  DirectoryQuery,
  RelationshipHistory,
  RelationshipHistoryEvent,
  RelationshipState,
} from '../domain/index.js'
import { studioRelationshipRoutes } from './studio.js'

const ORGANIZATION = '019ad000-0000-7000-8000-000000000101'
const HEADERS = {
  origin: 'https://studio.example.test',
  cookie: 'allfit_studio_session=opaque',
}

function sessions(overrides: Partial<StudioSessionService> = {}): StudioSessionService {
  return {
    completeCode: async () => ({ opaqueToken: 'opaque' }),
    readSession: async () => ({
      authenticated: true,
      registration_status: 'complete',
      identity: { given_name: 'Ada', family_name: 'Lovelace' },
    }),
    resolveActor: async () => ({ accountId: 'account', personId: 'person' }),
    resolveAccountIdentity: async () => ({
      actor: { accountId: 'account', personId: 'person' },
      identity: { givenName: 'Ada', familyName: 'Lovelace', verifiedEmail: 'ada@example.test' },
    }),
    logout: async () => ({ redirectUrl: 'https://studio.example.test', outcome: 'already-absent' }),
    ...overrides,
  }
}

function client(overrides: Record<string, unknown> = {}): DirectoryEntry {
  return {
    kind: 'relationship',
    relationshipId: '019ad000-0000-7000-8000-000000000301',
    personId: '019ad000-0000-7000-8000-000000000001',
    displayName: 'Ana Alvarez',
    relationshipStatus: 'active',
    invitationStatus: 'accepted',
    startedAt: new Date('2026-01-10T14:02:11.000Z'),
    endedAt: null,
    sortGroup: 'active',
    sortName: 'ana alvarez',
    sortId: '019ad000-0000-7000-8000-000000000301',
    ...overrides,
  } as DirectoryEntry
}

function invited(overrides: Record<string, unknown> = {}): DirectoryEntry {
  return {
    kind: 'invitation',
    invitationId: '019ad000-0000-7000-8000-000000000501',
    contactHint: 'b***@example.test',
    invitationStatus: 'pending',
    invitedAt: new Date('2026-02-01T09:00:00.000Z'),
    sortGroup: 'invited',
    sortName: 'bruno@example.test',
    sortId: '019ad000-0000-7000-8000-000000000501',
    ...overrides,
  } as DirectoryEntry
}

const QUOTA = { seats: 5, occupied: 3, placesLeft: 2, overQuota: false } as const

function directory(page: Partial<DirectoryPage> = {}, capture?: (query: DirectoryQuery) => void) {
  const service: ClientDirectoryService = {
    listClients: async (_actor, query) => {
      capture?.(query)
      return { items: [client()], hasMore: false, guestQuota: QUOTA, ...page }
    },
  }
  return service
}

function app(service: ClientDirectoryService, session = sessions()): Hono {
  const routes = new Hono()
  routes.route('/studio/v1', studioRelationshipRoutes({ directory: service, sessions: session }))
  return routes
}

beforeEach(() => {
  process.env.STUDIO_WEB_URL = 'https://studio.example.test'
})

describe('the client directory endpoint', () => {
  test('returns the clients the caller may see', async () => {
    const response = await app(directory()).request(
      `/studio/v1/organizations/${ORGANIZATION}/clients`,
      { headers: HEADERS },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    const body = (await response.json()) as { data: unknown[]; page: Record<string, unknown> }
    expect(body.data).toEqual([
      {
        kind: 'relationship',
        relationship_id: '019ad000-0000-7000-8000-000000000301',
        person_id: '019ad000-0000-7000-8000-000000000001',
        display_name: 'Ana Alvarez',
        relationship_status: 'active',
        invitation_status: 'accepted',
        started_at: '2026-01-10T14:02:11.000Z',
        ended_at: null,
      },
    ])
    expect(body.page).toEqual({ has_more: false, next_cursor: null })
  })

  test('says how many places are taken and how many are left', async () => {
    const response = await app(directory()).request(
      `/studio/v1/organizations/${ORGANIZATION}/clients`,
      { headers: HEADERS },
    )
    const body = (await response.json()) as { guest_quota: Record<string, unknown> }
    // Exactly four figures: who set the number is never part of the answer.
    expect(body.guest_quota).toEqual({ seats: 5, occupied: 3, places_left: 2, over_quota: false })
  })

  test('a gym with no quota has absent figures, never zero', async () => {
    const unlimited = { seats: null, occupied: 12, placesLeft: null, overQuota: false }
    const response = await app(directory({ guestQuota: unlimited })).request(
      `/studio/v1/organizations/${ORGANIZATION}/clients`,
      { headers: HEADERS },
    )
    const body = (await response.json()) as { guest_quota: Record<string, unknown> }
    expect(body.guest_quota).toEqual({
      seats: null,
      occupied: 12,
      places_left: null,
      over_quota: false,
    })
  })

  test('a gym over its quota says so with nothing left', async () => {
    const over = { seats: 2, occupied: 4, placesLeft: 0, overQuota: true }
    const response = await app(directory({ guestQuota: over })).request(
      `/studio/v1/organizations/${ORGANIZATION}/clients`,
      { headers: HEADERS },
    )
    const body = (await response.json()) as { guest_quota: Record<string, unknown> }
    expect(body.guest_quota).toEqual({ seats: 2, occupied: 4, places_left: 0, over_quota: true })
  })

  test('presents somebody invited with no person and no name', async () => {
    const response = await app(directory({ items: [invited()] })).request(
      `/studio/v1/organizations/${ORGANIZATION}/clients`,
      { headers: HEADERS },
    )
    const body = (await response.json()) as { data: Record<string, unknown>[] }
    expect(body.data).toEqual([
      {
        kind: 'invitation',
        invitation_id: '019ad000-0000-7000-8000-000000000501',
        contact_hint: 'b***@example.test',
        invitation_status: 'pending',
        invited_at: '2026-02-01T09:00:00.000Z',
      },
    ])
  })

  test('never echoes the full contact of somebody invited', async () => {
    const response = await app(directory({ items: [invited()] })).request(
      `/studio/v1/organizations/${ORGANIZATION}/clients`,
      { headers: HEADERS },
    )
    const body = await response.text()
    expect(body).not.toContain('bruno@example.test')
    expect(body).toContain('b***@example.test')
  })

  test('accepts the invited filter and passes it through unchanged', async () => {
    let seen: DirectoryQuery | undefined
    const response = await app(
      directory({ items: [invited()] }, (query) => {
        seen = query
      }),
    ).request(`/studio/v1/organizations/${ORGANIZATION}/clients?status=invited`, {
      headers: HEADERS,
    })
    expect(response.status).toBe(200)
    expect(seen?.status).toBe('invited')
  })

  /*
   * The response carries a name and the state of a link. Anything resembling
   * fitness data — a session count, a last-seen date, a goal — would make this
   * a read that must be audited, and the operations matrix says the directory
   * is not one.
   */
  test('carries nothing beyond identity and link state', async () => {
    const response = await app(directory()).request(
      `/studio/v1/organizations/${ORGANIZATION}/clients`,
      { headers: HEADERS },
    )
    const body = (await response.json()) as { data: Record<string, unknown>[] }
    expect(Object.keys(body.data[0] ?? {}).sort()).toEqual([
      'display_name',
      'ended_at',
      'invitation_status',
      'kind',
      'person_id',
      'relationship_id',
      'relationship_status',
      'started_at',
    ])
  })

  test('an invited entry carries nothing but the masked contact and its state', async () => {
    const response = await app(directory({ items: [invited()] })).request(
      `/studio/v1/organizations/${ORGANIZATION}/clients`,
      { headers: HEADERS },
    )
    const body = (await response.json()) as { data: Record<string, unknown>[] }
    expect(Object.keys(body.data[0] ?? {}).sort()).toEqual([
      'contact_hint',
      'invitation_id',
      'invitation_status',
      'invited_at',
      'kind',
    ])
  })

  test('a cursor is offered only when there is another page', async () => {
    const response = await app(directory({ hasMore: true })).request(
      `/studio/v1/organizations/${ORGANIZATION}/clients`,
      { headers: HEADERS },
    )
    const body = (await response.json()) as { page: { has_more: boolean; next_cursor: string } }
    expect(body.page.has_more).toBe(true)
    expect(body.page.next_cursor).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  test('a cursor issued under one filter is refused under another', async () => {
    const first = await app(directory({ hasMore: true })).request(
      `/studio/v1/organizations/${ORGANIZATION}/clients?status=active`,
      { headers: HEADERS },
    )
    const { page } = (await first.json()) as { page: { next_cursor: string } }

    const reused = await app(directory()).request(
      `/studio/v1/organizations/${ORGANIZATION}/clients?status=terminated&cursor=${page.next_cursor}`,
      { headers: HEADERS },
    )
    // Resuming a different query from this offset would look like rows
    // silently skipped rather than like a bad request.
    expect(reused.status).toBe(422)
  })

  test('an unknown status is refused rather than ignored', async () => {
    const response = await app(directory()).request(
      `/studio/v1/organizations/${ORGANIZATION}/clients?status=whatever`,
      { headers: HEADERS },
    )
    expect(response.status).toBe(422)
  })

  test('a page beyond the cap is refused', async () => {
    const response = await app(directory()).request(
      `/studio/v1/organizations/${ORGANIZATION}/clients?limit=500`,
      { headers: HEADERS },
    )
    expect(response.status).toBe(422)
  })

  test('an organization id that is not one is refused before any read', async () => {
    let called = false
    const service: ClientDirectoryService = {
      listClients: async () => {
        called = true
        return { items: [], hasMore: false, guestQuota: QUOTA }
      },
    }
    const response = await app(service).request('/studio/v1/organizations/not-a-uuid/clients', {
      headers: HEADERS,
    })
    expect(response.status).toBe(400)
    expect(called).toBe(false)
  })

  test('another origin is refused', async () => {
    const response = await app(directory()).request(
      `/studio/v1/organizations/${ORGANIZATION}/clients`,
      { headers: { ...HEADERS, origin: 'https://elsewhere.example.test' } },
    )
    expect(response.status).toBe(403)
  })

  test('a caller with no session is unauthenticated, not forbidden', async () => {
    const response = await app(directory()).request(
      `/studio/v1/organizations/${ORGANIZATION}/clients`,
      { headers: { origin: HEADERS.origin } },
    )
    expect(response.status).toBe(401)
  })

  test('the requested filter and page size reach the service unchanged', async () => {
    let seen: DirectoryQuery | undefined
    const response = await app(directory({}, (query) => (seen = query))).request(
      `/studio/v1/organizations/${ORGANIZATION}/clients?status=terminated&limit=10`,
      { headers: HEADERS },
    )
    expect(response.status).toBe(200)
    expect(seen).toMatchObject({
      organizationId: ORGANIZATION,
      status: 'terminated',
      limit: 10,
    })
  })
})

const ASSIGN_HEADERS = {
  ...HEADERS,
  'content-type': 'application/json',
  'idempotency-key': 'e5555555-5555-4555-8555-555555555555',
  'command-id': '019ad000-0000-7000-8000-000000000071',
}
const RELATIONSHIP = '019ad000-0000-7000-8000-000000000301'
const MEMBERSHIP = '019ad000-0000-7000-8000-000000000202'
const ASSIGN_PATH = `/studio/v1/organizations/${ORGANIZATION}/relationships/${RELATIONSHIP}/professional-assignments`

function holders(overrides: Partial<HolderAssignmentService> = {}): HolderAssignmentService {
  return {
    assign: async () => ({
      resource: {
        assignmentId: '019ad000-0000-7000-8000-000000000401',
        relationshipId: RELATIONSHIP,
        membershipId: MEMBERSHIP,
        personId: '019ad000-0000-7000-8000-000000000001',
        validFrom: new Date('2026-10-02T14:00:00.000Z'),
      },
      created: true,
      replayed: false,
    }),
    ...overrides,
  }
}

function assignApp(service: HolderAssignmentService = holders(), session = sessions()): Hono {
  const routes = new Hono()
  routes.route('/studio/v1', studioRelationshipRoutes({ sessions: session, holders: service }))
  return routes
}

function assign(body: unknown, headers: Record<string, string> = ASSIGN_HEADERS): Request {
  return new Request(`https://api.example.test${ASSIGN_PATH}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

describe('putting a coach in charge', () => {
  test('answers with the assignment it created', async () => {
    const response = await assignApp().fetch(assign({ membership_id: MEMBERSHIP }))
    expect(response.status).toBe(201)
    const payload = (await response.json()) as Record<string, unknown>
    expect(payload.membership_id).toBe(MEMBERSHIP)
  })

  /*
   * `201` has to mean a row was written, or a screen cannot tell "done" from
   * "it already was" — and the two need different words.
   */
  test('answers 200 when that coach was already the one in charge', async () => {
    const unchanged = holders({
      assign: async () => ({
        resource: {
          assignmentId: '019ad000-0000-7000-8000-000000000401',
          relationshipId: RELATIONSHIP,
          membershipId: MEMBERSHIP,
          personId: '019ad000-0000-7000-8000-000000000001',
          validFrom: new Date('2026-09-20T08:00:00.000Z'),
        },
        created: false,
        replayed: false,
      }),
    })
    const response = await assignApp(unchanged).fetch(assign({ membership_id: MEMBERSHIP }))
    expect(response.status).toBe(200)
    const payload = (await response.json()) as Record<string, unknown>
    expect(payload.valid_from).toBe('2026-09-20T08:00:00.000Z')
  })

  /*
   * The whole point of the command, and the easiest thing to break later:
   * being in charge is not being allowed. Nothing about a grant may appear in
   * this answer.
   */
  test('says nothing about what the coach may read', async () => {
    const response = await assignApp().fetch(assign({ membership_id: MEMBERSHIP }))
    const body = await response.text()
    expect(body).not.toContain('grant')
    expect(body).not.toContain('scope')
  })

  test('marks a replayed command', async () => {
    const replayed = holders({
      assign: async () => ({
        resource: {
          assignmentId: '019ad000-0000-7000-8000-000000000401',
          relationshipId: RELATIONSHIP,
          membershipId: MEMBERSHIP,
          personId: '019ad000-0000-7000-8000-000000000001',
          validFrom: new Date('2026-10-02T14:00:00.000Z'),
        },
        created: false,
        replayed: true,
      }),
    })
    const response = await assignApp(replayed).fetch(assign({ membership_id: MEMBERSHIP }))
    expect(response.headers.get('Idempotent-Replay')).toBe('true')
  })
})

describe('what assigning refuses', () => {
  test('a body with no membership', async () => {
    const response = await assignApp().fetch(assign({}))
    expect(response.status).toBe(422)
  })

  test('a membership that is not an identifier', async () => {
    const response = await assignApp().fetch(assign({ membership_id: 'nope' }))
    expect(response.status).toBe(422)
  })

  test('a body carrying a field the contract does not declare', async () => {
    const response = await assignApp().fetch(
      assign({ membership_id: MEMBERSHIP, kind: 'substitute' }),
    )
    expect(response.status).toBe(422)
  })

  test('command headers that are missing', async () => {
    const { 'command-id': _id, ...headers } = ASSIGN_HEADERS
    const response = await assignApp().fetch(assign({ membership_id: MEMBERSHIP }, headers))
    expect(response.status).toBe(400)
  })

  test('another origin', async () => {
    const response = await assignApp().fetch(
      assign({ membership_id: MEMBERSHIP }, { ...ASSIGN_HEADERS, origin: 'https://evil.test' }),
    )
    expect(response.status).toBe(403)
  })

  test('a caller PostgreSQL refuses, without inventing a reason', async () => {
    const denied = holders({
      assign: async () => {
        throw Object.assign(new Error('denied'), { code: '42501' })
      },
    })
    const response = await assignApp(denied).fetch(assign({ membership_id: MEMBERSHIP }))
    expect(response.status).toBe(403)
  })

  test('a relationship that is no longer active', async () => {
    const closed = holders({
      assign: async () => {
        throw Object.assign(new Error('terminated'), { code: 'P0004' })
      },
    })
    const response = await assignApp(closed).fetch(assign({ membership_id: MEMBERSHIP }))
    expect(response.status).toBe(409)
  })

  /*
   * Taking a client away from the coach who has them is OP-REL-003, and it
   * owes the person a notification this route never sends. Answering 409 is
   * what keeps this endpoint from doing that quietly.
   */
  test('a relationship that already has a different coach in charge', async () => {
    const taken = holders({
      assign: async () => {
        throw Object.assign(new Error('already has a holder'), { code: 'P0004' })
      },
    })
    const response = await assignApp(taken).fetch(assign({ membership_id: MEMBERSHIP }))
    expect(response.status).toBe(409)
  })
})

const STATE_PATH = `/studio/v1/organizations/${ORGANIZATION}/relationships/${RELATIONSHIP}`

function states(overrides: Partial<RelationshipState> = {}): RelationshipStateService {
  return {
    read: async () => ({
      relationshipId: RELATIONSHIP,
      personId: '019ad000-0000-7000-8000-000000000001',
      displayName: 'Ana Alvarez',
      status: 'active',
      startedAt: new Date('2026-01-10T14:02:11.000Z'),
      endedAt: null,
      holder: {
        assignmentId: '019ad000-0000-7000-8000-000000000401',
        membershipId: MEMBERSHIP,
        professionalPersonId: '019ad000-0000-7000-8000-000000000012',
        displayName: 'Camilo Coach',
        validFrom: new Date('2026-09-20T08:00:00.000Z'),
      },
      substitutions: [],
      grants: [
        {
          grantId: '019ad000-0000-7000-8000-000000000a01',
          scopeCode: 'health_context',
          displayName: 'Contexto de salud',
          versionNumber: 2,
          accessLevel: 'read',
          status: 'active',
          purpose: 'Adaptar el entrenamiento',
          grantedAt: new Date('2026-09-21T10:00:00.000Z'),
          revokedAt: null,
        },
      ],
      ...overrides,
    }),
  }
}

function stateApp(service: RelationshipStateService = states(), session = sessions()): Hono {
  const routes = new Hono()
  routes.route('/studio/v1', studioRelationshipRoutes({ sessions: session, states: service }))
  return routes
}

describe('reading how a relationship stands', () => {
  test('answers with the link, who attends and what was granted', async () => {
    const response = await stateApp().request(STATE_PATH, { headers: HEADERS })
    expect(response.status).toBe(200)
    const payload = (await response.json()) as Record<string, unknown>
    expect(payload.status).toBe('active')
    expect(payload.holder).toMatchObject({
      display_name: 'Camilo Coach',
      // The professional, not the client. A smoke read against PostgreSQL
      // caught these being the same id — the assignment row's `person_id` is
      // the client being attended.
      professional_person_id: '019ad000-0000-7000-8000-000000000012',
    })
    expect(payload.grants).toHaveLength(1)
  })

  /*
   * Criterion 2 of the story, and the reason the field exists: the version that
   * was agreed, not the latest published one.
   */
  test('a grant carries the scope version it was agreed under', async () => {
    const response = await stateApp().request(STATE_PATH, { headers: HEADERS })
    const payload = (await response.json()) as { grants: Record<string, unknown>[] }
    expect(payload.grants[0]?.version_number).toBe(2)
    expect(payload.grants[0]?.scope_code).toBe('health_context')
  })

  /*
   * Criterion 3. The response may say a health-context permission exists; it may
   * not carry anything the permission covers. Fixing the key set here means a
   * field added later fails this test instead of reaching a screen.
   */
  test('a grant carries nothing but the permission', async () => {
    const response = await stateApp().request(STATE_PATH, { headers: HEADERS })
    const payload = (await response.json()) as { grants: Record<string, unknown>[] }
    expect(Object.keys(payload.grants[0] ?? {}).sort()).toEqual([
      'access_level',
      'display_name',
      'grant_id',
      'granted_at',
      'purpose',
      'revoked_at',
      'scope_code',
      'status',
      'version_number',
    ])
  })

  test('a client nobody attends yet says so with null', async () => {
    const response = await stateApp(states({ holder: null })).request(STATE_PATH, {
      headers: HEADERS,
    })
    const payload = (await response.json()) as Record<string, unknown>
    expect(payload.holder).toBeNull()
    expect(payload.substitutions).toEqual([])
  })

  test('the response is never stored', async () => {
    const response = await stateApp().request(STATE_PATH, { headers: HEADERS })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  test('a relationship the caller may not see is a 404, not a 403', async () => {
    const hidden: RelationshipStateService = {
      read: async () => {
        throw Object.assign(new Error('not found'), { code: 'P0002' })
      },
    }
    const response = await stateApp(hidden).request(STATE_PATH, { headers: HEADERS })
    expect(response.status).toBe(404)
  })

  test('a relationship id that is not an identifier', async () => {
    const response = await stateApp().request(
      `/studio/v1/organizations/${ORGANIZATION}/relationships/nope`,
      { headers: HEADERS },
    )
    expect(response.status).toBe(400)
  })

  test('another origin', async () => {
    const response = await stateApp().request(STATE_PATH, {
      headers: { ...HEADERS, origin: 'https://evil.test' },
    })
    expect(response.status).toBe(403)
  })

  test('no session', async () => {
    const response = await stateApp().request(STATE_PATH, {
      headers: { origin: HEADERS.origin },
    })
    expect(response.status).toBe(401)
  })
})

const REASSIGN_PATH = `${ASSIGN_PATH}/reassignment`

function reassignments(
  overrides: Partial<HolderReassignmentService> = {},
): HolderReassignmentService {
  return {
    reassign: async () => ({
      resource: {
        assignmentId: '019ad000-0000-7000-8000-000000000402',
        relationshipId: RELATIONSHIP,
        membershipId: MEMBERSHIP,
        professionalPersonId: '019ad000-0000-7000-8000-000000000013',
        validFrom: new Date('2026-10-03T09:00:00.000Z'),
        replacedAssignmentId: '019ad000-0000-7000-8000-000000000401',
      },
      reassigned: true,
      replayed: false,
    }),
    ...overrides,
  }
}

function reassignApp(service: HolderReassignmentService = reassignments()): Hono {
  const routes = new Hono()
  routes.route(
    '/studio/v1',
    studioRelationshipRoutes({ sessions: sessions(), reassignments: service }),
  )
  return routes
}

function reassign(body: unknown, headers: Record<string, string> = ASSIGN_HEADERS): Request {
  return new Request(`https://api.example.test${REASSIGN_PATH}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

describe('changing which coach is in charge', () => {
  test('answers with the new assignment and the one it replaced', async () => {
    const response = await reassignApp().fetch(reassign({ membership_id: MEMBERSHIP }))
    expect(response.status).toBe(201)
    const payload = (await response.json()) as Record<string, unknown>
    expect(payload.replaced_assignment_id).toBe('019ad000-0000-7000-8000-000000000401')
    expect(payload.professional_person_id).toBe('019ad000-0000-7000-8000-000000000013')
  })

  /*
   * `201` has to mean the client actually moved, because that is also the case
   * where somebody was emailed. Naming the coach who is already in charge
   * writes nothing and notifies nobody.
   */
  test('answers 200 when that coach was already in charge', async () => {
    const unchanged = reassignments({
      reassign: async () => ({
        resource: {
          assignmentId: '019ad000-0000-7000-8000-000000000401',
          relationshipId: RELATIONSHIP,
          membershipId: MEMBERSHIP,
          professionalPersonId: '019ad000-0000-7000-8000-000000000012',
          validFrom: new Date('2026-09-20T08:00:00.000Z'),
          replacedAssignmentId: null,
        },
        reassigned: false,
        replayed: false,
      }),
    })
    const response = await reassignApp(unchanged).fetch(reassign({ membership_id: MEMBERSHIP }))
    expect(response.status).toBe(200)
  })

  test('marks a replayed command', async () => {
    const replayed = reassignments({
      reassign: async () => ({
        resource: {
          assignmentId: '019ad000-0000-7000-8000-000000000402',
          relationshipId: RELATIONSHIP,
          membershipId: MEMBERSHIP,
          professionalPersonId: '019ad000-0000-7000-8000-000000000013',
          validFrom: new Date('2026-10-03T09:00:00.000Z'),
          replacedAssignmentId: null,
        },
        reassigned: false,
        replayed: true,
      }),
    })
    const response = await reassignApp(replayed).fetch(reassign({ membership_id: MEMBERSHIP }))
    expect(response.headers.get('Idempotent-Replay')).toBe('true')
  })

  // Nobody to take the client from: putting the first coach in charge is the
  // other operation, which notifies nobody because nobody is losing anything.
  test('a relationship with nobody in charge is a conflict', async () => {
    const empty = reassignments({
      reassign: async () => {
        throw Object.assign(new Error('no holder'), { code: 'P0004' })
      },
    })
    const response = await reassignApp(empty).fetch(reassign({ membership_id: MEMBERSHIP }))
    expect(response.status).toBe(409)
  })

  test('command headers that are missing', async () => {
    const { 'command-id': _id, ...headers } = ASSIGN_HEADERS
    const response = await reassignApp().fetch(reassign({ membership_id: MEMBERSHIP }, headers))
    expect(response.status).toBe(400)
  })

  test('another origin', async () => {
    const response = await reassignApp().fetch(
      reassign({ membership_id: MEMBERSHIP }, { ...ASSIGN_HEADERS, origin: 'https://evil.test' }),
    )
    expect(response.status).toBe(403)
  })

  test('a body carrying a field the contract does not declare', async () => {
    const response = await reassignApp().fetch(
      reassign({ membership_id: MEMBERSHIP, notify: false }),
    )
    expect(response.status).toBe(422)
  })
})

const EVENTS_PATH = `/studio/v1/organizations/${ORGANIZATION}/relationships/${RELATIONSHIP}/events`

function historyEvents(): RelationshipHistoryEvent[] {
  return [
    {
      type: 'relationship_ended',
      occurredAt: new Date('2026-10-05T10:00:00.000Z'),
      sourceId: RELATIONSHIP,
      detail: { ended_by_kind: 'person', declared_by_us: false, reason: null },
    },
    {
      type: 'holder_assigned',
      occurredAt: new Date('2026-10-01T08:00:00.000Z'),
      sourceId: '019ad000-0000-7000-8000-000000000402',
      detail: { display_name: 'Diana Entrante' },
    },
  ]
}

function histories(
  overrides: Partial<RelationshipHistory> = {},
  capture?: (query: Record<string, unknown>) => void,
): RelationshipHistoryService {
  return {
    read: async (_actor, query) => {
      capture?.(query as unknown as Record<string, unknown>)
      return {
        relationshipId: RELATIONSHIP,
        personId: '019ad000-0000-7000-8000-000000000001',
        events: historyEvents(),
        nextCursor: null,
        hasMore: false,
        ...overrides,
      }
    },
  }
}

function historyApp(service: RelationshipHistoryService = histories()): Hono {
  const routes = new Hono()
  routes.route('/studio/v1', studioRelationshipRoutes({ sessions: sessions(), histories: service }))
  return routes
}

function askHistory(query = '', headers: Record<string, string> = HEADERS): Request {
  return new Request(`https://api.example.test${EVENTS_PATH}${query}`, { headers })
}

describe('reading what a relationship has been through', () => {
  test('answers the timeline in the page envelope the other lists use', async () => {
    const response = await historyApp().fetch(askHistory())
    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      data: { type: string; occurred_at: string }[]
      page: { next_cursor: string | null; has_more: boolean }
    }
    expect(payload.data).toHaveLength(2)
    expect(payload.data[0]?.type).toBe('relationship_ended')
    expect(payload.data[0]?.occurred_at).toBe('2026-10-05T10:00:00.000Z')
    expect(payload.page).toEqual({ next_cursor: null, has_more: false })
  })

  /*
   * The relationship's own id is in the path, so the body must not repeat it.
   * Two sources for one fact is how they come to disagree.
   */
  test('does not repeat the relationship id in the body', async () => {
    const response = await historyApp().fetch(askHistory())
    const payload = (await response.json()) as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual(['data', 'page'])
  })

  /*
   * A reason the person gave is theirs. The route must pass through what the
   * function decided rather than reconstruct it, so this asserts the shape the
   * screen will read: who closed it, and that no reason came with it.
   */
  test('carries that the person closed it without a reason for us', async () => {
    const response = await historyApp().fetch(askHistory())
    const payload = (await response.json()) as { data: { detail: Record<string, unknown> }[] }
    expect(payload.data[0]?.detail).toEqual({
      ended_by_kind: 'person',
      declared_by_us: false,
      reason: null,
    })
  })

  test('passes the limit and the cursor down untouched', async () => {
    const seen: Record<string, unknown>[] = []
    const app = historyApp(histories({}, (query) => seen.push(query)))
    await app.fetch(askHistory('?limit=25&cursor=b3BhcXVl'))
    expect(seen[0]).toEqual({
      organizationId: ORGANIZATION,
      relationshipId: RELATIONSHIP,
      limit: 25,
      cursor: 'b3BhcXVl',
    })
  })

  // No query means no opinion: the function owns the default, and sending one
  // from here would be a second place that decides it.
  test('sends null rather than a default when neither is given', async () => {
    const seen: Record<string, unknown>[] = []
    const app = historyApp(histories({}, (query) => seen.push(query)))
    await app.fetch(askHistory())
    expect(seen[0]?.limit).toBeNull()
    expect(seen[0]?.cursor).toBeNull()
  })

  test('reports the cursor when there is another page', async () => {
    const app = historyApp(histories({ nextCursor: 'bmV4dC1wYWdl', hasMore: true }))
    const response = await app.fetch(askHistory('?limit=1'))
    const payload = (await response.json()) as { page: Record<string, unknown> }
    expect(payload.page).toEqual({ next_cursor: 'bmV4dC1wYWdl', has_more: true })
  })

  test('a limit that is not a number', async () => {
    const response = await historyApp().fetch(askHistory('?limit=todos'))
    expect(response.status).toBe(400)
  })

  test('a relationship id that is not a uuid', async () => {
    const response = await historyApp().fetch(
      new Request(
        `https://api.example.test/studio/v1/organizations/${ORGANIZATION}/relationships/nope/events`,
        { headers: HEADERS },
      ),
    )
    expect(response.status).toBe(400)
  })

  test('another origin', async () => {
    const response = await historyApp().fetch(
      askHistory('', { ...HEADERS, origin: 'https://evil.test' }),
    )
    expect(response.status).toBe(403)
  })

  // The history is read for deciding, so a stale copy is worse than a slow one.
  test('is never stored by a cache', async () => {
    const response = await historyApp().fetch(askHistory())
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
})

const COVER_PATH = `/studio/v1/organizations/${ORGANIZATION}/relationships/${RELATIONSHIP}/substitutions`
const COVER_BODY = {
  membership_id: MEMBERSHIP,
  starts_on: '2026-11-02',
  ends_on: '2026-11-09',
}

function proposals(
  overrides: Partial<SubstitutionProposalService> = {},
  capture?: (input: Record<string, unknown>) => void,
): SubstitutionProposalService {
  return {
    propose: async (_actor, input) => {
      capture?.(input as unknown as Record<string, unknown>)
      return {
        resource: {
          assignmentId: '019ad000-0000-7000-8000-000000000403',
          relationshipId: RELATIONSHIP,
          membershipId: MEMBERSHIP,
          professionalPersonId: '019ad000-0000-7000-8000-000000000014',
          startsOn: '2026-11-02',
          endsOn: '2026-11-09',
        },
        proposed: true,
        replayed: false,
      }
    },
    ...overrides,
  }
}

function coverApp(service: SubstitutionProposalService = proposals()): Hono {
  const routes = new Hono()
  routes.route(
    '/studio/v1',
    studioRelationshipRoutes({ sessions: sessions(), substitutions: service }),
  )
  return routes
}

function propose(body: unknown, headers: Record<string, string> = ASSIGN_HEADERS): Request {
  return new Request(`https://api.example.test${COVER_PATH}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

describe('asking a client to accept a cover', () => {
  test('answers with the cover and the days it would run', async () => {
    const response = await coverApp().fetch(propose(COVER_BODY))
    expect(response.status).toBe(201)
    const payload = (await response.json()) as Record<string, unknown>
    expect(payload.professional_person_id).toBe('019ad000-0000-7000-8000-000000000014')
    expect(payload.starts_on).toBe('2026-11-02')
    expect(payload.ends_on).toBe('2026-11-09')
  })

  /*
   * The dates go down as the strings they arrived as. A `date` has no time and
   * no zone, and routing one through `Date` would attach both — a cover
   * starting on the 2nd becoming the 1st at 22:00 for a caller an hour west.
   */
  test('passes the days down without turning them into instants', async () => {
    const seen: Record<string, unknown>[] = []
    const app = coverApp(proposals({}, (input) => seen.push(input)))
    await app.fetch(propose(COVER_BODY))
    expect(seen[0]?.startsOn).toBe('2026-11-02')
    expect(seen[0]?.endsOn).toBe('2026-11-09')
  })

  test('marks a replayed command', async () => {
    const replayed = proposals({
      propose: async () => ({
        resource: {
          assignmentId: '019ad000-0000-7000-8000-000000000403',
          relationshipId: RELATIONSHIP,
          membershipId: MEMBERSHIP,
          professionalPersonId: '019ad000-0000-7000-8000-000000000014',
          startsOn: '2026-11-02',
          endsOn: '2026-11-09',
        },
        proposed: false,
        replayed: true,
      }),
    })
    const response = await coverApp(replayed).fetch(propose(COVER_BODY))
    expect(response.status).toBe(200)
    expect(response.headers.get('Idempotent-Replay')).toBe('true')
  })

  /*
   * Without an end date the cover would have to be switched off by hand, and
   * until somebody did, it would keep granting access to a person's data. `422`
   * and not `409`: the request is malformed, there is nothing to conflict with.
   */
  test('a cover with no end date is rejected', async () => {
    const { ends_on: _end, ...open } = COVER_BODY
    const response = await coverApp().fetch(propose(open))
    expect(response.status).toBe(422)
  })

  test('a date that is not a day anybody has', async () => {
    const response = await coverApp().fetch(propose({ ...COVER_BODY, ends_on: '2026-02-31' }))
    expect(response.status).toBe(422)
  })

  test('a date written as an instant', async () => {
    const response = await coverApp().fetch(
      propose({ ...COVER_BODY, starts_on: '2026-11-02T00:00:00Z' }),
    )
    expect(response.status).toBe(422)
  })

  // Naming the fields in another order is not a different request.
  test('accepts the fields in any order', async () => {
    const response = await coverApp().fetch(
      propose({ ends_on: '2026-11-09', starts_on: '2026-11-02', membership_id: MEMBERSHIP }),
    )
    expect(response.status).toBe(201)
  })

  test('a body carrying a field the contract does not declare', async () => {
    const response = await coverApp().fetch(propose({ ...COVER_BODY, notify: false }))
    expect(response.status).toBe(422)
  })

  // The same cover asked for twice. The database refuses it with a duplicate
  // key, which has to reach the caller as a conflict rather than an outage.
  test('the same cover asked for twice is a conflict', async () => {
    const duplicate = proposals({
      propose: async () => {
        throw Object.assign(new Error('duplicate'), { code: '23505' })
      },
    })
    const response = await coverApp(duplicate).fetch(propose(COVER_BODY))
    expect(response.status).toBe(409)
  })

  // A coach who does not attend this person must not learn that it exists.
  test('a relationship the caller may not see is a 404, not a 403', async () => {
    const hidden = proposals({
      propose: async () => {
        throw Object.assign(new Error('not found'), { code: 'P0002' })
      },
    })
    const response = await coverApp(hidden).fetch(propose(COVER_BODY))
    expect(response.status).toBe(404)
  })

  test('somebody who may not decide who attends', async () => {
    const refused = proposals({
      propose: async () => {
        throw Object.assign(new Error('forbidden'), { code: '42501' })
      },
    })
    const response = await coverApp(refused).fetch(propose(COVER_BODY))
    expect(response.status).toBe(403)
  })

  test('command headers that are missing', async () => {
    const { 'command-id': _id, ...headers } = ASSIGN_HEADERS
    const response = await coverApp().fetch(propose(COVER_BODY, headers))
    expect(response.status).toBe(400)
  })

  test('another origin', async () => {
    const response = await coverApp().fetch(
      propose(COVER_BODY, { ...ASSIGN_HEADERS, origin: 'https://evil.test' }),
    )
    expect(response.status).toBe(403)
  })

  test('the response is never stored', async () => {
    const response = await coverApp().fetch(propose(COVER_BODY))
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})

const SUBSTITUTION = '019ad000-0000-7000-8000-000000000403'
const END_PATH =
  `/studio/v1/organizations/${ORGANIZATION}/relationships/${RELATIONSHIP}` +
  `/substitutions/${SUBSTITUTION}/termination`

function terminations(
  overrides: Partial<SubstitutionTerminationService> = {},
  capture?: (input: Record<string, unknown>) => void,
): SubstitutionTerminationService {
  const answer = async (input: Record<string, unknown>) => {
    capture?.(input)
    return {
      resource: {
        assignmentId: SUBSTITUTION,
        relationshipId: RELATIONSHIP,
        membershipId: MEMBERSHIP,
        professionalPersonId: '019ad000-0000-7000-8000-000000000014',
        endedAt: '2026-11-04T15:20:00.000Z',
      },
      replayed: false,
    }
  }
  return {
    end: async (_actor, input) => answer(input as unknown as Record<string, unknown>),
    endMine: async (_personId, input) => answer(input as unknown as Record<string, unknown>),
    ...overrides,
  }
}

function endApp(service: SubstitutionTerminationService = terminations()): Hono {
  const routes = new Hono()
  routes.route(
    '/studio/v1',
    studioRelationshipRoutes({ sessions: sessions(), terminations: service }),
  )
  return routes
}

function endCover(path: string = END_PATH, headers: Record<string, string> = ASSIGN_HEADERS) {
  return new Request(`https://api.example.test${path}`, { method: 'POST', headers })
}

describe('ending a cover before its last day', () => {
  test('answers with the cover and the instant the access stopped', async () => {
    const response = await endApp().fetch(endCover())
    expect(response.status).toBe(200)
    const payload = (await response.json()) as Record<string, unknown>
    expect(payload.assignment_id).toBe(SUBSTITUTION)
    expect(payload.ended_at).toBe('2026-11-04T15:20:00.000Z')
  })

  test('marks a replayed command', async () => {
    const replayed = terminations({
      end: async () => ({
        resource: {
          assignmentId: SUBSTITUTION,
          relationshipId: RELATIONSHIP,
          membershipId: MEMBERSHIP,
          professionalPersonId: '019ad000-0000-7000-8000-000000000014',
          endedAt: '2026-11-04T15:20:00.000Z',
        },
        replayed: true,
      }),
    })
    const response = await endApp(replayed).fetch(endCover())
    expect(response.headers.get('Idempotent-Replay')).toBe('true')
  })

  /*
   * The command carries no body, so what makes it idempotent is hashed from
   * what the path names. Hashing an empty object instead would make one key
   * replay the first cover's answer for a second, different one — and the
   * caller would be told an access was cut that is still running.
   */
  test('two different covers under one key are two different commands', async () => {
    const seen: Record<string, unknown>[] = []
    const app = endApp(terminations({}, (input) => seen.push(input)))
    await app.fetch(endCover())
    const other = '019ad000-0000-7000-8000-000000000404'
    await app.fetch(
      endCover(
        `/studio/v1/organizations/${ORGANIZATION}/relationships/${RELATIONSHIP}` +
          `/substitutions/${other}/termination`,
      ),
    )
    expect(seen[0]?.requestHash).not.toEqual(seen[1]?.requestHash)
  })

  // A cover nobody answered grants nothing, so there is no access to cut. The
  // command refuses it and that has to read as a conflict, not an outage.
  test('a cover that is not running is a conflict', async () => {
    const refused = terminations({
      end: async () => {
        throw Object.assign(new Error('not running'), { code: 'P0004' })
      },
    })
    const response = await endApp(refused).fetch(endCover())
    expect(response.status).toBe(409)
  })

  // The coach in charge may propose a cover and may not end one. The command
  // decides it; this proves the refusal reaches the caller as a refusal.
  test('a caller the command refuses gets a refusal, not an outage', async () => {
    const refused = terminations({
      end: async () => {
        throw Object.assign(new Error('not allowed'), { code: '42501' })
      },
    })
    const response = await endApp(refused).fetch(endCover())
    expect(response.status).toBe(403)
  })

  test('a substitution id that is not an id', async () => {
    const response = await endApp().fetch(
      endCover(
        `/studio/v1/organizations/${ORGANIZATION}/relationships/${RELATIONSHIP}` +
          `/substitutions/not-an-id/termination`,
      ),
    )
    expect(response.status).toBe(400)
  })

  test('without command headers it is not a command', async () => {
    const { 'idempotency-key': _key, ...headers } = ASSIGN_HEADERS
    const response = await endApp().fetch(endCover(END_PATH, headers))
    expect(response.status).toBe(400)
  })

  test('is never stored by a cache', async () => {
    const response = await endApp().fetch(endCover())
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
