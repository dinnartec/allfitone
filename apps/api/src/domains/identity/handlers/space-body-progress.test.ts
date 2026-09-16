import { beforeEach, describe, expect, test } from 'bun:test'
import type { VerifiedToken } from '@allfitone/auth-provider'
import { allfitV1ContractManifest, type AllfitV1Schemas } from '@allfitone/contracts'
import { Hono } from 'hono'

import { mountSurfaces } from '../../../surfaces.js'
import type { BodyProgressService } from '../application/body-progress.js'
import { spaceBodyProgressRoutes } from './space-body-progress.js'

const RECORD_ID = '019b5000-0000-7000-8000-000000000501'
const CASE_ID = '019b5000-0000-7000-8000-000000000901'
const IDEMPOTENCY_KEY = 'a0000000-0000-4000-8000-000000000501'
const OPERATIONS = ['OP-IDN-006', 'OP-IDN-007', 'OP-IDN-015']

const record: AllfitV1Schemas['BodyProgressRecord'] = {
  id: RECORD_ID,
  metric_code: 'weight',
  value: 80,
  unit_code: 'kg',
  original_value: 176.37,
  original_unit_code: 'lb',
  measured_on: '2026-09-15',
  has_media: false,
  recorded_at: '2026-09-15T12:00:00.000Z',
}

const token = { subject: 'user_subject', sessionId: 'session_1' } as unknown as VerifiedToken

let captured: { operation: string; token: unknown; input: unknown }[] = []

