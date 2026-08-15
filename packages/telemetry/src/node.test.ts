import { describe, expect, test } from 'bun:test'

import {
  analyticsIdentityForSurfaceFromEnvironment,
  analyticsIdentityFromEnvironment,
  deriveAnalyticsDistinctId,
} from './node.js'

const KEY = Buffer.alloc(32, 9).toString('base64')

describe('analytics pseudonyms', () => {
  test('is deterministic across surfaces without exposing the provider subject', () => {
    const first = deriveAnalyticsDistinctId('https://issuer.example.test', 'subject-secret', {
      activeVersion: 1,
      encodedKey: KEY,
    })
    const second = deriveAnalyticsDistinctId('https://issuer.example.test', 'subject-secret', {
      activeVersion: 1,
      encodedKey: KEY,
    })
    expect(first).toBe(second)
    expect(first).toMatch(/^a1_[A-Za-z0-9_-]{43}$/)
    expect(first).not.toContain('subject-secret')
  })

  test('separates environments and key versions', () => {
    const production = deriveAnalyticsDistinctId('issuer', 'subject', {
      activeVersion: 1,
      encodedKey: KEY,
    })
    const preview = deriveAnalyticsDistinctId('issuer', 'subject', {
      activeVersion: 1,
      encodedKey: Buffer.alloc(32, 10).toString('base64'),
    })
    const rotated = deriveAnalyticsDistinctId('issuer', 'subject', {
      activeVersion: 2,
      encodedKey: KEY,
    })
    expect(new Set([production, preview, rotated]).size).toBe(3)
  })

  test('fails closed to a null identity when configuration is absent or invalid', () => {
    expect(analyticsIdentityFromEnvironment('issuer', 'subject', {})).toEqual({ distinct_id: null })
    expect(
      analyticsIdentityFromEnvironment('issuer', 'subject', {
        ANALYTICS_PSEUDONYM_ACTIVE_VERSION: '1',
        ANALYTICS_PSEUDONYM_KEY_V1: 'invalid',
      }),
    ).toEqual({ distinct_id: null })
  })

  test('returns no client identity while its surface gate is disabled', () => {
    const environment = {
      ANALYTICS_PSEUDONYM_ACTIVE_VERSION: '1',
      ANALYTICS_PSEUDONYM_KEY_V1: KEY,
      ANALYTICS_STUDIO_CLIENT_ENABLED: 'false',
    }

    expect(
      analyticsIdentityForSurfaceFromEnvironment('studio', 'issuer', 'subject', environment),
    ).toEqual({ distinct_id: null })

    environment.ANALYTICS_STUDIO_CLIENT_ENABLED = 'true'
    expect(
      analyticsIdentityForSurfaceFromEnvironment('studio', 'issuer', 'subject', environment)
        .distinct_id,
    ).toMatch(/^a1_[A-Za-z0-9_-]{43}$/)
  })
})
