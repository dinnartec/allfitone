import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { StudioProfessionalService, StudioSessionService } from '../application/index.js'
import type { ProfessionalCredential, ProfessionalProfile } from '../domain/index.js'
import { studioProfessionalRoutes } from './studio-professional.js'

const HEADERS = {
  origin: 'https://studio.example.test',
  cookie: 'allfit_studio_session=opaque',
  'idempotency-key': '11111111-1111-4111-8111-111111111111',
  'command-id': '22222222-2222-7222-8222-222222222222',
  'content-type': 'application/json',
}

const PROFILE_BODY = {
  headline: 'Entrenadora de fuerza',
  bio: 'Acompaño procesos sostenibles.',
  practice_started_year: 2018,
  specialty_codes: ['personal_training', 'strength_conditioning'],
}

const CREDENTIAL_BODY = {
  credential_type_code: 'professional_certification',
  issuer: 'NSCA',
  name: 'CSCS',
  identifier: '123',
  issued_on: '2020-01-01',
  expires_on: '2028-01-01',
  verification_url: 'https://example.test/123',
}

function sessions(overrides: Partial<StudioSessionService> = {}): StudioSessionService {
  return {
    completeCode: async () => ({ opaqueToken: 'opaque' }),
    readSession: async () => ({
      authenticated: true,
      registration_status: 'complete',
      identity: { given_name: 'Ada', family_name: 'Lovelace' },
    }),
    resolveActor: async () => ({
      accountId: '0198d000-0000-7000-8000-000000000011',
      personId: '0198d000-0000-7000-8000-000000000012',
    }),
    resolveAccountIdentity: async () => ({
      actor: {
        accountId: '0198d000-0000-7000-8000-000000000011',
        personId: '0198d000-0000-7000-8000-000000000012',
      },
      identity: { givenName: 'Ada', familyName: 'Lovelace', verifiedEmail: 'ada@example.test' },
    }),
    logout: async () => ({
      redirectUrl: 'https://studio.example.test',
      outcome: 'already-absent',
    }),
    ...overrides,
  }
}

function credential(): ProfessionalCredential {
  return {
    id: '0198d000-0000-7000-8000-000000000031',
    credentialTypeCode: 'professional_certification',
    credentialTypeName: 'Certificación profesional',
    issuer: 'NSCA',
    name: 'CSCS',
    identifier: '123',
    issuedOn: '2020-01-01',
    expiresOn: '2028-01-01',
    verificationUrl: 'https://example.test/123',
    status: 'active',
    supersedesCredentialId: null,
    createdAt: new Date('2026-08-09T12:00:00.000Z'),
    retiredAt: null,
    verification: { state: 'unverified', validFrom: null, validTo: null, effective: false },
  }
}

function profile(): ProfessionalProfile {
  return {
    id: '0198d000-0000-7000-8000-000000000021',
    headline: 'Entrenadora de fuerza',
    bio: 'Acompaño procesos sostenibles.',
    practiceStartedYear: 2018,
    experienceYears: 8,
    specialties: [{ code: 'personal_training', name: 'Entrenamiento personal', description: null }],
    credentials: [],
    createdAt: new Date('2026-08-09T12:00:00.000Z'),
    updatedAt: new Date('2026-08-09T12:00:00.000Z'),
  }
}

function professional(
  overrides: Partial<StudioProfessionalService> = {},
): StudioProfessionalService {
  return {
    getMe: async () => ({ profile: null, memberships: [] }),
    putProfile: async () => ({ resource: profile(), replayed: false }),
    declareCredential: async () => ({ resource: credential(), replayed: false }),
    reviseCredential: async () => ({ resource: credential(), replayed: false }),
    retireCredential: async () => ({
      resource: { ...credential(), status: 'retired', retiredAt: new Date() },
      replayed: false,
    }),
    ...overrides,
  }
}

function app(service = professional(), sessionService = sessions()) {
  const instance = new Hono()
  instance.route('/studio/v1', studioProfessionalRoutes(sessionService, service))
  return instance
}

beforeEach(() => {
  process.env.STUDIO_WEB_URL = 'https://studio.example.test'
})

