/** Account-holder onboarding routes for the Studio surface. */

import { createHash } from 'node:crypto'
import type { AllfitV1Schemas } from '@allfitone/contracts'
import { Hono, type Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { cors } from 'hono/cors'

import { fail } from '../../../platform/http/index.js'
import {
  StudioSessionError,
  type StudioOnboardingService,
  type StudioSessionService,
} from '../application/index.js'
import {
  studioOnboardingService,
  studioSessionService,
  trustedStudioWebUrl,
} from '../dependencies.js'
import { STUDIO_SESSION_COOKIE } from './studio.js'

type Completion = AllfitV1Schemas['StudioOnboardingCompletion']
type EvidenceCreate = AllfitV1Schemas['AdultEligibilityEvidenceCreate']

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function studioOnboardingRoutes(
  injectedSessions?: StudioSessionService,
  injectedOnboarding?: StudioOnboardingService,
): Hono {
  const studioOrigin = new URL(trustedStudioWebUrl()).origin
  const sessions = () => injectedSessions ?? studioSessionService()
  const onboarding = () => injectedOnboarding ?? studioOnboardingService()
  const routes = new Hono()

  routes.use('*', corsPolicy(studioOrigin))
  routes.use('*', async (c, next) => {
    await next()
    c.header('Vary', 'Origin')
  })

  routes.post('/onboarding-attempts', async (c) => {
    c.header('Cache-Control', 'no-store')
    if (!hasTrustedOrigin(c, studioOrigin)) return fail(c, 'forbidden', 'origin is not allowed')
    const command = commandContext(c, {})
    if (!command) return fail(c, 'invalid-request', 'valid command headers are required')

    try {
      const actor = await authenticatedActor(c, sessions())
      if (actor instanceof Response) return actor
      const attempt = await onboarding().startAttempt(actor, command)
      return c.json({
        id: attempt.id,
        status: attempt.status,
        eligibility_status: attempt.eligibilityStatus,
        expires_at: attempt.expiresAt.toISOString(),
        terms_version: 'platform_terms_v1' as const,
        privacy_notice_version: 'privacy_notice_v1' as const,
      })
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.post('/onboarding-attempts/:attemptId/eligibility-evidence', async (c) => {
    c.header('Cache-Control', 'no-store')
    if (!hasTrustedOrigin(c, studioOrigin)) return fail(c, 'forbidden', 'origin is not allowed')
    const attemptId = c.req.param('attemptId')
    const body = await readJson(c)
    if (!UUID_V7.test(attemptId) || !isEvidenceCreate(body)) {
      return fail(c, 'invalid-request', 'adult declaration is required')
    }
    const command = commandContext(c, body)
    if (!command) return fail(c, 'invalid-request', 'valid command headers are required')

    try {
      const actor = await authenticatedActor(c, sessions())
      if (actor instanceof Response) return actor
      const evidence = await onboarding().recordAdultEligibility(actor, {
        attemptId,
        declaredAdult: body.declared_adult,
        ...command,
      })
      return c.json({
        result: evidence.result,
        evaluated_at: evidence.evaluatedAt.toISOString(),
        policy: {
          code: 'adult_eligibility' as const,
          version: 1 as const,
          minimum_age: 18 as const,
          jurisdiction: 'CO' as const,
          evidence_kind: 'self_declaration' as const,
        },
      })
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  routes.post('/onboarding-attempts/:attemptId/completion', async (c) => {
    c.header('Cache-Control', 'no-store')
    if (!hasTrustedOrigin(c, studioOrigin)) return fail(c, 'forbidden', 'origin is not allowed')
    const attemptId = c.req.param('attemptId')
    const body = await readJson(c)
    if (!UUID_V7.test(attemptId) || !isCompletion(body)) {
      return fail(c, 'invalid-request', 'complete identity and legal acceptances are required')
    }
    const command = commandContext(c, body)
    if (!command) return fail(c, 'invalid-request', 'valid command headers are required')

    try {
      const accountIdentity = await authenticatedAccountIdentity(c, sessions())
      if (accountIdentity instanceof Response) return accountIdentity
      const givenName = accountIdentity.identity.givenName ?? body.given_name?.trim()
      const familyName = accountIdentity.identity.familyName ?? body.family_name?.trim()
      if (!givenName || !familyName) {
        return fail(c, 'invalid-request', 'complete identity is required')
      }
      await onboarding().complete(accountIdentity.actor, {
        attemptId,
        givenName,
        familyName,
        termsAccepted: body.terms_accepted,
        privacyNoticeAccepted: body.privacy_notice_accepted,
        ...command,
      })
      return c.json({ registration_status: 'complete' as const })
    } catch (error) {
      return operationFailure(c, error)
    }
  })

  return routes
}

function corsPolicy(origin: string) {
  return cors({
    origin,
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Idempotency-Key', 'Command-Id', 'If-None-Match'],
  })
}

async function authenticatedActor(c: Context, sessions: StudioSessionService) {
  const token = getCookie(c, STUDIO_SESSION_COOKIE)
  if (!token) return fail(c, 'unauthenticated', 'missing session cookie')
  try {
    return await sessions.resolveActor(token)
  } catch (error) {
    if (error instanceof StudioSessionError) return fail(c, error.code)
    throw error
  }
}

async function authenticatedAccountIdentity(c: Context, sessions: StudioSessionService) {
  const token = getCookie(c, STUDIO_SESSION_COOKIE)
  if (!token) return fail(c, 'unauthenticated', 'missing session cookie')
  try {
    return await sessions.resolveAccountIdentity(token)
  } catch (error) {
    if (error instanceof StudioSessionError) return fail(c, error.code)
    throw error
  }
}

function hasTrustedOrigin(c: Context, expected: string): boolean {
  return c.req.header('origin') === expected
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

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return undefined
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function isEvidenceCreate(value: unknown): value is EvidenceCreate {
  return (
    isObject(value) && Object.keys(value).length === 1 && typeof value.declared_adult === 'boolean'
  )
}

function isCompletion(value: unknown): value is Completion {
  if (!isObject(value)) return false
  const allowedKeys = new Set([
    'given_name',
    'family_name',
    'terms_accepted',
    'privacy_notice_accepted',
  ])
  return (
    Object.keys(value).every((key) => allowedKeys.has(key)) &&
    validOptionalName(value.given_name) &&
    validOptionalName(value.family_name) &&
    value.terms_accepted === true &&
    value.privacy_notice_accepted === true
  )
}

function validOptionalName(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === 'string' && value.trim().length > 0 && value.length <= 100)
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function operationFailure(c: Context, error: unknown) {
  if (error instanceof StudioSessionError) return fail(c, error.code)
  const sqlState = isObject(error) && typeof error.code === 'string' ? error.code : undefined
  if (sqlState === '42501') return fail(c, 'forbidden')
  if (sqlState === '23505' || sqlState === '40001') return fail(c, 'conflict')
  if (sqlState === '22023' || sqlState === '23514' || sqlState === '22P02') {
    return fail(c, 'invalid-request')
  }
  console.error('[studio-onboarding] operation failed')
  return fail(c, 'upstream-unavailable')
}
