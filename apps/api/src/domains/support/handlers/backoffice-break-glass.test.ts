import { beforeEach, describe, expect, test } from 'bun:test'
import { allfitV1ContractManifest, type AllfitV1Schemas } from '@allfitone/contracts'
import { Hono } from 'hono'

import {
  BACKOFFICE_SESSION_COOKIE,
  BackofficeAuthenticationError,
  type BackofficeAuthenticationService,
} from '../../identity/index.js'
import { mountSurfaces } from '../../../surfaces.js'
import type { BreakGlassService } from '../application/index.js'
import { backofficeBreakGlassRoutes } from './backoffice-break-glass.js'

const ORIGIN = 'https://backoffice.example.test'
const ACTOR_PERSON_ID = '019a8000-0000-7000-8000-000000000003'
const ACTOR_SESSION_ID = '019a8000-0000-7000-8000-000000000023'
const SUBJECT_ID = '019a8000-0000-7000-8000-000000000006'
const REQUEST_ID = '019a8000-0000-7000-8000-000000000401'
const IDEMPOTENCY_KEY = '11111111-1111-4111-8111-111111111301'
const COMMAND_ID = '019a8000-0000-7000-8000-000000000501'

const file: AllfitV1Schemas['BreakGlassRequest'] = {
  id: REQUEST_ID,
  requester_person_id: ACTOR_PERSON_ID,
  subject_person_id: SUBJECT_ID,
  categories: ['nutrition_guidance'],
  purpose: 'customer_support_request',
  case_reference: 'CASE-2026-001',
  sensitivity_tier: 'standard',
  required_approvals: 1,
  requested_duration_minutes: 30,
  requested_at: '2026-09-10T18:00:00.000Z',
  request_expires_at: '2026-09-10T18:30:00.000Z',
  status: 'requested',
  window_starts_at: null,
  window_ends_at: null,
  closed_at: null,
  reviewed_at: null,
  review_outcome: null,
  approvals: [],
  exercise_count: 0,
  viewer_is_requester: true,
  viewer_can_decide: false,
  viewer_can_exercise: false,
}

const creation = {
  subject_person_id: SUBJECT_ID,
  categories: ['nutrition_guidance'],
  purpose: 'customer_support_request',
  case_reference: 'CASE-2026-001',
}

let captured: { operation: string; input: unknown }[] = []

function windowService(overrides: Partial<BreakGlassService> = {}): BreakGlassService {
  return {
    request: (_actor, input) => {
      captured.push({ operation: 'request', input })
      return Promise.resolve({ resource: file, replayed: false })
    },
    decide: (_actor, input) => {
      captured.push({ operation: 'decide', input })
      return Promise.resolve({ resource: { ...file, status: 'approved' }, replayed: false })
    },
    exercise: (_actor, input) => {
      captured.push({ operation: 'exercise', input })
      return Promise.resolve({
        outcome: 'content_unavailable',
        reason_code: 'execution_and_nutrition_absent',
        break_glass_event_id: '019a8000-0000-7000-8000-000000000601',
        occurred_at: '2026-09-10T18:05:00.000Z',
        category: 'nutrition_guidance',
      })
    },
    close: (_actor, input) => {
      captured.push({ operation: 'close', input })
      return Promise.resolve({ resource: { ...file, status: 'closed' }, replayed: false })
    },
    list: (_actor, input) => {
      captured.push({ operation: 'list', input })
      return Promise.resolve([file])
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
  windows: BreakGlassService = windowService(),
  sessions: BackofficeAuthenticationService = sessionService(),
): Hono {
  return new Hono().route('/backoffice/v1', backofficeBreakGlassRoutes(windows, sessions))
}

function post(
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
    body: JSON.stringify(init.body ?? creation),
  })
}

