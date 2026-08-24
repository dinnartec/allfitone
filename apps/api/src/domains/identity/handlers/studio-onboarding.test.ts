import { describe, expect, test, beforeEach } from 'bun:test'
import { Hono } from 'hono'

import type { OnboardingService, StudioSessionService } from '../application/index.js'
import { studioOnboardingRoutes } from './studio-onboarding.js'

const COMMAND_HEADERS = {
  origin: 'https://studio.example.test',
  cookie: 'allfit_studio_session=opaque',
  'idempotency-key': '11111111-1111-4111-8111-111111111111',
  'command-id': '22222222-2222-7222-8222-222222222222',
  'content-type': 'application/json',
}

function sessions(overrides: Partial<StudioSessionService> = {}): StudioSessionService {
  return {
    completeCode: async () => ({ opaqueToken: 'opaque' }),
    readSession: async () => ({
      authenticated: true,
      registration_status: 'registration_incomplete',
      identity: { given_name: 'Ada', family_name: 'Lovelace' },
    }),
    resolveActor: async () => ({ accountId: '0198d000-0000-7000-8000-000000000011' }),
    resolveAccountIdentity: async () => ({
      actor: { accountId: '0198d000-0000-7000-8000-000000000011' },
      identity: { givenName: 'Ada', familyName: 'Lovelace', verifiedEmail: 'ada@example.test' },
    }),
    logout: async () => ({
      redirectUrl: 'https://studio.example.test',
      outcome: 'already-absent',
    }),
    ...overrides,
  }
}

function onboarding(overrides: Partial<OnboardingService> = {}): OnboardingService {
  return {
    startAttempt: async () => ({
      id: '0198d000-0000-7000-8000-000000000021',
      status: 'open',
      eligibilityStatus: 'pending',
      expiresAt: new Date('2026-08-10T12:00:00.000Z'),
    }),
    recordAdultEligibility: async () => ({
      result: 'pass',
      evaluatedAt: new Date('2026-08-09T12:00:00.000Z'),
    }),
    createFitnessId: async (_actor, input) => ({
      givenName: input.givenName,
      familyName: input.familyName,
      username: input.username,
    }),
    declareBiologicalSex: async (_actor, input) => input.biologicalSex,
    declareProfileClaim: async (_actor, input) => ({
      attributeCode: input.attributeCode,
      valueText: input.valueText,
      supersededClaimId: null,
    }),
    declareFocusAreas: async (_actor, input) => input.areas,
    readCurrentAttempt: async () => ({
      attempt: null,
      answers: {
        identity: { answered: false, value: null },
        biologicalSex: { answered: false, value: null },
        primaryTrainingGoal: { answered: false, value: null },
        focusAreas: { answered: false, value: [] },
      },
    }),
    complete: async () => '0198d000-0000-7000-8000-000000000031',
    ...overrides,
  }
}

function app(
  sessionService: StudioSessionService = sessions(),
  onboardingService: OnboardingService = onboarding(),
) {
  const instance = new Hono()
  instance.route('/studio/v1', studioOnboardingRoutes(sessionService, onboardingService))
  return instance
}

beforeEach(() => {
  process.env.STUDIO_WEB_URL = 'https://studio.example.test'
})

