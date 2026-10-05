import { beforeEach, describe, expect, test } from 'bun:test'
import type { VerifiedToken } from '@allfitone/auth-provider'
import { allfitV1ContractManifest, type AllfitV1Schemas } from '@allfitone/contracts'
import { Hono } from 'hono'

import { mountSurfaces } from '../../../surfaces.js'
import type { HealthContextService } from '../application/health-context.js'
import { spaceHealthContextRoutes } from './space-health-context.js'

const CLAIM_ID = '019b6000-0000-7000-8000-000000000501'
const CASE_ID = '019b6000-0000-7000-8000-000000000901'
const IDEMPOTENCY_KEY = 'a0000000-0000-4000-8000-000000000601'
const OPERATIONS = ['OP-IDN-008', 'OP-IDN-049', 'OP-IDN-050']

const claim: AllfitV1Schemas['HealthContextClaim'] = {
  id: CLAIM_ID,
  context_type: 'pain',
  description: 'Me duele la rodilla al bajar escaleras',
  body_area: 'knee',
  provenance: 'person_declared',
  valid_from: '2026-09-06T10:00:00.000Z',
  valid_to: null,
  recorded_at: '2026-09-16T12:00:00.000Z',
}

const token = { subject: 'user_subject', sessionId: 'session_1' } as unknown as VerifiedToken

let captured: { operation: string; token: unknown; input: unknown }[] = []

function healthService(overrides: Partial<HealthContextService> = {}): HealthContextService {
  return {
    list: (verifiedToken, input) => {
      captured.push({ operation: 'list', token: verifiedToken, input })
      return Promise.resolve({ items: [claim], has_more: false })
    },
    declare: (verifiedToken, input) => {
      captured.push({ operation: 'declare', token: verifiedToken, input })
      return Promise.resolve({ resource: claim, replayed: false })
    },
    delete: (verifiedToken, input) => {
      captured.push({ operation: 'delete', token: verifiedToken, input })
      return Promise.resolve({
        resource: {
          health_context_claim_id: CLAIM_ID,
          disposition_case_id: CASE_ID,
          status: 'deleted',
        },
        replayed: false,
      })
    },
    ...overrides,
  }
}

function routes(
  service: HealthContextService = healthService(),
  verify: (value: string) => Promise<VerifiedToken> = async (value) => {
    if (value !== 'good-token') throw new Error('rejected')
    return token
  },
): Hono {
  return new Hono().route('/space/v1', spaceHealthContextRoutes(service, verify))
}

function request(
  path: string,
  init: {
    method?: string
    bearer?: string | null
    headers?: Record<string, string>
    body?: string
  } = {},
): Request {
  const headers = new Headers(init.headers)
  if (init.bearer !== null) headers.set('authorization', `Bearer ${init.bearer ?? 'good-token'}`)
  return new Request(`https://api.example.test/space/v1${path}`, {
    method: init.method ?? 'GET',
    headers,
    ...(init.body === undefined ? {} : { body: init.body }),
  })
}

