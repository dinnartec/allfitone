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
        { startAttempt: async () => ATTEMPT, recordAdultEligibility: async () => EVIDENCE },
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
