import { describe, expect, test } from 'bun:test'
import { allfitV1ContractManifest } from '@allfitone/contracts'
import { StoreBillingError } from '@allfitone/store-billing'
import { Hono } from 'hono'

import { createApp } from '../../../application.js'
import { mountSurfaces } from '../../../surfaces.js'
import { SpaceActorError, type SpaceActorResolver } from '../../identity/index.js'
import type { ProService } from '../application/pro.js'
import type { ProStatus } from '../domain/pro.js'
import { spaceProRoutes } from './space.js'
import { storeWebhookRoutes } from './webhooks.js'

const PERSON = '019f1000-0000-7000-8000-000000000001'
const KEY = '51111111-1111-4111-8111-111111111111'
const COMMAND = '019f1000-0000-7000-8000-000000000201'

const status: ProStatus = {
  generated_at: '2026-10-12T12:00:00Z',
  account_token: PERSON,
  effective_source: 'organization',
  is_pro: true,
  plan: {
    id: '019f1000-0000-7000-8000-000000000301',
    code: 'pro',
    name: 'Pro',
    kind: 'paid',
    version_id: '019f1000-0000-7000-8000-000000000302',
    version_number: 1,
  },
  features: [],
  sources: [
    {
      kind: 'organization',
      organization_id: '019f1000-0000-7000-8000-000000000401',
      organization_name: 'Bodytech',
    },
  ],
}

function service(overrides: Partial<ProService> = {}): ProService {
  return {
    read: async () => status,
    plans: async () => ({ generated_at: '2026-10-12T12:00:00Z', plans: [] }),
    payments: async () => ({ generated_at: '2026-10-12T12:00:00Z', payments: [] }),
    purchase: async () => ({ resource: status, replayed: false }),
    appStoreNotification: async () => 'processed',
    googlePlayNotification: async () => 'processed',
    ...overrides,
  }
}

function harness(overrides: Partial<ProService> = {}, actorFails = false): Hono {
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
    spaceProRoutes(
      service(overrides),
      async () => ({ subject: 'sub', sessionId: 'sid', surface: 'space' as const }),
      actors,
    ),
  )
  app.route('/webhooks', storeWebhookRoutes(service(overrides)))
  return app
}

const authorized = { authorization: 'Bearer token' }
const commanded = {
  ...authorized,
  'content-type': 'application/json',
  'idempotency-key': KEY,
  'command-id': COMMAND,
}
const apple = { store: 'app_store', signed_transaction: 'header.payload.signature' }

function send(
  app: Hono,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) {
  return app.request(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  })
}

