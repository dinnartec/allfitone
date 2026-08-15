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

  test('returns the four governed roles with cache validation after authorization', async () => {
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
    expect(first.headers.get('cache-control')).toBe('private, max-age=0, must-revalidate')
    const etag = first.headers.get('etag')
    expect(etag).toBeTruthy()
    if (!etag) throw new Error('role catalogue response is missing ETag')
    const body = (await first.json()) as { items: Array<Record<string, unknown>> }
    expect(body.items.map((role) => role.code)).toEqual(['owner', 'admin', 'coach', 'staff'])
    expect(body.items[2]).toMatchObject({
      fitness_data_access_policy: 'requires_relationship_assignment_and_grant',
    })

    const cached = await app(service, sessionService).request(
      `/studio/v1/organizations/${ORGANIZATION_ID}/roles`,
      { headers: { ...HEADERS, 'if-none-match': etag } },
    )
    expect(cached.status).toBe(304)
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
})
