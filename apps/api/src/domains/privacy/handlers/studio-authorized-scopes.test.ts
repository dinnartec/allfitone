/**
 * OP-PRV-023 at the edge.
 *
 * What a coach may count is settled in PostgreSQL and covered by
 * T-PRV-SCOPES-01; nothing here re-tests it with a stub, which would only prove
 * the stub. These cover what the handler itself decides: the shape of the page,
 * the cursor it issues and refuses, and the refusals it maps.
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { StudioSessionService } from '../../identity/index.js'
import type { AuthorizedScopeService, OfferableScopeService } from '../application/index.js'
import type { AuthorizedScope } from '../domain/index.js'
import { studioPrivacyRoutes } from './studio.js'

const ORGANIZATION = '0199e000-0000-7000-8000-000000000101'
const PATH = `/studio/v1/organizations/${ORGANIZATION}/authorized-scopes`
const HEADERS = {
  origin: 'https://studio.example.test',
  cookie: 'allfit_studio_session=opaque',
}

const GRANTED: AuthorizedScope = {
  relationship_id: '0199e000-0000-7000-8000-000000000401',
  person_id: '0199e000-0000-7000-8000-000000000001',
  display_name: 'Ana Asignada',
  grant_id: '0199e000-0000-7000-8000-000000000c01',
  scope_code: 'health_context',
  scope_display_name: 'Contexto de salud',
  version_number: 3,
  access_level: 'read',
  status: 'active',
  purpose: 'Adaptar el entrenamiento',
  granted_at: '2026-10-01T12:00:00.000Z',
  revoked_at: null,
}

const WITHDRAWN: AuthorizedScope = {
  ...GRANTED,
  grant_id: '0199e000-0000-7000-8000-000000000c02',
  scope_code: 'body_progress',
  scope_display_name: 'Progreso corporal',
  status: 'revoked',
  purpose: 'Seguir el progreso',
  granted_at: '2026-10-02T12:00:00.000Z',
  revoked_at: '2026-10-20T12:00:00.000Z',
}

function sessions(overrides: Partial<StudioSessionService> = {}): StudioSessionService {
  return {
    completeCode: async () => ({ opaqueToken: 'opaque' }),
    readSession: async () => ({
      authenticated: true,
      registration_status: 'complete',
      identity: { given_name: null, family_name: null },
    }),
    resolveActor: async () => ({
      accountId: 'account',
      personId: '0199e000-0000-7000-8000-000000000011',
    }),
    resolveAccountIdentity: async () => ({
      actor: { accountId: 'account', personId: '0199e000-0000-7000-8000-000000000011' },
      identity: { givenName: null, familyName: null, verifiedEmail: 'ada@example.test' },
    }),
    logout: async () => ({ redirectUrl: 'https://studio.example.test', outcome: 'revoked' }),
    ...overrides,
  }
}

function register(overrides: Partial<AuthorizedScopeService> = {}): AuthorizedScopeService {
  return {
    list: async () => ({ items: [GRANTED, WITHDRAWN], hasMore: false }),
    ...overrides,
  }
}

const catalogue: OfferableScopeService = { list: async () => [] }

function app(service: AuthorizedScopeService = register(), session = sessions()): Hono {
  const routes = new Hono()
  routes.route('/studio/v1', studioPrivacyRoutes(catalogue, session, service))
  return routes
}

function get(path = PATH, headers: Record<string, string> = HEADERS): Request {
  return new Request(`https://api.example.test${path}`, { headers })
}

beforeEach(() => {
  process.env.STUDIO_WEB_URL = 'https://studio.example.test'
})

describe('what each person authorized us to see', () => {
  test('returns one entry per authorization, with the dates that bound it', async () => {
    const response = await app().fetch(get())

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const payload = (await response.json()) as { data: AuthorizedScope[]; page: unknown }
    expect(payload.data).toHaveLength(2)
    expect(payload.data[0]).toMatchObject({
      scope_code: 'health_context',
      status: 'active',
      granted_at: '2026-10-01T12:00:00.000Z',
      revoked_at: null,
    })
  })

  /*
   * Criterion 4. A withdrawn authorization is not dropped from the register: it
   * is what explains no longer seeing that part.
   */
  test('a withdrawn authorization stays, saying when it was withdrawn', async () => {
    const response = await app().fetch(get())
    const payload = (await response.json()) as { data: AuthorizedScope[] }

    expect(payload.data[1]).toMatchObject({
      status: 'revoked',
      revoked_at: '2026-10-20T12:00:00.000Z',
    })
  })

  /*
   * Criterion 3, pinned rather than read: the day a field carrying content is
   * added to the response, this fails.
   */
  test('carries the state of the permission and nothing it covers', async () => {
    const response = await app().fetch(get())
    const payload = (await response.json()) as { data: Record<string, unknown>[] }

    expect(Object.keys(payload.data[0] ?? {}).sort()).toEqual([
      'access_level',
      'display_name',
      'grant_id',
      'granted_at',
      'person_id',
      'purpose',
      'relationship_id',
      'revoked_at',
      'scope_code',
      'scope_display_name',
      'status',
      'version_number',
    ])
  })

  test('issues a cursor only when there is another page', async () => {
    const empty = await app().fetch(get())
    expect(
      ((await empty.json()) as { page: { next_cursor: string | null } }).page.next_cursor,
    ).toBeNull()

    const more = await app(
      register({ list: async () => ({ items: [GRANTED], hasMore: true }) }),
    ).fetch(get())
    const payload = (await more.json()) as { page: { next_cursor: string; has_more: boolean } }
    expect(payload.page.has_more).toBe(true)
    expect(JSON.parse(Buffer.from(payload.page.next_cursor, 'base64url').toString())).toEqual({
      v: 1,
      name: 'Ana Asignada',
      id: GRANTED.grant_id,
    })
  })

  /*
   * A corrupted cursor is refused rather than answered with the first page.
   * Starting over silently reads as rows skipped, which is worse than an error
   * the caller can see.
   */
  test('refuses a cursor it cannot read instead of starting over', async () => {
    const response = await app().fetch(get(`${PATH}?cursor=not-a-cursor`))
    expect(response.status).toBe(422)
  })

  test('refuses a page size outside the contract', async () => {
    expect((await app().fetch(get(`${PATH}?limit=0`))).status).toBe(422)
    expect((await app().fetch(get(`${PATH}?limit=101`))).status).toBe(422)
    expect((await app().fetch(get(`${PATH}?limit=50`))).status).toBe(200)
  })

  test('refuses an organization id that is not one', async () => {
    const response = await app().fetch(get('/studio/v1/organizations/not-a-uuid/authorized-scopes'))
    expect(response.status).toBe(422)
  })

  /*
   * The database refuses a reader without a directory capability with 42501.
   * The handler must carry that through as a refusal, not as an outage: an
   * upstream error invites a retry that will fail exactly the same way.
   */
  test('a refusal from the database is a refusal, not an outage', async () => {
    const response = await app(
      register({
        list: async () => {
          throw Object.assign(new Error('forbidden'), { code: '42501' })
        },
      }),
    ).fetch(get())

    expect(response.status).toBe(403)
  })

  test('another origin is refused', async () => {
    const response = await app().fetch(
      get(PATH, { ...HEADERS, origin: 'https://evil.example.test' }),
    )
    expect(response.status).toBe(403)
  })

  test('no session is unauthenticated', async () => {
    const response = await app().fetch(get(PATH, { origin: HEADERS.origin }))
    expect(response.status).toBe(401)
  })
})
