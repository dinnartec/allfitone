/**
 * Backoffice platform plan routes: `NEW-PAY-PLATFORM-PLAN`, `OP-PAY-017`, `OP-PAY-024..026`.
 *
 * `HU-BO-025` and `HU-BO-026`. The handler shapes and rejects; the commercial duty, who may
 * publish a proposal and whether it changes anything are decided in the transaction.
 *
 * A body carries exactly the declared fields. The publication and the withdrawal carry
 * none: there is no field through which a client could name a reviewer, backdate a
 * version or mark it reviewed.
 */

import { createHash, randomUUID } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { cors } from 'hono/cors'

import {
  BACKOFFICE_SESSION_COOKIE,
  BackofficeAuthenticationError,
  backofficeAuthenticationService,
  trustedBackofficeWebUrl,
  type BackofficeActor,
  type BackofficeAuthenticationService,
} from '../../identity/index.js'
import { problem, type ApiErrorCode } from '../../../platform/http/index.js'
import type { PlatformPlanService } from '../application/index.js'
import { platformPlanService } from '../dependencies.js'
import {
  CURRENCY_CODE,
  MAX_AMOUNT_MINOR,
  MAX_FEATURE_LIMIT,
  MAX_FEATURES,
  MAX_PLAN_NAME,
  PLATFORM_FEATURE_CODE,
  PLATFORM_PLAN_BILLING_PERIODS,
  PLATFORM_PLAN_CODE,
  PLATFORM_PLAN_KINDS,
  type PaymentsCommandContext,
  type PlatformPlanBillingPeriod,
  type PlatformPlanCreate,
  type PlatformPlanFeatureLimit,
  type PlatformPlanKind,
  type PlatformPlanResult,
  type PlatformPlanVersionProposal,
} from '../domain/index.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function backofficePlatformPlanRoutes(
  injectedPlans?: PlatformPlanService,
  injectedSessions?: BackofficeAuthenticationService,
): Hono {
  const origin = new URL(trustedBackofficeWebUrl()).origin
  const plans = () => injectedPlans ?? platformPlanService()
  const sessions = () => injectedSessions ?? backofficeAuthenticationService()
  const routes = new Hono()

  routes.use(
    '*',
    cors({
      origin,
      credentials: true,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Idempotency-Key', 'Command-Id'],
      exposeHeaders: ['Idempotent-Replay', 'Retry-After', 'Server-Timing'],
      maxAge: 600,
    }),
  )
  routes.use('*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('Vary', 'Origin')
  })

  routes.get('/platform-plans', async (c) => {
    if (Object.keys(c.req.query()).length > 0) return problem(c, 'invalid-request')
    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      return c.json(await plans().list(actor, { requestId: randomUUID() }))
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.post('/platform-plans', async (c) => {
    const body = await jsonBody(c, origin)
    if (body instanceof Response) return body
    const plan = planCreate(body)
    if (!plan) return problem(c, 'validation-failed')
    const command = commandContext(c, plan)
    if (!command) return problem(c, 'invalid-request')
    return respond(c, sessions(), 201, (actor) => plans().create(actor, { ...command, plan }))
  })

  routes.post('/platform-plans/:planId/versions', async (c) => {
    const planId = c.req.param('planId')
    if (!UUID_V7.test(planId)) return problem(c, 'invalid-request')
    const body = await jsonBody(c, origin)
    if (body instanceof Response) return body
    const proposal = versionProposal(body)
    if (!proposal) return problem(c, 'validation-failed')
    const command = commandContext(c, { planId, ...proposal })
    if (!command) return problem(c, 'invalid-request')
    return respond(c, sessions(), 201, (actor) =>
      plans().propose(actor, { ...command, planId, proposal }),
    )
  })

  routes.post('/platform-plans/:planId/versions/:versionId/publication', async (c) => {
    const target = await versionCommand(c, origin)
    if (target instanceof Response) return target
    return respond(c, sessions(), 200, (actor) => plans().publish(actor, target))
  })

  routes.post('/platform-plans/:planId/versions/:versionId/withdrawal', async (c) => {
    const target = await versionCommand(c, origin)
    if (target instanceof Response) return target
    return respond(c, sessions(), 200, (actor) => plans().withdraw(actor, target))
  })

  return routes
}

async function jsonBody(c: Context, origin: string): Promise<Response | Record<string, unknown>> {
  if (c.req.header('origin') !== origin) return problem(c, 'forbidden')
  if (c.req.header('content-type')?.trim().toLowerCase() !== 'application/json') {
    return problem(c, 'unsupported-media-type')
  }
  let body: unknown
  try {
    body = await c.req.json<unknown>()
  } catch {
    return problem(c, 'validation-failed')
  }
  return isObject(body) ? body : problem(c, 'validation-failed')
}

function planCreate(body: Record<string, unknown>): PlatformPlanCreate | undefined {
  if (!hasExactly(body, ['code', 'name', 'plan_kind'])) return undefined
  const { code, name, plan_kind: kind } = body
  if (typeof code !== 'string' || !PLATFORM_PLAN_CODE.test(code)) return undefined
  if (typeof name !== 'string') return undefined
  const trimmed = name.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_PLAN_NAME) return undefined
  if (!PLATFORM_PLAN_KINDS.includes(kind as PlatformPlanKind)) return undefined
  return { code, name: trimmed, plan_kind: kind as PlatformPlanKind }
}

/**
 * Only the shape. Whether a free plan may carry a price, or a version may leave a
 * function out, depends on the plan and the catalogue, and the database answers that.
 */
