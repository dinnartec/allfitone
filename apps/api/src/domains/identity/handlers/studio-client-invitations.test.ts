import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { StudioSessionService } from '../application/index.js'
import { StudioInvitationError } from '../application/invitations.js'
import type { ClientInvitationService } from '../application/client-invitations.js'
import { studioClientInvitationRoutes } from './studio-client-invitations.js'

const ORGANIZATION = '0199c000-0000-7000-8000-000000000010'
const PATH = `/studio/v1/organizations/${ORGANIZATION}/client-invitations`

const HEADERS = {
  origin: 'https://studio.example.test',
  cookie: 'allfit_studio_session=opaque',
  'content-type': 'application/json',
  'idempotency-key': 'c3333333-3333-4333-8333-333333333333',
  'command-id': '0199c000-0000-7000-8000-000000000031',
}

const BODY = {
  channel: 'email',
  contact: 'Ana@Example.test',
  scopes: [
    {
      scope_code: 'body_progress',
      access_level: 'read',
      purpose: 'Seguimiento de medidas',
      presented_snapshot: { title: 'Progreso corporal' },
    },
  ],
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
      personId: '0199c000-0000-7000-8000-000000000001',
    }),
    resolveAccountIdentity: async () => ({
      actor: { accountId: 'account', personId: '0199c000-0000-7000-8000-000000000001' },
      identity: { givenName: null, familyName: null, verifiedEmail: 'owner@example.test' },
    }),
    logout: async () => ({ redirectUrl: 'https://studio.example.test', outcome: 'revoked' }),
  }
}

function invitations(overrides: Partial<ClientInvitationService> = {}): ClientInvitationService {
  return {
    issue: async () => ({
      resource: {
        id: '0199c000-0000-7000-8000-000000000031',
        intentId: '0199c000-0000-7000-8000-000000000041',
        status: 'pending' as const,
        channel: 'email' as const,
        contactHint: 'a***@example.test',
        expiresAt: new Date('2026-10-06T12:00:00.000Z'),
        scopeCodes: ['body_progress' as const],
        reused: false,
      },
      replayed: false,
    }),
    resolve: async () => {
      throw new Error('not used here')
    },
    decide: async () => {
      throw new Error('not used here')
    },
    ...overrides,
  }
}

function app(service: ClientInvitationService = invitations()): Hono {
  const routes = new Hono()
  routes.route('/studio/v1', studioClientInvitationRoutes(service, sessions()))
  return routes
}

