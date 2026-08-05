/**
 * Startup validation.
 *
 * A missing credential must stop a deploy, not surface as a confusing 500 an
 * hour later. Each variable is checked by name so the error says what to set.
 */

import { describe, expect, test } from 'bun:test'
import { createAuthProviderFromEnv } from './factory.js'

const COMPLETE = {
  WORKOS_API_KEY: 'sk_test',
  WORKOS_CLIENT_ID_SPACE: 'client_space',
  WORKOS_CLIENT_ID_STUDIO: 'client_studio',
  WORKOS_CLIENT_ID_BACKOFFICE: 'client_backoffice',
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
    expect(() => createAuthProviderFromEnv({ ...COMPLETE, WORKOS_API_KEY: '' })).toThrow(
      'WORKOS_API_KEY',
    )
  })

  test('points at the template so the fix is obvious', () => {
    expect(() => createAuthProviderFromEnv({})).toThrow(/\.env\.template/)
  })
})
