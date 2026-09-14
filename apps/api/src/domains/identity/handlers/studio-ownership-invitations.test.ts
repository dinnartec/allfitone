import { beforeEach, describe, expect, test } from 'bun:test'
import { allfitV1ContractManifest } from '@allfitone/contracts'
import { Hono } from 'hono'

import { mountSurfaces } from '../../../surfaces.js'
import type { StudioSessionService } from '../application/index.js'
import { StudioInvitationError } from '../application/invitations.js'
import type { StudioOwnershipInvitationService } from '../application/ownership-invitations.js'
import { studioOwnershipInvitationRoutes } from './studio-ownership-invitations.js'

const ORIGIN = 'https://studio.example.test'
const TOKEN = 'a'.repeat(43)
const INVITATION_ID = '0199b000-0000-7000-8000-000000000131'
const INTENT_ID = '0199b000-0000-7000-8000-000000000141'
const ORGANIZATION_ID = '0199b000-0000-7000-8000-000000000110'
const HEADERS = {
  origin: ORIGIN,
  cookie: 'allfit_studio_session=opaque',
  'content-type': 'application/json',
  'idempotency-key': 'b2222222-2222-4222-8222-222222222222',
  'command-id': '0199b000-0000-7000-8000-000000000151',
}

let decisions: unknown[] = []

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
      identity: { givenName: null, familyName: null, verifiedEmail: 'owner@example.test' },
    }),
    logout: async () => ({ redirectUrl: ORIGIN, outcome: 'revoked' }),
  }
}

function ownership(
  overrides: Partial<StudioOwnershipInvitationService> = {},
  replayed = false,
): StudioOwnershipInvitationService {
  return {
    resolve: async () => ({
      id: INVITATION_ID,
      organization: {
        id: ORGANIZATION_ID,
        displayName: 'Handover Norte',
        typeName: 'Gimnasio',
        partyKind: 'legal_entity',
        legalName: 'Norte Fitness SAS',
        siteName: 'Sede Principal',
      },
      expiresAt: new Date('2026-09-20T12:00:00.000Z'),
      intent: { id: INTENT_ID, status: 'pending' },
    }),
    decide: async (_identity, input) => {
      decisions.push(input)
      return {
        resource: {
          invitationId: INVITATION_ID,
          invitationStatus: 'completed',
          organizationId: ORGANIZATION_ID,
          intentId: INTENT_ID,
          intentStatus: 'accepted',
          membershipId: '0199b000-0000-7000-8000-000000000161',
        },
        replayed,
      }
    },
    ...overrides,
  }
}

function app(service = ownership()) {
  return new Hono().route('/studio/v1', studioOwnershipInvitationRoutes(service, sessions()))
}

function colonPath(path: string): string {
  return path.replace(/\{([A-Za-z0-9_]+)\}/g, ':$1')
}

beforeEach(() => {
  decisions = []
  process.env.STUDIO_WEB_URL = ORIGIN
  process.env.BACKOFFICE_WEB_URL = 'https://backoffice.example.test'
  process.env.API_PUBLIC_URL = 'https://api.example.test'
})

