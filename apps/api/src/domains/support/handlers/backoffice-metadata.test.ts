import { beforeEach, describe, expect, test } from 'bun:test'
import { allfitV1ContractManifest, type AllfitV1Schemas } from '@allfitone/contracts'
import { Hono } from 'hono'

import {
  BACKOFFICE_SESSION_COOKIE,
  BackofficeAuthenticationError,
  type BackofficeAuthenticationService,
} from '../../identity/index.js'
import { mountSurfaces } from '../../../surfaces.js'
import type { SupportMetadataService } from '../application/index.js'
import { backofficeSupportMetadataRoutes } from './backoffice-metadata.js'

const ORIGIN = 'https://backoffice.example.test'
const ACTOR_PERSON_ID = '019a5000-0000-7000-8000-000000000003'
const ACTOR_SESSION_ID = '019a5000-0000-7000-8000-000000000023'
const SUBJECT_ID = '019a5000-0000-7000-8000-000000000005'
const CASE = 'CASE-2026-101'

const metadata: AllfitV1Schemas['SupportPersonMetadata'] = {
  person_id: SUBJECT_ID,
  account_status: 'active',
  created_at: '2026-01-04T10:00:00.000Z',
  activated_at: '2026-01-05T10:00:00.000Z',
  contact_email_masked: '••••••••on@example.test',
  contact_phone_masked: '••••••4567',
  email_verified_at: '2026-01-05T10:05:00.000Z',
  phone_verified_at: null,
  has_access_account: true,
  access_account_linked_at: '2026-01-05T10:01:00.000Z',
  active_session_count: 1,
  last_seen_at: '2026-09-09T18:00:00.000Z',
  has_professional_profile: false,
  membership_count: 2,
  active_membership_count: 1,
  relationships_availability: 'not_modelled',
  plan_availability: 'not_modelled',
  premium_availability: 'not_modelled',
  permissions_availability: 'not_modelled',
}

interface CapturedCall {
  operation: string
  reader: unknown
  input: unknown
}

let captured: CapturedCall[] = []

function metadataService(overrides: Partial<SupportMetadataService> = {}): SupportMetadataService {
  return {
    search: (reader, input) => {
      captured.push({ operation: 'search', reader, input })
      return Promise.resolve({ outcome: 'found', items: [metadata] })
    },
    read: (reader, input) => {
      captured.push({ operation: 'read', reader, input })
      return Promise.resolve(metadata)
    },
    ...overrides,
  }
}

function sessionService(
  overrides: Partial<BackofficeAuthenticationService> = {},
): BackofficeAuthenticationService {
  return {
    resolveActor: async () => ({ personId: ACTOR_PERSON_ID, sessionId: ACTOR_SESSION_ID }),
    ...overrides,
  } as BackofficeAuthenticationService
}

function routes(
  service: SupportMetadataService = metadataService(),
  sessions: BackofficeAuthenticationService = sessionService(),
): Hono {
  return new Hono().route('/backoffice/v1', backofficeSupportMetadataRoutes(service, sessions))
}

function request(path: string, init: { origin?: string; cookie?: boolean } = {}): Request {
  const headers = new Headers({ origin: init.origin ?? ORIGIN })
  if (init.cookie !== false) headers.set('cookie', `${BACKOFFICE_SESSION_COOKIE}=session-secret`)
  return new Request(`https://api.example.test/backoffice/v1${path}`, { headers })
}

function colonPath(path: string): string {
  return path.replace(/\{([A-Za-z0-9_]+)\}/g, ':$1')
}

beforeEach(() => {
  captured = []
  process.env.BACKOFFICE_WEB_URL = ORIGIN
  process.env.STUDIO_WEB_URL = 'https://studio.example.test'
  process.env.API_PUBLIC_URL = 'https://api.example.test'
})

