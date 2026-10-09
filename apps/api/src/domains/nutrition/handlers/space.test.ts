import { describe, expect, test } from 'bun:test'
import { allfitV1ContractManifest } from '@allfitone/contracts'
import { RecognitionError } from '@allfitone/food-recognition'
import { ObjectStoreError } from '@allfitone/object-store'
import { Hono } from 'hono'

import { SpaceActorError, type SpaceActorResolver } from '../../identity/index.js'
import { ConsentRequired, type SpaceNutritionService } from '../application/index.js'
import { PhotoRejected, type NutritionMeal } from '../domain/index.js'
import { spaceNutritionRoutes } from './space.js'

const PERSON = '019f1000-0000-7000-8000-000000000001'
const MEAL = '019f1000-0000-7000-8000-000000000101'
const KEY = '51111111-1111-4111-8111-111111111111'
const COMMAND = '019f1000-0000-7000-8000-000000000201'

const meal: NutritionMeal = {
  id: MEAL,
  occurred_at: '2026-09-30T18:10:00.000Z',
  local_date: '2026-09-30',
  timezone: 'America/Bogota',
  meal_type: 'lunch',
  note: null,
  revision_number: 2,
  items: [
    {
      position: 1,
      name: 'Pechuga de pollo',
      quantity: 150,
      quantity_unit: 'g',
      nutrients: [{ nutrient_code: 'energy', value: 248, unit: 'kcal' }],
    },
  ],
  photo: null,
  applied_scopes: [],
}

function harness(overrides: Partial<SpaceNutritionService> = {}, actorFails = false): Hono {
  const service: SpaceNutritionService = {
    recordMeal: async () => meal,
    readMeal: async () => meal,
    listMeals: async () => ({ data: [meal], page: { next_cursor: null, has_more: false } }),
    reviseMeal: async () => ({ ...meal, revision_number: 3 }),
    deleteMeal: async () => undefined,
    readDailySummaries: async () => ({ data: [], streak_days: 4 }),
    readGoals: async () => ({ active: null, proposals: [] }),
    publishGoal: async () => {
      throw new Error('not used')
    },
    decideGoal: async () => {
      throw new Error('not used')
    },
    searchFoods: async () => ({ data: [] }),
    frequentFoods: async () => ({ data: [] }),
    recognize: async () => ({ dish: null, model: 'google/gemini-3.5-flash-lite', items: [] }),
    readConsent: async () => ({
      current_version: '2026-10-04',
      accepted_version: null,
      accepted_at: null,
    }),
    acceptConsent: async () => ({
      current_version: '2026-10-04',
      accepted_version: '2026-10-04',
      accepted_at: '2026-10-04T12:00:00Z',
    }),
    ...overrides,
  }
  const actors: SpaceActorResolver = {
    actorFor: async () => ({ accountId: 'account', personId: PERSON }),
    personFor: async () => {
      if (actorFails) throw new SpaceActorError('registration-incomplete')
      return PERSON
    },
  }
  const app = new Hono()
  app.route(
    '/space/v1',
    spaceNutritionRoutes(
      service,
      async () => ({ subject: 'sub', sessionId: 'sid', surface: 'space' as const }),
      actors,
    ),
  )
  return app
}

const authorized = { authorization: 'Bearer token' }
const commanded = {
  ...authorized,
  'content-type': 'application/json',
  'idempotency-key': KEY,
  'command-id': COMMAND,
}
const create = {
  occurred_at: '2026-09-30T13:10:00-05:00',
  timezone: 'America/Bogota',
  meal_type: 'lunch',
  items: meal.items,
}
const etag = (revision: number) => `"nutrition-meal:${MEAL}:r${String(revision)}"`

