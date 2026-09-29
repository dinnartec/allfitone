import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { StudioSessionService } from '../../identity/index.js'
import type { ClientDirectoryService } from '../application/index.js'
import type { DirectoryPage, DirectoryQuery } from '../domain/index.js'
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

function client(overrides: Record<string, unknown> = {}) {
  return {
    relationshipId: '019ad000-0000-7000-8000-000000000301',
    personId: '019ad000-0000-7000-8000-000000000001',
    displayName: 'Ana Alvarez',
    status: 'active' as const,
    startedAt: new Date('2026-01-10T14:02:11.000Z'),
    endedAt: null,
    sortDisplayName: 'ana alvarez',
    ...overrides,
  }
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
        relationship_id: '019ad000-0000-7000-8000-000000000301',
        person_id: '019ad000-0000-7000-8000-000000000001',
        display_name: 'Ana Alvarez',
        status: 'active',
        started_at: '2026-01-10T14:02:11.000Z',
        ended_at: null,
      },
    ])
    expect(body.page).toEqual({ has_more: false, next_cursor: null })
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
      'person_id',
      'relationship_id',
      'started_at',
      'status',
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
