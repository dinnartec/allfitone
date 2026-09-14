/**
 * Backoffice support metadata routes: `OP-SUP-005` and `NEW-SUP-ATTENTION`.
 *
 * `HU-BO-006` finds a person, `HU-BO-007` opens their operational state, and
 * both read the same minimised projection. The handler shapes and rejects; it
 * never decides access. `diagnose_support_metadata` and AAL2 are resolved inside
 * the read's own transaction, and the access record is written there too — if
 * the record fails, the read fails.
 *
 * Two rejections are worth reading as design rather than validation. Exactly one
 * lookup parameter is accepted, because a search that could combine them would
 * become an exploration; and the case reference is required on both routes,
 * because a read nobody can trace back to a case is the thing `PR-22` exists to
 * prevent.
 *
 * The attention panel (`HU-BO-005`) lives here because it is a support read with
 * no subject, like the diagnosis feed. Which of its notices an operator sees is
 * decided by their duties in PostgreSQL, never by this handler.
 */

import { randomUUID } from 'node:crypto'
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
import type {
  SupportAttentionService,
  SupportDiagnosisService,
  SupportMetadataService,
} from '../application/index.js'
import {
  supportAttentionService,
  supportDiagnosisService,
  supportMetadataService,
} from '../dependencies.js'
import {
  SUPPORT_CASE_REFERENCE,
  SUPPORT_OPERATION_SOURCES,
  SUPPORT_OPERATION_STATES,
  type SupportLookupKind,
  type SupportOperationCursor,
  type SupportOperationSourceKind,
  type SupportOperationState,
} from '../domain/index.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/
const PHONE = /^\+[1-9][0-9]{6,14}$/
const MAX_PAGE = 100

