import { beforeEach, describe, expect, test } from 'bun:test'
import { allfitV1ContractManifest, type AllfitV1Schemas } from '@allfitone/contracts'
import { Hono } from 'hono'

import { mountSurfaces } from '../../../surfaces.js'
import {
  BACKOFFICE_SESSION_COOKIE,
  BackofficeAuthenticationError,
  type BackofficeAuthenticationService,
} from '../../identity/index.js'
import type { PlatformPlanService } from '../application/index.js'
import { backofficePlatformPlanRoutes } from './backoffice.js'

const ORIGIN = 'https://backoffice.example.test'
const ACTOR_PERSON_ID = '019b4000-0000-7000-8000-000000000003'
const ACTOR_SESSION_ID = '019b4000-0000-7000-8000-000000000023'
const PLAN_ID = '019b4000-0000-7000-8000-000000000501'
const VERSION_ID = '019b4000-0000-7000-8000-000000000601'
const IDEMPOTENCY_KEY = 'c0000000-0000-4000-8000-000000000025'
const COMMAND_ID = '019b4000-0000-7000-8000-000000000701'
const OPERATIONS = ['NEW-PAY-PLATFORM-PLAN', 'OP-PAY-017', 'OP-PAY-024', 'OP-PAY-025', 'OP-PAY-026']

const plan: AllfitV1Schemas['PlatformPlan'] = {
  id: PLAN_ID,
  code: 'premium',
  name: 'Premium',
  plan_kind: 'paid',
  status: 'draft',
  created_by_person_id: ACTOR_PERSON_ID,
  created_at: '2026-09-18T12:00:00.000Z',
  current_version: null,
  proposal: {
    id: VERSION_ID,
    version_number: 1,
    status: 'draft',
    amount_minor: 3990000,
    currency_code: 'COP',
    billing_period: 'month',
    features: [],
    supersedes_version_id: null,
    changes: null,
    proposed_by_person_id: ACTOR_PERSON_ID,
    proposed_by_self: true,
    proposed_at: '2026-09-18T12:05:00.000Z',
    published_by_person_id: null,
    published_at: null,
    deprecated_at: null,
    withdrawn_by_person_id: null,
    withdrawn_at: null,
  },
  history: [],
}

const catalogue: AllfitV1Schemas['PlatformPlanCatalogue'] = {
  generated_at: '2026-09-18T12:10:00.000Z',
  feature_catalog: [],
  plans: [plan],
}

const proposal = {
  amount_minor: 3990000,
  currency_code: 'COP',
  billing_period: 'month',
  features: [{ feature_code: 'history_weeks', enabled: true, limit_value: 12 }],
}

let captured: { operation: string; actor: unknown; input: unknown }[] = []

