/** Client directory routes for Studio. */

import { createHash } from 'node:crypto'
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
import { fail } from '../../../platform/http/index.js'
import {
  clientDirectoryService,
  holderAssignmentService,
  holderReassignmentService,
  relationshipHistoryService,
  relationshipStateService,
  substitutionProposalService,
  substitutionTerminationService,
} from '../dependencies.js'
import {
  RelationshipsError,
  type ClientDirectoryService,
  type HolderAssignmentService,
  type HolderReassignmentService,
  type RelationshipHistoryService,
  type RelationshipStateService,
  type SubstitutionProposalService,
  type SubstitutionTerminationService,
} from '../application/index.js'
import type {
  DirectoryEntry,
  DirectoryGroup,
  RelationshipHistory,
  RelationshipState,
} from '../domain/index.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DIRECTORY_GROUPS = new Set<DirectoryGroup>(['active', 'invited', 'terminated'])
const CALENDAR_DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

/**
 * The services these routes stand on. Every one is optional and every one
 * defaults to the real thing, so a caller names only what it wants to replace.
 *
 * Named rather than positional because they were positional until one test had
 * to build five services it did not use in order to reach the sixth. Each new
 * operation in this domain adds one, so the list only grows.
 */
export interface StudioRelationshipDependencies {
  readonly directory?: ClientDirectoryService
  readonly sessions?: StudioSessionService
  readonly holders?: HolderAssignmentService
  readonly states?: RelationshipStateService
  readonly reassignments?: HolderReassignmentService
  readonly histories?: RelationshipHistoryService
  readonly substitutions?: SubstitutionProposalService
  readonly terminations?: SubstitutionTerminationService
}

