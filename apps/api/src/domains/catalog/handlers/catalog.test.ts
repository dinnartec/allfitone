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
import { catalogMovementRoutes, type TokenVerifier } from './catalog.js'

const PERSON_ID = '019f9000-0000-7000-8000-000000000001'

const movements: Movement[] = [
  {
    id: '019f4000-0000-7000-8000-000000000001',
    discipline_code: 'strength',
    name: 'Press de banca con barra',
  },
  {
    id: '019f4000-0000-7000-8000-000000000002',
    discipline_code: 'strength',
    name: 'Press inclinado con mancuernas',
  },
]

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
      return movements
    },
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
  test('T-CAT-API-01 answers the movements the library found, as the array itself', async () => {
    const response = await harness().app.request('/catalog/v1/movements', { headers: authorized })

    expect(response.status).toBe(200)
    const body: unknown = await response.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toEqual(movements)
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
      { personId: PERSON_ID, discipline: 'strength', query: 'press', limit: 7 },
    ])
  })

  test('T-CAT-API-07 treats a blank or absent filter as no filter, with the default limit', async () => {
    const blank = harness()
    await blank.app.request('/catalog/v1/movements?discipline=%20&q=%20%20', {
      headers: authorized,
    })
    const absent = harness()
    await absent.app.request('/catalog/v1/movements', { headers: authorized })

    const noFilter = { personId: PERSON_ID, discipline: null, query: null, limit: 40 }
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
      { personId: PERSON_ID, discipline: null, query: null, limit: 100 },
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
      { personId: PERSON_ID, discipline: null, query: 'a'.repeat(120), limit: 40 },
    ])
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
