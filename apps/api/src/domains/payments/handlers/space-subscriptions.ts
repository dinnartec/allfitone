/**
 * `/space/v1`: the plans a gym offers the person, and what she pays.
 *
 * **Nothing here is a payment.** No card data reaches this process: the checkout is
 * opened against the organization's own gateway, and what `POST /subscriptions` returns
 * is the price and the provider — never an account reference and never a credential.
 *
 * A plan version she cannot see and one that is not on offer answer the same 404. That is
 * the function's choice, not a shortcut: telling her a price exists at a gym she has no
 * relationship with already tells her the gym has prices.
 *
 * Reads are `private, no-store`. The plan list is cacheable for presentation, but the
 * subscription command confirms the price itself, so a stale screen cannot make somebody
 * agree to a number that moved.
 *
 * Separate from `space.ts`, which serves Allfit Pro. A person pays for two unrelated
 * things on this surface: Pro is bought in a store and belongs to the platform, and a
 * plan is a price the gym sets and charges through its own gateway.
 */

import { createHash } from 'node:crypto'
import type { VerifiedToken } from '@allfitone/auth-provider'
import { Hono, type Context } from 'hono'

import { authProvider } from '../../../platform/auth/index.js'
import { fail } from '../../../platform/http/index.js'
import {
  SpaceActorError,
  spaceActorResolver,
  type SpaceActorResolver,
} from '../../identity/index.js'
import { subscriptionService } from '../dependencies.js'
import type { SubscriptionService } from '../application/subscriptions.js'
import { PLAN_PAGE_LIMIT } from '../domain/subscriptions.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type TokenVerifier = (token: string) => Promise<VerifiedToken>

