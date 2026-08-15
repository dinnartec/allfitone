/** Team invitation command for Studio. */

import { createHash, randomUUID } from 'node:crypto'
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
import type { TeamInvitationStatus } from '../domain/index.js'
import { STUDIO_SESSION_COOKIE } from './studio.js'

type TeamInvitationCreate = AllfitV1Schemas['TeamInvitationCreate']

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ROLES = new Set<TeamInvitationRole>(['admin', 'coach', 'staff'])
const STATUSES = new Set<TeamInvitationStatus>(['pending', 'completed', 'revoked', 'expired'])
const TOKEN = /^[A-Za-z0-9_-]{43}$/

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
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Idempotency-Key', 'Command-Id'],
      exposeHeaders: ['ETag', 'Server-Timing'],
      maxAge: 600,
    }),
  )
  routes.use('*', async (c, next) => {
    await next()
    c.header('Vary', 'Origin')
    c.header('Cache-Control', 'no-store')
    c.header('Referrer-Policy', 'no-referrer')
  })

  routes.post('/invitations/resolve', async (c) => {
    if (!trustedOrigin(c, studioOrigin)) return fail(c, 'forbidden', 'origin is not allowed')
    const body = await readJson(c)
    if (!isTokenBody(body)) return fail(c, 'validation-failed')
    try {
      const result = await invitations().resolve(body.token)
      recordStudioTeamInvitation('resolved')
      return c.json({
        id: result.id,
        status: result.status,
        organization: {
          id: result.organizationId,
          display_name: result.organizationDisplayName,
          responsible_party: {
            kind: result.responsibleParty.party_kind,
            name: result.responsibleParty.party_name,
          },
        },
        expires_at: result.expiresAt.toISOString(),
        intents: [
          {
            id: result.intent.id,
            kind: result.intent.kind,
            status: result.intent.status,
            proposed_role_code: result.intent.proposedRoleCode,
          },
        ],
      })
    } catch (error) {
      recordStudioTeamInvitation('resolve-failed')
      return operationFailure(c, error)
    }
  })

  routes.post('/invitations/decisions', async (c) => {
    if (!trustedOrigin(c, studioOrigin)) return fail(c, 'forbidden', 'origin is not allowed')
    const body = await readJson(c)
    if (!isDecisionBody(body)) return fail(c, 'validation-failed')
    const command = commandContext(c, body)
    if (!command) return fail(c, 'invalid-request', 'valid command headers are required')
    try {
      const identity = await studioIdentity(c, sessions())
      if (identity instanceof Response) return identity
      const decision = body.decisions[0]
      if (!decision) return fail(c, 'validation-failed')
      const result = await invitations().decide(identity, {
        token: body.token,
        intentId: decision.intent_id,
        decision: decision.decision,
        ...command,
      })
      if (result.replayed) c.header('Idempotent-Replay', 'true')
      recordStudioTeamInvitation(result.replayed ? 'decision-replayed' : 'decided')
      return c.json({
        invitation_id: result.resource.invitationId,
        invitation_status: result.resource.invitationStatus,
        organization_id: result.resource.organizationId,
        intent: {
          id: result.resource.intentId,
          kind: 'membership' as const,
          status: result.resource.intentStatus,
          proposed_role_code: result.resource.proposedRoleCode,
          membership_id: result.resource.membershipId,
        },
        replayed: result.replayed,
      })
    } catch (error) {
      recordStudioTeamInvitation('decision-failed')
      return operationFailure(c, error)
    }
  })

  routes.get('/organizations/:organizationId/invitations', async (c) => {
    if (!trustedOrigin(c, studioOrigin)) return fail(c, 'forbidden', 'origin is not allowed')
    const organizationId = c.req.param('organizationId')
    if (!UUID.test(organizationId)) return fail(c, 'invalid-request')
    const statusValue = c.req.query('status')
    const status =
      statusValue && STATUSES.has(statusValue as TeamInvitationStatus)
        ? (statusValue as TeamInvitationStatus)
        : undefined
    if (statusValue && !status) return fail(c, 'validation-failed')
    const limit = parseLimit(c.req.query('limit'))
    if (!limit) return fail(c, 'validation-failed')
    const cursor = parseCursor(c.req.query('cursor'), status)
    if (cursor === null) return fail(c, 'validation-failed')
    try {
      const actor = await studioActor(c, sessions())
      if (actor instanceof Response) return actor
      const result = await invitations().list(actor, {
        organizationId,
        ...(status ? { status } : {}),
        limit,
        ...(cursor ?? {}),
        requestId: randomUUID(),
      })
      const last = result.items.at(-1)
      recordStudioTeamInvitation('listed')
      return c.json({
        data: result.items.map((item) => ({
          id: item.id,
          status: item.status,
          channel: item.channel,
          contact: item.contact,
          created_at: item.createdAt.toISOString(),
          expires_at: item.expiresAt.toISOString(),
          intents: [
            {
              id: item.intent.id,
              kind: item.intent.kind,
              status: item.intent.status,
              proposed_role_code: item.intent.proposedRoleCode,
              decided_at: item.intent.decidedAt?.toISOString() ?? null,
            },
          ],
        })),
        page: {
          has_more: result.hasMore,
          next_cursor:
            result.hasMore && last ? encodeCursor(last.createdAt, last.id, status) : null,
        },
      })
    } catch (error) {
      recordStudioTeamInvitation('list-failed')
      return operationFailure(c, error)
    }
  })

  routes.post('/organizations/:organizationId/invitations/:invitationId/revocation', async (c) => {
    if (!trustedOrigin(c, studioOrigin)) return fail(c, 'forbidden', 'origin is not allowed')
    const organizationId = c.req.param('organizationId')
    const invitationId = c.req.param('invitationId')
    if (!UUID.test(organizationId) || !UUID.test(invitationId)) return fail(c, 'invalid-request')
    const body = await readJson(c)
    if (!isEmptyObject(body)) return fail(c, 'validation-failed')
    const command = commandContext(c, body)
    if (!command) return fail(c, 'invalid-request', 'valid command headers are required')
    try {
      const actor = await studioActor(c, sessions())
      if (actor instanceof Response) return actor
      const result = await invitations().revoke(actor, {
        organizationId,
        invitationId,
        ...command,
      })
      if (result.replayed) c.header('Idempotent-Replay', 'true')
      recordStudioTeamInvitation(result.replayed ? 'revocation-replayed' : 'revoked')
      return c.json({ id: result.resource.id, status: result.resource.status })
    } catch (error) {
      recordStudioTeamInvitation('revocation-failed')
      return operationFailure(c, error)
    }
  })

  routes.post('/organizations/:organizationId/invitations', async (c) => {
    if (!trustedOrigin(c, studioOrigin)) return fail(c, 'forbidden', 'origin is not allowed')
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
  decisions: Array<{ intent_id: string; decision: 'accepted' | 'rejected' }>
} {
  if (!isObject(value) || !isTokenBody({ token: value.token }) || !Array.isArray(value.decisions)) {
    return false
  }
  if (Object.keys(value).sort().join(',') !== 'decisions,token' || value.decisions.length !== 1) {
    return false
  }
  const decision = value.decisions[0]
  return (
    isObject(decision) &&
    Object.keys(decision).sort().join(',') === 'decision,intent_id' &&
    typeof decision.intent_id === 'string' &&
    UUID.test(decision.intent_id) &&
    (decision.decision === 'accepted' || decision.decision === 'rejected')
  )
}

function isEmptyObject(value: unknown): value is Record<string, never> {
  return isObject(value) && Object.keys(value).length === 0
}

function trustedOrigin(c: Context, expected: string): boolean {
  return c.req.header('origin') === expected
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return 50
  if (!/^[1-9][0-9]*$/.test(value)) return undefined
  const parsed = Number(value)
  return parsed <= 100 ? parsed : undefined
}

function parseCursor(
  value: string | undefined,
  status: TeamInvitationStatus | undefined,
): { cursorCreatedAt: Date; cursorId: string } | undefined | null {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
    if (
      !isObject(parsed) ||
      parsed.v !== 1 ||
      parsed.status !== (status ?? null) ||
      typeof parsed.created_at !== 'string' ||
      typeof parsed.id !== 'string' ||
      !UUID.test(parsed.id)
    ) {
      return null
    }
    const createdAt = new Date(parsed.created_at)
    if (Number.isNaN(createdAt.getTime())) return null
    return { cursorCreatedAt: createdAt, cursorId: parsed.id }
  } catch {
    return null
  }
}

function encodeCursor(
  createdAt: Date,
  id: string,
  status: TeamInvitationStatus | undefined,
): string {
  return Buffer.from(
    JSON.stringify({ v: 1, status: status ?? null, created_at: createdAt.toISOString(), id }),
  ).toString('base64url')
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
  if (sqlState === 'P0001') {
    c.header('Retry-After', '3600')
    recordStudioTeamInvitation('rate-limited')
    return fail(c, 'rate-limited')
  }
  if (sqlState === 'P0004') return fail(c, 'conflict')
  if (sqlState === '23505' || sqlState === '40001') return fail(c, 'conflict')
  if (sqlState === '22023' || sqlState === '23514' || sqlState === '22P02') {
    return fail(c, 'validation-failed')
  }
  console.error('[studio-invitations] operation failed')
  return fail(c, 'upstream-unavailable')
}