export function studioRelationshipRoutes(injected: StudioRelationshipDependencies = {}): Hono {
  const studioOrigin = new URL(trustedStudioWebUrl()).origin
  const directory = () => injected.directory ?? clientDirectoryService()
  const holders = () => injected.holders ?? holderAssignmentService()
  const states = () => injected.states ?? relationshipStateService()
  const reassignments = () => injected.reassignments ?? holderReassignmentService()
  const histories = () => injected.histories ?? relationshipHistoryService()
  const substitutions = () => injected.substitutions ?? substitutionProposalService()
  const terminations = () => injected.terminations ?? substitutionTerminationService()
  const sessions = () => injected.sessions ?? studioSessionService()
  const routes = new Hono()

  routes.use(
    '*',
    cors({
      origin: studioOrigin,
      credentials: true,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Idempotency-Key', 'Command-Id'],
      maxAge: 600,
    }),
  )

  /*
   * OP-REL-010. The narrowing a coach gets is not here: this hands the same
   * query to PostgreSQL for every caller and the row policy decides which
   * clients come back. No access event is written — the directory carries a
   * name and the state of a link, and no fitness data of any kind.
   */
  routes.get('/organizations/:organizationId/clients', async (c) => {
    c.header('Cache-Control', 'private, no-store')
    if (c.req.header('origin') !== studioOrigin) {
      return fail(c, 'forbidden', 'origin is not allowed')
    }
    const organizationId = c.req.param('organizationId')
    if (!UUID.test(organizationId)) return fail(c, 'invalid-request')

    const statusValue = c.req.query('status')
    const status =
      statusValue && DIRECTORY_GROUPS.has(statusValue as DirectoryGroup)
        ? (statusValue as DirectoryGroup)
        : undefined
    if (statusValue && !status) return fail(c, 'validation-failed')

    const limit = parseLimit(c.req.query('limit'))
    if (!limit) return fail(c, 'validation-failed')
    const cursor = parseClientCursor(c.req.query('cursor'), status)
    if (cursor === null) return fail(c, 'validation-failed')

    try {
      const actor = await studioActor(c, sessions())
      if (actor instanceof Response) return actor
      const page = await directory().listClients(actor, {
        organizationId,
        ...(status ? { status } : {}),
        limit,
        ...(cursor ?? {}),
      })
      const last = page.items.at(-1)
      return c.json({
        data: page.items.map(presentEntry),
        page: {
          has_more: page.hasMore,
          next_cursor:
            page.hasMore && last
              ? encodeClientCursor(last.sortGroup, last.sortName, last.sortId, status)
              : null,
        },
      })
    } catch (error) {
      return failure(c, error)
    }
  })

  /*
   * OP-REL-011. Says where the link stands, who attends the person, and which
   * permissions are in force — never what a permission covers.
   *
   * A relationship the caller may not see answers 404, which is the function's
   * own choice: `403` would confirm to a coach that the organization has that
   * client, undoing the narrowing the row policy exists for.
   */
  routes.get('/organizations/:organizationId/relationships/:relationshipId', async (c) => {
    c.header('Cache-Control', 'private, no-store')
    if (c.req.header('origin') !== studioOrigin) {
      return fail(c, 'forbidden', 'origin is not allowed')
    }
    const organizationId = c.req.param('organizationId')
    const relationshipId = c.req.param('relationshipId')
    if (!UUID.test(organizationId) || !UUID.test(relationshipId)) {
      return fail(c, 'invalid-request')
    }

    try {
      const actor = await studioActor(c, sessions())
      if (actor instanceof Response) return actor
      const state = await states().read(actor, { organizationId, relationshipId })
      return c.json(presentState(state))
    } catch (error) {
      return failure(c, error)
    }
  })

  /*
   * OP-REL-014. What the relationship has been through, newest first.
   *
   * 404 for a relationship the caller may not see, like the state read above and
   * for the same reason.
   *
   * The page is shorter for a coach than for an owner, because the row policy
   * shows a coach only their own assignment. That is deliberate, and it is why
   * this route does not try to report a total: a count the reader cannot
   * reconcile with what they see is worse than no count.
   *
   * `limit` and `cursor` go down unvalidated beyond their shape. The function
   * clamps the limit and refuses a cursor it cannot read, and it is the only
   * place that knows what a cursor of its own looks like.
   */
  routes.get('/organizations/:organizationId/relationships/:relationshipId/events', async (c) => {
    c.header('Cache-Control', 'private, no-store')
    if (c.req.header('origin') !== studioOrigin) {
      return fail(c, 'forbidden', 'origin is not allowed')
    }
    const organizationId = c.req.param('organizationId')
    const relationshipId = c.req.param('relationshipId')
    if (!UUID.test(organizationId) || !UUID.test(relationshipId)) {
      return fail(c, 'invalid-request')
    }

    const rawLimit = c.req.query('limit')
    // A limit that is not a number is a caller mistake worth reporting, not
    // something to silently read as the default.
    if (rawLimit !== undefined && !/^[0-9]{1,3}$/.test(rawLimit)) {
      return fail(c, 'invalid-request')
    }
    const limit = rawLimit === undefined ? null : Number(rawLimit)
    const cursor = c.req.query('cursor') ?? null

    try {
      const actor = await studioActor(c, sessions())
      if (actor instanceof Response) return actor
      const history = await histories().read(actor, {
        organizationId,
        relationshipId,
        limit,
        cursor,
      })
      return c.json(presentHistory(history))
    } catch (error) {
      return failure(c, error)
    }
  })

  /*
   * OP-REL-002. Says who attends this person, and nothing else: the function
   * never touches a grant, so being in charge still reads nothing without the
   * person's permission.
   *
   * Only puts a coach where there is none. Taking the client away from the
   * coach who has them is OP-REL-003, which owes the person a notification
   * this route never sends, so a relationship that already has a holder comes
   * back as a conflict instead.
   */
  routes.post(
    '/organizations/:organizationId/relationships/:relationshipId/professional-assignments',
    async (c) => {
      c.header('Cache-Control', 'no-store')
      if (c.req.header('origin') !== studioOrigin) {
        return fail(c, 'forbidden', 'origin is not allowed')
      }
      const organizationId = c.req.param('organizationId')
      const relationshipId = c.req.param('relationshipId')
      if (!UUID.test(organizationId) || !UUID.test(relationshipId)) {
        return fail(c, 'invalid-request')
      }
      const body = await readJson(c)
      if (!isHolderAssignment(body)) return fail(c, 'validation-failed')
      const command = commandContext(c, body)
      if (!command) return fail(c, 'invalid-request', 'valid command headers are required')

      try {
        const actor = await studioActor(c, sessions())
        if (actor instanceof Response) return actor
        const result = await holders().assign(actor, {
          organizationId,
          relationshipId,
          membershipId: body.membership_id,
          ...command,
        })
        if (result.replayed) c.header('Idempotent-Replay', 'true')
        return c.json(
          {
            assignment_id: result.resource.assignmentId,
            relationship_id: result.resource.relationshipId,
            membership_id: result.resource.membershipId,
            person_id: result.resource.personId,
            valid_from: result.resource.validFrom.toISOString(),
          },
          result.created ? 201 : 200,
        )
      } catch (error) {
        return failure(c, error)
      }
    },
  )

  /*
   * OP-REL-003. Takes the client away from the coach who has them.
   *
   * Its own surface rather than a flag on the assignment route, because it
   * carries a guarantee that one does not: the person is notified, and the
   * notice is an outbox row written inside the command's transaction. There is
   * no path where the change commits and the notice does not.
   */
  routes.post(
    '/organizations/:organizationId/relationships/:relationshipId/professional-assignments/reassignment',
    async (c) => {
      c.header('Cache-Control', 'no-store')
      if (c.req.header('origin') !== studioOrigin) {
        return fail(c, 'forbidden', 'origin is not allowed')
      }
      const organizationId = c.req.param('organizationId')
      const relationshipId = c.req.param('relationshipId')
      if (!UUID.test(organizationId) || !UUID.test(relationshipId)) {
        return fail(c, 'invalid-request')
      }
      const body = await readJson(c)
      if (!isHolderAssignment(body)) return fail(c, 'validation-failed')
      const command = commandContext(c, body)
      if (!command) return fail(c, 'invalid-request', 'valid command headers are required')

      try {
        const actor = await studioActor(c, sessions())
        if (actor instanceof Response) return actor
        const result = await reassignments().reassign(actor, {
          organizationId,
          relationshipId,
          membershipId: body.membership_id,
          ...command,
        })
        if (result.replayed) c.header('Idempotent-Replay', 'true')
        return c.json(
          {
            assignment_id: result.resource.assignmentId,
            relationship_id: result.resource.relationshipId,
            membership_id: result.resource.membershipId,
            professional_person_id: result.resource.professionalPersonId,
            valid_from: result.resource.validFrom.toISOString(),
            replaced_assignment_id: result.resource.replacedAssignmentId,
          },
          result.reassigned ? 201 : 200,
        )
      } catch (error) {
        return failure(c, error)
      }
    },
  )

  /*
   * OP-REL-004. Asks the person to accept somebody covering for their coach.
   *
   * Unlike its two siblings this one grants nothing when it succeeds: the cover
   * is created pending, and the professional named in it reads nothing of the
   * person's until the person answers. That is why the route returns 201 for
   * something nobody can use yet.
   *
   * The holder may call it, which no other operation in this domain allows —
   * they are the one who knows they will be away.
   */
  routes.post(
    '/organizations/:organizationId/relationships/:relationshipId/substitutions',
    async (c) => {
      c.header('Cache-Control', 'no-store')
      if (c.req.header('origin') !== studioOrigin) {
        return fail(c, 'forbidden', 'origin is not allowed')
      }
      const organizationId = c.req.param('organizationId')
      const relationshipId = c.req.param('relationshipId')
      if (!UUID.test(organizationId) || !UUID.test(relationshipId)) {
        return fail(c, 'invalid-request')
      }
      const body = await readJson(c)
      if (!isSubstitutionProposal(body)) return fail(c, 'validation-failed')
      const command = commandContext(c, body)
      if (!command) return fail(c, 'invalid-request', 'valid command headers are required')

      try {
        const actor = await studioActor(c, sessions())
        if (actor instanceof Response) return actor
        const result = await substitutions().propose(actor, {
          organizationId,
          relationshipId,
          membershipId: body.membership_id,
          startsOn: body.starts_on,
          endsOn: body.ends_on,
          ...command,
        })
        if (result.replayed) c.header('Idempotent-Replay', 'true')
        return c.json(
          {
            assignment_id: result.resource.assignmentId,
            relationship_id: result.resource.relationshipId,
            membership_id: result.resource.membershipId,
            professional_person_id: result.resource.professionalPersonId,
            starts_on: result.resource.startsOn,
            ends_on: result.resource.endsOn,
          },
          result.proposed ? 201 : 200,
        )
      } catch (error) {
        return failure(c, error)
      }
    },
  )

  /*
   * `OP-REL-006`. The mirror of the route above, and deliberately not its
   * mirror in who may call it: proposing a cover accepts the coach in charge,
   * ending one does not. An administrator or owner here; the person has her own
   * route in Space.
   *
   * No body, so the hash that makes the command idempotent is taken from what
   * the path names. Hashing an empty object instead would let one key replay
   * across two different covers.
   */
  routes.post(
    '/organizations/:organizationId/relationships/:relationshipId/substitutions/:substitutionId/termination',
    async (c) => {
      c.header('Cache-Control', 'no-store')
      if (c.req.header('origin') !== studioOrigin) {
        return fail(c, 'forbidden', 'origin is not allowed')
      }
      const organizationId = c.req.param('organizationId')
      const relationshipId = c.req.param('relationshipId')
      const substitutionId = c.req.param('substitutionId')
      if (!UUID.test(organizationId) || !UUID.test(relationshipId) || !UUID.test(substitutionId)) {
        return fail(c, 'invalid-request')
      }
      const command = commandContext(c, { relationshipId, substitutionId })
      if (!command) return fail(c, 'invalid-request', 'valid command headers are required')

      try {
        const actor = await studioActor(c, sessions())
        if (actor instanceof Response) return actor
        const result = await terminations().end(actor, {
          organizationId,
          relationshipId,
          assignmentId: substitutionId,
          ...command,
        })
        if (result.replayed) c.header('Idempotent-Replay', 'true')
        return c.json({
          assignment_id: result.resource.assignmentId,
          relationship_id: result.resource.relationshipId,
          membership_id: result.resource.membershipId,
          professional_person_id: result.resource.professionalPersonId,
          ended_at: result.resource.endedAt,
        })
      } catch (error) {
        return failure(c, error)
      }
    },
  )

  return routes
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return undefined
  }
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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isObject(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function isHolderAssignment(value: unknown): value is { membership_id: string } {
  return (
    isObject(value) &&
    Object.keys(value).join(',') === 'membership_id' &&
    typeof value.membership_id === 'string' &&
    UUID.test(value.membership_id)
  )
}

/*
 * The keys are sorted before comparing, unlike the assignment above: with one
 * field there is one order, with three there are six, and rejecting a body for
 * naming its fields in a different order would be a contract nobody could read
 * off the request.
 */
function isSubstitutionProposal(
  value: unknown,
): value is { membership_id: string; starts_on: string; ends_on: string } {
  return (
    isObject(value) &&
    Object.keys(value).sort().join(',') === 'ends_on,membership_id,starts_on' &&
    typeof value.membership_id === 'string' &&
    UUID.test(value.membership_id) &&
    isCalendarDay(value.starts_on) &&
    isCalendarDay(value.ends_on)
  )
}

/**
 * A day as a person writes it, with no time and no zone. Which order the two
 * dates come in, and whether the window is in the past, is decided by the
 * command — this only says the string names a day that exists.
 */
function isCalendarDay(value: unknown): value is string {
  if (typeof value !== 'string' || !CALENDAR_DAY.test(value)) return false
  // `2026-02-31` has the shape of a day and is not one. `Date.UTC` rolls it
  // forward to 3 March, so reading the parts back is what catches it.
  const parts = value.split('-')
  const year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  )
}

