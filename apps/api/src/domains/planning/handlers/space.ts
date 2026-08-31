/**
 * `/space/v1/programs` and `/space/v1/assignments`.
 *
 * The first screen after the onboarding, and the command behind its button.
 *
 * An account that has not activated its Fitness ID gets `forbidden` rather than an
 * empty catalogue: everything here is keyed on the person, and there is no person
 * yet. Saying "nothing to show" would be describing an absence that is really a
 * precondition.
 */

import { createHash } from 'node:crypto'
import type { VerifiedToken } from '@allfitone/auth-provider'
import { Hono, type Context } from 'hono'

import { fail } from '../../../platform/http/index.js'
import {
  SpaceActorError,
  spaceActorResolver,
  type SpaceActorResolver,
} from '../../identity/index.js'
import { authProvider } from '../../../platform/auth/index.js'
import { spacePlanningService } from '../dependencies.js'
import { spaceExecutionService, type SpaceExecutionService } from '../../execution/index.js'
import type { SpacePlanningService } from '../application/space.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
/** Long enough for every IANA zone and short enough to be worth bounding. */
const MAX_TIMEZONE = 64

export type TokenVerifier = (token: string) => Promise<VerifiedToken>

export function spacePlanningRoutes(
  injectedService?: SpacePlanningService,
  injectedVerifier?: TokenVerifier,
  injectedActors?: SpaceActorResolver,
  injectedExecutions?: SpaceExecutionService,
): Hono {
  const planning = () => injectedService ?? spacePlanningService()
  const executions = () => injectedExecutions ?? spaceExecutionService()
  const actors = () => injectedActors ?? spaceActorResolver()
  const verify: TokenVerifier =
    injectedVerifier ?? ((token) => authProvider().verifyAccessToken(token, 'space'))
  const routes = new Hono()

  routes.get('/programs', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    try {
      const personId = await actors().personFor(token.subject)
      return c.json(
        await planning().readCatalogue({ personId, requestId: c.req.header('x-request-id') ?? '' }),
        200,
      )
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.get('/today', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    // "Today" is a local question and the server must not answer it in UTC, or
    // somebody in Bogotá loses their session at seven in the evening.
    const timezone = (c.req.query('timezone') ?? '').trim()
    if (timezone === '' || timezone.length > MAX_TIMEZONE) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      const requestId = c.req.header('x-request-id') ?? ''
      // Composed, not centralised: each domain answers for its own, and the surface
      // joins them because the screen cannot draw any of them without the others.
      const [catalogue, session, week] = await Promise.all([
        planning().readCatalogue({ personId, requestId }),
        planning().readTodaySession({ personId, timezone, requestId }),
        executions().readWeekSummary({ personId, timezone, requestId }),
      ])
      return c.json(
        {
          profile: catalogue.profile,
          current_assignment: catalogue.current_assignment,
          session,
          week,
        },
        200,
      )
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.get('/programs/:programVersionId', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const programVersionId = c.req.param('programVersionId')
    if (!UUID_V7.test(programVersionId)) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      const detail = await planning().readProgram({
        personId,
        programVersionId,
        requestId: c.req.header('x-request-id') ?? '',
      })
      // Absent and forbidden answer the same way on purpose: a version somebody may
      // not read must not be distinguishable from one that does not exist.
      if (!detail) return fail(c, 'not-found')
      return c.json(detail, 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.post('/assignments', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const body = await readJson(c)
    const choice = readChoice(body)
    const command = commandContext(c, body)
    if (!choice || !command) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      return c.json(await planning().chooseProgram({ personId, ...choice, ...command }), 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  return routes
}

function failure(c: Context, cause: unknown): Response {
  if (cause instanceof SpaceActorError) return fail(c, 'forbidden')
  // A version the person may not reach answers `42501` from the database, which is
  // the same thing the policy would have said: not yours.
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    const code = (cause as { code: unknown }).code
    if (code === '42501') return fail(c, 'forbidden')
    if (code === '22023') return fail(c, 'invalid-request')
    if (code === '23505' || code === '40001') return fail(c, 'conflict')
  }
  console.warn('[planning] space request failed', { detail: String(cause).slice(0, 160) })
  return fail(c, 'upstream-unavailable')
}

async function verified(c: Context, verify: TokenVerifier): Promise<VerifiedToken | undefined> {
  const header = c.req.header('authorization')
  const [scheme, value] = header?.split(' ') ?? []
  if (scheme?.toLowerCase() !== 'bearer' || !value) {
    console.warn('[planning] space request refused', { reason: 'no-bearer-header' })
    return undefined
  }
  try {
    return await verify(value)
  } catch (cause) {
    console.warn('[planning] space request refused', {
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

/** Exactly two keys. An extra one is a client sending something we do not honour. */
function readChoice(body: unknown): { programVersionId: string; timezone: string } | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const keys = Object.keys(body)
  if (keys.length !== 2) return undefined
  const { program_version_id: version, timezone } = body as {
    program_version_id: unknown
    timezone: unknown
  }
  if (typeof version !== 'string' || !UUID_V7.test(version)) return undefined
  if (typeof timezone !== 'string') return undefined
  const trimmed = timezone.trim()
  if (trimmed === '' || trimmed.length > MAX_TIMEZONE) return undefined
  return { programVersionId: version, timezone: trimmed }
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

/** Key order must not change the hash: the same request has to replay as the same. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
