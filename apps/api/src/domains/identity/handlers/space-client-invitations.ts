/**
 * Client invitation routes on /space/v1.
 *
 * Space is where the person answers. Both routes need two facts the access
 * token does not carry: which person this is, and which email their provider
 * verified. The first comes from the account directory, the second from the
 * provider, and the database compares the second against the contact the
 * invitation was addressed to.
 *
 * The token travels in the body on both routes, never in the path, so it stays
 * out of server logs and browser history. `resolve` is a POST for that reason
 * and not because it changes anything the caller asked to change.
 */

import { createHash } from 'node:crypto'
import type { VerifiedToken } from '@allfitone/auth-provider'
import { Hono, type Context } from 'hono'

import { fail } from '../../../platform/http/index.js'
import { authProvider } from '../../../platform/auth/index.js'
import { StudioInvitationError } from '../application/invitations.js'
import type {
  ClientInvitationService,
  SpaceInvitationIdentity,
} from '../application/client-invitations.js'
import { clientInvitationService, spaceActorResolver } from '../dependencies.js'
import type {
  ClientInvitationPresentation,
  ConsentDecision,
  ScopeCode,
} from '../domain/client-invitations.js'

export type TokenVerifier = (token: string) => Promise<VerifiedToken>
export type SpaceIdentityResolver = (subject: string) => Promise<SpaceInvitationIdentity>

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TOKEN = /^[A-Za-z0-9_-]{43}$/
const SCOPE_CODES = new Set<ScopeCode>([
  'relationship_training',
  'prior_training_history',
  'body_progress',
  'health_context',
  'nutrition_intake',
  'nutrition_guidance',
  'nutrition_media',
])

