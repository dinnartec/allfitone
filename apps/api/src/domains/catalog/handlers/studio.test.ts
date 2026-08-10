import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { StudioSessionService } from '../../identity/index.js'
import type { StudioCatalogService } from '../application/index.js'
import { studioCatalogRoutes } from './studio.js'

const HEADERS = {
  origin: 'https://studio.example.test',
  cookie: 'allfit_studio_session=opaque',
}

function sessions(overrides: Partial<StudioSessionService> = {}): StudioSessionService {
  return {
    completeCode: async () => ({ opaqueToken: 'opaque' }),
    readSession: async () => ({
      authenticated: true,
      registration_status: 'complete',
      identity: { given_name: 'Ada', family_name: 'Lovelace' },
    }),
    resolveActor: async () => ({ accountId: 'account', personId: 'person' }),
    resolveAccountIdentity: async () => ({
      actor: { accountId: 'account', personId: 'person' },
      identity: { givenName: 'Ada', familyName: 'Lovelace' },
    }),
    logout: async () => ({
      redirectUrl: 'https://studio.example.test',
      outcome: 'already-absent',
    }),
    ...overrides,
  }
}

function catalog(overrides: Partial<StudioCatalogService> = {}): StudioCatalogService {
  return {
    listSpecialties: async () => [
      { code: 'personal_training', name: 'Entrenamiento personal', description: null },
    ],
    listCredentialTypes: async () => [
      { code: 'academic_degree', name: 'Título académico', description: null },
    ],
    ...overrides,
  }
}

function app(service = catalog(), sessionService = sessions()) {
  const instance = new Hono()
  instance.route('/studio/v1', studioCatalogRoutes(service, sessionService))
  return instance
}

beforeEach(() => {
  process.env.STUDIO_WEB_URL = 'https://studio.example.test'
})

describe('Studio professional catalogues', () => {
  test('returns governed order with an ETag and answers exact revalidation with 304', async () => {
    const first = await app().request('/studio/v1/professional-specialties', { headers: HEADERS })
    expect(first.status).toBe(200)
    expect(first.headers.get('cache-control')).toBe('private, max-age=0, must-revalidate')
    const etag = first.headers.get('etag')
    expect(etag).toBeTruthy()
    await expect(first.json()).resolves.toEqual({
      items: [{ code: 'personal_training', name: 'Entrenamiento personal', description: null }],
    })

    const second = await app().request('/studio/v1/professional-specialties', {
      headers: { ...HEADERS, 'if-none-match': etag ?? '' },
    })
    expect(second.status).toBe(304)
    expect(second.headers.get('etag')).toBe(etag)
  })

  test('returns the closed professional credential type catalogue', async () => {
    const response = await app().request('/studio/v1/professional-credential-types', {
      headers: HEADERS,
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      items: [{ code: 'academic_degree', name: 'Título académico', description: null }],
    })
  })

  test('requires completed registration and fails unavailable persistence closed', async () => {
    const incomplete = await app(
      catalog(),
      sessions({ resolveActor: async () => ({ accountId: 'account' }) }),
    ).request('/studio/v1/professional-specialties', { headers: HEADERS })
    expect(incomplete.status).toBe(403)

    const unavailable = await app(
      catalog({ listSpecialties: async () => Promise.reject(new Error('database unavailable')) }),
    ).request('/studio/v1/professional-specialties', { headers: HEADERS })
    expect(unavailable.status).toBe(503)
  })

  test('exposes CORS only to the exact Studio origin', async () => {
    const allowed = await app().request('/studio/v1/professional-specialties', {
      headers: HEADERS,
    })
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://studio.example.test')

    const denied = await app().request('/studio/v1/professional-specialties', {
      headers: { ...HEADERS, origin: 'https://attacker.test' },
    })
    expect(denied.headers.get('access-control-allow-origin')).not.toBe('https://attacker.test')
  })
})
