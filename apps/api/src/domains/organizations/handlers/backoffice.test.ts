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
  plans_availability: 'not_modelled',
  payment_method_availability: 'not_modelled',
  premium_availability: 'not_modelled',
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
): Hono {
  return new Hono().route(
    '/backoffice/v1',
    backofficeOrganizationRoutes(directory, sessions, handover, file),
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
  process.env.BACKOFFICE_WEB_URL = ORIGIN
  process.env.STUDIO_WEB_URL = 'https://studio.example.test'
  process.env.API_PUBLIC_URL = 'https://api.example.test'
})

describe('Backoffice organization API contract', () => {
  test('T-ORG-API-01 mounts every Backoffice organization operation with its contract method', () => {
    // A gym's team and client invitations live under this path but belong to identity,
    // which mounts them.
    const identityOwned = ['NEW-IDN-RESEND', 'OP-IDN-045', 'NEW-IDN-CLIENT-RESEND', 'OP-IDN-051']
    const contract = allfitV1ContractManifest.operations
      .filter((operation) => operation.path.startsWith('/backoffice/v1/organizations'))
      .filter((operation) => !identityOwned.includes(operation.allfitOperation))
      .map((operation) => `${operation.method} ${colonPath(operation.path)}`)
      .sort()
    const mounted = backofficeOrganizationRoutes()
      .routes.filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} /backoffice/v1${route.path}`)
      .sort()

    expect(contract).toHaveLength(6)
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
})