function bodyService(overrides: Partial<BodyProgressService> = {}): BodyProgressService {
  return {
    list: (verifiedToken, input) => {
      captured.push({ operation: 'list', token: verifiedToken, input })
      return Promise.resolve({ items: [record], has_more: false })
    },
    record: (verifiedToken, input) => {
      captured.push({ operation: 'record', token: verifiedToken, input })
      return Promise.resolve({ resource: record, replayed: false })
    },
    delete: (verifiedToken, input) => {
      captured.push({ operation: 'delete', token: verifiedToken, input })
      return Promise.resolve({
        resource: {
          body_progress_record_id: RECORD_ID,
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
  service: BodyProgressService = bodyService(),
  verify: (value: string) => Promise<VerifiedToken> = async (value) => {
    if (value !== 'good-token') throw new Error('rejected')
    return token
  },
): Hono {
  return new Hono().route('/space/v1', spaceBodyProgressRoutes(service, verify))
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
      'command-id': RECORD_ID,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  })
}

function colonPath(path: string): string {
  return path.replace(/\{([A-Za-z0-9_]+)\}/g, ':$1')
}

const measurement = {
  metric_code: 'weight',
  value: 176.37,
  unit_code: 'lb',
  measured_on: '2026-09-15',
}

beforeEach(() => {
  captured = []
  process.env.BACKOFFICE_WEB_URL = 'https://backoffice.example.test'
  process.env.STUDIO_WEB_URL = 'https://studio.example.test'
  process.env.API_PUBLIC_URL = 'https://api.example.test'
})

describe('Space body progress API contract', () => {
  test('T-IDN-BODY-API-01 mounts the read and both commands with their contract methods', () => {
    const contract = allfitV1ContractManifest.operations
      .filter((operation) => OPERATIONS.includes(operation.allfitOperation))
      .map((operation) => `${operation.method} ${colonPath(operation.path)}`)
      .sort()
    const mounted = spaceBodyProgressRoutes(bodyService())
      .routes.filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} /space/v1${route.path}`)
      .sort()

    expect(contract).toHaveLength(3)
    expect(mounted).toEqual(contract)
  })

  test('T-IDN-BODY-API-02 mounts below the real Space surface prefix', () => {
    const app = new Hono()
    mountSurfaces(app)
    const mounted = app.routes
      .filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path}`)

    expect(mounted).toContain('GET /space/v1/body-progress')
    expect(mounted).toContain('POST /space/v1/body-progress')
    expect(mounted).toContain('DELETE /space/v1/body-progress/:recordId')
  })

  test('T-IDN-BODY-API-03 records a measurement under the command that names it', async () => {
    const response = await routes().fetch(command('/body-progress', 'POST', measurement))

    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual(record)
    expect(captured[0]?.token).toBe(token)
    expect(captured[0]?.input).toMatchObject({
      recordId: RECORD_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      measurement: {
        metric_code: 'weight',
        value: 176.37,
        unit_code: 'lb',
        measured_on: '2026-09-15',
      },
    })
  })

  test('T-IDN-BODY-API-04 refuses a measurement whose shape the database would refuse anyway', async () => {
    const bodies: unknown[] = [
      { ...measurement, metric_code: 'shoe_size' },
      { ...measurement, unit_code: 'stone' },
      { ...measurement, value: 0 },
      { ...measurement, value: '80' },
      { ...measurement, measured_on: '15/09/2026' },
      { ...measurement, media_ref: 'photos/1' },
      { metric_code: 'weight', value: 80, unit_code: 'kg' },
      '{not json',
    ]
    const answers = await Promise.all(
      bodies.map((body) => routes().fetch(command('/body-progress', 'POST', body))),
    )

    expect(answers.map((response) => response.status)).toEqual(bodies.map(() => 422))
    expect(captured).toEqual([])
  })

  test('T-IDN-BODY-API-05 requires a JSON body and the command identifiers', async () => {
    const answers = await Promise.all([
      routes().fetch(
        command('/body-progress', 'POST', measurement, { 'content-type': 'text/plain' }),
      ),
      routes().fetch(command('/body-progress', 'POST', measurement, { 'idempotency-key': 'nope' })),
      routes().fetch(
        command('/body-progress', 'POST', measurement, {
          'command-id': 'a0000000-0000-4000-8000-000000000501',
        }),
      ),
    ])

    expect(answers.map((response) => response.status)).toEqual([415, 400, 400])
    expect(captured).toEqual([])
  })

  test('T-IDN-BODY-API-06 reads my measurements a page at a time', async () => {
    const first = await routes().fetch(request('/body-progress?limit=20'))
    const next = await routes().fetch(
      request(`/body-progress?before_measured_on=2026-09-15&before_id=${RECORD_ID}`),
    )
    const refused = await Promise.all(
      [
        '/body-progress?limit=0',
        '/body-progress?limit=201',
        '/body-progress?before_measured_on=2026-09-15',
        `/body-progress?before_id=${RECORD_ID}`,
        '/body-progress?person_id=someone',
      ].map((path) => routes().fetch(request(path))),
    )

    expect([first.status, next.status]).toEqual([200, 200])
    await expect(first.json()).resolves.toEqual({ items: [record], has_more: false })
    expect(captured.map(({ input }) => input)).toEqual([
      { limit: 20 },
      { limit: 50, beforeMeasuredOn: '2026-09-15', beforeId: RECORD_ID },
    ])
    expect(refused.map((response) => response.status)).toEqual([400, 400, 400, 400, 400])
  })

  test('T-IDN-BODY-API-07 deletes a measurement with no body, and says when it replays', async () => {
    const deleted = await routes().fetch(command(`/body-progress/${RECORD_ID}`, 'DELETE'))
    const replay = await routes(
      bodyService({
        delete: async () => ({
          resource: {
            body_progress_record_id: RECORD_ID,
            disposition_case_id: CASE_ID,
            status: 'deleted',
          },
          replayed: true,
        }),
      }),
    ).fetch(command(`/body-progress/${RECORD_ID}`, 'DELETE'))
    const malformed = await routes().fetch(command('/body-progress/not-an-id', 'DELETE'))

    expect([deleted.status, replay.status, malformed.status]).toEqual([200, 200, 400])
    await expect(deleted.json()).resolves.toEqual({
      body_progress_record_id: RECORD_ID,
      disposition_case_id: CASE_ID,
      status: 'deleted',
    })
    expect(replay.headers.get('idempotent-replay')).toBe('true')
    expect(captured[0]?.input).toMatchObject({ recordId: RECORD_ID, commandId: RECORD_ID })
  })

  test('T-IDN-BODY-API-08 maps every declared database verdict to its problem response', async () => {
    const verdicts: [string, number][] = [
      ['P0002', 404],
      ['42501', 403],
      ['22023', 422],
      ['23505', 409],
      ['55000', 409],
      ['40001', 409],
    ]
    const answers = await Promise.all(
      verdicts.map(([sqlState]) =>
        routes(
          bodyService({
            delete: () => Promise.reject(Object.assign(new Error('refused'), { code: sqlState })),
          }),
        ).fetch(command(`/body-progress/${RECORD_ID}`, 'DELETE')),
      ),
    )
    const broken = await routes(
      bodyService({ list: () => Promise.reject(new Error('database unavailable')) }),
    ).fetch(request('/body-progress'))

    expect(answers.map((response) => response.status)).toEqual(verdicts.map(([, status]) => status))
    expect(answers[1]?.headers.get('content-type')).toContain('application/problem+json')
    expect(answers[5]?.headers.get('retry-after')).toBe('1')
    expect(broken.status).toBe(503)
  })

  test('T-IDN-BODY-API-09 never reaches the service without a token it can verify', async () => {
    const answers = await Promise.all([
      routes().fetch(request('/body-progress', { bearer: null })),
      routes().fetch(request('/body-progress', { bearer: 'forged' })),
      routes().fetch(
        request('/body-progress', {
          method: 'POST',
          bearer: 'forged',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': IDEMPOTENCY_KEY,
            'command-id': RECORD_ID,
          },
          body: JSON.stringify(measurement),
        }),
      ),
    ])

    expect(answers.map((response) => response.status)).toEqual([401, 401, 401])
    expect(captured).toEqual([])
  })
})
