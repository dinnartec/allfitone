import { beforeEach, describe, expect, test } from 'bun:test'
import { allfitV1ContractManifest, type AllfitV1Schemas } from '@allfitone/contracts'
import { Hono } from 'hono'

import {
  BACKOFFICE_SESSION_COOKIE,
  BackofficeAuthenticationError,
  type BackofficeAuthenticationService,
} from '../../identity/index.js'
import { mountSurfaces } from '../../../surfaces.js'
import type { OrganizationDirectoryService } from '../application/directory.js'
import type { OrganizationFileService } from '../application/file.js'
import type { OrganizationHandoverService } from '../application/handover.js'
import type { OrganizationGuestQuotaService } from '../application/quota.js'
import type { OrganizationSuspensionService } from '../application/suspension.js'
import { backofficeOrganizationRoutes } from './backoffice.js'

const ORIGIN = 'https://backoffice.example.test'
const ACTOR_PERSON_ID = '019ab000-0000-7000-8000-000000000003'
const ACTOR_SESSION_ID = '019ab000-0000-7000-8000-000000000023'
const ORGANIZATION_ID = '019ab000-0000-7000-8000-000000000301'
const IDEMPOTENCY_KEY = 'd1000000-0000-4000-8000-000000000001'
const COMMAND_ID = '019ab000-0000-7000-8000-000000000501'

const summary: AllfitV1Schemas['BackofficeOrganizationSummary'] = {
  organization_id: ORGANIZATION_ID,
  display_name: 'Dirtest Norte',
  type_code: 'gym',
  type_name: 'Gimnasio',
  status: 'active',
  created_at: '2026-08-04T15:00:00.000Z',
  claimed_at: '2026-08-04T15:00:00.000Z',
  cancelled_at: null,
  active_member_count: 1,
  site_count: 2,
  people_served: 0,
}

const handoverResource: AllfitV1Schemas['OrganizationHandover'] = {
  organization_id: ORGANIZATION_ID,
  display_name: 'Handover Norte',
  type_code: 'gym',
  type_name: 'Gimnasio',
  party_kind: 'legal_entity',
  legal_name: 'Norte Fitness SAS',
  status: 'unclaimed',
  created_at: '2026-09-13T15:00:00.000Z',
  claimed_at: null,
  cancelled_at: null,
  site: { site_id: '019ab000-0000-7000-8000-000000000601', name: 'Sede Principal', address: null },
  invitation: {
    invitation_id: COMMAND_ID,
    status: 'pending',
    intent_status: 'pending',
    contact_hint: 'o***@example.test',
    expires_at: '2026-09-20T15:00:00.000Z',
  },
}

let captured: unknown[] = []
let handoverCalls: Array<{ operation: string; input: unknown }> = []
let fileCalls: unknown[] = []
let quotaCalls: Array<{ organizationId: string; decision: unknown }> = []

const quotaResource: AllfitV1Schemas['OrganizationGuestQuota'] = {
  organization_id: ORGANIZATION_ID,
  seats: 50,
  occupied: 3,
  relationships_active: 2,
  invitations_pending: 1,
  places_left: 47,
  over_quota: false,
  last_change: {
    at: '2026-10-15T15:00:00.000Z',
    by_person_id: ACTOR_PERSON_ID,
    by_duty_assignment_id: '019ab000-0000-7000-8000-000000000701',
    previous_seats: null,
  },
}

const fileSuspension: AllfitV1Schemas['OrganizationSuspension'] = {
  organization_id: ORGANIZATION_ID,
  status: 'active',
  suspended: false,
  suspended_at: null,
  current: null,
  history: [],
}