function command(
  path: string,
  method: 'POST' | 'DELETE',
  body?: unknown,
  headers: Record<string, string> = {},
): Request {
  return request(path, {
    method,
    headers: {
      'idempotency-key': IDEMPOTENCY_KEY,
      'command-id': CLAIM_ID,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  })
}

function colonPath(path: string): string {
  return path.replace(/\{([A-Za-z0-9_]+)\}/g, ':$1')
}

const declaration = {
  context_type: 'pain',
  description: '  Me duele la rodilla al bajar escaleras ',
  body_area: 'knee',
  valid_from: '2026-09-06T10:00:00.000Z',
}

beforeEach(() => {
  captured = []
  process.env.BACKOFFICE_WEB_URL = 'https://backoffice.example.test'
  process.env.STUDIO_WEB_URL = 'https://studio.example.test'
  process.env.API_PUBLIC_URL = 'https://api.example.test'
})

describe('Space health context API contract', () => {
  test('T-IDN-HEALTH-API-01 mounts the read and both commands with their contract methods', () => {
    const contract = allfitV1ContractManifest.operations
      .filter((operation) => OPERATIONS.includes(operation.allfitOperation))
      .map((operation) => `${operation.method} ${colonPath(operation.path)}`)
      .sort()
    const mounted = spaceHealthContextRoutes(healthService())
      .routes.filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} /space/v1${route.path}`)
      .sort()

    expect(contract).toHaveLength(3)
    expect(mounted).toEqual(contract)
  })

  test('T-IDN-HEALTH-API-02 mounts below the real Space surface prefix', () => {
    const app = new Hono()
    mountSurfaces(app)
    const mounted = app.routes
      .filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path}`)

    expect(mounted).toContain('GET /space/v1/health-context')
    expect(mounted).toContain('POST /space/v1/health-context')
    expect(mounted).toContain('DELETE /space/v1/health-context/:claimId')
  })

  test('T-IDN-HEALTH-API-03 declares a claim under the command that names it', async () => {
    const response = await routes().fetch(command('/health-context', 'POST', declaration))

    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual(claim)
    expect(captured[0]?.token).toBe(token)
    // Absent optional fields travel as null, so a retry hashes the same either way.
    expect(captured[0]?.input).toMatchObject({
      claimId: CLAIM_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      claim: {
        context_type: 'pain',
        description: '  Me duele la rodilla al bajar escaleras ',
        body_area: 'knee',
        valid_from: '2026-09-06T10:00:00.000Z',
        valid_to: null,
      },
    })
  })

  test('T-IDN-HEALTH-API-04 hashes an omitted optional field like an explicit null', async () => {
    const omitted = {
      context_type: 'limitation',
      description: 'No puedo correr',
      valid_from: declaration.valid_from,
    }
    await routes().fetch(command('/health-context', 'POST', omitted))
    await routes().fetch(
      command('/health-context', 'POST', { ...omitted, body_area: null, valid_to: null }),
    )

    const hashes = captured.map(({ input }) =>
      Buffer.from((input as { requestHash: Uint8Array }).requestHash).toString('hex'),
    )
    expect(hashes).toHaveLength(2)
    expect(hashes[0]).toBe(hashes[1])
  })

  test('T-IDN-HEALTH-API-05 refuses a claim whose shape the database would refuse anyway', async () => {
    const bodies: unknown[] = [
      { ...declaration, context_type: 'diagnosis' },
      { ...declaration, description: '   ' },
      { ...declaration, description: 'a'.repeat(501) },
      { ...declaration, description: 42 },
      { ...declaration, body_area: 'left_pinky_toe' },
      { ...declaration, valid_from: '2026-09-06' },
      { ...declaration, valid_to: 'tomorrow' },
      { ...declaration, diagnosis_code: 'M22.4' },
      { context_type: 'pain', description: 'Molestia' },
      '{not json',
    ]
    const answers = await Promise.all(
      bodies.map((body) => routes().fetch(command('/health-context', 'POST', body))),
    )

    expect(answers.map((response) => response.status)).toEqual(bodies.map(() => 422))
    expect(captured).toEqual([])
  })

  test('T-IDN-HEALTH-API-06 requires a JSON body and the command identifiers', async () => {
    const answers = await Promise.all([
      routes().fetch(
        command('/health-context', 'POST', declaration, { 'content-type': 'text/plain' }),
      ),
      routes().fetch(
        command('/health-context', 'POST', declaration, { 'idempotency-key': 'nope' }),
      ),
      routes().fetch(
        command('/health-context', 'POST', declaration, {
          'command-id': 'a0000000-0000-4000-8000-000000000501',
        }),
      ),
    ])

    expect(answers.map((response) => response.status)).toEqual([415, 400, 400])
    expect(captured).toEqual([])
  })

  test('T-IDN-HEALTH-API-07 reads my claims a page at a time', async () => {
    const first = await routes().fetch(request('/health-context?limit=20'))
    const cursor = encodeURIComponent('2026-09-06T10:00:00.000Z')
    const next = await routes().fetch(
      request(`/health-context?before_valid_from=${cursor}&before_id=${CLAIM_ID}`),
    )
    const refused = await Promise.all(
      [
        '/health-context?limit=0',
        '/health-context?limit=201',
        `/health-context?before_valid_from=${cursor}`,
        `/health-context?before_id=${CLAIM_ID}`,
        `/health-context?before_valid_from=yesterday&before_id=${CLAIM_ID}`,
        '/health-context?person_id=someone',
      ].map((path) => routes().fetch(request(path))),
    )

    expect([first.status, next.status]).toEqual([200, 200])
    await expect(first.json()).resolves.toEqual({ items: [claim], has_more: false })
    expect(captured.map(({ input }) => input)).toEqual([
      { limit: 20 },
      { limit: 50, beforeValidFrom: '2026-09-06T10:00:00.000Z', beforeId: CLAIM_ID },
    ])
    expect(refused.map((response) => response.status)).toEqual([400, 400, 400, 400, 400, 400])
  })

  test('T-IDN-HEALTH-API-08 deletes a claim with no body, and says when it replays', async () => {
    const deleted = await routes().fetch(command(`/health-context/${CLAIM_ID}`, 'DELETE'))
    const replay = await routes(
      healthService({
        delete: async () => ({
          resource: {
            health_context_claim_id: CLAIM_ID,
            disposition_case_id: CASE_ID,
            status: 'deleted',
          },
          replayed: true,
        }),
      }),
    ).fetch(command(`/health-context/${CLAIM_ID}`, 'DELETE'))
    const malformed = await routes().fetch(command('/health-context/not-an-id', 'DELETE'))

    expect([deleted.status, replay.status, malformed.status]).toEqual([200, 200, 400])
    await expect(deleted.json()).resolves.toEqual({
      health_context_claim_id: CLAIM_ID,
      disposition_case_id: CASE_ID,
      status: 'deleted',
    })
    expect(replay.headers.get('idempotent-replay')).toBe('true')
    expect(captured[0]?.input).toMatchObject({ claimId: CLAIM_ID, commandId: CLAIM_ID })
  })

  test('T-IDN-HEALTH-API-09 maps every declared database verdict to its problem response', async () => {
    const verdicts: [string, number][] = [
      ['P0002', 404],
      ['42501', 403],
      ['22023', 422],
      ['23505', 409],
      ['55000', 409],
      ['40001', 409],
      ['AF410', 410],
    ]
    const answers = await Promise.all(
      verdicts.map(([sqlState]) =>
        routes(
          healthService({
            declare: () => Promise.reject(Object.assign(new Error('refused'), { code: sqlState })),
          }),
        ).fetch(command('/health-context', 'POST', declaration)),
      ),
    )
    const broken = await routes(
      healthService({ list: () => Promise.reject(new Error('database unavailable')) }),
    ).fetch(request('/health-context'))

    expect(answers.map((response) => response.status)).toEqual(verdicts.map(([, status]) => status))
    expect(answers[1]?.headers.get('content-type')).toContain('application/problem+json')
    expect(answers[5]?.headers.get('retry-after')).toBe('1')
    expect(broken.status).toBe(503)
  })

  test('T-IDN-HEALTH-API-10 never reaches the service without a token it can verify', async () => {
    const answers = await Promise.all([
      routes().fetch(request('/health-context', { bearer: null })),
      routes().fetch(request('/health-context', { bearer: 'forged' })),
      routes().fetch(
        request(`/health-context/${CLAIM_ID}`, {
          method: 'DELETE',
          bearer: 'forged',
          headers: { 'idempotency-key': IDEMPOTENCY_KEY, 'command-id': CLAIM_ID },
        }),
      ),
    ])

    expect(answers.map((response) => response.status)).toEqual([401, 401, 401])
    expect(captured).toEqual([])
  })
})
