import { beforeEach, describe, expect, test } from 'bun:test'
import { allfitV1ContractManifest, type AllfitV1Schemas } from '@allfitone/contracts'
import { Hono } from 'hono'

import {
  BACKOFFICE_SESSION_COOKIE,
  BackofficeAuthenticationError,
  type BackofficeAuthenticationService,
} from '../../identity/index.js'
import { mountSurfaces } from '../../../surfaces.js'
import type {
  SupportAttentionService,
  SupportBusinessService,
  SupportDiagnosisService,
  SupportMetadataService,
} from '../application/index.js'
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

const operation: AllfitV1Schemas['SupportOperation'] = {
  source: 'notification',
  reference_id: '019a6000-0000-7000-8000-000000000301',
  subject_kind: 'invitation',
  subject_id: '019a6000-0000-7000-8000-000000000401',
  label: 'identity.invitation_issued.v1',
  state: 'retrying',
  occurred_at: '2026-09-10T18:00:00.000Z',
  attempt_count: 3,
  last_error_code: 'smtp_timeout',
  resolved_at: null,
}

let diagnosisCalls: unknown[] = []

function diagnosisService(
  overrides: Partial<SupportDiagnosisService> = {},
): SupportDiagnosisService {
  return {
    listOperations: (_reader, input) => {
      diagnosisCalls.push(input)
      return Promise.resolve({ items: [operation], hasMore: true, nextCursor: 'next-page' })
    },
    listDeliveryCircuits: (_reader, input) => {
      diagnosisCalls.push(input)
      return Promise.resolve([
        {
          event_type: 'identity.invitation_issued.v1',
          state: 'open',
          window_started_at: '2026-09-10T17:00:00.000Z',
          success_count: 0,
          failure_count: 12,
          opened_until: '2026-09-10T19:00:00.000Z',
        },
      ])
    },
    ...overrides,
  }
}

const panel: AllfitV1Schemas['SupportAttentionPanel'] = {
  generated_at: '2026-09-13T18:00:00.000Z',
  billing: {
    availability: 'withheld',
    window_hours: 24,
    failed_platform_charges: null,
    platform_subscriptions_in_grace: null,
    platform_subscriptions_suspended: null,
    organization_subscriptions_suspended: null,
    failed_organization_charges_availability: null,
  },
  credential_verifications: {
    availability: 'withheld',
    pending_count: null,
    oldest_requested_at: null,
    renewals_due_count: null,
  },
  unclaimed_organizations: {
    availability: 'available',
    count: 3,
    oldest_created_at: '2026-09-01T12:00:00.000Z',
    needs_follow_up_count: 1,
  },
  repeated_failures: {
    availability: 'available',
    window_hours: 24,
    groups: [
      {
        source: 'notification',
        label: 'identity.invitation_issued.v1',
        affected: 2,
        failures: 5,
        latest_occurred_at: '2026-09-13T17:50:00.000Z',
        last_error_code: 'smtp_timeout',
      },
    ],
    groups_truncated: false,
    open_circuits: [],
  },
}

let attentionCalls: CapturedCall[] = []

function attentionService(
  overrides: Partial<SupportAttentionService> = {},
): SupportAttentionService {
  return {
    read: (reader, input) => {
      attentionCalls.push({ operation: 'read', reader, input })
      return Promise.resolve(panel)
    },
    ...overrides,
  }
}

const business: AllfitV1Schemas['SupportBusinessPanel'] = {
  generated_at: '2026-09-17T18:00:00.000Z',
  minimum_aggregate: 5,
  metrics: [
    {
      key: 'registered_people',
      availability: 'available',
      value: 128,
      reason: null,
      period: { kind: 'total', from: null, to: '2026-09-17T18:00:00.000Z' },
    },
    {
      key: 'studio_active_professionals_this_week',
      availability: 'below_threshold',
      value: null,
      reason: null,
      period: {
        kind: 'week',
        from: '2026-09-10T18:00:00.000Z',
        to: '2026-09-17T18:00:00.000Z',
      },
    },
    {
      key: 'premium_people',
      availability: 'available',
      value: 12,
      reason: null,
      period: { kind: 'total', from: null, to: '2026-09-17T18:00:00.000Z' },
    },
  ],
  money: [
    {
      key: 'billed_this_month',
      availability: 'available',
      amounts: [{ currency_code: 'COP', amount_minor: 7960000 }],
      reason: null,
      period: {
        kind: 'month',
        from: '2026-09-01T05:00:00.000Z',
        to: '2026-09-17T18:00:00.000Z',
      },
    },
  ],
}