/*
 * Resolving the session actor is duplicated here on purpose, as it is in
 * catalog, identity and organizations. Boundary rule 5 forbids reaching into
 * another domain's handlers, and twelve lines of cookie reading is the cheaper
 * side of that trade — the alternative is a shared module that every domain
 * depends on for something none of them owns.
 */
async function studioActor(c: Context, sessions: StudioSessionService) {
  const token = getCookie(c, STUDIO_SESSION_COOKIE)
  if (!token) return fail(c, 'unauthenticated')
  try {
    return await sessions.resolveActor(token)
  } catch (error) {
    if (error instanceof StudioSessionError) return fail(c, error.code)
    throw error
  }
}

/*
 * This mapped the two states a read can fail with, because reading the
 * directory was all this domain did. Assigning a holder can also find the
 * relationship gone, or find it closed, or lose a race with another
 * assignment — all of which came back as an outage before.
 */
function failure(c: Parameters<typeof fail>[0], error: unknown): Response {
  if (error instanceof RelationshipsError) return fail(c, error.code)
  const sqlState = isObject(error) && typeof error.code === 'string' ? error.code : undefined
  if (sqlState === '42501') return fail(c, 'forbidden')
  if (sqlState === 'P0002') return fail(c, 'not-found')
  if (sqlState === 'P0004' || sqlState === '23505' || sqlState === '40001') {
    return fail(c, 'conflict')
  }
  if (sqlState === '22023' || sqlState === '23514' || sqlState === '22P02') {
    return fail(c, 'validation-failed')
  }
  console.error('[studio-relationships] operation failed')
  return fail(c, 'upstream-unavailable')
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return 50
  if (!/^[1-9][0-9]*$/.test(value)) return undefined
  const parsed = Number(value)
  return parsed <= 100 ? parsed : undefined
}

