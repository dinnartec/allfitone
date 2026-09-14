/**
 * Studio routes for an organization Allfit handed over: resolving its token and
 * deciding it. `HU-BO-014`.
 *
 * Kept apart from the team invitation routes on purpose. A team token never opens
 * here and an ownership token never opens there, so neither flow can be steered into
 * the other by the path a client chooses.
 */

import { createHash } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { cors } from 'hono/cors'

import { fail } from '../../../platform/http/index.js'
import { StudioSessionError, type StudioSessionService } from '../application/index.js'
import { StudioInvitationError } from '../application/invitations.js'
import type { StudioOwnershipInvitationService } from '../application/ownership-invitations.js'
import {
  studioOwnershipInvitationService,
  studioSessionService,
  trustedStudioWebUrl,
} from '../dependencies.js'
import { STUDIO_SESSION_COOKIE } from './studio.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TOKEN = /^[A-Za-z0-9_-]{43}$/

export function studioOwnershipInvitationRoutes(
  injectedService?: StudioOwnershipInvitationService,
  injectedSessions?: StudioSessionService,
): Hono {
  const studioOrigin = new URL(trustedStudioWebUrl()).origin
  const invitations = () => injectedService ?? studioOwnershipInvitationService()
  const sessions = () => injectedSessions ?? studioSessionService()
  const routes = new Hono()

  routes.use(
    '*',
    cors({
      origin: studioOrigin,
      credentials: true,
      allowMethods: ['POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Idempotency-Key', 'Command-Id'],
      exposeHeaders: ['Idempotent-Replay', 'Server-Timing'],
      maxAge: 600,
    }),
  )
  routes.use('*', async (c, next) => {
    await next()
    c.header('Vary', 'Origin')
    c.header('Cache-Control', 'no-store')
    c.header('Referrer-Policy', 'no-referrer')
  })

  routes.post('/ownership-invitations/resolve', async (c) => {
    if (c.req.header('origin') !== studioOrigin) {
      return fail(c, 'forbidden', 'origin is not allowed')
    }
    const body = await readJson(c)
    if (!isTokenBody(body)) return fail(c, 'validation-failed')
    try {
      const invitation = await invitations().resolve(body.token)
      return c.json({
        id: invitation.id,
        organization: {
          id: invitation.organization.id,
          display_name: invitation.organization.displayName,
          type_name: invitation.organization.typeName,
          party_kind: invitation.organization.partyKind,
          legal_name: invitation.organization.legalName,
          site_name: invitation.organization.siteName,
        },
        expires_at: invitation.expiresAt.toISOString(),
        intent: { id: invitation.intent.id, status: 'pending' as const },
      })
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.post('/ownership-invitations/decisions', async (c) => {
    if (c.req.header('origin') !== studioOrigin) {
      return fail(c, 'forbidden', 'origin is not allowed')
    }
    const body = await readJson(c)
    if (!isDecisionBody(body)) return fail(c, 'validation-failed')
    const command = commandContext(c, body)
    if (!command) return fail(c, 'invalid-request', 'valid command headers are required')
    try {
      const identity = await studioIdentity(c, sessions())
      if (identity instanceof Response) return identity
      const result = await invitations().decide(identity, {
        token: body.token,
        intentId: body.intent_id,
        decision: body.decision,
        ...command,
      })
      if (result.replayed) c.header('Idempotent-Replay', 'true')
      return c.json({
        invitation_id: result.resource.invitationId,
        invitation_status: result.resource.invitationStatus,
        organization_id: result.resource.organizationId,
        intent: {
          id: result.resource.intentId,
          status: result.resource.intentStatus,
          membership_id: result.resource.membershipId,
        },
        replayed: result.replayed,
      })
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  return routes
}

async function studioIdentity(c: Context, sessions: StudioSessionService) {
  const token = getCookie(c, STUDIO_SESSION_COOKIE)
  if (!token) return fail(c, 'unauthenticated', 'missing session cookie')
  try {
    return await sessions.resolveAccountIdentity(token)
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

function isTokenBody(value: unknown): value is { token: string } {
  return (
    isObject(value) &&
    Object.keys(value).join(',') === 'token' &&
    typeof value.token === 'string' &&
    TOKEN.test(value.token)
  )
}

function isDecisionBody(value: unknown): value is {
  token: string
  intent_id: string
  decision: 'accepted' | 'rejected'
} {
  return (
    isObject(value) &&
    Object.keys(value).sort().join(',') === 'decision,intent_id,token' &&
    typeof value.token === 'string' &&
    TOKEN.test(value.token) &&
    typeof value.intent_id === 'string' &&
    UUID.test(value.intent_id) &&
    (value.decision === 'accepted' || value.decision === 'rejected')
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function operationFailure(c: Context, error: unknown) {
  if (error instanceof StudioSessionError || error instanceof StudioInvitationError) {
    return fail(c, error.code)
  }
  const sqlState = isObject(error) && typeof error.code === 'string' ? error.code : undefined
  if (sqlState === '42501') return fail(c, 'forbidden')
  if (sqlState === 'P0002') return fail(c, 'not-found')
  if (sqlState === '23505' || sqlState === '40001') return fail(c, 'conflict')
  if (sqlState === '22023' || sqlState === '23514' || sqlState === '22P02') {
    return fail(c, 'validation-failed')
  }
  console.error('[studio-ownership-invitations] operation failed')
  return fail(c, 'upstream-unavailable')
}
