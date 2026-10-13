/**
 * `T-PAY-API-02` — the Space side of a subscription against the contract.
 *
 * Two assertions here carry real weight and the rest are shape checks:
 *
 * * **No account reference and no credential leave this surface.** The response body is
 *   compared whole, so a field added to the checkout payload has to come here and be
 *   named before it can reach a client.
 * * **A replay answers 200 and says so.** A `201` on a retry is how an app that lost the
 *   first response ends up believing it created a second subscription.
 */

import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { VerifiedToken } from '@allfitone/auth-provider'
import type { SpaceActorResolver } from '../../identity/index.js'
import type { SubscriptionService } from '../application/subscriptions.js'
import type { OrganizationPlanOffer, Subscription } from '../domain/subscriptions.js'
import { spacePaymentRoutes } from './space.js'

const ORGANIZATION = '019c4000-0000-7000-8000-000000000101'
const PERSON = '019c4000-0000-7000-8000-000000000002'
const VERSION = '019c4000-0000-7000-8000-000000000501'
const SUBSCRIPTION = '019c4000-0000-7000-8000-000000000601'
const AUTH = { authorization: 'Bearer token' }
const COMMAND = {
  ...AUTH,
  'content-type': 'application/json',
  'idempotency-key': '7f1d3c9e-4a2b-4c6d-8e5f-0a1b2c3d4e5f',
  'command-id': '019c4000-0000-7000-8000-0000000000aa',
}

const verifier = async (): Promise<VerifiedToken> =>
  ({ subject: 'auth0|carla', sessionId: 'session' }) as VerifiedToken

const actors: SpaceActorResolver = { personFor: async () => PERSON } as SpaceActorResolver

function offer(overrides: Partial<OrganizationPlanOffer> = {}): OrganizationPlanOffer {
  return {
    plan_id: '019c4000-0000-7000-8000-000000000401',
    plan_version_id: VERSION,
    plan_name: 'Mensual',
    version_number: 2,
    amount_minor: 12000000,
    currency_code: 'COP',
    billing_period: 'month',
    published_at: '2026-10-01T12:00:00.000Z',
    ...overrides,
  }
}

function mine(overrides: Partial<Subscription> = {}): Subscription {
  return {
    subscription_id: SUBSCRIPTION,
    organization_id: ORGANIZATION,
    organization_name: 'Gimnasio Uno',
    plan_name: 'Mensual',
    plan_version_id: VERSION,
    amount_minor: 12000000,
    currency_code: 'COP',
    billing_period: 'month',
    status: 'suspended',
    current_period_end: null,
    started_at: '2026-10-12T14:00:00.000Z',
    suspended_at: '2026-10-20T09:00:00.000Z',
    blocked_since: '2026-10-20T09:00:00.000Z',
    ...overrides,
  }
}

type Capture = { inputs: Record<string, unknown>[] }

function service(
  overrides: Partial<SubscriptionService> = {},
  capture?: Capture,
): SubscriptionService {
  const record = (input: unknown) => capture?.inputs.push(input as Record<string, unknown>)
  return {
    listOrganizationPlans: async (_personId, input) => {
      record(input)
      return { items: [offer()], hasMore: false }
    },
    subscribe: async (_personId, input) => {
      record(input)
      return {
        resource: {
          subscription_id: SUBSCRIPTION,
          organization_id: ORGANIZATION,
          plan_version_id: VERSION,
          plan_name: 'Mensual',
          amount_minor: 12000000,
          currency_code: 'COP',
          billing_period: 'month',
          provider: 'mercado_pago',
        },
        replayed: false,
      }
    },
    readMine: async (_personId, input) => {
      record(input)
      return [mine()]
    },
    cancel: async (_personId, input) => {
      record(input)
      return { resource: { subscription_id: SUBSCRIPTION, status: 'ended' }, replayed: false }
    },
    listOrganizationSubscriptions: async () => ({ items: [], hasMore: false }),
    suspend: async () => {
      throw new Error('not part of the space surface')
    },
    reactivate: async () => {
      throw new Error('not part of the space surface')
    },
    end: async () => {
      throw new Error('not part of the space surface')
    },
    ...overrides,
  }
}

