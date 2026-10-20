/**
 * `/space/v1` for training that happens.
 *
 * All of them the person's own: start an attempt, read it, replace what has been
 * recorded, close it, or leave it; and read back what was trained, one session's summary
 * or the history and its months (`OP-EXE-014`, `OP-EXE-022`). A finished session is read
 * set by set, corrected, annulled or repeated (`OP-EXE-023`, `007`, `009`, `024`, `025`).
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
import type { ExecutionResultsReplace, ExecutionRevision } from '../domain/index.js'

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

  routes.post('/executions', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const body = await readJson(c)
    const start = readFreeStart(body)
    const command = commandContext(c, body)
    if (!start || !command) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      const started = await execution().startFreeSession({ personId, ...start, ...command })
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

  routes.get('/executions/:executionId/summary', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const executedSessionId = c.req.param('executionId')
    // The zone decides which week a session falls in, so a streak cannot be counted without it.
    const timezone = (c.req.query('timezone') ?? '').trim()
    if (!UUID_V7.test(executedSessionId)) return fail(c, 'invalid-request')
    if (timezone === '' || timezone.length > MAX_TIMEZONE) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      const found = await execution().readSummary({
        personId,
        executedSessionId,
        timezone,
        requestId: c.req.header('x-request-id') ?? '',
      })
      if (!found) return fail(c, 'not-found')
      return c.json(found, 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  // `OP-EXE-014`. Every filter is optional; the zone is not, because it decides the month.
  routes.get('/executions', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const query = readHistoryQuery(c)
    if (!query) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      const page = await execution().listHistory({
        personId,
        ...query,
        requestId: c.req.header('x-request-id') ?? '',
      })
      return c.json(page, 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  // `OP-EXE-022`.
  routes.get('/history/months/:month', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const month = c.req.param('month')
    const timezone = readTimezone(c)
    if (!isDate(month) || !timezone) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      const found = await execution().readHistoryMonth({
        personId,
        timezone,
        month,
        requestId: c.req.header('x-request-id') ?? '',
      })
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

  // `OP-EXE-023`. Absent, foreign, unfinished and annulled are the same 404.
  routes.get('/executions/:executionId/detail', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const executedSessionId = c.req.param('executionId')
    const timezone = readTimezone(c)
    if (!UUID_V7.test(executedSessionId) || !timezone) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      const found = await execution().readFinished({
        personId,
        executedSessionId,
        timezone,
        requestId: c.req.header('x-request-id') ?? '',
      })
      return found ? c.json(found, 200) : fail(c, 'not-found')
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.post('/executions/:executionId/revisions', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const executedSessionId = c.req.param('executionId')
    const body = await readJson(c)
    const revision = readRevision(body)
    const command = commandContext(c, body)
    const revisionNumber = Number(c.req.header('if-match'))
    if (!UUID_V7.test(executedSessionId) || !revision || !command) return fail(c, 'invalid-request')
    if (!Number.isInteger(revisionNumber) || revisionNumber < 0) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      const revised = await execution().revise({
        personId,
        executedSessionId,
        revisionNumber,
        revision,
        ...command,
      })
      return c.json(revised, 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.post('/executions/:executionId/invalidation', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const executedSessionId = c.req.param('executionId')
    const body = await readJson(c)
    const reason = readReason(body)
    const command = commandContext(c, body)
    if (!UUID_V7.test(executedSessionId) || reason === undefined || !command) {
      return fail(c, 'invalid-request')
    }

    try {
      const personId = await actors().personFor(token.subject)
      const annulled = await execution().annul({ personId, executedSessionId, reason, ...command })
      return c.json(annulled, 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.get('/executions/:executionId/invalidation-preview', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const executedSessionId = c.req.param('executionId')
    const timezone = readTimezone(c)
    if (!UUID_V7.test(executedSessionId) || !timezone) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      const preview = await execution().readAnnulmentPreview({
        personId,
        executedSessionId,
        timezone,
        requestId: c.req.header('x-request-id') ?? '',
      })
      return preview ? c.json(preview, 200) : fail(c, 'not-found')
    } catch (cause) {
      return failure(c, cause)
    }
  })

  // `Command-Id` is the new session's identity, as on the start (`OP-EXE-001`).
  routes.post('/executions/:executionId/repetitions', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const executedSessionId = c.req.param('executionId')
    const body = await readJson(c)
    const repetition = readRepetition(body)
    const command = commandContext(c, body)
    if (!UUID_V7.test(executedSessionId) || !repetition || !command) {
      return fail(c, 'invalid-request')
    }

    try {
      const personId = await actors().personFor(token.subject)
      const repeated = await execution().repeat({
        personId,
        executedSessionId,
        ...repetition,
        ...command,
      })
      return c.json(repeated, 201)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  return routes
}

const HISTORY_LIMIT = { default: 20, max: 50 } as const
const MAX_QUERY = 80
const MAX_DISCIPLINE = 64
// The contract's bounds for an opaque cursor; anything else cannot be one of ours.
const CURSOR_LENGTH = { min: 16, max: 1024 } as const

function readTimezone(c: Context): string | null {
  const timezone = (c.req.query('timezone') ?? '').trim()
  return timezone === '' || timezone.length > MAX_TIMEZONE ? null : timezone
}

/** A calendar date that exists: `2026-02-30` is a shape, not a day. */
function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/** Absent is no filter; anything but `true` or `false` is a request it cannot answer. */
function readFlag(raw: string | undefined): boolean | null | undefined {
  if (raw === undefined) return null
  if (raw === 'true') return true
  if (raw === 'false') return false
  return undefined
}

