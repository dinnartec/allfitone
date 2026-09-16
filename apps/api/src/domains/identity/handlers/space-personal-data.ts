/**
 * What every Space route over a person's own sensitive data does the same way.
 *
 * Body progress and health context differ in what they carry, not in how a request is
 * trusted: a bearer token verified for Space, command identifiers of fixed versions, a
 * request hash over a canonical form, and one mapping from database verdicts to problems.
 * Keeping that in one place means a fix to the trust boundary cannot land in one of them
 * and miss the other.
 */

import { createHash } from 'node:crypto'
import type { VerifiedToken } from '@allfitone/auth-provider'
import type { Context } from 'hono'

import { authProvider } from '../../../platform/auth/index.js'
import { problem, type ApiErrorCode } from '../../../platform/http/index.js'

export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/

export const DEFAULT_PAGE_SIZE = 50

export type TokenVerifier = (token: string) => Promise<VerifiedToken>

export interface SpaceCommand {
  idempotencyKey: string
  commandId: string
  requestHash: Uint8Array
}

export function spaceTokenVerifier(): TokenVerifier {
  return (token) => authProvider().verifyAccessToken(token, 'space')
}

export async function verifiedSpaceToken(
  c: Context,
  verify: TokenVerifier,
): Promise<VerifiedToken | undefined> {
  const [scheme, value] = c.req.header('authorization')?.split(' ') ?? []
  if (scheme?.toLowerCase() !== 'bearer' || !value) return undefined
  try {
    return await verify(value)
  } catch {
    // One answer for expired, malformed and issued-for-another-surface.
    return undefined
  }
}

export function isJsonRequest(c: Context): boolean {
  return c.req.header('content-type')?.trim().toLowerCase() === 'application/json'
}

export async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json<unknown>()
  } catch {
    return undefined
  }
}

/** A plain object with every required key and nothing outside the allowed ones. */
export function exactObject(
  body: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  const fields = body as Record<string, unknown>
  const allowed = new Set([...required, ...optional])
  if (Object.keys(fields).some((key) => !allowed.has(key))) return undefined
  if (!required.every((key) => key in fields)) return undefined
  return fields
}

export function isCalendarDate(value: string): boolean {
  if (!DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function isInstant(value: string): boolean {
  return INSTANT.test(value) && !Number.isNaN(Date.parse(value))
}

/** The page size, or undefined when the query names one outside 1..maximum. */
export function pageSize(value: string | undefined, maximum: number): number | undefined {
  const limit = value === undefined ? DEFAULT_PAGE_SIZE : Number(value)
  return Number.isInteger(limit) && limit >= 1 && limit <= maximum ? limit : undefined
}

export function onlyQueryKeys(c: Context, allowed: ReadonlySet<string>): boolean {
  return Object.keys(c.req.query()).every((key) => allowed.has(key))
}

export function spaceCommand(c: Context, resource: unknown): SpaceCommand | undefined {
  const idempotencyKey = c.req.header('idempotency-key') ?? ''
  const commandId = c.req.header('command-id') ?? ''
  if (!UUID_V4.test(idempotencyKey) || !UUID_V7.test(commandId)) return undefined
  return {
    idempotencyKey,
    commandId,
    requestHash: createHash('sha256')
      .update(
        JSON.stringify(
          canonicalJson({ method: c.req.method.toUpperCase(), path: c.req.path, resource }),
        ),
      )
      .digest(),
  }
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalJson(child)]),
  )
}

export function spaceFailure(c: Context, error: unknown, operation: string) {
  const code = databaseErrorCode(error)
  if (code === 'idempotency-in-progress') c.header('Retry-After', '1')
  if (code) return problem(c, code)
  console.error(`[${operation}] operation failed`)
  return problem(c, 'upstream-unavailable')
}

function databaseErrorCode(error: unknown): ApiErrorCode | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const sqlState = 'code' in error && typeof error.code === 'string' ? error.code : undefined
  // Someone else's record and one that does not exist answer the same.
  if (sqlState === 'P0002') return 'not-found'
  // A token that resolves to no active person.
  if (sqlState === '42501') return 'forbidden'
  if (sqlState === '22023' || sqlState === '22P02' || sqlState === '23503') {
    return 'validation-failed'
  }
  if (sqlState === '23505' || sqlState === '55000' || sqlState === '23514') return 'conflict'
  if (sqlState === '40001') return 'idempotency-in-progress'
  return undefined
}
