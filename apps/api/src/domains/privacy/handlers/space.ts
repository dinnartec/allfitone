/**
 * `/space/v1/consents`: what the caller shares with each gym, and taking one category
 * back (HU-SP-030, HU-SP-031).
 *
 * Both act as the caller and nobody else. Which rows come back, whose grant it is and
 * whether it can still be revoked are PostgreSQL's answers; this route checks the shape
 * of the request, carries the person through, and translates the refusal.
 *
 * The revocation has no body, so what makes it idempotent is hashed from the path: an
 * empty object would let one key replay across two different grants.
 */

import { createHash } from 'node:crypto'

import type { VerifiedToken } from '@allfitone/auth-provider'
import { Hono, type Context } from 'hono'

import { authProvider } from '../../../platform/auth/index.js'
import { fail } from '../../../platform/http/index.js'
import {
  SpaceActorError,
  spaceActorResolver,
  type SpaceActorResolver,
} from '../../identity/index.js'
import { myConsentService } from '../dependencies.js'
import type { MyConsentService } from '../application/index.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type TokenVerifier = (token: string) => Promise<VerifiedToken>

export function spacePrivacyRoutes(
  injectedConsents?: MyConsentService,
  injectedVerifier?: TokenVerifier,
  injectedActors?: SpaceActorResolver,
): Hono {
  const consents = () => injectedConsents ?? myConsentService()
  const actors = () => injectedActors ?? spaceActorResolver()
  const verify: TokenVerifier =
    injectedVerifier ?? ((token) => authProvider().verifyAccessToken(token, 'space'))
  const routes = new Hono()

  // `OP-PRV-013`.
  routes.get('/consents', async (c) => {
    c.header('Cache-Control', 'private, no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    try {
      const personId = await actors().personFor(token.subject)
      return c.json({ data: await consents().listMine(personId) })
    } catch (cause) {
      return failure(c, cause)
    }
  })

  // `OP-PRV-005`. Only that grant; a revoked one never comes back.
  routes.post('/consents/:grantId/revocation', async (c) => {
    c.header('Cache-Control', 'no-store')

    const grantId = c.req.param('grantId')
    if (!UUID.test(grantId)) return fail(c, 'invalid-request')
    const command = commandContext(c, { grantId })
    if (!command) return fail(c, 'invalid-request', 'valid command headers are required')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    try {
      const personId = await actors().personFor(token.subject)
      const result = await consents().revoke({ personId, grantId, ...command })
      if (result.replayed) c.header('Idempotent-Replay', 'true')
      return c.json({
        id: result.resource.grantId,
        status: result.resource.status,
        revoked_at: result.resource.revokedAt,
      })
    } catch (cause) {
      return failure(c, cause)
    }
  })

  return routes
}

function commandContext(c: Context, target: Record<string, string>) {
  const idempotencyKey = c.req.header('idempotency-key') ?? ''
  const commandId = c.req.header('command-id') ?? ''
  if (!UUID_V4.test(idempotencyKey) || !UUID_V7.test(commandId)) return undefined
  const canonical = Object.entries(target)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${JSON.stringify(key)}:${JSON.stringify(value)}`)
    .join(',')
  return {
    idempotencyKey,
    commandId,
    requestHash: createHash('sha256').update(`{${canonical}}`).digest(),
  }
}

async function verified(c: Context, verify: TokenVerifier): Promise<VerifiedToken | undefined> {
  const [scheme, value] = (c.req.header('authorization') ?? '').split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !value) return undefined
  try {
    return await verify(value)
  } catch {
    return undefined
  }
}

function failure(c: Parameters<typeof fail>[0], error: unknown): Response {
  if (error instanceof SpaceActorError) return fail(c, error.code)
  const sqlState =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : undefined
  if (sqlState === '42501') return fail(c, 'forbidden')
  // Somebody else's grant answers «not found»: whether it exists is not hers to learn.
  if (sqlState === 'P0002') return fail(c, 'not-found')
  // Already revoked is a state she can see by looking, not something to retry.
  if (sqlState === 'P0004' || sqlState === '40001') return fail(c, 'conflict')
  if (sqlState === '22023' || sqlState === '22P02') return fail(c, 'validation-failed')
  console.error('[space-privacy] operation failed')
  return fail(c, 'upstream-unavailable')
}