function planService(overrides: Partial<PlatformPlanService> = {}): PlatformPlanService {
  const record = (operation: string) => (actor: unknown, input: unknown) => {
    captured.push({ operation, actor, input })
    return Promise.resolve({ resource: plan, replayed: false })
  }
  return {
    list: (actor, input) => {
      captured.push({ operation: 'list', actor, input })
      return Promise.resolve(catalogue)
    },
    create: record('create'),
    propose: record('propose'),
    publish: record('publish'),
    withdraw: record('withdraw'),
    ...overrides,
  } as PlatformPlanService
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
  service: PlatformPlanService = planService(),
  sessions: BackofficeAuthenticationService = sessionService(),
): Hono {
  return new Hono().route('/backoffice/v1', backofficePlatformPlanRoutes(service, sessions))
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
  body: unknown,
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
    body: typeof body === 'string' ? body : JSON.stringify(body),
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

describe('Backoffice platform plan API contract', () => {
  test('T-PAY-PLAN-API-01 mounts the read and the four commands with their contract methods', () => {
    const contract = allfitV1ContractManifest.operations
      .filter((operation) => OPERATIONS.includes(operation.allfitOperation))
      .map((operation) => `${operation.method} ${colonPath(operation.path)}`)
      .sort()
    const mounted = backofficePlatformPlanRoutes()
      .routes.filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} /backoffice/v1${route.path}`)
      .sort()

    expect(contract).toHaveLength(5)
    expect(mounted).toEqual(contract)
  })

  test('T-PAY-PLAN-API-02 mounts below the real Backoffice surface prefix', () => {
    const app = new Hono()
    mountSurfaces(app)
    const mounted = app.routes
      .filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path}`)

    expect(mounted).toContain('GET /backoffice/v1/platform-plans')
    expect(mounted).toContain('POST /backoffice/v1/platform-plans')
    expect(mounted).toContain('POST /backoffice/v1/platform-plans/:planId/versions')
    expect(mounted).toContain(
      'POST /backoffice/v1/platform-plans/:planId/versions/:versionId/publication',
    )
    expect(mounted).toContain(
      'POST /backoffice/v1/platform-plans/:planId/versions/:versionId/withdrawal',
    )
  })

  test('T-PAY-PLAN-API-03 reads the plans as the operator, out of any cache, and refuses a filter', async () => {
    const response = await routes().fetch(request('/platform-plans'))
    const filtered = await routes().fetch(request('/platform-plans?kind=paid'))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual(catalogue)
    expect(filtered.status).toBe(400)
    expect(captured).toHaveLength(1)
    expect(captured[0]?.actor).toEqual({ personId: ACTOR_PERSON_ID, sessionId: ACTOR_SESSION_ID })
  })

  test('T-PAY-PLAN-API-04 creates a plan with exactly a code, a trimmed name and a kind', async () => {
    const created = await routes().fetch(
      commandRequest('/platform-plans', {
        code: 'premium',
        name: '  Premium  ',
        plan_kind: 'paid',
      }),
    )
    const refused = await Promise.all(
      [
        { code: 'Premium', name: 'Premium', plan_kind: 'paid' },
        { code: 'premium', name: '   ', plan_kind: 'paid' },
        { code: 'premium', name: 'Premium', plan_kind: 'gold' },
        { code: 'premium', name: 'Premium', plan_kind: 'paid', status: 'published' },
        { code: 'premium', name: 'Premium' },
      ].map((body) => routes().fetch(commandRequest('/platform-plans', body))),
    )

    expect(created.status).toBe(201)
    expect(refused.map((response) => response.status)).toEqual([422, 422, 422, 422, 422])
    expect(captured).toHaveLength(1)
    expect(captured[0]?.input).toMatchObject({
      plan: { code: 'premium', name: 'Premium', plan_kind: 'paid' },
      idempotencyKey: IDEMPOTENCY_KEY,
      commandId: COMMAND_ID,
    })
  })

  test('T-PAY-PLAN-API-05 carries a proposal through as declared, the free shape included', async () => {
    const paid = await routes().fetch(
      commandRequest(`/platform-plans/${PLAN_ID}/versions`, proposal),
    )
    const free = await routes().fetch(
      commandRequest(`/platform-plans/${PLAN_ID}/versions`, {
        amount_minor: 0,
        currency_code: null,
        billing_period: null,
        features: [{ feature_code: 'history_weeks', enabled: false, limit_value: null }],
      }),
    )

    expect([paid.status, free.status]).toEqual([201, 201])
    expect(captured.map(({ operation }) => operation)).toEqual(['propose', 'propose'])
    expect(captured[0]?.input).toMatchObject({ planId: PLAN_ID, proposal })
    expect(captured[1]?.input).toMatchObject({
      proposal: { amount_minor: 0, currency_code: null, billing_period: null },
    })
  })

  test('T-PAY-PLAN-API-06 refuses a proposal whose shape the database would refuse anyway', async () => {
    const bodies: unknown[] = [
      { ...proposal, amount_minor: -1 },
      { ...proposal, amount_minor: 1.5 },
      { ...proposal, amount_minor: '3990000' },
      { ...proposal, currency_code: 'pesos' },
      { ...proposal, billing_period: 'week' },
      { ...proposal, features: 'history_weeks' },
      { ...proposal, features: [{ feature_code: 'History', enabled: true, limit_value: null }] },
      {
        ...proposal,
        features: [{ feature_code: 'history_weeks', enabled: 'yes', limit_value: null }],
      },
      {
        ...proposal,
        features: [{ feature_code: 'history_weeks', enabled: true, limit_value: -2 }],
      },
      {
        ...proposal,
        features: [{ feature_code: 'history_weeks', enabled: true, limit_value: 1, tier: 'gold' }],
      },
      { ...proposal, plan_kind: 'free' },
      { amount_minor: 0, currency_code: null, billing_period: null },
    ]
    const answers = await Promise.all(
      bodies.map((body) =>
        routes().fetch(commandRequest(`/platform-plans/${PLAN_ID}/versions`, body)),
      ),
    )

    expect(answers.map((response) => response.status)).toEqual(bodies.map(() => 422))
    expect(captured).toEqual([])
  })

  test('T-PAY-PLAN-API-07 publishes and withdraws with no body, and says when it replays', async () => {
    const base = `/platform-plans/${PLAN_ID}/versions/${VERSION_ID}`
    const published = await routes().fetch(commandRequest(`${base}/publication`, {}))
    const withdrawn = await routes().fetch(commandRequest(`${base}/withdrawal`, {}))
    const withBody = await routes().fetch(
      commandRequest(`${base}/publication`, { reviewed_by: ACTOR_PERSON_ID }),
    )
    const replay = await routes(
      planService({ publish: async () => ({ resource: plan, replayed: true }) }),
    ).fetch(commandRequest(`${base}/publication`, {}))

    expect([published.status, withdrawn.status, withBody.status]).toEqual([200, 200, 422])
    expect(replay.headers.get('idempotent-replay')).toBe('true')
    expect(captured.map(({ operation }) => operation)).toEqual(['publish', 'withdraw'])
    expect(captured[0]?.input).toMatchObject({ planId: PLAN_ID, versionId: VERSION_ID })
  })

  test('T-PAY-PLAN-API-08 requires the trusted origin, a JSON body, the command identifiers and real ids', async () => {
    const answers = await Promise.all([
      routes().fetch(
        commandRequest(`/platform-plans/${PLAN_ID}/versions`, proposal, {
          origin: 'https://attacker.test',
        }),
      ),
      routes().fetch(
        commandRequest(`/platform-plans/${PLAN_ID}/versions`, proposal, {
          headers: { 'content-type': 'text/plain' },
        }),
      ),
      routes().fetch(
        commandRequest(`/platform-plans/${PLAN_ID}/versions`, proposal, {
          headers: { 'command-id': 'c0000000-0000-4000-8000-000000000099' },
        }),
      ),
      routes().fetch(commandRequest('/platform-plans/not-a-plan/versions', proposal)),
      routes().fetch(
        commandRequest(`/platform-plans/${PLAN_ID}/versions/not-a-version/publication`, {}),
      ),
      routes().fetch(commandRequest(`/platform-plans/${PLAN_ID}/versions`, '{not json')),
    ])

    expect(answers.map((response) => response.status)).toEqual([403, 415, 400, 400, 400, 422])
    expect(captured).toEqual([])
  })

  test('T-PAY-PLAN-API-09 maps every declared database verdict to its problem response', async () => {
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
          planService({
            publish: () => Promise.reject(Object.assign(new Error('refused'), { code: sqlState })),
          }),
        ).fetch(
          commandRequest(`/platform-plans/${PLAN_ID}/versions/${VERSION_ID}/publication`, {}),
        ),
      ),
    )
    const broken = await routes(
      planService({ list: () => Promise.reject(new Error('database unavailable')) }),
    ).fetch(request('/platform-plans'))

    expect(answers.map((response) => response.status)).toEqual(verdicts.map(([, status]) => status))
    // Publishing your own proposal is a refusal, not a conflict to retry.
    expect(answers[1]?.headers.get('content-type')).toContain('application/problem+json')
    expect(answers[5]?.headers.get('retry-after')).toBe('1')
    expect(broken.status).toBe(503)
  })

  test('T-PAY-PLAN-API-10 never reaches the service without a session that still resolves', async () => {
    const missing = await routes().fetch(request('/platform-plans', { cookie: false }))
    const ended = await routes(
      planService(),
      sessionService({
        resolveActor: async () =>
          Promise.reject(new BackofficeAuthenticationError('unauthenticated')),
      }),
    ).fetch(
      commandRequest('/platform-plans', { code: 'premium', name: 'Premium', plan_kind: 'paid' }),
    )

    expect([missing.status, ended.status]).toEqual([401, 401])
    expect(captured).toEqual([])
  })
})
