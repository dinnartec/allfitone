import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { StudioInvitationError } from '../application/invitations.js'
import type {
  ClientInvitationService,
  SpaceInvitationIdentity,
} from '../application/client-invitations.js'
import {
  spaceClientInvitationRoutes,
  type SpaceIdentityResolver,
  type TokenVerifier,
} from './space-client-invitations.js'

const INTENT = '0199d000-0000-7000-8000-000000000041'
const TOKEN = 'a'.repeat(43)

const HEADERS = {
  authorization: 'Bearer access-token',
  'content-type': 'application/json',
  'idempotency-key': 'd4444444-4444-4444-8444-444444444444',
  'command-id': '0199d000-0000-7000-8000-000000000051',
}

const DECISION_BODY = {
  token: TOKEN,
  invitation_intent_id: INTENT,
  relationship_decision: 'accepted',
  scope_decisions: { body_progress: 'accepted', health_context: 'rejected' },
}

const verifier: TokenVerifier = async () => ({
  subject: 'user_123',
  sessionId: 'session_123',
  surface: 'space',
})

const identity: SpaceIdentityResolver = async () => ({
  personId: '0199d000-0000-7000-8000-000000000001',
  verifiedEmail: 'ana@example.test',
})

function invitations(overrides: Partial<ClientInvitationService> = {}): ClientInvitationService {
  return {
    issue: async () => {
      throw new Error('not used here')
    },
    resolve: async () => ({
      id: '0199d000-0000-7000-8000-000000000031',
      intentId: INTENT,
      status: 'pending' as const,
      organization: {
        id: '0199d000-0000-7000-8000-000000000010',
        displayName: 'Resolve Gym',
        responsibleParty: { party_kind: 'legal_entity', party_name: 'Resolve SAS' },
      },
      expiresAt: new Date('2026-10-06T12:00:00.000Z'),
      scopeOptions: [
        {
          scopeCode: 'body_progress' as const,
          offeredAccessLevel: 'read' as const,
          purpose: 'Seguimiento de medidas',
          presentedSnapshotSchemaVersion: 1,
          presentedSnapshot: { title: 'Progreso corporal' },
          decision: null,
        },
      ],
    }),
    decide: async () => ({
      resource: {
        invitationId: '0199d000-0000-7000-8000-000000000031',
        invitationStatus: 'completed' as const,
        organizationId: '0199d000-0000-7000-8000-000000000010',
        intentId: INTENT,
        intentStatus: 'accepted' as const,
        relationshipId: '0199d000-0000-7000-8000-000000000061',
        grantedScopeCodes: ['body_progress' as const],
      },
      replayed: false,
    }),
    ...overrides,
  }
}

function app(
  service: ClientInvitationService = invitations(),
  resolver: SpaceIdentityResolver = identity,
): Hono {
  const routes = new Hono()
  routes.route('/space/v1', spaceClientInvitationRoutes(service, verifier, resolver))
  return routes
}

