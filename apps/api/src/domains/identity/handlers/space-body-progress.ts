/**
 * Body measurement routes on /space/v1: `OP-IDN-007` and `OP-IDN-015`.
 *
 * `HU-SP-025`, `HU-SP-026`, `HU-SP-027`. The token is verified here and resolved to a
 * person in the database; nothing in a request can name whose measurements these are.
 *
 * **Recording is not here.** `OP-IDN-006` is served by the onboarding handler, which
 * claimed the same path first, so a second recording route on this router was never
 * reachable. One operation, one command, one handler — the guards this one carried moved
 * into the surviving database function.
 */

import { Hono, type Context } from 'hono'

import { problem } from '../../../platform/http/index.js'
import type { BodyProgressService } from '../application/body-progress.js'
import { spaceBodyProgressService } from '../dependencies.js'
import { MAX_BODY_PROGRESS_PAGE, type BodyProgressListInput } from '../domain/body-progress.js'
import {
  UUID_V7,
  isCalendarDate,
  onlyQueryKeys,
  pageSize,
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
