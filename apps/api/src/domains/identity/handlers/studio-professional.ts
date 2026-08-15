/** Personal professional profile routes for the Studio surface. */

import { createHash, randomUUID } from 'node:crypto'
import type { AllfitV1Schemas } from '@allfitone/contracts'
import { Hono, type Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { cors } from 'hono/cors'

import { fail } from '../../../platform/http/index.js'
import {
  StudioProfessionalError,
  StudioSessionError,
  type StudioProfessionalService,
  type StudioSessionService,
} from '../application/index.js'
import {
  studioProfessionalService,
  studioSessionService,
  trustedStudioWebUrl,
} from '../dependencies.js'
import type {
  ProfessionalCredential,
  ProfessionalCredentialInput,
  ProfessionalProfile,
  ProfessionalProfileInput,
  StudioProfessionalContext,
} from '../domain/index.js'
import { STUDIO_SESSION_COOKIE } from './studio.js'

type ProfessionalProfilePut = AllfitV1Schemas['ProfessionalProfilePut']
type ProfessionalCredentialWrite = AllfitV1Schemas['ProfessionalCredentialWrite']

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CATALOG_CODE = /^[a-z][a-z0-9_]{1,63}$/

export function studioProfessionalRoutes(
  injectedSessions?: StudioSessionService,
  injectedProfessional?: StudioProfessionalService,
): Hono {
  const studioOrigin = new URL(trustedStudioWebUrl()).origin
  const sessions = () => injectedSessions ?? studioSessionService()
  const professional = () => injectedProfessional ?? studioProfessionalService()
  const routes = new Hono()

  routes.use(
    '*',
    cors({
      origin: studioOrigin,
      credentials: true,
      allowMethods: ['GET', 'PUT', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Idempotency-Key', 'Command-Id', 'If-None-Match'],
      exposeHeaders: ['ETag', 'Server-Timing'],
      maxAge: 600,
    }),
  )
  routes.use('*', async (c, next) => {
    await next()
    c.header('Vary', 'Origin')
  })

  routes.get('/me', async (c) => {
    c.header('Cache-Control', 'private, no-store')
    try {
      const actor = await studioActor(c, sessions())
      if (actor instanceof Response) return actor
      return c.json(contextResponse(await professional().getMe(actor, randomUUID())))
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.put('/me/professional-profile', async (c) => {
    c.header('Cache-Control', 'no-store')
    if (c.req.header('origin') !== studioOrigin) {
      return fail(c, 'forbidden', 'origin is not allowed')
    }
    const body = await readJson(c)
    if (!isProfessionalProfilePut(body)) return fail(c, 'validation-failed')
    const command = commandContext(c, body)
    if (!command) return fail(c, 'invalid-request', 'valid command headers are required')

    try {
      const actor = await studioActor(c, sessions())
      if (actor instanceof Response) return actor
      const result = await professional().putProfile(actor, {
        ...profileInput(body),
        ...command,
      })
      replayHeader(c, result.replayed)
      return c.json(profileResponse(result.resource))
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.post('/me/professional-credentials', async (c) => {
    c.header('Cache-Control', 'no-store')
    if (c.req.header('origin') !== studioOrigin) {
      return fail(c, 'forbidden', 'origin is not allowed')
    }
    const body = await readJson(c)
    if (!isProfessionalCredentialWrite(body)) return fail(c, 'validation-failed')
    const command = commandContext(c, body)
    if (!command) return fail(c, 'invalid-request', 'valid command headers are required')

    try {
      const actor = await studioActor(c, sessions())
      if (actor instanceof Response) return actor
      const result = await professional().declareCredential(actor, {
        ...credentialInput(body),
        ...command,
      })
      replayHeader(c, result.replayed)
      return c.json(credentialResponse(result.resource), 201)
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.post('/me/professional-credentials/:credentialId/revisions', async (c) => {
    c.header('Cache-Control', 'no-store')
    if (c.req.header('origin') !== studioOrigin) {
      return fail(c, 'forbidden', 'origin is not allowed')
    }
    const credentialId = c.req.param('credentialId')
    const body = await readJson(c)
    if (!UUID_V7.test(credentialId) || !isProfessionalCredentialWrite(body)) {
      return fail(c, 'validation-failed')
    }
    const command = commandContext(c, { credential_id: credentialId, body })
    if (!command) return fail(c, 'invalid-request', 'valid command headers are required')

    try {
      const actor = await studioActor(c, sessions())
      if (actor instanceof Response) return actor
      const result = await professional().reviseCredential(actor, credentialId, {
        ...credentialInput(body),
        ...command,
      })
      replayHeader(c, result.replayed)
      return c.json(credentialResponse(result.resource), 201)
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.post('/me/professional-credentials/:credentialId/retirement', async (c) => {
    c.header('Cache-Control', 'no-store')
    if (c.req.header('origin') !== studioOrigin) {
      return fail(c, 'forbidden', 'origin is not allowed')
    }
    const credentialId = c.req.param('credentialId')
    if (!UUID_V7.test(credentialId)) return fail(c, 'validation-failed')
    const command = commandContext(c, { credential_id: credentialId })
    if (!command) return fail(c, 'invalid-request', 'valid command headers are required')

    try {
      const actor = await studioActor(c, sessions())
      if (actor instanceof Response) return actor
      const result = await professional().retireCredential(actor, credentialId, command)
      replayHeader(c, result.replayed)
      return c.json(credentialResponse(result.resource))
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  return routes
}

async function studioActor(c: Context, sessions: StudioSessionService) {
  const token = getCookie(c, STUDIO_SESSION_COOKIE)
  if (!token) return fail(c, 'unauthenticated', 'missing session cookie')
  try {
    const actor = await sessions.resolveActor(token)
    return actor.personId ? actor : fail(c, 'registration-incomplete')
  } catch (error) {
    if (error instanceof StudioSessionError) return fail(c, error.code)
    throw error
  }
}

function profileInput(body: ProfessionalProfilePut): ProfessionalProfileInput {
  return {
    headline: body.headline.trim(),
    bio: body.bio.trim(),
    practiceStartedYear: body.practice_started_year,
    specialtyCodes: body.specialty_codes,
  }
}

function credentialInput(body: ProfessionalCredentialWrite): ProfessionalCredentialInput {
  return {
    credentialTypeCode: body.credential_type_code,
    issuer: body.issuer.trim(),
    name: body.name.trim(),
    identifier: body.identifier?.trim() ?? null,
    issuedOn: body.issued_on ?? null,
    expiresOn: body.expires_on ?? null,
    verificationUrl: body.verification_url ?? null,
  }
}

function contextResponse(context: StudioProfessionalContext) {
  return {
    profile: context.profile ? profileResponse(context.profile) : null,
    memberships: context.memberships.map((membership) => ({
      membership_id: membership.membershipId,
      organization_id: membership.organizationId,
      display_name: membership.displayName,
      type_code: membership.typeCode,
      status: membership.status,
      joined_at: membership.joinedAt.toISOString(),
      ended_at: membership.endedAt,
      roles: membership.roles,
    })),
  }
}

function profileResponse(profile: ProfessionalProfile) {
  return {
    id: profile.id,
    headline: profile.headline,
    bio: profile.bio,
    practice_started_year: profile.practiceStartedYear,
    experience_years: profile.experienceYears,
    specialties: profile.specialties,
    credentials: profile.credentials.map(credentialResponse),
    created_at: profile.createdAt.toISOString(),
    updated_at: profile.updatedAt.toISOString(),
  }
}

function credentialResponse(credential: ProfessionalCredential) {
  return {
    id: credential.id,
    credential_type_code: credential.credentialTypeCode,
    credential_type_name: credential.credentialTypeName,
    issuer: credential.issuer,
    name: credential.name,
    identifier: credential.identifier,
    issued_on: credential.issuedOn,
    expires_on: credential.expiresOn,
    verification_url: credential.verificationUrl,
    status: credential.status,
    supersedes_credential_id: credential.supersedesCredentialId,
    created_at: credential.createdAt.toISOString(),
    retired_at: credential.retiredAt?.toISOString() ?? null,
    verification: {
      state: credential.verification.state,
      valid_from: credential.verification.validFrom?.toISOString() ?? null,
      valid_to: credential.verification.validTo?.toISOString() ?? null,
      effective: credential.verification.effective,
    },
  }
}

function replayHeader(c: Context, replayed: boolean): void {
  if (replayed) c.header('Idempotent-Replay', 'true')
}

function commandContext(c: Context, hashMaterial: unknown) {
  const idempotencyKey = c.req.header('idempotency-key') ?? ''
  const commandId = c.req.header('command-id') ?? ''
  if (!UUID_V4.test(idempotencyKey) || !UUID_V7.test(commandId)) return undefined
  return {
    idempotencyKey,
    commandId,
    requestHash: createHash('sha256').update(canonicalJson(hashMaterial)).digest(),
  }
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return undefined
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

function isProfessionalProfilePut(value: unknown): value is ProfessionalProfilePut {
  if (!isObject(value)) return false
  const specialtyCodes = value.specialty_codes
  return (
    Object.keys(value).sort().join(',') === 'bio,headline,practice_started_year,specialty_codes' &&
    validText(value.headline, 120) &&
    validText(value.bio, 2000) &&
    Number.isInteger(value.practice_started_year) &&
    typeof value.practice_started_year === 'number' &&
    value.practice_started_year >= 1900 &&
    value.practice_started_year <= new Date().getUTCFullYear() &&
    Array.isArray(specialtyCodes) &&
    specialtyCodes.length > 0 &&
    specialtyCodes.length <= 50 &&
    specialtyCodes.every((code) => typeof code === 'string' && CATALOG_CODE.test(code)) &&
    new Set(specialtyCodes).size === specialtyCodes.length
  )
}

function isProfessionalCredentialWrite(value: unknown): value is ProfessionalCredentialWrite {
  if (!isObject(value)) return false
  const allowedKeys = new Set([
    'credential_type_code',
    'issuer',
    'name',
    'identifier',
    'issued_on',
    'expires_on',
    'verification_url',
  ])
  if (!Object.keys(value).every((key) => allowedKeys.has(key))) return false
  if (
    typeof value.credential_type_code !== 'string' ||
    !CATALOG_CODE.test(value.credential_type_code) ||
    !validText(value.issuer, 200) ||
    !validText(value.name, 200) ||
    !validNullableText(value.identifier, 160) ||
    !validNullableDate(value.issued_on) ||
    !validNullableDate(value.expires_on) ||
    !validNullableHttpsUrl(value.verification_url)
  ) {
    return false
  }
  return !(
    typeof value.issued_on === 'string' &&
    typeof value.expires_on === 'string' &&
    value.expires_on < value.issued_on
  )
}

function validText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum
}

function validNullableText(value: unknown, maximum: number): boolean {
  return value === undefined || value === null || validText(value, maximum)
}

function validNullableDate(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function validNullableHttpsUrl(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function operationFailure(c: Context, error: unknown) {
  if (error instanceof StudioSessionError || error instanceof StudioProfessionalError) {
    return fail(c, error.code)
  }
  const sqlState = isObject(error) && typeof error.code === 'string' ? error.code : undefined
  if (sqlState === '42501') return fail(c, 'forbidden')
  if (sqlState === 'P0002') return fail(c, 'not-found')
  if (sqlState === '23505' || sqlState === '40001') return fail(c, 'conflict')
  if (sqlState === '22023' || sqlState === '23514' || sqlState === '22P02') {
    return fail(c, 'validation-failed')
  }
  console.error('[studio-professional] operation failed')
  return fail(c, 'upstream-unavailable')
}
