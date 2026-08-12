/**
 * Response envelope and error catalogue.
 *
 * Codes are stable strings, not statuses alone: clients branch on the code, and
 * a status says too little. The catalogue is closed so a new failure mode has to
 * be named here rather than invented at a call site.
 */

import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export type ApiErrorCode =
  /** Token absent, invalid or expired. */
  | 'unauthenticated'
  /** The token's client_id does not belong to this surface. */
  | 'wrong-surface'
  /** Malformed request: missing parameter, bad shape. */
  | 'invalid-request'
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
  /** The chosen password was refused: too short, or known to be breached. */
  | 'weak-password'
  /** The command conflicts with durable state or a prior idempotent request. */
  | 'conflict'
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
  'upstream-unavailable': 503,
  'service-degraded': 503,
  'registration-incomplete': 403,
  'account-closed': 403,
  forbidden: 403,
  'weak-password': 422,
  conflict: 409,
  'not-found': 404,
  'validation-failed': 422,
  'rate-limited': 429,
}

/**
 * `detail` is for humans reading logs. It must never carry a token, a claim
 * value, or anything that reveals whether an account exists.
 */
export function fail(c: Context, code: ApiErrorCode, detail?: string) {
  return c.json({ error: { code, ...(detail ? { detail } : {}) } }, STATUS[code])
}
