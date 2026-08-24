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

import {
  OnboardingPreconditionError,
  type SpaceOnboardingService,
} from '../application/onboarding.js'
import { spaceOnboardingRoutes } from './space-onboarding.js'

/** The empty shape, repeated in enough doubles to be worth naming once. */
function emptyAnswers() {
  return {
    identity: { answered: false as boolean, value: null },
    biologicalSex: { answered: false as boolean, value: null },
    primaryTrainingGoal: { answered: false as boolean, value: null },
    focusAreas: { answered: false as boolean, value: [] },
  }
}

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
    createFitnessId: async (_token, input) => ({
      givenName: input.givenName,
      familyName: input.familyName,
      username: input.username,
    }),
    declareBiologicalSex: async (_token, input) => input.biologicalSex,
    declareProfileClaim: async (_token, input) => ({
      attributeCode: input.attributeCode,
      valueText: input.valueText,
      supersededClaimId: null,
    }),
    declareFocusAreas: async (_token, input) => input.areas,
    readCurrentAttempt: async () => ({
      attempt: ATTEMPT,
      answers: {
        identity: { answered: false, value: null },
        biologicalSex: { answered: false, value: null },
        primaryTrainingGoal: { answered: false, value: null },
        focusAreas: { answered: false, value: [] },
      },
    }),
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
          createFitnessId: async (_token, input) => ({
            givenName: input.givenName,
            familyName: input.familyName,
            username: input.username,
          }),
          declareBiologicalSex: async (_token, input) => input.biologicalSex,
          declareProfileClaim: async (_token, input) => ({
            attributeCode: input.attributeCode,
            valueText: input.valueText,
            supersededClaimId: null,
          }),
          declareFocusAreas: async (_token, input) => input.areas,
          readCurrentAttempt: async () => ({ attempt: ATTEMPT, answers: emptyAnswers() }),
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

