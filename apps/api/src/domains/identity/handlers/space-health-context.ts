/**
 * Health context routes on /space/v1: `OP-IDN-008`, `OP-IDN-049`, `OP-IDN-050`.
 *
 * `HU-SP-014`, `HU-SP-028`. The most protected category V1 keeps, and not a clinical
 * record: a body carries a type, a short description and, optionally, a body area and an
 * end. Anything else — a diagnosis code, a document — is refused rather than ignored, so a
 * client cannot believe it was stored.
 *
 * Absent optional fields are sent to the database as null and hashed that way, so a device
 * that omits `body_area` on its first attempt and sends `null` on the retry replays.
 */

import { Hono, type Context } from 'hono'

import { problem } from '../../../platform/http/index.js'
import type { HealthContextService } from '../application/health-context.js'
import { spaceHealthContextService } from '../dependencies.js'
import {
  HEALTH_CONTEXT_BODY_AREAS,
  HEALTH_CONTEXT_TYPES,
  MAX_HEALTH_CONTEXT_DESCRIPTION,
  MAX_HEALTH_CONTEXT_PAGE,
  type HealthContextBodyArea,
  type HealthContextDeclaration,
  type HealthContextListInput,
  type HealthContextType,
} from '../domain/health-context.js'
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

const LIST_PARAMETERS = new Set(['limit', 'before_valid_from', 'before_id'])
const OPERATION = 'space-health-context'

export function spaceHealthContextRoutes(
  injectedService?: HealthContextService,
  injectedVerifier?: TokenVerifier,
): Hono {
  const claims = () => injectedService ?? spaceHealthContextService()
  const verify = injectedVerifier ?? spaceTokenVerifier()
  const routes = new Hono()

  routes.use('*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
  })

  routes.get('/health-context', async (c) => {
    const token = await verifiedSpaceToken(c, verify)
    if (!token) return problem(c, 'unauthenticated')
    const page = listInput(c)
    if (!page) return problem(c, 'invalid-request')

    try {
      return c.json(await claims().list(token, page))
    } catch (error) {
      return spaceFailure(c, error, OPERATION)
    }
  })

  routes.post('/health-context', async (c) => {
    const token = await verifiedSpaceToken(c, verify)
    if (!token) return problem(c, 'unauthenticated')
    if (!isJsonRequest(c)) return problem(c, 'unsupported-media-type')
    const claim = declaration(await readJson(c))
    if (!claim) return problem(c, 'validation-failed')
    const command = spaceCommand(c, claim)
    if (!command) return problem(c, 'invalid-request')

    try {
      const result = await claims().declare(token, {
        ...command,
        claimId: command.commandId,
        claim,
      })
      if (result.replayed) c.header('Idempotent-Replay', 'true')
      return c.json(result.resource, 201)
    } catch (error) {
      return spaceFailure(c, error, OPERATION)
    }
  })

  routes.delete('/health-context/:claimId', async (c) => {
    const token = await verifiedSpaceToken(c, verify)
    if (!token) return problem(c, 'unauthenticated')
    const claimId = c.req.param('claimId')
    if (!UUID_V7.test(claimId)) return problem(c, 'invalid-request')
    const command = spaceCommand(c, { claimId })
    if (!command) return problem(c, 'invalid-request')

    try {
      const result = await claims().delete(token, { ...command, claimId })
      if (result.replayed) c.header('Idempotent-Replay', 'true')
      return c.json(result.resource, 200)
    } catch (error) {
      return spaceFailure(c, error, OPERATION)
    }
  })

  return routes
}

function listInput(c: Context): HealthContextListInput | undefined {
  if (!onlyQueryKeys(c, LIST_PARAMETERS)) return undefined
  const limit = pageSize(c.req.query('limit'), MAX_HEALTH_CONTEXT_PAGE)
  if (limit === undefined) return undefined

  const beforeValidFrom = c.req.query('before_valid_from')
  const beforeId = c.req.query('before_id')
  if ((beforeValidFrom === undefined) !== (beforeId === undefined)) return undefined
  if (beforeValidFrom === undefined || beforeId === undefined) return { limit }
  if (!isInstant(beforeValidFrom) || !UUID_V7.test(beforeId)) return undefined
  return { limit, beforeValidFrom, beforeId }
}

function declaration(body: unknown): HealthContextDeclaration | undefined {
  const fields = exactObject(
    body,
    ['context_type', 'description', 'valid_from'],
    ['body_area', 'valid_to'],
  )
  if (!fields) return undefined

  const { context_type: type, description, valid_from: from } = fields
  const area = fields.body_area ?? null
  const to = fields.valid_to ?? null
  if (!HEALTH_CONTEXT_TYPES.includes(type as HealthContextType)) return undefined
  if (
    typeof description !== 'string' ||
    description.trim() === '' ||
    description.length > MAX_HEALTH_CONTEXT_DESCRIPTION
  ) {
    return undefined
  }
  if (area !== null && !HEALTH_CONTEXT_BODY_AREAS.includes(area as HealthContextBodyArea)) {
    return undefined
  }
  if (typeof from !== 'string' || !isInstant(from)) return undefined
  if (to !== null && (typeof to !== 'string' || !isInstant(to))) return undefined
  return {
    context_type: type as HealthContextType,
    description,
    body_area: area as HealthContextBodyArea | null,
    valid_from: from,
    valid_to: to as string | null,
  }
}