describe('Backoffice support metadata API contract', () => {
  test('T-SUP-API-21 mounts every OP-SUP-005 operation with its contract method', () => {
    const contract = allfitV1ContractManifest.operations
      .filter((operation) => operation.allfitOperation === 'OP-SUP-005')
      .map((operation) => `${operation.method} ${colonPath(operation.path)}`)
      .sort()
    const mounted = backofficeSupportMetadataRoutes()
      .routes.filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} /backoffice/v1${route.path}`)
      .sort()

    expect(contract).toHaveLength(2)
    expect(mounted).toEqual(contract)
  })

  test('T-SUP-API-22 mounts below the real Backoffice surface prefix', () => {
    const app = new Hono()
    mountSurfaces(app)
    const mounted = app.routes
      .filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path}`)

    expect(mounted).toContain('GET /backoffice/v1/support/people')
    expect(mounted).toContain('GET /backoffice/v1/support/people/:personId')
  })

  test('T-SUP-API-23 finds a person by an exact contact and carries the case through', async () => {
    const response = await routes().fetch(
      request(`/support/people?case_reference=${CASE}&email=subject.epsilon%40example.test`),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ outcome: 'found', items: [metadata] })
    expect(captured[0]?.reader).toEqual({
      actorPersonId: ACTOR_PERSON_ID,
      actorSessionId: ACTOR_SESSION_ID,
    })
    expect(captured[0]?.input).toMatchObject({
      caseReference: CASE,
      lookupKind: 'email',
      lookupValue: 'subject.epsilon@example.test',
    })
  })

  test('T-SUP-API-24 says nothing was found instead of answering a bare empty list', async () => {
    const response = await routes(
      metadataService({ search: async () => ({ outcome: 'not_found', items: [] }) }),
    ).fetch(request(`/support/people?case_reference=${CASE}&identifier=${SUBJECT_ID}`))

    expect(response.status).toBe(200)
    const body = (await response.json()) as { outcome: string; items: unknown[] }
    expect(body.outcome).toBe('not_found')
    expect(body.items).toEqual([])
  })

  test('T-SUP-API-25 accepts exactly one lookup parameter, never two and never none', async () => {
    const two = await routes().fetch(
      request(
        `/support/people?case_reference=${CASE}&identifier=${SUBJECT_ID}&phone=%2B573001234567`,
      ),
    )
    const none = await routes().fetch(request(`/support/people?case_reference=${CASE}`))

    expect([two.status, none.status]).toEqual([400, 400])
    expect(captured).toEqual([])
  })

  test('T-SUP-API-26 refuses a malformed lookup before it becomes a recorded search', async () => {
    const answers = await Promise.all(
      [`identifier=not-a-uuid`, `email=subject.epsilon`, `phone=573001234567`].map((lookup) =>
        routes().fetch(request(`/support/people?case_reference=${CASE}&${lookup}`)),
      ),
    )

    expect(answers.map((response) => response.status)).toEqual([400, 400, 400])
    expect(captured).toEqual([])
  })

  test('T-SUP-API-27 requires a traceable case reference on both reads', async () => {
    const searchWithout = await routes().fetch(request(`/support/people?identifier=${SUBJECT_ID}`))
    const searchProse = await routes().fetch(
      request(`/support/people?case_reference=el%20usuario%20no%20entra&identifier=${SUBJECT_ID}`),
    )
    const readWithout = await routes().fetch(request(`/support/people/${SUBJECT_ID}`))

    expect([searchWithout.status, searchProse.status, readWithout.status]).toEqual([400, 400, 400])
    expect(captured).toEqual([])
  })

  test('T-SUP-API-28 opens the operational state without a name or a full contact', async () => {
    const response = await routes().fetch(
      request(`/support/people/${SUBJECT_ID}?case_reference=${CASE}`),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = (await response.json()) as Record<string, unknown>
    expect(body.person_id).toBe(SUBJECT_ID)
    expect(body.relationships_availability).toBe('not_modelled')
    for (const forbidden of ['given_name', 'family_name', 'display_name', 'username', 'subject']) {
      expect(body).not.toHaveProperty(forbidden)
    }
  })

  test('T-SUP-API-29 rejects a malformed person before reaching the database', async () => {
    const response = await routes().fetch(
      request(`/support/people/not-a-uuid?case_reference=${CASE}`),
    )

    expect(response.status).toBe(400)
    expect(captured).toEqual([])
  })

  test('T-SUP-API-30 maps every declared database verdict to its problem response', async () => {
    const verdicts: [string, number][] = [
      ['P0002', 404],
      ['42501', 403],
      ['23514', 422],
    ]
    const answers = await Promise.all(
      verdicts.map(([sqlState]) =>
        routes(
          metadataService({
            read: () => Promise.reject(Object.assign(new Error('refused'), { code: sqlState })),
          }),
        ).fetch(request(`/support/people/${SUBJECT_ID}?case_reference=${CASE}`)),
      ),
    )
    const broken = await routes(
      metadataService({ read: () => Promise.reject(new Error('database unavailable')) }),
    ).fetch(request(`/support/people/${SUBJECT_ID}?case_reference=${CASE}`))

    expect(answers.map((response) => response.status)).toEqual(verdicts.map(([, status]) => status))
    expect(broken.status).toBe(503)
    expect(answers[0]?.headers.get('content-type')).toContain('application/problem+json')
  })

  test('T-SUP-API-31 answers unauthenticated without a session and when it no longer resolves', async () => {
    const missing = await routes().fetch(
      request(`/support/people/${SUBJECT_ID}?case_reference=${CASE}`, { cookie: false }),
    )
    const ended = await routes(
      metadataService(),
      sessionService({
        resolveActor: async () =>
          Promise.reject(new BackofficeAuthenticationError('unauthenticated')),
      }),
    ).fetch(request(`/support/people/${SUBJECT_ID}?case_reference=${CASE}`))

    expect([missing.status, ended.status]).toEqual([401, 401])
    expect(captured).toEqual([])
  })

  test('T-SUP-API-32 exposes CORS to the exact Backoffice origin and stores nothing', async () => {
    const allowed = await routes().fetch(
      request(`/support/people/${SUBJECT_ID}?case_reference=${CASE}`),
    )
    expect(allowed.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(allowed.headers.get('referrer-policy')).toBe('no-referrer')

    const denied = await routes().fetch(
      request(`/support/people/${SUBJECT_ID}?case_reference=${CASE}`, {
        origin: 'https://attacker.test',
      }),
    )
    expect(denied.headers.get('access-control-allow-origin')).not.toBe('https://attacker.test')
  })
})
