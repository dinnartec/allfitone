import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { StudioSessionError, type StudioSessionService } from '../../identity/index.js'
import { StudioOrganizationError, type StudioOrganizationService } from '../application/index.js'
import { studioOrganizationRoutes } from './studio.js'

const HEADERS = {
  origin: 'https://studio.example.test',
  cookie: 'allfit_studio_session=opaque',
  'idempotency-key': '11111111-1111-4111-8111-111111111111',
  'command-id': '22222222-2222-7222-8222-222222222222',
  'content-type': 'application/json',
}

const ORGANIZATION_ID = '0198d000-0000-7000-8000-000000000021'
const SITE_ID = '0198d000-0000-7000-8000-000000000041'
const TARGET_MEMBERSHIP_ID = '0198d000-0000-7000-8000-000000000032'

interface ProblemResponse {
  type: string
  title: string
  status: number
  request_id: string
}

function sessions(overrides: Partial<StudioSessionService> = {}): StudioSessionService {
  return {
    completeCode: async () => ({ opaqueToken: 'opaque' }),
    readSession: async () => ({
      authenticated: true,
      registration_status: 'complete',
      identity: { given_name: 'Ada', family_name: 'Lovelace' },
    }),
    resolveActor: async () => ({
      accountId: '0198d000-0000-7000-8000-000000000011',
      personId: '0198d000-0000-7000-8000-000000000012',
    }),
    resolveAccountIdentity: async () => ({
      actor: {
        accountId: '0198d000-0000-7000-8000-000000000011',
        personId: '0198d000-0000-7000-8000-000000000012',
      },
      identity: { givenName: 'Ada', familyName: 'Lovelace', verifiedEmail: 'ada@example.test' },
    }),
    logout: async () => ({
      redirectUrl: 'https://studio.example.test',
      outcome: 'already-absent',
    }),
    ...overrides,
  }
}

function organizations(
  overrides: Partial<StudioOrganizationService> = {},
): StudioOrganizationService {
  return {
    listTypes: async () => [{ code: 'professional_practice', name: 'Profesional independiente' }],
    listMemberships: async () => [],
    listOrganizationMemberships: async () => ({ items: [], hasMore: false }),
    listRoleCatalog: async () => [],
    create: async () => ({
      id: '0198d000-0000-7000-8000-000000000021',
      membershipId: '0198d000-0000-7000-8000-000000000022',
      displayName: 'Ada Entrena',
      typeCode: 'professional_practice',
      roles: ['owner'],
    }),
    get: async () => ({
      id: ORGANIZATION_ID,
      displayName: 'Ada Entrena',
      legalName: 'Ada Entrena SAS',
      typeCode: 'studio',
      status: 'active',
      revisionNumber: 2,
      sites: [],
    }),
    update: async () => ({
      resource: {
        id: ORGANIZATION_ID,
        displayName: 'Ada Entrena Actualizada',
        legalName: 'Ada Entrena SAS',
        typeCode: 'studio',
        status: 'active',
        revisionNumber: 3,
        sites: [],
      },
      replayed: false,
    }),
    createSite: async () => ({
      resource: {
        id: '0198d000-0000-7000-8000-000000000041',
        name: 'Sede Centro',
        address: 'Carrera 7',
        status: 'active',
        revisionNumber: 0,
      },
      replayed: false,
    }),
    updateSite: async () => ({
      resource: {
        id: '0198d000-0000-7000-8000-000000000041',
        name: 'Sede Centro',
        address: 'Carrera 7',
        status: 'inactive',
        revisionNumber: 1,
      },
      replayed: false,
    }),
    transferOwnership: async () => ({
      resource: {
        organizationId: ORGANIZATION_ID,
        ownerMembershipId: '0198d000-0000-7000-8000-000000000032',
        previousOwnerMembershipId: '0198d000-0000-7000-8000-000000000022',
        transferredAt: '2026-08-17T15:30:00.000Z',
      },
      replayed: false,
    }),
    grantMembershipRole: async () => ({
      resource: {
        membershipId: '0198d000-0000-7000-8000-000000000032',
        roleCode: 'coach',
        validFrom: '2026-08-17T15:35:00.000Z',
      },
      replayed: false,
    }),
    ...overrides,
  }
}

function app(service = organizations(), sessionService = sessions()) {
  const instance = new Hono()
  instance.route('/studio/v1', studioOrganizationRoutes(service, sessionService))
  return instance
}