function versionProposal(body: Record<string, unknown>): PlatformPlanVersionProposal | undefined {
  if (!hasExactly(body, ['amount_minor', 'currency_code', 'billing_period', 'features'])) {
    return undefined
  }
  const { amount_minor: amount, currency_code: currency, billing_period: period, features } = body
  if (
    !Number.isSafeInteger(amount) ||
    (amount as number) < 0 ||
    (amount as number) > MAX_AMOUNT_MINOR
  ) {
    return undefined
  }
  if (currency !== null && (typeof currency !== 'string' || !CURRENCY_CODE.test(currency))) {
    return undefined
  }
  if (
    period !== null &&
    !PLATFORM_PLAN_BILLING_PERIODS.includes(period as PlatformPlanBillingPeriod)
  ) {
    return undefined
  }
  if (!Array.isArray(features) || features.length > MAX_FEATURES) return undefined
  const limits: PlatformPlanFeatureLimit[] = []
  for (const entry of features) {
    const limit = featureLimit(entry)
    if (!limit) return undefined
    limits.push(limit)
  }
  return {
    amount_minor: amount as number,
    currency_code: currency as string | null,
    billing_period: period as PlatformPlanBillingPeriod | null,
    features: limits,
  }
}

function featureLimit(entry: unknown): PlatformPlanFeatureLimit | undefined {
  if (!isObject(entry) || !hasExactly(entry, ['feature_code', 'enabled', 'limit_value'])) {
    return undefined
  }
  const { feature_code: code, enabled, limit_value: limit } = entry
  if (typeof code !== 'string' || !PLATFORM_FEATURE_CODE.test(code)) return undefined
  if (typeof enabled !== 'boolean') return undefined
  if (
    limit !== null &&
    (!Number.isSafeInteger(limit) || (limit as number) < 0 || (limit as number) > MAX_FEATURE_LIMIT)
  ) {
    return undefined
  }
  return { feature_code: code, enabled, limit_value: limit as number | null }
}

async function versionCommand(
  c: Context,
  origin: string,
): Promise<Response | (PaymentsCommandContext & { planId: string; versionId: string })> {
  const planId = c.req.param('planId')
  const versionId = c.req.param('versionId')
  if (!planId || !versionId || !UUID_V7.test(planId) || !UUID_V7.test(versionId)) {
    return problem(c, 'invalid-request')
  }
  const body = await jsonBody(c, origin)
  if (body instanceof Response) return body
  if (Object.keys(body).length > 0) return problem(c, 'validation-failed')
  const command = commandContext(c, { planId, versionId })
  if (!command) return problem(c, 'invalid-request')
  return { ...command, planId, versionId }
}

async function respond(
  c: Context,
  sessions: BackofficeAuthenticationService,
  status: 200 | 201,
  operation: (actor: BackofficeActor) => Promise<PlatformPlanResult>,
): Promise<Response> {
  try {
    const actor = await backofficeActor(c, sessions)
    if (actor instanceof Response) return actor
    const result = await operation(actor)
    if (result.replayed) c.header('Idempotent-Replay', 'true')
    return c.json(result.resource, status)
  } catch (error) {
    return operationFailure(c, error)
  }
}

async function backofficeActor(c: Context, sessions: BackofficeAuthenticationService) {
  const token = getCookie(c, BACKOFFICE_SESSION_COOKIE)
  if (!token) return problem(c, 'unauthenticated', 'missing session cookie')
  try {
    return await sessions.resolveActor(token)
  } catch (error) {
    if (error instanceof BackofficeAuthenticationError) return problem(c, error.code)
    throw error
  }
}

function commandContext(c: Context, resource: unknown): PaymentsCommandContext | undefined {
  const idempotencyKey = c.req.header('idempotency-key')
  const commandId = c.req.header('command-id')
  if (!idempotencyKey || !UUID_V4.test(idempotencyKey) || !commandId || !UUID_V7.test(commandId)) {
    return undefined
  }
  return {
    idempotencyKey,
    commandId,
    requestId: randomUUID(),
    requestHash: createHash('sha256')
      .update(
        JSON.stringify(
          canonicalJson({ method: c.req.method.toUpperCase(), path: c.req.path, resource }),
        ),
      )
      .digest(),
  }
}

function hasExactly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(value)
  return present.length === keys.length && keys.every((key) => key in value)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (!isObject(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalJson(child)]),
  )
}

function operationFailure(c: Context, error: unknown) {
  if (error instanceof BackofficeAuthenticationError) return problem(c, error.code)
  const code = databaseErrorCode(error)
  if (code === 'idempotency-in-progress') c.header('Retry-After', '1')
  if (code) return problem(c, code)
  console.error('[backoffice-platform-plans] operation failed')
  return problem(c, 'upstream-unavailable')
}

function databaseErrorCode(error: unknown): ApiErrorCode | undefined {
  if (!isObject(error)) return undefined
  const sqlState = typeof error.code === 'string' ? error.code : undefined
  if (sqlState === 'P0002') return 'not-found'
  // Includes publishing your own proposal: a refusal, never a conflict to retry.
  if (sqlState === '42501') return 'forbidden'
  if (sqlState === '22023' || sqlState === '22P02' || sqlState === '23503') {
    return 'validation-failed'
  }
  // 55000 is the catalogue's own answer: a proposal already open, one that changes
  // nothing, or one no longer open. 23505 is a taken code or a second free plan.
  if (sqlState === '55000' || sqlState === '23505' || sqlState === '23514') return 'conflict'
  if (sqlState === '40001') return 'idempotency-in-progress'
  return undefined
}