/**
 * An invitation entry carries no person and no name: until somebody accepts,
 * neither exists. Presenting it with empty strings would invite a client to
 * render a blank name where there is nothing to render.
 */
function presentEntry(entry: DirectoryEntry): Record<string, unknown> {
  if (entry.kind === 'invitation') {
    return {
      kind: 'invitation',
      invitation_id: entry.invitationId,
      contact_hint: entry.contactHint,
      invitation_status: entry.invitationStatus,
      invited_at: entry.invitedAt.toISOString(),
    }
  }
  return {
    kind: 'relationship',
    relationship_id: entry.relationshipId,
    person_id: entry.personId,
    display_name: entry.displayName,
    relationship_status: entry.relationshipStatus,
    invitation_status: entry.invitationStatus,
    started_at: entry.startedAt.toISOString(),
    ended_at: entry.endedAt?.toISOString() ?? null,
  }
}

/**
 * Dates go out as ISO strings and nothing else changes shape. `ends_on` stays a
 * plain date: a substitution ends on a day in the gym's calendar, not at an
 * instant, and turning it into a timestamp would invent a timezone.
 */
/*
 * `{ data, page }`, like every other paginated response here. The relationship's
 * own id is in the path the caller used, so repeating it in the body would be a
 * second source for the same fact.
 */