describe('Studio ownership invitation routes', () => {
  test('T-IDN-OWN-API-01 mounts every ownership invitation operation with its contract method', () => {
    const contract = allfitV1ContractManifest.operations
      .filter((operation) => operation.path.startsWith('/studio/v1/ownership-invitations'))
      .map((operation) => `${operation.method} ${colonPath(operation.path)}`)
      .sort()
    const mounted = studioOwnershipInvitationRoutes()
      .routes.filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} /studio/v1${route.path}`)
      .sort()

    expect(contract).toHaveLength(2)
    expect(mounted).toEqual(contract)
  })

  test('T-IDN-OWN-API-02 mounts the routes below the real Studio surface prefix', () => {
    const surfaces = new Hono()
    mountSurfaces(surfaces)
    const mounted = surfaces.routes
      .filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path}`)

    expect(mounted).toEqual(
      expect.arrayContaining([
        'POST /studio/v1/ownership-invitations/resolve',
        'POST /studio/v1/ownership-invitations/decisions',
      ]),
    )
  })

  test('T-IDN-OWN-API-03 presents the organization without the address the invitation went to', async () => {
    const response = await app().request('/studio/v1/ownership-invitations/resolve', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const payload = await response.json()
    expect(payload).toEqual({
      id: INVITATION_ID,
      organization: {
        id: ORGANIZATION_ID,
        display_name: 'Handover Norte',
        type_name: 'Gimnasio',
        party_kind: 'legal_entity',
        legal_name: 'Norte Fitness SAS',
        site_name: 'Sede Principal',
      },
      expires_at: '2026-09-20T12:00:00.000Z',
      intent: { id: INTENT_ID, status: 'pending' },
    })
    expect(JSON.stringify(payload)).not.toContain('owner@example.test')
  })

  test('T-IDN-OWN-API-04 refuses another origin, a malformed token and an unknown one', async () => {
    const service = ownership({
      resolve: async () => Promise.reject(new StudioInvitationError('not-found')),
    })
    const foreign = await app().request('/studio/v1/ownership-invitations/resolve', {
      method: 'POST',
      headers: { origin: 'https://evil.example.test', 'content-type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    })
    const malformed = await app().request('/studio/v1/ownership-invitations/resolve', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'short' }),
    })
    const unknown = await app(service).request('/studio/v1/ownership-invitations/resolve', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    })

    expect([foreign.status, malformed.status, unknown.status]).toEqual([403, 422, 404])
  })

  test('T-IDN-OWN-API-05 accepts the handover and passes the decision through', async () => {
    const response = await app().request('/studio/v1/ownership-invitations/decisions', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ token: TOKEN, intent_id: INTENT_ID, decision: 'accepted' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      invitation_id: INVITATION_ID,
      invitation_status: 'completed',
      organization_id: ORGANIZATION_ID,
      intent: {
        id: INTENT_ID,
        status: 'accepted',
        membership_id: '0199b000-0000-7000-8000-000000000161',
      },
      replayed: false,
    })
    expect(decisions[0]).toMatchObject({ token: TOKEN, intentId: INTENT_ID, decision: 'accepted' })
  })

  test('T-IDN-OWN-API-06 marks a replayed decision', async () => {
    const response = await app(ownership({}, true)).request(
      '/studio/v1/ownership-invitations/decisions',
      {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ token: TOKEN, intent_id: INTENT_ID, decision: 'accepted' }),
      },
    )

    expect(response.headers.get('idempotent-replay')).toBe('true')
  })

  test('T-IDN-OWN-API-07 requires the decision shape, the command identifiers and a session', async () => {
    const body = JSON.stringify({ token: TOKEN, intent_id: INTENT_ID, decision: 'accepted' })
    const answers = await Promise.all([
      app().request('/studio/v1/ownership-invitations/decisions', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ token: TOKEN, intent_id: INTENT_ID, decision: 'maybe' }),
      }),
      app().request('/studio/v1/ownership-invitations/decisions', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          token: TOKEN,
          intent_id: INTENT_ID,
          decision: 'accepted',
          role: 'owner',
        }),
      }),
      app().request('/studio/v1/ownership-invitations/decisions', {
        method: 'POST',
        headers: { ...HEADERS, 'command-id': 'not-a-command' },
        body,
      }),
      app().request('/studio/v1/ownership-invitations/decisions', {
        method: 'POST',
        headers: { ...HEADERS, cookie: '' },
        body,
      }),
    ])

    expect(answers.map((response) => response.status)).toEqual([422, 422, 400, 401])
    expect(decisions).toEqual([])
  })

  test('T-IDN-OWN-API-08 turns the database refusals into their responses', async () => {
    const failing = (code: string) =>
      ownership({
        decide: async () => Promise.reject(Object.assign(new Error('refused'), { code })),
      })
    const answers = await Promise.all(
      ['42501', 'P0002', '40001'].map((code) =>
        app(failing(code)).request('/studio/v1/ownership-invitations/decisions', {
          method: 'POST',
          headers: HEADERS,
          body: JSON.stringify({ token: TOKEN, intent_id: INTENT_ID, decision: 'accepted' }),
        }),
      ),
    )

    expect(answers.map((response) => response.status)).toEqual([403, 404, 409])
  })
})
