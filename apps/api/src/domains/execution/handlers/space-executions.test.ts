import { beforeEach, describe, expect, test } from 'bun:test'
import type { VerifiedToken } from '@allfitone/auth-provider'
import { allfitV1ContractManifest, type AllfitV1Schemas } from '@allfitone/contracts'
import { Hono } from 'hono'

import { mountSurfaces } from '../../../surfaces.js'
import type { ExecutionService } from '../application/sessions.js'
import { spaceExecutionRoutes } from './space-executions.js'

const SESSION_ID = '019b8000-0000-7000-8000-000000000501'
const IDEMPOTENCY_KEY = 'a0000000-0000-4000-8000-000000000801'
const OPERATIONS = ['OP-EXE-004', 'OP-EXE-005', 'OP-EXE-006', 'OP-EXE-014', 'OP-EXE-015']
const ETAG = `"execution:${SESSION_ID}:r1"`

const started: AllfitV1Schemas['FreeExecutionStarted'] = {
  id: SESSION_ID,
  status: 'in_progress',
  revision_number: 0,
  activity_type_code: 'test_strength_session',
  result_contract: {
    id: '019c0000-0000-7000-8000-000000000031',
    version: 1,
    requested_level: 'detailed',
  },
}

const state: AllfitV1Schemas['ExecutionResultsState'] = {
  id: SESSION_ID,
  status: 'in_progress',
  revision_number: 2,
  segment_count: 1,
  result_count: 2,
}

const finished: AllfitV1Schemas['ExecutionFinalized'] = {
  id: SESSION_ID,
  status: 'completed',
  validation_status: 'pending',
  revision_number: 3,
  achieved_level: null,
  is_primary: false,
  contract: { id: '019c0000-0000-7000-8000-000000000031', version: 1 },
}

const summary: AllfitV1Schemas['ExecutionSummary'] = {
  id: SESSION_ID,
  activity_type_code: 'test_strength_session',
  activity_type_name: 'Sesión de fuerza de prueba',
  started_at: '2026-09-16T12:00:00+00:00',
  ended_at: '2026-09-16T13:00:00+00:00',
  timezone: 'America/Bogota',
  status: 'completed',
  validation_status: 'pending',
  achieved_level: null,
  revision_number: 3,
  result_count: 2,
}

const detail: AllfitV1Schemas['ExecutionDetail'] = {
  id: SESSION_ID,
  activity_type_code: 'test_strength_session',
  activity_type_name: 'Sesión de fuerza de prueba',
  discipline_code: 'test_strength',
  started_at: '2026-09-16T12:00:00+00:00',
  ended_at: '2026-09-16T13:00:00+00:00',
  timezone: 'America/Bogota',
  status: 'completed',
  validation_status: 'pending',
  requested_level: 'detailed',
  achieved_level: null,
  revision_number: 3,
  capture_source: 'manual',
  contract: { id: '019c0000-0000-7000-8000-000000000031', version: 1 },
  segments: [{ position: 1, activity_type_code: 'test_strength_session' }],
  strength_sets: [
    {
      segment_position: 1,
      order: 1,
      movement_id: '019b8000-0000-7000-8000-000000000601',
      movement_name: 'Sentadilla',
      achieved_reps: 8,
      load: { value: 80, unit: 'kg' },
      rpe: 7,
    },
  ],
  endurance_laps: [],
}

const token = { subject: 'user_subject', sessionId: 'session_1' } as unknown as VerifiedToken

let captured: { operation: string; token: unknown; input: unknown }[] = []

function executionService(overrides: Partial<ExecutionService> = {}): ExecutionService {
  return {
    start: (verifiedToken, input) => {
      captured.push({ operation: 'start', token: verifiedToken, input })
      return Promise.resolve({ resource: started, replayed: false })
    },
    replaceResults: (verifiedToken, input) => {
      captured.push({ operation: 'replaceResults', token: verifiedToken, input })
      return Promise.resolve({ resource: state, replayed: false })
    },
    finalize: (verifiedToken, input) => {
      captured.push({ operation: 'finalize', token: verifiedToken, input })
      return Promise.resolve({ resource: finished, replayed: false })
    },
    list: (verifiedToken, input) => {
      captured.push({ operation: 'list', token: verifiedToken, input })
      return Promise.resolve({ items: [summary], hasMore: false })
    },
    detail: (verifiedToken, input) => {
      captured.push({ operation: 'detail', token: verifiedToken, input })
      return Promise.resolve(detail)
    },
    ...overrides,
  }
}

