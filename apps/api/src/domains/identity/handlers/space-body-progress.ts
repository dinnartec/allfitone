/**
 * Body measurement routes on /space/v1: `OP-IDN-006`, `OP-IDN-007`, `OP-IDN-015`.
 *
 * `HU-SP-025`, `HU-SP-026`, `HU-SP-027`. The token is verified here and resolved to a
 * person in the database; nothing in a request can name whose measurements these are.
 * The `Command-Id` of a recording is the measurement's own identifier, which is what lets a
 * device create one offline and send it later without duplicating it.
 *
 * A body carries exactly the declared fields. A photo is not one of them yet: removing its
 * metadata on the server is its own piece, and until then a field that looks like one is
 * refused rather than ignored.
 */

import { Hono, type Context } from 'hono'

import { problem } from '../../../platform/http/index.js'
import type { BodyProgressService } from '../application/body-progress.js'
import { spaceBodyProgressService } from '../dependencies.js'
import {
  BODY_PROGRESS_METRICS,
  BODY_PROGRESS_UNITS,
  MAX_BODY_PROGRESS_PAGE,
  MAX_BODY_PROGRESS_VALUE,
  type BodyProgressListInput,
  type BodyProgressMetricCode,
  type BodyProgressRecordCreate,
  type BodyProgressUnitCode,
} from '../domain/body-progress.js'
import {
  UUID_V7,
  exactObject,
  isCalendarDate,
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

const LIST_PARAMETERS = new Set(['limit', 'before_measured_on', 'before_id'])
const OPERATION = 'space-body-progress'

export function spaceBodyProgressRoutes(
  injectedService?: BodyProgressService,
  injectedVerifier?: TokenVerifier,
): Hono {
  const measurements = () => injectedService ?? spaceBodyProgressService()
  const verify = injectedVerifier ?? spaceTokenVerifier()
  const routes = new Hono()

  routes.use('*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
  })

  routes.get('/body-progress', async (c) => {
    const token = await verifiedSpaceToken(c, verify)
    if (!token) return problem(c, 'unauthenticated')
    const page = listInput(c)
    if (!page) return problem(c, 'invalid-request')

    try {
      return c.json(await measurements().list(token, page))
    } catch (error) {
      return spaceFailure(c, error, OPERATION)
    }
  })

  routes.post('/body-progress', async (c) => {
    const token = await verifiedSpaceToken(c, verify)
    if (!token) return problem(c, 'unauthenticated')
    if (!isJsonRequest(c)) return problem(c, 'unsupported-media-type')
    const measurement = recordCreate(await readJson(c))
    if (!measurement) return problem(c, 'validation-failed')
    const command = spaceCommand(c, measurement)
    if (!command) return problem(c, 'invalid-request')

    try {
      const result = await measurements().record(token, {
        ...command,
        recordId: command.commandId,
        measurement,
      })
      if (result.replayed) c.header('Idempotent-Replay', 'true')
      return c.json(result.resource, 201)
    } catch (error) {
      return spaceFailure(c, error, OPERATION)
    }
  })

  routes.delete('/body-progress/:recordId', async (c) => {
    const token = await verifiedSpaceToken(c, verify)
    if (!token) return problem(c, 'unauthenticated')
    const recordId = c.req.param('recordId')
    if (!UUID_V7.test(recordId)) return problem(c, 'invalid-request')
    const command = spaceCommand(c, { recordId })
    if (!command) return problem(c, 'invalid-request')

    try {
      const result = await measurements().delete(token, { ...command, recordId })
      if (result.replayed) c.header('Idempotent-Replay', 'true')
      return c.json(result.resource, 200)
    } catch (error) {
      return spaceFailure(c, error, OPERATION)
    }
  })

  return routes
}

function listInput(c: Context): BodyProgressListInput | undefined {
  if (!onlyQueryKeys(c, LIST_PARAMETERS)) return undefined
  const limit = pageSize(c.req.query('limit'), MAX_BODY_PROGRESS_PAGE)
  if (limit === undefined) return undefined

  const beforeMeasuredOn = c.req.query('before_measured_on')
  const beforeId = c.req.query('before_id')
  if ((beforeMeasuredOn === undefined) !== (beforeId === undefined)) return undefined
  if (beforeMeasuredOn === undefined || beforeId === undefined) return { limit }
  if (!isCalendarDate(beforeMeasuredOn) || !UUID_V7.test(beforeId)) return undefined
  return { limit, beforeMeasuredOn, beforeId }
}

function recordCreate(body: unknown): BodyProgressRecordCreate | undefined {
  const fields = exactObject(body, ['metric_code', 'value', 'unit_code', 'measured_on'])
  if (!fields) return undefined

  const { metric_code: metric, value, unit_code: unit, measured_on: measuredOn } = fields
  if (!BODY_PROGRESS_METRICS.includes(metric as BodyProgressMetricCode)) return undefined
  if (!BODY_PROGRESS_UNITS.includes(unit as BodyProgressUnitCode)) return undefined
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > MAX_BODY_PROGRESS_VALUE
  ) {
    return undefined
  }
  if (typeof measuredOn !== 'string' || !isCalendarDate(measuredOn)) return undefined
  return {
    metric_code: metric as BodyProgressMetricCode,
    value,
    unit_code: unit as BodyProgressUnitCode,
    measured_on: measuredOn,
  }
}
