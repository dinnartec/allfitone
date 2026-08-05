/**
 * Production construction.
 *
 * This is the only place the real SDK client is instantiated, which is why it
 * lives here and not in apps/api: boundary rule 1 forbids any app importing the
 * provider SDK.
 *
 * Fails at startup rather than on the first request. A missing credential should
 * stop a deploy, not surface as a confusing 500 an hour later.
 */

import { WorkOS } from '@workos-inc/node'

import type { AuthProvider, Surface } from './port.js'
import { createWorkOSAuthProvider } from './adapters/workos.js'

/** Only what this package reads. Passing `process.env` satisfies it. */
export type ProviderEnv = Record<string, string | undefined>

const CLIENT_ID_VARS: Record<Surface, string> = {
  space: 'WORKOS_CLIENT_ID_SPACE',
  studio: 'WORKOS_CLIENT_ID_STUDIO',
  backoffice: 'WORKOS_CLIENT_ID_BACKOFFICE',
}

export function createAuthProviderFromEnv(env: ProviderEnv = process.env): AuthProvider {
  const apiKey = required(env, 'WORKOS_API_KEY')

  const clientIds = {
    space: required(env, CLIENT_ID_VARS.space),
    studio: required(env, CLIENT_ID_VARS.studio),
    backoffice: required(env, CLIENT_ID_VARS.backoffice),
  }

  // Three surfaces share one directory, so one client is correct: the client_id
  // travels per call rather than being fixed at construction.
  const workos = new WorkOS({ apiKey })

  return createWorkOSAuthProvider({
    apiKey,
    clientIds,
    // Unset until confirmed against a real token. See WorkOSConfig.issuer.
    ...(env.WORKOS_ISSUER ? { issuer: env.WORKOS_ISSUER } : {}),
    client: workos,
  })
}

function required(env: ProviderEnv, name: string): string {
  const value = env[name]
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.template to .env.local and fill it in.`)
  }
  return value
}