const fileResource: AllfitV1Schemas['BackofficeOrganizationFile'] = {
  organization: {
    organization_id: ORGANIZATION_ID,
    display_name: 'Dirtest Norte',
    type_code: 'gym',
    type_name: 'Gimnasio',
    status: 'active',
    party_kind: 'legal_entity',
    legal_name: 'Norte Fitness SAS',
    created_at: '2026-08-04T15:00:00.000Z',
    claimed_at: '2026-08-04T15:00:00.000Z',
    cancelled_at: null,
  },
  owner: {
    person_id: ACTOR_PERSON_ID,
    membership_id: '019ab000-0000-7000-8000-000000000311',
    since: '2026-08-04T15:00:00.000Z',
  },
  team: [
    {
      membership_id: '019ab000-0000-7000-8000-000000000311',
      person_id: ACTOR_PERSON_ID,
      roles: ['owner'],
      joined_at: '2026-08-04T15:00:00.000Z',
    },
  ],
  team_counts: { active: 1, terminated: 0 },
  team_truncated: false,
  sites: [],
  people_served: 0,
  relationship_counts: { active: 0, terminated: 0 },
  plans: [],
  payment_method: { connected: false, provider: null, connected_at: null },
  premium: { gives_pro: true, reason: null },
  guest_quota: quotaResource,
  suspension: fileSuspension,
}

function fileService(overrides: Partial<OrganizationFileService> = {}): OrganizationFileService {
  return {
    read: (_reader, input) => {
      fileCalls.push(input)
      return Promise.resolve(fileResource)
    },
    ...overrides,
  }
}

function directoryService(
  overrides: Partial<OrganizationDirectoryService> = {},
): OrganizationDirectoryService {
  return {
    list: (_reader, input) => {
      captured.push(input)
      return Promise.resolve({
        items: [summary],
        hasMore: true,
        nextCursor: 'eyJuYW1lIjoiRGlydGVzdCJ9',
      })
    },
    ...overrides,
  }
}

function handoverService(
  overrides: Partial<OrganizationHandoverService> = {},
  replayed = false,
): OrganizationHandoverService {
  return {
    create: (_actor, input) => {
      handoverCalls.push({ operation: 'create', input })
      return Promise.resolve({ resource: handoverResource, replayed })
    },
    read: (_actor, input) => {
      handoverCalls.push({ operation: 'read', input })
      return Promise.resolve(handoverResource)
    },
    resend: (_actor, input) => {
      handoverCalls.push({ operation: 'resend', input })
      return Promise.resolve({ resource: handoverResource, replayed })
    },
    cancel: (_actor, input) => {
      handoverCalls.push({ operation: 'cancel', input })
      return Promise.resolve({
        resource: { ...handoverResource, status: 'cancelled' },
        replayed,
      })
    },
    ...overrides,
  }
}

const suspensionResource: AllfitV1Schemas['OrganizationSuspension'] = {
  organization_id: ORGANIZATION_ID,
  status: 'suspended',
  suspended: true,
  suspended_at: '2026-10-18T15:00:00.000Z',
  current: {
    suspension_id: '019ab000-0000-7000-8000-000000000801',
    reason_code: 'nonpayment',
    started_at: '2026-10-18T15:00:00.000Z',
    started_by_person_id: ACTOR_PERSON_ID,
    people_blocked: 2,
  },
  history: [],
}

let suspensionCalls: { organizationId: string; reason?: string; action: string }[] = []

function suspensionService(
  overrides: Partial<OrganizationSuspensionService> = {},
  replayed = false,
): OrganizationSuspensionService {
  return {
    suspend: (_actor, input) => {
      suspensionCalls.push({
        organizationId: input.organizationId,
        reason: input.decision.reason_code,
        action: 'suspend',
      })
      return Promise.resolve({ resource: suspensionResource, replayed })
    },
    reactivate: (_actor, input) => {
      suspensionCalls.push({ organizationId: input.organizationId, action: 'reactivate' })
      return Promise.resolve({
        resource: {
          ...suspensionResource,
          status: 'active',
          suspended: false,
          suspended_at: null,
          current: null,
          history: [
            {
              suspension_id: '019ab000-0000-7000-8000-000000000801',
              reason_code: 'nonpayment',
              started_at: '2026-10-18T15:00:00.000Z',
              started_by_person_id: ACTOR_PERSON_ID,
              ended_at: '2026-10-18T18:00:00.000Z',
              ended_by_person_id: ACTOR_PERSON_ID,
            },
          ],
        },
        replayed,
      })
    },
    ...overrides,
  }
}

function suspensionRoutes(suspension: OrganizationSuspensionService): Hono {
  return new Hono().route(
    '/backoffice/v1',
    backofficeOrganizationRoutes(
      directoryService(),
      sessionService(),
      handoverService(),
      fileService(),
      quotaService(),
      suspension,
    ),
  )
}

