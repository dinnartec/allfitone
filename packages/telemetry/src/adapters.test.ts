import { describe, expect, test } from 'bun:test'

import type { TelemetryEvent } from './index.js'
import { createPostHogBrowserTelemetry } from './posthog-browser.js'
import { createPostHogServerTelemetry } from './posthog-node.js'
import { createPostHogOtlpLogs } from './posthog-otlp-logs.js'
import { createPostHogReactNativeTelemetry } from './posthog-react-native.js'

const event: TelemetryEvent = {
  event: 'worker.job.completed.v1',
  properties: {
    surface: 'system',
    service: 'allfit-worker',
    environment: 'development',
    release: 'test',
    platform: 'node',
    job: 'outbox_batch',
    outcome: 'completed',
    duration_ms: 1,
  },
}

describe('provider adapters', () => {
  test('remain no-ops when configuration is incomplete', async () => {
    const browser = createPostHogBrowserTelemetry({})
    const mobile = createPostHogReactNativeTelemetry({})
    const server = createPostHogServerTelemetry({})
    const logs = createPostHogOtlpLogs({ serviceName: 'allfit-worker' })

    expect(await browser.start('a1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBeFalse()
    expect(await mobile.start('a1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBeFalse()
    expect(() => server.capture(event)).not.toThrow()
    expect(() => logs.emit('failure', event)).not.toThrow()
    await expect(server.shutdown()).resolves.toBeUndefined()
    await expect(logs.shutdown()).resolves.toBeUndefined()
  })
})
