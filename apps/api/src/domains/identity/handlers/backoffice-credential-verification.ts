/**
 * Backoffice credential verification routes: `OP-IDN-011`.
 *
 * `HU-BO-021`. The handler shapes and rejects; it decides nothing. The duty,
 * AAL2, the conflict rules and the validity are resolved inside the transaction.
 *
 * Two things are refused here rather than passed along. A decision with no result
 * is a 422, because a missing result must never be read as a pass. And a body that
 * proposes a validity, a policy or an evidence fingerprint is a 422 as well: all
 * three are the server's to derive, and accepting them would let a client decide
 * how long its own verification lasts.
 */

import { createHash, randomUUID } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { cors } from 'hono/cors'

import { problem, type ApiErrorCode } from '../../../platform/http/index.js'
import {
  BackofficeAuthenticationError,
  type BackofficeAuthenticationService,
} from '../application/backoffice.js'
import type { CredentialVerificationService } from '../application/credential-verification.js'
import {
  backofficeAuthenticationService,
  credentialVerificationService,
  trustedBackofficeWebUrl,
} from '../dependencies.js'
import {
  VERIFICATION_METHODS,
  VERIFICATION_RESULTS,
  type BackofficeActor,
  type CredentialVerificationDecisionCreate,
  type CredentialVerificationMethod,
  type CredentialVerificationResult,
  type CredentialVerifier,
} from '../domain/index.js'
import { BACKOFFICE_SESSION_COOKIE } from './backoffice.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_ANY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_SOURCE_TEXT = 200