function post(body: unknown, headers: Record<string, string> = HEADERS): Request {
  return new Request(`https://api.example.test${PATH}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  process.env.STUDIO_WEB_URL = 'https://studio.example.test'
})

describe('issuing a client invitation', () => {
  test('creates one and answers 201', async () => {
    const response = await app().fetch(post(BODY))
    expect(response.status).toBe(201)
    const payload = (await response.json()) as Record<string, unknown>
    expect(payload.scope_codes).toEqual(['body_progress'])
    expect(payload.invitation_intent_id).toBe('0199c000-0000-7000-8000-000000000041')
  })

  test('never echoes the contact back in full', async () => {
    const response = await app().fetch(post(BODY))
    const body = await response.text()
    expect(body).not.toContain('Ana@Example.test')
    expect(body).not.toContain('ana@example.test')
    expect(body).toContain('a***@example.test')
  })

  test('lower-cases the contact before the database sees it', async () => {
    let seen: string | undefined
    const service = invitations({
      issue: async (_actor, input) => {
        seen = input.contact
        return {
          resource: {
            id: '0199c000-0000-7000-8000-000000000031',
            intentId: '0199c000-0000-7000-8000-000000000041',
            status: 'pending',
            channel: 'email',
            contactHint: 'a***@example.test',
            expiresAt: new Date('2026-10-06T12:00:00.000Z'),
            scopeCodes: ['body_progress'],
            reused: false,
          },
          replayed: false,
        }
      },
    })
    await app(service).fetch(post(BODY))
    expect(seen).toBe('ana@example.test')
  })

  test('answers 200 when an equivalent invitation was reused', async () => {
    const service = invitations({
      issue: async () => ({
        resource: {
          id: '0199c000-0000-7000-8000-000000000031',
          intentId: '0199c000-0000-7000-8000-000000000041',
          status: 'pending',
          channel: 'email',
          contactHint: 'a***@example.test',
          expiresAt: new Date('2026-10-06T12:00:00.000Z'),
          scopeCodes: ['body_progress'],
          reused: true,
        },
        replayed: false,
      }),
    })
    const response = await app(service).fetch(post(BODY))
    expect(response.status).toBe(200)
  })

  test('marks a replayed command so the client can tell', async () => {
    const service = invitations({
      issue: async () => ({
        resource: {
          id: '0199c000-0000-7000-8000-000000000031',
          intentId: '0199c000-0000-7000-8000-000000000041',
          status: 'pending',
          channel: 'email',
          contactHint: 'a***@example.test',
          expiresAt: new Date('2026-10-06T12:00:00.000Z'),
          scopeCodes: ['body_progress'],
          reused: false,
        },
        replayed: true,
      }),
    })
    const response = await app(service).fetch(post(BODY))
    expect(response.headers.get('Idempotent-Replay')).toBe('true')
  })
})

describe('what it refuses', () => {
  test('a request from another origin', async () => {
    const response = await app().fetch(post(BODY, { ...HEADERS, origin: 'https://evil.test' }))
    expect(response.status).toBe(403)
  })

  test('a request with no session cookie', async () => {
    const { cookie: _cookie, ...headers } = HEADERS
    const response = await app().fetch(post(BODY, headers))
    expect(response.status).toBe(401)
  })

  test('command headers that are missing or malformed', async () => {
    const { 'idempotency-key': _key, ...headers } = HEADERS
    const response = await app().fetch(post(BODY, headers))
    expect(response.status).toBe(400)
  })

  test('an invitation that asks for nothing', async () => {
    const response = await app().fetch(post({ ...BODY, scopes: [] }))
    expect(response.status).toBe(422)
  })

  test('a scope code the catalogue does not define', async () => {
    const response = await app().fetch(
      post({ ...BODY, scopes: [{ ...BODY.scopes[0], scope_code: 'bank_account' }] }),
    )
    expect(response.status).toBe(422)
  })

  test('an access level that is not one of the two', async () => {
    const response = await app().fetch(
      post({ ...BODY, scopes: [{ ...BODY.scopes[0], access_level: 'write' }] }),
    )
    expect(response.status).toBe(422)
  })

  test('a scope with no purpose, because the person is owed a reason', async () => {
    const response = await app().fetch(
      post({ ...BODY, scopes: [{ ...BODY.scopes[0], purpose: '   ' }] }),
    )
    expect(response.status).toBe(422)
  })

  test('the same scope asked for twice', async () => {
    const response = await app().fetch(post({ ...BODY, scopes: [BODY.scopes[0], BODY.scopes[0]] }))
    expect(response.status).toBe(422)
  })

  test('a body carrying a field the contract does not declare', async () => {
    const response = await app().fetch(post({ ...BODY, initial_program_version_id: 'x' }))
    expect(response.status).toBe(422)
  })

  test('a role without permission, as PostgreSQL decided', async () => {
    const service = invitations({
      issue: async () => {
        throw Object.assign(new Error('denied'), { code: '42501' })
      },
    })
    const response = await app(service).fetch(post(BODY))
    expect(response.status).toBe(403)
  })

  test('issuance while the feature is switched off', async () => {
    const service = invitations({
      issue: async () => {
        throw new StudioInvitationError('service-degraded')
      },
    })
    const response = await app(service).fetch(post(BODY))
    expect(response.status).toBe(503)
  })
})
