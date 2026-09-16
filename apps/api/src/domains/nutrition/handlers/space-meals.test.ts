import { beforeEach, describe, expect, test } from 'bun:test'
import type { VerifiedToken } from '@allfitone/auth-provider'
import { allfitV1ContractManifest, type AllfitV1Schemas } from '@allfitone/contracts'
import { Hono } from 'hono'

import { mountSurfaces } from '../../../surfaces.js'
import type { MealService } from '../application/meals.js'
import { spaceMealRoutes } from './space-meals.js'

const MEAL_ID = '019b7000-0000-7000-8000-000000000501'
const CASE_ID = '019b7000-0000-7000-8000-000000000901'
const IDEMPOTENCY_KEY = 'a0000000-0000-4000-8000-000000000701'
const OPERATIONS = ['OP-NUT-001', 'OP-NUT-002', 'OP-NUT-004']

const meal: AllfitV1Schemas['NutritionMeal'] = {
  id: MEAL_ID,
  occurred_at: '2026-09-15T23:30:00+00:00',
  local_date: '2026-09-15',
  timezone: 'America/Bogota',
  meal_type: 'dinner',
  note: 'Con poca sal',
  revision_number: 0,
  items: [
    {
      position: 1,
      name: 'Pollo a la plancha',
      quantity: 120,
      quantity_unit: 'g',
      nutrients: [{ nutrient_code: 'protein', value: 37, unit: 'g' }],
    },
  ],
  photo: null,
  applied_scopes: [],
}

const token = { subject: 'user_subject', sessionId: 'session_1' } as unknown as VerifiedToken

let captured: { operation: string; token: unknown; input: unknown }[] = []

function mealService(overrides: Partial<MealService> = {}): MealService {
  return {
    list: (verifiedToken, input) => {
      captured.push({ operation: 'list', token: verifiedToken, input })
      return Promise.resolve({ meals: [meal], hasMore: false })
    },
    record: (verifiedToken, input) => {
      captured.push({ operation: 'record', token: verifiedToken, input })
      return Promise.resolve({ resource: meal, replayed: false })
    },
    delete: (verifiedToken, input) => {
      captured.push({ operation: 'delete', token: verifiedToken, input })
      return Promise.resolve({
        resource: { meal_id: MEAL_ID, disposition_case_id: CASE_ID, status: 'deleted' },
        replayed: false,
      })
    },
    ...overrides,
  }
}

function routes(
  service: MealService = mealService(),
  verify: (value: string) => Promise<VerifiedToken> = async (value) => {
    if (value !== 'good-token') throw new Error('rejected')
    return token
  },
): Hono {
  return new Hono().route('/space/v1', spaceMealRoutes(service, verify))
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
      'command-id': MEAL_ID,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  })
}

function colonPath(path: string): string {
  return path.replace(/\{([A-Za-z0-9_]+)\}/g, ':$1')
}

const creation = {
  occurred_at: '2026-09-15T18:30:00-05:00',
  timezone: 'America/Bogota',
  meal_type: 'dinner',
  items: [
    {
      position: 1,
      name: 'Pollo a la plancha',
      quantity: 120,
      quantity_unit: 'g',
      nutrients: [
        { nutrient_code: 'energy', value: 198, unit: 'kcal' },
        { nutrient_code: 'protein', value: 37, unit: 'g' },
      ],
    },
    { position: 2, name: 'Ensalada', quantity: null, quantity_unit: null, nutrients: [] },
  ],
}

beforeEach(() => {
  captured = []
  process.env.BACKOFFICE_WEB_URL = 'https://backoffice.example.test'
  process.env.STUDIO_WEB_URL = 'https://studio.example.test'
  process.env.API_PUBLIC_URL = 'https://api.example.test'
})

