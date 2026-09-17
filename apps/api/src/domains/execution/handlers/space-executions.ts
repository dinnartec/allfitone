/**
 * Session routes on /space/v1: `OP-EXE-004`, `OP-EXE-005`, `OP-EXE-006`, `OP-EXE-014`,
 * `OP-EXE-015`.
 *
 * `HU-SP-052`, `HU-SP-055`, `HU-SP-056`, `HU-SP-057`. The token is verified here and resolved
 * to a person in the database; nothing in a request can name whose session this is. The
 * `Command-Id` of a start is the session's own identifier, so a device can begin offline.
 *
 * Results are replaced whole, under the revision the device last saw: the `If-Match` ETag
 * names this session and that revision, and the database refuses a stale one. Attempts on a
 * planned session (`OP-EXE-001`) are not mounted, because plans do not exist yet.
 */

import { Hono, type Context } from 'hono'

import { problem } from '../../../platform/http/index.js'
import {
  UUID_V7,
  exactObject,
  isInstant,
  isJsonRequest,
  onlyQueryKeys,
  pageSize,
  readJson,
  spaceCommand,
  spaceFailure,
  spaceTokenVerifier,
  verifiedSpaceToken,
  type TokenVerifier,
} from '../../../platform/http/space-requests.js'
import type { ExecutionService } from '../application/sessions.js'
import { spaceExecutionService } from '../dependencies.js'
import {
  CAPTURE_SOURCES,
  COMPLETENESS_LEVELS,
  DEFAULT_EXECUTION_PAGE,
  DISTANCE_UNITS,
  LOAD_UNITS,
  MAX_EXECUTION_PAGE,
  MAX_LAP_SECONDS,
  MAX_REPETITIONS,
  MAX_RESULTS,
  MAX_SEGMENTS,
  type CompletenessLevel,
  type EnduranceLap,
  type ExecutionListInput,
  type ExecutionResultsReplace,
  type FreeExecutionCreate,
  type StrengthSet,
} from '../domain/sessions.js'

const LIST_PARAMETERS = new Set(['limit', 'before_started_at', 'before_id'])
const TIME_ZONE = /^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+)$/
const ACTIVITY_CODE = /^[a-z][a-z0-9_]{1,63}$/
const OPERATION = 'space-executions'

export function spaceExecutionRoutes(
  injectedService?: ExecutionService,
  injectedVerifier?: TokenVerifier,
): Hono {
  const sessions = () => injectedService ?? spaceExecutionService()
  const verify = injectedVerifier ?? spaceTokenVerifier()
  const routes = new Hono()

  routes.use('*', async (c, next) => {
    await next()
    if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store')
  })

  routes.post('/executions', async (c) => {
    const token = await verifiedSpaceToken(c, verify)
    if (!token) return problem(c, 'unauthenticated')
    if (!isJsonRequest(c)) return problem(c, 'unsupported-media-type')
    const session = freeExecution(await readJson(c))
    if (!session) return problem(c, 'validation-failed')
    const command = spaceCommand(c, session)
    if (!command) return problem(c, 'invalid-request')

    try {
      const result = await sessions().start(token, {
        ...command,
        sessionId: command.commandId,
        session,
      })
      const started = result.resource
      c.header('Location', `/space/v1/executions/${started.id}`)
      c.header('ETag', revisionTag(started.id, started.revision_number))
      if (result.replayed) c.header('Idempotent-Replay', 'true')
      return c.json(started, 201)
    } catch (error) {
      return spaceFailure(c, error, OPERATION)
    }
  })

  routes.get('/executions', async (c) => {
    const token = await verifiedSpaceToken(c, verify)
    if (!token) return problem(c, 'unauthenticated')
    const query = listInput(c)
    if (!query) return problem(c, 'invalid-request')

    try {
      const page = await sessions().list(token, query)
      c.header('Cache-Control', 'private, no-store')
      return c.json({ items: page.items, has_more: page.hasMore })
    } catch (error) {
      return spaceFailure(c, error, OPERATION)
    }
  })

  routes.get('/executions/:executionId', async (c) => {
    const token = await verifiedSpaceToken(c, verify)
    if (!token) return problem(c, 'unauthenticated')
    const sessionId = c.req.param('executionId')
    if (!UUID_V7.test(sessionId)) return problem(c, 'invalid-request')

    try {
      const session = await sessions().detail(token, sessionId)
      c.header('Cache-Control', 'private, no-store')
      c.header('ETag', revisionTag(session.id, session.revision_number))
      return c.json(session)
    } catch (error) {
      return spaceFailure(c, error, OPERATION)
    }
  })

  routes.put('/executions/:executionId/results', async (c) => {
    const token = await verifiedSpaceToken(c, verify)
    if (!token) return problem(c, 'unauthenticated')
    const sessionId = c.req.param('executionId')
    if (!UUID_V7.test(sessionId)) return problem(c, 'invalid-request')
    const base = expectedRevision(c, sessionId)
    if (base instanceof Response) return base
    if (!isJsonRequest(c)) return problem(c, 'unsupported-media-type')
    const results = resultsReplace(await readJson(c))
    if (!results) return problem(c, 'validation-failed')
    const command = spaceCommand(c, { sessionId, expectedRevision: base, results })
    if (!command) return problem(c, 'invalid-request')

    try {
      const result = await sessions().replaceResults(token, {
        ...command,
        sessionId,
        expectedRevision: base,
        results,
      })
      c.header('ETag', revisionTag(sessionId, result.resource.revision_number))
      if (result.replayed) c.header('Idempotent-Replay', 'true')
      return c.json(result.resource)
    } catch (error) {
      return spaceFailure(c, error, OPERATION)
    }
  })

  routes.post('/executions/:executionId/finalize', async (c) => {
    const token = await verifiedSpaceToken(c, verify)
    if (!token) return problem(c, 'unauthenticated')
    const sessionId = c.req.param('executionId')
    if (!UUID_V7.test(sessionId)) return problem(c, 'invalid-request')
    const base = expectedRevision(c, sessionId)
    if (base instanceof Response) return base
    if (!isJsonRequest(c)) return problem(c, 'unsupported-media-type')
    const fields = exactObject(await readJson(c), ['ended_at'])
    const endedAt = fields?.ended_at
    if (typeof endedAt !== 'string' || !isInstant(endedAt)) return problem(c, 'validation-failed')
    const command = spaceCommand(c, { sessionId, expectedRevision: base, endedAt })
    if (!command) return problem(c, 'invalid-request')

    try {
      const result = await sessions().finalize(token, {
        ...command,
        sessionId,
        expectedRevision: base,
        endedAt,
      })
      c.header('ETag', revisionTag(sessionId, result.resource.revision_number))
      if (result.replayed) c.header('Idempotent-Replay', 'true')
      return c.json(result.resource)
    } catch (error) {
      return spaceFailure(c, error, OPERATION)
    }
  })

  return routes
}

