/**
 * Onboarding on /space/v1.
 *
 * Unlike account creation, these routes are authenticated, so the tests that
 * matter guard the gate rather than a disclosure: no token means no attempt, and
 * malformed command headers must be refused before anything durable happens.
 *
 * The declaration itself is the operation `OP-IDN-002` describes. Recording a
 * refusal is deliberate — evidence is append-only and a `fail` is a fact worth
 * keeping — but it must never leave the attempt eligible.
 */

import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { SpaceOnboardingService } from '../application/onboarding.js'
import { spaceOnboardingRoutes } from './space-onboarding.js'

const IDEMPOTENCY_KEY = '52222222-2222-4222-8222-222222222221'
const COMMAND_ID = '0198e200-0000-7000-8000-000000000002'
const ATTEMPT_ID = '0198e200-0000-7000-8000-000000000009'
const EXPIRES_AT = new Date('2026-08-18T00:00:00.000Z')

const ATTEMPT = {
  id: ATTEMPT_ID,
  status: 'open' as const,
  eligibilityStatus: 'pending' as const,
  expiresAt: EXPIRES_AT,
}
const EVIDENCE = { result: 'pass' as const, evaluatedAt: new Date('2026-08-17T00:00:00.000Z') }
const POLICY = {
  code: 'adult_eligibility',
  version: 1,
  minimum_age: 18,
  jurisdiction: 'CO',
  evidence_kind: 'self_declaration',
}

function appWith(overrides: Partial<SpaceOnboardingService> = {}): Hono {
  const service: SpaceOnboardingService = {
    startAttempt: async () => ATTEMPT,
    recordAdultEligibility: async () => EVIDENCE,
    recordIdentity: async (_token, input) => ({
      givenName: input.givenName,
      familyName: input.familyName,
      username: input.username,
    }),
    readCurrentAttempt: async () => ({ attempt: ATTEMPT, identity: null }),
    ...overrides,
  }
  const app = new Hono()
  app.route(
    '/space/v1',
    spaceOnboardingRoutes(service, async () => VERIFIED),
  )
  return app
}

const VERIFIED = { subject: 'user_01', sessionId: 'sid_01', surface: 'space' as const }

function post(app: Hono, path: string, init: { headers?: Record<string, string>; body?: unknown }) {
  return app.request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authorization: 'Bearer token_1',
      'idempotency-key': IDEMPOTENCY_KEY,
      'command-id': COMMAND_ID,
      ...init.headers,
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })
}

describe('POST /space/v1/onboarding-attempts', () => {
  const path = '/space/v1/onboarding-attempts'

  test('returns the open attempt', async () => {
    const response = await post(appWith(), path, {})

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      id: ATTEMPT_ID,
      status: 'open',
      eligibility_status: 'pending',
      expires_at: EXPIRES_AT.toISOString(),
    })
  })

  test('refuses a request with no bearer token', async () => {
    const app = new Hono()
    app.route(
      '/space/v1',
      spaceOnboardingRoutes(
        {
          startAttempt: async () => ATTEMPT,
          recordAdultEligibility: async () => EVIDENCE,
          recordIdentity: async (_token, input) => ({
            givenName: input.givenName,
            familyName: input.familyName,
            username: input.username,
          }),
          readCurrentAttempt: async () => ({ attempt: ATTEMPT, identity: null }),
        },
        async () => {
          throw new Error('token rejected')
        },
      ),
    )

    expect((await post(app, path, {})).status).toBe(401)
  })

  test('refuses malformed command headers before touching the attempt', async () => {
    let called = false
    const app = appWith({
      startAttempt: async () => {
        called = true
        return ATTEMPT
      },
    })

    for (const headers of [
      { 'idempotency-key': 'not-a-uuid' },
      { 'command-id': 'not-a-uuid' },
      { 'idempotency-key': COMMAND_ID },
    ]) {
      expect((await post(app, path, { headers })).status).toBe(400)
    }
    expect(called).toBe(false)
  })

  test('is never cached', async () => {
    const response = await post(appWith(), path, {})
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('POST /space/v1/onboarding-attempts/{id}/eligibility-evidence', () => {
  const path = `/space/v1/onboarding-attempts/${ATTEMPT_ID}/eligibility-evidence`

  test('records the declaration and returns the evaluation', async () => {
    const response = await post(appWith(), path, { body: { declared_adult: true } })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      result: 'pass',
      evaluated_at: EVIDENCE.evaluatedAt.toISOString(),
      policy: POLICY,
    })
  })

  test('passes a refusal through and leaves the attempt ineligible', async () => {
    const seen: boolean[] = []
    const app = appWith({
      recordAdultEligibility: async (_token, input) => {
        seen.push(input.declaredAdult)
        return { result: 'fail', evaluatedAt: EVIDENCE.evaluatedAt }
      },
    })

    const response = await post(app, path, { body: { declared_adult: false } })

    expect(seen).toEqual([false])
    expect(await response.json()).toEqual({
      result: 'fail',
      evaluated_at: EVIDENCE.evaluatedAt.toISOString(),
      policy: POLICY,
    })
  })

  test('rejects a body that is not a boolean declaration', async () => {
    let called = false
    const app = appWith({
      recordAdultEligibility: async () => {
        called = true
        return EVIDENCE
      },
    })

    for (const body of [{}, { declared_adult: 'true' }, { declared_adult: 1 }, { other: true }]) {
      expect((await post(app, path, { body })).status).toBe(400)
    }
    expect(called).toBe(false)
  })

  test('rejects an attempt id that is not a UUIDv7', async () => {
    const response = await post(
      appWith(),
      '/space/v1/onboarding-attempts/nope/eligibility-evidence',
      {
        body: { declared_adult: true },
      },
    )

    expect(response.status).toBe(400)
  })
})

