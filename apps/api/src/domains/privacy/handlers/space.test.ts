/**
 * `T-PRV-API-SPACE` — what she shares, and taking one category back, over HTTP.
 *
 * Whose grant it is, and whether it can still be revoked, is PostgreSQL's answer
 * (`T-PRV-REVOKE-01`). What these hold is the route's own part: it acts only as the
 * caller, refuses a command it cannot replay, and says «not found» for somebody
 * else's grant rather than «not yours».
 */

import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { VerifiedToken } from '@allfitone/auth-provider'
import type { SpaceActorResolver } from '../../identity/index.js'
import type { MyConsentService } from '../application/index.js'
import type { MyConsent, MyConsentCommand } from '../domain/index.js'
import { spacePrivacyRoutes } from './space.js'

const PERSON = '019c8000-0000-7000-8000-000000000002'
const GRANT = '019c8000-0000-7000-8000-000000000501'
const AUTH = { authorization: 'Bearer token' }
const COMMAND_HEADERS = {
  ...AUTH,
  'idempotency-key': '6f1c2a4e-8b3d-4c5e-9f60-7a8b9c0d1e2f',
  'command-id': '019c8000-0000-7000-8000-000000000f01',
}

const verifier = async (): Promise<VerifiedToken> => ({
  subject: 'auth0|ana',
  sessionId: 'session',
  surface: 'space',
})

const actors: SpaceActorResolver = {
  actorFor: async () => ({ accountId: 'account', personId: PERSON }),
  personFor: async () => PERSON,
}

const CONSENT: MyConsent = {
  relationship_id: '019c8000-0000-7000-8000-000000000201',
  organization_id: '019c8000-0000-7000-8000-000000000101',
  organization_name: 'Bodytech Chicó',
  relationship_status: 'active',
  started_at: '2026-09-12T14:00:00.000Z',
  ended_at: null,
  scope_code: 'body_progress',
  presented_snapshot: { title: 'Medidas del cuerpo' },
  decision: 'accepted',
  decided_at: '2026-09-12T14:00:00.000Z',
  grant_id: GRANT,
  grant_status: 'active',
  access_level: 'read',
  granted_at: '2026-09-12T14:00:00.000Z',
  frozen_at: null,
  revoked_at: null,
}

function consents(overrides: Partial<MyConsentService> = {}): MyConsentService {
  return {
    listMine: async () => [CONSENT],
    revoke: async (command) => ({
      resource: {
        grantId: command.grantId,
        status: 'revoked',
        revokedAt: '2026-10-21T15:00:00.000Z',
      },
      replayed: false,
    }),
    ...overrides,
  }
}

function app(service: MyConsentService = consents()): Hono {
  const routes = new Hono()
  routes.route('/space/v1', spacePrivacyRoutes(service, verifier, actors))
  return routes
}

const revoke = (service?: MyConsentService, headers: Record<string, string> = COMMAND_HEADERS) =>
  app(service).request(`/space/v1/consents/${GRANT}/revocation`, { method: 'POST', headers })

describe('what she shares', () => {
  test('T-PRV-API-SPACE-01 lists her own, as herself, never stored', async () => {
    const seen: string[] = []
    const response = await app(
      consents({
        listMine: async (personId) => {
          seen.push(personId)
          return [CONSENT]
        },
      }),
    ).request('/space/v1/consents', { headers: AUTH })

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ data: [CONSENT] })
    expect(seen).toEqual([PERSON])
  })

  test('T-PRV-API-SPACE-02 without a session nothing is read', async () => {
    const response = await app().request('/space/v1/consents')
    expect(response.status).toBe(401)
  })
})

describe('taking one category back', () => {
  test('T-PRV-API-SPACE-03 revokes the grant named in the path', async () => {
    const seen: MyConsentCommand[] = []
    const response = await revoke(
      consents({
        revoke: async (command) => {
          seen.push(command)
          return {
            resource: { grantId: GRANT, status: 'revoked', revokedAt: '2026-10-21T15:00:00.000Z' },
            replayed: false,
          }
        },
      }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({
      id: GRANT,
      status: 'revoked',
      revoked_at: '2026-10-21T15:00:00.000Z',
    })
    expect(seen[0]?.personId).toBe(PERSON)
    expect(seen[0]?.grantId).toBe(GRANT)
  })

  test('T-PRV-API-SPACE-04 the same command again says it is a replay', async () => {
    const response = await revoke(
      consents({
        revoke: async () => ({
          resource: { grantId: GRANT, status: 'revoked', revokedAt: '2026-10-21T15:00:00.000Z' },
          replayed: true,
        }),
      }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Idempotent-Replay')).toBe('true')
  })

  test('T-PRV-API-SPACE-05 a command it could not replay is refused before anything runs', async () => {
    let ran = false
    const response = await revoke(
      consents({
        revoke: async () => {
          ran = true
          throw new Error('must not run')
        },
      }),
      AUTH,
    )
    expect(response.status).toBe(400)
    expect(ran).toBe(false)
  })

  test("T-PRV-API-SPACE-06 somebody else's grant is not found, not forbidden", async () => {
    const response = await revoke(
      consents({
        revoke: async () => {
          throw Object.assign(new Error('grant not found'), { code: 'P0002' })
        },
      }),
    )
    expect(response.status).toBe(404)
  })

  test('T-PRV-API-SPACE-07 a grant already revoked is a conflict, not an outage', async () => {
    const response = await revoke(
      consents({
        revoke: async () => {
          throw Object.assign(new Error('already revoked'), { code: 'P0004' })
        },
      }),
    )
    expect(response.status).toBe(409)
  })

  test('T-PRV-API-SPACE-08 a path that is not a grant id is refused', async () => {
    const response = await app().request('/space/v1/consents/not-an-id/revocation', {
      method: 'POST',
      headers: COMMAND_HEADERS,
    })
    expect(response.status).toBe(400)
  })
})
