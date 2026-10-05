/**
 * Response envelope and error catalogue.
 *
 * Codes are stable strings, not statuses alone: clients branch on the code, and
 * a status says too little. The catalogue is closed so a new failure mode has to
 * be named here rather than invented at a call site.
 */

import { randomUUID } from 'node:crypto'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export type ApiErrorCode =
  /** Token absent, invalid or expired. */
  | 'unauthenticated'
  /** The token's client_id does not belong to this surface. */
  | 'wrong-surface'
  /** Malformed request: missing parameter, bad shape. */
  | 'invalid-request'
  /** A JSON command used a representation other than application/json. */
  | 'unsupported-media-type'
  /** A dependency we do not control did not answer. Retryable. */
  | 'upstream-unavailable'
  /** A locally controlled feature or delivery path is intentionally unavailable. */
  | 'service-degraded'
  /** Authenticated account has not completed domain registration. */
  | 'registration-incomplete'
  /** The linked domain person was closed. */
  | 'account-closed'
  /** Authenticated request is not allowed to perform this action. */
  | 'forbidden'
  /** The person has not accepted the consent this operation needs (ADR-041). */
  | 'consent-required'
  /** The chosen password was refused: too short, or known to be breached. */
  | 'weak-password'
  /** The command conflicts with durable state or a prior idempotent request. */
  | 'conflict'
  /** The write base revision is no longer current. */
  | 'stale-draft'
  /** A concurrency-controlled write omitted If-Match. */
  | 'precondition-required'
  /** Another transaction still owns the command or aggregate lock. */
  | 'idempotency-in-progress'
  /** A visible resource does not exist. */
  | 'not-found'
  /** A well-formed request violates a closed business schema. */
  | 'validation-failed'
  /** A closed application or database limit rejected the attempt. */
  | 'rate-limited'

const STATUS: Record<ApiErrorCode, ContentfulStatusCode> = {
  unauthenticated: 401,
  'wrong-surface': 403,
  'invalid-request': 400,
  'unsupported-media-type': 415,
  'upstream-unavailable': 503,
  'service-degraded': 503,
  'registration-incomplete': 403,
  'account-closed': 403,
  forbidden: 403,
  'consent-required': 403,
  'weak-password': 422,
  conflict: 409,
  'stale-draft': 409,
  'precondition-required': 428,
  'idempotency-in-progress': 409,
  'not-found': 404,
  'validation-failed': 422,
  'rate-limited': 429,
}

const TITLE: Record<ApiErrorCode, string> = {
  unauthenticated: 'Authentication is required',
  'wrong-surface': 'This credential cannot access this surface',
  'invalid-request': 'The request is invalid',
  'unsupported-media-type': 'Content-Type must be application/json',
  'upstream-unavailable': 'A required dependency is temporarily unavailable',
  'service-degraded': 'The service is temporarily degraded',
  'registration-incomplete': 'Registration must be completed first',
  'account-closed': 'The account is closed',
  forbidden: 'The actor cannot execute this operation',
  'consent-required': 'Consent is required first',
  'weak-password': 'The password does not satisfy the security policy',
  conflict: 'The request conflicts with current state',
  'stale-draft': 'The local draft is stale',
  'precondition-required': 'If-Match is required',
  'idempotency-in-progress': 'The command is still processing',
  'not-found': 'Resource not found',
  'validation-failed': 'The request does not satisfy the contract',
  'rate-limited': 'Too many requests',
}

/**
 * `detail` is for humans reading logs. It must never carry a token, a claim
 * value, or anything that reveals whether an account exists.
 */
export function fail(c: Context, code: ApiErrorCode, detail?: string) {
  return c.json({ error: { code, ...(detail ? { detail } : {}) } }, STATUS[code])
}

/** RFC 9457 response for contract-first endpoints migrating off the legacy envelope. */
export function problem(c: Context, code: ApiErrorCode, detail?: string) {
  return c.json(
    {
      type: `https://errors.allfit.invalid/${code}`,
      title: TITLE[code],
      status: STATUS[code],
      ...(detail ? { detail } : {}),
      request_id: randomUUID(),
    },
    STATUS[code],
    { 'Content-Type': 'application/problem+json' },
  )
}