describe('POST /space/v1/onboarding-attempts/{id}/fitness-id', () => {
  const path = `/space/v1/onboarding-attempts/${ATTEMPT_ID}/fitness-id`
  const IDENTITY = { given_name: 'Ada', family_name: 'Lovelace', username: 'ada_lovelace' }

  test('creates the Fitness ID and returns what now exists on the person', async () => {
    const response = await post(appWith(), path, { body: IDENTITY })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(IDENTITY)
  })

  test('trims the name, so a stray space is not part of it', async () => {
    const seen: string[] = []
    const app = appWith({
      createFitnessId: async (_token, input) => {
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
      createFitnessId: async () => {
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
      createFitnessId: async () => {
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
      createFitnessId: async () => {
        // What PostgreSQL raises on uidx_people_username.
        throw Object.assign(new Error('duplicate key'), { code: '23505' })
      },
    })

    expect((await post(app, path, { body: IDENTITY })).status).toBe(409)
  })

  test('answers forbidden when the credential address is not verified', async () => {
    const app = appWith({
      createFitnessId: async () => {
        throw new OnboardingPreconditionError('forbidden')
      },
    })

    expect((await post(app, path, { body: IDENTITY })).status).toBe(403)
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
      createFitnessId: async () => {
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
    const response = await post(appWith(), '/space/v1/onboarding-attempts/nope/fitness-id', {
      body: IDENTITY,
    })

    expect(response.status).toBe(400)
  })

  test('is never cached', async () => {
    const response = await post(appWith(), path, { body: IDENTITY })

    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('POST /space/v1/onboarding-attempts/{id}/biological-sex', () => {
  const path = `/space/v1/onboarding-attempts/${ATTEMPT_ID}/biological-sex`

  test('records the declaration and returns what the person now has', async () => {
    const response = await post(appWith(), path, { body: { biological_sex: 'female' } })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ biological_sex: 'female' })
  })

  test('refuses anything that is not exactly one of the two values', async () => {
    let called = false
    const app = appWith({
      declareBiologicalSex: async () => {
        called = true
        return 'male'
      },
    })

    // Null is absent from this list on purpose: it is the refusal and it is valid.
    // 'unknown' is refused because a sentinel would have to be told apart from
    // "never asked" by every later reader.
    const bodies = [
      {},
      { biological_sex: 'other' },
      { biological_sex: 'unknown' },
      { biological_sex: 'Male' },
      { biological_sex: '' },
      { biological_sex: false },
      { biological_sex: 'female', extra: true },
    ]
    for (const body of bodies) {
      expect((await post(app, path, { body })).status).toBe(400)
    }
    expect(called).toBe(false)
  })

  test('accepts null as the refusal, which is what lets the flow advance', async () => {
    const seen: Array<string | null> = []
    const app = appWith({
      declareBiologicalSex: async (_token, input) => {
        seen.push(input.biologicalSex)
        return input.biologicalSex
      },
    })

    const response = await post(app, path, { body: { biological_sex: null } })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ biological_sex: null })
    expect(seen).toEqual([null])
  })

  test('answers conflict when a different value was already declared', async () => {
    const app = appWith({
      declareBiologicalSex: async () => {
        // What PostgreSQL raises rather than overwriting the first declaration.
        throw Object.assign(new Error('already declared'), { code: '23505' })
      },
    })

    expect((await post(app, path, { body: { biological_sex: 'male' } })).status).toBe(409)
  })

  test('answers forbidden when the account owns no person yet', async () => {
    const app = appWith({
      declareBiologicalSex: async () => {
        throw Object.assign(new Error('no person'), { code: '42501' })
      },
    })

    expect((await post(app, path, { body: { biological_sex: 'male' } })).status).toBe(403)
  })

  test('refuses a request with no bearer token', async () => {
    const app = new Hono()
    app.route(
      '/space/v1',
      spaceOnboardingRoutes(undefined, async () => {
        throw new Error('token rejected')
      }),
    )

    expect((await post(app, path, { body: { biological_sex: 'male' } })).status).toBe(401)
  })

  test('rejects an attempt id that is not a UUIDv7', async () => {
    const response = await post(appWith(), '/space/v1/onboarding-attempts/nope/biological-sex', {
      body: { biological_sex: 'male' },
    })

    expect(response.status).toBe(400)
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
        answers: {
          identity: {
            answered: true,
            value: { givenName: 'Ada', familyName: 'Lovelace', username: 'ada_lovelace' },
          },
          biologicalSex: { answered: true, value: 'female' as const },
          primaryTrainingGoal: { answered: true, value: 'build_muscle' as const },
          focusAreas: { answered: true, value: ['chest', 'arms'] as const },
        },
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
      answers: {
        identity: {
          answered: true,
          value: { given_name: 'Ada', family_name: 'Lovelace', username: 'ada_lovelace' },
        },
        biological_sex: { answered: true, value: 'female' },
        primary_training_goal: { answered: true, value: 'build_muscle' },
        focus_areas: { answered: true, value: ['chest', 'arms'] },
      },
    })
  })

  test('answers nulls rather than an error when nothing was started', async () => {
    const app = appWith({
      readCurrentAttempt: async () => ({ attempt: null, answers: emptyAnswers() }),
    })

    const response = await get(app)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      attempt: null,
      answers: {
        identity: { answered: false, value: null },
        biological_sex: { answered: false, value: null },
        primary_training_goal: { answered: false, value: null },
        focus_areas: { answered: false, value: [] },
      },
    })
  })

  test('reports a declared attempt with no name yet as unanswered', async () => {
    const response = await get(appWith())

    // Unanswered is reported, not omitted: the app must not have to tell a
    // skipped step from a field that did not travel.
    expect(await response.json()).toMatchObject({
      answers: { identity: { answered: false, value: null } },
    })
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

describe('POST /space/v1/profile/claims', () => {
  const claims = (path = '/space/v1/profile/claims') => path

  test('records the goal the person chose and reports what it displaced', async () => {
    const app = appWith({
      declareProfileClaim: async (_token, input) => ({
        attributeCode: input.attributeCode,
        valueText: input.valueText,
        supersededClaimId: '0198d000-0000-7000-8000-0000000000aa',
      }),
    })

    const response = await post(app, claims(), {
      body: { attribute_code: 'primary_training_goal', value_text: 'build_muscle' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      attribute_code: 'primary_training_goal',
      value_text: 'build_muscle',
      superseded_claim_id: '0198d000-0000-7000-8000-0000000000aa',
    })
  })

  test('refuses improve_performance, which is deferred out of the initial V1 launch', async () => {
    let called = false
    const app = appWith({
      declareProfileClaim: async (_token, input) => {
        called = true
        return {
          attributeCode: input.attributeCode,
          valueText: input.valueText,
          supersededClaimId: null,
        }
      },
    })

    const response = await post(app, claims(), {
      body: { attribute_code: 'primary_training_goal', value_text: 'improve_performance' },
    })

    expect(response.status).toBe(400)
    // The database would accept it: the refusal has to happen here or "not in V1"
    // is only an omission in the screen.
    expect(called).toBe(false)
  })

  test('refuses anything outside the shape, without reaching the service', async () => {
    let called = false
    const app = appWith({
      declareProfileClaim: async (_token, input) => {
        called = true
        return {
          attributeCode: input.attributeCode,
          valueText: input.valueText,
          supersededClaimId: null,
        }
      },
    })

    const bodies: unknown[] = [
      {},
      { attribute_code: 'primary_training_goal' },
      { value_text: 'build_muscle' },
      { attribute_code: 'body_weight', value_text: 'build_muscle' },
      { attribute_code: 'primary_training_goal', value_text: 'become_immortal' },
      { attribute_code: 'primary_training_goal', value_text: 'Build_Muscle' },
      { attribute_code: 'primary_training_goal', value_text: null },
      { attribute_code: 'primary_training_goal', value_text: 'build_muscle', extra: 1 },
    ]

    for (const body of bodies) {
      expect((await post(app, claims(), { body })).status).toBe(400)
    }
    expect(called).toBe(false)
  })

  test('refuses malformed command headers', async () => {
    const app = appWith()
    const body = { attribute_code: 'primary_training_goal', value_text: 'get_fit' }

    const cases: Array<Record<string, string>> = [
      { 'idempotency-key': 'not-a-uuid' },
      { 'command-id': 'not-a-uuid' },
      // A v7 in the idempotency slot is the mistake worth catching: both are
      // UUIDs, and only the version tells the durable id from the retry key.
      { 'idempotency-key': COMMAND_ID },
    ]

    for (const headers of cases) {
      expect((await post(app, claims(), { headers, body })).status).toBe(400)
    }
  })

  test('maps a forbidden actor to 403', async () => {
    const app = appWith({
      declareProfileClaim: async () => {
        throw { code: '42501' }
      },
    })

    const response = await post(app, claims(), {
      body: { attribute_code: 'primary_training_goal', value_text: 'maintain' },
    })

    expect(response.status).toBe(403)
  })

  test('maps a value the database rejects to 400', async () => {
    const app = appWith({
      declareProfileClaim: async () => {
        throw { code: '23514' }
      },
    })

    const response = await post(app, claims(), {
      body: { attribute_code: 'primary_training_goal', value_text: 'lose_weight' },
    })

    expect(response.status).toBe(400)
  })

  test('refuses without a valid token', async () => {
    const app = new Hono()
    app.route(
      '/space/v1',
      spaceOnboardingRoutes(undefined, async () => {
        throw new Error('token rejected')
      }),
    )

    const response = await post(app, claims(), {
      body: { attribute_code: 'primary_training_goal', value_text: 'get_fit' },
    })

    expect(response.status).toBe(401)
  })

  test('is never cached', async () => {
    const response = await post(appWith(), claims(), {
      body: { attribute_code: 'primary_training_goal', value_text: 'get_fit' },
    })

    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('POST /space/v1/profile/focus-areas', () => {
  const focus = () => '/space/v1/profile/focus-areas'

  test('records the whole set and answers the emphasis in force', async () => {
    const app = appWith({ declareFocusAreas: async (_token, input) => input.areas })

    const response = await post(app, focus(), { body: { areas: ['chest', 'arms', 'abs'] } })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ areas: ['chest', 'arms', 'abs'] })
  })

  test('takes whole body on its own, which is how someone says no emphasis', async () => {
    const app = appWith({ declareFocusAreas: async (_token, input) => input.areas })

    const response = await post(app, focus(), { body: { areas: ['whole_body'] } })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ areas: ['whole_body'] })
  })

  test('refuses anything outside the shape, without reaching the service', async () => {
    let called = false
    const app = appWith({
      declareFocusAreas: async (_token, input) => {
        called = true
        return input.areas
      },
    })

    const bodies: unknown[] = [
      {},
      { areas: [] },
      { areas: 'chest' },
      { areas: ['chest', 'chest'] },
      { areas: ['left_eyebrow'] },
      { areas: ['Chest'] },
      { areas: [null] },
      // Whole body means no emphasis, so naming a zone alongside it records
      // nothing coherent. The database refuses it too; refusing here is what
      // makes it a 400 instead of a constraint violation.
      { areas: ['whole_body', 'chest'] },
      { areas: ['chest'], extra: 1 },
    ]

    for (const body of bodies) {
      expect((await post(app, focus(), { body })).status).toBe(400)
    }
    expect(called).toBe(false)
  })

  test('refuses malformed command headers', async () => {
    const app = appWith()
    const body = { areas: ['legs'] }

    const cases: Array<Record<string, string>> = [
      { 'idempotency-key': 'not-a-uuid' },
      { 'command-id': 'not-a-uuid' },
      { 'idempotency-key': COMMAND_ID },
    ]

    for (const headers of cases) {
      expect((await post(app, focus(), { headers, body })).status).toBe(400)
    }
  })

  test('maps a forbidden actor to 403', async () => {
    const app = appWith({
      declareFocusAreas: async () => {
        throw { code: '42501' }
      },
    })

    expect((await post(app, focus(), { body: { areas: ['glutes'] } })).status).toBe(403)
  })

  test('maps a set the database rejects to 400', async () => {
    const app = appWith({
      declareFocusAreas: async () => {
        throw { code: '23514' }
      },
    })

    expect((await post(app, focus(), { body: { areas: ['back'] } })).status).toBe(400)
  })

  test('refuses without a valid token', async () => {
    const app = new Hono()
    app.route(
      '/space/v1',
      spaceOnboardingRoutes(undefined, async () => {
        throw new Error('token rejected')
      }),
    )

    expect((await post(app, focus(), { body: { areas: ['abs'] } })).status).toBe(401)
  })

  test('is never cached', async () => {
    const response = await post(appWith(), focus(), { body: { areas: ['shoulders'] } })

    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})