function revisionTag(sessionId: string, revision: number): string {
  return `"execution:${sessionId}:r${revision}"`
}

/** The revision the device worked on, or the problem that says why it is unusable. */
function expectedRevision(c: Context, sessionId: string): number | Response {
  const etag = c.req.header('if-match')
  if (!etag) return problem(c, 'precondition-required')
  const match = /^"execution:([0-9a-f-]{36}):r(\d+)"$/.exec(etag)
  if (!match || match[1] !== sessionId) return problem(c, 'invalid-request')
  return Number(match[2])
}

function listInput(c: Context): ExecutionListInput | undefined {
  if (!onlyQueryKeys(c, LIST_PARAMETERS)) return undefined
  const limit = pageSize(c.req.query('limit'), MAX_EXECUTION_PAGE, DEFAULT_EXECUTION_PAGE)
  if (limit === undefined) return undefined

  const startedAt = c.req.query('before_started_at')
  const id = c.req.query('before_id')
  if ((startedAt === undefined) !== (id === undefined)) return undefined
  if (startedAt === undefined || id === undefined) return { limit }
  if (!isInstant(startedAt) || !UUID_V7.test(id)) return undefined
  return { limit, before: { startedAt, id } }
}

function freeExecution(body: unknown): FreeExecutionCreate | undefined {
  const fields = exactObject(body, [
    'activity_type_code',
    'started_at',
    'timezone',
    'requested_level',
    'capture_source',
  ])
  if (!fields) return undefined

  const {
    activity_type_code: code,
    started_at: startedAt,
    timezone,
    requested_level: level,
    capture_source: source,
  } = fields
  if (typeof code !== 'string' || !ACTIVITY_CODE.test(code)) return undefined
  if (typeof startedAt !== 'string' || !isInstant(startedAt)) return undefined
  if (!isTimeZone(timezone)) return undefined
  if (!COMPLETENESS_LEVELS.includes(level as CompletenessLevel)) return undefined
  if (typeof source !== 'string' || !CAPTURE_SOURCES.includes(source)) return undefined
  return {
    activity_type_code: code,
    started_at: startedAt,
    timezone,
    requested_level: level as CompletenessLevel,
    capture_source: source as FreeExecutionCreate['capture_source'],
  }
}

function isTimeZone(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length >= 3 && value.length <= 100 && TIME_ZONE.test(value)
  )
}

