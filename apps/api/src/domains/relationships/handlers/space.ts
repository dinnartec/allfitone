/**
 * `/space/v1/relationships`: the gyms the caller trains at, and the ones she used to.
 *
 * Small, and load-bearing. Every other operation about one of her organizations needs an
 * id, and this is the only thing that produces one — without it the plans screen, the
 * subscription and everything else about a gym are unreachable from the app.
 *
 * Carries no fitness data. Which rows come back is the row policy's decision in
 * PostgreSQL, so there is no narrowing here to fall out of step with it.
 */

import type { VerifiedToken } from '@allfitone/auth-provider'
import { Hono, type Context } from 'hono'

import { authProvider } from '../../../platform/auth/index.js'
import { fail } from '../../../platform/http/index.js'
import {
  SpaceActorError,
  spaceActorResolver,
  type SpaceActorResolver,
} from '../../identity/index.js'
import { myRelationshipService } from '../dependencies.js'
import type { MyRelationshipService } from '../application/index.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/
const PAGE_LIMIT = { default: 50, max: 100 } as const

export type TokenVerifier = (token: string) => Promise<VerifiedToken>

export function spaceRelationshipRoutes(
  injectedService?: MyRelationshipService,
  injectedVerifier?: TokenVerifier,
  injectedActors?: SpaceActorResolver,
): Hono {
  const relationships = () => injectedService ?? myRelationshipService()
  const actors = () => injectedActors ?? spaceActorResolver()
  const verify: TokenVerifier =
    injectedVerifier ?? ((token) => authProvider().verifyAccessToken(token, 'space'))
  const routes = new Hono()

  routes.get('/relationships', async (c) => {
    c.header('Cache-Control', 'private, no-store')

    const limit = parseLimit(c.req.query('limit'))
    if (!limit) return fail(c, 'validation-failed')
    const cursor = parseCursor(c.req.query('cursor'))
    if (cursor === null) return fail(c, 'validation-failed')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    try {
      const personId = await actors().personFor(token.subject)
      const page = await relationships().listMine(personId, {
        limit,
        requestId: c.req.header('x-request-id') ?? '',
        ...(cursor ?? {}),
      })
      const last = page.items.at(-1)
      return c.json({
        data: page.items,
        page: {
          has_more: page.hasMore,
          next_cursor:
            page.hasMore && last ? encodeCursor([last.started_at, last.relationship_id]) : null,
        },
      })
    } catch (cause) {
      return failure(c, cause)
    }
  })

  return routes
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

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return PAGE_LIMIT.default
  if (!/^[1-9][0-9]*$/.test(value)) return undefined
  const parsed = Number(value)
  return parsed <= PAGE_LIMIT.max ? parsed : undefined
}

/**
 * `undefined` is no cursor, `null` is one that could not be read. Collapsing the two
 * would silently serve page one to somebody paging forward.
 */
function parseCursor(
  value: string | undefined,
): { cursorStartedAt: string; cursorRelationshipId: string } | null | undefined {
  if (value === undefined) return undefined
  if (!/^[A-Za-z0-9_-]{8,1024}$/.test(value)) return null
  let parts: string[]
  try {
    parts = Buffer.from(value, 'base64url').toString('utf8').split('\u001f')
  } catch {
    return null
  }
  if (parts.length !== 2) return null
  const [startedAt, relationshipId] = parts
  if (!startedAt || !TIMESTAMP.test(startedAt)) return null
  if (!relationshipId || !UUID.test(relationshipId)) return null
  return { cursorStartedAt: startedAt, cursorRelationshipId: relationshipId }
}

function encodeCursor(parts: string[]): string {
  return Buffer.from(parts.join('\u001f'), 'utf8').toString('base64url')
}

function failure(c: Parameters<typeof fail>[0], error: unknown): Response {
  if (error instanceof SpaceActorError) return fail(c, error.code)
  const sqlState =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : undefined
  if (sqlState === '42501') return fail(c, 'forbidden')
  if (sqlState === '22023' || sqlState === '22P02') return fail(c, 'validation-failed')
  console.error('[space-relationships] operation failed')
  return fail(c, 'upstream-unavailable')
}
