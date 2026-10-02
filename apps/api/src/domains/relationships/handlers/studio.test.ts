import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { StudioSessionService } from '../../identity/index.js'
import type { ClientDirectoryService, HolderAssignmentService } from '../application/index.js'
import type { DirectoryEntry, DirectoryPage, DirectoryQuery } from '../domain/index.js'
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

function directory(page: Partial<DirectoryPage> = {}, capture?: (query: DirectoryQuery) => void) {
  const service: ClientDirectoryService = {
    listClients: async (_actor, query) => {
      capture?.(query)
      return { items: [client()], hasMore: false, ...page }
    },
  }
  return service
}

function app(service: ClientDirectoryService, session = sessions()): Hono {
  const routes = new Hono()
  routes.route('/studio/v1', studioRelationshipRoutes(service, session))
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
        return { items: [], hasMore: false }
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
  routes.route('/studio/v1', studioRelationshipRoutes(directory(), session, service))
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
