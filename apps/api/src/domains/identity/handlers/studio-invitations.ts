/** Team invitation command for Studio. */

import { createHash } from 'node:crypto'
import type { AllfitV1Schemas } from '@allfitone/contracts'
import { Hono, type Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { cors } from 'hono/cors'

import { fail } from '../../../platform/http/index.js'
import { recordStudioTeamInvitation } from '../../../platform/observability/index.js'
import { StudioSessionError, type StudioSessionService } from '../application/index.js'
import { StudioInvitationError, type StudioInvitationService } from '../application/invitations.js'
import {
  studioInvitationService,
  studioSessionService,
  trustedStudioWebUrl,
} from '../dependencies.js'
import type { TeamInvitationRole } from '../domain/index.js'
import { STUDIO_SESSION_COOKIE } from './studio.js'

type TeamInvitationCreate = AllfitV1Schemas['TeamInvitationCreate']

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ROLES = new Set<TeamInvitationRole>(['admin', 'coach', 'staff'])

export function studioInvitationRoutes(
  injectedService?: StudioInvitationService,
  injectedSessions?: StudioSessionService,
): Hono {
  const studioOrigin = new URL(trustedStudioWebUrl()).origin
  const invitations = () => injectedService ?? studioInvitationService()
  const sessions = () => injectedSessions ?? studioSessionService()
  const routes = new Hono()

  routes.use(
    '*',
    cors({
      origin: studioOrigin,
      credentials: true,
      allowMethods: ['POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Idempotency-Key', 'Command-Id'],
    }),
  )
  routes.use('*', async (c, next) => {
    await next()
    c.header('Vary', 'Origin')
  })

  routes.post('/organizations/:organizationId/invitations', async (c) => {
    c.header('Cache-Control', 'no-store')
    if (c.req.header('origin') !== studioOrigin)
      return fail(c, 'forbidden', 'origin is not allowed')
    const organizationId = c.req.param('organizationId')
    if (!UUID.test(organizationId)) return fail(c, 'invalid-request')
    const body = await readJson(c)
    if (!isInvitationCreate(body)) return fail(c, 'validation-failed')
    const intent = body.intents[0]
    if (!intent) return fail(c, 'validation-failed')
    const command = commandContext(c, body)
    if (!command) return fail(c, 'invalid-request', 'valid command headers are required')

    try {
      const actor = await studioActor(c, sessions())
      if (actor instanceof Response) return actor
      const result = await invitations().issue(actor, {
        organizationId,
        channel: body.channel,
        contact: body.contact.trim().toLowerCase(),
        proposedRoleCode: intent.proposed_role_code,
        ...command,
      })
      if (result.replayed) c.header('Idempotent-Replay', 'true')
      recordStudioTeamInvitation(
        result.replayed ? 'replayed' : result.resource.reused ? 'reused' : 'created',
      )
      return c.json(
        {
          id: result.resource.id,
          status: result.resource.status,
          channel: result.resource.channel,
          contact_hint: result.resource.contactHint,
          expires_at: result.resource.expiresAt.toISOString(),
          reused: result.resource.reused,
          intents: [
            {
              id: result.resource.intentId,
              kind: 'membership' as const,
              status: 'pending' as const,
              proposed_role_code: result.resource.proposedRoleCode,
            },
          ],
        },
        result.resource.reused ? 200 : 201,
      )
    } catch (error) {
      recordStudioTeamInvitation('failed')
      return operationFailure(c, error)
    }
  })

  return routes
}

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

function isInvitationCreate(value: unknown): value is TeamInvitationCreate {
  if (!isObject(value) || !Array.isArray(value.intents) || value.intents.length !== 1) return false
  const [intent] = value.intents
  if (!isObject(intent)) return false
  return (
    Object.keys(value).sort().join(',') === 'channel,contact,intents' &&
    Object.keys(intent).sort().join(',') === 'kind,proposed_role_code' &&
    value.channel === 'email' &&
    typeof value.contact === 'string' &&
    value.contact.length <= 254 &&
    /^[^\s@]+@[^\s@]+$/.test(value.contact.trim()) &&
    intent.kind === 'membership' &&
    typeof intent.proposed_role_code === 'string' &&
    ROLES.has(intent.proposed_role_code as TeamInvitationRole)
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
  console.error('[studio-invitations] operation failed')
  return fail(c, 'upstream-unavailable')
}
