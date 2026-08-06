/**
 * Authentication middleware.
 *
 * Verifies the bearer token against the surface it was issued for and puts the
 * result in the request context. It does NOT resolve the subject to a person:
 * that reads `identity.access_accounts` inside the transaction, once the schema
 * exists.
 *
 * From the token only `sub` and `sid` survive — see the port. Authorization is
 * resolved in PostgreSQL, never read from a claim.
 */

import type { Context, MiddlewareHandler } from 'hono'
import {
  AuthError,
  createAuthProviderFromEnv,
  type AuthProvider,
  type Surface,
  type VerifiedToken,
} from '@allfitone/auth-provider'

import { fail } from '../http/index.js'

export type AuthVariables = { token: VerifiedToken }

// Built once, lazily: importing this module must not require credentials, or
// typecheck and tests would need a populated environment.
let cached: AuthProvider | undefined

export function authProvider(): AuthProvider {
  cached ??= createAuthProviderFromEnv()
  return cached
}

/** Test seam. Pass undefined to fall back to the environment. */
export function setAuthProvider(provider: AuthProvider | undefined): void {
  cached = provider
}

export function requireAuth(surface: Surface): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const token = bearerFrom(c)
    if (!token) return fail(c, 'unauthenticated', 'missing bearer token')

    try {
      c.set('token', await authProvider().verifyAccessToken(token, surface))
    } catch (error) {
      if (error instanceof AuthError && error.code === 'provider_unavailable') {
        // An unreachable provider is not the caller's fault, and answering
        // "unauthenticated" would send them to re-login for nothing.
        return fail(c, 'upstream-unavailable', 'identity provider unreachable')
      }
      // Everything else collapses into one answer. Distinguishing "expired" from
      // "issued for another surface" would tell an attacker which token they
      // are holding.
      return fail(c, 'unauthenticated', 'token rejected')
    }

    await next()
    return undefined
  }
}

function bearerFrom(c: Context): string | undefined {
  const header = c.req.header('authorization')
  if (!header) return undefined
  const [scheme, value] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !value) return undefined
  return value
}
