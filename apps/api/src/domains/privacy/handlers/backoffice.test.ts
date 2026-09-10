import { beforeEach, describe, expect, test } from 'bun:test'
import { allfitV1ContractManifest, type AllfitV1Schemas } from '@allfitone/contracts'
import { Hono } from 'hono'

import {
  BACKOFFICE_SESSION_COOKIE,
  BackofficeAuthenticationError,
  type BackofficeAuthenticationService,
} from '../../identity/index.js'
import { mountSurfaces } from '../../../surfaces.js'
import type { ScopeDefinitionService } from '../application/index.js'
import { backofficePrivacyRoutes } from './backoffice.js'

const ORIGIN = 'https://backoffice.example.test'
const ACTOR_PERSON_ID = '019a7000-0000-7000-8000-000000000003'
const ACTOR_SESSION_ID = '019a7000-0000-7000-8000-000000000023'
const IDEMPOTENCY_KEY = '11111111-1111-4111-8111-111111111102'
const COMMAND_ID = '019a7000-0000-7000-8000-000000000302'

const definition: AllfitV1Schemas['ScopeDefinition'] = {
  id: '019a7000-0000-7000-8000-000000000401',
  scope_code: 'body_progress',
  version_number: 1,
  status: 'published',
  published_at: '2026-09-10T18:00:00.000Z',
  rules: [
    {
      resource: 'execution.body_measurements',
      field: 'weight_kg',
      data_classification_code: 'body',
      max_action: 'read',
      is_excluded: false,
      historical_readable: true,
    },
  ],
}

const publication = {
  scope_code: 'body_progress',
  rules: [
    {
      resource: 'execution.body_measurements',
      field: 'weight_kg',
      data_classification_code: 'body',
      max_action: 'read',
      historical_readable: true,
    },
    {
      resource: 'nutrition.intake_entries',
      field: '*',
      data_classification_code: 'nutrition',
      max_action: 'read',
      is_excluded: true,
    },
  ],
}

let captured: unknown[] = []

