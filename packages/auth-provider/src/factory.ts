/**
 * Production construction.
 *
 * The only place the real SDK client is instantiated, which is why it lives here
 * and not in apps/api: boundary rule 1 forbids any app importing the provider
 * SDK.
 *
 * One client per Application, because each Application carries its own API key —
 * sharing one across surfaces fails the code exchange with `invalid_client`.
 *
 * Fails at startup rather than on the first request. A missing credential should
 * stop a deploy, not surface as a confusing 500 an hour later.
 */

import { WorkOS } from '@workos-inc/node'

import { AuthError } from './errors.js'
import type { AuthProvider, Surface } from './port.js'
import { createWorkOSAuthProvider, type SurfaceCredentials } from './adapters/workos.js'
import type { WorkOSClient, WorkOSUserManagement } from './adapters/workos-client.js'

/** Only what this package reads. Passing `process.env` satisfies it. */
export type ProviderEnv = Record<string, string | undefined>

export interface BackofficeAuthMaintenance {
  deleteAuthenticationFactor(factorId: string): Promise<void>
  revokeSession(sessionId: string): Promise<void>
}

/**
 * Worker-only delivery of the recovery support starts (`HU-BO-010`).
 *
 * The provider emails its single-use link itself. Only the link's expiry comes back: the
 * token and the URL the provider also returns never leave this package.
 */
export interface AccountRecoveryDelivery {
  sendRecovery(email: string): Promise<{ expiresAt: string }>
}

const SURFACES = ['space', 'studio', 'backoffice'] as const

const VAR_SUFFIX: Record<Surface, string> = {
  space: 'SPACE',
  studio: 'STUDIO',
  backoffice: 'BACKOFFICE',
}

export function createAuthProviderFromEnv(env: ProviderEnv = process.env): AuthProvider {
  const credentials = {} as Record<Surface, SurfaceCredentials>
  const clients = {} as Record<Surface, WorkOSClient>

  for (const surface of SURFACES) {
    const suffix = VAR_SUFFIX[surface]
    const entry: SurfaceCredentials = {
      clientId: required(env, `WORKOS_CLIENT_ID_${suffix}`),
      apiKey: required(env, `WORKOS_API_KEY_${suffix}`),
    }
    credentials[surface] = entry
    clients[surface] = new WorkOS({ apiKey: entry.apiKey })
  }

  return createWorkOSAuthProvider({
    credentials,
    // One issuer for the whole environment. It cannot be derived from the
    // client_ids above — the provider builds it from the environment's default
    // Application. The walking-skeleton callback reports the real value.
    issuer: required(env, 'WORKOS_ISSUER'),
    webhookSecret: required(env, 'WORKOS_WEBHOOK_SECRET'),
    clients,
  })
}

/** Narrow worker client: cleanup needs only the Backoffice Application API key. */
export function createBackofficeAuthMaintenanceFromEnv(
  env: ProviderEnv = process.env,
): BackofficeAuthMaintenance {
  const client = new WorkOS({ apiKey: required(env, 'WORKOS_API_KEY_BACKOFFICE') })
  return {
    async deleteAuthenticationFactor(factorId) {
      try {
        await client.multiFactorAuth.deleteFactor(factorId)
      } catch (error) {
        if (statusOf(error) !== 404) throw error
      }
    },
    async revokeSession(sessionId) {
      try {
        await client.userManagement.revokeSession({ sessionId })
      } catch (error) {
        if (statusOf(error) !== 404) throw error
      }
    },
  }
}

/**
 * Recovery goes out under Space's Application: the person recovers their Fitness ID, not
 * a professional or staff session. Every Application reaches the same directory, so the
 * new password works wherever the person signs in.
 */
export function createAccountRecoveryDeliveryFromEnv(
  env: ProviderEnv = process.env,
): AccountRecoveryDelivery {
  const client = new WorkOS({ apiKey: required(env, 'WORKOS_API_KEY_SPACE') })
  return createAccountRecoveryDelivery(client.userManagement)
}

export function createAccountRecoveryDelivery(
  userManagement: Pick<WorkOSUserManagement, 'createPasswordReset'>,
): AccountRecoveryDelivery {
  return {
    async sendRecovery(email) {
      let reset: unknown
      try {
        reset = await userManagement.createPasswordReset({ email })
      } catch (error) {
        throw recoveryFailure(error)
      }
      const expiresAt =
        typeof reset === 'object' && reset !== null && 'expiresAt' in reset
          ? reset.expiresAt
          : undefined
      if (typeof expiresAt !== 'string' || Number.isNaN(Date.parse(expiresAt))) {
        throw new AuthError('provider_unavailable', 'password reset without an expiry')
      }
      return { expiresAt }
    },
  }
}

/** An address the provider refuses stays refused on retry; anything else might pass. */
function recoveryFailure(error: unknown): AuthError {
  const status = statusOf(error)
  if (status === 400 || status === 404 || status === 422) {
    return new AuthError('invalid_email', `password reset refused with status ${status}`)
  }
  return new AuthError(
    'provider_unavailable',
    `password reset failed with status ${status ?? 'none'}`,
  )
}

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const candidate = error as { status?: unknown; statusCode?: unknown }
  const value = candidate.status ?? candidate.statusCode
  return typeof value === 'number' ? value : undefined
}

function required(env: ProviderEnv, name: string): string {
  const value = env[name]
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env.local and fill it in.`)
  }
  return value
}
