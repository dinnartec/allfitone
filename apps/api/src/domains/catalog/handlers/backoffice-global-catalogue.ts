/**
 * Backoffice global catalogue routes: `NEW-CAT-GLOBAL-PUBLISH`, `OP-CAT-004`, `OP-CAT-005`.
 *
 * `HU-BO-022`. The handler shapes and rejects; the duty, AAL2, the stability of a code and
 * what may be archived are decided inside the transaction.
 *
 * No route here takes a scope or an owner, and an archival command takes no body at all.
 * That is the shape of criterion 1: there is nothing a client could send that would turn a
 * gym's private content into global content.
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
import type { GlobalCatalogueCurationService } from '../application/global-catalogue.js'
import { globalCatalogueCurationService } from '../dependencies.js'
import type { CatalogueEntryResult } from '../domain/global-catalogue.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_ANY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CATALOGUE_CODE = /^[a-z][a-z0-9_]{1,63}$/
const MAX_NAME = 120

export function backofficeGlobalCatalogueRoutes(
  injectedCuration?: GlobalCatalogueCurationService,
  injectedSessions?: BackofficeAuthenticationService,
): Hono {
  const origin = new URL(trustedBackofficeWebUrl()).origin
  const curation = () => injectedCuration ?? globalCatalogueCurationService()
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

  routes.get('/catalogue', async (c) => {
    if (Object.keys(c.req.query()).length > 0) return problem(c, 'invalid-request')
    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      return c.json(await curation().read(actor, { requestId: randomUUID() }))
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.post('/catalogue/disciplines', async (c) => {
    const body = await commandBody(c, origin, ['code', 'name'])
    if (body instanceof Response) return body
    const publication = { code: body.value.code, name: body.value.name }
    return respond(c, sessions(), (actor) =>
      curation().publishDiscipline(actor, { ...body.command, publication }),
    )
  })

  routes.post('/catalogue/disciplines/:code/archival', async (c) => {
    const code = c.req.param('code')
    if (!CATALOGUE_CODE.test(code)) return problem(c, 'invalid-request')
    const command = await archivalCommand(c, origin, { code })
    if (command instanceof Response) return command
    return respond(c, sessions(), (actor) =>
      curation().archiveDiscipline(actor, { ...command, code }),
    )
  })

  routes.post('/catalogue/activity-types', async (c) => {
    const body = await commandBody(c, origin, ['discipline_code', 'code', 'name'])
    if (body instanceof Response) return body
    const publication = {
      discipline_code: body.value.discipline_code,
      code: body.value.code,
      name: body.value.name,
    }
    return respond(c, sessions(), (actor) =>
      curation().publishActivityType(actor, { ...body.command, publication }),
    )
  })

  routes.post('/catalogue/activity-types/:code/archival', async (c) => {
    const code = c.req.param('code')
    if (!CATALOGUE_CODE.test(code)) return problem(c, 'invalid-request')
    const command = await archivalCommand(c, origin, { code })
    if (command instanceof Response) return command
    return respond(c, sessions(), (actor) =>
      curation().archiveActivityType(actor, { ...command, code }),
    )
  })

  routes.post('/catalogue/movements', async (c) => {
    const body = await commandBody(c, origin, ['discipline_code', 'name'])
    if (body instanceof Response) return body
    const publication = {
      discipline_code: body.value.discipline_code,
      name: body.value.name,
    }
    return respond(c, sessions(), (actor) =>
      curation().publishMovement(actor, { ...body.command, publication }),
    )
  })

  routes.post('/catalogue/movements/:movementId/archival', async (c) => {
    const movementId = c.req.param('movementId')
    if (!UUID_ANY.test(movementId)) return problem(c, 'invalid-request')
    const command = await archivalCommand(c, origin, { movementId })
    if (command instanceof Response) return command
    return respond(c, sessions(), (actor) =>
      curation().archiveMovement(actor, { ...command, movementId }),
    )
  })

  return routes
}

type CommandContext = {
  idempotencyKey: string
  commandId: string
  requestId: string
  requestHash: Uint8Array
}

/**
 * A publication body carries exactly the declared fields, each a code or a name. An extra
 * field is refused rather than ignored: the only reason to send one would be to reach
 * something these commands deliberately do not expose.
 */
async function commandBody(
  c: Context,
  origin: string,
  fields: readonly ('code' | 'discipline_code' | 'name')[],
): Promise<
  Response | { value: Record<'code' | 'discipline_code' | 'name', string>; command: CommandContext }
> {
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
  if (!isObject(body) || Object.keys(body).length !== fields.length) {
    return problem(c, 'validation-failed')
  }
  const value = { code: '', discipline_code: '', name: '' }
  for (const field of fields) {
    const raw = body[field]
    if (typeof raw !== 'string') return problem(c, 'validation-failed')
    if (field === 'name') {
      const name = raw.trim()
      if (name.length === 0 || name.length > MAX_NAME) return problem(c, 'validation-failed')
      value.name = name
    } else {
      if (!CATALOGUE_CODE.test(raw)) return problem(c, 'validation-failed')
      value[field] = raw
    }
  }

  const command = commandContext(c, { ...value })
  if (!command) return problem(c, 'invalid-request')
  return { value, command }
}

async function archivalCommand(
  c: Context,
  origin: string,
  resource: Record<string, string>,
): Promise<Response | CommandContext> {
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
  if (!isObject(body) || Object.keys(body).length > 0) return problem(c, 'validation-failed')
  const command = commandContext(c, resource)
  return command ?? problem(c, 'invalid-request')
}

async function respond(
  c: Context,
  sessions: BackofficeAuthenticationService,
  operation: (actor: BackofficeActor) => Promise<CatalogueEntryResult>,
): Promise<Response> {
  try {
    const actor = await backofficeActor(c, sessions)
    if (actor instanceof Response) return actor
    const result = await operation(actor)
    if (result.replayed) c.header('Idempotent-Replay', 'true')
    return c.json(result.resource)
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

function commandContext(c: Context, resource: unknown): CommandContext | undefined {
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
            resource,
          }),
        ),
      )
      .digest(),
  }
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
  console.error('[backoffice-global-catalogue] operation failed')
  return problem(c, 'upstream-unavailable')
}

function databaseErrorCode(error: unknown): ApiErrorCode | undefined {
  if (!isObject(error)) return undefined
  const sqlState = typeof error.code === 'string' ? error.code : undefined
  if (sqlState === 'P0002') return 'not-found'
  if (sqlState === '42501') return 'forbidden'
  if (sqlState === '22023' || sqlState === '22P02') return 'validation-failed'
  // 55000 is the catalogue's own answer: already published, still in use, or a code that
  // already names something else. 23505 is the same collision seen by an index.
  if (sqlState === '55000' || sqlState === '23505' || sqlState === '23514') return 'conflict'
  if (sqlState === '23503') return 'validation-failed'
  if (sqlState === '40001') return 'idempotency-in-progress'
  return undefined
}