let businessCalls: CapturedCall[] = []

function businessService(overrides: Partial<SupportBusinessService> = {}): SupportBusinessService {
  return {
    read: (reader, input) => {
      businessCalls.push({ operation: 'read', reader, input })
      return Promise.resolve(business)
    },
    ...overrides,
  }
}

function routes(
  service: SupportMetadataService = metadataService(),
  sessions: BackofficeAuthenticationService = sessionService(),
  diagnosis: SupportDiagnosisService = diagnosisService(),
  attention: SupportAttentionService = attentionService(),
  businessPanel: SupportBusinessService = businessService(),
): Hono {
  return new Hono().route(
    '/backoffice/v1',
    backofficeSupportMetadataRoutes(service, sessions, diagnosis, attention, businessPanel),
  )
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
  diagnosisCalls = []
  attentionCalls = []
  businessCalls = []
  process.env.BACKOFFICE_WEB_URL = ORIGIN
  process.env.STUDIO_WEB_URL = 'https://studio.example.test'
  process.env.API_PUBLIC_URL = 'https://api.example.test'
})

describe('Backoffice support metadata API contract', () => {
  test('T-SUP-API-21 mounts every support metadata operation with its contract method', () => {
    const contract = allfitV1ContractManifest.operations
      .filter((operation) =>
        ['OP-SUP-005', 'NEW-SUP-ATTENTION', 'NEW-SUP-DASHBOARD'].includes(
          operation.allfitOperation,
        ),
      )
      .map((operation) => `${operation.method} ${colonPath(operation.path)}`)
      .sort()
    const mounted = backofficeSupportMetadataRoutes()
      .routes.filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} /backoffice/v1${route.path}`)
      .sort()

    expect(contract).toHaveLength(6)
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
    expect(mounted).toContain('GET /backoffice/v1/support/operations')
    expect(mounted).toContain('GET /backoffice/v1/support/delivery-circuits')
    expect(mounted).toContain('GET /backoffice/v1/support/attention')
    expect(mounted).toContain('GET /backoffice/v1/support/business')
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

  test('T-SUP-API-33 reads the operational feed with its filters and its own cursor', async () => {
    const response = await routes().fetch(
      request('/support/operations?source=notification&state=retrying&limit=10'),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      data: [operation],
      page: { has_more: true, next_cursor: 'next-page' },
    })
    expect(diagnosisCalls[0]).toMatchObject({
      source: 'notification',
      state: 'retrying',
      limit: 10,
    })
  })

  test('T-SUP-API-34 refuses a filter outside its closed vocabulary', async () => {
    const answers = await Promise.all(
      ['source=payments', 'state=exploded', 'aggregate_id=not-a-uuid'].map((filter) =>
        routes().fetch(request(`/support/operations?${filter}`)),
      ),
    )

    expect(answers.map((response) => response.status)).toEqual([400, 400, 400])
    expect(diagnosisCalls).toEqual([])
  })

  test('T-SUP-API-35 refuses a page size outside the contract bounds', async () => {
    const answers = await Promise.all(
      ['limit=0', 'limit=101', 'limit=abc'].map((bound) =>
        routes().fetch(request(`/support/operations?${bound}`)),
      ),
    )

    expect(answers.map((response) => response.status)).toEqual([400, 400, 400])
    expect(diagnosisCalls).toEqual([])
  })

  test('T-SUP-API-36 round-trips its own cursor and rejects a forged one', async () => {
    const cursor = Buffer.from(
      JSON.stringify({
        occurredAt: '2026-09-10T18:00:00.000Z',
        id: '019a6000-0000-7000-8000-000000000301',
      }),
    ).toString('base64url')

    const accepted = await routes().fetch(request(`/support/operations?cursor=${cursor}`))
    expect(accepted.status).toBe(200)
    expect(diagnosisCalls[0]).toMatchObject({
      cursor: {
        occurredAt: '2026-09-10T18:00:00.000Z',
        id: '019a6000-0000-7000-8000-000000000301',
      },
    })

    const forged = await Promise.all(
      ['cursor=not-base64', `cursor=${Buffer.from('{"id":"nope"}').toString('base64url')}`].map(
        (bad) => routes().fetch(request(`/support/operations?${bad}`)),
      ),
    )
    expect(forged.map((response) => response.status)).toEqual([400, 400])
  })

  test('T-SUP-API-37 reads delivery health without asking for a case reference', async () => {
    const response = await routes().fetch(request('/support/delivery-circuits'))

    expect(response.status).toBe(200)
    const body = (await response.json()) as { items: { failure_count: number }[] }
    expect(body.items[0]?.failure_count).toBe(12)
    // A feed with no subject has nothing to trace back to a case, so requiring
    // one would be ceremony rather than a control.
    expect(diagnosisCalls).toHaveLength(1)
  })

  test('T-SUP-API-38 keeps the diagnosis routes behind the session and the origin', async () => {
    const unauthenticated = await routes().fetch(request('/support/operations', { cookie: false }))
    expect(unauthenticated.status).toBe(401)

    const allowed = await routes().fetch(request('/support/delivery-circuits'))
    expect(allowed.headers.get('cache-control')).toBe('no-store')

    // CORS on a GET is enforced by the browser, not by the server: the request
    // still runs, and what protects the answer is that a foreign origin gets no
    // grant to read it, plus the session cookie it cannot forge.
    const denied = await routes().fetch(
      request('/support/operations', { origin: 'https://attacker.test' }),
    )
    expect(denied.headers.get('access-control-allow-origin')).not.toBe('https://attacker.test')

    // Only the two authenticated reads reached the service; the cookieless one
    // never did.
    expect(diagnosisCalls).toHaveLength(2)
  })

  test('T-SUP-API-39 reads the attention panel as the operator, withheld notices included', async () => {
    const response = await routes().fetch(request('/support/attention'))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual(panel)
    expect(attentionCalls).toHaveLength(1)
    expect(attentionCalls[0]?.reader).toEqual({
      actorPersonId: ACTOR_PERSON_ID,
      actorSessionId: ACTOR_SESSION_ID,
    })
  })

  test('T-SUP-API-40 answers forbidden when no duty resolves a notice, and 503 when the read breaks', async () => {
    const forbidden = await routes(
      metadataService(),
      sessionService(),
      diagnosisService(),
      attentionService({
        read: () => Promise.reject(Object.assign(new Error('refused'), { code: '42501' })),
      }),
    ).fetch(request('/support/attention'))
    const broken = await routes(
      metadataService(),
      sessionService(),
      diagnosisService(),
      attentionService({ read: () => Promise.reject(new Error('database unavailable')) }),
    ).fetch(request('/support/attention'))

    expect([forbidden.status, broken.status]).toEqual([403, 503])
    expect(forbidden.headers.get('content-type')).toContain('application/problem+json')
  })

  test('T-SUP-API-41 never reads the panel without a session that still resolves', async () => {
    const missing = await routes().fetch(request('/support/attention', { cookie: false }))
    const ended = await routes(
      metadataService(),
      sessionService({
        resolveActor: async () =>
          Promise.reject(new BackofficeAuthenticationError('unauthenticated')),
      }),
    ).fetch(request('/support/attention'))

    expect([missing.status, ended.status]).toEqual([401, 401])
    expect(attentionCalls).toEqual([])
  })

  test('T-SUP-API-42 reads how the business is going, empty figures and all', async () => {
    const response = await routes().fetch(request('/support/business'))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual(business)
    expect(businessCalls).toHaveLength(1)
    expect(businessCalls[0]?.reader).toEqual({
      actorPersonId: ACTOR_PERSON_ID,
      actorSessionId: ACTOR_SESSION_ID,
    })
  })

  test('T-SUP-API-43 answers forbidden without the metrics duty, and 503 when the read breaks', async () => {
    const forbidden = await routes(
      metadataService(),
      sessionService(),
      diagnosisService(),
      attentionService(),
      businessService({
        read: () => Promise.reject(Object.assign(new Error('refused'), { code: '42501' })),
      }),
    ).fetch(request('/support/business'))
    const broken = await routes(
      metadataService(),
      sessionService(),
      diagnosisService(),
      attentionService(),
      businessService({ read: () => Promise.reject(new Error('database unavailable')) }),
    ).fetch(request('/support/business'))

    expect([forbidden.status, broken.status]).toEqual([403, 503])
    expect(forbidden.headers.get('content-type')).toContain('application/problem+json')
  })

  test('T-SUP-API-44 never reads the figures without a session that still resolves', async () => {
    const missing = await routes().fetch(request('/support/business', { cookie: false }))
    const ended = await routes(
      metadataService(),
      sessionService({
        resolveActor: async () =>
          Promise.reject(new BackofficeAuthenticationError('unauthenticated')),
      }),
    ).fetch(request('/support/business'))

    expect([missing.status, ended.status]).toEqual([401, 401])
    expect(businessCalls).toEqual([])
  })
})
