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

import { fail, failPlanLimit, planLimitFeature } from '../../../platform/http/index.js'
import {
  SpaceActorError,
  spaceActorResolver,
  type SpaceActorResolver,
} from '../../identity/index.js'
import { authProvider } from '../../../platform/auth/index.js'
import { spacePlanningService } from '../dependencies.js'
import { spaceExecutionService, type SpaceExecutionService } from '../../execution/index.js'
import type { SpacePlanningService } from '../application/space.js'
import type { RoutineCover } from '../domain/space.js'

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
      const [catalogue, session, week, progress, openFree] = await Promise.all([
        planning().readCatalogue({ personId, requestId }),
        planning().readTodaySession({ personId, timezone, requestId }),
        executions().readWeekSummary({ personId, timezone, requestId }),
        planning().readWeekProgress({ personId, timezone, requestId }),
        executions().readOpenFreeSession({ personId, requestId }),
      ])
      return c.json(
        {
          profile: catalogue.profile,
          current_assignment: catalogue.current_assignment,
          session,
          open_free_session_id: openFree,
          // Execution answers for what was trained; Planning answers for what was
          // planned. Execution's own counts are person-wide — every programme at once —
          // and this screen names one programme, so the counts come from Planning.
          week: { ...week, ...progress },
        },
        200,
      )
    } catch (cause) {
      return failure(c, cause)
    }
  })

  // The six that make content somebody's own. `If-Match` carries the draft's ETag,
  // which is a precondition on the resource rather than a field of the body: in the
  // body a client could send one value and mean another.
  routes.post('/session-templates', async (c) => {
    c.header('Cache-Control', 'no-store')
    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const body = await readJson(c)
    const created = readTemplateCreate(body)
    const command = commandContext(c, body)
    if (!created || !command) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      const template = await planning().createMySessionTemplate({
        personId,
        ...created,
        ...command,
      })
      c.header('Location', `/space/v1/session-templates/${template.id}`)
      return c.json(template, 201)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.put('/session-templates/:templateId/draft', async (c) => {
    c.header('Cache-Control', 'no-store')
    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const templateId = c.req.param('templateId')
    const body = await readJson(c)
    const expectedEtag = c.req.header('if-match')
    const command = commandContext(c, body)
    if (!UUID_V7.test(templateId) || !expectedEtag || !command) return fail(c, 'invalid-request')
    if (typeof body !== 'object' || body === null) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      const draft = await planning().replaceMySessionTemplateDraft({
        personId,
        templateId,
        expectedEtag,
        content: contentOf(body),
        ...command,
      })
      return c.json(draft, 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.get('/session-templates/:templateId/draft', async (c) => {
    c.header('Cache-Control', 'no-store')
    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const templateId = c.req.param('templateId')
    if (!UUID_V7.test(templateId)) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      const draft = await planning().readMySessionTemplateDraft({
        personId,
        templateId,
        requestId: c.req.header('x-request-id') ?? '',
      })
      // Somebody else's routine, one that was discarded and one that never existed all
      // answer the same. Separating them would let identifiers be walked.
      if (!draft) return fail(c, 'not-found')
      c.header('ETag', draft.etag)
      return c.json(draft, 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.post('/session-templates/:templateId/discard', async (c) => {
    c.header('Cache-Control', 'no-store')
    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const templateId = c.req.param('templateId')
    const command = commandContext(c, undefined)
    if (!UUID_V7.test(templateId) || !command) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      const template = await planning().discardMySessionTemplate({
        personId,
        templateId,
        ...command,
      })
      return c.json(template, 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  // The new routine, never the original. Without a body, as duplicating a programme.
  routes.post('/session-templates/:templateId/duplicate', async (c) => {
    c.header('Cache-Control', 'no-store')
    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const templateId = c.req.param('templateId')
    const command = commandContext(c, undefined)
    if (!UUID_V7.test(templateId) || !command) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      const copy = await planning().duplicateMySessionTemplate({ personId, templateId, ...command })
      return c.json(copy, 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.post('/session-templates/:templateId/versions', async (c) => {
    c.header('Cache-Control', 'no-store')
    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const templateId = c.req.param('templateId')
    const expectedEtag = c.req.header('if-match')
    const command = commandContext(c, undefined)
    if (!UUID_V7.test(templateId) || !expectedEtag || !command) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      const version = await planning().publishMySessionTemplate({
        personId,
        templateId,
        expectedEtag,
        ...command,
      })
      return c.json(version, 201)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.post('/programs', async (c) => {
    c.header('Cache-Control', 'no-store')
    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const body = await readJson(c)
    const title = readTitle(body)
    const command = commandContext(c, body)
    if (!title || !command) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      const program = await planning().createMyProgram({ personId, title, ...command })
      c.header('Location', `/space/v1/programs/${program.id}`)
      return c.json(program, 201)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.put('/programs/:programId/draft', async (c) => {
    c.header('Cache-Control', 'no-store')
    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const programId = c.req.param('programId')
    const body = await readJson(c)
    const expectedEtag = c.req.header('if-match')
    const command = commandContext(c, body)
    if (!UUID_V7.test(programId) || !expectedEtag || !command) return fail(c, 'invalid-request')
    if (typeof body !== 'object' || body === null) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      const draft = await planning().replaceMyProgramDraft({
        personId,
        programId,
        expectedEtag,
        content: contentOf(body),
        ...command,
      })
      return c.json(draft, 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.get('/programs/:programId/draft', async (c) => {
    c.header('Cache-Control', 'no-store')
    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const programId = c.req.param('programId')
    if (!UUID_V7.test(programId)) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      const draft = await planning().readMyProgramDraft({
        personId,
        programId,
        requestId: c.req.header('x-request-id') ?? '',
      })
      // Somebody else's programme and one taken from Allfit answer the same. The
      // second is not a permission problem — a fork has no draft to open — but
      // separating them would let identifiers be walked to learn what exists.
      if (!draft) return fail(c, 'not-found')
      c.header('ETag', draft.etag)
      return c.json(draft, 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  // Before the parameterised routes: `unpublished` is a word, not an identifier, and
  // registered after them it would be read as a programme called that.
  routes.get('/programs/unpublished', async (c) => {
    c.header('Cache-Control', 'no-store')
    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    try {
      const personId = await actors().personFor(token.subject)
      const program = await planning().readMyUnpublishedProgram({
        personId,
        requestId: c.req.header('x-request-id') ?? '',
      })
      return c.json(program, 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.post('/programs/:programId/discard', async (c) => {
    c.header('Cache-Control', 'no-store')
    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const programId = c.req.param('programId')
    const command = commandContext(c, undefined)
    if (!UUID_V7.test(programId) || !command) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      const program = await planning().discardMyProgram({ personId, programId, ...command })
      return c.json(program, 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  // Eliminar un programa publicado, que es lo que el descarte rechaza. El cuerpo
  // viaja al hash de idempotencia: reintentar con otra respuesta no es el mismo acto.
  routes.post('/programs/:programId/remove', async (c) => {
    c.header('Cache-Control', 'no-store')
    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const programId = c.req.param('programId')
    const body = await readJson(c)
    const withRoutines = readRemoval(body)
    const command = commandContext(c, body)
    if (!UUID_V7.test(programId) || withRoutines === undefined || !command) {
      return fail(c, 'invalid-request')
    }

    try {
      const personId = await actors().personFor(token.subject)
      const program = await planning().removeMyProgram({
        personId,
        programId,
        withRoutines,
        ...command,
      })
      return c.json(program, 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  // Contesta el programa **nuevo**, no el copiado. Sin cuerpo: duplicar no admite
  // opciones, y un cuerpo que no se lee sería una promesa que nadie cumple.
  routes.post('/programs/:programId/duplicate', async (c) => {
    c.header('Cache-Control', 'no-store')
    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const programId = c.req.param('programId')
    const command = commandContext(c, undefined)
    if (!UUID_V7.test(programId) || !command) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      const copy = await planning().duplicateMyProgram({ personId, programId, ...command })
      return c.json(copy, 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.post('/programs/:programId/versions', async (c) => {
    c.header('Cache-Control', 'no-store')
    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const programId = c.req.param('programId')
    const expectedEtag = c.req.header('if-match')
    const command = commandContext(c, undefined)
    // Always sent, because only the server knows whether this publication has to
    // start an assignment, and a start needs the zone today is asked in.
    const timezone = (c.req.query('timezone') ?? '').trim()
    if (!UUID_V7.test(programId) || !expectedEtag || !command) return fail(c, 'invalid-request')
    if (timezone === '' || timezone.length > MAX_TIMEZONE) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      // Publishing an edit moves the agenda onto it in the same act. Apart, editing
      // a programme you follow would change nothing you train.
      const version = await planning().publishAndRestate({
        personId,
        programId,
        expectedEtag,
        timezone,
        ...command,
      })
      return c.json(version, 201)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.get('/week-plan', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const timezone = (c.req.query('timezone') ?? '').trim()
    if (timezone === '' || timezone.length > MAX_TIMEZONE) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      const plan = await planning().readWeekPlan({
        personId,
        timezone,
        requestId: c.req.header('x-request-id') ?? '',
      })
      // No programme is not an empty week; it is a different screen.
      if (!plan) return fail(c, 'not-found')
      return c.json(plan, 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.get('/programs/mine', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    try {
      const personId = await actors().personFor(token.subject)
      const mine = await planning().readMyPrograms({
        personId,
        requestId: c.req.header('x-request-id') ?? '',
      })
      return c.json(mine, 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.get('/my-content', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    try {
      const personId = await actors().personFor(token.subject)
      return c.json(
        await planning().readMyContent({ personId, requestId: c.req.header('x-request-id') ?? '' }),
        200,
      )
    } catch (cause) {
      return failure(c, cause)
    }
  })

  /**
   * `OP-PLN-033` — cómo se ven las rutinas de un programa.
   *
   * Va antes que `/programs/mine/order` porque Hono resuelve por orden de registro y
   * `:programId` se tragaría `mine` si estuviera delante.
   */
  routes.put('/programs/:programId/cover', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const programId = c.req.param('programId')
    const body = await readJson(c)
    const command = commandContext(c, body)
    const cover = readCover(body)
    if (!UUID_V7.test(programId) || !command || cover === undefined) {
      return fail(c, 'invalid-request')
    }

    try {
      const personId = await actors().personFor(token.subject)
      const dressed = await planning().setMyProgramCover({ personId, programId, cover, ...command })
      return c.json(dressed, 200)
    } catch (cause) {
      return failure(c, cause)
    }
  })

  routes.put('/programs/mine/order', async (c) => {
    c.header('Cache-Control', 'no-store')

    const token = await verified(c, verify)
    if (!token) return fail(c, 'unauthenticated')

    const body = await readJson(c)
    const order = readOrder(body)
    const command = commandContext(c, body)
    if (!order || !command) return fail(c, 'invalid-request')

    try {
      const personId = await actors().personFor(token.subject)
      const mine = await planning().reorderMyPrograms({
        personId,
        assignmentIds: order,
        ...command,
      })
      return c.json(mine, 200)
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
  // The plan does not open this: the app offers Pro for exactly the function named.
  const feature = planLimitFeature(cause)
  if (feature) return failPlanLimit(c, feature)
  // A version the person may not reach answers `42501` from the database, which is
  // the same thing the policy would have said: not yours.
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    const code = (cause as { code: unknown }).code
    if (code === '42501') return fail(c, 'forbidden')
    if (code === '22023') return fail(c, 'invalid-request')
    if (code === '23505' || code === '40001') return fail(c, 'conflict')
    // Una regla del dominio que mira el estado y dice que no: descartar la última
    // rutina de un programa lo dejaría vacío, y un programa vacío no se puede publicar.
    // Es un conflicto con lo que hay, no una caída — que es lo que decía antes al no
    // estar mapeado, y mandaba a la gente a mirar su conexión.
    if (code === '23514') return fail(c, 'conflict')
    // `P0002` es el programa que no es de esta persona. Sin mapear caía en
    // `upstream-unavailable`, y el 404 que estas operaciones documentan no salía nunca.
    if (code === 'P0002') return fail(c, 'not-found')
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

const CHOICE_KEYS = new Set(['program_version_id', 'timezone', 'adopt_nutrition'])

/** The keys the contract names and no other: an extra one is something we do not honour. */
function readChoice(
  body: unknown,
): { programVersionId: string; timezone: string; adoptNutrition: boolean } | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  if (Object.keys(body).some((key) => !CHOICE_KEYS.has(key))) return undefined
  const {
    program_version_id: version,
    timezone,
    adopt_nutrition: adopt,
  } = body as {
    program_version_id: unknown
    timezone: unknown
    adopt_nutrition?: unknown
  }
  if (adopt !== undefined && typeof adopt !== 'boolean') return undefined
  if (typeof version !== 'string' || !UUID_V7.test(version)) return undefined
  if (typeof timezone !== 'string') return undefined
  const trimmed = timezone.trim()
  if (trimmed === '' || trimmed.length > MAX_TIMEZONE) return undefined
  return { programVersionId: version, timezone: trimmed, adoptNutrition: adopt === true }
}

/**
 * The draft content passes through as the contract declares it. PostgreSQL validates
 * every field of it with `session_content_errors` and `program_content_errors`, and
 * re-checking here would be a second, weaker copy of the rules that would drift.
 */
function contentOf(body: object): never {
  return body as never
}

function readTemplateCreate(body: unknown): { disciplineCode: string; title: string } | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const keys = Object.keys(body)
  if (keys.length !== 2) return undefined
  const { discipline_code: discipline, title } = body as Record<string, unknown>
  if (typeof discipline !== 'string' || !/^[a-z][a-z0-9_]{1,63}$/.test(discipline)) return undefined
  if (typeof title !== 'string' || title.trim() === '' || title.length > 160) return undefined
  return { disciplineCode: discipline, title: title.trim() }
}

/**
 * Whether the programme's routines go with it, or `undefined` when the body does not
 * say. Asked and never defaulted: choosing for the person would archive their library
 * on their behalf, and `false` is a real answer rather than an absence.
 */
function readRemoval(body: unknown): boolean | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const keys = Object.keys(body)
  if (keys.length !== 1 || keys[0] !== 'with_routines') return undefined
  const withRoutines = (body as { with_routines: unknown }).with_routines
  return typeof withRoutines === 'boolean' ? withRoutines : undefined
}

function readTitle(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const keys = Object.keys(body)
  if (keys.length !== 1 || keys[0] !== 'title') return undefined
  const title = (body as { title: unknown }).title
  if (typeof title !== 'string' || title.trim() === '' || title.length > 160) return undefined
  return title.trim()
}

/** Every assignment, once, in order. A partial list is refused rather than merged. */
function readOrder(body: unknown): readonly string[] | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const keys = Object.keys(body)
  if (keys.length !== 1 || keys[0] !== 'assignment_ids') return undefined
  const ids = (body as { assignment_ids: unknown }).assignment_ids
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100) return undefined
  if (!ids.every((id) => typeof id === 'string' && UUID_V7.test(id))) return undefined
  if (new Set(ids).size !== ids.length) return undefined
  return ids as readonly string[]
}

/**
 * La portada que el cuerpo declara, o `undefined` cuando no declara una válida.
 *
 * Null es una respuesta y no una ausencia: es quitar la portada. Por eso el «no se
 * entiende» tiene que ser un tercer valor y no puede colarse como null, que borraría lo
 * que hay porque el cuerpo venía mal escrito.
 */
function readCover(body: unknown): RoutineCover | null | undefined {
  if (typeof body !== 'object' || body === null || !('cover' in body)) return undefined
  const cover = (body as { cover: unknown }).cover
  if (cover === null) return null
  if (typeof cover !== 'object') return undefined
  const kind = (cover as { kind?: unknown }).kind
  const icon = (cover as { icon?: unknown }).icon
  if (kind === 'muscles' || kind === 'photo') return icon === undefined ? { kind } : undefined
  if (kind !== 'icon' || typeof icon !== 'string') return undefined
  return { kind, icon } as RoutineCover
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
