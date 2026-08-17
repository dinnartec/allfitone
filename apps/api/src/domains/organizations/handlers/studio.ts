/** Organization onboarding routes for Studio. */

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
import { fail, problem, type ApiErrorCode } from '../../../platform/http/index.js'
import {
  recordStudioMembershipDestination,
  recordStudioOrganizationQuery,
} from '../../../platform/observability/index.js'
import { StudioOrganizationError, type StudioOrganizationService } from '../application/index.js'
import { studioOrganizationService } from '../dependencies.js'
import type {
  OrganizationMembershipStatus,
  OrganizationRoleCode,
  OrganizationSiteStatus,
  OrganizationTypeCode,
} from '../domain/index.js'

type OrganizationCreate = AllfitV1Schemas['OrganizationCreate']
type OrganizationUpdate = AllfitV1Schemas['OrganizationUpdate']
type OrganizationSiteCreate = AllfitV1Schemas['OrganizationSiteCreate']
type OrganizationSiteUpdate = AllfitV1Schemas['OrganizationSiteUpdate']
type OrganizationOwnershipTransferCreate = AllfitV1Schemas['OrganizationOwnershipTransferCreate']
type OrganizationRoleGrantCreate = AllfitV1Schemas['OrganizationRoleGrantCreate']

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ORGANIZATION_TYPES = new Set<OrganizationTypeCode>(['professional_practice', 'gym', 'studio'])
const MEMBERSHIP_STATUSES = new Set<OrganizationMembershipStatus>(['active', 'terminated'])
const SITE_STATUSES = new Set<OrganizationSiteStatus>(['active', 'inactive'])
const ASSIGNABLE_ROLES = new Set<Exclude<OrganizationRoleCode, 'owner'>>([
  'admin',
  'coach',
  'staff',
])
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
      allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Idempotency-Key', 'Command-Id', 'If-Match', 'If-None-Match'],
      exposeHeaders: ['ETag', 'Server-Timing', 'Retry-After', 'Idempotent-Replay'],
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
        analytics: context.analytics ?? { distinct_id: null },
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

  routes.get('/organizations/:organizationId', async (c) => {
    c.header('Cache-Control', 'private, no-store')
    if (c.req.header('origin') !== studioOrigin) {
      return problem(c, 'forbidden')
    }
    const organizationId = c.req.param('organizationId')
    if (!UUID.test(organizationId)) return problem(c, 'invalid-request')

    try {
      const actor = await studioActor(c, sessions(), problem)
      if (actor instanceof Response) return actor
      const organization = await organizations().get(actor, organizationId, randomUUID())
      c.header('ETag', organizationEtag(organization.id, organization.revisionNumber))
      return c.json(organizationPresentation(organization))
    } catch (error) {
      return operationFailure(c, error, problem)
    }
  })

  routes.patch('/organizations/:organizationId', async (c) => {
    c.header('Cache-Control', 'no-store')
    if (c.req.header('origin') !== studioOrigin) {
      return problem(c, 'forbidden')
    }
    const organizationId = c.req.param('organizationId')
    if (!UUID.test(organizationId)) return problem(c, 'invalid-request')
    const revision = expectedRevision(c.req.header('if-match'), 'organization', organizationId)
    if (revision === undefined) return problem(c, 'precondition-required')
    if (revision === null) return problem(c, 'invalid-request')
    const body = await readJson(c)
    if (!isOrganizationUpdate(body)) return problem(c, 'invalid-request')
    const command = commandContext(c, { organization_id: organizationId, body, revision })
    if (!command) return problem(c, 'invalid-request')

    try {
      const actor = await studioActor(c, sessions(), problem)
      if (actor instanceof Response) return actor
      const result = await organizations().update(actor, {
        organizationId,
        expectedRevision: revision,
        patch: {
          ...(body.display_name !== undefined ? { displayName: body.display_name.trim() } : {}),
          ...(body.legal_name !== undefined
            ? { legalName: body.legal_name === null ? null : body.legal_name.trim() }
            : {}),
          ...(body.type_code !== undefined ? { typeCode: body.type_code } : {}),
        },
        ...command,
      })
      const organization = result.resource
      replayHeader(c, result.replayed)
      c.header('ETag', organizationEtag(organization.id, organization.revisionNumber))
      return c.json(organizationPresentation(organization))
    } catch (error) {
      return operationFailure(c, error, problem)
    }
  })

  routes.post('/organizations/:organizationId/sites', async (c) => {
    c.header('Cache-Control', 'no-store')
    if (c.req.header('origin') !== studioOrigin) {
      return problem(c, 'forbidden')
    }
    const organizationId = c.req.param('organizationId')
    if (!UUID.test(organizationId)) return problem(c, 'invalid-request')
    const body = await readJson(c)
    if (!isOrganizationSiteCreate(body)) return problem(c, 'invalid-request')
    const command = commandContext(c, { organization_id: organizationId, body })
    if (!command) return problem(c, 'invalid-request')

    try {
      const actor = await studioActor(c, sessions(), problem)
      if (actor instanceof Response) return actor
      const result = await organizations().createSite(actor, {
        organizationId,
        site: {
          name: body.name.trim(),
          ...(body.address !== undefined
            ? { address: body.address === null ? null : body.address.trim() }
            : {}),
        },
        ...command,
      })
      const site = result.resource
      replayHeader(c, result.replayed)
      c.header('ETag', organizationSiteEtag(site.id, site.revisionNumber))
      return c.json(sitePresentation(site), 201)
    } catch (error) {
      return operationFailure(c, error, problem)
    }
  })

  routes.patch('/organizations/:organizationId/sites/:siteId', async (c) => {
    c.header('Cache-Control', 'no-store')
    if (c.req.header('origin') !== studioOrigin) {
      return problem(c, 'forbidden')
    }
    const organizationId = c.req.param('organizationId')
    const siteId = c.req.param('siteId')
    if (!UUID.test(organizationId) || !UUID.test(siteId)) return problem(c, 'invalid-request')
    const revision = expectedRevision(c.req.header('if-match'), 'organization-site', siteId)
    if (revision === undefined) return problem(c, 'precondition-required')
    if (revision === null) return problem(c, 'invalid-request')
    const body = await readJson(c)
    if (!isOrganizationSiteUpdate(body)) return problem(c, 'invalid-request')
    const command = commandContext(c, {
      organization_id: organizationId,
      site_id: siteId,
      body,
      revision,
    })
    if (!command) return problem(c, 'invalid-request')

    try {
      const actor = await studioActor(c, sessions(), problem)
      if (actor instanceof Response) return actor
      const result = await organizations().updateSite(actor, {
        organizationId,
        siteId,
        expectedRevision: revision,
        patch: {
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.address !== undefined
            ? { address: body.address === null ? null : body.address.trim() }
            : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
        },
        ...command,
      })
      const site = result.resource
      replayHeader(c, result.replayed)
      c.header('ETag', organizationSiteEtag(site.id, site.revisionNumber))
      return c.json(sitePresentation(site))
    } catch (error) {
      return operationFailure(c, error, problem)
    }
  })

  routes.post('/organizations/:organizationId/ownership-transfers', async (c) => {
    c.header('Cache-Control', 'no-store')
    if (c.req.header('origin') !== studioOrigin) {
      return problem(c, 'forbidden')
    }
    const organizationId = c.req.param('organizationId')
    if (!UUID.test(organizationId)) return problem(c, 'invalid-request')
    const body = await readJson(c)
    if (!isOwnershipTransferCreate(body)) return problem(c, 'invalid-request')
    const command = commandContext(c, { organization_id: organizationId, body })
    if (!command) return problem(c, 'invalid-request')

    try {
      const actor = await studioActor(c, sessions(), problem)
      if (actor instanceof Response) return actor
      const result = await organizations().transferOwnership(actor, {
        organizationId,
        targetMembershipId: body.target_membership_id,
        ...command,
      })
      const transfer = result.resource
      replayHeader(c, result.replayed)
      return c.json({
        organization_id: transfer.organizationId,
        owner_membership_id: transfer.ownerMembershipId,
        previous_owner_membership_id: transfer.previousOwnerMembershipId,
        transferred_at: transfer.transferredAt,
      })
    } catch (error) {
      return operationFailure(c, error, problem)
    }
  })

  routes.post('/organizations/:organizationId/memberships/:membershipId/roles', async (c) => {
    c.header('Cache-Control', 'no-store')
    if (c.req.header('origin') !== studioOrigin) {
      return problem(c, 'forbidden')
    }
    const organizationId = c.req.param('organizationId')
    const membershipId = c.req.param('membershipId')
    if (!UUID.test(organizationId) || !UUID.test(membershipId)) {
      return problem(c, 'invalid-request')
    }
    const body = await readJson(c)
    if (!isRoleGrantCreate(body)) return problem(c, 'invalid-request')
    const command = commandContext(c, {
      organization_id: organizationId,
      membership_id: membershipId,
      body,
    })
    if (!command) return problem(c, 'invalid-request')

    try {
      const actor = await studioActor(c, sessions(), problem)
      if (actor instanceof Response) return actor
      const result = await organizations().grantMembershipRole(actor, {
        organizationId,
        membershipId,
        roleCode: body.role_code,
        ...command,
      })
      const grant = result.resource
      replayHeader(c, result.replayed)
      return c.json({
        membership_id: grant.membershipId,
        role_code: grant.roleCode,
        valid_from: grant.validFrom,
      })
    } catch (error) {
      return operationFailure(c, error, problem)
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

function organizationPresentation(organization: {
  id: string
  displayName: string
  legalName: string | null
  typeCode: OrganizationTypeCode
  status: 'active' | 'closed'
  revisionNumber: number
  sites: Array<{
    id: string
    name: string
    address: string | null
    status: OrganizationSiteStatus
    revisionNumber: number
  }>
}) {
  return {
    id: organization.id,
    display_name: organization.displayName,
    legal_name: organization.legalName,
    type_code: organization.typeCode,
    status: organization.status,
    revision_number: organization.revisionNumber,
    sites: organization.sites.map(sitePresentation),
  }
}

function sitePresentation(site: {
  id: string
  name: string
  address: string | null
  status: OrganizationSiteStatus
  revisionNumber: number
}) {
  return {
    id: site.id,
    name: site.name,
    address: site.address,
    status: site.status,
    revision_number: site.revisionNumber,
  }
}

function organizationEtag(organizationId: string, revision: number): string {
  return `"organization:${organizationId}:r${revision}"`
}

function organizationSiteEtag(siteId: string, revision: number): string {
  return `"organization-site:${siteId}:r${revision}"`
}

function expectedRevision(
  value: string | undefined,
  resource: 'organization' | 'organization-site',
  id: string,
): number | undefined | null {
  if (value === undefined) return undefined
  const match = new RegExp(`^"${resource}:${id}:r(0|[1-9][0-9]*)"$`, 'i').exec(value)
  if (!match) return null
  const revision = Number(match[1])
  return Number.isSafeInteger(revision) ? revision : null
}

type FailureResponder = (c: Context, code: ApiErrorCode, detail?: string) => Response

async function studioActor(
  c: Context,
  sessions: StudioSessionService,
  respond: FailureResponder = fail,
) {
  const token = getCookie(c, STUDIO_SESSION_COOKIE)
  if (!token) return respond(c, 'unauthenticated')
  try {
    return await sessions.resolveActor(token)
  } catch (error) {
    if (error instanceof StudioSessionError) return respond(c, error.code)
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

function isOrganizationUpdate(value: unknown): value is OrganizationUpdate {
  if (!isObject(value)) return false
  const keys = Object.keys(value)
  if (
    keys.length === 0 ||
    keys.some((key) => !['display_name', 'legal_name', 'type_code'].includes(key))
  ) {
    return false
  }
  return (
    (value.display_name === undefined ||
      (typeof value.display_name === 'string' &&
        value.display_name.trim().length > 0 &&
        value.display_name.length <= 120)) &&
    (value.legal_name === undefined ||
      value.legal_name === null ||
      (typeof value.legal_name === 'string' && value.legal_name.trim().length > 0)) &&
    (value.type_code === undefined ||
      (typeof value.type_code === 'string' &&
        ORGANIZATION_TYPES.has(value.type_code as OrganizationTypeCode)))
  )
}

function isOrganizationSiteCreate(value: unknown): value is OrganizationSiteCreate {
  if (!isObject(value) || Object.keys(value).some((key) => !['name', 'address'].includes(key))) {
    return false
  }
  return (
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    (value.address === undefined ||
      value.address === null ||
      (typeof value.address === 'string' && value.address.trim().length > 0))
  )
}

function isOrganizationSiteUpdate(value: unknown): value is OrganizationSiteUpdate {
  if (!isObject(value)) return false
  const keys = Object.keys(value)
  if (keys.length === 0 || keys.some((key) => !['name', 'address', 'status'].includes(key))) {
    return false
  }
  return (
    (value.name === undefined ||
      (typeof value.name === 'string' && value.name.trim().length > 0)) &&
    (value.address === undefined ||
      value.address === null ||
      (typeof value.address === 'string' && value.address.trim().length > 0)) &&
    (value.status === undefined ||
      (typeof value.status === 'string' &&
        SITE_STATUSES.has(value.status as OrganizationSiteStatus)))
  )
}

function isOwnershipTransferCreate(value: unknown): value is OrganizationOwnershipTransferCreate {
  return (
    isObject(value) &&
    Object.keys(value).join(',') === 'target_membership_id' &&
    typeof value.target_membership_id === 'string' &&
    UUID.test(value.target_membership_id)
  )
}

function isRoleGrantCreate(value: unknown): value is OrganizationRoleGrantCreate {
  return (
    isObject(value) &&
    Object.keys(value).join(',') === 'role_code' &&
    typeof value.role_code === 'string' &&
    ASSIGNABLE_ROLES.has(value.role_code as Exclude<OrganizationRoleCode, 'owner'>)
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function replayHeader(c: Context, replayed: boolean): void {
  if (replayed) c.header('Idempotent-Replay', 'true')
}

function operationFailure(c: Context, error: unknown, respond: FailureResponder = fail) {
  if (error instanceof StudioSessionError || error instanceof StudioOrganizationError) {
    return respond(c, error.code)
  }
  const sqlState = isObject(error) && typeof error.code === 'string' ? error.code : undefined
  const message = isObject(error) && typeof error.message === 'string' ? error.message : undefined
  if (sqlState === '42501') return respond(c, 'forbidden')
  if (sqlState === 'P0002') return respond(c, 'not-found')
  if (sqlState === '40001' && message?.includes('stale-draft')) return respond(c, 'stale-draft')
  if (sqlState === '55P03') {
    c.header('Retry-After', '1')
    return respond(c, 'idempotency-in-progress')
  }
  if (sqlState === '23505' || sqlState === '40001') return respond(c, 'conflict')
  if (sqlState === '22023' || sqlState === '23514') {
    return respond(c, 'validation-failed')
  }
  if (sqlState === '22P02') return respond(c, 'invalid-request')
  console.error('[studio-organizations] operation failed')
  return respond(c, 'upstream-unavailable')
}
