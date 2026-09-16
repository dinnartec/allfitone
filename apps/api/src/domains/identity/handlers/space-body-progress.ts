/**
 * Body measurement routes on /space/v1: `OP-IDN-006`, `OP-IDN-007`, `OP-IDN-015`.
 *
 * `HU-SP-025`, `HU-SP-026`, `HU-SP-027`. The token is verified here and resolved to a
 * person in the database; nothing in a request can name whose measurements these are.
 * The `Command-Id` of a recording is the measurement's own identifier, which is what lets a
 * device create one offline and send it later without duplicating it.
 *
 * A body carries exactly the declared fields. A photo is not one of them yet: removing its
 * metadata on the server is its own piece, and until then a field that looks like one is
 * refused rather than ignored.
 */

import { createHash } from 'node:crypto'
import type { VerifiedToken } from '@allfitone/auth-provider'
import { Hono, type Context } from 'hono'

import { authProvider } from '../../../platform/auth/index.js'
import { problem, type ApiErrorCode } from '../../../platform/http/index.js'
import type { BodyProgressService } from '../application/body-progress.js'
import { spaceBodyProgressService } from '../dependencies.js'
import {
  BODY_PROGRESS_METRICS,
  BODY_PROGRESS_UNITS,
  MAX_BODY_PROGRESS_PAGE,
  MAX_BODY_PROGRESS_VALUE,
  type BodyProgressListInput,
  type BodyProgressMetricCode,
  type BodyProgressRecordCreate,
  type BodyProgressUnitCode,
} from '../domain/body-progress.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const LIST_PARAMETERS = new Set(['limit', 'before_measured_on', 'before_id'])

export type TokenVerifier = (token: string) => Promise<VerifiedToken>

export function spaceBodyProgressRoutes(
  injectedService?: BodyProgressService,
  injectedVerifier?: TokenVerifier,
): Hono {
  const measurements = () => injectedService ?? spaceBodyProgressService()
  const verify: TokenVerifier =
    injectedVerifier ?? ((token) => authProvider().verifyAccessToken(token, 'space'))
  const routes = new Hono()

  routes.use('*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
  })

  routes.get('/body-progress', async (c) => {
    const token = await verified(c, verify)
    if (!token) return problem(c, 'unauthenticated')
    const page = listInput(c)
    if (!page) return problem(c, 'invalid-request')

    try {
      return c.json(await measurements().list(token, page))
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.post('/body-progress', async (c) => {
    const token = await verified(c, verify)
    if (!token) return problem(c, 'unauthenticated')
    if (c.req.header('content-type')?.trim().toLowerCase() !== 'application/json') {
      return problem(c, 'unsupported-media-type')
    }
    const measurement = recordCreate(await readJson(c))
    if (!measurement) return problem(c, 'validation-failed')
    const command = commandContext(c, measurement)
    if (!command) return problem(c, 'invalid-request')

    try {
      const result = await measurements().record(token, {
        ...command,
        recordId: command.commandId,
        measurement,
      })
      if (result.replayed) c.header('Idempotent-Replay', 'true')
      return c.json(result.resource, 201)
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.delete('/body-progress/:recordId', async (c) => {
    const token = await verified(c, verify)
    if (!token) return problem(c, 'unauthenticated')
    const recordId = c.req.param('recordId')
    if (!UUID_V7.test(recordId)) return problem(c, 'invalid-request')
    const command = commandContext(c, { recordId })
    if (!command) return problem(c, 'invalid-request')

    try {
      const result = await measurements().delete(token, { ...command, recordId })
      if (result.replayed) c.header('Idempotent-Replay', 'true')
      return c.json(result.resource, 200)
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  return routes
}

async function verified(c: Context, verify: TokenVerifier): Promise<VerifiedToken | undefined> {
  const [scheme, value] = c.req.header('authorization')?.split(' ') ?? []
  if (scheme?.toLowerCase() !== 'bearer' || !value) return undefined
  try {
    return await verify(value)
  } catch {
    // One answer for expired, malformed and issued-for-another-surface.
    return undefined
  }
}

function listInput(c: Context): BodyProgressListInput | undefined {
  const query = c.req.query()
  if (Object.keys(query).some((key) => !LIST_PARAMETERS.has(key))) return undefined

  const limit = query.limit === undefined ? 50 : Number(query.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BODY_PROGRESS_PAGE) return undefined

  const beforeMeasuredOn = query.before_measured_on
  const beforeId = query.before_id
  if ((beforeMeasuredOn === undefined) !== (beforeId === undefined)) return undefined
  if (beforeMeasuredOn === undefined || beforeId === undefined) return { limit }
  if (!isDate(beforeMeasuredOn) || !UUID_V7.test(beforeId)) return undefined
  return { limit, beforeMeasuredOn, beforeId }
}

function recordCreate(body: unknown): BodyProgressRecordCreate | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  const fields = body as Record<string, unknown>
  const keys = Object.keys(fields)
  const expected = ['metric_code', 'value', 'unit_code', 'measured_on']
  if (keys.length !== expected.length || !expected.every((key) => key in fields)) return undefined

  const { metric_code: metric, value, unit_code: unit, measured_on: measuredOn } = fields
  if (!BODY_PROGRESS_METRICS.includes(metric as BodyProgressMetricCode)) return undefined
  if (!BODY_PROGRESS_UNITS.includes(unit as BodyProgressUnitCode)) return undefined
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > MAX_BODY_PROGRESS_VALUE
  ) {
    return undefined
  }
  if (typeof measuredOn !== 'string' || !isDate(measuredOn)) return undefined
  return {
    metric_code: metric as BodyProgressMetricCode,
    value,
    unit_code: unit as BodyProgressUnitCode,
    measured_on: measuredOn,
  }
}

function isDate(value: string): boolean {
  if (!DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function commandContext(c: Context, resource: unknown) {
  const idempotencyKey = c.req.header('idempotency-key') ?? ''
  const commandId = c.req.header('command-id') ?? ''
  if (!UUID_V4.test(idempotencyKey) || !UUID_V7.test(commandId)) return undefined
  return {
    idempotencyKey,
    commandId,
    requestHash: createHash('sha256')
      .update(
        JSON.stringify(
          canonicalJson({ method: c.req.method.toUpperCase(), path: c.req.path, resource }),
        ),
      )
      .digest(),
  }
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json<unknown>()
  } catch {
    return undefined
  }
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalJson(child)]),
  )
}

function operationFailure(c: Context, error: unknown) {
  const code = databaseErrorCode(error)
  if (code === 'idempotency-in-progress') c.header('Retry-After', '1')
  if (code) return problem(c, code)
  console.error('[space-body-progress] operation failed')
  return problem(c, 'upstream-unavailable')
}

function databaseErrorCode(error: unknown): ApiErrorCode | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const sqlState = 'code' in error && typeof error.code === 'string' ? error.code : undefined
  // Someone else's measurement and one that does not exist answer the same.
  if (sqlState === 'P0002') return 'not-found'
  // A token that resolves to no active person.
  if (sqlState === '42501') return 'forbidden'
  if (sqlState === '22023' || sqlState === '22P02' || sqlState === '23503') {
    return 'validation-failed'
  }
  if (sqlState === '23505' || sqlState === '55000' || sqlState === '23514') return 'conflict'
  if (sqlState === '40001') return 'idempotency-in-progress'
  return undefined
}
