import { beforeEach, describe, expect, test } from 'bun:test'
import { allfitV1ContractManifest, type AllfitV1Schemas } from '@allfitone/contracts'
import { Hono } from 'hono'

import { mountSurfaces } from '../../../surfaces.js'
import {
  BackofficeAuthenticationError,
  type BackofficeAuthenticationService,
} from '../../identity/index.js'
import { BACKOFFICE_SESSION_COOKIE } from '../../identity/index.js'
import type { GlobalCatalogueCurationService } from '../application/global-catalogue.js'
import { backofficeGlobalCatalogueRoutes } from './backoffice-global-catalogue.js'

const ORIGIN = 'https://backoffice.example.test'
const ACTOR_PERSON_ID = '019b2000-0000-7000-8000-000000000003'
const ACTOR_SESSION_ID = '019b2000-0000-7000-8000-000000000023'
const MOVEMENT_ID = '019b2000-0000-7000-8000-000000000901'
const IDEMPOTENCY_KEY = 'c0000000-0000-4000-8000-000000000001'
const COMMAND_ID = '019b2000-0000-7000-8000-000000000601'
const OPERATIONS = ['NEW-CAT-GLOBAL-PUBLISH', 'OP-CAT-004', 'OP-CAT-005']

const entry: AllfitV1Schemas['GlobalCatalogueEntry'] = {
  kind: 'discipline',
  id: '019b2000-0000-7000-8000-000000000801',
  code: 'test_global_yoga',
  discipline_code: 'test_global_yoga',
  name: 'Yoga',
  status: 'published',
  created_at: '2026-09-16T12:00:00.000Z',
  in_use_count: 0,
}

const catalogue: AllfitV1Schemas['BackofficeGlobalCatalogue'] = {
  disciplines: [entry],
  activity_types: [],
  movements: [],
  equipment_availability: 'not_modelled',
}

let captured: { operation: string; actor: unknown; input: unknown }[] = []

function curationService(
  overrides: Partial<GlobalCatalogueCurationService> = {},
): GlobalCatalogueCurationService {
  const record = (operation: string) => (actor: unknown, input: unknown) => {
    captured.push({ operation, actor, input })
    return Promise.resolve({ resource: entry, replayed: false })
  }
  return {
    read: (actor, input) => {
      captured.push({ operation: 'read', actor, input })
      return Promise.resolve(catalogue)
    },
    publishDiscipline: record('publishDiscipline'),
    archiveDiscipline: record('archiveDiscipline'),
    publishActivityType: record('publishActivityType'),
    archiveActivityType: record('archiveActivityType'),
    publishMovement: record('publishMovement'),
    archiveMovement: record('archiveMovement'),
    ...overrides,
  } as GlobalCatalogueCurationService
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
  service: GlobalCatalogueCurationService = curationService(),
  sessions: BackofficeAuthenticationService = sessionService(),
): Hono {
  return new Hono().route('/backoffice/v1', backofficeGlobalCatalogueRoutes(service, sessions))
}

function request(
  path: string,
  init: {
    method?: string
    origin?: string
    cookie?: boolean
    headers?: Record<string, string>
    body?: string
  } = {},
): Request {
  const headers = new Headers({ origin: init.origin ?? ORIGIN, ...init.headers })
  if (init.cookie !== false) headers.set('cookie', `${BACKOFFICE_SESSION_COOKIE}=session-secret`)
  return new Request(`https://api.example.test/backoffice/v1${path}`, {
    method: init.method ?? 'GET',
    headers,
    ...(init.body === undefined ? {} : { body: init.body }),
  })
}

