import { describe, expect, test } from 'bun:test'

import { sanitizeTelemetryEvent, sanitizeTelemetryProviderEvent } from './index.js'

const common = {
  surface: 'studio',
  service: 'studio-web',
  environment: 'production',
  release: '5d9ac2a',
  platform: 'web',
} as const

describe('closed telemetry events', () => {
  test('accepts and detaches an allowlisted event', () => {
    const source = {
      event: 'client.api_request.completed.v1',
      properties: {
        ...common,
        operation: 'studio.entry_context',
        method: 'GET',
        outcome: 'success',
        status_group: '2xx',
        duration_ms: 221.4,
        server_duration_ms: 180.2,
        network_overhead_ms: 41.2,
        external_dependency: 'none',
      },
    } as const

    const sanitized = sanitizeTelemetryEvent(source)
    expect(sanitized).toEqual(source)
    expect(sanitized).not.toBe(source)
  })

  test('rejects identifiers, free text and response content', () => {
    for (const forbidden of ['email', 'person_id', 'organization_id', 'url', 'body']) {
      expect(
        sanitizeTelemetryEvent({
          event: 'client.screen.viewed.v1',
          properties: { ...common, screen: 'studio.entry', [forbidden]: 'private' },
        }),
      ).toBeUndefined()
    }
  })

  test('removes URL, device, library and person enrichment added by an SDK', () => {
    const sanitized = sanitizeTelemetryProviderEvent({
      event: 'client.screen.viewed.v1',
      properties: {
        ...common,
        screen: 'studio.entry',
        $current_url: 'https://studio.example.test/organizations/secret',
        $device_id: 'device-secret',
        $lib: 'web',
        $set: { email: 'forbidden@example.test' },
      },
    })

    expect(sanitized).toEqual({
      event: 'client.screen.viewed.v1',
      properties: { ...common, screen: 'studio.entry' },
    })
    expect(JSON.stringify(sanitized)).not.toContain('secret')
    expect(JSON.stringify(sanitized)).not.toContain('example.test')
  })

  test('drops automatic and unknown provider events', () => {
    expect(
      sanitizeTelemetryProviderEvent({ event: '$pageview', properties: common }),
    ).toBeUndefined()
    expect(
      sanitizeTelemetryProviderEvent({ event: '$identify', properties: common }),
    ).toBeUndefined()
  })

  test('rejects concrete routes while accepting Hono route templates', () => {
    const server = {
      surface: 'studio',
      service: 'allfit-api',
      environment: 'production',
      release: '5d9ac2a',
      platform: 'node',
      method: 'GET',
      status: 200,
      outcome: 'success',
      duration_ms: 200,
      external_dependency: 'none',
      region: 'pdx1',
    }
    expect(
      sanitizeTelemetryEvent({
        event: 'server.http_request.completed.v1',
        properties: { ...server, operation: '/studio/v1/organizations/:organizationId' },
      }),
    ).toBeDefined()
    expect(
      sanitizeTelemetryEvent({
        event: 'server.http_request.completed.v1',
        properties: {
          ...server,
          operation: '/studio/v1/organizations/0199c000-0000-7000-8000-000000000099',
        },
      }),
    ).toBeUndefined()
  })
})