function quotaService(
  overrides: Partial<OrganizationGuestQuotaService> = {},
  replayed = false,
): OrganizationGuestQuotaService {
  return {
    set: (_actor, input) => {
      quotaCalls.push({ organizationId: input.organizationId, decision: input.decision })
      return Promise.resolve({ resource: quotaResource, replayed })
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
  directory: OrganizationDirectoryService = directoryService(),
  sessions: BackofficeAuthenticationService = sessionService(),
  handover: OrganizationHandoverService = handoverService(),
  file: OrganizationFileService = fileService(),
  quota: OrganizationGuestQuotaService = quotaService(),
): Hono {
  return new Hono().route(
    '/backoffice/v1',
    backofficeOrganizationRoutes(directory, sessions, handover, file, quota),
  )
}

function get(query = '', init: { cookie?: boolean } = {}): Request {
  const headers = new Headers({ origin: ORIGIN })
  if (init.cookie !== false) headers.set('cookie', `${BACKOFFICE_SESSION_COOKIE}=session-secret`)
  return new Request(`https://api.example.test/backoffice/v1/organizations${query}`, { headers })
}

function post(
  path: string,
  body: string | undefined,
  overrides: Record<string, string | null> = {},
): Request {
  const headers = new Headers({
    origin: ORIGIN,
    cookie: `${BACKOFFICE_SESSION_COOKIE}=session-secret`,
    'idempotency-key': IDEMPOTENCY_KEY,
    'command-id': COMMAND_ID,
  })
  if (body !== undefined) headers.set('content-type', 'application/json')
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) headers.delete(name)
    else headers.set(name, value)
  }
  return new Request(`https://api.example.test/backoffice/v1${path}`, {
    method: 'POST',
    headers,
    ...(body === undefined ? {} : { body }),
  })
}

const validCreate = {
  display_name: '  Handover Norte ',
  type_code: 'gym',
  party_kind: 'legal_entity',
  legal_name: 'Norte Fitness SAS',
  site: { name: 'Sede Principal' },
  owner_email: ' Owner@Example.test ',
}

const quotaPath = `/organizations/${ORGANIZATION_ID}/guest-quota`
const suspensionPath = `/organizations/${ORGANIZATION_ID}/suspension`
const reactivationPath = `/organizations/${ORGANIZATION_ID}/reactivation`

function quotaRoutes(quota: OrganizationGuestQuotaService): Hono {
  return routes(directoryService(), sessionService(), handoverService(), fileService(), quota)
}

function cursorFor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function colonPath(path: string): string {
  return path.replace(/\{([A-Za-z0-9_]+)\}/g, ':$1')
}

beforeEach(() => {
  captured = []
  handoverCalls = []
  fileCalls = []
  quotaCalls = []
  suspensionCalls = []
  process.env.BACKOFFICE_WEB_URL = ORIGIN
  process.env.STUDIO_WEB_URL = 'https://studio.example.test'
  process.env.API_PUBLIC_URL = 'https://api.example.test'
})

