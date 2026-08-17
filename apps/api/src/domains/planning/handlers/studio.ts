/** Contract-first Studio planning routes. PostgreSQL owns authorization and content invariants. */

import { createHash, randomUUID } from 'node:crypto'
import type { AllfitV1Schemas } from '@allfitone/contracts'
import { Hono, type Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { cors } from 'hono/cors'

import {
  STUDIO_SESSION_COOKIE,
  StudioSessionError,
  type StudioSessionService,
  studioSessionService,
  trustedStudioWebUrl,
} from '../../identity/index.js'
import { problem, type ApiErrorCode } from '../../../platform/http/index.js'
import { StudioPlanningError, type StudioPlanningService } from '../application/index.js'
import { studioPlanningService } from '../dependencies.js'

type SessionTemplateDraftContent = AllfitV1Schemas['SessionTemplateDraftContent']
type ProgramDraftContent = AllfitV1Schemas['ProgramDraftContent']

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DRAFT_ETAG = /^"sha256:[A-Za-z0-9_-]{43}"$/

export function studioPlanningRoutes(
  injectedPlanning?: StudioPlanningService,
  injectedSessions?: StudioSessionService,
): Hono {
  const studioOrigin = new URL(trustedStudioWebUrl()).origin
  const planning = () => injectedPlanning ?? studioPlanningService()
  const sessions = () => injectedSessions ?? studioSessionService()
  const routes = new Hono()

  routes.use(
    '*',
    cors({
      origin: studioOrigin,
      credentials: true,
      allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Idempotency-Key', 'Command-Id', 'If-Match'],
      exposeHeaders: ['ETag', 'Location', 'Idempotent-Replay', 'Retry-After', 'Server-Timing'],
      maxAge: 600,
    }),
  )
  routes.use('*', async (c, next) => {
    await next()
    c.header('Vary', 'Origin')
    if (c.res.status >= 400) c.header('Cache-Control', 'no-store')
  })
  routes.use('*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'OPTIONS' && !canonicalContentType(c)) {
      return problem(c, 'unsupported-media-type')
    }
    await next()
  })

  routes.get('/organizations/:organizationId/session-templates', async (c) => {
    const organizationId = organization(c, studioOrigin)
    if (organizationId instanceof Response) return organizationId
    const pagination = parsePagination(c)
    if (!pagination) return problem(c, 'validation-failed')
    try {
      const actor = await studioActor(c, sessions)
      if (actor instanceof Response) return actor
      const result = await planning().listSessionTemplates(actor, {
        organizationId,
        requestId: randomUUID(),
        ...pagination,
      })
      c.header('Cache-Control', 'private, max-age=0, must-revalidate')
      return c.json({
        data: result.items,
        page: { has_more: result.hasMore, next_cursor: encodeCursor(result.nextCursor) },
      })
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.post('/organizations/:organizationId/session-templates', async (c) => {
    const organizationId = organization(c, studioOrigin)
    if (organizationId instanceof Response) return organizationId
    const body = await readJson(c)
    if (!isCreateBody(body, 'discipline_code')) return problem(c, 'validation-failed')
    const command = commandContext(c, { organizationId, body })
    if (!command) return problem(c, 'invalid-request')
    try {
      const actor = await studioActor(c, sessions)
      if (actor instanceof Response) return actor
      const result = await planning().createSessionTemplate(actor, {
        organizationId,
        disciplineCode: body.discipline_code,
        title: body.title.trim(),
        ...command,
      })
      c.header('Cache-Control', 'no-store')
      c.header('ETag', result.resource.draft.etag)
      c.header(
        'Location',
        `/studio/v1/organizations/${organizationId}/session-templates/${result.resource.id}/draft`,
      )
      replay(c, result.replayed)
      return c.json(result.resource, 201)
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.put('/organizations/:organizationId/session-templates/:templateId/draft', async (c) => {
    const ids = templatePath(c, studioOrigin)
    if (ids instanceof Response) return ids
    const etag = draftEtag(c)
    if (etag instanceof Response) return etag
    const body = await readJson(c)
    if (!isObject(body)) return problem(c, 'invalid-request')
    const command = commandContext(c, { ...ids, body, etag })
    if (!command) return problem(c, 'invalid-request')
    try {
      const actor = await studioActor(c, sessions)
      if (actor instanceof Response) return actor
      const result = await planning().replaceSessionTemplateDraft(actor, {
        ...ids,
        expectedEtag: etag,
        content: body as SessionTemplateDraftContent,
        ...command,
      })
      c.header('Cache-Control', 'no-store')
      c.header('ETag', result.resource.etag)
      replay(c, result.replayed)
      return c.json(result.resource)
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.post(
    '/organizations/:organizationId/session-templates/:templateId/versions',
    async (c) => {
      const ids = templatePath(c, studioOrigin)
      if (ids instanceof Response) return ids
      const etag = draftEtag(c)
      if (etag instanceof Response) return etag
      const command = commandContext(c, { ...ids, etag })
      if (!command) return problem(c, 'invalid-request')
      try {
        const actor = await studioActor(c, sessions)
        if (actor instanceof Response) return actor
        const result = await planning().publishSessionTemplateVersion(actor, {
          ...ids,
          expectedEtag: etag,
          ...command,
        })
        c.header('Cache-Control', 'no-store')
        c.header('Location', `${c.req.path}/${result.resource.version_number}`)
        replay(c, result.replayed)
        return c.json(result.resource, 201)
      } catch (error) {
        return operationFailure(c, error)
      }
    },
  )

  routes.get(
    '/organizations/:organizationId/session-templates/:templateId/versions/:versionNumber',
    async (c) => {
      const version = templateVersionPath(c, studioOrigin)
      if (version instanceof Response) return version
      try {
        const actor = await studioActor(c, sessions)
        if (actor instanceof Response) return actor
        const resource = await planning().readSessionTemplateVersion(actor, {
          ...version,
          requestId: randomUUID(),
        })
        const etag = immutableEtag(resource)
        c.header('Cache-Control', 'private, max-age=31536000, immutable')
        c.header('ETag', etag)
        return c.json(resource)
      } catch (error) {
        return operationFailure(c, error)
      }
    },
  )

  routes.post(
    '/organizations/:organizationId/session-templates/:templateId/versions/:versionNumber/derivation',
    async (c) => {
      const version = templateVersionPath(c, studioOrigin)
      if (version instanceof Response) return version
      const etag = draftEtag(c)
      if (etag instanceof Response) return etag
      const command = commandContext(c, { ...version, etag })
      if (!command) return problem(c, 'invalid-request')
      try {
        const actor = await studioActor(c, sessions)
        if (actor instanceof Response) return actor
        const result = await planning().deriveSessionTemplateVersion(actor, {
          ...version,
          expectedEtag: etag,
          ...command,
        })
        c.header('Cache-Control', 'no-store')
        c.header('ETag', result.resource.etag)
        replay(c, result.replayed)
        return c.json(result.resource)
      } catch (error) {
        return operationFailure(c, error)
      }
    },
  )

  routes.post(
    '/organizations/:organizationId/session-templates/:templateId/versions/:versionNumber/deprecation',
    async (c) => {
      const version = templateVersionPath(c, studioOrigin)
      if (version instanceof Response) return version
      const command = commandContext(c, version)
      if (!command) return problem(c, 'invalid-request')
      try {
        const actor = await studioActor(c, sessions)
        if (actor instanceof Response) return actor
        const result = await planning().deprecateSessionTemplateVersion(actor, {
          ...version,
          ...command,
        })
        c.header('Cache-Control', 'no-store')
        replay(c, result.replayed)
        return c.json(result.resource)
      } catch (error) {
        return operationFailure(c, error)
      }
    },
  )

  routes.get('/organizations/:organizationId/programs', async (c) => {
    const organizationId = organization(c, studioOrigin)
    if (organizationId instanceof Response) return organizationId
    const pagination = parsePagination(c)
    if (!pagination) return problem(c, 'validation-failed')
    try {
      const actor = await studioActor(c, sessions)
      if (actor instanceof Response) return actor
      const result = await planning().listPrograms(actor, {
        organizationId,
        requestId: randomUUID(),
        ...pagination,
      })
      c.header('Cache-Control', 'private, max-age=0, must-revalidate')
      return c.json({
        data: result.items,
        page: { has_more: result.hasMore, next_cursor: encodeCursor(result.nextCursor) },
      })
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.post('/organizations/:organizationId/programs', async (c) => {
    const organizationId = organization(c, studioOrigin)
    if (organizationId instanceof Response) return organizationId
    const body = await readJson(c)
    if (!isCreateBody(body)) return problem(c, 'validation-failed')
    const command = commandContext(c, { organizationId, body })
    if (!command) return problem(c, 'invalid-request')
    try {
      const actor = await studioActor(c, sessions)
      if (actor instanceof Response) return actor
      const result = await planning().createProgram(actor, {
        organizationId,
        title: body.title.trim(),
        ...command,
      })
      c.header('Cache-Control', 'no-store')
      c.header('ETag', result.resource.draft.etag)
      c.header(
        'Location',
        `/studio/v1/organizations/${organizationId}/programs/${result.resource.id}/draft`,
      )
      replay(c, result.replayed)
      return c.json(result.resource, 201)
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.put('/organizations/:organizationId/programs/:programId/draft', async (c) => {
    const ids = programPath(c, studioOrigin)
    if (ids instanceof Response) return ids
    const etag = draftEtag(c)
    if (etag instanceof Response) return etag
    const body = await readJson(c)
    if (!isObject(body)) return problem(c, 'invalid-request')
    const command = commandContext(c, { ...ids, body, etag })
    if (!command) return problem(c, 'invalid-request')
    try {
      const actor = await studioActor(c, sessions)
      if (actor instanceof Response) return actor
      const result = await planning().replaceProgramDraft(actor, {
        ...ids,
        expectedEtag: etag,
        content: body as ProgramDraftContent,
        ...command,
      })
      c.header('Cache-Control', 'no-store')
      c.header('ETag', result.resource.etag)
      replay(c, result.replayed)
      return c.json(result.resource)
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.post('/organizations/:organizationId/programs/:programId/versions', async (c) => {
    const ids = programPath(c, studioOrigin)
    if (ids instanceof Response) return ids
    const etag = draftEtag(c)
    if (etag instanceof Response) return etag
    const command = commandContext(c, { ...ids, etag })
    if (!command) return problem(c, 'invalid-request')
    try {
      const actor = await studioActor(c, sessions)
      if (actor instanceof Response) return actor
      const result = await planning().publishProgramVersion(actor, {
        ...ids,
        expectedEtag: etag,
        ...command,
      })
      c.header('Cache-Control', 'no-store')
      c.header('Location', `${c.req.path}/${result.resource.version_number}`)
      replay(c, result.replayed)
      return c.json(result.resource, 201)
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.post(
    '/organizations/:organizationId/programs/:programId/versions/:versionNumber/deprecation',
    async (c) => {
      const version = programVersionPath(c, studioOrigin)
      if (version instanceof Response) return version
      const command = commandContext(c, version)
      if (!command) return problem(c, 'invalid-request')
      try {
        const actor = await studioActor(c, sessions)
        if (actor instanceof Response) return actor
        const result = await planning().deprecateProgramVersion(actor, { ...version, ...command })
        c.header('Cache-Control', 'no-store')
        replay(c, result.replayed)
        return c.json(result.resource)
      } catch (error) {
        return operationFailure(c, error)
      }
    },
  )
  return routes
}

function organization(c: Context, origin: string): string | Response {
  if (c.req.header('origin') !== origin) return problem(c, 'forbidden')
  const organizationId = c.req.param('organizationId')
  return organizationId && UUID.test(organizationId)
    ? organizationId
    : problem(c, 'invalid-request')
}

function templatePath(c: Context, origin: string) {
  const organizationId = organization(c, origin)
  if (organizationId instanceof Response) return organizationId
  const templateId = c.req.param('templateId')
  return templateId && UUID.test(templateId)
    ? { organizationId, templateId }
    : problem(c, 'invalid-request')
}

function programPath(c: Context, origin: string) {
  const organizationId = organization(c, origin)
  if (organizationId instanceof Response) return organizationId
  const programId = c.req.param('programId')
  return programId && UUID.test(programId)
    ? { organizationId, programId }
    : problem(c, 'invalid-request')
}

function templateVersionPath(c: Context, origin: string) {
  const ids = templatePath(c, origin)
  if (ids instanceof Response) return ids
  const versionNumber = positiveInteger(c.req.param('versionNumber'))
  return versionNumber ? { ...ids, versionNumber } : problem(c, 'invalid-request')
}

function programVersionPath(c: Context, origin: string) {
  const ids = programPath(c, origin)
  if (ids instanceof Response) return ids
  const versionNumber = positiveInteger(c.req.param('versionNumber'))
  return versionNumber ? { ...ids, versionNumber } : problem(c, 'invalid-request')
}

function draftEtag(c: Context): string | Response {
  const etag = c.req.header('if-match')
  if (!etag) return problem(c, 'precondition-required')
  return DRAFT_ETAG.test(etag) ? etag : problem(c, 'invalid-request')
}

function commandContext(c: Context, request: unknown) {
  const idempotencyKey = c.req.header('idempotency-key')
  const commandId = c.req.header('command-id')
  if (!idempotencyKey || !UUID_V4.test(idempotencyKey) || !commandId || !UUID_V7.test(commandId)) {
    return undefined
  }
  return {
    idempotencyKey,
    commandId,
    requestHash: createHash('sha256')
      .update(
        JSON.stringify(
          canonicalJson({
            method: c.req.method.toUpperCase(),
            path: c.req.path,
            content_type: canonicalContentType(c),
            body: isObject(request) && 'body' in request ? request.body : null,
            if_match: c.req.header('if-match') ?? null,
            resource: request,
          }),
        ),
      )
      .digest(),
  }
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (!isObject(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalJson(child)]),
  )
}

async function studioActor(c: Context, sessions: () => StudioSessionService) {
  const token = getCookie(c, STUDIO_SESSION_COOKIE)
  if (!token) return problem(c, 'unauthenticated', 'missing session cookie')
  try {
    const actor = await sessions().resolveActor(token)
    return actor.personId ? actor : problem(c, 'registration-incomplete')
  } catch (error) {
    if (error instanceof StudioSessionError) return problem(c, error.code)
    throw error
  }
}

function parsePagination(c: Context) {
  const limit = positiveInteger(c.req.query('limit') ?? '25')
  if (!limit || limit > 100) return undefined
  const rawCursor = c.req.query('cursor')
  if (!rawCursor) return { limit }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8'))
    if (
      !isObject(parsed) ||
      typeof parsed.updatedAt !== 'string' ||
      Number.isNaN(Date.parse(parsed.updatedAt)) ||
      typeof parsed.id !== 'string' ||
      !UUID.test(parsed.id)
    ) {
      return undefined
    }
    return { limit, cursor: { updatedAt: parsed.updatedAt, id: parsed.id } }
  } catch {
    return undefined
  }
}

function encodeCursor(cursor: { updatedAt: string; id: string } | undefined): string | null {
  return cursor ? Buffer.from(JSON.stringify(cursor)).toString('base64url') : null
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^[1-9][0-9]*$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed <= 2_147_483_647 ? parsed : undefined
}

function isCreateBody(
  value: unknown,
  discriminator?: 'discipline_code',
): value is { title: string; discipline_code: string } {
  if (
    !isObject(value) ||
    typeof value.title !== 'string' ||
    value.title.length > 160 ||
    !value.title.trim()
  ) {
    return false
  }
  const keys = Object.keys(value)
  if (!discriminator) return keys.length === 1
  return (
    keys.length === 2 &&
    typeof value.discipline_code === 'string' &&
    /^[a-z][a-z0-9_]{1,63}$/.test(value.discipline_code)
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json<unknown>()
  } catch {
    return undefined
  }
}

function replay(c: Context, replayed: boolean): void {
  if (replayed) c.header('Idempotent-Replay', 'true')
}

function canonicalContentType(c: Context): 'application/json' | undefined {
  const value = c.req.header('content-type')
  return value?.trim().toLowerCase() === 'application/json' ? 'application/json' : undefined
}

function immutableEtag(value: unknown): string {
  return `"sha256:${createHash('sha256').update(JSON.stringify(value)).digest('base64url')}"`
}

function operationFailure(c: Context, error: unknown) {
  if (error instanceof StudioPlanningError || error instanceof StudioSessionError) {
    return problem(c, error.code)
  }
  const code = databaseErrorCode(error)
  if (code === 'stale-draft') return staleDraftProblem(c, error)
  if (code === 'validation-failed') return validationFailureProblem(c, error)
  if (code === 'idempotency-in-progress') c.header('Retry-After', '1')
  if (code) return problem(c, code)
  console.error('[studio-planning] operation failed')
  return problem(c, 'upstream-unavailable')
}

function validationFailureProblem(c: Context, error: unknown) {
  const issues = validationIssues(error)
  if (!issues) return problem(c, 'validation-failed')
  return c.json(
    {
      type: 'https://errors.allfit.invalid/validation-failed',
      title: 'The request failed validation',
      status: 422,
      request_id: randomUUID(),
      errors: issues,
    },
    422,
    { 'Content-Type': 'application/problem+json' },
  )
}

function validationIssues(error: unknown) {
  if (!isObject(error) || typeof error.detail !== 'string') return undefined
  try {
    const values: unknown = JSON.parse(error.detail)
    if (!Array.isArray(values) || !values.every((value) => typeof value === 'string')) {
      return undefined
    }
    return values.slice(0, 100).map((code) => ({
      code,
      path: validationPath(code),
      message: validationMessage(code),
    }))
  } catch {
    return undefined
  }
}

function validationPath(code: string): string {
  if (code === 'title') return '/title'
  if (code === 'activity-type') return '/activity_type_id'
  if (code === 'movement') return '/steps'
  if (code === 'steps') return '/steps'
  if (code === 'sessions') return '/sessions'
  if (code.includes('session') || code === 'template-version' || code === 'duplicate-position') {
    return '/sessions'
  }
  if (code.includes('step') || code.includes('target')) return '/steps'
  return ''
}

function validationMessage(code: string): string {
  const messages: Record<string, string> = {
    title: 'A non-empty title is required.',
    'activity-type': 'A published compatible activity type is required.',
    movement: 'The movement must be accessible and compatible with the template discipline.',
    steps: 'At least one planned step is required.',
    sessions: 'At least one session is required.',
    'template-version': 'Each session must reference an accessible published template version.',
    'duplicate-step-position': 'Step positions must be unique.',
    'duplicate-session-position': 'Session positions must be unique.',
  }
  return messages[code] ?? 'The value does not satisfy the Planning content contract.'
}

function staleDraftProblem(c: Context, error: unknown) {
  let currentState: unknown
  if (isObject(error) && typeof error.detail === 'string') {
    try {
      currentState = JSON.parse(error.detail)
    } catch {
      currentState = undefined
    }
  }
  return c.json(
    {
      type: 'https://errors.allfit.invalid/stale-draft',
      title: 'The local draft is stale',
      status: 409,
      request_id: randomUUID(),
      ...(currentState === undefined ? {} : { current_state: currentState }),
    },
    409,
    { 'Content-Type': 'application/problem+json' },
  )
}

function databaseErrorCode(error: unknown): ApiErrorCode | undefined {
  if (!isObject(error)) return undefined
  const sqlState = typeof error.code === 'string' ? error.code : undefined
  const message = typeof error.message === 'string' ? error.message : ''
  if (sqlState === 'P0002') return 'not-found'
  if (sqlState === '42501') return 'forbidden'
  if (sqlState === '22023' || sqlState === '23514') return 'validation-failed'
  if (sqlState === '23505') return 'conflict'
  if (sqlState === '40001')
    return message.includes('stale-draft') ? 'stale-draft' : 'idempotency-in-progress'
  if (sqlState === '55000') return 'conflict'
  return undefined
}
