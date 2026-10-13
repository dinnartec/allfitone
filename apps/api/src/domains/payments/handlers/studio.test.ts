/**
 * `T-PAY-API-01` — the Studio side of a subscription against the contract.
 *
 * What is worth asserting at this layer is narrow and specific: that the three commands
 * carry a distinguishable request hash, that the cursor round-trips, and that a database
 * refusal reaches the caller as the right status. Whether a coach may suspend is decided
 * in PostgreSQL and asserted in `T-PAY-LIFECYCLE-01`; repeating it against a stub here
 * would test the stub.
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { StudioSessionService } from '../../identity/index.js'
import type { SubscriptionService } from '../application/subscriptions.js'
import type { OrganizationSubscription } from '../domain/subscriptions.js'
import { studioPaymentRoutes } from './studio.js'

const ORGANIZATION = '019c3000-0000-7000-8000-000000000101'
const SUBSCRIPTION = '019c3000-0000-7000-8000-000000000601'
const OTHER_SUBSCRIPTION = '019c3000-0000-7000-8000-000000000602'
const HEADERS = {
  origin: 'https://studio.example.test',
  cookie: 'allfit_studio_session=opaque',
}
const COMMAND = {
  ...HEADERS,
  'idempotency-key': '7f1d3c9e-4a2b-4c6d-8e5f-0a1b2c3d4e5f',
  'command-id': '019c3000-0000-7000-8000-0000000000aa',
}

function sessions(overrides: Partial<StudioSessionService> = {}): StudioSessionService {
  return {
    completeCode: async () => ({ opaqueToken: 'opaque' }),
    readSession: async () => ({
      authenticated: true,
      registration_status: 'complete',
      identity: { given_name: 'Olivia', family_name: 'Owner' },
    }),
    resolveActor: async () => ({ accountId: 'account', personId: 'person' }),
    resolveAccountIdentity: async () => ({
      actor: { accountId: 'account', personId: 'person' },
      identity: {
        givenName: 'Olivia',
        familyName: 'Owner',
        verifiedEmail: 'olivia@example.test',
      },
    }),
    logout: async () => ({ redirectUrl: 'https://studio.example.test', outcome: 'already-absent' }),
    ...overrides,
  }
}

function paying(overrides: Partial<OrganizationSubscription> = {}): OrganizationSubscription {
  return {
    subscription_id: SUBSCRIPTION,
    person_id: '019c3000-0000-7000-8000-000000000002',
    person_name: 'Carla Cliente',
    plan_name: 'Mensual',
    plan_version_id: '019c3000-0000-7000-8000-000000000501',
    amount_minor: 12000000,
    currency_code: 'COP',
    billing_period: 'month',
    status: 'active',
    current_period_end: '2026-11-11',
    started_at: '2026-10-12T14:00:00.000Z',
    suspended_at: null,
    ended_at: null,
    ...overrides,
  }
}

type Capture = { hashes: string[]; inputs: Record<string, unknown>[] }

function service(
  overrides: Partial<SubscriptionService> = {},
  capture?: Capture,
): SubscriptionService {
  const record = (input: object) => {
    const seen = input as Record<string, unknown>
    capture?.inputs.push(seen)
    if (seen.requestHash instanceof Uint8Array) {
      capture?.hashes.push(Buffer.from(seen.requestHash).toString('hex'))
    }
  }
  const transition: SubscriptionService['suspend'] = async (_personId, input) => {
    record(input)
    return {
      resource: { subscription_id: input.subscriptionId, status: 'suspended' },
      replayed: false,
    }
  }
  return {
    listOrganizationPlans: async () => ({ items: [], hasMore: false }),
    subscribe: async () => {
      throw new Error('not part of the studio surface')
    },
    readMine: async () => [],
    cancel: async () => {
      throw new Error('not part of the studio surface')
    },
    listOrganizationSubscriptions: async (_personId, input) => {
      record(input as unknown as Record<string, unknown>)
      return { items: [paying()], hasMore: false }
    },
    suspend: transition,
    reactivate: transition,
    end: transition,
    ...overrides,
  }
}

function app(subscriptions: SubscriptionService, session = sessions()): Hono {
  const routes = new Hono()
  routes.route('/studio/v1', studioPaymentRoutes({ subscriptions, sessions: session }))
  return routes
}

beforeEach(() => {
  process.env.STUDIO_WEB_URL = 'https://studio.example.test'
})

describe('listing who pays the organization', () => {
  test('returns the page with no fitness data in it', async () => {
    const response = await app(service()).request(
      `/studio/v1/organizations/${ORGANIZATION}/subscriptions`,
      { headers: HEADERS },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    const body = (await response.json()) as { data: unknown[]; page: Record<string, unknown> }
    expect(body.data).toEqual([paying()])
    expect(body.page).toEqual({ has_more: false, next_cursor: null })
  })

  test('issues a cursor only when there is another page, and reads it back', async () => {
    const capture: Capture = { hashes: [], inputs: [] }
    const paged = service(
      {
        listOrganizationSubscriptions: async (_personId, input) => {
          capture.inputs.push(input as unknown as Record<string, unknown>)
          return { items: [paying()], hasMore: true }
        },
      },
      capture,
    )

    const first = await app(paged).request(
      `/studio/v1/organizations/${ORGANIZATION}/subscriptions?limit=1`,
      { headers: HEADERS },
    )
    const firstBody = (await first.json()) as { page: { next_cursor: string } }
    expect(firstBody.page.next_cursor).toBeString()

    await app(paged).request(
      `/studio/v1/organizations/${ORGANIZATION}/subscriptions?cursor=${firstBody.page.next_cursor}`,
      { headers: HEADERS },
    )
    expect(capture.inputs.at(-1)).toMatchObject({
      cursorStatus: 'active',
      cursorStartedAt: '2026-10-12T14:00:00.000Z',
      cursorSubscriptionId: SUBSCRIPTION,
    })
  })

  test('refuses a cursor it cannot read rather than serving page one again', async () => {
    const response = await app(service()).request(
      `/studio/v1/organizations/${ORGANIZATION}/subscriptions?cursor=bm90LWEtY3Vyc29yLWF0LWFsbA`,
      { headers: HEADERS },
    )
    expect(response.status).toBe(422)
  })

  test('refuses a status that is not a subscription state', async () => {
    const response = await app(service()).request(
      `/studio/v1/organizations/${ORGANIZATION}/subscriptions?status=cancelled`,
      { headers: HEADERS },
    )
    expect(response.status).toBe(422)
  })

  test('passes a valid status through unchanged', async () => {
    const capture: Capture = { hashes: [], inputs: [] }
    await app(service({}, capture)).request(
      `/studio/v1/organizations/${ORGANIZATION}/subscriptions?status=suspended`,
      { headers: HEADERS },
    )
    expect(capture.inputs[0]).toMatchObject({ status: 'suspended' })
  })

  test('answers 404 when the database says the list is not there', async () => {
    const missing = service({
      listOrganizationSubscriptions: async () => {
        throw Object.assign(new Error('organization subscriptions not found'), { code: 'P0002' })
      },
    })
    const response = await app(missing).request(
      `/studio/v1/organizations/${ORGANIZATION}/subscriptions`,
      { headers: HEADERS },
    )
    expect(response.status).toBe(404)
  })
})

describe('the three transitions', () => {
  const paths = ['suspension', 'reactivation', 'termination'] as const

  for (const path of paths) {
    test(`${path} answers 200 with where the subscription stands`, async () => {
      const response = await app(service()).request(
        `/studio/v1/organizations/${ORGANIZATION}/subscriptions/${SUBSCRIPTION}/${path}`,
        { method: 'POST', headers: COMMAND },
      )

      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(await response.json()).toEqual({
        subscription_id: SUBSCRIPTION,
        status: 'suspended',
      })
    })

    test(`${path} refuses a request with no command headers`, async () => {
      const response = await app(service()).request(
        `/studio/v1/organizations/${ORGANIZATION}/subscriptions/${SUBSCRIPTION}/${path}`,
        { method: 'POST', headers: HEADERS },
      )
      expect(response.status).toBe(400)
    })

    test(`${path} refuses an id that is not a uuid`, async () => {
      const response = await app(service()).request(
        `/studio/v1/organizations/${ORGANIZATION}/subscriptions/not-a-uuid/${path}`,
        { method: 'POST', headers: COMMAND },
      )
      expect(response.status).toBe(400)
    })
  }

  /*
   * The assertion that stops one idempotency key from suspending one subscription and
   * terminating another. These requests carry no body, so if the hash did not cover the
   * path they would all hash the same thing and the second would come back as a replay of
   * the first.
   */
  test('hashes the path, so the same key cannot cross subscriptions or operations', async () => {
    const capture: Capture = { hashes: [], inputs: [] }
    const routes = app(service({}, capture))
    const base = `/studio/v1/organizations/${ORGANIZATION}/subscriptions`

    await routes.request(`${base}/${SUBSCRIPTION}/suspension`, {
      method: 'POST',
      headers: COMMAND,
    })
    await routes.request(`${base}/${OTHER_SUBSCRIPTION}/suspension`, {
      method: 'POST',
      headers: COMMAND,
    })

    expect(capture.hashes).toHaveLength(2)
    expect(capture.hashes[0]).not.toBe(capture.hashes[1])
  })

  test('a conflict from the database reaches the caller as 409', async () => {
    const conflicted = service({
      suspend: async () => {
        throw Object.assign(new Error('an ended subscription is not suspended'), {
          code: 'P0004',
        })
      },
    })
    const response = await app(conflicted).request(
      `/studio/v1/organizations/${ORGANIZATION}/subscriptions/${SUBSCRIPTION}/suspension`,
      { method: 'POST', headers: COMMAND },
    )
    expect(response.status).toBe(409)
  })

  test('an account that has not finished registering holds no capability', async () => {
    const incomplete = sessions({
      resolveActor: async () => ({ accountId: 'account' }),
    })
    const response = await app(service(), incomplete).request(
      `/studio/v1/organizations/${ORGANIZATION}/subscriptions/${SUBSCRIPTION}/suspension`,
      { method: 'POST', headers: COMMAND },
    )
    expect(response.status).toBe(403)
  })

  test('a request from another origin is refused before anything is read', async () => {
    const response = await app(service()).request(
      `/studio/v1/organizations/${ORGANIZATION}/subscriptions/${SUBSCRIPTION}/suspension`,
      {
        method: 'POST',
        headers: { ...COMMAND, origin: 'https://attacker.example.test' },
      },
    )
    expect(response.status).toBe(403)
  })

  test('a request with no session is unauthenticated', async () => {
    const response = await app(service()).request(
      `/studio/v1/organizations/${ORGANIZATION}/subscriptions/${SUBSCRIPTION}/suspension`,
      {
        method: 'POST',
        headers: {
          origin: 'https://studio.example.test',
          'idempotency-key': COMMAND['idempotency-key'],
          'command-id': COMMAND['command-id'],
        },
      },
    )
    expect(response.status).toBe(401)
  })
})
