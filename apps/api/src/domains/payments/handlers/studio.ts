/**
 * `/studio/v1`: who pays the organization, and the three things it can do about it.
 *
 * **`manage_billing` or nothing.** A coach does not reach any of this even for a client
 * assigned to them, and the refusal is a 404 rather than a 403: a 403 would confirm that
 * the organization has subscriptions, which is already what the capability withholds.
 *
 * Suspending opens a reversible cause and revokes nothing. That is not this file's doing
 * — it is `IX-40`, decided in the closed function — but it is the reason these three
 * routes look as plain as they do: there is no restore path to write, because nothing was
 * taken away.
 */

import { createHash } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { cors } from 'hono/cors'

import {
  STUDIO_SESSION_COOKIE,
  StudioSessionError,
  type StudioSessionService,
  studioSessionService,
  trustedStudioWebUrl,
} from '../../identity/index.js'
import { fail } from '../../../platform/http/index.js'
import { subscriptionService } from '../dependencies.js'
import type { SubscriptionService } from '../application/subscriptions.js'
import {
  PLAN_PAGE_LIMIT,
  SUBSCRIPTION_STATUSES,
  type SubscriptionStatus,
} from '../domain/subscriptions.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STATUSES = new Set<SubscriptionStatus>(SUBSCRIPTION_STATUSES)
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/

export interface StudioPaymentDependencies {
  readonly subscriptions?: SubscriptionService
  readonly sessions?: StudioSessionService
}

export function studioPaymentRoutes(injected: StudioPaymentDependencies = {}): Hono {
  const studioOrigin = new URL(trustedStudioWebUrl()).origin
  const subscriptions = () => injected.subscriptions ?? subscriptionService()
  const sessions = () => injected.sessions ?? studioSessionService()
  const routes = new Hono()
  const requestId = (c: Context) => c.req.header('x-request-id') ?? ''

  routes.use(
    '*',
    cors({
      origin: studioOrigin,
      credentials: true,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Idempotency-Key', 'Command-Id'],
      maxAge: 600,
    }),
  )

  /* OP-PAY-007. Identity and payment state, and no fitness data of any kind. */
  routes.get('/organizations/:organizationId/subscriptions', async (c) => {
    c.header('Cache-Control', 'private, no-store')
    if (c.req.header('origin') !== studioOrigin) {
      return fail(c, 'forbidden', 'origin is not allowed')
    }
    const organizationId = c.req.param('organizationId')
    if (!UUID.test(organizationId)) return fail(c, 'invalid-request')

    const statusValue = c.req.query('status')
    const status =
      statusValue && STATUSES.has(statusValue as SubscriptionStatus)
        ? (statusValue as SubscriptionStatus)
        : undefined
    if (statusValue && !status) return fail(c, 'validation-failed')

    const limit = parseLimit(c.req.query('limit'))
    if (!limit) return fail(c, 'validation-failed')
    const cursor = parseSubscriptionCursor(c.req.query('cursor'))
    if (cursor === null) return fail(c, 'validation-failed')

    try {
      const personId = await actingPerson(c, sessions())
      if (personId instanceof Response) return personId
      const page = await subscriptions().listOrganizationSubscriptions(personId, {
        organizationId,
        ...(status ? { status } : {}),
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
              ? encodeCursor([last.status, last.started_at, last.subscription_id])
              : null,
        },
      })
    } catch (error) {
      return failure(c, error)
    }
  })

  /*
   * OP-PAY-008. Pauses the money and opens one cause. It does not revoke the person's
   * permission, detach her coach or cancel her sessions — `IX-40` — because none of that
   * could be given back.
   */
  routes.post(
    '/organizations/:organizationId/subscriptions/:subscriptionId/suspension',
    transition((service, personId, input) => service.suspend(personId, input)),
  )

  /*
   * OP-PAY-009. Subtractive: closes only the cause this suspension opened. No new
   * acceptance is needed, because nothing was ever revoked.
   */
  routes.post(
    '/organizations/:organizationId/subscriptions/:subscriptionId/reactivation',
    transition((service, personId, input) => service.reactivate(personId, input)),
  )

  /*
   * OP-PAY-010. **Does not end the service relationship.** Somebody who stops paying and
   * keeps training is a decision the organization makes on purpose, through OP-REL-008.
   */
  routes.post(
    '/organizations/:organizationId/subscriptions/:subscriptionId/termination',
    transition((service, personId, input) => service.end(personId, input)),
  )

  /**
   * The three commands differ only in which function they call: same path shape, same
   * headers, same answer, same convergence. Writing them out three times would be three
   * chances for one of them to forget the origin check or the command headers.
   */
  function transition(
    run: (
      service: SubscriptionService,
      personId: string,
      input: {
        organizationId: string
        subscriptionId: string
        idempotencyKey: string
        commandId: string
        requestHash: Buffer
        requestId: string
      },
    ) => Promise<{ resource: { subscription_id: string; status: SubscriptionStatus } }>,
  ) {
    return async (c: Context): Promise<Response> => {
      c.header('Cache-Control', 'no-store')
      if (c.req.header('origin') !== studioOrigin) {
        return fail(c, 'forbidden', 'origin is not allowed')
      }
      // `?? ''` because this handler is shared across three routes and takes a plain
      // `Context`, so the path parameters are not inferred as present. An empty string
      // fails the shape check below, which is the same answer a bad id gets.
      const organizationId = c.req.param('organizationId') ?? ''
      const subscriptionId = c.req.param('subscriptionId') ?? ''
      if (!UUID.test(organizationId) || !UUID.test(subscriptionId)) {
        return fail(c, 'invalid-request')
      }
      // No body. The hash covers the path, so one key cannot be reused across two
      // subscriptions or across suspend and terminate.
      const command = commandContext(c, {
        organization_id: organizationId,
        subscription_id: subscriptionId,
      })
      if (!command) return fail(c, 'invalid-request', 'valid command headers are required')

      try {
        const personId = await actingPerson(c, sessions())
        if (personId instanceof Response) return personId
        const result = await run(subscriptions(), personId, {
          organizationId,
          subscriptionId,
          requestId: requestId(c),
          ...command,
        })
        return c.json(result.resource)
      } catch (error) {
        return failure(c, error)
      }
    }
  }

  return routes
}

