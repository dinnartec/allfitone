import { PostHog, type PostHogOptions } from 'posthog-node'

import {
  sanitizeTelemetryEvent,
  sanitizeTelemetryProviderEvent,
  type TelemetryEvent,
} from './index.js'
import { postHogUsHost } from './posthog-host.js'

export interface ServerTelemetryAdapter {
  capture(event: TelemetryEvent): void
  shutdown(): Promise<void>
}

export interface ServerTelemetryOptions {
  apiKey?: string
  fetch?: PostHogOptions['fetch']
  host?: string
  schedule?: (work: Promise<unknown>) => void
  immediate?: boolean
}

const ANONYMOUS_SERVER_DISTINCT_ID = 'allfitone_server_aggregate'

/**
 * PostHog adapter for aggregate server events. It never creates profiles and
 * absorbs every provider error so telemetry cannot affect application work.
 */
export function createPostHogServerTelemetry(
  options: ServerTelemetryOptions,
): ServerTelemetryAdapter {
  const host = postHogUsHost(options.host)
  if (!options.apiKey || !host) return disabledAdapter()

  let client: PostHog
  try {
    client = new PostHog(options.apiKey, {
      host,
      disableGeoip: true,
      flushAt: options.immediate ? 1 : 20,
      flushInterval: options.immediate ? 0 : 10_000,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      before_send: (message) => {
        const sanitized = sanitizeTelemetryProviderEvent({
          event: message?.event,
          properties: message?.properties,
        })
        if (!message || !sanitized) return null
        return {
          ...message,
          event: sanitized.event,
          properties: { ...sanitized.properties, $process_person_profile: false },
        }
      },
    })
  } catch {
    return disabledAdapter()
  }

  return {
    capture(event) {
      const sanitized = sanitizeTelemetryEvent(event)
      if (!sanitized) return
      const message = {
        distinctId: ANONYMOUS_SERVER_DISTINCT_ID,
        event: sanitized.event,
        properties: { ...sanitized.properties, $process_person_profile: false },
        disableGeoip: true,
        sendFeatureFlags: false,
      }
      if (options.immediate) {
        try {
          const work = client.captureImmediate(message).catch(() => undefined)
          if (options.schedule) {
            try {
              options.schedule(work)
            } catch {
              // Scheduling is provider infrastructure and cannot escape the adapter.
            }
          }
        } catch {
          // Provider errors are deliberately isolated from application work.
        }
        return
      }
      try {
        client.capture(message)
      } catch {
        // Provider errors are deliberately isolated from application work.
      }
    },
    async shutdown() {
      await client.shutdown().catch(() => undefined)
    },
  }
}

function disabledAdapter(): ServerTelemetryAdapter {
  return {
    capture: () => undefined,
    shutdown: async () => undefined,
  }
}