describe('Studio onboarding routes', () => {
  test('allows an authenticated account without a person to start activation', async () => {
    const response = await app().request('/studio/v1/onboarding-attempts', {
      method: 'POST',
      headers: COMMAND_HEADERS,
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      status: 'open',
      eligibility_status: 'pending',
      terms_version: 'platform_terms_v1',
      privacy_notice_version: 'privacy_notice_v1',
    })
  })

  test('associates a pending invitation token without treating activation as a decision', async () => {
    const invitationToken = 'A'.repeat(43)
    let associatedToken: string | undefined
    const response = await app(
      sessions(),
      onboarding({
        startAttempt: async (_actor, input) => {
          associatedToken = input.invitationToken
          return {
            id: '0198d000-0000-7000-8000-000000000021',
            status: 'open',
            eligibilityStatus: 'pending',
            expiresAt: new Date('2026-08-10T12:00:00.000Z'),
          }
        },
      }),
    ).request('/studio/v1/onboarding-attempts', {
      method: 'POST',
      headers: COMMAND_HEADERS,
      body: JSON.stringify({ invitation_token: invitationToken }),
    })

    expect(response.status).toBe(200)
    expect(associatedToken).toBe(invitationToken)
  })

  test('requires the exact Studio origin for state changes', async () => {
    const response = await app().request('/studio/v1/onboarding-attempts', {
      method: 'POST',
      headers: { ...COMMAND_HEADERS, origin: 'https://attacker.test' },
    })
    expect(response.status).toBe(403)
  })

  test('requires an opaque session cookie', async () => {
    const { cookie: _cookie, ...headers } = COMMAND_HEADERS
    const response = await app().request('/studio/v1/onboarding-attempts', {
      method: 'POST',
      headers,
    })
    expect(response.status).toBe(401)
  })

  test('rejects completion without both legal acceptances', async () => {
    const response = await app().request(
      '/studio/v1/onboarding-attempts/0198d000-0000-7000-8000-000000000021/completion',
      {
        method: 'POST',
        headers: COMMAND_HEADERS,
        body: JSON.stringify({
          given_name: 'Ada',
          family_name: 'Lovelace',
          terms_accepted: true,
          privacy_notice_accepted: false,
        }),
      },
    )
    expect(response.status).toBe(400)
  })

  test('uses the identity captured by WorkOS without asking for the name again', async () => {
    let completedWith: { givenName: string; familyName: string } | undefined
    const response = await app(
      sessions(),
      onboarding({
        complete: async (_actor, input) => {
          completedWith = { givenName: input.givenName, familyName: input.familyName }
          return '0198d000-0000-7000-8000-000000000031'
        },
      }),
    ).request('/studio/v1/onboarding-attempts/0198d000-0000-7000-8000-000000000021/completion', {
      method: 'POST',
      headers: COMMAND_HEADERS,
      body: JSON.stringify({ terms_accepted: true, privacy_notice_accepted: true }),
    })

    expect(response.status).toBe(200)
    expect(completedWith).toEqual({ givenName: 'Ada', familyName: 'Lovelace' })
  })

  test('accepts a manual name only when the provider did not supply it', async () => {
    let completedWith: { givenName: string; familyName: string } | undefined
    const response = await app(
      sessions({
        resolveAccountIdentity: async () => ({
          actor: { accountId: '0198d000-0000-7000-8000-000000000011' },
          identity: { givenName: null, familyName: null, verifiedEmail: 'grace@example.test' },
        }),
      }),
      onboarding({
        complete: async (_actor, input) => {
          completedWith = { givenName: input.givenName, familyName: input.familyName }
          return '0198d000-0000-7000-8000-000000000031'
        },
      }),
    ).request('/studio/v1/onboarding-attempts/0198d000-0000-7000-8000-000000000021/completion', {
      method: 'POST',
      headers: COMMAND_HEADERS,
      body: JSON.stringify({
        given_name: 'Grace',
        family_name: 'Hopper',
        terms_accepted: true,
        privacy_notice_accepted: true,
      }),
    })

    expect(response.status).toBe(200)
    expect(completedWith).toEqual({ givenName: 'Grace', familyName: 'Hopper' })
  })

  test('returns a closed 503 when onboarding persistence is unavailable', async () => {
    const response = await app(
      sessions(),
      onboarding({
        startAttempt: async () => {
          throw new Error('database unavailable')
        },
      }),
    ).request('/studio/v1/onboarding-attempts', {
      method: 'POST',
      headers: COMMAND_HEADERS,
    })
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: { code: 'upstream-unavailable' } })
  })
})