/**
 * An account with no person has not finished registering. It cannot hold a membership, so
 * it cannot hold `manage_billing` either, and saying so is clearer than the 404 the
 * function would answer.
 */
async function actingPerson(
  c: Context,
  sessions: StudioSessionService,
): Promise<string | Response> {
  const token = getCookie(c, STUDIO_SESSION_COOKIE)
  if (!token) return fail(c, 'unauthenticated')
  try {
    const actor = await sessions.resolveActor(token)
    if (!actor.personId) return fail(c, 'registration-incomplete')
    return actor.personId
  } catch (error) {
    if (error instanceof StudioSessionError) return fail(c, error.code)
    throw error
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

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return PLAN_PAGE_LIMIT.default
  if (!/^[1-9][0-9]*$/.test(value)) return undefined
  const parsed = Number(value)
  return parsed <= PLAN_PAGE_LIMIT.max ? parsed : undefined
}

function parseSubscriptionCursor(
  value: string | undefined,
):
  | { cursorStatus: SubscriptionStatus; cursorStartedAt: string; cursorSubscriptionId: string }
  | null
  | undefined {
  if (value === undefined) return undefined
  const parts = decodeCursor(value)
  if (!parts || parts.length !== 3) return null
  const [status, startedAt, subscriptionId] = parts
  if (!status || !STATUSES.has(status as SubscriptionStatus)) return null
  if (!startedAt || !TIMESTAMP.test(startedAt)) return null
  if (!subscriptionId || !UUID.test(subscriptionId)) return null
  return {
    cursorStatus: status as SubscriptionStatus,
    cursorStartedAt: startedAt,
    cursorSubscriptionId: subscriptionId,
  }
}

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
  if (error instanceof StudioSessionError) return fail(c, error.code)
  const sqlState = isObject(error) && typeof error.code === 'string' ? error.code : undefined
  if (sqlState === '42501') return fail(c, 'forbidden')
  if (sqlState === 'P0002') return fail(c, 'not-found')
  if (sqlState === 'P0004' || sqlState === '23505' || sqlState === '40001') {
    return fail(c, 'conflict')
  }
  if (sqlState === '22023' || sqlState === '23514' || sqlState === '22P02') {
    return fail(c, 'validation-failed')
  }
  console.error('[studio-payments] operation failed')
  return fail(c, 'upstream-unavailable')
}
