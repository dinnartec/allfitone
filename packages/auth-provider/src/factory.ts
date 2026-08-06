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

import type { AuthProvider, Surface } from './port.js'
import { createWorkOSAuthProvider, type SurfaceCredentials } from './adapters/workos.js'
import type { WorkOSClient } from './adapters/workos-client.js'

/** Only what this package reads. Passing `process.env` satisfies it. */
export type ProviderEnv = Record<string, string | undefined>

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
    clients,
  })
}

function required(env: ProviderEnv, name: string): string {
  const value = env[name]
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env.local and fill it in.`)
  }
  return value
}