function scopeService(overrides: Partial<ScopeDefinitionService> = {}): ScopeDefinitionService {
  return {
    publish: (_curator, input) => {
      captured.push(input)
      return Promise.resolve({ resource: definition, replayed: false })
    },
    list: (_curator, input) => {
      captured.push(input)
      return Promise.resolve([definition])
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
  scopes: ScopeDefinitionService = scopeService(),
  sessions: BackofficeAuthenticationService = sessionService(),
): Hono {
  return new Hono().route('/backoffice/v1', backofficePrivacyRoutes(scopes, sessions))
}

function post(
  init: {
    body?: unknown
    origin?: string
    cookie?: boolean
    idempotencyKey?: string
    commandId?: string
    contentType?: string | null
  } = {},
): Request {
  const headers = new Headers({ origin: init.origin ?? ORIGIN })
  if (init.contentType !== null) headers.set('content-type', init.contentType ?? 'application/json')
  if (init.cookie !== false) headers.set('cookie', `${BACKOFFICE_SESSION_COOKIE}=session-secret`)
  if (init.idempotencyKey !== '') {
    headers.set('idempotency-key', init.idempotencyKey ?? IDEMPOTENCY_KEY)
  }
  if (init.commandId !== '') headers.set('command-id', init.commandId ?? COMMAND_ID)
  return new Request('https://api.example.test/backoffice/v1/scope-definitions', {
    method: 'POST',
    headers,
    body: JSON.stringify(init.body ?? publication),
  })
}

function get(init: { cookie?: boolean } = {}): Request {
  const headers = new Headers({ origin: ORIGIN })
  if (init.cookie !== false) headers.set('cookie', `${BACKOFFICE_SESSION_COOKIE}=session-secret`)
  return new Request('https://api.example.test/backoffice/v1/scope-definitions', { headers })
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

describe('Backoffice privacy API contract', () => {
  test('T-PRV-API-01 mounts every OP-PRV-011 operation with its contract method', () => {
    const contract = allfitV1ContractManifest.operations
      .filter((operation) => operation.allfitOperation === 'OP-PRV-011')
      .map((operation) => `${operation.method} ${colonPath(operation.path)}`)
      .sort()
    const mounted = backofficePrivacyRoutes()
      .routes.filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} /backoffice/v1${route.path}`)
      .sort()

    expect(contract).toHaveLength(2)
    expect(mounted).toEqual(contract)
  })

  test('T-PRV-API-02 mounts privacy below the real Backoffice surface prefix', () => {
    const app = new Hono()
    mountSurfaces(app)
    const mounted = app.routes
      .filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path}`)

    expect(mounted).toContain('GET /backoffice/v1/scope-definitions')
    expect(mounted).toContain('POST /backoffice/v1/scope-definitions')
  })

  test('T-PRV-API-03 publishes a version and never proposes its number', async () => {
    const response = await routes().fetch(post())

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual(definition)
    expect(captured[0]).toMatchObject({ publication: { scope_code: 'body_progress' } })
    // The version number is the server's to assign.
    expect(JSON.stringify(captured[0])).not.toContain('version_number')
  })

  test('T-PRV-API-04 normalises both flags instead of letting omission decide', async () => {
    await routes().fetch(post())

    const sent = captured[0] as { publication: { rules: Record<string, unknown>[] } }
    for (const rule of sent.publication.rules) {
      expect(typeof rule.is_excluded).toBe('boolean')
      expect(typeof rule.historical_readable).toBe('boolean')
    }
  })

  test('T-PRV-API-05 refuses a version that includes nothing', async () => {
    const onlyExclusions = await routes().fetch(
      post({
        body: {
          scope_code: 'body_progress',
          rules: [
            {
              resource: 'nutrition.intake_entries',
              field: '*',
              data_classification_code: 'nutrition',
              max_action: 'read',
              is_excluded: true,
            },
          ],
        },
      }),
    )
    const empty = await routes().fetch(post({ body: { scope_code: 'body_progress', rules: [] } }))

    expect([onlyExclusions.status, empty.status]).toEqual([422, 422])
    expect(captured).toEqual([])
  })

  test('T-PRV-API-06 refuses anything outside the closed vocabularies', async () => {
    const bodies = [
      { scope_code: 'invented_scope', rules: publication.rules },
      {
        scope_code: 'body_progress',
        rules: [{ ...publication.rules[0], data_classification_code: 'invented' }],
      },
      { scope_code: 'body_progress', rules: [{ ...publication.rules[0], max_action: 'delete' }] },
      {
        scope_code: 'body_progress',
        rules: [{ ...publication.rules[0], resource: 'Not A Resource' }],
      },
    ]
    const answers = await Promise.all(bodies.map((body) => routes().fetch(post({ body }))))

    expect(answers.map((response) => response.status)).toEqual([422, 422, 422, 422])
    expect(captured).toEqual([])
  })

  test('T-PRV-API-07 refuses a historical read on something the scope excludes', async () => {
    const response = await routes().fetch(
      post({
        body: {
          scope_code: 'body_progress',
          rules: [
            { ...publication.rules[0], is_excluded: true, historical_readable: true },
            publication.rules[0],
          ],
        },
      }),
    )

    expect(response.status).toBe(422)
    expect(captured).toEqual([])
  })

  test('T-PRV-API-08 requires both command identifiers in their contract formats', async () => {
    const answers = await Promise.all([
      routes().fetch(post({ idempotencyKey: '' })),
      routes().fetch(post({ commandId: '' })),
      routes().fetch(post({ idempotencyKey: COMMAND_ID })),
      routes().fetch(post({ commandId: IDEMPOTENCY_KEY })),
    ])

    expect(answers.map((response) => response.status)).toEqual([400, 400, 400, 400])
    expect(captured).toEqual([])
  })

  test('T-PRV-API-09 refuses a publication from another origin before doing any work', async () => {
    const response = await routes().fetch(post({ origin: 'https://attacker.test' }))

    expect(response.status).toBe(403)
    expect(captured).toEqual([])
  })

  test('T-PRV-API-10 marks a replayed command instead of publishing twice', async () => {
    const response = await routes(
      scopeService({
        publish: () => Promise.resolve({ resource: definition, replayed: true }),
      }),
    ).fetch(post())

    expect(response.status).toBe(201)
    expect(response.headers.get('idempotent-replay')).toBe('true')
  })

  test('T-PRV-API-11 answers the immutability guard as a conflict, not a bad request', async () => {
    const verdicts: [string, number][] = [
      ['55000', 409],
      ['42501', 403],
      ['22023', 422],
      ['40001', 409],
    ]
    const answers = await Promise.all(
      verdicts.map(([sqlState]) =>
        routes(
          scopeService({
            publish: () => Promise.reject(Object.assign(new Error('refused'), { code: sqlState })),
          }),
        ).fetch(post()),
      ),
    )

    expect(answers.map((response) => response.status)).toEqual(verdicts.map(([, status]) => status))
    expect(answers[3]?.headers.get('retry-after')).toBe('1')
  })

  test('T-PRV-API-12 lists what is published and keeps it out of any cache', async () => {
    const response = await routes().fetch(get())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ items: [definition] })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  test('T-PRV-API-13 answers unauthenticated without a session and when it ended', async () => {
    const missing = await routes().fetch(get({ cookie: false }))
    const ended = await routes(
      scopeService(),
      sessionService({
        resolveActor: async () =>
          Promise.reject(new BackofficeAuthenticationError('unauthenticated')),
      }),
    ).fetch(get())

    expect([missing.status, ended.status]).toEqual([401, 401])
    expect(captured).toEqual([])
  })
})