export function spacePaymentRoutes(
  injectedService?: SubscriptionService,
  injectedVerifier?: TokenVerifier,
  injectedActors?: SpaceActorResolver,
): Hono {
  const subscriptions = () => injectedService ?? subscriptionService()
  const actors = () => injectedActors ?? spaceActorResolver()
  const verify: TokenVerifier =
    injectedVerifier ?? ((token) => authProvider().verifyAccessToken(token, 'space'))
  const routes = new Hono()
  const requestId = (c: Context) => c.req.header('x-request-id') ?? ''

  const person = async (c: Context): Promise<string | Response> => {
    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')
    try {
      return await actors().personFor(token.subject)
    } catch (cause) {
      return failure(c, cause)
    }
  }

  /*
   * OP-PAY-011. Which plans come back is the row policy's decision: published versions
   * for a client of that gym, nothing at all for anybody else. This route adds no filter
   * of its own, so there is no second place for "only published" to go out of step.
   */
  routes.get('/organizations/:organizationId/plans', async (c) => {
    c.header('Cache-Control', 'private, no-store')
    const organizationId = c.req.param('organizationId')
    if (!UUID.test(organizationId)) return fail(c, 'invalid-request')

    const limit = parseLimit(c.req.query('limit'))
    if (!limit) return fail(c, 'validation-failed')
    const cursor = parsePlanCursor(c.req.query('cursor'))
    if (cursor === null) return fail(c, 'validation-failed')

    const personId = await person(c)
    if (personId instanceof Response) return personId

    try {
      const page = await subscriptions().listOrganizationPlans(personId, {
        organizationId,
        limit,
        requestId: requestId(c),
        ...(cursor ?? {}),
      })
      const last = page.items.at(-1)
      return c.json({
        data: page.items,
        page: {
          has_more: page.hasMore,
          next_cursor:
            page.hasMore && last
              ? encodeCursor([String(last.amount_minor), last.plan_version_id])
              : null,
        },
      })
    } catch (cause) {
      return failure(c, cause)
    }
  })

  /* OP-PAY-013. Her live subscriptions, with no card data because none exists. */
  routes.get('/subscriptions', async (c) => {
    c.header('Cache-Control', 'private, no-store')
    const personId = await person(c)
    if (personId instanceof Response) return personId

    try {
      const data = await subscriptions().readMine(personId, { requestId: requestId(c) })
      return c.json({ data })
    } catch (cause) {
      return failure(c, cause)
    }
  })

  /*
   * OP-PAY-012. Freezes the exact plan version, which is why the body names a version and
   * not a plan: a plan has no price, and sending one would leave which price was agreed to
   * chance.
   */
  routes.post('/subscriptions', async (c) => {
    c.header('Cache-Control', 'no-store')
    const body = await readJson(c)
    if (!isSubscriptionCreate(body)) return fail(c, 'validation-failed')
    const command = commandContext(c, body)
    if (!command) return fail(c, 'invalid-request', 'valid command headers are required')

    const personId = await person(c)
    if (personId instanceof Response) return personId

    try {
      const result = await subscriptions().subscribe(personId, {
        planVersionId: body.plan_version_id,
        requestId: requestId(c),
        ...command,
      })
      if (result.replayed) {
        c.header('Idempotent-Replay', 'true')
        return c.json(result.resource)
      }
      return c.json(result.resource, 201)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  /*
   * OP-PAY-015. Ends the money and nothing else: no permission is revoked, no
   * relationship ends, no history is touched. Those are OP-PRV-005 and OP-REL-007, and
   * they are separate decisions on purpose.
   */
  routes.post('/subscriptions/:subscriptionId/cancellation', async (c) => {
    c.header('Cache-Control', 'no-store')
    const subscriptionId = c.req.param('subscriptionId')
    if (!UUID.test(subscriptionId)) return fail(c, 'invalid-request')
    // No body, so the request hash is over the path: two cancellations of different
    // subscriptions must not collide on one idempotency key.
    const command = commandContext(c, { subscription_id: subscriptionId })
    if (!command) return fail(c, 'invalid-request', 'valid command headers are required')

    const personId = await person(c)
    if (personId instanceof Response) return personId

    try {
      const result = await subscriptions().cancel(personId, {
        subscriptionId,
        requestId: requestId(c),
        ...command,
      })
      return c.json(result.resource)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  return routes
}

async function verified(c: Context, verify: TokenVerifier): Promise<VerifiedToken | undefined> {
  const [scheme, value] = (c.req.header('authorization') ?? '').split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !value) return undefined
  try {
    return await verify(value)
  } catch {
    return undefined
  }
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return undefined
  }
}

function commandContext(c: Context, body: unknown) {
  const idempotencyKey = c.req.header('idempotency-key') ?? ''
  const commandId = c.req.header('command-id') ?? ''
  if (!UUID_V4.test(idempotencyKey) || !UUID_V7.test(commandId)) return undefined
  return {
    idempotencyKey,
    commandId,
    requestHash: createHash('sha256').update(canonicalJson(body)).digest(),
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isObject(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSubscriptionCreate(value: unknown): value is { plan_version_id: string } {
  return (
    isObject(value) &&
    Object.keys(value).join(',') === 'plan_version_id' &&
    typeof value.plan_version_id === 'string' &&
    UUID.test(value.plan_version_id)
  )
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return PLAN_PAGE_LIMIT.default
  if (!/^[1-9][0-9]*$/.test(value)) return undefined
  const parsed = Number(value)
  return parsed <= PLAN_PAGE_LIMIT.max ? parsed : undefined
}

/**
 * `undefined` is no cursor, `null` is a cursor that could not be read. Collapsing the two
 * would silently serve page one to somebody paging forward.
 */
function parsePlanCursor(
  value: string | undefined,
): { cursorAmountMinor: number; cursorVersionId: string } | null | undefined {
  if (value === undefined) return undefined
  const parts = decodeCursor(value)
  if (!parts || parts.length !== 2) return null
  const [amount, versionId] = parts
  if (!amount || !/^[1-9][0-9]{0,17}$/.test(amount)) return null
  if (!versionId || !UUID.test(versionId)) return null
  return { cursorAmountMinor: Number(amount), cursorVersionId: versionId }
}

/*
 * Base64url over a unit-separated list. The separator is `\u001f` and not a comma because
 * a display name reached a cursor once in this repository and split it in half; nothing
 * here carries a name today, and the next field added should not have to remember that.
 */
function encodeCursor(parts: string[]): string {
  return Buffer.from(parts.join('\u001f'), 'utf8').toString('base64url')
}

function decodeCursor(value: string): string[] | undefined {
  if (!/^[A-Za-z0-9_-]{8,1024}$/.test(value)) return undefined
  try {
    return Buffer.from(value, 'base64url').toString('utf8').split('\u001f')
  } catch {
    return undefined
  }
}

function failure(c: Parameters<typeof fail>[0], error: unknown): Response {
  if (error instanceof SpaceActorError) return fail(c, error.code)
  const sqlState = isObject(error) && typeof error.code === 'string' ? error.code : undefined
  if (sqlState === '42501') return fail(c, 'forbidden')
  if (sqlState === 'P0002') return fail(c, 'not-found')
  if (sqlState === 'P0004' || sqlState === '23505' || sqlState === '40001') {
    return fail(c, 'conflict')
  }
  if (sqlState === '22023' || sqlState === '23514' || sqlState === '22P02') {
    return fail(c, 'validation-failed')
  }
  console.error('[space-payments] operation failed')
  return fail(c, 'upstream-unavailable')
}