describe('Backoffice organization API contract', () => {
  test('T-ORG-API-01 mounts every Backoffice organization operation with its contract method', () => {
    // A gym's team and client invitations live under this path but belong to identity,
    // which mounts them.
    const identityOwned = ['NEW-IDN-RESEND', 'OP-IDN-052', 'NEW-IDN-CLIENT-RESEND', 'OP-IDN-051']
    const contract = allfitV1ContractManifest.operations
      .filter((operation) => operation.path.startsWith('/backoffice/v1/organizations'))
      .filter((operation) => !identityOwned.includes(operation.allfitOperation))
      .map((operation) => `${operation.method} ${colonPath(operation.path)}`)
      .sort()
    const mounted = backofficeOrganizationRoutes()
      .routes.filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} /backoffice/v1${route.path}`)
      .sort()

    expect(contract).toHaveLength(9)
    expect(mounted).toEqual(contract)
  })

  test('T-ORG-API-02 mounts the organization routes below the real Backoffice surface prefix', () => {
    const app = new Hono()
    mountSurfaces(app)
    const mounted = app.routes
      .filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path}`)

    expect(mounted).toEqual(
      expect.arrayContaining([
        'GET /backoffice/v1/organizations',
        'POST /backoffice/v1/organizations',
        'GET /backoffice/v1/organizations/:organizationId',
        'GET /backoffice/v1/organizations/:organizationId/handover',
        'POST /backoffice/v1/organizations/:organizationId/handover/resends',
        'POST /backoffice/v1/organizations/:organizationId/cancellation',
        'POST /backoffice/v1/organizations/:organizationId/guest-quota',
      ]),
    )
  })

  test('T-ORG-API-03 reads the directory as a page and keeps it out of any cache', async () => {
    const response = await routes().fetch(get())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      data: [summary],
      page: { has_more: true, next_cursor: 'eyJuYW1lIjoiRGlydGVzdCJ9' },
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  test('T-ORG-API-04 passes the search, the state, the page size and the cursor through', async () => {
    const cursor = cursorFor({ name: 'Dirtest Norte', id: ORGANIZATION_ID })
    const response = await routes().fetch(
      get(`?q=%20norte%20&status=unclaimed&limit=10&cursor=${cursor}`),
    )

    expect(response.status).toBe(200)
    expect(captured[0]).toMatchObject({
      query: 'norte',
      status: 'unclaimed',
      limit: 10,
      cursor: { name: 'Dirtest Norte', id: ORGANIZATION_ID },
    })
  })

  test('T-ORG-API-05 refuses a filter it cannot read instead of widening the question', async () => {
    const answers = await Promise.all(
      [
        '?q=d',
        `?q=${'x'.repeat(121)}`,
        '?status=suspended_forever',
        '?owner=someone',
        '?limit=0',
        '?limit=101',
        '?cursor=not-a-cursor-at-all',
        `?cursor=${cursorFor({ name: 'Dirtest', id: 'not-a-uuid' })}`,
      ].map((query) => routes().fetch(get(query))),
    )

    expect(answers.map((response) => response.status)).toEqual([
      400, 400, 400, 400, 400, 400, 400, 400,
    ])
    expect(captured).toEqual([])
  })

  test('T-ORG-API-06 turns a missing duty into forbidden', async () => {
    const response = await routes(
      directoryService({
        list: () => Promise.reject(Object.assign(new Error('denied'), { code: '42501' })),
      }),
    ).fetch(get())

    expect(response.status).toBe(403)
  })

  test('T-ORG-API-07 answers unauthenticated without a session and when it ended', async () => {
    const missing = await routes().fetch(get('', { cookie: false }))
    const ended = await routes(
      directoryService(),
      sessionService({
        resolveActor: async () =>
          Promise.reject(new BackofficeAuthenticationError('unauthenticated')),
      }),
    ).fetch(get())

    expect([missing.status, ended.status]).toEqual([401, 401])
    expect(captured).toEqual([])
  })

  test('T-ORG-API-08 creates a handover and passes only the normalised command through', async () => {
    const response = await routes().fetch(post('/organizations', JSON.stringify(validCreate)))

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual(handoverResource)
    expect(response.headers.get('idempotent-replay')).toBeNull()
    expect(handoverCalls).toHaveLength(1)
    expect(handoverCalls[0]?.input).toMatchObject({
      idempotencyKey: IDEMPOTENCY_KEY,
      commandId: COMMAND_ID,
      handover: {
        display_name: 'Handover Norte',
        type_code: 'gym',
        party_kind: 'legal_entity',
        legal_name: 'Norte Fitness SAS',
        site: { name: 'Sede Principal', address: null },
        owner_email: 'owner@example.test',
      },
    })
  })

  test('T-ORG-API-09 marks a replayed creation instead of creating twice', async () => {
    const response = await routes(
      directoryService(),
      sessionService(),
      handoverService({}, true),
    ).fetch(post('/organizations', JSON.stringify(validCreate)))

    expect(response.status).toBe(201)
    expect(response.headers.get('idempotent-replay')).toBe('true')
  })

  test('T-ORG-API-10 refuses a handover body that would write a person or widen the command', async () => {
    const bodies = [
      { ...validCreate, party_kind: 'natural_person' },
      { ...validCreate, legal_name: null },
      { ...validCreate, owner_person_id: ACTOR_PERSON_ID },
      { ...validCreate, site: { address: 'Calle 1' } },
      { ...validCreate, site: { name: 'Sede', address: '   ' } },
      { ...validCreate, owner_email: 'not an email' },
      { ...validCreate, type_code: 'clinic' },
      { ...validCreate, display_name: '' },
    ]
    const answers = await Promise.all(
      bodies.map((body) => routes().fetch(post('/organizations', JSON.stringify(body)))),
    )

    expect(answers.map((response) => response.status)).toEqual([
      422, 422, 422, 422, 422, 422, 422, 422,
    ])
    expect(handoverCalls).toEqual([])
  })

  test('T-ORG-API-11 requires the trusted origin, a JSON body and the command identifiers', async () => {
    const body = JSON.stringify(validCreate)
    const answers = await Promise.all([
      routes().fetch(post('/organizations', body, { origin: 'https://evil.example.test' })),
      routes().fetch(post('/organizations', body, { 'content-type': 'text/plain' })),
      routes().fetch(post('/organizations', body, { 'command-id': null })),
      routes().fetch(post('/organizations', body, { 'idempotency-key': COMMAND_ID })),
    ])

    expect(answers.map((response) => response.status)).toEqual([403, 415, 400, 400])
    expect(handoverCalls).toEqual([])
  })

  test('T-ORG-API-12 reads a handover and refuses an identifier it cannot read', async () => {
    const headers = { origin: ORIGIN, cookie: `${BACKOFFICE_SESSION_COOKIE}=session-secret` }
    const read = await routes().fetch(
      new Request(
        `https://api.example.test/backoffice/v1/organizations/${ORGANIZATION_ID}/handover`,
        { headers },
      ),
    )
    const malformed = await routes().fetch(
      new Request('https://api.example.test/backoffice/v1/organizations/not-an-id/handover', {
        headers,
      }),
    )

    expect(read.status).toBe(200)
    await expect(read.json()).resolves.toEqual(handoverResource)
    expect(malformed.status).toBe(400)
  })

  test('T-ORG-API-13 resends and cancels with no body, and refuses one that carries anything', async () => {
    const resend = await routes().fetch(
      post(`/organizations/${ORGANIZATION_ID}/handover/resends`, undefined),
    )
    const cancel = await routes().fetch(
      post(`/organizations/${ORGANIZATION_ID}/cancellation`, '{}'),
    )
    const redirected = await routes().fetch(
      post(
        `/organizations/${ORGANIZATION_ID}/handover/resends`,
        JSON.stringify({ owner_email: 'someone.else@example.test' }),
      ),
    )
    const malformed = await routes().fetch(post('/organizations/not-an-id/cancellation', undefined))

    expect([resend.status, cancel.status, redirected.status, malformed.status]).toEqual([
      200, 200, 422, 400,
    ])
    expect(handoverCalls.map((call) => call.operation)).toEqual(['resend', 'cancel'])
    expect(handoverCalls[0]?.input).toMatchObject({ organizationId: ORGANIZATION_ID })
  })

  test('T-ORG-API-14 maps the lifecycle refusals to their problem responses', async () => {
    const failing = (code: string) =>
      handoverService({
        cancel: () => Promise.reject(Object.assign(new Error('refused'), { code })),
      })
    const answers = await Promise.all(
      ['55000', 'P0002', '42501', '22023', '40001'].map((code) =>
        routes(directoryService(), sessionService(), failing(code)).fetch(
          post(`/organizations/${ORGANIZATION_ID}/cancellation`, undefined),
        ),
      ),
    )

    expect(answers.map((response) => response.status)).toEqual([409, 404, 403, 422, 409])
    expect(answers[4]?.headers.get('retry-after')).toBe('1')
  })

  test('T-ORG-API-15 returns the file the database built, out of any cache', async () => {
    const headers = { origin: ORIGIN, cookie: `${BACKOFFICE_SESSION_COOKIE}=session-secret` }
    const read = await routes().fetch(
      new Request(`https://api.example.test/backoffice/v1/organizations/${ORGANIZATION_ID}`, {
        headers,
      }),
    )
    const answers = await Promise.all(
      [
        'https://api.example.test/backoffice/v1/organizations/not-an-id',
        `https://api.example.test/backoffice/v1/organizations/${ORGANIZATION_ID}?include=names`,
      ].map((url) => routes().fetch(new Request(url, { headers }))),
    )

    expect(read.status).toBe(200)
    expect(read.headers.get('cache-control')).toBe('no-store')
    await expect(read.json()).resolves.toEqual(fileResource)
    expect(fileCalls[0]).toMatchObject({ organizationId: ORGANIZATION_ID })
    expect(answers.map((response) => response.status)).toEqual([400, 400])
    expect(fileCalls).toHaveLength(1)
  })

  test('T-ORG-API-16 turns a missing duty and an unknown gym into their responses', async () => {
    const failing = (code: string) =>
      fileService({ read: () => Promise.reject(Object.assign(new Error('refused'), { code })) })
    const answers = await Promise.all(
      ['42501', 'P0002'].map((code) =>
        routes(directoryService(), sessionService(), handoverService(), failing(code)).fetch(
          new Request(`https://api.example.test/backoffice/v1/organizations/${ORGANIZATION_ID}`, {
            headers: { origin: ORIGIN, cookie: `${BACKOFFICE_SESSION_COOKIE}=session-secret` },
          }),
        ),
      ),
    )

    expect(answers.map((response) => response.status)).toEqual([403, 404])
  })
  test('T-ORG-API-17 sets a quota and passes the number through as it was sent', async () => {
    const app = routes()
    const response = await app.request(post(quotaPath, JSON.stringify({ seats: 50 })))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(quotaResource)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(quotaCalls).toEqual([{ organizationId: ORGANIZATION_ID, decision: { seats: 50 } }])
  })

  test('T-ORG-API-18 carries a deal with no cap as null, and refuses a body that omits it', async () => {
    const app = routes()
    const allowed = await app.request(post(quotaPath, JSON.stringify({ seats: null })))
    expect(allowed.status).toBe(200)
    expect(quotaCalls.at(-1)?.decision).toEqual({ seats: null })

    // A body with no field at all would otherwise be read as "no limit", which is a
    // commercial decision nobody made.
    const omitted = await app.request(post(quotaPath, JSON.stringify({})))
    expect(omitted.status).toBe(422)
    expect(quotaCalls).toHaveLength(1)
  })

  test('T-ORG-API-19 refuses a quota that is not a number of people', async () => {
    const app = routes()
    for (const body of [
      { seats: 0 },
      { seats: -1 },
      { seats: 1.5 },
      { seats: 1000001 },
      { seats: '50' },
      { seats: 50, extra: true },
    ]) {
      const response = await app.request(post(quotaPath, JSON.stringify(body)))
      expect(response.status).toBe(422)
    }
    expect(quotaCalls).toHaveLength(0)
  })

  test('T-ORG-API-20 marks a replayed decision instead of deciding twice', async () => {
    const app = quotaRoutes(quotaService({}, true))
    const response = await app.request(post(quotaPath, JSON.stringify({ seats: 50 })))

    expect(response.status).toBe(200)
    expect(response.headers.get('Idempotent-Replay')).toBe('true')
  })

  test('T-ORG-API-21 requires the trusted origin, the command identifiers and a readable gym', async () => {
    const app = routes()
    const body = JSON.stringify({ seats: 50 })

    const foreign = await app.request(
      post(quotaPath, body, { origin: 'https://evil.example.test' }),
    )
    expect(foreign.status).toBe(403)

    const unkeyed = await app.request(post(quotaPath, body, { 'idempotency-key': null }))
    expect(unkeyed.status).toBe(400)

    const malformed = await app.request(post('/organizations/not-a-uuid/guest-quota', body))
    expect(malformed.status).toBe(400)

    expect(quotaCalls).toHaveLength(0)
  })

  test('T-ORG-API-22 maps a missing commercial duty and a gym that no longer operates', async () => {
    const refusal = (code: string) =>
      quotaRoutes(
        quotaService({
          set: () => Promise.reject(Object.assign(new Error('refused'), { code })),
        }),
      )

    const body = JSON.stringify({ seats: 50 })
    expect((await refusal('42501').request(post(quotaPath, body))).status).toBe(403)
    expect((await refusal('55000').request(post(quotaPath, body))).status).toBe(409)
    expect((await refusal('P0002').request(post(quotaPath, body))).status).toBe(404)
  })

  test('T-ORG-API-23 reads the quota back inside the gym file, beside its occupancy', async () => {
    const app = routes()
    const response = await app.request(get(`/${ORGANIZATION_ID}`))
    const file = (await response.json()) as AllfitV1Schemas['BackofficeOrganizationFile']

    expect(file.guest_quota.seats).toBe(50)
    expect(file.guest_quota.occupied).toBe(3)
    expect(file.guest_quota.places_left).toBe(47)
  })

  test('T-ORG-API-24 stops a gym under a reason from the agreed list', async () => {
    const app = suspensionRoutes(suspensionService())
    const response = await app.request(
      post(suspensionPath, JSON.stringify({ reason_code: 'nonpayment' })),
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as AllfitV1Schemas['OrganizationSuspension']
    expect(body.suspended).toBe(true)
    expect(body.current?.people_blocked).toBe(2)
    expect(suspensionCalls).toEqual([
      { organizationId: ORGANIZATION_ID, reason: 'nonpayment', action: 'suspend' },
    ])
  })

  test('T-ORG-API-25 refuses a reason the platform never agreed to', async () => {
    const app = suspensionRoutes(suspensionService())
    const response = await app.request(
      post(suspensionPath, JSON.stringify({ reason_code: 'because_i_said_so' })),
    )

    expect(response.status).toBe(422)
    expect(suspensionCalls).toHaveLength(0)
  })

  // The reason is the whole body. A second field would be a decision nobody reviewed.
  test('T-ORG-API-26 refuses a body carrying anything besides the reason', async () => {
    const app = suspensionRoutes(suspensionService())
    const response = await app.request(
      post(suspensionPath, JSON.stringify({ reason_code: 'nonpayment', status: 'closed' })),
    )

    expect(response.status).toBe(422)
    expect(suspensionCalls).toHaveLength(0)
  })

  test('T-ORG-API-27 reactivation carries no body and reads the period back closed', async () => {
    const app = suspensionRoutes(suspensionService())
    const response = await app.request(post(reactivationPath, ''))

    expect(response.status).toBe(200)
    const body = (await response.json()) as AllfitV1Schemas['OrganizationSuspension']
    expect(body.suspended).toBe(false)
    expect(body.current).toBeNull()
    // Criterion 8 outliving the state: the gym operates and still says it was stopped.
    expect(body.history[0]?.reason_code).toBe('nonpayment')
    expect(body.history[0]?.ended_by_person_id).toBe(ACTOR_PERSON_ID)
    expect(suspensionCalls).toEqual([{ organizationId: ORGANIZATION_ID, action: 'reactivate' }])
  })

  test('T-ORG-API-28 maps the refusals of both commands to their status codes', async () => {
    const refusal = (code: string) =>
      suspensionRoutes(
        suspensionService({
          suspend: () => Promise.reject(Object.assign(new Error('refused'), { code })),
          reactivate: () => Promise.reject(Object.assign(new Error('refused'), { code })),
        }),
      )

    const body = JSON.stringify({ reason_code: 'nonpayment' })
    expect((await refusal('42501').request(post(suspensionPath, body))).status).toBe(403)
    expect((await refusal('55000').request(post(suspensionPath, body))).status).toBe(409)
    expect((await refusal('P0002').request(post(suspensionPath, body))).status).toBe(404)
    expect((await refusal('22023').request(post(suspensionPath, body))).status).toBe(422)
    expect((await refusal('55000').request(post(reactivationPath, ''))).status).toBe(409)
  })

  test('T-ORG-API-29 a replayed suspension says so in the header', async () => {
    const app = suspensionRoutes(suspensionService({}, true))
    const response = await app.request(
      post(suspensionPath, JSON.stringify({ reason_code: 'nonpayment' })),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Idempotent-Replay')).toBe('true')
  })
})
