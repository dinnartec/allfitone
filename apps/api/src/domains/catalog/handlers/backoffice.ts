/**
 * Backoffice catalogue curation: `OP-CAT-006`.
 *
 * The handler shapes and rejects requests; `curate_global_catalog` and AAL2 are
 * resolved inside the command's transaction, against the tables. The version
 * number is never accepted from the client — the server assigns the next one, so
 * two curators publishing at once produce two versions rather than a race.
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
  type BackofficeAuthenticationService,
} from '../../identity/index.js'
import { problem, type ApiErrorCode } from '../../../platform/http/index.js'
import type { ResultContractService } from '../application/index.js'
import { resultContractService } from '../dependencies.js'
import {
  ACTIVITY_FAMILIES,
  type ActivityFamily,
  type ResultContractPublication,
} from '../domain/index.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CONTRACT_CODE = /^[a-z][a-z0-9_.]{1,63}$/
const MAX_FIXTURES = 100

export function backofficeCatalogRoutes(
  injectedContracts?: ResultContractService,
  injectedSessions?: BackofficeAuthenticationService,
): Hono {
  const origin = new URL(trustedBackofficeWebUrl()).origin
  const contracts = () => injectedContracts ?? resultContractService()
  const sessions = () => injectedSessions ?? backofficeAuthenticationService()
  const routes = new Hono()

  routes.use(
    '*',
    cors({
      origin,
      credentials: true,
      allowMethods: ['POST', 'OPTIONS'],
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

  routes.post('/result-contracts', async (c) => {
    if (!exactOrigin(c, origin)) return problem(c, 'forbidden')
    const payload = await jsonPayload(c)
    if (payload instanceof Response) return payload
    const publication = resultContractPublication(payload.value)
    if (!publication) return problem(c, 'validation-failed')
    const command = commandContext(c, payload.value)
    if (!command) return problem(c, 'invalid-request')

    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      const result = await contracts().publish(actor, { publication, ...command })
      replay(c, result.replayed)
      return c.json(result.resource, 201)
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.post('/result-contracts/:contractId/deprecation', async (c) => {
    if (!exactOrigin(c, origin)) return problem(c, 'forbidden')
    const contractId = c.req.param('contractId')
    if (!contractId || !UUID_V7.test(contractId)) return problem(c, 'invalid-request')
    const payload = await jsonPayload(c)
    if (payload instanceof Response) return payload
    if (!isObject(payload.value) || Object.keys(payload.value).length > 0) {
      return problem(c, 'validation-failed')
    }
    const command = commandContext(c, { contractId })
    if (!command) return problem(c, 'invalid-request')

    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      const result = await contracts().deprecate(actor, { contractId, ...command })
      replay(c, result.replayed)
      return c.json(result.resource)
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  return routes
}

/**
 * The fixture pair is checked here only to answer 422 instead of a database
 * error; the command refuses an unproven contract on its own.
 */
function resultContractPublication(body: unknown): ResultContractPublication | undefined {
  if (!isObject(body)) return undefined
  const allowed = new Set([
    'contract_code',
    'activity_family',
    'envelope',
    'minimums',
    'fixtures',
    'activity_type_id',
    'is_default',
  ])
  if (Object.keys(body).some((key) => !allowed.has(key))) return undefined
  if (typeof body.contract_code !== 'string' || !CONTRACT_CODE.test(body.contract_code)) {
    return undefined
  }
  if (
    typeof body.activity_family !== 'string' ||
    !ACTIVITY_FAMILIES.includes(body.activity_family as ActivityFamily)
  ) {
    return undefined
  }
  if (!isObject(body.envelope) || !isObject(body.minimums)) return undefined
  if (typeof body.activity_type_id !== 'string' || !UUID.test(body.activity_type_id)) {
    return undefined
  }
  if (body.is_default !== undefined && typeof body.is_default !== 'boolean') return undefined

  const fixtures = body.fixtures
  if (!Array.isArray(fixtures) || fixtures.length < 2 || fixtures.length > MAX_FIXTURES) {
    return undefined
  }
  const parsed = fixtures.map(contractFixture)
  if (parsed.some((fixture) => fixture === undefined)) return undefined
  if (
    !parsed.some((fixture) => fixture?.kind === 'valid') ||
    !parsed.some((fixture) => fixture?.kind === 'invalid')
  ) {
    return undefined
  }

  return {
    contract_code: body.contract_code,
    activity_family: body.activity_family as ActivityFamily,
    envelope: body.envelope,
    minimums: body.minimums,
    fixtures: parsed as ResultContractPublication['fixtures'],
    activity_type_id: body.activity_type_id,
    ...(body.is_default === undefined ? {} : { is_default: body.is_default }),
  }
}

function contractFixture(
  value: unknown,
): ResultContractPublication['fixtures'][number] | undefined {
  if (!isObject(value)) return undefined
  const allowed = new Set(['kind', 'payload', 'expected'])
  if (Object.keys(value).some((key) => !allowed.has(key))) return undefined
  if (value.kind !== 'valid' && value.kind !== 'invalid') return undefined
  if (!isObject(value.payload)) return undefined
  if (
    typeof value.expected !== 'string' ||
    value.expected.trim().length === 0 ||
    value.expected.length > 200
  ) {
    return undefined
  }
  return { kind: value.kind, payload: value.payload, expected: value.expected }
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

function commandContext(c: Context, request: unknown) {
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
          canonicalJson({
            method: c.req.method.toUpperCase(),
            path: c.req.path,
            resource: request,
          }),
        ),
      )
      .digest(),
  }
}

function exactOrigin(c: Context, allowed: string): boolean {
  return c.req.header('origin') === allowed
}

async function jsonPayload(c: Context): Promise<{ value: unknown } | Response> {
  if (c.req.header('content-type')?.trim().toLowerCase() !== 'application/json') {
    return problem(c, 'unsupported-media-type')
  }
  try {
    return { value: await c.req.json<unknown>() }
  } catch {
    return { value: undefined }
  }
}

function replay(c: Context, replayed: boolean): void {
  if (replayed) c.header('Idempotent-Replay', 'true')
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
  console.error('[backoffice-catalog] operation failed')
  return problem(c, 'upstream-unavailable')
}

function databaseErrorCode(error: unknown): ApiErrorCode | undefined {
  if (!isObject(error)) return undefined
  const sqlState = typeof error.code === 'string' ? error.code : undefined
  if (sqlState === 'P0002') return 'not-found'
  if (sqlState === '42501') return 'forbidden'
  if (sqlState === '22023' || sqlState === '23503') return 'validation-failed'
  // 55000 is the repository's published-content guard; 23505 a duplicate version.
  if (sqlState === '23514' || sqlState === '23505' || sqlState === '55000') return 'conflict'
  if (sqlState === '40001') return 'idempotency-in-progress'
  return undefined
}