beforeEach(() => {
  process.env.STUDIO_WEB_URL = 'https://studio.example.test'
})

describe('Studio organization routes', () => {
  test('resolves the complete Studio entry context with one session and membership read', async () => {
    let sessionCalls = 0
    let membershipCalls = 0
    const response = await app(
      organizations({
        listMemberships: async () => {
          membershipCalls += 1
          return [
            {
              membershipId: '0198d000-0000-7000-8000-000000000022',
              organizationId: '0198d000-0000-7000-8000-000000000021',
              displayName: 'Ada Entrena',
              typeCode: 'professional_practice',
              status: 'active',
              joinedAt: new Date('2026-08-09T12:00:00.000Z'),
              roles: ['owner'],
            },
          ]
        },
      }),
      sessions({
        resolveAccountIdentity: async () => {
          sessionCalls += 1
          return {
            actor: {
              accountId: '0198d000-0000-7000-8000-000000000011',
              personId: '0198d000-0000-7000-8000-000000000012',
            },
            identity: {
              givenName: 'Ada',
              familyName: 'Lovelace',
              verifiedEmail: 'ada@example.test',
            },
          }
        },
      }),
    ).request('/studio/v1/entry-context', { headers: HEADERS })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(sessionCalls).toBe(1)
    expect(membershipCalls).toBe(1)
    await expect(response.json()).resolves.toMatchObject({
      authenticated: true,
      registration_status: 'complete',
      identity: { name: 'Ada Lovelace', email: 'ada@example.test' },
      memberships: [{ display_name: 'Ada Entrena', roles: ['owner'] }],
    })
  })

  test('returns an empty entry context without reading memberships for incomplete registration', async () => {
    let membershipCalls = 0
    const response = await app(
      organizations({
        listMemberships: async () => {
          membershipCalls += 1
          return []
        },
      }),
      sessions({
        resolveAccountIdentity: async () => ({
          actor: { accountId: '0198d000-0000-7000-8000-000000000011' },
          identity: { givenName: null, familyName: null, verifiedEmail: null },
        }),
      }),
    ).request('/studio/v1/entry-context', { headers: HEADERS })

    expect(response.status).toBe(200)
    expect(membershipCalls).toBe(0)
    await expect(response.json()).resolves.toEqual({
      authenticated: true,
      registration_status: 'incomplete',
      identity: { name: null, email: null },
      memberships: [],
      analytics: { distinct_id: null },
    })
  })

  test('keeps entry context authentication and account closure fail-closed', async () => {
    const missing = await app().request('/studio/v1/entry-context', {
      headers: { origin: HEADERS.origin },
    })
    const closed = await app(
      organizations(),
      sessions({
        resolveAccountIdentity: async () => {
          throw new StudioSessionError('account-closed')
        },
      }),
    ).request('/studio/v1/entry-context', { headers: HEADERS })
    const unavailable = await app(
      organizations(),
      sessions({
        resolveAccountIdentity: async () => {
          throw new Error('database unavailable')
        },
      }),
    ).request('/studio/v1/entry-context', { headers: HEADERS })

    expect(missing.status).toBe(401)
    expect(closed.status).toBe(403)
    expect(unavailable.status).toBe(503)
  })

  test('returns only the governed active organization types', async () => {
    const response = await app().request('/studio/v1/organization-types', { headers: HEADERS })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      items: [{ code: 'professional_practice', name: 'Profesional independiente' }],
    })
  })

  test('returns the current memberships without cacheable identifiers', async () => {
    const response = await app(
      organizations({
        listMemberships: async () => [
          {
            membershipId: '0198d000-0000-7000-8000-000000000022',
            organizationId: '0198d000-0000-7000-8000-000000000021',
            displayName: 'Ada Entrena',
            typeCode: 'professional_practice',
            status: 'active',
            joinedAt: new Date('2026-08-09T12:00:00.000Z'),
            roles: ['owner'],
          },
        ],
      }),
    ).request('/studio/v1/me/memberships', { headers: HEADERS })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toMatchObject({
      items: [{ display_name: 'Ada Entrena', roles: ['owner'] }],
    })
  })

  test('creates the workspace with the owner role', async () => {
    const response = await app().request('/studio/v1/organizations', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        display_name: 'Ada Entrena',
        type_code: 'professional_practice',
        responsible_party: { kind: 'natural_person', name: 'Ada Lovelace' },
      }),
    })
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      display_name: 'Ada Entrena',
      roles: ['owner'],
    })
  })

  test('lists the minimum team projection with a filter-bound keyset cursor', async () => {
    let receivedInput: unknown
    const response = await app(
      organizations({
        listOrganizationMemberships: async (_actor, input) => {
          receivedInput = input
          return {
            hasMore: true,
            items: [
              {
                membershipId: '0198d000-0000-7000-8000-000000000031',
                displayName: 'Ada Admin',
                status: 'active',
                joinedAt: new Date('2026-08-01T12:00:00.000Z'),
                endedAt: null,
                roles: ['admin'],
                sortDisplayName: 'ada admin',
              },
            ],
          }
        },
      }),
    ).request(`/studio/v1/organizations/${ORGANIZATION_ID}/memberships?status=active&limit=1`, {
      headers: HEADERS,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(receivedInput).toEqual({ organizationId: ORGANIZATION_ID, status: 'active', limit: 1 })
    const body = (await response.json()) as {
      data: Array<Record<string, unknown>>
      page: { has_more: boolean; next_cursor: string }
    }
    expect(body.data).toEqual([
      {
        membership_id: '0198d000-0000-7000-8000-000000000031',
        display_name: 'Ada Admin',
        status: 'active',
        joined_at: '2026-08-01T12:00:00.000Z',
        ended_at: null,
        roles: ['admin'],
      },
    ])
    expect(JSON.stringify(body)).not.toContain('person_id')
    expect(JSON.stringify(body)).not.toContain('contact_email')
    expect(JSON.stringify(body)).not.toContain('fitness')
    expect(body.page.has_more).toBeTrue()
    expect(
      JSON.parse(Buffer.from(body.page.next_cursor, 'base64url').toString('utf8')),
    ).toMatchObject({ filter_status: 'active', status: 'active', display_name: 'ada admin' })
  })

  test('accepts its own cursor and rejects a cursor reused with another filter', async () => {
    const first = await app(
      organizations({
        listOrganizationMemberships: async () => ({
          hasMore: true,
          items: [
            {
              membershipId: '0198d000-0000-7000-8000-000000000031',
              displayName: 'Ada Admin',
              status: 'active',
              joinedAt: new Date('2026-08-01T12:00:00.000Z'),
              endedAt: null,
              roles: ['admin'],
              sortDisplayName: 'ada admin',
            },
          ],
        }),
      }),
    ).request(`/studio/v1/organizations/${ORGANIZATION_ID}/memberships?status=active`, {
      headers: HEADERS,
    })
    const cursor = ((await first.json()) as { page: { next_cursor: string } }).page.next_cursor
    let cursorInput: unknown
    const service = organizations({
      listOrganizationMemberships: async (_actor, input) => {
        cursorInput = input
        return { items: [], hasMore: false }
      },
    })
    const accepted = await app(service).request(
      `/studio/v1/organizations/${ORGANIZATION_ID}/memberships?status=active&cursor=${cursor}`,
      { headers: HEADERS },
    )
    expect(accepted.status).toBe(200)
    expect(cursorInput).toMatchObject({
      cursorStatus: 'active',
      cursorDisplayName: 'ada admin',
      cursorMembershipId: '0198d000-0000-7000-8000-000000000031',
    })

    const rejected = await app(service).request(
      `/studio/v1/organizations/${ORGANIZATION_ID}/memberships?status=terminated&cursor=${cursor}`,
      { headers: HEADERS },
    )
    expect(rejected.status).toBe(422)
  })

  test('validates team list path, filter, limit, cursor, origin, and session', async () => {
    const requests = [
      app().request('/studio/v1/organizations/not-a-uuid/memberships', { headers: HEADERS }),
      app().request(`/studio/v1/organizations/${ORGANIZATION_ID}/memberships?status=unknown`, {
        headers: HEADERS,
      }),
      app().request(`/studio/v1/organizations/${ORGANIZATION_ID}/memberships?limit=101`, {
        headers: HEADERS,
      }),
      app().request(`/studio/v1/organizations/${ORGANIZATION_ID}/memberships?cursor=invalid`, {
        headers: HEADERS,
      }),
      app().request(`/studio/v1/organizations/${ORGANIZATION_ID}/memberships`, {
        headers: { ...HEADERS, origin: 'https://attacker.test' },
      }),
      app().request(`/studio/v1/organizations/${ORGANIZATION_ID}/memberships`, {
        headers: { origin: HEADERS.origin },
      }),
      app().request('/studio/v1/organizations/not-a-uuid/roles', { headers: HEADERS }),
      app().request(`/studio/v1/organizations/${ORGANIZATION_ID}/roles`, {
        headers: { ...HEADERS, origin: 'https://attacker.test' },
      }),
      app().request(`/studio/v1/organizations/${ORGANIZATION_ID}/roles`, {
        headers: { origin: HEADERS.origin },
      }),
    ]
    const responses = await Promise.all(requests)
    expect(responses.map((response) => response.status)).toEqual([
      400, 422, 422, 422, 403, 401, 400, 403, 401,
    ])
  })

  test('returns the same forbidden response for inaccessible and unknown organizations', async () => {
    const inaccessible = organizations({
      listOrganizationMemberships: async () => {
        throw Object.assign(new Error('hidden'), { code: '42501' })
      },
    })
    const first = await app(inaccessible).request(
      `/studio/v1/organizations/${ORGANIZATION_ID}/memberships`,
      { headers: HEADERS },
    )
    const second = await app(inaccessible).request(
      '/studio/v1/organizations/0198d000-0000-7000-8000-000000000099/memberships',
      { headers: HEADERS },
    )
    expect(first.status).toBe(403)
    expect(second.status).toBe(403)
    expect(await first.text()).toBe(await second.text())
  })

  test('returns the four governed roles uncached, authorizing every read', async () => {
    let roleCalls = 0
    let actorCalls = 0
    const service = organizations({
      listRoleCatalog: async () => {
        roleCalls += 1
        return [
          {
            code: 'owner',
            name: 'Propietario',
            capabilities: [{ code: 'close_organization', name: 'Cerrar la organización' }],
            fitnessDataAccessPolicy: 'not_granted_by_role',
          },
          {
            code: 'admin',
            name: 'Administrador',
            capabilities: [{ code: 'manage_memberships', name: 'Administrar membresías' }],
            fitnessDataAccessPolicy: 'not_granted_by_role',
          },
          {
            code: 'coach',
            name: 'Coach',
            capabilities: [{ code: 'exercise_grants', name: 'Ejercer grants autorizados' }],
            fitnessDataAccessPolicy: 'requires_relationship_assignment_and_grant',
          },
          {
            code: 'staff',
            name: 'Staff',
            capabilities: [{ code: 'view_directory', name: 'Consultar directorios' }],
            fitnessDataAccessPolicy: 'not_granted_by_role',
          },
        ]
      },
    })
    const sessionService = sessions({
      resolveActor: async () => {
        actorCalls += 1
        return {
          accountId: '0198d000-0000-7000-8000-000000000011',
          personId: '0198d000-0000-7000-8000-000000000012',
        }
      },
    })
    const first = await app(service, sessionService).request(
      `/studio/v1/organizations/${ORGANIZATION_ID}/roles`,
      { headers: HEADERS },
    )
    expect(first.status).toBe(200)
    expect(first.headers.get('cache-control')).toBe('private, no-store')
    expect(first.headers.get('etag')).toBeNull()
    const body = (await first.json()) as { items: Array<Record<string, unknown>> }
    expect(body.items.map((role) => role.code)).toEqual(['owner', 'admin', 'coach', 'staff'])
    expect(body.items[2]).toMatchObject({
      fitness_data_access_policy: 'requires_relationship_assignment_and_grant',
    })

    // A tab that cached the old ETag still sends it. It gets the catalogue with
    // CORS, not a 304 that reached Studio stripped of that header.
    const revalidation = await app(service, sessionService).request(
      `/studio/v1/organizations/${ORGANIZATION_ID}/roles`,
      { headers: { ...HEADERS, 'if-none-match': '"a-tab-kept-this"' } },
    )
    expect(revalidation.status).toBe(200)
    expect(revalidation.headers.get('access-control-allow-origin')).toBe(
      'https://studio.example.test',
    )
    expect(actorCalls).toBe(2)
    expect(roleCalls).toBe(2)
  })

  test('protects the role catalogue before cache evaluation', async () => {
    const forbidden = organizations({
      listRoleCatalog: async () => {
        throw Object.assign(new Error('hidden'), { code: '42501' })
      },
    })
    const response = await app(forbidden).request(
      `/studio/v1/organizations/${ORGANIZATION_ID}/roles`,
      { headers: { ...HEADERS, 'if-none-match': '"attacker-cache-tag"' } },
    )
    const unknown = await app(forbidden).request(
      '/studio/v1/organizations/0198d000-0000-7000-8000-000000000099/roles',
      { headers: HEADERS },
    )
    expect(response.status).toBe(403)
    expect(unknown.status).toBe(403)
    expect(await response.text()).toBe(await unknown.text())
  })

  test('rejects team queries when registration is incomplete', async () => {
    const incomplete = sessions({
      resolveActor: async () => ({
        accountId: '0198d000-0000-7000-8000-000000000011',
      }),
    })
    const incompleteOrganizations = organizations({
      listOrganizationMemberships: async () => {
        throw new StudioOrganizationError('registration-incomplete')
      },
      listRoleCatalog: async () => {
        throw new StudioOrganizationError('registration-incomplete')
      },
    })
    const membershipResponse = await app(incompleteOrganizations, incomplete).request(
      `/studio/v1/organizations/${ORGANIZATION_ID}/memberships`,
      { headers: HEADERS },
    )
    const roleResponse = await app(incompleteOrganizations, incomplete).request(
      `/studio/v1/organizations/${ORGANIZATION_ID}/roles`,
      { headers: HEADERS },
    )
    expect(membershipResponse.status).toBe(403)
    expect(roleResponse.status).toBe(403)
  })

  test('rejects an inactive organization type', async () => {
    const response = await app().request('/studio/v1/organizations', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        display_name: 'Ada Academy',
        type_code: 'academy',
        responsible_party: { kind: 'natural_person', name: 'Ada Lovelace' },
      }),
    })
    expect(response.status).toBe(400)
  })

  test('rejects creation from another origin', async () => {
    const response = await app().request('/studio/v1/organizations', {
      method: 'POST',
      headers: { ...HEADERS, origin: 'https://attacker.test' },
      body: '{}',
    })
    expect(response.status).toBe(403)
  })

  test('reads the closed audited organization projection with a strong ETag', async () => {
    const response = await app().request(`/studio/v1/organizations/${ORGANIZATION_ID}`, {
      headers: HEADERS,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('etag')).toBe(`"organization:${ORGANIZATION_ID}:r2"`)
    const body = await response.json()
    expect(body).toEqual({
      id: ORGANIZATION_ID,
      display_name: 'Ada Entrena',
      legal_name: 'Ada Entrena SAS',
      type_code: 'studio',
      status: 'active',
      revision_number: 2,
      sites: [],
    })
    expect(JSON.stringify(body)).not.toContain('responsible_party')
  })

  test('updates only the closed organization fields and returns the next ETag', async () => {
    let received: unknown
    const response = await app(
      organizations({
        update: async (_actor, input) => {
          received = input
          return {
            resource: {
              id: ORGANIZATION_ID,
              displayName: 'Ada Entrena Actualizada',
              legalName: null,
              typeCode: 'studio',
              status: 'active',
              revisionNumber: 3,
              sites: [],
            },
            replayed: false,
          }
        },
      }),
    ).request(`/studio/v1/organizations/${ORGANIZATION_ID}`, {
      method: 'PATCH',
      headers: { ...HEADERS, 'if-match': `"organization:${ORGANIZATION_ID}:r2"` },
      body: JSON.stringify({ display_name: ' Ada Entrena Actualizada ', legal_name: null }),
    })

    expect(response.status).toBe(200)
    /*
     * No `ETag`, and this assertion used to say the opposite.
     *
     * Vercel compares the request's `If-Match` against the `ETag` on our
     * response. After a successful write those never agree — one names the
     * revision expected, the other the revision created — so the platform threw
     * our `200` away and answered `412 PRECONDITION_FAILED` itself, after the
     * write had already landed. Retiring a site saved the change and then told
     * the person it had failed, and the browser could not even read the refusal,
     * because a response Vercel generates carries no CORS headers.
     *
     * The new revision belongs in the body, which is where the client reads it
     * from anyway. That is asserted below, so this does not merely drop a
     * guarantee: it moves it to the field that carries it.
     */
    expect(response.headers.get('etag')).toBeNull()
    expect(await response.json()).toMatchObject({ revision_number: 3 })
    expect(received).toMatchObject({
      organizationId: ORGANIZATION_ID,
      expectedRevision: 2,
      patch: { displayName: 'Ada Entrena Actualizada', legalName: null },
    })
  })

  test('enforces organization If-Match and maps stale revisions without widening the patch', async () => {
    const missing = await app().request(`/studio/v1/organizations/${ORGANIZATION_ID}`, {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({ display_name: 'Updated' }),
    })
    const malformed = await app().request(`/studio/v1/organizations/${ORGANIZATION_ID}`, {
      method: 'PATCH',
      headers: { ...HEADERS, 'if-match': `W/"organization:${ORGANIZATION_ID}:r2"` },
      body: JSON.stringify({ display_name: 'Updated' }),
    })
    const immutable = await app().request(`/studio/v1/organizations/${ORGANIZATION_ID}`, {
      method: 'PATCH',
      headers: { ...HEADERS, 'if-match': `"organization:${ORGANIZATION_ID}:r2"` },
      body: JSON.stringify({ status: 'closed' }),
    })
    const stale = await app(
      organizations({
        update: async () => {
          throw Object.assign(new Error('stale-draft'), { code: '40001' })
        },
      }),
    ).request(`/studio/v1/organizations/${ORGANIZATION_ID}`, {
      method: 'PATCH',
      headers: { ...HEADERS, 'if-match': `"organization:${ORGANIZATION_ID}:r2"` },
      body: JSON.stringify({ display_name: 'Updated' }),
    })

    expect([missing.status, malformed.status, immutable.status, stale.status]).toEqual([
      428, 400, 400, 409,
    ])
    expect(stale.headers.get('content-type')).toContain('application/problem+json')
    await expect(stale.json()).resolves.toMatchObject({
      type: 'https://errors.allfit.invalid/stale-draft',
      title: 'The local draft is stale',
      status: 409,
      request_id: expect.any(String),
    })
  })

  test('returns contract Problem responses for all new route and session failures', async () => {
    const instance = app()
    const attackerHeaders = { ...HEADERS, origin: 'https://attacker.test' }
    const forbiddenOrigins = await Promise.all([
      instance.request(`/studio/v1/organizations/${ORGANIZATION_ID}`, {
        headers: attackerHeaders,
      }),
      instance.request(`/studio/v1/organizations/${ORGANIZATION_ID}`, {
        method: 'PATCH',
        headers: attackerHeaders,
      }),
      instance.request(`/studio/v1/organizations/${ORGANIZATION_ID}/sites`, {
        method: 'POST',
        headers: attackerHeaders,
      }),
      instance.request(`/studio/v1/organizations/${ORGANIZATION_ID}/sites/${SITE_ID}`, {
        method: 'PATCH',
        headers: attackerHeaders,
      }),
      instance.request(`/studio/v1/organizations/${ORGANIZATION_ID}/ownership-transfers`, {
        method: 'POST',
        headers: attackerHeaders,
      }),
      instance.request(
        `/studio/v1/organizations/${ORGANIZATION_ID}/memberships/${TARGET_MEMBERSHIP_ID}/roles`,
        { method: 'POST', headers: attackerHeaders },
      ),
    ])
    const closedSession = await app(
      organizations(),
      sessions({
        resolveActor: async () => {
          throw new StudioSessionError('account-closed')
        },
      }),
    ).request(`/studio/v1/organizations/${ORGANIZATION_ID}`, { headers: HEADERS })

    for (const response of [...forbiddenOrigins, closedSession]) {
      expect(response.status).toBe(403)
      expect(response.headers.get('content-type')).toContain('application/problem+json')
      const problem = (await response.json()) as ProblemResponse
      expect(problem).toMatchObject({
        status: 403,
        request_id: expect.any(String),
      })
      expect(problem.type).toMatch(/^https:\/\/errors\.allfit\.invalid\/[a-z][a-z0-9-]+$/)
      expect(problem.title).toEqual(expect.any(String))
      expect(Object.keys(problem).sort()).toEqual(['request_id', 'status', 'title', 'type'])
    }
  })

  test('creates and deactivates informational sites with independent revisions', async () => {
    const created = await app().request(`/studio/v1/organizations/${ORGANIZATION_ID}/sites`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ name: 'Sede Centro', address: 'Carrera 7' }),
    })
    const updated = await app().request(
      `/studio/v1/organizations/${ORGANIZATION_ID}/sites/${SITE_ID}`,
      {
        method: 'PATCH',
        headers: { ...HEADERS, 'if-match': `"organization-site:${SITE_ID}:r0"` },
        body: JSON.stringify({ status: 'inactive' }),
      },
    )
    const missingPrecondition = await app().request(
      `/studio/v1/organizations/${ORGANIZATION_ID}/sites/${SITE_ID}`,
      {
        method: 'PATCH',
        headers: HEADERS,
        body: JSON.stringify({ status: 'inactive' }),
      },
    )

    expect(created.status).toBe(201)
    // Creating still carries it: a POST sends no `If-Match`, so there is nothing
    // for the platform to compare it against.
    expect(created.headers.get('etag')).toBe(`"organization-site:${SITE_ID}:r0"`)
    expect(updated.status).toBe(200)
    // The patch does not, and this is the route the defect was found on. See the
    // organization patch test above for why the header has to go, and note the
    // revision is still asserted — on the body, where the client reads it.
    expect(updated.headers.get('etag')).toBeNull()
    expect(missingPrecondition.status).toBe(428)
    await expect(updated.json()).resolves.toMatchObject({ status: 'inactive', revision_number: 1 })
  })

  test('transfers ownership and grants only non-owner roles', async () => {
    const transfer = await app().request(
      `/studio/v1/organizations/${ORGANIZATION_ID}/ownership-transfers`,
      {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ target_membership_id: TARGET_MEMBERSHIP_ID }),
      },
    )
    const grant = await app().request(
      `/studio/v1/organizations/${ORGANIZATION_ID}/memberships/${TARGET_MEMBERSHIP_ID}/roles`,
      {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ role_code: 'coach' }),
      },
    )
    const ownerGrant = await app().request(
      `/studio/v1/organizations/${ORGANIZATION_ID}/memberships/${TARGET_MEMBERSHIP_ID}/roles`,
      {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ role_code: 'owner' }),
      },
    )

    expect(transfer.status).toBe(200)
    await expect(transfer.json()).resolves.toMatchObject({
      organization_id: ORGANIZATION_ID,
      owner_membership_id: TARGET_MEMBERSHIP_ID,
    })
    expect(grant.status).toBe(200)
    await expect(grant.json()).resolves.toMatchObject({
      membership_id: TARGET_MEMBERSHIP_ID,
      role_code: 'coach',
    })
    expect(ownerGrant.status).toBe(400)
  })

  test('signals idempotent replays for every command without changing successful responses', async () => {
    const freshService = organizations()
    const replayService = organizations({
      update: async (actor, input) => ({
        ...(await freshService.update(actor, input)),
        replayed: true,
      }),
      createSite: async (actor, input) => ({
        ...(await freshService.createSite(actor, input)),
        replayed: true,
      }),
      updateSite: async (actor, input) => ({
        ...(await freshService.updateSite(actor, input)),
        replayed: true,
      }),
      transferOwnership: async (actor, input) => ({
        ...(await freshService.transferOwnership(actor, input)),
        replayed: true,
      }),
      grantMembershipRole: async (actor, input) => ({
        ...(await freshService.grantMembershipRole(actor, input)),
        replayed: true,
      }),
    })
    const requestCommands = async (service: StudioOrganizationService) => {
      const instance = app(service)
      return Promise.all([
        instance.request(`/studio/v1/organizations/${ORGANIZATION_ID}`, {
          method: 'PATCH',
          headers: { ...HEADERS, 'if-match': `"organization:${ORGANIZATION_ID}:r2"` },
          body: JSON.stringify({ display_name: 'Ada Entrena Actualizada' }),
        }),
        instance.request(`/studio/v1/organizations/${ORGANIZATION_ID}/sites`, {
          method: 'POST',
          headers: HEADERS,
          body: JSON.stringify({ name: 'Sede Centro', address: 'Carrera 7' }),
        }),
        instance.request(`/studio/v1/organizations/${ORGANIZATION_ID}/sites/${SITE_ID}`, {
          method: 'PATCH',
          headers: { ...HEADERS, 'if-match': `"organization-site:${SITE_ID}:r0"` },
          body: JSON.stringify({ status: 'inactive' }),
        }),
        instance.request(`/studio/v1/organizations/${ORGANIZATION_ID}/ownership-transfers`, {
          method: 'POST',
          headers: HEADERS,
          body: JSON.stringify({ target_membership_id: TARGET_MEMBERSHIP_ID }),
        }),
        instance.request(
          `/studio/v1/organizations/${ORGANIZATION_ID}/memberships/${TARGET_MEMBERSHIP_ID}/roles`,
          {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ role_code: 'coach' }),
          },
        ),
      ])
    }

    const freshResponses = await requestCommands(freshService)
    const replayResponses = await requestCommands(replayService)

    expect(freshResponses.map((response) => response.status)).toEqual([200, 201, 200, 200, 200])
    expect(replayResponses.map((response) => response.status)).toEqual([200, 201, 200, 200, 200])
    for (const response of freshResponses) {
      expect(response.headers.get('idempotent-replay')).toBeNull()
    }
    for (const response of replayResponses) {
      expect(response.headers.get('idempotent-replay')).toBe('true')
      expect(response.headers.get('access-control-expose-headers')).toContain('Retry-After')
      expect(response.headers.get('access-control-expose-headers')).toContain('Idempotent-Replay')
    }
    expect(await Promise.all(freshResponses.map((response) => response.json()))).toEqual(
      await Promise.all(replayResponses.map((response) => response.json())),
    )
    expect(freshResponses.map((response) => response.headers.get('etag'))).toEqual(
      replayResponses.map((response) => response.headers.get('etag')),
    )
  })

  test('binds command hashes to organization and membership path identities', async () => {
    const hashes: string[] = []
    const service = organizations({
      grantMembershipRole: async (_actor, input) => {
        hashes.push(Buffer.from(input.requestHash).toString('hex'))
        return {
          resource: {
            membershipId: input.membershipId,
            roleCode: input.roleCode,
            validFrom: '2026-08-17T15:35:00.000Z',
          },
          replayed: false,
        }
      },
    })
    const otherOrganizationId = '0198d000-0000-7000-8000-000000000022'

    const first = await app(service).request(
      `/studio/v1/organizations/${ORGANIZATION_ID}/memberships/${TARGET_MEMBERSHIP_ID}/roles`,
      {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ role_code: 'coach' }),
      },
    )
    const second = await app(service).request(
      `/studio/v1/organizations/${otherOrganizationId}/memberships/${TARGET_MEMBERSHIP_ID}/roles`,
      {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ role_code: 'coach' }),
      },
    )

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(hashes).toHaveLength(2)
    expect(hashes[0]).not.toBe(hashes[1])
  })

  test('hides inaccessible organization resources behind not-found', async () => {
    const hidden = organizations({
      get: async () => {
        throw Object.assign(new Error('organization not found'), { code: 'P0002' })
      },
      updateSite: async () => {
        throw Object.assign(new Error('organization site not found'), { code: 'P0002' })
      },
    })
    const organization = await app(hidden).request(`/studio/v1/organizations/${ORGANIZATION_ID}`, {
      headers: HEADERS,
    })
    const site = await app(hidden).request(
      `/studio/v1/organizations/${ORGANIZATION_ID}/sites/${SITE_ID}`,
      {
        method: 'PATCH',
        headers: { ...HEADERS, 'if-match': `"organization-site:${SITE_ID}:r0"` },
        body: JSON.stringify({ status: 'inactive' }),
      },
    )

    expect(organization.status).toBe(404)
    expect(site.status).toBe(404)
    const organizationProblem = (await organization.json()) as ProblemResponse
    const siteProblem = (await site.json()) as ProblemResponse
    expect({
      type: organizationProblem.type,
      title: organizationProblem.title,
      status: organizationProblem.status,
    }).toEqual({
      type: siteProblem.type,
      title: siteProblem.title,
      status: siteProblem.status,
    })
    expect(organizationProblem.request_id).toEqual(expect.any(String))
    expect(siteProblem.request_id).toEqual(expect.any(String))
  })

  test('returns a bounded retryable conflict when a command lock times out', async () => {
    const locked = organizations({
      createSite: async () => {
        throw Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' })
      },
    })
    const response = await app(locked).request(
      `/studio/v1/organizations/${ORGANIZATION_ID}/sites`,
      {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ name: 'Locked site' }),
      },
    )

    expect(response.status).toBe(409)
    expect(response.headers.get('retry-after')).toBe('1')
    expect(response.headers.get('access-control-expose-headers')).toContain('Retry-After')
    expect(response.headers.get('access-control-expose-headers')).toContain('Idempotent-Replay')
    await expect(response.json()).resolves.toMatchObject({
      type: 'https://errors.allfit.invalid/idempotency-in-progress',
      status: 409,
    })
  })
})