describe('POST /space/v1/onboarding-attempts/{id}/identity', () => {
  const path = `/space/v1/onboarding-attempts/${ATTEMPT_ID}/identity`
  const IDENTITY = { given_name: 'Ada', family_name: 'Lovelace', username: 'ada_lovelace' }

  test('records the declared identity and returns what is now staged', async () => {
    const response = await post(appWith(), path, { body: IDENTITY })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(IDENTITY)
  })

  test('trims the name, so a stray space is not part of it', async () => {
    const seen: string[] = []
    const app = appWith({
      recordIdentity: async (_token, input) => {
        seen.push(input.givenName, input.familyName)
        return {
          givenName: input.givenName,
          familyName: input.familyName,
          username: input.username,
        }
      },
    })

    await post(app, path, { body: { ...IDENTITY, given_name: '  Ada  ' } })

    expect(seen).toEqual(['Ada', 'Lovelace'])
  })

  test('refuses a body that is not exactly the three declared fields', async () => {
    let called = false
    const app = appWith({
      recordIdentity: async () => {
        called = true
        return { givenName: 'Ada', familyName: 'Lovelace', username: 'ada_lovelace' }
      },
    })

    const bodies = [
      {},
      { given_name: 'Ada', family_name: 'Lovelace' },
      { ...IDENTITY, email: 'ada@example.test' },
      { ...IDENTITY, given_name: '' },
      { ...IDENTITY, given_name: '   ' },
      { ...IDENTITY, family_name: 42 },
      { ...IDENTITY, given_name: 'A'.repeat(121) },
    ]
    for (const body of bodies) {
      expect((await post(app, path, { body })).status).toBe(400)
    }
    expect(called).toBe(false)
  })

  test('refuses a malformed username before it can burn an idempotency key', async () => {
    let called = false
    const app = appWith({
      recordIdentity: async () => {
        called = true
        return { givenName: 'Ada', familyName: 'Lovelace', username: 'ada_lovelace' }
      },
    })

    const usernames = ['Ada', 'ad', '1ada', 'ada lovelace', 'ada-lovelace', 'a'.repeat(31), '']
    for (const username of usernames) {
      expect((await post(app, path, { body: { ...IDENTITY, username } })).status).toBe(400)
    }
    expect(called).toBe(false)
  })

  test('answers conflict when the handle is already reserved', async () => {
    const app = appWith({
      recordIdentity: async () => {
        // What PostgreSQL raises on the primary key of identity.usernames.
        throw Object.assign(new Error('duplicate key'), { code: '23505' })
      },
    })

    expect((await post(app, path, { body: IDENTITY })).status).toBe(409)
  })

  test('refuses a request with no bearer token', async () => {
    const app = new Hono()
    app.route(
      '/space/v1',
      spaceOnboardingRoutes(undefined, async () => {
        throw new Error('token rejected')
      }),
    )

    expect((await post(app, path, { body: IDENTITY })).status).toBe(401)
  })

  test('refuses malformed command headers before touching the service', async () => {
    let called = false
    const app = appWith({
      recordIdentity: async () => {
        called = true
        return { givenName: 'Ada', familyName: 'Lovelace', username: 'ada_lovelace' }
      },
    })

    const response = await post(app, path, {
      headers: { 'idempotency-key': COMMAND_ID },
      body: IDENTITY,
    })

    expect(response.status).toBe(400)
    expect(called).toBe(false)
  })

  test('rejects an attempt id that is not a UUIDv7', async () => {
    const response = await post(appWith(), '/space/v1/onboarding-attempts/nope/identity', {
      body: IDENTITY,
    })

    expect(response.status).toBe(400)
  })

  test('is never cached', async () => {
    const response = await post(appWith(), path, { body: IDENTITY })

    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('GET /space/v1/onboarding-attempts/current', () => {
  const path = '/space/v1/onboarding-attempts/current'

  function get(app: Hono, headers: Record<string, string> = {}) {
    return app.request(path, {
      method: 'GET',
      headers: { authorization: 'Bearer token_1', ...headers },
    })
  }

  test('returns the open attempt and whatever identity was already declared', async () => {
    const app = appWith({
      readCurrentAttempt: async () => ({
        attempt: ATTEMPT,
        identity: { givenName: 'Ada', familyName: 'Lovelace', username: 'ada_lovelace' },
      }),
    })

    const response = await get(app)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      attempt: {
        id: ATTEMPT_ID,
        status: 'open',
        eligibility_status: 'pending',
        expires_at: EXPIRES_AT.toISOString(),
      },
      identity: { given_name: 'Ada', family_name: 'Lovelace', username: 'ada_lovelace' },
    })
  })

  test('answers nulls rather than an error when nothing was started', async () => {
    const app = appWith({
      readCurrentAttempt: async () => ({ attempt: null, identity: null }),
    })

    const response = await get(app)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ attempt: null, identity: null })
  })

  test('reports a declared attempt with no name yet as identity null', async () => {
    const response = await get(appWith())

    expect(await response.json()).toMatchObject({ identity: null })
  })

  test('refuses a request with no bearer token', async () => {
    const app = new Hono()
    app.route(
      '/space/v1',
      spaceOnboardingRoutes(undefined, async () => {
        throw new Error('token rejected')
      }),
    )

    expect((await get(app)).status).toBe(401)
  })

  test('is never cached', async () => {
    expect((await get(appWith())).headers.get('Cache-Control')).toBe('no-store')
  })
})