function resultsReplace(body: unknown): ExecutionResultsReplace | undefined {
  const fields = exactObject(body, ['segments'], ['strength_sets', 'endurance_laps'])
  if (!fields) return undefined

  const { segments } = fields
  if (!Array.isArray(segments) || segments.length === 0 || segments.length > MAX_SEGMENTS) {
    return undefined
  }
  const positions = new Set<number>()
  const parsedSegments: ExecutionResultsReplace['segments'] = []
  for (const entry of segments) {
    const segment = exactObject(entry, ['position', 'activity_type_code'])
    if (!segment) return undefined
    const { position, activity_type_code: code } = segment
    if (!isWhole(position, 1, MAX_SEGMENTS) || positions.has(position)) return undefined
    if (typeof code !== 'string' || !ACTIVITY_CODE.test(code)) return undefined
    positions.add(position)
    parsedSegments.push({ position, activity_type_code: code })
  }

  const sets = parseSets(fields.strength_sets ?? [], positions)
  const laps = parseLaps(fields.endurance_laps ?? [], positions)
  if (!sets || !laps || sets.length + laps.length === 0) return undefined
  return { segments: parsedSegments, strength_sets: sets, endurance_laps: laps }
}

function parseSets(value: unknown, positions: ReadonlySet<number>): StrengthSet[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_RESULTS) return undefined
  const orders = new Set<number>()
  const parsed: StrengthSet[] = []
  for (const entry of value) {
    const fields = exactObject(
      entry,
      ['segment_position', 'order'],
      ['movement_id', 'planned_step_id', 'achieved_reps', 'load', 'rpe'],
    )
    if (!fields) return undefined
    const { segment_position: segment, order } = fields
    if (!isWhole(segment, 1, MAX_SEGMENTS) || !positions.has(segment)) return undefined
    if (!isWhole(order, 1, MAX_RESULTS) || orders.has(order)) return undefined
    orders.add(order)

    const movement = fields.movement_id ?? null
    const plannedStep = fields.planned_step_id ?? null
    const reps = fields.achieved_reps ?? null
    const load = fields.load ?? null
    const rpe = fields.rpe ?? null
    if (movement !== null && typeof movement !== 'string') return undefined
    // A free session follows no plan; the database refuses it too.
    if (plannedStep !== null) return undefined
    if (reps !== null && !isWhole(reps, 1, MAX_REPETITIONS)) return undefined
    if (rpe !== null && (typeof rpe !== 'number' || !Number.isFinite(rpe) || rpe < 0 || rpe > 10)) {
      return undefined
    }
    if (load !== null) {
      const amount = exactObject(load, ['value', 'unit'])
      if (!amount) return undefined
      if (typeof amount.value !== 'number' || !Number.isFinite(amount.value) || amount.value < 0) {
        return undefined
      }
      if (typeof amount.unit !== 'string' || !LOAD_UNITS.includes(amount.unit)) return undefined
    }
    parsed.push({
      segment_position: segment,
      order,
      movement_id: movement,
      planned_step_id: null,
      achieved_reps: reps,
      load: load as StrengthSet['load'],
      rpe,
    } as StrengthSet)
  }
  return parsed
}

function parseLaps(value: unknown, positions: ReadonlySet<number>): EnduranceLap[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_RESULTS) return undefined
  const numbers = new Set<number>()
  const parsed: EnduranceLap[] = []
  for (const entry of value) {
    const fields = exactObject(entry, [
      'segment_position',
      'lap_number',
      'distance',
      'duration_seconds',
    ])
    if (!fields) return undefined
    const {
      segment_position: segment,
      lap_number: lap,
      distance,
      duration_seconds: seconds,
    } = fields
    if (!isWhole(segment, 1, MAX_SEGMENTS) || !positions.has(segment)) return undefined
    if (!isWhole(lap, 1, MAX_RESULTS) || numbers.has(lap)) return undefined
    numbers.add(lap)
    const covered = exactObject(distance, ['value', 'unit'])
    if (!covered) return undefined
    if (
      typeof covered.value !== 'number' ||
      !Number.isFinite(covered.value) ||
      covered.value <= 0
    ) {
      return undefined
    }
    if (typeof covered.unit !== 'string' || !DISTANCE_UNITS.includes(covered.unit)) return undefined
    if (
      typeof seconds !== 'number' ||
      !Number.isFinite(seconds) ||
      seconds <= 0 ||
      seconds > MAX_LAP_SECONDS
    ) {
      return undefined
    }
    parsed.push({
      segment_position: segment,
      lap_number: lap,
      distance: { value: covered.value, unit: covered.unit as EnduranceLap['distance']['unit'] },
      duration_seconds: seconds,
    })
  }
  return parsed
}

function isWhole(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum
  )
}