export function backofficeCredentialVerificationRoutes(
  injectedVerification?: CredentialVerificationService,
  injectedSessions?: BackofficeAuthenticationService,
): Hono {
  const origin = new URL(trustedBackofficeWebUrl()).origin
  const verification = () => injectedVerification ?? credentialVerificationService()
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
  })

  routes.get('/verification-requests', async (c) => {
    const limit = pageLimit(c)
    if (limit === null) return problem(c, 'invalid-request')
    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      return c.json({
        items: await verification().listRequests(verifierOf(actor), {
          requestId: randomUUID(),
          limit,
        }),
      })
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.post('/verifications', async (c) => {
    const body = await commandBody(c, origin)
    if (body instanceof Response) return body
    const decision = verificationDecision(body)
    if (!decision) return problem(c, 'validation-failed')
    const command = commandContext(c, decision)
    if (!command) return problem(c, 'invalid-request')

    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      const result = await verification().decide(verifierOf(actor), { ...command, decision })
      if (result.replayed) c.header('Idempotent-Replay', 'true')
      return c.json(result.resource, 201)
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.get('/verification-renewals', async (c) => {
    const limit = pageLimit(c)
    if (limit === null) return problem(c, 'invalid-request')
    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      return c.json({
        items: await verification().listDueRenewals(verifierOf(actor), {
          requestId: randomUUID(),
          limit,
        }),
      })
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.post('/verification-renewals', async (c) => {
    const body = await commandBody(c, origin)
    if (body instanceof Response) return body
    const credentialId = renewalCredential(body)
    if (!credentialId) return problem(c, 'validation-failed')
    const command = commandContext(c, { credential_id: credentialId })
    if (!command) return problem(c, 'invalid-request')

    try {
      const actor = await backofficeActor(c, sessions())
      if (actor instanceof Response) return actor
      const result = await verification().openRenewal(verifierOf(actor), {
        ...command,
        credentialId,
      })
      if (result.replayed) c.header('Idempotent-Replay', 'true')
      return c.json(result.resource, 201)
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  return routes
}

/** `undefined` when absent, `null` when malformed or when anything else was sent. */
function pageLimit(c: Context): number | undefined | null {
  const query = c.req.query()
  if (Object.keys(query).some((key) => key !== 'limit')) return null
  const limit = query['limit']
  if (limit === undefined) return undefined
  if (!/^[0-9]{1,3}$/.test(limit)) return null
  const parsed = Number(limit)
  return parsed >= 1 && parsed <= 200 ? parsed : null
}

async function commandBody(c: Context, origin: string): Promise<unknown> {
  if (c.req.header('origin') !== origin) return problem(c, 'forbidden')
  if (c.req.header('content-type')?.trim().toLowerCase() !== 'application/json') {
    return problem(c, 'unsupported-media-type')
  }
  try {
    return await c.req.json<unknown>()
  } catch {
    return problem(c, 'validation-failed')
  }
}

/**
 * The shape is checked here to answer 422 instead of a database error. The
 * database checks it again and is the authority.
 */
function verificationDecision(body: unknown): CredentialVerificationDecisionCreate | undefined {
  if (!isObject(body)) return undefined
  // `valid_to`, `policy_code` and `evidence_fingerprint` are absent on purpose:
  // the server derives all three.
  const allowed = new Set([
    'request_id',
    'result',
    'method',
    'source_authority',
    'source_jurisdiction',
    'source_reference',
    'source_status',
    'source_checked_at',
    'source_valid_to',
  ])
  if (Object.keys(body).some((key) => !allowed.has(key))) return undefined

  // Read into locals first: narrowing an index-signature property through control
  // flow has failed on CI before.
  const requestId = body.request_id
  const result = body.result
  const method = body.method
  const authority = sourceText(body.source_authority)
  const jurisdiction = sourceText(body.source_jurisdiction)
  const reference = sourceText(body.source_reference)
  const status = sourceText(body.source_status)
  const checkedAt = instant(body.source_checked_at)

  if (typeof requestId !== 'string' || !UUID_ANY.test(requestId)) return undefined
  if (
    typeof result !== 'string' ||
    !VERIFICATION_RESULTS.includes(result as CredentialVerificationResult)
  ) {
    return undefined
  }
  if (
    typeof method !== 'string' ||
    !VERIFICATION_METHODS.includes(method as CredentialVerificationMethod)
  ) {
    return undefined
  }
  if (!authority || !jurisdiction || !reference || !status || !checkedAt) return undefined

  let validTo: string | null = null
  if (body.source_valid_to !== undefined && body.source_valid_to !== null) {
    const parsed = instant(body.source_valid_to)
    if (!parsed) return undefined
    validTo = parsed
  }

  return {
    request_id: requestId,
    result: result as CredentialVerificationResult,
    method: method as CredentialVerificationMethod,
    source_authority: authority,
    source_jurisdiction: jurisdiction,
    source_reference: reference,
    source_status: status,
    source_checked_at: checkedAt,
    source_valid_to: validTo,
  }
}

function renewalCredential(body: unknown): string | undefined {
  if (!isObject(body)) return undefined
  if (Object.keys(body).some((key) => key !== 'credential_id')) return undefined
  const credentialId = body.credential_id
  return typeof credentialId === 'string' && UUID_ANY.test(credentialId) ? credentialId : undefined
}

function sourceText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed !== '' && trimmed.length <= MAX_SOURCE_TEXT ? trimmed : undefined
}

function instant(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString()
}

function verifierOf(actor: BackofficeActor): CredentialVerifier {
  return { actorPersonId: actor.personId, actorSessionId: actor.sessionId }
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
  console.error('[backoffice-credential-verification] operation failed')
  return problem(c, 'upstream-unavailable')
}

function databaseErrorCode(error: unknown): ApiErrorCode | undefined {
  if (!isObject(error)) return undefined
  const sqlState = typeof error.code === 'string' ? error.code : undefined
  if (sqlState === 'P0002') return 'not-found'
  // A conflict of interest is a refusal of this verifier, not a malformed request.
  if (sqlState === '42501') return 'forbidden'
  if (sqlState === '22023' || sqlState === '23503') return 'validation-failed'
  // 55000 is the state machine: a decided request, a retired credential, nothing due.
  if (sqlState === '55000' || sqlState === '23505' || sqlState === '23514') return 'conflict'
  if (sqlState === '40001') return 'idempotency-in-progress'
  return undefined
}
