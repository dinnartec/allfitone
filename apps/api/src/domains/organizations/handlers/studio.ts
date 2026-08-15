/** Organization onboarding routes for Studio. */

import { createHash } from 'node:crypto'
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
import { fail } from '../../../platform/http/index.js'
import {
  recordStudioMembershipDestination,
  recordStudioOrganizationQuery,
} from '../../../platform/observability/index.js'
import { StudioOrganizationError, type StudioOrganizationService } from '../application/index.js'
import { studioOrganizationService } from '../dependencies.js'
import type { OrganizationMembershipStatus, OrganizationTypeCode } from '../domain/index.js'

type OrganizationCreate = AllfitV1Schemas['OrganizationCreate']

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ORGANIZATION_TYPES = new Set<OrganizationTypeCode>(['professional_practice', 'gym', 'studio'])
const MEMBERSHIP_STATUSES = new Set<OrganizationMembershipStatus>(['active', 'terminated'])
const ROLE_CATALOG_CACHE_CONTROL = 'private, max-age=0, must-revalidate'

export function studioOrganizationRoutes(
  injectedService?: StudioOrganizationService,
  injectedSessions?: StudioSessionService,
): Hono {
  const studioOrigin = new URL(trustedStudioWebUrl()).origin
  const organizations = () => injectedService ?? studioOrganizationService()
  const sessions = () => injectedSessions ?? studioSessionService()
  const routes = new Hono()

  routes.use(
    '*',
    cors({
      origin: studioOrigin,
      credentials: true,
      allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Idempotency-Key', 'Command-Id', 'If-None-Match'],
      exposeHeaders: ['ETag', 'Server-Timing'],
      maxAge: 600,
    }),
  )
  routes.use('*', async (c, next) => {
    await next()
    c.header('Vary', 'Origin')
  })

  routes.get('/entry-context', async (c) => {
    c.header('Cache-Control', 'private, no-store')
    try {
      const token = getCookie(c, STUDIO_SESSION_COOKIE)
      if (!token) return fail(c, 'unauthenticated', 'missing session cookie')
      const context = await sessions().resolveAccountIdentity(token)
      const memberships = context.actor.personId
        ? await organizations().listMemberships(context.actor)
        : []
      const { givenName, familyName, verifiedEmail } = context.identity
      return c.json({
        authenticated: true as const,
        registration_status: context.actor.personId
          ? ('complete' as const)
          : ('incomplete' as const),
        identity: {
          name: givenName && familyName ? `${givenName} ${familyName}` : null,
          email: verifiedEmail,
        },
        memberships: memberships.map(membershipPresentation),
      })
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.get('/me/memberships', async (c) => {
    c.header('Cache-Control', 'private, no-store')
    try {
      const actor = await studioActor(c, sessions())
      if (actor instanceof Response) return actor
      const items = await organizations().listMemberships(actor)
      const activeCount = items.filter((membership) => membership.status === 'active').length
      recordStudioMembershipDestination(
        activeCount === 0 ? 'zero' : activeCount === 1 ? 'one' : 'multiple',
      )
      return c.json({
        items: items.map(membershipPresentation),
      })
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.get('/organization-types', async (c) => {
    c.header('Cache-Control', 'private, no-store')
    try {
      const actor = await studioActor(c, sessions())
      if (actor instanceof Response) return actor
      return c.json({ items: await organizations().listTypes(actor) })
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.get('/organizations/:organizationId/memberships', async (c) => {
    c.header('Cache-Control', 'private, no-store')
    if (c.req.header('origin') !== studioOrigin) {
      return fail(c, 'forbidden', 'origin is not allowed')
    }
    const organizationId = c.req.param('organizationId')
    if (!UUID.test(organizationId)) return fail(c, 'invalid-request')
    const statusValue = c.req.query('status')
    const status =
      statusValue && MEMBERSHIP_STATUSES.has(statusValue as OrganizationMembershipStatus)
        ? (statusValue as OrganizationMembershipStatus)
        : undefined
    if (statusValue && !status) return fail(c, 'validation-failed')
    const limit = parseLimit(c.req.query('limit'))
    if (!limit) return fail(c, 'validation-failed')
    const cursor = parseMembershipCursor(c.req.query('cursor'), status)
    if (cursor === null) return fail(c, 'validation-failed')

    try {
      const actor = await studioActor(c, sessions())
      if (actor instanceof Response) return actor
      const result = await organizations().listOrganizationMemberships(actor, {
        organizationId,
        ...(status ? { status } : {}),
        limit,
        ...(cursor ?? {}),
      })
      const last = result.items.at(-1)
      recordStudioOrganizationQuery('memberships', result.items.length === 0 ? 'empty' : 'listed')
      return c.json({
        data: result.items.map((membership) => ({
          membership_id: membership.membershipId,
          display_name: membership.displayName,
          status: membership.status,
          joined_at: membership.joinedAt.toISOString(),
          ended_at: membership.endedAt?.toISOString() ?? null,
          roles: membership.roles,
        })),
        page: {
          has_more: result.hasMore,
          next_cursor:
            result.hasMore && last
              ? encodeMembershipCursor(last.status, last.sortDisplayName, last.membershipId, status)
              : null,
        },
      })
    } catch (error) {
      recordStudioOrganizationQuery('memberships', 'failed')
      return operationFailure(c, error)
    }
  })

  routes.get('/organizations/:organizationId/roles', async (c) => {
    c.header('Cache-Control', ROLE_CATALOG_CACHE_CONTROL)
    if (c.req.header('origin') !== studioOrigin) {
      return fail(c, 'forbidden', 'origin is not allowed')
    }
    const organizationId = c.req.param('organizationId')
    if (!UUID.test(organizationId)) return fail(c, 'invalid-request')

    try {
      const actor = await studioActor(c, sessions())
      if (actor instanceof Response) return actor
      const items = await organizations().listRoleCatalog(actor, organizationId)
      const body = {
        items: items.map((role) => ({
          code: role.code,
          name: role.name,
          capabilities: role.capabilities,
          fitness_data_access_policy: role.fitnessDataAccessPolicy,
        })),
      }
      const etag = `"${createHash('sha256').update(JSON.stringify(body)).digest('base64url')}"`
      c.header('ETag', etag)
      if (c.req.header('if-none-match') === etag) {
        recordStudioOrganizationQuery('roles', 'not-modified')
        return c.body(null, 304)
      }
      recordStudioOrganizationQuery('roles', items.length === 0 ? 'empty' : 'listed')
      return c.json(body)
    } catch (error) {
      recordStudioOrganizationQuery('roles', 'failed')
      return operationFailure(c, error)
    }
  })

  routes.post('/organizations', async (c) => {
    c.header('Cache-Control', 'no-store')
    if (c.req.header('origin') !== studioOrigin) {
      return fail(c, 'forbidden', 'origin is not allowed')
    }
    const body = await readJson(c)
    if (!isOrganizationCreate(body)) return fail(c, 'invalid-request')
    const command = commandContext(c, body)
    if (!command) return fail(c, 'invalid-request', 'valid command headers are required')

    try {
      const actor = await studioActor(c, sessions())
      if (actor instanceof Response) return actor
      const organization = await organizations().create(actor, {
        displayName: body.display_name.trim(),
        typeCode: body.type_code,
        responsibleParty: {
          kind: body.responsible_party.kind,
          name: body.responsible_party.name.trim(),
        },
        ...command,
      })
      return c.json(
        {
          id: organization.id,
          display_name: organization.displayName,
          type_code: organization.typeCode,
          membership_id: organization.membershipId,
          roles: organization.roles,
        },
        201,
      )
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  return routes
}

function membershipPresentation(membership: {
  membershipId: string
  organizationId: string
  displayName: string
  typeCode: OrganizationTypeCode
  status: OrganizationMembershipStatus
  joinedAt: Date
  endedAt?: Date
  roles: Array<'owner' | 'admin' | 'coach' | 'staff'>
}) {
  return {
    membership_id: membership.membershipId,
    organization_id: membership.organizationId,
    display_name: membership.displayName,
    type_code: membership.typeCode,
    status: membership.status,
    joined_at: membership.joinedAt.toISOString(),
    ...(membership.endedAt ? { ended_at: membership.endedAt.toISOString() } : {}),
    roles: membership.roles,
  }
}

async function studioActor(c: Context, sessions: StudioSessionService) {
  const token = getCookie(c, STUDIO_SESSION_COOKIE)
  if (!token) return fail(c, 'unauthenticated', 'missing session cookie')
  try {
    return await sessions.resolveActor(token)
  } catch (error) {
    if (error instanceof StudioSessionError) return fail(c, error.code)
    throw error
  }
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

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return 50
  if (!/^[1-9][0-9]*$/.test(value)) return undefined
  const parsed = Number(value)
  return parsed <= 100 ? parsed : undefined
}

function parseMembershipCursor(
  value: string | undefined,
  filterStatus: OrganizationMembershipStatus | undefined,
):
  | {
      cursorStatus: OrganizationMembershipStatus
      cursorDisplayName: string
      cursorMembershipId: string
    }
  | undefined
  | null {
  if (!value) return undefined
  if (value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
    if (
      !isObject(parsed) ||
      parsed.v !== 1 ||
      parsed.filter_status !== (filterStatus ?? null) ||
      typeof parsed.status !== 'string' ||
      !MEMBERSHIP_STATUSES.has(parsed.status as OrganizationMembershipStatus) ||
      (filterStatus !== undefined && parsed.status !== filterStatus) ||
      typeof parsed.display_name !== 'string' ||
      parsed.display_name.length === 0 ||
      parsed.display_name.length > 240 ||
      typeof parsed.membership_id !== 'string' ||
      !UUID.test(parsed.membership_id)
    ) {
      return null
    }
    return {
      cursorStatus: parsed.status as OrganizationMembershipStatus,
      cursorDisplayName: parsed.display_name,
      cursorMembershipId: parsed.membership_id,
    }
  } catch {
    return null
  }
}

function encodeMembershipCursor(
  status: OrganizationMembershipStatus,
  displayName: string,
  membershipId: string,
  filterStatus: OrganizationMembershipStatus | undefined,
): string {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      filter_status: filterStatus ?? null,
      status,
      display_name: displayName,
      membership_id: membershipId,
    }),
  ).toString('base64url')
}

function isOrganizationCreate(value: unknown): value is OrganizationCreate {
  if (!isObject(value) || !isObject(value.responsible_party)) return false
  const typeCode = value.type_code
  const party = value.responsible_party
  return (
    Object.keys(value).sort().join(',') === 'display_name,responsible_party,type_code' &&
    Object.keys(party).sort().join(',') === 'kind,name' &&
    typeof value.display_name === 'string' &&
    value.display_name.trim().length > 0 &&
    value.display_name.length <= 120 &&
    typeof typeCode === 'string' &&
    ORGANIZATION_TYPES.has(typeCode as OrganizationTypeCode) &&
    (party.kind === 'natural_person' || party.kind === 'legal_entity') &&
    typeof party.name === 'string' &&
    party.name.trim().length > 0 &&
    party.name.length <= 160
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function operationFailure(c: Context, error: unknown) {
  if (error instanceof StudioSessionError || error instanceof StudioOrganizationError) {
    return fail(c, error.code)
  }
  const sqlState = isObject(error) && typeof error.code === 'string' ? error.code : undefined
  if (sqlState === '42501') return fail(c, 'forbidden')
  if (sqlState === '23505' || sqlState === '40001') return fail(c, 'conflict')
  if (sqlState === '22023' || sqlState === '23514' || sqlState === '22P02') {
    return fail(c, 'invalid-request')
  }
  console.error('[studio-organizations] operation failed')
  return fail(c, 'upstream-unavailable')
}