function readHistoryQuery(c: Context) {
  const timezone = readTimezone(c)
  const month = c.req.query('month') ?? null
  const day = c.req.query('day') ?? null
  const discipline = (c.req.query('discipline') ?? '').trim() || null
  const withRecord = readFlag(c.req.query('with_record'))
  const free = readFlag(c.req.query('free'))
  const query = (c.req.query('q') ?? '').trim() || null
  const cursor = c.req.query('cursor') ?? null
  const rawLimit = c.req.query('limit')
  const limit = rawLimit === undefined ? HISTORY_LIMIT.default : Number(rawLimit)

  if (!timezone || (month !== null && !isDate(month))) return null
  if (day !== null && !isDate(day)) return null
  if (discipline !== null && discipline.length > MAX_DISCIPLINE) return null
  if (withRecord === undefined || free === undefined) return null
  if (query !== null && query.length > MAX_QUERY) return null
  if (cursor !== null && (cursor.length < CURSOR_LENGTH.min || cursor.length > CURSOR_LENGTH.max)) {
    return null
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > HISTORY_LIMIT.max) return null
  return { timezone, month, discipline, withRecord, free, query, cursor, limit, day }
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
    // Not in the state the read needs: a summary of a session still open, or a repeat
    // while another session is open.
    if (code === '55000' || code === '55006') return fail(c, 'conflict')
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

const DISCIPLINE = /^[a-z][a-z0-9_]{1,63}$/

/** A planned start's four fields, plus the discipline whose contract the session freezes. */
function readFreeStart(body: unknown) {
  if (typeof body !== 'object' || body === null) return undefined
  const { discipline_code: disciplineCode, ...rest } = body as Record<string, unknown>
  if (typeof disciplineCode !== 'string' || !DISCIPLINE.test(disciplineCode)) return undefined
  const start = readStart(rest)
  return start ? { ...start, disciplineCode } : undefined
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

const isInstant = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value))

/** The session whole, with its time; an empty one is an annulment, which is its own command. */
function readRevision(body: unknown): ExecutionRevision | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const candidate = body as Record<string, unknown>
  const allowed = new Set(['started_at', 'ended_at', 'strength_sets', 'exercises'])
  if (Object.keys(candidate).some((key) => !allowed.has(key))) return undefined
  if (!isInstant(candidate.started_at) || !isInstant(candidate.ended_at)) return undefined
  if (!Array.isArray(candidate.strength_sets) || candidate.strength_sets.length === 0) {
    return undefined
  }
  if (candidate.exercises !== undefined && !Array.isArray(candidate.exercises)) return undefined
  return candidate as unknown as ExecutionRevision
}

const MAX_REASON = 200

/** Null is «no reason given»; undefined is a body the command cannot take. */
function readReason(body: unknown): string | null | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const keys = Object.keys(body)
  if (keys.some((key) => key !== 'reason')) return undefined
  const value = (body as { reason?: unknown }).reason
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || value.length > MAX_REASON) return undefined
  return value.trim() || null
}

function readRepetition(body: unknown): { startedAt: string; timezone: string } | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const keys = Object.keys(body)
  if (keys.length !== 2) return undefined
  const { started_at: startedAt, timezone } = body as Record<string, unknown>
  if (!isInstant(startedAt) || typeof timezone !== 'string') return undefined
  const zone = timezone.trim()
  if (zone === '' || zone.length > MAX_TIMEZONE) return undefined
  return { startedAt, timezone: zone }
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
