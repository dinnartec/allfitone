/**
 * `/catalog/v1/movements`, `/equipment` and `/muscles` — `OP-CAT-009`, `011` and `015`.
 *
 * The exercise library, read while somebody types in `S-1`. The catalogue surface is
 * shared by design: it holds what is true for everybody, so it has no product in it.
 *
 * **It verifies a Space token.** `/catalog/v1` is a surface and not an application, so
 * there is no `catalog` client to issue tokens for; the caller's own product is what
 * authenticates. Space is the only caller today, and a Studio token is refused rather
 * than quietly accepted — Studio reads its catalogue through its session cookie, and
 * widening this to accept both is a change to make when Studio needs it, with its own
 * test, not an accident of a permissive check.
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
import { movementLibraryService } from '../dependencies.js'
import type { MovementLibraryService } from '../application/index.js'

const MAX_DISCIPLINE = 64
const MAX_QUERY = 120
const DEFAULT_LIMIT = 40
const MAX_LIMIT = 100
const MAX_CODE = 64
/** More chips than the vocabulary has is not a filter, it is a scan. */
const MAX_FILTER_VALUES = 32

export type TokenVerifier = (token: string) => Promise<VerifiedToken>

export function catalogMovementRoutes(
  injectedLibrary?: MovementLibraryService,
  injectedVerifier?: TokenVerifier,
  injectedActors?: SpaceActorResolver,
): Hono {
  const library = () => injectedLibrary ?? movementLibraryService()
  const actors = () => injectedActors ?? spaceActorResolver()
  const verify: TokenVerifier =
    injectedVerifier ?? ((token) => authProvider().verifyAccessToken(token, 'space'))
  const routes = new Hono()

  routes.get('/movements', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const discipline = trimmed(c.req.query('discipline'))
    const query = trimmed(c.req.query('q'))
    if (discipline !== null && discipline.length > MAX_DISCIPLINE) return fail(c, 'invalid-request')
    if (query !== null && query.length > MAX_QUERY) return fail(c, 'invalid-request')

    const limit = readLimit(c.req.query('limit'))
    if (limit === undefined) return fail(c, 'invalid-request')

    const muscles = readCodes(c.req.queries('muscle'))
    const equipment = readCodes(c.req.queries('equipment'))
    if (muscles === undefined || equipment === undefined) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      return c.json(
        await library().search({ personId, discipline, query, muscles, equipment, limit }),
        200,
      )
    } catch (cause) {
      if (cause instanceof SpaceActorError) return fail(c, cause.code)
      console.error('[catalog] movement search failed')
      return fail(c, 'upstream-unavailable')
    }
  })

  routes.get('/equipment', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    try {
      const personId = await actors().personFor(token.subject)
      return c.json(await library().equipment(personId), 200)
    } catch (cause) {
      if (cause instanceof SpaceActorError) return fail(c, cause.code)
      console.error('[catalog] equipment read failed')
      return fail(c, 'upstream-unavailable')
    }
  })

  routes.get('/muscles', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    try {
      const personId = await actors().personFor(token.subject)
      return c.json(await library().muscles(personId), 200)
    } catch (cause) {
      if (cause instanceof SpaceActorError) return fail(c, cause.code)
      console.error('[catalog] muscle read failed')
      return fail(c, 'upstream-unavailable')
    }
  })

  return routes
}

/** Undefined is a refusal, not an empty filter: a malformed code is a bad request. */
function readCodes(values: string[] | undefined): string[] | undefined {
  const codes = (values ?? []).map((value) => value.trim()).filter((value) => value !== '')
  if (codes.length > MAX_FILTER_VALUES) return undefined
  if (codes.some((code) => code.length > MAX_CODE)) return undefined
  return codes
}

async function verified(c: Context, verify: TokenVerifier): Promise<VerifiedToken | undefined> {
  const header = c.req.header('authorization') ?? ''
  if (!header.toLowerCase().startsWith('bearer ')) return undefined
  try {
    return await verify(header.slice('bearer '.length).trim())
  } catch {
    return undefined
  }
}

/** An empty box is not a filter, so blank and absent are the same thing. */
function trimmed(value: string | undefined): string | null {
  const text = (value ?? '').trim()
  return text === '' ? null : text
}

function readLimit(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return DEFAULT_LIMIT
  if (!/^[1-9][0-9]*$/.test(value.trim())) return undefined
  const limit = Number(value.trim())
  return limit <= MAX_LIMIT ? limit : undefined
}