function routes(
  service: ExecutionService = executionService(),
  verify: (value: string) => Promise<VerifiedToken> = async (value) => {
    if (value !== 'good-token') throw new Error('rejected')
    return token
  },
): Hono {
  return new Hono().route('/space/v1', spaceExecutionRoutes(service, verify))
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
  method: 'POST' | 'PUT',
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return request(path, {
    method,
    headers: {
      'idempotency-key': IDEMPOTENCY_KEY,
      'command-id': SESSION_ID,
      'content-type': 'application/json',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function colonPath(path: string): string {
  return path.replace(/\{([A-Za-z0-9_]+)\}/g, ':$1')
}

const creation = {
  activity_type_code: 'test_strength_session',
  started_at: '2026-09-16T07:00:00-05:00',
  timezone: 'America/Bogota',
  requested_level: 'detailed',
  capture_source: 'manual',
}

const results = {
  segments: [{ position: 1, activity_type_code: 'test_strength_session' }],
  strength_sets: [
    {
      segment_position: 1,
      order: 1,
      movement_id: '019b8000-0000-7000-8000-000000000601',
      planned_step_id: null,
      achieved_reps: 8,
      load: { value: 80, unit: 'kg' },
      rpe: 7,
    },
  ],
}

beforeEach(() => {
  captured = []
  process.env.BACKOFFICE_WEB_URL = 'https://backoffice.example.test'
  process.env.STUDIO_WEB_URL = 'https://studio.example.test'
  process.env.API_PUBLIC_URL = 'https://api.example.test'
})

describe('Space execution API contract', () => {
  test('T-EXE-API-01 mounts the five operations with their contract methods', () => {
    const contract = allfitV1ContractManifest.operations
      .filter((operation) => OPERATIONS.includes(operation.allfitOperation))
      .map((operation) => `${operation.method} ${colonPath(operation.path)}`)
      .sort()
    const mounted = spaceExecutionRoutes(executionService())
      .routes.filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} /space/v1${route.path}`)
      .sort()

    expect(contract).toHaveLength(5)
    expect(mounted).toEqual(contract)
  })

  test('T-EXE-API-02 mounts below the real Space surface, and not the planned attempt', () => {
    const app = new Hono()
    mountSurfaces(app)
    const mounted = app.routes
      .filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path}`)

    expect(mounted).toContain('POST /space/v1/executions')
    expect(mounted).toContain('GET /space/v1/executions')
    expect(mounted).toContain('GET /space/v1/executions/:executionId')
    expect(mounted).toContain('PUT /space/v1/executions/:executionId/results')
    expect(mounted).toContain('POST /space/v1/executions/:executionId/finalize')
    // OP-EXE-001 belongs to planned sessions, which are not built.
    expect(mounted).not.toContain('POST /space/v1/planned-sessions/:plannedSessionId/attempts')
  })

  test('T-EXE-API-03 starts a session under the command that names it', async () => {
    const response = await routes().fetch(command('/executions', 'POST', creation))

    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('location')).toBe(`/space/v1/executions/${SESSION_ID}`)
    expect(response.headers.get('etag')).toBe(`"execution:${SESSION_ID}:r0"`)
    await expect(response.json()).resolves.toEqual(started)
    expect(captured[0]?.token).toBe(token)
    expect(captured[0]?.input).toMatchObject({
      sessionId: SESSION_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      session: creation,
    })
  })

  test('T-EXE-API-04 refuses a start whose shape the database would refuse anyway', async () => {
    const bodies: unknown[] = [
      { ...creation, activity_type_code: 'Underwater Chess' },
      { ...creation, started_at: '2026-09-16' },
      { ...creation, timezone: 'bogota' },
      { ...creation, requested_level: 'certified' },
      { ...creation, capture_source: 'telepathy' },
      { ...creation, planned_session_id: SESSION_ID },
      { activity_type_code: 'test_strength_session', started_at: creation.started_at },
      '{not json',
    ]
    const answers = await Promise.all(
      bodies.map((body) => routes().fetch(command('/executions', 'POST', body))),
    )

    expect(answers.map((response) => response.status)).toEqual(bodies.map(() => 422))
    expect(captured).toEqual([])
  })

  test('T-EXE-API-05 replaces results under the revision the device last saw', async () => {
    const response = await routes().fetch(
      command(`/executions/${SESSION_ID}/results`, 'PUT', results, { 'if-match': ETAG }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe(`"execution:${SESSION_ID}:r2"`)
    await expect(response.json()).resolves.toEqual(state)
    // Absent optional fields travel as null, and laps as an empty list.
    expect(captured[0]?.input).toMatchObject({
      sessionId: SESSION_ID,
      expectedRevision: 1,
      results: { ...results, endurance_laps: [] },
    })
  })

  test('T-EXE-API-06 needs an If-Match that names this session', async () => {
    const answers = await Promise.all([
      routes().fetch(command(`/executions/${SESSION_ID}/results`, 'PUT', results)),
      routes().fetch(
        command(`/executions/${SESSION_ID}/results`, 'PUT', results, { 'if-match': 'r1' }),
      ),
      routes().fetch(
        command(`/executions/${SESSION_ID}/results`, 'PUT', results, {
          'if-match': '"execution:019b8000-0000-7000-8000-000000000999:r1"',
        }),
      ),
      routes().fetch(
        command(`/executions/${SESSION_ID}/finalize`, 'POST', { ended_at: summary.ended_at }),
      ),
    ])

    expect(answers.map((response) => response.status)).toEqual([428, 400, 400, 428])
    expect(captured).toEqual([])
  })

  test('T-EXE-API-07 refuses results whose shape the database would refuse anyway', async () => {
    const [set] = results.strength_sets
    const withSet = (changes: Record<string, unknown>) => ({
      ...results,
      strength_sets: [{ ...set, ...changes }],
    })
    const bodies: unknown[] = [
      { ...results, segments: [] },
      { ...results, strength_sets: [], endurance_laps: [] },
      withSet({ order: 0 }),
      withSet({ achieved_reps: 0 }),
      withSet({ rpe: 11 }),
      withSet({ load: { value: 80, unit: 'stone' } }),
      withSet({ segment_position: 0 }),
      withSet({ pain: 'knee' }),
      withSet({ planned_step_id: '019b8000-0000-7000-8000-000000000701' }),
      {
        ...results,
        segments: [
          { position: 1, activity_type_code: 'test_strength_session' },
          { position: 1, activity_type_code: 'test_strength_session' },
        ],
      },
      {
        ...results,
        strength_sets: [],
        endurance_laps: [
          {
            segment_position: 1,
            lap_number: 1,
            distance: { value: 0, unit: 'km' },
            duration_seconds: 60,
          },
        ],
      },
      {
        ...results,
        strength_sets: [],
        endurance_laps: [
          {
            segment_position: 1,
            lap_number: 1,
            distance: { value: 5, unit: 'leagues' },
            duration_seconds: 60,
          },
        ],
      },
      {
        ...results,
        strength_sets: [],
        endurance_laps: [
          {
            segment_position: 1,
            lap_number: 1,
            distance: { value: 5, unit: 'km' },
            duration_seconds: 0,
          },
        ],
      },
      '{not json',
    ]
    const answers = await Promise.all(
      bodies.map((body) =>
        routes().fetch(
          command(`/executions/${SESSION_ID}/results`, 'PUT', body, { 'if-match': ETAG }),
        ),
      ),
    )

    expect(answers.map((response) => response.status)).toEqual(bodies.map(() => 422))
    expect(captured).toEqual([])
  })

  test('T-EXE-API-08 finishes a session and says it certified nothing', async () => {
    const response = await routes().fetch(
      command(
        `/executions/${SESSION_ID}/finalize`,
        'POST',
        { ended_at: summary.ended_at },
        {
          'if-match': ETAG,
        },
      ),
    )
    const malformed = await routes().fetch(
      command(
        `/executions/${SESSION_ID}/finalize`,
        'POST',
        { ended_at: '2026-09-16' },
        {
          'if-match': ETAG,
        },
      ),
    )

    expect([response.status, malformed.status]).toEqual([200, 422])
    expect(response.headers.get('etag')).toBe(`"execution:${SESSION_ID}:r3"`)
    await expect(response.json()).resolves.toEqual(finished)
    expect(captured[0]?.input).toMatchObject({
      sessionId: SESSION_ID,
      expectedRevision: 1,
      endedAt: summary.ended_at,
    })
  })

  test('T-EXE-API-09 reads my sessions a page at a time', async () => {
    const first = await routes().fetch(request('/executions?limit=10'))
    const next = await routes().fetch(
      request(
        `/executions?before_started_at=${encodeURIComponent(summary.started_at)}&before_id=${SESSION_ID}`,
      ),
    )
    const refused = await Promise.all(
      [
        '/executions?limit=0',
        '/executions?limit=101',
        `/executions?before_started_at=${encodeURIComponent(summary.started_at)}`,
        `/executions?before_id=${SESSION_ID}`,
        '/executions?person_id=someone',
      ].map((path) => routes().fetch(request(path))),
    )

    expect([first.status, next.status]).toEqual([200, 200])
    expect(first.headers.get('cache-control')).toBe('private, no-store')
    await expect(first.json()).resolves.toEqual({ items: [summary], has_more: false })
    expect(captured.map(({ input }) => input)).toEqual([
      { limit: 10 },
      { limit: 25, before: { startedAt: summary.started_at, id: SESSION_ID } },
    ])
    expect(refused.map((response) => response.status)).toEqual([400, 400, 400, 400, 400])
  })

  test('T-EXE-API-10 opens one of my sessions with the revision it is at', async () => {
    const response = await routes().fetch(request(`/executions/${SESSION_ID}`))
    const malformed = await routes().fetch(request('/executions/not-an-id'))

    expect([response.status, malformed.status]).toEqual([200, 400])
    expect(response.headers.get('etag')).toBe(`"execution:${SESSION_ID}:r3"`)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual(detail)
    expect(captured[0]?.input).toBe(SESSION_ID)
  })

  test('T-EXE-API-11 maps every declared database verdict to its problem response', async () => {
    const verdicts: [string, number][] = [
      ['P0002', 404],
      ['42501', 403],
      ['22023', 422],
      ['23505', 409],
      ['55000', 409],
      ['40001', 409],
      ['AF409', 409],
    ]
    const answers = await Promise.all(
      verdicts.map(([sqlState]) =>
        routes(
          executionService({
            replaceResults: () =>
              Promise.reject(Object.assign(new Error('refused'), { code: sqlState })),
          }),
        ).fetch(command(`/executions/${SESSION_ID}/results`, 'PUT', results, { 'if-match': ETAG })),
      ),
    )
    const broken = await routes(
      executionService({ list: () => Promise.reject(new Error('database unavailable')) }),
    ).fetch(request('/executions'))

    expect(answers.map((response) => response.status)).toEqual(verdicts.map(([, status]) => status))
    await expect(answers[6]?.json()).resolves.toMatchObject({
      type: 'https://errors.allfit.invalid/stale-draft',
    })
    expect(broken.status).toBe(503)
  })

  test('T-EXE-API-12 never reaches the service without a token it can verify', async () => {
    const answers = await Promise.all([
      routes().fetch(request('/executions', { bearer: null })),
      routes().fetch(request(`/executions/${SESSION_ID}`, { bearer: 'forged' })),
      routes().fetch(
        request('/executions', {
          method: 'POST',
          bearer: 'forged',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': IDEMPOTENCY_KEY,
            'command-id': SESSION_ID,
          },
          body: JSON.stringify(creation),
        }),
      ),
    ])

    expect(answers.map((response) => response.status)).toEqual([401, 401, 401])
    expect(captured).toEqual([])
  })
})
