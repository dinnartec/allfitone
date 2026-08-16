import { describe, expect, test } from 'bun:test'
import type { ExportResult } from '@opentelemetry/core'
import type { ReadableLogRecord } from '@opentelemetry/sdk-logs'

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

  test('rejects EU and malformed hosts before any provider transport runs', async () => {
    for (const host of [
      'https://eu.i.posthog.com',
      'http://us.i.posthog.com',
      'https://us.i.posthog.com/capture',
    ]) {
      let serverRequests = 0
      let logExporters = 0
      const browser = createPostHogBrowserTelemetry({ apiKey: 'phc_test', host })
      const mobile = createPostHogReactNativeTelemetry({ apiKey: 'phc_test', host })
      const server = createPostHogServerTelemetry({
        apiKey: 'phc_test',
        host,
        fetch: async () => {
          serverRequests += 1
          throw new Error('transport must not run')
        },
      })
      const logs = createPostHogOtlpLogs({
        apiKey: 'phc_test',
        host,
        serviceName: 'allfit-worker',
        exporterFactory: () => {
          logExporters += 1
          throw new Error('exporter must not be created')
        },
      })

      expect(await browser.start('a1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBeFalse()
      expect(await mobile.start('a1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBeFalse()
      server.capture(event)
      logs.emit('failure', event)
      expect(serverRequests).toBe(0)
      expect(logExporters).toBe(0)
      await server.shutdown()
      await logs.shutdown()
    }
  })

  test('delivers configured server events only to the canonical US host', async () => {
    const requests: string[] = []
    const scheduled: Promise<unknown>[] = []
    const server = createPostHogServerTelemetry({
      apiKey: 'phc_test',
      host: 'https://us.i.posthog.com',
      immediate: true,
      fetch: async (url) => {
        requests.push(url)
        return {
          status: 200,
          text: async () => '',
          json: async () => ({}),
        }
      },
      schedule: (work) => scheduled.push(work),
    })

    server.capture(event)
    await Promise.all(scheduled)

    expect(requests).toHaveLength(1)
    expect(requests[0]).toStartWith('https://us.i.posthog.com/')
    await server.shutdown()
  })

  test('builds the PostHog US OTLP endpoint and exports sanitized logs', async () => {
    const configurations: Array<{ url: string; headers: Record<string, string> }> = []
    const records: ReadableLogRecord[] = []
    const scheduled: Promise<unknown>[] = []
    const logs = createPostHogOtlpLogs({
      apiKey: 'phc_test',
      host: 'https://us.i.posthog.com',
      immediate: true,
      serviceName: 'allfit-worker',
      exporterFactory: (configuration) => {
        configurations.push(configuration)
        return {
          export(items, callback) {
            records.push(...items)
            callback({ code: 0 } as ExportResult)
          },
          forceFlush: async () => undefined,
          shutdown: async () => undefined,
        }
      },
      schedule: (work) => scheduled.push(work),
    })

    logs.emit('failure', event)
    await Promise.all(scheduled)

    expect(configurations).toEqual([
      {
        url: 'https://us.i.posthog.com/i/v1/logs',
        headers: { Authorization: 'Bearer phc_test' },
      },
    ])
    expect(records).toHaveLength(1)
    expect(records[0]?.attributes).not.toHaveProperty('email')
    await logs.shutdown()
  })
})
