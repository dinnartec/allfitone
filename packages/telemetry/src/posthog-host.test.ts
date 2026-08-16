import { describe, expect, test } from 'bun:test'

import { POSTHOG_US_INGESTION_HOST, postHogUsHost } from './posthog-host.js'

describe('PostHog US host policy', () => {
  test('accepts only the canonical US ingestion origin', () => {
    expect(postHogUsHost(POSTHOG_US_INGESTION_HOST)).toBe(POSTHOG_US_INGESTION_HOST)
    expect(postHogUsHost(`${POSTHOG_US_INGESTION_HOST}/`)).toBe(POSTHOG_US_INGESTION_HOST)
  })

  test('rejects other regions and non-origin URLs', () => {
    expect(postHogUsHost('https://eu.i.posthog.com')).toBeUndefined()
    expect(postHogUsHost('http://us.i.posthog.com')).toBeUndefined()
    expect(postHogUsHost('https://us.i.posthog.com/capture')).toBeUndefined()
    expect(postHogUsHost('https://us.i.posthog.com?redirect=example')).toBeUndefined()
    expect(postHogUsHost('https://us.i.posthog.com.example.com')).toBeUndefined()
  })
})
