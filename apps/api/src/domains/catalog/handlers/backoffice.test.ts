import { beforeEach, describe, expect, test } from 'bun:test'
import { allfitV1ContractManifest, type AllfitV1Schemas } from '@allfitone/contracts'
import { Hono } from 'hono'

import {
  BACKOFFICE_SESSION_COOKIE,
  BackofficeAuthenticationError,
  type BackofficeAuthenticationService,
} from '../../identity/index.js'
import { mountSurfaces } from '../../../surfaces.js'
import type { ResultContractService } from '../application/index.js'
import { backofficeCatalogRoutes } from './backoffice.js'

const ORIGIN = 'https://backoffice.example.test'
const ACTOR_PERSON_ID = '019f0000-0000-7000-8000-000000000001'
const ACTOR_SESSION_ID = '019f0000-0000-7000-8000-000000000002'
const ACTIVITY_TYPE_ID = '019f0000-0000-7000-8000-000000000003'
const CONTRACT_ID = '019f0000-0000-7000-8000-000000000101'
const IDEMPOTENCY_KEY = '22222222-2222-4222-8222-222222222222'
const COMMAND_ID = '019f0000-0000-7000-8000-000000000301'
const NOW = '2026-09-06T12:00:00.000Z'

const resultContract: AllfitV1Schemas['ResultContract'] = {
  id: CONTRACT_ID,
  contract_code: 'test.backoffice_publication',
  version_number: 1,
  activity_family: 'strength',
  contract_schema_version: 1,
  envelope: { schema: 1 },
  minimums: { target_sets: true },
  status: 'published',
  published_at: NOW,
  fixtures: [
    {
      id: '019f0000-0000-7000-8000-000000000201',
      kind: 'valid',
      payload_schema_version: 1,
      payload: { sets: 2 },
      expected: 'accepted',
    },
    {
      id: '019f0000-0000-7000-8000-000000000202',
      kind: 'invalid',
      payload_schema_version: 1,
      payload: {},
      expected: 'missing_sets',
    },
  ],
  activity_type_bindings: [
    {
      id: '019f0000-0000-7000-8000-000000000401',
      activity_type_id: ACTIVITY_TYPE_ID,
      is_default: true,
      valid_from: NOW,
      valid_to: null,
    },
  ],
}

const publication = {
  contract_code: 'test.backoffice_publication',
  activity_family: 'strength',
  envelope: { schema: 1 },
  minimums: { target_sets: true },
  fixtures: [
    { kind: 'valid', payload: { sets: 2 }, expected: 'accepted' },
    { kind: 'invalid', payload: {}, expected: 'missing_sets' },
  ],
  activity_type_id: ACTIVITY_TYPE_ID,
}

interface CapturedCall {
  operation: string
  input: unknown
}

let captured: CapturedCall[] = []

function contractService(overrides: Partial<ResultContractService> = {}): ResultContractService {
  return {
    publish: (_actor, input) => {
      captured.push({ operation: 'publish', input })
      return Promise.resolve({ resource: resultContract, replayed: false })
    },
    deprecate: (_actor, input) => {
      captured.push({ operation: 'deprecate', input })
      return Promise.resolve({
        resource: { ...resultContract, status: 'deprecated' },
        replayed: false,
      })
    },
    ...overrides,
  } as ResultContractService
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
  contracts: ResultContractService = contractService(),
  sessions: BackofficeAuthenticationService = sessionService(),
): Hono {
  return new Hono().route('/backoffice/v1', backofficeCatalogRoutes(contracts, sessions))
}