function presentHistory(history: RelationshipHistory): Record<string, unknown> {
  return {
    data: history.events.map((event) => ({
      type: event.type,
      occurred_at: event.occurredAt.toISOString(),
      source_id: event.sourceId,
      detail: event.detail,
    })),
    page: {
      next_cursor: history.nextCursor,
      has_more: history.hasMore,
    },
  }
}

function presentState(state: RelationshipState): Record<string, unknown> {
  return {
    relationship_id: state.relationshipId,
    person_id: state.personId,
    display_name: state.displayName,
    status: state.status,
    started_at: state.startedAt.toISOString(),
    ended_at: state.endedAt?.toISOString() ?? null,
    holder: state.holder
      ? {
          assignment_id: state.holder.assignmentId,
          membership_id: state.holder.membershipId,
          professional_person_id: state.holder.professionalPersonId,
          display_name: state.holder.displayName,
          valid_from: state.holder.validFrom.toISOString(),
        }
      : null,
    substitutions: state.substitutions.map((entry) => ({
      assignment_id: entry.assignmentId,
      membership_id: entry.membershipId,
      professional_person_id: entry.professionalPersonId,
      display_name: entry.displayName,
      status: entry.status,
      valid_from: entry.validFrom.toISOString(),
      ends_on: entry.endsOn,
      accepted_by_person_at: entry.acceptedByPersonAt?.toISOString() ?? null,
    })),
    grants: state.grants.map((grant) => ({
      grant_id: grant.grantId,
      scope_code: grant.scopeCode,
      display_name: grant.displayName,
      version_number: grant.versionNumber,
      access_level: grant.accessLevel,
      status: grant.status,
      purpose: grant.purpose,
      granted_at: grant.grantedAt.toISOString(),
      revoked_at: grant.revokedAt?.toISOString() ?? null,
    })),
  }
}

/**
 * The cursor carries the filter it was issued under. Changing `status` between
 * pages would otherwise resume a different query from an offset that means
 * nothing in it, which reads as rows skipped rather than as a bad request.
 */
function parseClientCursor(
  value: string | undefined,
  filterStatus: DirectoryGroup | undefined,
):
  | {
      cursorGroup: DirectoryGroup
      cursorName: string
      cursorId: string
    }
  | undefined
  | null {
  if (!value) return undefined
  if (value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
    if (
      !isObject(parsed) ||
      parsed.v !== 2 ||
      parsed.filter_status !== (filterStatus ?? null) ||
      typeof parsed.group !== 'string' ||
      !DIRECTORY_GROUPS.has(parsed.group as DirectoryGroup) ||
      (filterStatus !== undefined && parsed.group !== filterStatus) ||
      typeof parsed.name !== 'string' ||
      parsed.name.length === 0 ||
      parsed.name.length > 254 ||
      typeof parsed.id !== 'string' ||
      !UUID.test(parsed.id)
    ) {
      return null
    }
    return {
      cursorGroup: parsed.group as DirectoryGroup,
      cursorName: parsed.name,
      cursorId: parsed.id,
    }
  } catch {
    return null
  }
}

function encodeClientCursor(
  group: DirectoryGroup,
  name: string,
  id: string,
  filterStatus: DirectoryGroup | undefined,
): string {
  return Buffer.from(
    JSON.stringify({
      v: 2,
      filter_status: filterStatus ?? null,
      group,
      name,
      id,
    }),
    'utf8',
  ).toString('base64url')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