const send = (
  app: Hono,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) =>
  app.request(`/space/v1/nutrition${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

describe('the Space nutrition surface honours the contract', () => {
  test("T-NUT-API-01 declares the person's nutrition operations", () => {
    const declared = allfitV1ContractManifest.operations
      .filter((operation) => operation.path.startsWith('/space/v1/nutrition'))
      .map((operation) => operation.allfitOperation)
    expect([...new Set(declared)].sort()).toEqual([
      'OP-NUT-001',
      'OP-NUT-002',
      'OP-NUT-003',
      'OP-NUT-004',
      'OP-NUT-005',
      'OP-NUT-006',
      'OP-NUT-007',
      'OP-NUT-008',
      'OP-NUT-014',
      'OP-NUT-015',
      'OP-NUT-016',
      'OP-NUT-017',
    ])
  })
})

describe('meals', () => {
  test('T-NUT-API-02 a recorded meal answers 201 with where it lives and its revision', async () => {
    const response = await send(harness(), 'POST', '/meals', commanded, create)

    expect(response.status).toBe(201)
    expect(response.headers.get('etag')).toBe(etag(2))
    expect(response.headers.get('location')).toBe(`/space/v1/nutrition/meals/${MEAL}`)
  })

  test('T-NUT-API-03 refuses a meal it cannot read, or without its command', async () => {
    expect(
      (await send(harness(), 'POST', '/meals', commanded, { ...create, items: 'none' })).status,
    ).toBe(400)
    expect(
      (await send(harness(), 'POST', '/meals', commanded, { ...create, meal_type: 'brunch' }))
        .status,
    ).toBe(400)
    expect((await send(harness(), 'POST', '/meals', authorized, create)).status).toBe(400)
  })

  test('T-NUT-API-04 what PostgreSQL refuses as content is a 422, not a 400', async () => {
    const refused = harness({
      recordMeal: async () => {
        throw Object.assign(new Error('a nutrient is written in its own unit'), { code: '23514' })
      },
    })
    expect((await send(refused, 'POST', '/meals', commanded, create)).status).toBe(422)
  })

  test('T-NUT-API-22 replaying the recording of a meal deleted since is gone, not recreated', async () => {
    const disposed = harness({
      recordMeal: async () => {
        throw Object.assign(new Error('the meal this command recorded was deleted'), {
          code: 'AF410',
        })
      },
    })
    const response = await send(disposed, 'POST', '/meals', commanded, create)
    expect(response.status).toBe(410)
    expect(await response.json()).toEqual({ error: { code: 'command-effect-disposed' } })
  })

  test("T-NUT-API-05 reads one meal with its validator, and another person's is not found", async () => {
    const response = await send(harness(), 'GET', `/meals/${MEAL}`, authorized)
    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe(etag(2))

    const missing = await send(
      harness({ readMeal: async () => null }),
      'GET',
      `/meals/${MEAL}`,
      authorized,
    )
    expect(missing.status).toBe(404)
  })

  test('T-NUT-API-06 lists the days asked for, with its own bounds', async () => {
    let asked: Parameters<SpaceNutritionService['listMeals']>[0] | undefined
    const app = harness({
      listMeals: async (input) => {
        asked = input
        return { data: [], page: { next_cursor: null, has_more: false } }
      },
    })
    expect(
      (await send(app, 'GET', '/meals?from=2026-09-24&to=2026-09-30', authorized)).status,
    ).toBe(200)
    expect(asked).toMatchObject({ from: '2026-09-24', to: '2026-09-30', cursor: null, limit: 50 })
    expect((await send(app, 'GET', '/meals?from=2026-09-30', authorized)).status).toBe(400)
    expect(
      (await send(app, 'GET', '/meals?from=2026-09-30&to=2026-09-31', authorized)).status,
    ).toBe(400)
    expect(
      (await send(app, 'GET', '/meals?from=2026-09-24&to=2026-09-30&limit=101', authorized)).status,
    ).toBe(400)
  })
})

describe('correcting a meal (OP-NUT-003)', () => {
  test('T-NUT-API-07 passes the revision If-Match names, and answers the next one', async () => {
    let revision: number | undefined
    const app = harness({
      reviseMeal: async (input) => {
        revision = input.revision
        return { ...meal, revision_number: 3 }
      },
    })
    const response = await send(
      app,
      'PATCH',
      `/meals/${MEAL}`,
      { ...commanded, 'if-match': etag(2) },
      { note: 'Otra' },
    )

    expect(response.status).toBe(200)
    expect(revision).toBe(2)
    expect(response.headers.get('etag')).toBe(etag(3))
  })

  test("T-NUT-API-08 without If-Match it is 428; with another meal's or a malformed one, 400", async () => {
    const app = harness()
    expect((await send(app, 'PATCH', `/meals/${MEAL}`, commanded, { note: 'x' })).status).toBe(428)
    const other = `"nutrition-meal:019f1000-0000-7000-8000-000000000999:r2"`
    expect(
      (
        await send(
          app,
          'PATCH',
          `/meals/${MEAL}`,
          { ...commanded, 'if-match': other },
          { note: 'x' },
        )
      ).status,
    ).toBe(400)
    expect(
      (
        await send(
          app,
          'PATCH',
          `/meals/${MEAL}`,
          { ...commanded, 'if-match': 'r2' },
          { note: 'x' },
        )
      ).status,
    ).toBe(400)
    expect(
      (await send(app, 'PATCH', `/meals/${MEAL}`, { ...commanded, 'if-match': etag(2) }, {}))
        .status,
    ).toBe(400)
  })

  test('T-NUT-API-09 a stale revision is 409, the meal changed somewhere else', async () => {
    const stale = harness({
      reviseMeal: async () => {
        throw Object.assign(new Error('stale-meal'), { code: '40001' })
      },
    })
    const response = await send(
      stale,
      'PATCH',
      `/meals/${MEAL}`,
      { ...commanded, 'if-match': etag(1) },
      { note: 'x' },
    )
    expect(response.status).toBe(409)
  })

  test('T-NUT-API-10 a photo that is not one is 422; a store that is down, 503', async () => {
    const photo = { photo: { content_type: 'image/jpeg', content: 'AAAA' } }
    const rejected = harness({
      reviseMeal: async () => {
        throw new PhotoRejected(new Error('not an image'))
      },
    })
    const down = harness({
      reviseMeal: async () => {
        throw new ObjectStoreError('put', new Error('timeout'))
      },
    })
    const headers = { ...commanded, 'if-match': etag(2) }
    expect((await send(rejected, 'PATCH', `/meals/${MEAL}`, headers, photo)).status).toBe(422)
    expect((await send(down, 'PATCH', `/meals/${MEAL}`, headers, photo)).status).toBe(503)
    expect(
      (
        await send(harness(), 'PATCH', `/meals/${MEAL}`, headers, {
          photo: { content_type: 'image/gif', content: 'A' },
        })
      ).status,
    ).toBe(400)
  })

  test("T-NUT-API-11 another person's meal is not found, as a missing one", async () => {
    const foreign = harness({
      reviseMeal: async () => {
        throw Object.assign(new Error("meal is not this person's"), { code: '42501' })
      },
    })
    const response = await send(
      foreign,
      'PATCH',
      `/meals/${MEAL}`,
      { ...commanded, 'if-match': etag(2) },
      { note: 'x' },
    )
    expect(response.status).toBe(404)
  })
})

describe('deleting, the day and the goal', () => {
  test('T-NUT-API-12 a deleted meal answers 204', async () => {
    expect((await send(harness(), 'DELETE', `/meals/${MEAL}`, commanded)).status).toBe(204)
  })

  test('T-NUT-API-13 the days carry the streak, in at most 31 days', async () => {
    const response = await send(
      harness(),
      'GET',
      '/daily-summaries?from=2026-09-24&to=2026-09-30&timezone=America/Bogota',
      authorized,
    )
    expect(response.status).toBe(200)
    expect(((await response.json()) as { streak_days: number }).streak_days).toBe(4)
    expect(
      (await send(harness(), 'GET', '/daily-summaries?from=2026-08-01&to=2026-09-30', authorized))
        .status,
    ).toBe(400)
  })

  test('T-NUT-API-14 a goal is published as targets, and a decision is accepted or rejected', async () => {
    let targets: unknown
    const app = harness({
      publishGoal: async (input) => {
        targets = input.goal.targets
        return {
          id: COMMAND,
          version_number: 1,
          origin: 'self',
          status: 'active',
          rationale: null,
          targets: input.goal.targets,
          author: { kind: 'self', person_id: PERSON },
          created_at: '2026-10-01T12:00:00.000Z',
          origin_relationship_id: null,
          decision: null,
          applied_scope: null,
        }
      },
      decideGoal: async (input) => ({
        id: COMMAND,
        goal_version_id: input.goalVersionId,
        decision: input.decision,
        decided_at: '2026-10-01T12:00:00.000Z',
        active_goal_version_id: input.goalVersionId,
      }),
    })
    const target = {
      nutrient_code: 'protein',
      mode: 'minimum',
      minimum: 150,
      maximum: null,
      exact: null,
      unit: 'g',
    }
    expect(
      (await send(app, 'POST', '/goals/versions', commanded, { targets: [target] })).status,
    ).toBe(201)
    expect(targets).toEqual([target])
    expect((await send(app, 'POST', '/goals/versions', commanded, { targets: [] })).status).toBe(
      400,
    )
    expect(
      (
        await send(app, 'POST', `/goal-versions/${MEAL}/decision`, commanded, {
          decision: 'accepted',
        })
      ).status,
    ).toBe(200)
    expect(
      (await send(app, 'POST', `/goal-versions/${MEAL}/decision`, commanded, { decision: 'maybe' }))
        .status,
    ).toBe(400)
  })

  test('T-NUT-API-15 an account without its Fitness ID reads nothing', async () => {
    expect((await send(harness({}, true), 'GET', '/goals', authorized)).status).toBe(403)
  })
})

const photoBody = {
  photo: { content_type: 'image/jpeg', content: Buffer.from([1, 2, 3]).toString('base64') },
}

describe('the catalogue, recognition and its consent (ADR-041)', () => {
  test('T-NUT-API-16 a food search needs a query of 1 to 80 characters', async () => {
    let asked = ''
    const app = harness({
      searchFoods: async ({ query, limit }) => {
        asked = `${query}|${String(limit)}`
        return { data: [] }
      },
    })
    expect((await send(app, 'GET', '/foods?q=arroz', authorized)).status).toBe(200)
    expect(asked).toBe('arroz|20')
    expect((await send(app, 'GET', '/foods', authorized)).status).toBe(400)
    expect((await send(app, 'GET', `/foods?q=${'a'.repeat(81)}`, authorized)).status).toBe(400)
    expect((await send(app, 'GET', '/foods?q=arroz&limit=31', authorized)).status).toBe(400)
  })

  test("T-NUT-API-17 the frequent foods are the person's", async () => {
    const response = await send(harness(), 'GET', '/foods/frequent', authorized)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  test('T-NUT-API-18 recognising: consent first, a photo it can read, and 503 when the model is down', async () => {
    expect((await send(harness(), 'POST', '/recognitions', commanded, photoBody)).status).toBe(200)
    const noConsent = await send(
      harness({ recognize: async () => Promise.reject(new ConsentRequired()) }),
      'POST',
      '/recognitions',
      commanded,
      photoBody,
    )
    expect(noConsent.status).toBe(403)
    expect(await noConsent.json()).toEqual({ error: { code: 'consent-required' } })
    expect(
      (
        await send(
          harness({ recognize: async () => Promise.reject(new RecognitionError('unavailable')) }),
          'POST',
          '/recognitions',
          commanded,
          photoBody,
        )
      ).status,
    ).toBe(503)
    expect(
      (
        await send(
          harness({ recognize: async () => Promise.reject(new PhotoRejected('x')) }),
          'POST',
          '/recognitions',
          commanded,
          photoBody,
        )
      ).status,
    ).toBe(422)
    expect(
      (
        await send(harness(), 'POST', '/recognitions', commanded, {
          photo: { content_type: 'image/gif', content: 'AA' },
        })
      ).status,
    ).toBe(400)
  })

  test('T-NUT-API-19 the consent is read, and accepted only as a command', async () => {
    expect((await send(harness(), 'GET', '/recognition-consent', authorized)).status).toBe(200)
    expect(
      (await send(harness(), 'PUT', '/recognition-consent', authorized, { version: '2026-10-04' }))
        .status,
    ).toBe(400)
    expect(
      (await send(harness(), 'PUT', '/recognition-consent', commanded, { version: 'cualquiera' }))
        .status,
    ).toBe(400)
    const accepted = await send(harness(), 'PUT', '/recognition-consent', commanded, {
      version: '2026-10-04',
    })
    expect(accepted.status).toBe(200)
    expect(((await accepted.json()) as { accepted_version: string }).accepted_version).toBe(
      '2026-10-04',
    )
  })

  test('T-NUT-API-20 a meal carries where each item came from, and which model saw it', async () => {
    let received: unknown
    const app = harness({
      recordMeal: async ({ meal: recorded }) => {
        received = recorded
        return meal
      },
    })
    const fromPhoto = {
      ...create,
      recognized_by: 'google/gemini-3.5-flash-lite',
      items: [
        { ...create.items[0], origin: 'photo', food_id: '019f1300-0000-7000-8000-000000000201' },
      ],
    }
    expect((await send(app, 'POST', '/meals', commanded, fromPhoto)).status).toBe(201)
    expect(received).toMatchObject({ recognized_by: 'google/gemini-3.5-flash-lite' })
    expect(
      (
        await send(app, 'POST', '/meals', commanded, {
          ...create,
          items: [{ ...create.items[0], origin: 'magia' }],
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await send(app, 'POST', '/meals', commanded, {
          ...create,
          items: [{ ...create.items[0], food_id: 'no' }],
        })
      ).status,
    ).toBe(400)
  })

  test('T-NUT-API-21 an item may name the packaged product it was picked from', async () => {
    let received: unknown
    const app = harness({
      recordMeal: async ({ meal: recorded }) => {
        received = recorded
        return meal
      },
    })
    const picked = {
      ...create,
      items: [
        {
          ...create.items[0],
          origin: 'catalog',
          product_id: '019f1400-0000-7000-8000-000000000201',
        },
      ],
    }
    expect((await send(app, 'POST', '/meals', commanded, picked)).status).toBe(201)
    expect(received).toMatchObject({
      items: [{ product_id: '019f1400-0000-7000-8000-000000000201' }],
    })
    expect(
      (
        await send(app, 'POST', '/meals', commanded, {
          ...create,
          items: [{ ...create.items[0], product_id: 7 }],
        })
      ).status,
    ).toBe(400)
  })
})
