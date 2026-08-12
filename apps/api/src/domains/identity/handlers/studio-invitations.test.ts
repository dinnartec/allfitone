import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { StudioSessionService } from '../application/index.js'
import { StudioInvitationError, type StudioInvitationService } from '../application/invitations.js'
import { studioInvitationRoutes } from './studio-invitations.js'

const HEADERS = {
  origin: 'https://studio.example.test',
  cookie: 'allfit_studio_session=opaque',
  'content-type': 'application/json',
  'idempotency-key': 'b2222222-2222-4222-8222-222222222222',
  'command-id': '0199b000-0000-7000-8000-000000000031',
}
const BODY = {
  channel: 'email',
  contact: 'person@example.test',
  intents: [{ kind: 'membership', proposed_role_code: 'staff' }],
}

function sessions(): StudioSessionService {
  return {
    completeCode: async () => ({ opaqueToken: 'opaque' }),
    readSession: async () => ({
      authenticated: true,
      registration_status: 'complete',
      identity: { given_name: null, family_name: null },
    }),
    resolveActor: async () => ({
      accountId: 'account',
      personId: '0199b000-0000-7000-8000-000000000001',
    }),
    resolveAccountIdentity: async () => ({
      actor: { accountId: 'account', personId: '0199b000-0000-7000-8000-000000000001' },
      identity: { givenName: null, familyName: null, verifiedEmail: 'person@example.test' },
    }),
    logout: async () => ({ redirectUrl: 'https://studio.example.test', outcome: 'revoked' }),
  }
}

function invitations(overrides: Partial<StudioInvitationService> = {}): StudioInvitationService {
  return {
    issue: async () => ({
      resource: {
        id: '0199b000-0000-7000-8000-000000000031',
        intentId: '0199b000-0000-7000-8000-000000000041',
        status: 'pending',
        channel: 'email',
        contactHint: 'p***@example.test',
        expiresAt: new Date('2026-08-18T12:00:00.000Z'),
        proposedRoleCode: 'staff',
        reused: false,
      },
      replayed: false,
    }),
    resolve: async () => ({
      id: '0199b000-0000-7000-8000-000000000031',
      status: 'pending',
      organizationId: '0199b000-0000-7000-8000-000000000010',
      organizationDisplayName: 'Studio Norte',
      responsibleParty: {
        party_kind: 'legal_entity',
        party_name: 'Studio Norte SAS',
        purpose: 'studio_operations',
      },
      expiresAt: new Date('2026-08-18T12:00:00.000Z'),
      intent: {
        id: '0199b000-0000-7000-8000-000000000041',
        kind: 'membership',
        status: 'pending',
        proposedRoleCode: 'staff',
      },
    }),
    decide: async () => ({
      resource: {
        invitationId: '0199b000-0000-7000-8000-000000000031',
        invitationStatus: 'completed',
        organizationId: '0199b000-0000-7000-8000-000000000010',
        intentId: '0199b000-0000-7000-8000-000000000041',
        intentStatus: 'accepted',
        membershipId: '0199b000-0000-7000-8000-000000000051',
        proposedRoleCode: 'staff',
      },
      replayed: false,
    }),
    list: async () => ({ items: [], hasMore: false }),
    revoke: async () => ({
      resource: { id: '0199b000-0000-7000-8000-000000000031', status: 'revoked' },
      replayed: false,
    }),
    ...overrides,
  }
}
const TOKEN = 'a'.repeat(43)

function app(service = invitations()) {
  const instance = new Hono()
  instance.route('/studio/v1', studioInvitationRoutes(service, sessions()))
  return instance
}

beforeEach(() => {
  process.env.STUDIO_WEB_URL = 'https://studio.example.test'
})