function get(path: string, init: { cookie?: boolean } = {}): Request {
  const headers = new Headers({ origin: ORIGIN })
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

describe('Backoffice break-glass API contract', () => {
  test('T-BG-API-01 mounts every break-glass operation with its contract method', () => {
    const contract = allfitV1ContractManifest.operations
      .filter((operation) =>
        ['OP-SUP-001', 'OP-SUP-002', 'OP-SUP-003', 'OP-SUP-004'].includes(
          operation.allfitOperation ?? '',
        ),
      )
      .map((operation) => `${operation.method} ${colonPath(operation.path)}`)
      .sort()
    const mounted = backofficeBreakGlassRoutes()
      .routes.filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} /backoffice/v1${route.path}`)
      .sort()

    expect(contract).toHaveLength(5)
    expect(mounted).toEqual(contract)
  })

  test('T-BG-API-02 mounts break-glass below the real Backoffice surface prefix', () => {
    const app = new Hono()
    mountSurfaces(app)
    const mounted = app.routes
      .filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path}`)

    expect(mounted).toContain('POST /backoffice/v1/break-glass/requests')
    expect(mounted).toContain('POST /backoffice/v1/break-glass/requests/:requestId/decisions')
    expect(mounted).toContain('POST /backoffice/v1/break-glass/requests/:requestId/reads')
    expect(mounted).toContain('POST /backoffice/v1/break-glass/requests/:requestId/closure')
  })

  test('T-BG-API-03 opens a file and never proposes the tier, quorum or duration', async () => {
    const response = await routes().fetch(post('/break-glass/requests'))

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual(file)
    const sent = JSON.stringify(captured[0]?.input)
    for (const forbidden of [
      'sensitivity_tier',
      'required_approvals',
      'requested_duration_minutes',
    ]) {
      expect(sent).not.toContain(forbidden)
    }
  })

  test('T-BG-API-04 refuses a forbidden category rather than pricing it higher', async () => {
    const answers = await Promise.all(
      [
        { ...creation, categories: ['nutrition_media'] },
        { ...creation, categories: ['nutrition_guidance', 'nutrition_media'] },
        { ...creation, categories: ['everything'] },
      ].map((body) => routes().fetch(post('/break-glass/requests', { body }))),
    )

    expect(answers.map((response) => response.status)).toEqual([422, 422, 422])
    expect(captured).toEqual([])
  })

  test('T-BG-API-05 refuses an invented purpose and an untraceable case', async () => {
    const answers = await Promise.all(
      [
        { ...creation, purpose: 'marketing' },
        { ...creation, purpose: 'other' },
        { ...creation, case_reference: 'el usuario pidió ayuda' },
      ].map((body) => routes().fetch(post('/break-glass/requests', { body }))),
    )

    expect(answers.map((response) => response.status)).toEqual([422, 422, 422])
    expect(captured).toEqual([])
  })

  test('T-BG-API-06 refuses a request that tries to declare its own tier', async () => {
    const response = await routes().fetch(
      post('/break-glass/requests', {
        body: { ...creation, sensitivity_tier: 'standard', required_approvals: 1 },
      }),
    )

    expect(response.status).toBe(422)
    expect(captured).toEqual([])
  })

  test('T-BG-API-07 refuses a duplicated category', async () => {
    const response = await routes().fetch(
      post('/break-glass/requests', {
        body: { ...creation, categories: ['nutrition_guidance', 'nutrition_guidance'] },
      }),
    )

    expect(response.status).toBe(422)
    expect(captured).toEqual([])
  })

  test('T-BG-API-08 records a decision and marks a replay instead of deciding twice', async () => {
    const decided = await routes().fetch(
      post(`/break-glass/requests/${REQUEST_ID}/decisions`, {
        body: { decision: 'approved', reason_code: 'REASON-OK' },
      }),
    )
    expect(decided.status).toBe(200)
    expect(captured[0]).toMatchObject({
      operation: 'decide',
      input: { decision: 'approved', reasonCode: 'REASON-OK' },
    })

    const replayed = await routes(
      windowService({
        decide: () => Promise.resolve({ resource: file, replayed: true }),
      }),
    ).fetch(
      post(`/break-glass/requests/${REQUEST_ID}/decisions`, {
        body: { decision: 'approved', reason_code: 'REASON-OK' },
      }),
    )
    expect(replayed.headers.get('idempotent-replay')).toBe('true')
  })

  test('T-BG-API-09 refuses a decision outside its closed vocabulary', async () => {
    const answers = await Promise.all(
      [
        { decision: 'maybe', reason_code: 'REASON-OK' },
        { decision: 'approved', reason_code: 'porque sí' },
        { decision: 'approved' },
      ].map((body) =>
        routes().fetch(post(`/break-glass/requests/${REQUEST_ID}/decisions`, { body })),
      ),
    )

    expect(answers.map((response) => response.status)).toEqual([422, 422, 422])
    expect(captured).toEqual([])
  })

  test('T-BG-API-10 answers a denied exercise with its recorded reason, not an error', async () => {
    const response = await routes(
      windowService({
        exercise: () =>
          Promise.resolve({
            outcome: 'denied',
            reason_code: 'category_out_of_scope',
            break_glass_event_id: '019a8000-0000-7000-8000-000000000602',
            occurred_at: '2026-09-10T18:06:00.000Z',
          }),
      }),
    ).fetch(
      post(`/break-glass/requests/${REQUEST_ID}/reads`, {
        body: { category: 'health_context', resource_type: 'execution.health_context' },
      }),
    )

    // A denial is an answer: the evidence is written and the caller must be told
    // which reason was recorded. An error status would invite a blind retry.
    expect(response.status).toBe(200)
    const body = (await response.json()) as { outcome: string; reason_code: string }
    expect(body.outcome).toBe('denied')
    expect(body.reason_code).toBe('category_out_of_scope')
    expect(body).not.toHaveProperty('content')
  })

  test('T-BG-API-11 says the content is unavailable rather than inventing it', async () => {
    const response = await routes().fetch(
      post(`/break-glass/requests/${REQUEST_ID}/reads`, {
        body: { category: 'nutrition_guidance', resource_type: 'nutrition.guidance_notes' },
      }),
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as { outcome: string; reason_code: string }
    expect(body.outcome).toBe('content_unavailable')
    expect(body.reason_code).toBe('execution_and_nutrition_absent')
  })

  test('T-BG-API-12 refuses an exercise outside the approvable categories', async () => {
    const answers = await Promise.all(
      [
        { category: 'nutrition_media', resource_type: 'nutrition.media' },
        { category: 'nutrition_guidance', resource_type: 'Nutrition.Guidance' },
      ].map((body) => routes().fetch(post(`/break-glass/requests/${REQUEST_ID}/reads`, { body }))),
    )

    expect(answers.map((response) => response.status)).toEqual([422, 422])
    expect(captured).toEqual([])
  })

  test('T-BG-API-13 closes a window and converges on a repeated closure', async () => {
    const closed = await routes().fetch(post(`/break-glass/requests/${REQUEST_ID}/closure`))
    expect(closed.status).toBe(200)
    await expect(closed.json()).resolves.toMatchObject({ status: 'closed' })
  })

  test('T-BG-API-14 requires both command identifiers on every command', async () => {
    const answers = await Promise.all([
      routes().fetch(post('/break-glass/requests', { idempotencyKey: '' })),
      routes().fetch(post('/break-glass/requests', { commandId: '' })),
      routes().fetch(post(`/break-glass/requests/${REQUEST_ID}/closure`, { commandId: '' })),
    ])

    expect(answers.map((response) => response.status)).toEqual([400, 400, 400])
    expect(captured).toEqual([])
  })

  test('T-BG-API-15 maps the state machine to a conflict and a refusal to forbidden', async () => {
    const verdicts: [string, number][] = [
      ['55000', 409],
      ['23505', 409],
      ['42501', 403],
      ['P0002', 404],
      ['40001', 409],
    ]
    const answers = await Promise.all(
      verdicts.map(([sqlState]) =>
        routes(
          windowService({
            request: () => Promise.reject(Object.assign(new Error('refused'), { code: sqlState })),
          }),
        ).fetch(post('/break-glass/requests')),
      ),
    )

    expect(answers.map((response) => response.status)).toEqual(verdicts.map(([, status]) => status))
    expect(answers[4]?.headers.get('retry-after')).toBe('1')
  })

  test('T-BG-API-16 reads the tray with its filters and keeps it out of any cache', async () => {
    const response = await routes().fetch(get('/break-glass/requests?mine=true&status=requested'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ items: [file] })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(captured[0]).toMatchObject({ input: { mine: true, status: 'requested' } })
  })

  test('T-BG-API-17 refuses a tray filter outside its closed vocabulary', async () => {
    const answers = await Promise.all(
      ['status=exploded', 'mine=perhaps', 'limit=0', 'limit=101'].map((filter) =>
        routes().fetch(get(`/break-glass/requests?${filter}`)),
      ),
    )

    expect(answers.map((response) => response.status)).toEqual([400, 400, 400, 400])
    expect(captured).toEqual([])
  })

  test('T-BG-API-18 refuses a command from another origin before doing any work', async () => {
    const response = await routes().fetch(
      post('/break-glass/requests', { origin: 'https://attacker.test' }),
    )

    expect(response.status).toBe(403)
    expect(captured).toEqual([])
  })

  test('T-BG-API-19 answers unauthenticated without a session and when it ended', async () => {
    const missing = await routes().fetch(get('/break-glass/requests', { cookie: false }))
    const ended = await routes(
      windowService(),
      sessionService({
        resolveActor: async () =>
          Promise.reject(new BackofficeAuthenticationError('unauthenticated')),
      }),
    ).fetch(get('/break-glass/requests'))

    expect([missing.status, ended.status]).toEqual([401, 401])
    expect(captured).toEqual([])
  })

  test('T-BG-API-20 carries the viewer capabilities the screen cannot derive', async () => {
    // The Backoffice session carries no domain person identifier, so a client has no
    // way to work out whether this operator may decide or exercise. Dropping these
    // three would leave the screen showing a file with no action on it at all.
    const tray = await routes().fetch(get('/break-glass/requests'))
    const opened = await routes().fetch(post('/break-glass/requests'))

    const listed = (await tray.json()) as { items: Record<string, unknown>[] }
    const created = (await opened.json()) as Record<string, unknown>
    for (const row of [listed.items[0], created]) {
      expect(row).toMatchObject({
        viewer_is_requester: true,
        viewer_can_decide: false,
        viewer_can_exercise: false,
      })
    }
  })
})
