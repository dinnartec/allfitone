/**
 * WorkOS adapter.
 *
 * The ONLY file in the monorepo allowed to import `@workos-inc/*`. The rule is in
 * eslint.config.js and fails CI, not code review.
 *
 * STATUS: skeleton. Exact SDK signatures are unverified and must be confirmed
 * against current documentation before implementing — see AGENTS.md, "Never
 * invent an API". What is settled and must not change is the port shape and the
 * error normalization.
 *
 * Open questions:
 *   1. JWT verification against JWKS (`https://api.workos.com/sso/jwks/{clientId}`)
 *      with key caching. Fails closed.
 *   2. How the "this session satisfies AAL2" fact reaches the API. All Backoffice
 *      authorization depends on it.
 *   3. Refresh token rotation behaviour under concurrent requests.
 */

import type {
  AuthProvider,
  AuthResult,
  ExternalSubject,
  PasswordCredentials,
  SessionTokens,
  Surface,
  VerifiedToken,
} from '../port.js'
import { AuthError } from '../errors.js'

export interface WorkOSConfig {
  apiKey: string
  /** One client_id per Application. One environment, three applications, one directory. */
  clientIds: Record<Surface, string>
}

export function createWorkOSAuthProvider(config: WorkOSConfig): AuthProvider {
  assertConfig(config)

  // Throwing is honest. Returning plausible fake data would be a lie discovered
  // in production.
  const notImplemented = (method: string): never => {
    throw new AuthError('provider_unavailable', `workos.${method} not implemented`)
  }

  return {
    async authenticateWithPassword(
      _credentials: PasswordCredentials,
      _surface: Surface,
    ): Promise<AuthResult> {
      return notImplemented('authenticateWithPassword')
    },

    async authenticateWithCode(_code: string, _surface: Surface): Promise<AuthResult> {
      return notImplemented('authenticateWithCode')
    },

    async refresh(_refreshToken: string, _surface: Surface): Promise<SessionTokens> {
      return notImplemented('refresh')
    },

    async verifyAccessToken(_token: string, _surface: Surface): Promise<VerifiedToken> {
      return notImplemented('verifyAccessToken')
    },

    async updateEmail(_subject: ExternalSubject, _email: string): Promise<void> {
      return notImplemented('updateEmail')
    },

    async revokeSessions(_subject: ExternalSubject): Promise<void> {
      return notImplemented('revokeSessions')
    },
  }
}

function assertConfig(config: WorkOSConfig): void {
  if (!config.apiKey) {
    throw new Error('WORKOS_API_KEY missing. The API key never ships in a client bundle.')
  }
  for (const surface of ['space', 'studio', 'backoffice'] as const) {
    if (!config.clientIds[surface]) {
      throw new Error(`Missing client_id for surface "${surface}".`)
    }
  }
}
