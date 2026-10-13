/**
 * Allfit Pro routes on /space/v1: `OP-PAY-018..020` and `NEW-PAY-PRO-PAYMENTS`.
 *
 * `HU-SP-084..088`. The token is verified here and resolved to a person in the database;
 * nothing in a request names whose Pro this is. A purchase carries only what the store
 * needs to vouch for it, and the account it was bought for is read from the store's
 * answer, never from the request.
 */

import { StoreBillingError } from '@allfitone/store-billing'
import { Hono, type Context } from 'hono'

import { problem } from '../../../platform/http/index.js'
import {
  exactObject,
  isJsonRequest,
  readJson,
  spaceCommand,
  spaceFailure,
  spaceTokenVerifier,
  verifiedSpaceToken,
  type TokenVerifier,
} from '../../../platform/http/space-requests.js'
import {
  SpaceActorError,
  spaceActorResolver,
  type SpaceActorResolver,
} from '../../identity/index.js'
import type { ProService } from '../application/pro.js'
import { proService } from '../dependencies.js'
import {
  MAX_PURCHASE_TOKEN,
  MAX_SIGNED_TRANSACTION,
  STORE_PRODUCT_ID,
  type ProPurchaseRequest,
} from '../domain/pro.js'

const OPERATION = 'space-pro'

export function spaceProRoutes(
  injectedService?: ProService,
  injectedVerifier?: TokenVerifier,
  injectedActors?: SpaceActorResolver,
): Hono {
  const pro = () => injectedService ?? proService()
  const verify = injectedVerifier ?? spaceTokenVerifier()
  const actors = () => injectedActors ?? spaceActorResolver()
  const routes = new Hono()

  routes.use('*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
  })

  // The person behind the token, or the response that refuses the request.
  async function reader(c: Context) {
    const token = await verifiedSpaceToken(c, verify)
    if (!token) return problem(c, 'unauthenticated')
    try {
      return { personId: await actors().personFor(token.subject), requestId: crypto.randomUUID() }
    } catch (error) {
      if (error instanceof SpaceActorError) return problem(c, 'forbidden')
      return spaceFailure(c, error, OPERATION)
    }
  }

  routes.get('/pro', async (c) => {
    const person = await reader(c)
    if (person instanceof Response) return person
    try {
      return c.json(await pro().read(person))
    } catch (error) {
      return spaceFailure(c, error, OPERATION)
    }
  })

  routes.get('/pro/plans', async (c) => {
    const person = await reader(c)
    if (person instanceof Response) return person
    try {
      return c.json(await pro().plans(person))
    } catch (error) {
      return spaceFailure(c, error, OPERATION)
    }
  })

  routes.get('/pro/payments', async (c) => {
    const person = await reader(c)
    if (person instanceof Response) return person
    try {
      return c.json(await pro().payments(person))
    } catch (error) {
      return spaceFailure(c, error, OPERATION)
    }
  })

  routes.post('/pro/purchases', async (c) => {
    const person = await reader(c)
    if (person instanceof Response) return person
    if (!isJsonRequest(c)) return problem(c, 'invalid-request')
    const purchase = purchaseRequest(await readJson(c))
    if (!purchase) return problem(c, 'invalid-request')
    const command = spaceCommand(c, purchase)
    if (!command) return problem(c, 'invalid-request')

    try {
      const result = await pro().purchase(person, purchase, command)
      if (result.replayed) c.header('Idempotent-Replay', 'true')
      return c.json(result.resource, 201)
    } catch (error) {
      if (error instanceof StoreBillingError) return problem(c, storeProblem(error))
      return spaceFailure(c, error, OPERATION)
    }
  })

  return routes
}

function purchaseRequest(body: unknown): ProPurchaseRequest | undefined {
  const apple = exactObject(body, ['store', 'signed_transaction'])
  if (apple) {
    const signed = apple.signed_transaction
    if (apple.store !== 'app_store' || typeof signed !== 'string') return undefined
    if (signed.length === 0 || signed.length > MAX_SIGNED_TRANSACTION) return undefined
    return { store: 'app_store', signed_transaction: signed }
  }
  const google = exactObject(body, ['store', 'product_id', 'purchase_token'])
  if (!google || google.store !== 'google_play') return undefined
  const { product_id: productId, purchase_token: token } = google
  if (typeof productId !== 'string' || !STORE_PRODUCT_ID.test(productId)) return undefined
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_PURCHASE_TOKEN) {
    return undefined
  }
  return { store: 'google_play', product_id: productId, purchase_token: token }
}

// A purchase the store would not vouch for is the request's fault; the rest is not.
export function storeProblem(error: StoreBillingError) {
  if (error.failure === 'invalid') return 'validation-failed' as const
  if (error.failure === 'not-configured') return 'service-degraded' as const
  return 'upstream-unavailable' as const
}