function commandRequest(
  path: string,
  body: string,
  overrides: { origin?: string; cookie?: boolean; headers?: Record<string, string> } = {},
): Request {
  return request(path, {
    method: 'POST',
    ...(overrides.origin === undefined ? {} : { origin: overrides.origin }),
    ...(overrides.cookie === undefined ? {} : { cookie: overrides.cookie }),
    headers: {
      'content-type': 'application/json',
      'idempotency-key': IDEMPOTENCY_KEY,
      'command-id': COMMAND_ID,
      ...overrides.headers,
    },
    body,
  })
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

describe('Backoffice global catalogue API contract', () => {
  test('T-CAT-GLOBAL-API-01 mounts the read and the six curation commands', () => {
    const contract = allfitV1ContractManifest.operations
      .filter((operation) => OPERATIONS.includes(operation.allfitOperation))
      .map((operation) => `${operation.method} ${colonPath(operation.path)}`)
      .sort()
    const mounted = backofficeGlobalCatalogueRoutes()
      .routes.filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} /backoffice/v1${route.path}`)
      .sort()

    // OP-CAT-006 publishes result contracts and is served by its own router.
    expect(contract.filter((route) => route.includes('/catalogue'))).toHaveLength(7)
    expect(mounted).toEqual(contract.filter((route) => route.includes('/catalogue')))
  })

  test('T-CAT-GLOBAL-API-02 mounts below the real Backoffice surface prefix', () => {
    const app = new Hono()
    mountSurfaces(app)
    const mounted = app.routes
      .filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path}`)

    expect(mounted).toContain('GET /backoffice/v1/catalogue')
    expect(mounted).toContain('POST /backoffice/v1/catalogue/disciplines')
    expect(mounted).toContain('POST /backoffice/v1/catalogue/disciplines/:code/archival')
    expect(mounted).toContain('POST /backoffice/v1/catalogue/activity-types')
    expect(mounted).toContain('POST /backoffice/v1/catalogue/activity-types/:code/archival')
    expect(mounted).toContain('POST /backoffice/v1/catalogue/movements')
    expect(mounted).toContain('POST /backoffice/v1/catalogue/movements/:movementId/archival')
  })

  test('T-CAT-GLOBAL-API-03 reads the catalogue out of any cache and refuses a filter', async () => {
    const response = await routes().fetch(request('/catalogue'))
    const filtered = await routes().fetch(request('/catalogue?status=archived'))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual(catalogue)
    expect(filtered.status).toBe(400)
    expect(captured).toHaveLength(1)
  })

  test('T-CAT-GLOBAL-API-04 publishes each kind with only the fields the contract declares', async () => {
    const answers = await Promise.all([
      routes().fetch(
        commandRequest(
          '/catalogue/disciplines',
          JSON.stringify({ code: 'test_global_yoga', name: '  Yoga  ' }),
        ),
      ),
      routes().fetch(
        commandRequest(
          '/catalogue/activity-types',
          JSON.stringify({
            discipline_code: 'test_global_yoga',
            code: 'test_global_flow',
            name: 'Flow',
          }),
        ),
      ),
      routes().fetch(
        commandRequest(
          '/catalogue/movements',
          JSON.stringify({ discipline_code: 'test_global_yoga', name: 'Guerrero II' }),
        ),
      ),
    ])

    expect(answers.map((response) => response.status)).toEqual([200, 200, 200])
    expect(captured.map(({ operation }) => operation)).toEqual([
      'publishDiscipline',
      'publishActivityType',
      'publishMovement',
    ])
    // The name is trimmed before it travels, so the same name never publishes twice.
    expect(captured[0]?.input).toMatchObject({
      publication: { code: 'test_global_yoga', name: 'Yoga' },
      idempotencyKey: IDEMPOTENCY_KEY,
      commandId: COMMAND_ID,
    })
    expect(captured[2]?.input).toMatchObject({
      publication: { discipline_code: 'test_global_yoga', name: 'Guerrero II' },
    })
  })

  test('T-CAT-GLOBAL-API-05 refuses a body that would widen a publication', async () => {
    const answers = await Promise.all([
      routes().fetch(
        commandRequest(
          '/catalogue/disciplines',
          JSON.stringify({ code: 'test_global_yoga', name: 'Yoga', status: 'published' }),
        ),
      ),
      routes().fetch(
        commandRequest(
          '/catalogue/activity-types',
          JSON.stringify({
            discipline_code: 'test_global_yoga',
            code: 'test_global_flow',
            name: 'Flow',
            owner_organization_id: '019b2000-0000-7000-8000-000000000801',
          }),
        ),
      ),
      routes().fetch(
        commandRequest(
          '/catalogue/movements',
          JSON.stringify({
            discipline_code: 'test_global_yoga',
            name: 'Guerrero',
            scope: 'global',
          }),
        ),
      ),
      routes().fetch(
        commandRequest('/catalogue/disciplines', JSON.stringify({ code: 'Yoga', name: 'Yoga' })),
      ),
      routes().fetch(
        commandRequest(
          '/catalogue/disciplines',
          JSON.stringify({ code: 'test_global_yoga', name: '   ' }),
        ),
      ),
    ])

    expect(answers.map((response) => response.status)).toEqual([422, 422, 422, 422, 422])
    expect(captured).toEqual([])
  })

  test('T-CAT-GLOBAL-API-06 archives with no body and says when it replays', async () => {
    const answers = await Promise.all([
      routes().fetch(commandRequest('/catalogue/disciplines/test_global_yoga/archival', '{}')),
      routes().fetch(commandRequest('/catalogue/activity-types/test_global_flow/archival', '{}')),
      routes().fetch(commandRequest(`/catalogue/movements/${MOVEMENT_ID}/archival`, '{}')),
    ])
    const withBody = await routes().fetch(
      commandRequest('/catalogue/disciplines/test_global_yoga/archival', '{"cascade":true}'),
    )
    const replay = await routes(
      curationService({ archiveDiscipline: async () => ({ resource: entry, replayed: true }) }),
    ).fetch(commandRequest('/catalogue/disciplines/test_global_yoga/archival', '{}'))

    expect(answers.map((response) => response.status)).toEqual([200, 200, 200])
    expect(withBody.status).toBe(422)
    expect(replay.headers.get('idempotent-replay')).toBe('true')
    expect(captured.map(({ operation }) => operation)).toEqual([
      'archiveDiscipline',
      'archiveActivityType',
      'archiveMovement',
    ])
    expect(captured[2]?.input).toMatchObject({ movementId: MOVEMENT_ID })
  })

  test('T-CAT-GLOBAL-API-07 requires the trusted origin, a JSON body and the command identifiers', async () => {
    const answers = await Promise.all([
      routes().fetch(
        commandRequest('/catalogue/disciplines', JSON.stringify({ code: 'a_b', name: 'A' }), {
          origin: 'https://attacker.test',
        }),
      ),
      routes().fetch(
        commandRequest('/catalogue/disciplines', JSON.stringify({ code: 'a_b', name: 'A' }), {
          headers: { 'content-type': 'text/plain' },
        }),
      ),
      routes().fetch(
        commandRequest('/catalogue/disciplines', JSON.stringify({ code: 'a_b', name: 'A' }), {
          headers: { 'idempotency-key': 'not-a-key' },
        }),
      ),
      routes().fetch(commandRequest('/catalogue/disciplines/Not_A_Code/archival', '{}')),
      routes().fetch(commandRequest('/catalogue/movements/not-a-uuid/archival', '{}')),
    ])

    expect(answers.map((response) => response.status)).toEqual([403, 415, 400, 400, 400])
    expect(captured).toEqual([])
  })

  test('T-CAT-GLOBAL-API-08 maps every declared database verdict to its problem response', async () => {
    const verdicts: [string, number][] = [
      ['P0002', 404],
      ['42501', 403],
      ['55000', 409],
      ['23505', 409],
      ['22023', 422],
      ['40001', 409],
    ]
    const answers = await Promise.all(
      verdicts.map(([sqlState]) =>
        routes(
          curationService({
            publishDiscipline: () =>
              Promise.reject(Object.assign(new Error('refused'), { code: sqlState })),
          }),
        ).fetch(
          commandRequest(
            '/catalogue/disciplines',
            JSON.stringify({ code: 'test_global_yoga', name: 'Yoga' }),
          ),
        ),
      ),
    )
    const broken = await routes(
      curationService({ read: () => Promise.reject(new Error('database unavailable')) }),
    ).fetch(request('/catalogue'))

    expect(answers.map((response) => response.status)).toEqual(verdicts.map(([, status]) => status))
    expect(answers[5]?.headers.get('retry-after')).toBe('1')
    expect(broken.status).toBe(503)
  })

  test('T-CAT-GLOBAL-API-09 never reaches the service without a session that still resolves', async () => {
    const missing = await routes().fetch(request('/catalogue', { cookie: false }))
    const ended = await routes(
      curationService(),
      sessionService({
        resolveActor: async () =>
          Promise.reject(new BackofficeAuthenticationError('unauthenticated')),
      }),
    ).fetch(commandRequest('/catalogue/disciplines', JSON.stringify({ code: 'a_b', name: 'A' })))

    expect([missing.status, ended.status]).toEqual([401, 401])
    expect(captured).toEqual([])
  })
})