describe('Allfit Pro on Space', () => {
  test("T-PAY-PRO-API-01 declares the person's Pro operations", () => {
    const declared = allfitV1ContractManifest.operations
      .filter(
        (operation) =>
          operation.path === '/space/v1/pro' || operation.path.startsWith('/space/v1/pro/'),
      )
      .map((operation) => operation.allfitOperation)
    expect([...new Set(declared)].sort()).toEqual([
      'NEW-PAY-PRO-PAYMENTS',
      'OP-PAY-018',
      'OP-PAY-019',
      'OP-PAY-020',
    ])
  })

  test('T-PAY-PRO-API-02 mounts below the real Space prefix, and the store webhooks beside WorkOS', () => {
    const surfaces = new Hono()
    mountSurfaces(surfaces)
    const mounted = surfaces.routes.map((route) => `${route.method} ${route.path}`)
    expect(mounted).toContain('GET /space/v1/pro')
    expect(mounted).toContain('GET /space/v1/pro/plans')
    expect(mounted).toContain('GET /space/v1/pro/payments')
    expect(mounted).toContain('POST /space/v1/pro/purchases')

    const application = createApp().routes.map((route) => `${route.method} ${route.path}`)
    expect(application).toContain('POST /webhooks/app-store')
    expect(application).toContain('POST /webhooks/google-play')
    const exclusions = allfitV1ContractManifest.exclusions.map(
      (route) => `${route.method} ${route.path}`,
    )
    expect(exclusions).toContain('POST /webhooks/app-store')
    expect(exclusions).toContain('POST /webhooks/google-play')
  })

  test('T-PAY-PRO-API-03 nothing is read without a token, or for an account without a person', async () => {
    const anonymous = await send(harness(), 'GET', '/space/v1/pro', {})
    const unregistered = await send(harness({}, true), 'GET', '/space/v1/pro', authorized)
    expect(anonymous.status).toBe(401)
    expect(unregistered.status).toBe(403)
  })

  test('T-PAY-PRO-API-04 reads Pro, the plans and the payments for the person behind the token, out of any cache', async () => {
    let asked: string | undefined
    const app = harness({
      read: async (reader) => {
        asked = reader.personId
        return status
      },
    })
    const response = await send(app, 'GET', '/space/v1/pro', authorized)
    const plans = await send(app, 'GET', '/space/v1/pro/plans', authorized)
    const payments = await send(app, 'GET', '/space/v1/pro/payments', authorized)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual(status)
    expect(asked).toBe(PERSON)
    expect(plans.status).toBe(200)
    expect(payments.status).toBe(200)
  })

  test('T-PAY-PRO-API-05 a purchase names its store and only what that store needs', async () => {
    const app = harness()
    const bad = [
      { store: 'app_store' },
      { store: 'app_store', signed_transaction: '' },
      { ...apple, account_token: PERSON },
      { store: 'google_play', product_id: 'allfit.pro.monthly.v1' },
      { store: 'google_play', product_id: 'no spaces', purchase_token: 'token' },
      { store: 'mercado_pago', purchase_token: 'token' },
    ]
    for (const body of bad) {
      expect((await send(app, 'POST', '/space/v1/pro/purchases', commanded, body)).status).toBe(400)
    }
  })

  test('T-PAY-PRO-API-06 a purchase is a command: it needs its idempotency key and command id', async () => {
    const { 'command-id': _omitted, ...withoutCommand } = commanded
    const response = await send(harness(), 'POST', '/space/v1/pro/purchases', withoutCommand, apple)
    expect(response.status).toBe(400)
  })

  test('T-PAY-PRO-API-07 a verified purchase answers the person’s Pro, and a replay says so', async () => {
    let received: unknown
    const app = harness({
      purchase: async (reader, request) => {
        received = { reader: reader.personId, request }
        return { resource: status, replayed: true }
      },
    })
    const response = await send(app, 'POST', '/space/v1/pro/purchases', commanded, apple)
    expect(response.status).toBe(201)
    expect(response.headers.get('idempotent-replay')).toBe('true')
    expect(received).toEqual({ reader: PERSON, request: apple })
  })

  test('T-PAY-PRO-API-08 what the store would not vouch for is refused; a store that cannot answer is not the request’s fault', async () => {
    const failing = (failure: 'invalid' | 'unavailable' | 'not-configured') =>
      harness({
        purchase: async () => {
          throw new StoreBillingError(failure)
        },
      })
    const post = (app: Hono) => send(app, 'POST', '/space/v1/pro/purchases', commanded, apple)
    expect((await post(failing('invalid'))).status).toBe(422)
    expect((await post(failing('unavailable'))).status).toBe(503)
    expect((await post(failing('not-configured'))).status).toBe(503)
  })

  test('T-PAY-PRO-API-09 a purchase another person owns is a conflict, one for another account is forbidden', async () => {
    const database = (code: string) =>
      harness({
        purchase: async () => {
          throw Object.assign(new Error('database'), { code })
        },
      })
    const post = (app: Hono) => send(app, 'POST', '/space/v1/pro/purchases', commanded, apple)
    expect((await post(database('23505'))).status).toBe(409)
    expect((await post(database('42501'))).status).toBe(403)
    expect((await post(database('22023'))).status).toBe(422)
  })
})

describe('Store notifications', () => {
  test('T-PAY-PRO-API-10 Apple: a notification taken is 200, one without a payload or not signed by Apple is 400', async () => {
    let payload: string | undefined
    const app = harness({
      appStoreNotification: async (signed) => {
        payload = signed
        return 'stale'
      },
    })
    const json = { 'content-type': 'application/json' }
    expect(
      (await send(app, 'POST', '/webhooks/app-store', json, { signedPayload: 'jws' })).status,
    ).toBe(200)
    expect(payload).toBe('jws')
    expect((await send(app, 'POST', '/webhooks/app-store', json, {})).status).toBe(400)
    expect((await send(app, 'POST', '/webhooks/app-store', json, 'not json')).status).toBe(400)

    const unsigned = harness({
      appStoreNotification: async () => {
        throw new StoreBillingError('invalid')
      },
    })
    expect(
      (await send(unsigned, 'POST', '/webhooks/app-store', json, { signedPayload: 'x' })).status,
    ).toBe(400)
  })

  test('T-PAY-PRO-API-11 Google: the bearer and the raw body reach the verifier untouched', async () => {
    let seen: unknown
    const app = harness({
      googlePlayNotification: async (authorization, body) => {
        seen = { authorization, body }
        return 'processed'
      },
    })
    const body = '{"message":{"messageId":"1","data":"e30="}}'
    const response = await send(
      app,
      'POST',
      '/webhooks/google-play',
      { authorization: 'Bearer oidc' },
      body,
    )
    expect(response.status).toBe(200)
    expect(seen).toEqual({ authorization: 'Bearer oidc', body })
  })

  test('T-PAY-PRO-API-12 a notification that could not be applied asks the store to deliver it again', async () => {
    const app = harness({
      googlePlayNotification: async () => {
        throw new StoreBillingError('unavailable')
      },
      appStoreNotification: async () => {
        throw new Error('database down')
      },
    })
    const json = { 'content-type': 'application/json' }
    expect((await send(app, 'POST', '/webhooks/google-play', {}, '{}')).status).toBe(503)
    expect(
      (await send(app, 'POST', '/webhooks/app-store', json, { signedPayload: 'x' })).status,
    ).toBe(503)
  })
})
