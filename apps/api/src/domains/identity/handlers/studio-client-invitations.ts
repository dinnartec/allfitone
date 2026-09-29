/** Client invitation command for Studio. */

import { createHash } from 'node:crypto'
import type { AllfitV1Schemas } from '@allfitone/contracts'
import { Hono, type Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { cors } from 'hono/cors'

import { fail } from '../../../platform/http/index.js'
import { StudioSessionError, type StudioSessionService } from '../application/index.js'
import { StudioInvitationError } from '../application/invitations.js'
import type { ClientInvitationService } from '../application/client-invitations.js'
import {
  clientInvitationService,
  studioSessionService,
  trustedStudioWebUrl,
} from '../dependencies.js'
import type { AccessLevel, ScopeCode } from '../domain/client-invitations.js'
import { STUDIO_SESSION_COOKIE } from './studio.js'

type ClientInvitationCreate = AllfitV1Schemas['ClientInvitationCreate']

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SCOPE_CODES = new Set<ScopeCode>([
  'relationship_training',
  'prior_training_history',
  'body_progress',
  'health_context',
  'nutrition_intake',
  'nutrition_guidance',
  'nutrition_media',
])
const ACCESS_LEVELS = new Set<AccessLevel>(['read', 'contribute'])
const MAX_PURPOSE = 500
const MAX_CONTACT = 254

export function studioClientInvitationRoutes(
  injectedService?: ClientInvitationService,
  injectedSessions?: StudioSessionService,
): Hono {
  const studioOrigin = new URL(trustedStudioWebUrl()).origin
  const invitations = () => injectedService ?? clientInvitationService()
  const sessions = () => injectedSessions ?? studioSessionService()
  const routes = new Hono()

  routes.use(
    '*',
    cors({
      origin: studioOrigin,
      credentials: true,
      allowMethods: ['POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Idempotency-Key', 'Command-Id'],
      maxAge: 600,
    }),
  )
  routes.use('*', async (c, next) => {
    await next()
    c.header('Vary', 'Origin')
    c.header('Cache-Control', 'no-store')
    c.header('Referrer-Policy', 'no-referrer')
  })

  /*
   * OP-REL-001. Offering is not granting: this writes an invitation and one
   * option per scope, and nothing else. The relationship, the grants and the
   * person's own record only exist once they answer.
   */
  routes.post('/organizations/:organizationId/client-invitations', async (c) => {
    if (c.req.header('origin') !== studioOrigin) {
      return fail(c, 'forbidden', 'origin is not allowed')
    }
    const organizationId = c.req.param('organizationId')
    if (!UUID.test(organizationId)) return fail(c, 'invalid-request')
    const body = await readJson(c)
    if (!isClientInvitationCreate(body)) return fail(c, 'validation-failed')
    const command = commandContext(c, body)
    if (!command) return fail(c, 'invalid-request', 'valid command headers are required')

    try {
      const actor = await studioActor(c, sessions())
      if (actor instanceof Response) return actor
      const result = await invitations().issue(actor, {
        organizationId,
        channel: body.channel,
        contact: body.contact.trim().toLowerCase(),
        scopes: body.scopes.map((scope) => ({
          scopeCode: scope.scope_code as ScopeCode,
          accessLevel: scope.access_level as AccessLevel,
          purpose: scope.purpose.trim(),
          presentedSnapshot: scope.presented_snapshot as Record<string, unknown>,
        })),
        ...command,
      })
      if (result.replayed) c.header('Idempotent-Replay', 'true')
      return c.json(
        {
          id: result.resource.id,
          invitation_intent_id: result.resource.intentId,
          status: result.resource.status,
          channel: result.resource.channel,
          contact_hint: result.resource.contactHint,
          expires_at: result.resource.expiresAt.toISOString(),
          scope_codes: result.resource.scopeCodes,
          reused: result.resource.reused,
        },
        result.resource.reused ? 200 : 201,
      )
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  return routes
}

/*
 * Resolving the session actor is duplicated across this domain's handlers on
 * purpose: boundary rule 5 forbids reaching into another handler's internals,
 * and a dozen lines of cookie reading is the cheaper side of that trade.
 */
async function studioActor(c: Context, sessions: StudioSessionService) {
  const token = getCookie(c, STUDIO_SESSION_COOKIE)
  if (!token) return fail(c, 'unauthenticated', 'missing session cookie')
  try {
    return await sessions.resolveActor(token)
  } catch (error) {
    if (error instanceof StudioSessionError) return fail(c, error.code)
    throw error
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

function isClientInvitationCreate(value: unknown): value is ClientInvitationCreate {
  if (!isObject(value) || Object.keys(value).sort().join(',') !== 'channel,contact,scopes') {
    return false
  }
  if (value.channel !== 'email') return false
  if (
    typeof value.contact !== 'string' ||
    value.contact.trim().length < 3 ||
    value.contact.length > MAX_CONTACT
  ) {
    return false
  }
  if (!Array.isArray(value.scopes) || value.scopes.length === 0) return false
  if (value.scopes.length > SCOPE_CODES.size) return false
  const seen = new Set<string>()
  return value.scopes.every((scope) => {
    if (!isScopeRequest(scope) || seen.has(scope.scope_code)) return false
    seen.add(scope.scope_code)
    return true
  })
}

function isScopeRequest(value: unknown): value is {
  scope_code: string
  access_level: string
  purpose: string
  presented_snapshot: Record<string, unknown>
} {
  return (
    isObject(value) &&
    Object.keys(value).sort().join(',') === 'access_level,presented_snapshot,purpose,scope_code' &&
    typeof value.scope_code === 'string' &&
    SCOPE_CODES.has(value.scope_code as ScopeCode) &&
    typeof value.access_level === 'string' &&
    ACCESS_LEVELS.has(value.access_level as AccessLevel) &&
    typeof value.purpose === 'string' &&
    value.purpose.trim().length > 0 &&
    value.purpose.length <= MAX_PURPOSE &&
    isObject(value.presented_snapshot)
  )
}

function operationFailure(c: Context, error: unknown) {
  if (error instanceof StudioSessionError || error instanceof StudioInvitationError) {
    return fail(c, error.code)
  }
  const sqlState = isObject(error) && typeof error.code === 'string' ? error.code : undefined
  if (sqlState === '42501') return fail(c, 'forbidden')
  if (sqlState === 'P0002') return fail(c, 'not-found')
  if (sqlState === 'P0001') {
    c.header('Retry-After', '3600')
    return fail(c, 'rate-limited')
  }
  if (sqlState === 'P0004') return fail(c, 'conflict')
  if (sqlState === '23505' || sqlState === '40001') return fail(c, 'conflict')
  if (sqlState === '22023' || sqlState === '23514' || sqlState === '22P02') {
    return fail(c, 'validation-failed')
  }
  console.error('[studio-client-invitations] operation failed')
  return fail(c, 'upstream-unavailable')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
