/**
 * `/space/v1` for training that happens.
 *
 * Five routes, all of them the person's own: start an attempt, read it, replace what
 * has been recorded, close it, or leave it.
 *
 * **Leaving is not deleting.** `OP-EXE-003` closes the attempt as abandoned and keeps
 * what it recorded: training that happened stays in the history, marked as unfinished
 * rather than erased.
 *
 * **`Command-Id` is the execution's identity** on the start, which `OP-EXE-001` fixes
 * and which is what makes a retry over a dropped connection answer the same session
 * instead of opening a second one.
 *
 * Absent and forbidden answer the same way on the read. A distinguishable "forbidden"
 * would let somebody learn which execution identifiers exist.
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
import { spaceExecutionService } from '../dependencies.js'
import type { SpaceExecutionService } from '../application/index.js'
import type { ExecutionResultsReplace } from '../domain/index.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const LEVELS = new Set(['partial', 'summary', 'detailed', 'sensor_enriched'])
const SOURCES = new Set(['manual', 'device'])
const MAX_TIMEZONE = 64

export type TokenVerifier = (token: string) => Promise<VerifiedToken>

export function spaceExecutionRoutes(
  injectedService?: SpaceExecutionService,
  injectedVerifier?: TokenVerifier,
  injectedActors?: SpaceActorResolver,
): Hono {
  const execution = () => injectedService ?? spaceExecutionService()
  const actors = () => injectedActors ?? spaceActorResolver()
  const verify: TokenVerifier =
    injectedVerifier ?? ((token) => authProvider().verifyAccessToken(token, 'space'))
  const routes = new Hono()

  routes.post('/planned-sessions/:plannedSessionId/attempts', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const plannedSessionId = c.req.param('plannedSessionId')
    const body = await readJson(c)
    const start = readStart(body)
    const command = commandContext(c, body)
    if (!UUID_V7.test(plannedSessionId) || !start || !command) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      const started = await execution().startAttempt({
        personId,
        plannedSessionId,
        ...start,
        ...command,
      })
      c.header('Location', `/space/v1/executions/${started.id}`)
      return c.json(started, 201)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.get('/executions/:executionId', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const executedSessionId = c.req.param('executionId')
    if (!UUID_V7.test(executedSessionId)) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      const found = await execution().readExecution({
        personId,
        executedSessionId,
        requestId: c.req.header('x-request-id') ?? '',
      })
      if (!found) return fail(c, 'not-found')
      return c.json(found, 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.put('/executions/:executionId/results', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const executedSessionId = c.req.param('executionId')
    const body = await readJson(c)
    const results = readResults(body)
    const command = commandContext(c, body)
    const revisionNumber = Number(c.req.header('if-match'))
    if (!UUID_V7.test(executedSessionId) || !results || !command) return fail(c, 'invalid-request')
    // The revision is the optimistic lock and it travels in `If-Match`. Without it a
    // second phone would overwrite the first and neither would know.
    if (!Number.isInteger(revisionNumber) || revisionNumber < 0) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      const state = await execution().replaceResults({
        personId,
        executedSessionId,
        revisionNumber,
        results,
        ...command,
      })
      return c.json(state, 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.post('/executions/:executionId/abandonment', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const executedSessionId = c.req.param('executionId')
    const body = await readJson(c)
    const endedAt = readEndedAt(body)
    const command = commandContext(c, body)
    if (!UUID_V7.test(executedSessionId) || !endedAt || !command) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      const left = await execution().abandon({ personId, executedSessionId, endedAt, ...command })
      return c.json(left, 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.post('/executions/:executionId/finalize', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const executedSessionId = c.req.param('executionId')
    const body = await readJson(c)
    const endedAt = readEndedAt(body)
    const command = commandContext(c, body)
    if (!UUID_V7.test(executedSessionId) || !endedAt || !command) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      const finished = await execution().finalize({
        personId,
        executedSessionId,
        endedAt,
        ...command,
      })
      return c.json(finished, 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  return routes
}

function failure(c: Context, cause: unknown): Response {
  if (cause instanceof SpaceActorError) return fail(c, 'forbidden')
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    const code = (cause as { code: unknown }).code
    // The SQLSTATE, not the message: a refusal without it is a 400 nobody can chase.
    console.warn('[execution] space command refused', { code, detail: String(cause).slice(0, 160) })
    if (code === '42501') return fail(c, 'forbidden')
    if (code === '22023' || code === '23514') return fail(c, 'invalid-request')
    // A stale revision is a conflict, not a failure: the client re-reads and retries.
    if (code === '40001' || code === '23505') return fail(c, 'conflict')
  }
  console.warn('[execution] space request failed', { detail: String(cause).slice(0, 160) })
  return fail(c, 'upstream-unavailable')
}

async function verified(c: Context, verify: TokenVerifier): Promise<VerifiedToken | undefined> {
  const header = c.req.header('authorization')
  const [scheme, value] = header?.split(' ') ?? []
  if (scheme?.toLowerCase() !== 'bearer' || !value) {
    console.warn('[execution] space request refused', { reason: 'no-bearer-header' })
    return undefined
  }
  try {
    return await verify(value)
  } catch (cause) {
    console.warn('[execution] space request refused', {
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

function readStart(
  body: unknown,
):
  | { startedAt: string; timezone: string; requestedLevel: string; captureSource: string }
  | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const keys = Object.keys(body)
  if (keys.length !== 4) return undefined
  const {
    started_at: startedAt,
    timezone,
    requested_level: requestedLevel,
    capture_source: captureSource,
  } = body as Record<string, unknown>
  if (typeof startedAt !== 'string' || Number.isNaN(Date.parse(startedAt))) return undefined
  if (typeof timezone !== 'string') return undefined
  const zone = timezone.trim()
  if (zone === '' || zone.length > MAX_TIMEZONE) return undefined
  if (typeof requestedLevel !== 'string' || !LEVELS.has(requestedLevel)) return undefined
  if (typeof captureSource !== 'string' || !SOURCES.has(captureSource)) return undefined
  return { startedAt, timezone: zone, requestedLevel, captureSource }
}

function readResults(body: unknown): ExecutionResultsReplace | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const candidate = body as Record<string, unknown>
  if (!Array.isArray(candidate.strength_sets)) return undefined
  for (const optional of [
    'segments',
    'endurance_laps',
    'interval_results',
    'mobility_results',
    'exercises',
  ]) {
    if (candidate[optional] !== undefined && !Array.isArray(candidate[optional])) return undefined
  }
  return candidate as unknown as ExecutionResultsReplace
}

function readEndedAt(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const keys = Object.keys(body)
  if (keys.length !== 1 || keys[0] !== 'ended_at') return undefined
  const value = (body as { ended_at: unknown }).ended_at
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return undefined
  return value
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