describe('Studio professional profile routes', () => {
  test('returns profile null and a no-store membership summary before profile creation', async () => {
    const response = await app().request('/studio/v1/me', { headers: HEADERS })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual({ profile: null, memberships: [] })
  })

  test('returns active memberships and terminated history without dropping end dates', async () => {
    const response = await app(
      professional({
        getMe: async () => ({
          profile: null,
          memberships: [
            {
              membershipId: '0198d000-0000-7000-8000-000000000041',
              organizationId: '0198d000-0000-7000-8000-000000000042',
              displayName: 'Active Gym',
              typeCode: 'gym',
              status: 'active',
              joinedAt: new Date('2025-01-01T00:00:00.000Z'),
              endedAt: null,
              roles: ['coach'],
            },
            {
              membershipId: '0198d000-0000-7000-8000-000000000043',
              organizationId: '0198d000-0000-7000-8000-000000000044',
              displayName: 'Closed Studio',
              typeCode: 'studio',
              status: 'terminated',
              joinedAt: new Date('2024-01-01T00:00:00.000Z'),
              endedAt: new Date('2025-06-01T00:00:00.000Z'),
              roles: ['staff'],
            },
          ],
        }),
      }),
    ).request('/studio/v1/me', { headers: HEADERS })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toMatchObject({
      memberships: [
        { status: 'active', ended_at: null, roles: ['coach'] },
        { status: 'terminated', ended_at: '2025-06-01T00:00:00.000Z', roles: ['staff'] },
      ],
    })
  })

  test('requires a completed Studio registration', async () => {
    const response = await app(
      professional(),
      sessions({ resolveActor: async () => ({ accountId: 'account-only' }) }),
    ).request('/studio/v1/me', { headers: HEADERS })
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: { code: 'registration-incomplete' } })
  })

  test('requires the opaque Studio cookie', async () => {
    const response = await app().request('/studio/v1/me')
    expect(response.status).toBe(401)
  })

  test('creates or updates the personal profile from a closed body', async () => {
    const response = await app().request('/studio/v1/me/professional-profile', {
      method: 'PUT',
      headers: HEADERS,
      body: JSON.stringify(PROFILE_BODY),
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      headline: 'Entrenadora de fuerza',
      practice_started_year: 2018,
    })
  })

  test('rejects future years and duplicated specialty codes', async () => {
    const response = await app().request('/studio/v1/me/professional-profile', {
      method: 'PUT',
      headers: HEADERS,
      body: JSON.stringify({
        ...PROFILE_BODY,
        practice_started_year: new Date().getUTCFullYear() + 1,
        specialty_codes: ['personal_training', 'personal_training'],
      }),
    })
    expect(response.status).toBe(422)
  })

  test('requires the exact Studio origin for mutations', async () => {
    const response = await app().request('/studio/v1/me/professional-profile', {
      method: 'PUT',
      headers: { ...HEADERS, origin: 'https://attacker.test' },
      body: JSON.stringify(PROFILE_BODY),
    })
    expect(response.status).toBe(403)
  })

  test('rejects credential URLs outside HTTPS', async () => {
    const response = await app().request('/studio/v1/me/professional-credentials', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ ...CREDENTIAL_BODY, verification_url: 'http://example.test/123' }),
    })
    expect(response.status).toBe(422)
  })

  test('declares credentials as unverified and exposes replay state', async () => {
    const response = await app(
      professional({
        declareCredential: async () => ({ resource: credential(), replayed: true }),
      }),
    ).request('/studio/v1/me/professional-credentials', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(CREDENTIAL_BODY),
    })
    expect(response.status).toBe(201)
    expect(response.headers.get('idempotent-replay')).toBe('true')
    await expect(response.json()).resolves.toMatchObject({
      verification: { state: 'unverified', effective: false },
    })
  })

  test('includes credentialId in revision hashes to prevent cross-resource replay', async () => {
    const hashes: string[] = []
    const service = professional({
      reviseCredential: async (_actor, _credentialId, command) => {
        hashes.push(Buffer.from(command.requestHash).toString('hex'))
        return { resource: credential(), replayed: false }
      },
    })
    for (const credentialId of [
      '0198d000-0000-7000-8000-000000000031',
      '0198d000-0000-7000-8000-000000000032',
    ]) {
      const response = await app(service).request(
        `/studio/v1/me/professional-credentials/${credentialId}/revisions`,
        { method: 'POST', headers: HEADERS, body: JSON.stringify(CREDENTIAL_BODY) },
      )
      expect(response.status).toBe(201)
    }
    expect(hashes).toHaveLength(2)
    expect(hashes[0]).not.toBe(hashes[1])
  })

  test('maps durable conflicts and unavailable persistence to closed errors', async () => {
    const conflict = Object.assign(new Error('conflict'), { code: '40001' })
    const conflictResponse = await app(
      professional({ retireCredential: async () => Promise.reject(conflict) }),
    ).request(
      '/studio/v1/me/professional-credentials/0198d000-0000-7000-8000-000000000031/retirement',
      { method: 'POST', headers: HEADERS },
    )
    expect(conflictResponse.status).toBe(409)

    const unavailableResponse = await app(
      professional({ getMe: async () => Promise.reject(new Error('database unavailable')) }),
    ).request('/studio/v1/me', { headers: HEADERS })
    expect(unavailableResponse.status).toBe(503)
  })
})
