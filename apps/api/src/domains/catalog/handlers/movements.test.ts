/**
 * `GET /catalog/v1/movements` — `OP-CAT-009`.
 *
 * What this file proves about the exercise library as an endpoint, with the service, the
 * token verifier and the actor resolver injected so nothing here touches PostgreSQL or
 * the identity provider:
 *
 * - The answer is the array of movements itself, not an envelope around it. `S-1` types
 *   into a box and reads a list; wrapping it would be a contract change, so it is
 *   asserted rather than assumed.
 * - The answer is never cached. The library is filtered per person by policy, so a
 *   shared cache is a leak, not an optimization.
 * - Authentication fails closed: no bearer and a rejected token are both 401, and an
 *   account without an activated Fitness ID is 403 — a precondition, not an empty list.
 * - The three filters reach the service exactly as the caller expressed them, with
 *   blank treated as absent and the default limit applied. This is the part a handler
 *   can silently get wrong while every status code still looks right, so the assertions
 *   are on what the injected service received.
 * - The bounds are refused at the edge: a limit that is not a positive integer, a limit
 *   above the ceiling, and a query longer than the maximum are 400 before any read.
 * - An unexpected failure below is 503 and not a 200 with an empty list, which would
 *   read to the person as "no such exercise".
 */

import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { SpaceActorError, type SpaceActorResolver } from '../../identity/index.js'
import type { MovementLibraryService } from '../application/index.js'
import type { Movement, MovementQuery } from '../domain/index.js'
import { catalogMovementRoutes, type TokenVerifier } from './movements.js'

const PERSON_ID = '019f9000-0000-7000-8000-000000000001'

const movements: Movement[] = [
  {
    id: '019f4000-0000-7000-8000-000000000001',
    discipline_code: 'strength',
    name: 'Press de banca con barra',
    muscles: ['chest', 'triceps'],
    equipment: ['barbell', 'bench'],
    demo_url: 'https://media.allfit.invalid/movements/bench-press.webp',
  },
  {
    id: '019f4000-0000-7000-8000-000000000002',
    discipline_code: 'strength',
    name: 'Press inclinado con mancuernas',
    muscles: ['chest', 'shoulders'],
    equipment: ['dumbbell', 'bench'],
    demo_url: null,
  },
]

const MOVEMENT_ID = '019f4000-0000-7000-8000-000000000001'

const detail = {
  id: MOVEMENT_ID,
  discipline_code: 'strength',
  name: 'Press de banca con barra',
  aliases: ['bench press'],
  muscles: [{ code: 'chest', name: 'Pecho', primary: true }],
  equipment: ['barbell', 'bench'],
  instructions: [{ position: 1, text: 'Túmbate en el banco.' }],
  variants: [
    {
      id: '019f4000-0000-7000-8000-000000000002',
      name: 'Press con mancuernas',
      relation: 'variant',
      note: 'Más recorrido',
    },
  ],
  demo_url: 'https://media.allfit.invalid/movements/bench-press.webp',
}

const authorized = { authorization: 'Bearer token' }

function harness(overrides?: {
  service?: Partial<MovementLibraryService>
  verify?: TokenVerifier
  actors?: Partial<SpaceActorResolver>
}): { app: Hono; asked: MovementQuery[] } {
  // Kept so the filters can be asserted where they land, not only through the status.
  const asked: MovementQuery[] = []
  const service: MovementLibraryService = {
    search: async (request) => {
      asked.push(request)
      return { data: movements, page: { next_cursor: null, has_more: false } }
    },
    read: async () => detail,
    equipment: async () => [{ code: 'barbell', name: 'Barra' }],
    muscles: async () => [{ code: 'chest', name: 'Pecho', region: 'upper', body_slug: 'chest' }],
    ...overrides?.service,
  }
  const actors: SpaceActorResolver = {
    actorFor: async () => ({ accountId: 'account', personId: PERSON_ID }),
    personFor: async () => PERSON_ID,
    ...overrides?.actors,
  }
  const verify: TokenVerifier =
    overrides?.verify ??
    (async () => ({ subject: 'sub', sessionId: 'sid', surface: 'space' as const }))
  const app = new Hono()
  app.route('/catalog/v1', catalogMovementRoutes(service, verify, actors))
  return { app, asked }
}

