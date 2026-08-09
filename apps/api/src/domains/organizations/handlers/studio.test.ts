import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { StudioSessionService } from '../../identity/index.js'
import type { StudioOrganizationService } from '../application/index.js'
import { studioOrganizationRoutes } from './studio.js'

const HEADERS = {
  origin: 'https://studio.example.test',
  cookie: 'allfit_studio_session=opaque',
  'idempotency-key': '11111111-1111-4111-8111-111111111111',
  'command-id': '22222222-2222-7222-8222-222222222222',
  'content-type': 'application/json',
}

function sessions(overrides: Partial<StudioSessionService> = {}): StudioSessionService {
  return {
    completeCode: async () => ({ opaqueToken: 'opaque' }),
    readSession: async () => ({ authenticated: true, registration_status: 'complete' }),
    resolveActor: async () => ({
      accountId: '0198d000-0000-7000-8000-000000000011',
      personId: '0198d000-0000-7000-8000-000000000012',
    }),
    logout: async () => 'https://studio.example.test',
    ...overrides,
  }
}

function organizations(
  overrides: Partial<StudioOrganizationService> = {},
): StudioOrganizationService {
  return {
    listTypes: async () => [{ code: 'professional_practice', name: 'Práctica profesional' }],
    listMemberships: async () => [],
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

  test('rejects creation from another origin', async () => {
    const response = await app().request('/studio/v1/organizations', {
      method: 'POST',
      headers: { ...HEADERS, origin: 'https://attacker.test' },
      body: '{}',
    })
    expect(response.status).toBe(403)
  })
})