function request(
  path: string,
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
  return new Request(`https://api.example.test/backoffice/v1${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(init.body ?? {}),
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

describe('Backoffice catalogue API contract', () => {
  test('T-CAT-API-01 mounts every catalogue curation operation with its contract method', () => {
    const contract = allfitV1ContractManifest.operations
      .filter((operation) => operation.allfitOperation === 'OP-CAT-006')
      .map((operation) => `${operation.method} ${colonPath(operation.path)}`)
      .sort()
    const mounted = backofficeCatalogRoutes()
      .routes.filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} /backoffice/v1${route.path}`)
      .sort()

    expect(mounted).toEqual(contract)
  })

  test('T-CAT-API-02 mounts curation below the real Backoffice surface prefix', () => {
    const app = new Hono()
    mountSurfaces(app)
    const mounted = app.routes
      .filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path}`)

    expect(mounted).toContain('POST /backoffice/v1/result-contracts')
    expect(mounted).toContain('POST /backoffice/v1/result-contracts/:contractId/deprecation')
  })

  test('T-CAT-API-03 publishes a contract and returns its immutable version', async () => {
    const response = await routes().fetch(request('/result-contracts', { body: publication }))

    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual(resultContract)
    expect(captured[0]?.operation).toBe('publish')
    expect(captured[0]?.input).toMatchObject({
      publication: { contract_code: 'test.backoffice_publication', activity_family: 'strength' },
      idempotencyKey: IDEMPOTENCY_KEY,
      commandId: COMMAND_ID,
    })
  })

  test('T-CAT-API-04 never forwards a client-chosen version number', async () => {
    const response = await routes().fetch(
      request('/result-contracts', { body: { ...publication, version_number: 9 } }),
    )

    expect(response.status).toBe(422)
    expect(captured).toHaveLength(0)
  })

  test('T-CAT-API-05 refuses a publication that demonstrates only one outcome', async () => {
    const onlyValid = await routes().fetch(
      request('/result-contracts', {
        body: {
          ...publication,
          fixtures: [
            { kind: 'valid', payload: { sets: 2 }, expected: 'accepted' },
            { kind: 'valid', payload: { sets: 3 }, expected: 'accepted' },
          ],
        },
      }),
    )
    const onlyInvalid = await routes().fetch(
      request('/result-contracts', {
        body: {
          ...publication,
          fixtures: [
            { kind: 'invalid', payload: {}, expected: 'missing_sets' },
            { kind: 'invalid', payload: { sets: 0 }, expected: 'below_minimum' },
          ],
        },
      }),
    )

    expect([onlyValid.status, onlyInvalid.status]).toEqual([422, 422])
    expect(captured).toHaveLength(0)
  })

  test('T-CAT-API-06 refuses a fixture without an expected outcome', async () => {
    const response = await routes().fetch(
      request('/result-contracts', {
        body: {
          ...publication,
          fixtures: [
            { kind: 'valid', payload: { sets: 2 }, expected: '   ' },
            { kind: 'invalid', payload: {}, expected: 'missing_sets' },
          ],
        },
      }),
    )

    expect(response.status).toBe(422)
    expect(captured).toHaveLength(0)
  })

  test('T-CAT-API-07 refuses a contract code or family outside the closed vocabulary', async () => {
    const badCode = await routes().fetch(
      request('/result-contracts', { body: { ...publication, contract_code: 'Test Strength' } }),
    )
    const badFamily = await routes().fetch(
      request('/result-contracts', { body: { ...publication, activity_family: 'yoga' } }),
    )

    expect([badCode.status, badFamily.status]).toEqual([422, 422])
    expect(captured).toHaveLength(0)
  })

  test('T-CAT-API-08 deprecates a contract without accepting a payload', async () => {
    const app = routes()
    const deprecated = await app.fetch(request(`/result-contracts/${CONTRACT_ID}/deprecation`))
    const withPayload = await app.fetch(
      request(`/result-contracts/${CONTRACT_ID}/deprecation`, { body: { reason: 'because' } }),
    )

    expect(deprecated.status).toBe(200)
    expect(await deprecated.json()).toMatchObject({ status: 'deprecated' })
    expect(withPayload.status).toBe(422)
    expect(captured).toHaveLength(1)
    expect(captured[0]?.input).toMatchObject({ contractId: CONTRACT_ID })
  })

  test('T-CAT-API-09 keeps curation closed to another origin and to no session', async () => {
    const app = routes()
    const foreign = await app.fetch(
      request('/result-contracts', { body: publication, origin: 'https://attacker.example.test' }),
    )
    const anonymous = await app.fetch(
      request('/result-contracts', { body: publication, cookie: false }),
    )

    expect([foreign.status, anonymous.status]).toEqual([403, 401])
    expect(captured).toHaveLength(0)
  })

  test('T-CAT-API-10 requires both command identifiers and the JSON representation', async () => {
    const app = routes()
    const noKey = await app.fetch(
      request('/result-contracts', { body: publication, idempotencyKey: '' }),
    )
    const wrongMedia = await app.fetch(
      request('/result-contracts', { body: publication, contentType: 'text/plain' }),
    )

    expect([noKey.status, wrongMedia.status]).toEqual([400, 415])
    expect(captured).toHaveLength(0)
  })

  test('T-CAT-API-11 maps the published-content guard to a conflict', async () => {
    const cases: Array<{ sqlState: string; status: number }> = [
      { sqlState: '55000', status: 409 },
      { sqlState: '42501', status: 403 },
      { sqlState: 'P0002', status: 404 },
      { sqlState: '22023', status: 422 },
      { sqlState: '40001', status: 409 },
    ]

    for (const { sqlState, status } of cases) {
      const failure = Object.assign(new Error('database rejected the command'), { code: sqlState })
      const response = await routes(
        contractService({ publish: () => Promise.reject(failure) }),
      ).fetch(request('/result-contracts', { body: publication }))

      expect({ sqlState, status: response.status }).toEqual({ sqlState, status })
      expect(response.headers.get('content-type')).toContain('application/problem+json')
    }
  })

  test('T-CAT-API-12 answers unauthenticated when the session stops resolving', async () => {
    const response = await routes(
      contractService(),
      sessionService({
        resolveActor: () => Promise.reject(new BackofficeAuthenticationError('unauthenticated')),
      }),
    ).fetch(request('/result-contracts', { body: publication }))

    expect(response.status).toBe(401)
    expect(captured).toHaveLength(0)
  })

  test('T-CAT-IDEM-01 marks a replay and binds the hash to the publication', async () => {
    const hashes: Uint8Array[] = []
    const app = routes(
      contractService({
        publish: (_actor, input) => {
          hashes.push(input.requestHash)
          return Promise.resolve({ resource: resultContract, replayed: true })
        },
      }),
    )

    const first = await app.fetch(request('/result-contracts', { body: publication }))
    const reordered = await app.fetch(
      request('/result-contracts', {
        body: {
          activity_type_id: publication.activity_type_id,
          fixtures: publication.fixtures,
          minimums: publication.minimums,
          envelope: publication.envelope,
          activity_family: publication.activity_family,
          contract_code: publication.contract_code,
        },
      }),
    )
    const different = await app.fetch(
      request('/result-contracts', {
        body: { ...publication, minimums: { target_sets: false } },
      }),
    )

    expect(first.headers.get('idempotent-replay')).toBe('true')
    expect(reordered.status).toBe(201)
    const [a, b, c] = hashes.map((hash) => Buffer.from(hash).toString('hex'))
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(different.status).toBe(201)
  })
})
