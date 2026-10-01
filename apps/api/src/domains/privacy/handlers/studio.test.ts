import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { StudioSessionService } from '../../identity/index.js'
import type { OfferableScopeService } from '../application/index.js'
import type { OfferableScope } from '../domain/index.js'
import { studioPrivacyRoutes } from './studio.js'

const PATH = '/studio/v1/offerable-scopes'
const HEADERS = {
  origin: 'https://studio.example.test',
  cookie: 'allfit_studio_session=opaque',
}

const BODY_PROGRESS: OfferableScope = {
  scope_definition_id: '0199e000-0000-7000-8000-000000000001',
  scope_code: 'body_progress',
  version_number: 1,
  display_name: 'Progreso corporal',
  summary: 'Medidas y las fotos que elija, sin datos de salud.',
  description:
    'Medidas, composición corporal, tendencias y las fotos que tú selecciones. No incluye tu galería, ni la ubicación de las fotos, ni datos de salud.',
  default_purpose: 'Seguir cómo cambia tu cuerpo y ajustar el plan a lo que muestren las medidas.',
}

function sessions(overrides: Partial<StudioSessionService> = {}): StudioSessionService {
  return {
    completeCode: async () => ({ opaqueToken: 'opaque' }),
    readSession: async () => ({
      authenticated: true,
      registration_status: 'complete',
      identity: { given_name: null, family_name: null },
    }),
    resolveActor: async () => ({
      accountId: 'account',
      personId: '0199e000-0000-7000-8000-000000000011',
    }),
    resolveAccountIdentity: async () => ({
      actor: { accountId: 'account', personId: '0199e000-0000-7000-8000-000000000011' },
      identity: { givenName: null, familyName: null, verifiedEmail: 'ada@example.test' },
    }),
    logout: async () => ({ redirectUrl: 'https://studio.example.test', outcome: 'revoked' }),
    ...overrides,
  }
}

function catalogue(overrides: Partial<OfferableScopeService> = {}): OfferableScopeService {
  return {
    list: async () => [BODY_PROGRESS],
    ...overrides,
  }
}

function app(service: OfferableScopeService = catalogue(), session = sessions()): Hono {
  const routes = new Hono()
  routes.route('/studio/v1', studioPrivacyRoutes(service, session))
  return routes
}

function get(headers: Record<string, string> = HEADERS): Request {
  return new Request(`https://api.example.test${PATH}`, { headers })
}

beforeEach(() => {
  process.env.STUDIO_WEB_URL = 'https://studio.example.test'
})

describe('the offerable permission catalogue', () => {
  test('returns each permission with the words to name it', async () => {
    const response = await app().fetch(get())
    expect(response.status).toBe(200)
    const payload = (await response.json()) as { items: OfferableScope[] }
    expect(payload.items[0]).toMatchObject({
      scope_code: 'body_progress',
      display_name: 'Progreso corporal',
      version_number: 1,
    })
  })

  /*
   * The boundary is as much of the answer as the reach. Somebody deciding
   * whether a gym may read their measurements is owed where it stops.
   */
  test('the description states what the permission does not reach', async () => {
    const response = await app().fetch(get())
    const payload = (await response.json()) as { items: OfferableScope[] }
    expect(payload.items[0]?.description).toContain('No incluye')
  })

  /*
   * Two texts for two readers: the summary is what the professional building
   * the invitation reads, the description what the person deciding reads. If
   * they were the same, one of them would be reading the other's.
   */
  test('carries a short summary distinct from the full description', async () => {
    const response = await app().fetch(get())
    const payload = (await response.json()) as { items: OfferableScope[] }
    const scope = payload.items[0]
    expect(scope?.summary).toBeTruthy()
    expect(scope?.summary).not.toBe(scope?.description)
    expect(scope?.summary).toContain('sin datos de salud')
  })

  test('carries the purpose, so the client never writes one', async () => {
    const response = await app().fetch(get())
    const payload = (await response.json()) as { items: OfferableScope[] }
    expect(payload.items[0]?.default_purpose).toBeTruthy()
  })

  test('is never cached', async () => {
    const response = await app().fetch(get())
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  test('carries no rule set: that is what Backoffice curates, not what a person reads', async () => {
    const response = await app().fetch(get())
    const body = await response.text()
    expect(body).not.toContain('rules')
    expect(body).not.toContain('data_classification')
  })
})

describe('what it refuses', () => {
  test('a request from another origin', async () => {
    const response = await app().fetch(get({ ...HEADERS, origin: 'https://evil.test' }))
    expect(response.status).toBe(403)
  })

  test('a request with no session', async () => {
    const { cookie: _cookie, ...headers } = HEADERS
    const response = await app().fetch(get(headers))
    expect(response.status).toBe(401)
  })

  test('an account that has not finished registering', async () => {
    const incomplete = sessions({
      resolveActor: async () => ({ accountId: 'account' }),
    })
    const response = await app(catalogue(), incomplete).fetch(get())
    expect(response.status).toBe(403)
  })

  test('a caller PostgreSQL refuses, without inventing an answer', async () => {
    const denied = catalogue({
      list: async () => {
        throw Object.assign(new Error('denied'), { code: '42501' })
      },
    })
    const response = await app(denied).fetch(get())
    expect(response.status).toBe(403)
  })
})
