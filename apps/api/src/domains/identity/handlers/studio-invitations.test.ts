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
      identity: { givenName: null, familyName: null },
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
    ...overrides,
  }
}

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
})