export function backofficeSupportMetadataRoutes(
  injectedMetadata?: SupportMetadataService,
  injectedSessions?: BackofficeAuthenticationService,
  injectedDiagnosis?: SupportDiagnosisService,
  injectedAttention?: SupportAttentionService,
): Hono {
  const origin = new URL(trustedBackofficeWebUrl()).origin
  const metadata = () => injectedMetadata ?? supportMetadataService()
  const diagnosis = () => injectedDiagnosis ?? supportDiagnosisService()
  const attention = () => injectedAttention ?? supportAttentionService()
  const sessions = () => injectedSessions ?? backofficeAuthenticationService()
  const routes = new Hono()

  routes.use(
    '*',
    cors({
      origin,
      credentials: true,
      allowMethods: ['GET', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
      exposeHeaders: ['Server-Timing'],
      maxAge: 600,
    }),
  )
  routes.use('*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
    c.header('Referrer-Policy', 'no-referrer')
  })

  routes.get('/support/people', async (c) => {
    const caseReference = c.req.query('case_reference')
    if (!caseReference || !SUPPORT_CASE_REFERENCE.test(caseReference)) {
      return problem(c, 'invalid-request', 'a traceable case reference is required')
    }
    const lookup = exactlyOneLookup(c)
    if (!lookup) {
      return problem(c, 'invalid-request', 'search by exactly one identifier, email or phone')
    }

    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      return c.json(
        await metadata().search(
          { actorPersonId: actor.personId, actorSessionId: actor.sessionId },
          { requestId: randomUUID(), caseReference, ...lookup },
        ),
      )
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.get('/support/people/:personId', async (c) => {
    const personId = c.req.param('personId')
    if (!UUID.test(personId)) return problem(c, 'invalid-request')
    const caseReference = c.req.query('case_reference')
    if (!caseReference || !SUPPORT_CASE_REFERENCE.test(caseReference)) {
      return problem(c, 'invalid-request', 'a traceable case reference is required')
    }

    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      return c.json(
        await metadata().read(
          { actorPersonId: actor.personId, actorSessionId: actor.sessionId },
          { requestId: randomUUID(), caseReference, personId },
        ),
      )
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  // No case reference on the two diagnosis routes, unlike every other support
  // read: this feed has no subject, so there is nothing to trace back to a case.
  routes.get('/support/operations', async (c) => {
    const filters = operationFilters(c)
    if (!filters) return problem(c, 'invalid-request')

    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      const found = await diagnosis().listOperations(
        { actorPersonId: actor.personId, actorSessionId: actor.sessionId },
        { requestId: randomUUID(), ...filters },
      )
      return c.json({
        data: found.items,
        page: { has_more: found.hasMore, next_cursor: found.nextCursor ?? null },
      })
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.get('/support/delivery-circuits', async (c) => {
    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      return c.json({
        items: await diagnosis().listDeliveryCircuits(
          { actorPersonId: actor.personId, actorSessionId: actor.sessionId },
          { requestId: randomUUID() },
        ),
      })
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  // Counters with no subject, so no case reference either.
  routes.get('/support/attention', async (c) => {
    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      return c.json(
        await attention().read(
          { actorPersonId: actor.personId, actorSessionId: actor.sessionId },
          { requestId: randomUUID() },
        ),
      )
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  return routes
}

/**
 * Every filter comes from a closed vocabulary and the cursor is this handler's
 * own, so a forged one is refused here rather than becoming a strange query.
 */
function operationFilters(c: Context) {
  const limit = Number(c.req.query('limit') ?? 25)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) return undefined

  const source = c.req.query('source')
  if (
    source !== undefined &&
    !SUPPORT_OPERATION_SOURCES.includes(source as SupportOperationSourceKind)
  ) {
    return undefined
  }
  const state = c.req.query('state')
  if (state !== undefined && !SUPPORT_OPERATION_STATES.includes(state as SupportOperationState)) {
    return undefined
  }
  const aggregateId = c.req.query('aggregate_id')
  if (aggregateId !== undefined && !UUID.test(aggregateId)) return undefined

  const encoded = c.req.query('cursor')
  let cursor: SupportOperationCursor | undefined
  if (encoded !== undefined) {
    cursor = decodeCursor(encoded)
    if (!cursor) return undefined
  }

  return {
    limit,
    ...(source === undefined ? {} : { source: source as SupportOperationSourceKind }),
    ...(state === undefined ? {} : { state: state as SupportOperationState }),
    ...(aggregateId === undefined ? {} : { aggregateId }),
    ...(cursor === undefined ? {} : { cursor }),
  }
}

function decodeCursor(encoded: string): SupportOperationCursor | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const { occurredAt, id } = parsed as Record<string, unknown>
    if (typeof occurredAt !== 'string' || Number.isNaN(Date.parse(occurredAt))) return undefined
    if (typeof id !== 'string' || !UUID.test(id)) return undefined
    return { occurredAt, id }
  } catch {
    return undefined
  }
}

/**
 * One parameter, matched exactly. Two would let a caller widen a lookup into a
 * search, and a malformed one is refused here so it never becomes a recorded
 * query the database would have rejected anyway.
 */
function exactlyOneLookup(
  c: Context,
): { lookupKind: SupportLookupKind; lookupValue: string } | undefined {
  const candidates: { kind: SupportLookupKind; value: string | undefined; shape: RegExp }[] = [
    { kind: 'identifier', value: c.req.query('identifier'), shape: UUID },
    { kind: 'email', value: c.req.query('email'), shape: EMAIL },
    { kind: 'phone', value: c.req.query('phone'), shape: PHONE },
  ]
  const supplied = candidates.filter((candidate) => candidate.value !== undefined)
  if (supplied.length !== 1) return undefined

  const [only] = supplied
  if (!only?.value || !only.shape.test(only.value)) return undefined
  return { lookupKind: only.kind, lookupValue: only.value }
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

function operationFailure(c: Context, error: unknown) {
  if (error instanceof BackofficeAuthenticationError) return problem(c, error.code)
  const code = databaseErrorCode(error)
  if (code) return problem(c, code)
  console.error('[backoffice-support] operation failed')
  return problem(c, 'upstream-unavailable')
}

function databaseErrorCode(error: unknown): ApiErrorCode | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const sqlState = 'code' in error && typeof error.code === 'string' ? error.code : undefined
  if (sqlState === 'P0002') return 'not-found'
  if (sqlState === '42501') return 'forbidden'
  if (sqlState === '22023' || sqlState === '22P02') return 'invalid-request'
  // The case reference CHECK is the database having the last word on a shape the
  // handler already refused: reaching it means the two drifted.
  if (sqlState === '23514') return 'validation-failed'
  return undefined
}