describe('Studio team invitation route', () => {
  test('creates an email invitation without returning the full contact', async () => {
    const response = await app().request(
      '/studio/v1/organizations/0199b000-0000-7000-8000-000000000010/invitations',
      { method: 'POST', headers: HEADERS, body: JSON.stringify(BODY) },
    )
    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const payload = (await response.json()) as { contact_hint: string }
    expect(payload.contact_hint).toBe('p***@example.test')
    expect(JSON.stringify(payload)).not.toContain('person@example.test')
  })

  test('returns 200 and replay metadata for a reused replay', async () => {
    const response = await app(
      invitations({
        issue: async () => ({
          resource: {
            id: '0199b000-0000-7000-8000-000000000031',
            intentId: '0199b000-0000-7000-8000-000000000041',
            status: 'pending',
            channel: 'email',
            contactHint: 'p***@example.test',
            expiresAt: new Date('2026-08-18T12:00:00.000Z'),
            proposedRoleCode: 'staff',
            reused: true,
          },
          replayed: true,
        }),
      }),
    ).request('/studio/v1/organizations/0199b000-0000-7000-8000-000000000010/invitations', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(BODY),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('idempotent-replay')).toBe('true')
  })

  test('rejects unsupported channels before invoking the service', async () => {
    let called = false
    const response = await app(
      invitations({
        issue: async () => {
          called = true
          throw new Error('unexpected')
        },
      }),
    ).request('/studio/v1/organizations/0199b000-0000-7000-8000-000000000010/invitations', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ ...BODY, channel: 'sms' }),
    })
    expect(response.status).toBe(422)
    expect(called).toBeFalse()
  })

  test('fails closed while the recipient flow is disabled', async () => {
    const response = await app(
      invitations({
        issue: () => {
          throw new StudioInvitationError('service-degraded')
        },
      }),
    ).request('/studio/v1/organizations/0199b000-0000-7000-8000-000000000010/invitations', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(BODY),
    })
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: { code: 'service-degraded' } })
  })

  test('resolves a token without returning its destination contact', async () => {
    const response = await app().request('/studio/v1/invitations/resolve', {
      method: 'POST',
      headers: { origin: HEADERS.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    const payload = await response.json()
    expect(JSON.stringify(payload)).not.toContain('person@example.test')
    expect(payload).toMatchObject({
      organization: {
        display_name: 'Studio Norte',
        responsible_party: { kind: 'legal_entity', name: 'Studio Norte SAS' },
      },
    })
  })

  test('decides the single membership intent with command identity', async () => {
    const response = await app().request('/studio/v1/invitations/decisions', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        token: TOKEN,
        decisions: [{ intent_id: '0199b000-0000-7000-8000-000000000041', decision: 'accepted' }],
      }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      invitation_status: 'completed',
      organization_id: '0199b000-0000-7000-8000-000000000010',
      intent: { status: 'accepted' },
    })
  })

  test('lists full contacts only through the authenticated organization query', async () => {
    const response = await app(
      invitations({
        list: async () => ({
          hasMore: false,
          items: [
            {
              id: '0199b000-0000-7000-8000-000000000031',
              status: 'pending',
              channel: 'email',
              contact: 'person@example.test',
              createdAt: new Date('2026-08-11T12:00:00.000Z'),
              expiresAt: new Date('2026-08-18T12:00:00.000Z'),
              intent: {
                id: '0199b000-0000-7000-8000-000000000041',
                kind: 'membership',
                status: 'pending',
                proposedRoleCode: 'staff',
                decidedAt: null,
              },
            },
          ],
        }),
      }),
    ).request(
      '/studio/v1/organizations/0199b000-0000-7000-8000-000000000010/invitations?status=pending',
      { headers: { origin: HEADERS.origin, cookie: HEADERS.cookie } },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: [{ contact: 'person@example.test', status: 'pending' }],
      page: { has_more: false, next_cursor: null },
    })
  })

  test('revokes a pending invitation idempotently', async () => {
    const response = await app().request(
      '/studio/v1/organizations/0199b000-0000-7000-8000-000000000010/invitations/0199b000-0000-7000-8000-000000000031/revocation',
      { method: 'POST', headers: HEADERS, body: '{}' },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      id: '0199b000-0000-7000-8000-000000000031',
      status: 'revoked',
    })
  })

  test('returns Retry-After when PostgreSQL rejects an issuance rate window', async () => {
    const response = await app(
      invitations({
        issue: async () => {
          throw Object.assign(new Error('closed limit'), { code: 'P0001' })
        },
      }),
    ).request('/studio/v1/organizations/0199b000-0000-7000-8000-000000000010/invitations', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(BODY),
    })

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('3600')
    await expect(response.json()).resolves.toEqual({ error: { code: 'rate-limited' } })
  })
})