function post(path: string, body: unknown, headers: Record<string, string> = HEADERS): Request {
  return new Request(`https://api.example.test/space/v1/client-invitations/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

describe('reading what an invitation asks for', () => {
  test('returns every scope separately, with its purpose and level', async () => {
    const response = await app().fetch(post('resolve', { token: TOKEN }))
    expect(response.status).toBe(200)
    const payload = (await response.json()) as { scope_options: Record<string, unknown>[] }
    expect(payload.scope_options).toHaveLength(1)
    expect(payload.scope_options[0]).toMatchObject({
      scope_code: 'body_progress',
      offered_access_level: 'read',
      purpose: 'Seguimiento de medidas',
      decision: null,
    })
  })

  test('carries the contract exactly as it was presented', async () => {
    const response = await app().fetch(post('resolve', { token: TOKEN }))
    const payload = (await response.json()) as {
      scope_options: { presented_snapshot: Record<string, unknown> }[]
    }
    expect(payload.scope_options[0]?.presented_snapshot).toEqual({ title: 'Progreso corporal' })
  })

  test('is never cached', async () => {
    const response = await app().fetch(post('resolve', { token: TOKEN }))
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  test('refuses a caller with no bearer token', async () => {
    const { authorization: _authorization, ...headers } = HEADERS
    const response = await app().fetch(post('resolve', { token: TOKEN }, headers))
    expect(response.status).toBe(401)
  })

  test('refuses a caller whose email the provider never verified', async () => {
    const unverified: SpaceIdentityResolver = async () => ({
      personId: '0199d000-0000-7000-8000-000000000001',
      verifiedEmail: null,
    })
    const service = invitations({
      resolve: async (caller: SpaceInvitationIdentity) => {
        if (!caller.verifiedEmail) throw new StudioInvitationError('forbidden')
        throw new Error('unreachable')
      },
    })
    const response = await app(service, unverified).fetch(post('resolve', { token: TOKEN }))
    expect(response.status).toBe(403)
  })

  test('refuses a malformed token without asking the database', async () => {
    let asked = false
    const service = invitations({
      resolve: async () => {
        asked = true
        throw new Error('unreachable')
      },
    })
    const response = await app(service).fetch(post('resolve', { token: 'too-short' }))
    expect(response.status).toBe(422)
    expect(asked).toBe(false)
  })

  test('reports an invitation nobody issued as not found', async () => {
    const service = invitations({
      resolve: async () => {
        throw new StudioInvitationError('not-found')
      },
    })
    const response = await app(service).fetch(post('resolve', { token: TOKEN }))
    expect(response.status).toBe(404)
  })
})

describe('answering an invitation', () => {
  test('passes each scope answer through as given', async () => {
    let seen: Record<string, string> | undefined
    const service = invitations({
      decide: async (_identity, input) => {
        seen = input.scopeDecisions
        return {
          resource: {
            invitationId: '0199d000-0000-7000-8000-000000000031',
            invitationStatus: 'completed',
            organizationId: '0199d000-0000-7000-8000-000000000010',
            intentId: INTENT,
            intentStatus: 'accepted',
            relationshipId: '0199d000-0000-7000-8000-000000000061',
            grantedScopeCodes: ['body_progress'],
          },
          replayed: false,
        }
      },
    })
    await app(service).fetch(post('decisions', DECISION_BODY))
    expect(seen).toEqual({ body_progress: 'accepted', health_context: 'rejected' })
  })

  test('accepts a body with no scope answers at all: every scope is then rejected', async () => {
    let seen: Record<string, string> | undefined
    const service = invitations({
      decide: async (_identity, input) => {
        seen = input.scopeDecisions
        return {
          resource: {
            invitationId: '0199d000-0000-7000-8000-000000000031',
            invitationStatus: 'completed',
            organizationId: '0199d000-0000-7000-8000-000000000010',
            intentId: INTENT,
            intentStatus: 'accepted',
            relationshipId: '0199d000-0000-7000-8000-000000000061',
            grantedScopeCodes: [],
          },
          replayed: false,
        }
      },
    })
    const response = await app(service).fetch(
      post('decisions', {
        token: TOKEN,
        invitation_intent_id: INTENT,
        relationship_decision: 'accepted',
      }),
    )
    expect(response.status).toBe(200)
    expect(seen).toEqual({})
  })

  /*
   * Criterion 5. A relationship in force that grants access to nothing is the
   * outcome the story asks for, not a failure to report.
   */
  test('reports an accepted relationship with no granted scope as a success', async () => {
    const service = invitations({
      decide: async () => ({
        resource: {
          invitationId: '0199d000-0000-7000-8000-000000000031',
          invitationStatus: 'completed',
          organizationId: '0199d000-0000-7000-8000-000000000010',
          intentId: INTENT,
          intentStatus: 'accepted',
          relationshipId: '0199d000-0000-7000-8000-000000000061',
          grantedScopeCodes: [],
        },
        replayed: false,
      }),
    })
    const response = await app(service).fetch(post('decisions', DECISION_BODY))
    expect(response.status).toBe(200)
    const payload = (await response.json()) as Record<string, unknown>
    expect(payload.granted_scope_codes).toEqual([])
    expect(payload.relationship_id).toBe('0199d000-0000-7000-8000-000000000061')
  })

  test('reports a rejected relationship as creating nothing', async () => {
    const service = invitations({
      decide: async () => ({
        resource: {
          invitationId: '0199d000-0000-7000-8000-000000000031',
          invitationStatus: 'completed',
          organizationId: '0199d000-0000-7000-8000-000000000010',
          intentId: INTENT,
          intentStatus: 'rejected',
          relationshipId: null,
          grantedScopeCodes: [],
        },
        replayed: false,
      }),
    })
    const response = await app(service).fetch(
      post('decisions', { ...DECISION_BODY, relationship_decision: 'rejected' }),
    )
    const payload = (await response.json()) as Record<string, unknown>
    expect(payload.relationship_id).toBeNull()
    expect(payload.granted_scope_codes).toEqual([])
  })

  test('marks a replay so a retried answer is not read as a second one', async () => {
    const service = invitations({
      decide: async () => ({
        resource: {
          invitationId: '0199d000-0000-7000-8000-000000000031',
          invitationStatus: 'completed',
          organizationId: '0199d000-0000-7000-8000-000000000010',
          intentId: INTENT,
          intentStatus: 'accepted',
          relationshipId: '0199d000-0000-7000-8000-000000000061',
          grantedScopeCodes: ['body_progress'],
        },
        replayed: true,
      }),
    })
    const response = await app(service).fetch(post('decisions', DECISION_BODY))
    expect(response.headers.get('Idempotent-Replay')).toBe('true')
  })
})

describe('what answering refuses', () => {
  test('a decision that is neither accepted nor rejected', async () => {
    const response = await app().fetch(
      post('decisions', { ...DECISION_BODY, relationship_decision: 'maybe' }),
    )
    expect(response.status).toBe(422)
  })

  test('an answer for a scope the catalogue does not define', async () => {
    const response = await app().fetch(
      post('decisions', { ...DECISION_BODY, scope_decisions: { bank_account: 'accepted' } }),
    )
    expect(response.status).toBe(422)
  })

  test('command headers that are missing', async () => {
    const { 'command-id': _commandId, ...headers } = HEADERS
    const response = await app().fetch(post('decisions', DECISION_BODY, headers))
    expect(response.status).toBe(400)
  })

  test('a token that is not the shape of a token', async () => {
    const response = await app().fetch(post('decisions', { ...DECISION_BODY, token: 'nope' }))
    expect(response.status).toBe(422)
  })

  test('an answer from somebody the invitation was not addressed to', async () => {
    const service = invitations({
      decide: async () => {
        throw Object.assign(new Error('verified email mismatch'), { code: '42501' })
      },
    })
    const response = await app(service).fetch(post('decisions', DECISION_BODY))
    expect(response.status).toBe(403)
  })

  test('a second answer to an invitation already decided', async () => {
    const service = invitations({
      decide: async () => {
        throw Object.assign(new Error('conflict'), { code: 'P0004' })
      },
    })
    const response = await app(service).fetch(post('decisions', DECISION_BODY))
    expect(response.status).toBe(409)
  })
})