const unregistered = {
  actors: {
    personFor: async () => {
      throw new SpaceActorError('registration-incomplete')
    },
  },
}

describe('GET /catalog/v1/movements', () => {
  test('T-CAT-API-01 answers the movements the library found, inside the page envelope', async () => {
    // The envelope, not a bare array: a capped array with no way to ask for the next
    // page is indistinguishable from the whole catalogue.
    const response = await harness().app.request('/catalog/v1/movements', { headers: authorized })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: movements,
      page: { next_cursor: null, has_more: false },
    })
  })

  test('T-CAT-API-02 forbids caching the answer', async () => {
    // The library is filtered per person by policy, so a shared cache is a leak.
    const response = await harness().app.request('/catalog/v1/movements', { headers: authorized })

    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  test('T-CAT-API-03 refuses without a bearer token', async () => {
    const response = await harness().app.request('/catalog/v1/movements')

    expect(response.status).toBe(401)
  })

  test('T-CAT-API-04 refuses a token the provider does not accept', async () => {
    const rejected = harness({
      verify: async () => {
        throw new Error('expired token')
      },
    })
    const response = await rejected.app.request('/catalog/v1/movements', { headers: authorized })

    expect(response.status).toBe(401)
    expect(rejected.asked).toHaveLength(0)
  })

  test('T-CAT-API-05 refuses an account that has not activated its Fitness ID', async () => {
    // Not an empty library: the search is keyed on the person, and there is none yet.
    const response = await harness(unregistered).app.request('/catalog/v1/movements', {
      headers: authorized,
    })

    expect(response.status).toBe(403)
  })

  test('T-CAT-API-06 passes the discipline, the text and the limit through as given', async () => {
    const asking = harness()
    const response = await asking.app.request(
      '/catalog/v1/movements?discipline=strength&q=press&limit=7',
      { headers: authorized },
    )

    expect(response.status).toBe(200)
    expect(asking.asked).toEqual([
      {
        personId: PERSON_ID,
        discipline: 'strength',
        query: 'press',
        muscles: [],
        equipment: [],
        limit: 7,
        cursor: null,
      },
    ])
  })

  test('T-CAT-API-07 treats a blank or absent filter as no filter, with the default limit', async () => {
    const blank = harness()
    await blank.app.request('/catalog/v1/movements?discipline=%20&q=%20%20', {
      headers: authorized,
    })
    const absent = harness()
    await absent.app.request('/catalog/v1/movements', { headers: authorized })

    const noFilter = {
      personId: PERSON_ID,
      discipline: null,
      query: null,
      muscles: [],
      equipment: [],
      limit: 40,
      cursor: null,
    }
    expect(blank.asked).toEqual([noFilter])
    expect(absent.asked).toEqual([noFilter])
  })

  test('T-CAT-API-08 refuses a limit that is not a positive integer', async () => {
    const refused = harness()
    // `%2B` and not `+`: a bare plus in a query string is a space, so it would arrive as 8.
    for (const limit of ['0', '-3', '1.5', 'many', '%2B8', '007e2']) {
      const response = await refused.app.request(`/catalog/v1/movements?limit=${limit}`, {
        headers: authorized,
      })
      expect(response.status).toBe(400)
    }
    expect(refused.asked).toHaveLength(0)
  })

  test('T-CAT-API-09 refuses a limit above the ceiling and accepts the ceiling itself', async () => {
    const bounded = harness()
    const over = await bounded.app.request('/catalog/v1/movements?limit=101', {
      headers: authorized,
    })
    const at = await bounded.app.request('/catalog/v1/movements?limit=100', { headers: authorized })

    expect(over.status).toBe(400)
    expect(at.status).toBe(200)
    expect(bounded.asked).toEqual([
      {
        personId: PERSON_ID,
        discipline: null,
        query: null,
        muscles: [],
        equipment: [],
        limit: 100,
        cursor: null,
      },
    ])
  })

  test('T-CAT-API-10 refuses a query longer than the maximum and accepts the maximum', async () => {
    const bounded = harness()
    const over = await bounded.app.request(`/catalog/v1/movements?q=${'a'.repeat(121)}`, {
      headers: authorized,
    })
    const at = await bounded.app.request(`/catalog/v1/movements?q=${'a'.repeat(120)}`, {
      headers: authorized,
    })

    expect(over.status).toBe(400)
    expect(at.status).toBe(200)
    expect(bounded.asked).toEqual([
      {
        personId: PERSON_ID,
        discipline: null,
        query: 'a'.repeat(120),
        muscles: [],
        equipment: [],
        limit: 40,
        cursor: null,
      },
    ])
  })

  test('T-CAT-API-13 several values of one filter travel together, as or', async () => {
    const filtered = harness()
    const response = await filtered.app.request(
      '/catalog/v1/movements?muscle=chest&muscle=back&equipment=dumbbell',
      { headers: authorized },
    )

    expect(response.status).toBe(200)
    expect(filtered.asked[0]?.muscles).toEqual(['chest', 'back'])
    expect(filtered.asked[0]?.equipment).toEqual(['dumbbell'])
  })

  test('T-CAT-API-14 refuses more filter values than the vocabulary could hold', async () => {
    // Past this it is not a filter, it is a scan dressed as one.
    const refused = harness()
    const many = Array.from({ length: 33 }, (_, index) => `muscle=m${index}`).join('&')
    const response = await refused.app.request(`/catalog/v1/movements?${many}`, {
      headers: authorized,
    })

    expect(response.status).toBe(400)
  })

  test('T-CAT-API-15 refuses a filter code longer than the maximum', async () => {
    const refused = harness()
    const response = await refused.app.request(`/catalog/v1/movements?muscle=${'a'.repeat(65)}`, {
      headers: authorized,
    })

    expect(response.status).toBe(400)
  })

  test('T-CAT-API-16 answers the two vocabularies the chips are drawn from', async () => {
    const listing = harness()

    const equipment = await listing.app.request('/catalog/v1/equipment', { headers: authorized })
    const muscles = await listing.app.request('/catalog/v1/muscles', { headers: authorized })

    expect(equipment.status).toBe(200)
    expect(await equipment.json()).toEqual([{ code: 'barbell', name: 'Barra' }])
    expect(muscles.status).toBe(200)
    expect(await muscles.json()).toEqual([
      { code: 'chest', name: 'Pecho', region: 'upper', body_slug: 'chest' },
    ])
  })

  test('T-CAT-API-17 both vocabularies need a token, like everything else here', async () => {
    const guarded = harness()

    expect((await guarded.app.request('/catalog/v1/equipment')).status).toBe(401)
    expect((await guarded.app.request('/catalog/v1/muscles')).status).toBe(401)
  })

  test('T-CAT-API-18 answers one movement whole, so the screen draws itself once', async () => {
    const listing = harness()

    const response = await listing.app.request(`/catalog/v1/movements/${MOVEMENT_ID}`, {
      headers: authorized,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(detail)
  })

  test('T-CAT-API-19 a movement nobody can see answers the same as one that is not there', async () => {
    // Telling them apart would let identifiers be walked to learn what exists.
    const missing = harness({ service: { read: async () => null } })

    const response = await missing.app.request(`/catalog/v1/movements/${MOVEMENT_ID}`, {
      headers: authorized,
    })

    expect(response.status).toBe(404)
  })

  test('T-CAT-API-20 refuses an identifier that is not one the catalogue hands out', async () => {
    const refused = harness()

    expect(
      (await refused.app.request('/catalog/v1/movements/nope', { headers: authorized })).status,
    ).toBe(400)
  })

  test('T-CAT-API-11 answers unavailable when the library fails unexpectedly', async () => {
    // An empty list would read as "no such exercise", which is a different fact.
    const broken = harness({
      service: {
        search: async () => Promise.reject(new Error('database unavailable')),
      },
    })
    const response = await broken.app.request('/catalog/v1/movements', { headers: authorized })

    expect(response.status).toBe(503)
  })
})