describe('Space meal API contract', () => {
  test('T-NUT-API-01 mounts the read and both commands with their contract methods', () => {
    const contract = allfitV1ContractManifest.operations
      .filter((operation) => OPERATIONS.includes(operation.allfitOperation))
      .map((operation) => `${operation.method} ${colonPath(operation.path)}`)
      .sort()
    const mounted = spaceMealRoutes(mealService())
      .routes.filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} /space/v1${route.path}`)
      .sort()

    expect(contract).toHaveLength(3)
    expect(mounted).toEqual(contract)
  })

  test('T-NUT-API-02 mounts below the real Space surface prefix, and not the revision', () => {
    const app = new Hono()
    mountSurfaces(app)
    const mounted = app.routes
      .filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path}`)

    expect(mounted).toContain('GET /space/v1/nutrition/meals')
    expect(mounted).toContain('POST /space/v1/nutrition/meals')
    expect(mounted).toContain('DELETE /space/v1/nutrition/meals/:mealId')
    // OP-NUT-003 is not built: an unmounted route is honest, a stub that fails is not.
    expect(mounted).not.toContain('PATCH /space/v1/nutrition/meals/:mealId')
  })

  test('T-NUT-API-03 records a meal under the command that names it', async () => {
    const response = await routes().fetch(command('/nutrition/meals', 'POST', creation))

    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('location')).toBe(`/space/v1/nutrition/meals/${MEAL_ID}`)
    expect(response.headers.get('etag')).toBe(`"nutrition-meal:${MEAL_ID}:r0"`)
    await expect(response.json()).resolves.toEqual(meal)
    expect(captured[0]?.token).toBe(token)
    // An omitted note travels as null, so a retry that sends it hashes the same.
    expect(captured[0]?.input).toMatchObject({
      mealId: MEAL_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      meal: { ...creation, note: null },
    })
  })

  test('T-NUT-API-04 hashes an omitted note like an explicit null', async () => {
    await routes().fetch(command('/nutrition/meals', 'POST', creation))
    await routes().fetch(command('/nutrition/meals', 'POST', { ...creation, note: null }))

    const hashes = captured.map(({ input }) =>
      Buffer.from((input as { requestHash: Uint8Array }).requestHash).toString('hex'),
    )
    expect(hashes).toHaveLength(2)
    expect(hashes[0]).toBe(hashes[1])
  })

  test('T-NUT-API-05 refuses a meal whose shape the database would refuse anyway', async () => {
    const [chicken, salad] = creation.items
    const item = (changes: Record<string, unknown>) => ({
      ...creation,
      items: [{ ...chicken, ...changes }],
    })
    const nutrient = (changes: Record<string, unknown>) =>
      item({ nutrients: [{ nutrient_code: 'fat', value: 3, unit: 'g', ...changes }] })
    const bodies: unknown[] = [
      { ...creation, items: [] },
      { ...creation, meal_type: 'brunch' },
      { ...creation, timezone: 'bogota' },
      { ...creation, occurred_at: '2026-09-15' },
      { ...creation, note: '   ' },
      { ...creation, photo: { url: 'https://example.test/p.jpg' } },
      { ...creation, items: [chicken, { ...salad, position: 1 }] },
      item({ position: 0 }),
      item({ position: 1.5 }),
      item({ name: '  ' }),
      item({ quantity: 120, quantity_unit: null }),
      item({ quantity: '120' }),
      item({ calories: 5 }),
      nutrient({ nutrient_code: 'sodium' }),
      nutrient({ unit: 'kcal' }),
      nutrient({ value: -1 }),
      item({
        nutrients: [
          { nutrient_code: 'fat', value: 3, unit: 'g' },
          { nutrient_code: 'fat', value: 4, unit: 'g' },
        ],
      }),
      { occurred_at: creation.occurred_at, timezone: creation.timezone, meal_type: 'lunch' },
      '{not json',
    ]
    const answers = await Promise.all(
      bodies.map((body) => routes().fetch(command('/nutrition/meals', 'POST', body))),
    )

    expect(answers.map((response) => response.status)).toEqual(bodies.map(() => 422))
    expect(captured).toEqual([])
  })

  test('T-NUT-API-06 requires a JSON body and the command identifiers', async () => {
    const answers = await Promise.all([
      routes().fetch(
        command('/nutrition/meals', 'POST', creation, { 'content-type': 'text/plain' }),
      ),
      routes().fetch(command('/nutrition/meals', 'POST', creation, { 'idempotency-key': 'nope' })),
      routes().fetch(
        command('/nutrition/meals', 'POST', creation, {
          'command-id': 'a0000000-0000-4000-8000-000000000501',
        }),
      ),
    ])

    expect(answers.map((response) => response.status)).toEqual([415, 400, 400])
    expect(captured).toEqual([])
  })

  test('T-NUT-API-07 reads a range of my local days, a page at a time', async () => {
    const first = await routes(
      mealService({
        list: (verifiedToken, input) => {
          captured.push({ operation: 'list', token: verifiedToken, input })
          return Promise.resolve({ meals: [meal], hasMore: true })
        },
      }),
    ).fetch(request('/nutrition/meals?from=2026-09-01&to=2026-09-30&limit=1'))
    const page = (await first.json()) as AllfitV1Schemas['NutritionMealPage']
    const cursor = page.page.next_cursor ?? ''
    const next = await routes().fetch(
      request(`/nutrition/meals?from=2026-09-01&to=2026-09-30&limit=1&cursor=${cursor}`),
    )

    expect([first.status, next.status]).toEqual([200, 200])
    expect(first.headers.get('cache-control')).toBe('private, no-store')
    expect(page).toEqual({ data: [meal], page: { has_more: true, next_cursor: cursor } })
    expect(cursor.length).toBeGreaterThanOrEqual(16)
    expect(captured.map(({ input }) => input)).toEqual([
      { from: '2026-09-01', to: '2026-09-30', limit: 1 },
      {
        from: '2026-09-01',
        to: '2026-09-30',
        limit: 1,
        before: { occurredAt: meal.occurred_at, id: MEAL_ID },
      },
    ])
    await expect(next.json()).resolves.toEqual({
      data: [meal],
      page: { has_more: false, next_cursor: null },
    })
  })

  test('T-NUT-API-08 refuses a range or cursor it cannot honour', async () => {
    const cursor = Buffer.from(
      JSON.stringify({
        from: '2026-09-01',
        to: '2026-09-30',
        occurred_at: meal.occurred_at,
        id: MEAL_ID,
      }),
    ).toString('base64url')
    const refused = await Promise.all(
      [
        '/nutrition/meals',
        '/nutrition/meals?from=2026-09-01',
        '/nutrition/meals?from=2026-09-30&to=2026-09-01',
        '/nutrition/meals?from=2026-08-01&to=2026-09-15',
        // Thirty-one local days is the most a page covers.
        '/nutrition/meals?from=2026-09-01&to=2026-10-02',
        '/nutrition/meals?from=2026-09-01&to=2026-09-30&limit=0',
        '/nutrition/meals?from=2026-09-01&to=2026-09-30&limit=101',
        '/nutrition/meals?from=2026-09-01&to=2026-09-30&cursor=not-a-real-cursor',
        // A cursor only continues the query that produced it.
        `/nutrition/meals?from=2026-09-02&to=2026-09-30&cursor=${cursor}`,
        '/nutrition/meals?from=2026-09-01&to=2026-09-30&person_id=someone',
      ].map((path) => routes().fetch(request(path))),
    )

    expect(refused.map((response) => response.status)).toEqual(refused.map(() => 400))
    expect(captured).toEqual([])

    const widest = await routes().fetch(request('/nutrition/meals?from=2026-09-01&to=2026-10-01'))
    expect(widest.status).toBe(200)
  })

  test('T-NUT-API-09 deletes a meal with no body and answers nothing, even on replay', async () => {
    const deleted = await routes().fetch(command(`/nutrition/meals/${MEAL_ID}`, 'DELETE'))
    const replay = await routes(
      mealService({
        delete: async () => ({
          resource: { meal_id: MEAL_ID, disposition_case_id: CASE_ID, status: 'deleted' },
          replayed: true,
        }),
      }),
    ).fetch(command(`/nutrition/meals/${MEAL_ID}`, 'DELETE'))
    const malformed = await routes().fetch(command('/nutrition/meals/not-an-id', 'DELETE'))

    expect([deleted.status, replay.status, malformed.status]).toEqual([204, 204, 400])
    await expect(deleted.text()).resolves.toBe('')
    expect(replay.headers.get('idempotent-replay')).toBe('true')
    expect(captured[0]?.input).toMatchObject({ mealId: MEAL_ID, commandId: MEAL_ID })
  })

  test('T-NUT-API-10 maps every declared database verdict to its problem response', async () => {
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
          mealService({
            record: () => Promise.reject(Object.assign(new Error('refused'), { code: sqlState })),
          }),
        ).fetch(command('/nutrition/meals', 'POST', creation)),
      ),
    )
    const broken = await routes(
      mealService({ list: () => Promise.reject(new Error('database unavailable')) }),
    ).fetch(request('/nutrition/meals?from=2026-09-01&to=2026-09-30'))

    expect(answers.map((response) => response.status)).toEqual(verdicts.map(([, status]) => status))
    expect(answers[6]?.headers.get('content-type')).toContain('application/problem+json')
    await expect(answers[6]?.json()).resolves.toMatchObject({
      type: 'https://errors.allfit.invalid/command-effect-disposed',
    })
    expect(answers[5]?.headers.get('retry-after')).toBe('1')
    expect(broken.status).toBe(503)
  })

  test('T-NUT-API-11 never reaches the service without a token it can verify', async () => {
    const answers = await Promise.all([
      routes().fetch(request('/nutrition/meals?from=2026-09-01&to=2026-09-30', { bearer: null })),
      routes().fetch(
        request('/nutrition/meals?from=2026-09-01&to=2026-09-30', { bearer: 'forged' }),
      ),
      routes().fetch(
        request('/nutrition/meals', {
          method: 'POST',
          bearer: 'forged',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': IDEMPOTENCY_KEY,
            'command-id': MEAL_ID,
          },
          body: JSON.stringify(creation),
        }),
      ),
    ])

    expect(answers.map((response) => response.status)).toEqual([401, 401, 401])
    expect(captured).toEqual([])
  })
})