export function spaceClientInvitationRoutes(
  injectedService?: ClientInvitationService,
  injectedVerifier?: TokenVerifier,
  injectedIdentity?: SpaceIdentityResolver,
): Hono {
  const invitations = () => injectedService ?? clientInvitationService()
  const verify: TokenVerifier =
    injectedVerifier ?? ((token) => authProvider().verifyAccessToken(token, 'space'))
  const identityFor: SpaceIdentityResolver = injectedIdentity ?? resolveSpaceIdentity
  const routes = new Hono()

  routes.use('*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
    c.header('Referrer-Policy', 'no-referrer')
  })

  /*
   * OP-REL-015. Each scope comes back on its own, with the purpose it was asked
   * for and the contract as it was presented, because the person answers them
   * one at a time and cannot answer what they were not shown.
   */
  routes.post('/client-invitations/resolve', async (c) => {
    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')
    const body = await readJson(c)
    if (!isTokenBody(body)) return fail(c, 'validation-failed')

    try {
      const identity = await identityFor(token.subject)
      const invitation = await invitations().resolve(identity, {
        token: body.token,
        requestId: c.req.header('command-id') ?? crypto.randomUUID(),
      })
      return c.json(presentInvitation(invitation))
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  /*
   * Her pending invitations, by the email her provider verified — the same key the
   * decision requires. Somebody still registering may ask: it is how she learns one is
   * waiting at the end.
   */
  routes.get('/client-invitations', async (c) => {
    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')
    try {
      const identity = await identityFor(token.subject)
      const pending = await invitations().listMine(identity)
      return c.json({
        data: pending.map((invitation) => ({
          id: invitation.id,
          invitation_intent_id: invitation.intentId,
          organization_id: invitation.organizationId,
          organization_name: invitation.organizationName,
          invited_by: invitation.invitedBy,
          expires_at: invitation.expiresAt.toISOString(),
        })),
      })
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  /* One of her pending invitations, by id, under the same recipient test as the link. */
  routes.get('/client-invitations/:invitationId', async (c) => {
    const invitationId = c.req.param('invitationId')
    if (!UUID.test(invitationId)) return fail(c, 'invalid-request')
    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')
    try {
      const identity = await identityFor(token.subject)
      return c.json(presentInvitation(await invitations().readMine(identity, { invitationId })))
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  /*
   * OP-IDN-009. One call answers the relationship and every scope, because they
   * were presented together. A scope left out of `scope_decisions` is rejected:
   * silence is not consent.
   */
  routes.post('/client-invitations/decisions', async (c) => {
    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')
    const body = await readJson(c)
    if (!isDecisionBody(body)) return fail(c, 'validation-failed')
    const command = commandContext(c, body)
    if (!command) return fail(c, 'invalid-request', 'valid command headers are required')

    try {
      const identity = await identityFor(token.subject)
      const result = await invitations().decide(identity, {
        ...('token' in body ? { token: body.token } : { invitationId: body.invitation_id }),
        intentId: body.invitation_intent_id,
        relationshipDecision: body.relationship_decision,
        scopeDecisions: body.scope_decisions ?? {},
        ...command,
      })
      if (result.replayed) c.header('Idempotent-Replay', 'true')
      return c.json({
        invitation_id: result.resource.invitationId,
        invitation_status: result.resource.invitationStatus,
        organization_id: result.resource.organizationId,
        invitation_intent_id: result.resource.intentId,
        intent_status: result.resource.intentStatus,
        relationship_id: result.resource.relationshipId,
        granted_scope_codes: result.resource.grantedScopeCodes,
        replayed: result.replayed,
      })
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  return routes
}

async function resolveSpaceIdentity(subject: string): Promise<SpaceInvitationIdentity> {
  const [personId, identity] = await Promise.all([
    spaceActorResolver()
      .personFor(subject)
      .catch(() => null),
    authProvider().identityFor(subject),
  ])
  return { personId, verifiedEmail: identity.verifiedEmail }
}

async function verified(c: Context, verify: TokenVerifier): Promise<VerifiedToken | undefined> {
  const header = c.req.header('authorization')
  const [scheme, value] = header?.split(' ') ?? []
  if (scheme?.toLowerCase() !== 'bearer' || !value) {
    // Server-side only. The client is told one thing for every cause.
    console.warn('[identity] space client invitation refused', { reason: 'no-bearer-header' })
    return undefined
  }
  try {
    return await verify(value)
  } catch (cause) {
    console.warn('[identity] space client invitation refused', {
      reason: 'token-rejected',
      detail: String(cause).slice(0, 160),
    })
    return undefined
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

function isDecisionBody(value: unknown): value is (
  { token: string } | { invitation_id: string }
) & {
  invitation_intent_id: string
  relationship_decision: ConsentDecision
  scope_decisions?: Record<string, ConsentDecision>
} {
  if (!isObject(value)) return false
  // The invitation is named by the token or by its id, never both.
  const named = ['token', 'invitation_id'].filter((key) => key in value)
  if (named.length !== 1) return false
  const keys = Object.keys(value)
    .filter((key) => key !== 'token' && key !== 'invitation_id')
    .sort()
    .join(',')
  if (
    keys !== 'invitation_intent_id,relationship_decision' &&
    keys !== 'invitation_intent_id,relationship_decision,scope_decisions'
  ) {
    return false
  }
  if ('token' in value && (typeof value.token !== 'string' || !TOKEN.test(value.token)))
    return false
  if (
    'invitation_id' in value &&
    (typeof value.invitation_id !== 'string' || !UUID.test(value.invitation_id))
  ) {
    return false
  }
  if (typeof value.invitation_intent_id !== 'string' || !UUID.test(value.invitation_intent_id)) {
    return false
  }
  if (!isDecision(value.relationship_decision)) return false
  if (value.scope_decisions === undefined) return true
  if (!isObject(value.scope_decisions)) return false
  return Object.entries(value.scope_decisions).every(
    ([code, decision]) => SCOPE_CODES.has(code as ScopeCode) && isDecision(decision),
  )
}

function presentInvitation(invitation: ClientInvitationPresentation) {
  return {
    id: invitation.id,
    invitation_intent_id: invitation.intentId,
    status: invitation.status,
    invited_by: invitation.invitedBy,
    organization: {
      id: invitation.organization.id,
      display_name: invitation.organization.displayName,
      responsible_party: invitation.organization.responsibleParty,
    },
    expires_at: invitation.expiresAt.toISOString(),
    scope_options: invitation.scopeOptions.map((option) => ({
      scope_code: option.scopeCode,
      offered_access_level: option.offeredAccessLevel,
      purpose: option.purpose,
      presented_snapshot_schema_version: option.presentedSnapshotSchemaVersion,
      presented_snapshot: option.presentedSnapshot,
      decision: option.decision,
    })),
  }
}

function isDecision(value: unknown): value is ConsentDecision {
  return value === 'accepted' || value === 'rejected'
}

function operationFailure(c: Context, error: unknown) {
  if (error instanceof StudioInvitationError) return fail(c, error.code)
  const sqlState = isObject(error) && typeof error.code === 'string' ? error.code : undefined
  if (sqlState === '42501') return fail(c, 'forbidden')
  if (sqlState === 'P0002') return fail(c, 'not-found')
  if (sqlState === 'P0004') return fail(c, 'conflict')
  if (sqlState === '23505' || sqlState === '40001') return fail(c, 'conflict')
  if (sqlState === '22023' || sqlState === '23514' || sqlState === '22P02') {
    return fail(c, 'validation-failed')
  }
  console.error('[space-client-invitations] operation failed')
  return fail(c, 'upstream-unavailable')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
