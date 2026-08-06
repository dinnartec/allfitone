/**
 * Startup validation.
 *
 * A missing credential must stop a deploy, not surface as a confusing 500 an
 * hour later. Each variable is checked by name so the error says what to set.
 */

import { describe, expect, test } from 'bun:test'
import { createAuthProviderFromEnv } from './factory.js'

const COMPLETE = {
  WORKOS_CLIENT_ID_SPACE: 'client_space',
  WORKOS_CLIENT_ID_STUDIO: 'client_studio',
  WORKOS_CLIENT_ID_BACKOFFICE: 'client_backoffice',
  // One key per Application, not one shared key.
  WORKOS_API_KEY_SPACE: 'sk_space',
  WORKOS_API_KEY_STUDIO: 'sk_studio',
  WORKOS_API_KEY_BACKOFFICE: 'sk_backoffice',
  // One per environment, not per Application — the provider builds it from the
  // environment's default Application.
  WORKOS_ISSUER: 'https://api.workos.com/user_management/client_01DEFAULTAPP',
}

describe('createAuthProviderFromEnv', () => {
  test('constructs when every variable is present', () => {
    expect(() => createAuthProviderFromEnv(COMPLETE)).not.toThrow()
  })

  test('names the missing variable rather than failing vaguely', () => {
    for (const name of Object.keys(COMPLETE)) {
      const incomplete = { ...COMPLETE, [name]: undefined }
      expect(() => createAuthProviderFromEnv(incomplete)).toThrow(name)
    }
  })

  test('treats an empty string as missing', () => {
    // A .env.local copied from the template has empty values, which is the most
    // likely way this fails in practice.
    expect(() => createAuthProviderFromEnv({ ...COMPLETE, WORKOS_API_KEY_STUDIO: '' })).toThrow(
      'WORKOS_API_KEY_STUDIO',
    )
  })

  test('points at the example file so the fix is obvious', () => {
    expect(() => createAuthProviderFromEnv({})).toThrow(/\.env\.example/)
  })
})