function app(subscriptions: SubscriptionService): Hono {
  const routes = new Hono()
  routes.route('/space/v1', spacePaymentRoutes(subscriptions, verifier, actors))
  return routes
}

describe('the plans a gym offers', () => {
  test('returns the published versions, cheapest first', async () => {
    const response = await app(service()).request(`/space/v1/organizations/${ORGANIZATION}/plans`, {
      headers: AUTH,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    const body = (await response.json()) as { data: unknown[]; page: Record<string, unknown> }
    expect(body.data).toEqual([offer()])
    expect(body.page).toEqual({ has_more: false, next_cursor: null })
  })

  test('reads its own cursor back', async () => {
    const capture: Capture = { inputs: [] }
    const paged = service(
      {
        listOrganizationPlans: async (_personId, input) => {
          capture.inputs.push(input as unknown as Record<string, unknown>)
          return { items: [offer()], hasMore: true }
        },
      },
      capture,
    )

    const first = await app(paged).request(
      `/space/v1/organizations/${ORGANIZATION}/plans?limit=1`,
      { headers: AUTH },
    )
    const firstBody = (await first.json()) as { page: { next_cursor: string } }

    await app(paged).request(
      `/space/v1/organizations/${ORGANIZATION}/plans?cursor=${firstBody.page.next_cursor}`,
      { headers: AUTH },
    )
    expect(capture.inputs.at(-1)).toMatchObject({
      cursorAmountMinor: 12000000,
      cursorVersionId: VERSION,
    })
  })

  test('a gym she has no relationship with answers an empty page, not a refusal', async () => {
    const none = service({ listOrganizationPlans: async () => ({ items: [], hasMore: false }) })
    const response = await app(none).request(`/space/v1/organizations/${ORGANIZATION}/plans`, {
      headers: AUTH,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: [],
      page: { has_more: false, next_cursor: null },
    })
  })

  test('refuses a limit past the maximum', async () => {
    const response = await app(service()).request(
      `/space/v1/organizations/${ORGANIZATION}/plans?limit=101`,
      { headers: AUTH },
    )
    expect(response.status).toBe(422)
  })

  test('a request with no bearer token is unauthenticated', async () => {
    const response = await app(service()).request(`/space/v1/organizations/${ORGANIZATION}/plans`)
    expect(response.status).toBe(401)
  })
})

describe('subscribing', () => {
  test('answers 201 with the price and the provider, and nothing else', async () => {
    const response = await app(service()).request('/space/v1/subscriptions', {
      method: 'POST',
      headers: COMMAND,
      body: JSON.stringify({ plan_version_id: VERSION }),
    })

    expect(response.status).toBe(201)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    // Compared whole on purpose: an account reference or a credential added to this
    // payload later has to be named here before it can reach a client.
    expect(await response.json()).toEqual({
      subscription_id: SUBSCRIPTION,
      organization_id: ORGANIZATION,
      plan_version_id: VERSION,
      plan_name: 'Mensual',
      amount_minor: 12000000,
      currency_code: 'COP',
      billing_period: 'month',
      provider: 'mercado_pago',
    })
  })

  test('a replay answers 200 and says so, so no app believes it created a second one', async () => {
    const replayed = service({
      subscribe: async () => ({
        resource: {
          subscription_id: SUBSCRIPTION,
          organization_id: ORGANIZATION,
          plan_version_id: VERSION,
          plan_name: 'Mensual',
          amount_minor: 12000000,
          currency_code: 'COP',
          billing_period: 'month',
          provider: 'mercado_pago',
        },
        replayed: true,
      }),
    })
    const response = await app(replayed).request('/space/v1/subscriptions', {
      method: 'POST',
      headers: COMMAND,
      body: JSON.stringify({ plan_version_id: VERSION }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Idempotent-Replay')).toBe('true')
  })

  test('refuses a body that names a plan instead of a version', async () => {
    const response = await app(service()).request('/space/v1/subscriptions', {
      method: 'POST',
      headers: COMMAND,
      body: JSON.stringify({ plan_id: VERSION }),
    })
    expect(response.status).toBe(422)
  })

  test('refuses a body with an extra field', async () => {
    const response = await app(service()).request('/space/v1/subscriptions', {
      method: 'POST',
      headers: COMMAND,
      body: JSON.stringify({ plan_version_id: VERSION, amount_minor: 1 }),
    })
    expect(response.status).toBe(422)
  })

  test('a version that is not on offer is not found', async () => {
    const missing = service({
      subscribe: async () => {
        throw Object.assign(new Error('plan version not found'), { code: 'P0002' })
      },
    })
    const response = await app(missing).request('/space/v1/subscriptions', {
      method: 'POST',
      headers: COMMAND,
      body: JSON.stringify({ plan_version_id: VERSION }),
    })
    expect(response.status).toBe(404)
  })

  test('a gym with no gateway is a conflict, because there would be nowhere to charge', async () => {
    const unpayable = service({
      subscribe: async () => {
        throw Object.assign(new Error('this organization cannot take a payment yet'), {
          code: 'P0004',
        })
      },
    })
    const response = await app(unpayable).request('/space/v1/subscriptions', {
      method: 'POST',
      headers: COMMAND,
      body: JSON.stringify({ plan_version_id: VERSION }),
    })
    expect(response.status).toBe(409)
  })
})

describe('what I pay and cancelling it', () => {
  test('returns her live subscriptions with no card data of any kind', async () => {
    const response = await app(service()).request('/space/v1/subscriptions', { headers: AUTH })

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ data: [mine()] })
  })

  test('says since when access is paused, which is the only thing a block shows her', async () => {
    const response = await app(service()).request('/space/v1/subscriptions', { headers: AUTH })
    const body = (await response.json()) as { data: Subscription[] }
    expect(body.data[0]?.blocked_since).toBe('2026-10-20T09:00:00.000Z')
    expect(body.data[0]?.status).toBe('suspended')
  })

  test('cancelling answers where the subscription stands', async () => {
    const response = await app(service()).request(
      `/space/v1/subscriptions/${SUBSCRIPTION}/cancellation`,
      { method: 'POST', headers: COMMAND },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      subscription_id: SUBSCRIPTION,
      status: 'ended',
    })
  })

  /*
   * Without this, one idempotency key would cancel whichever subscription the second
   * request happened to name, because neither request carries a body to tell them apart.
   */
  test('cancelling hashes the subscription, so one key cannot cancel two', async () => {
    const capture: Capture = { inputs: [] }
    const routes = app(service({}, capture))

    await routes.request(`/space/v1/subscriptions/${SUBSCRIPTION}/cancellation`, {
      method: 'POST',
      headers: COMMAND,
    })
    await routes.request(
      '/space/v1/subscriptions/019c4000-0000-7000-8000-000000000602/cancellation',
      { method: 'POST', headers: COMMAND },
    )

    const hashes = capture.inputs.map((input) =>
      Buffer.from(input.requestHash as Uint8Array).toString('hex'),
    )
    expect(hashes).toHaveLength(2)
    expect(hashes[0]).not.toBe(hashes[1])
  })

  test('somebody else’s subscription is not found', async () => {
    const missing = service({
      cancel: async () => {
        throw Object.assign(new Error('subscription not found'), { code: 'P0002' })
      },
    })
    const response = await app(missing).request(
      `/space/v1/subscriptions/${SUBSCRIPTION}/cancellation`,
      { method: 'POST', headers: COMMAND },
    )
    expect(response.status).toBe(404)
  })

  test('refuses a cancellation with no command headers', async () => {
    const response = await app(service()).request(
      `/space/v1/subscriptions/${SUBSCRIPTION}/cancellation`,
      { method: 'POST', headers: AUTH },
    )
    expect(response.status).toBe(400)
  })
})
