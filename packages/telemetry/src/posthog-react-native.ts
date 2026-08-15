import type { PostHog } from 'posthog-react-native'

import {
  sanitizeTelemetryEvent,
  sanitizeTelemetryProviderEvent,
  type TelemetryEvent,
  type TelemetryPort,
} from './index.js'
import { postHogUsHost } from './posthog-host.js'

export interface ReactNativeTelemetry extends TelemetryPort {
  start(distinctId: string): Promise<boolean>
}

export function createPostHogReactNativeTelemetry(options: {
  apiKey?: string | undefined
  host?: string | undefined
}): ReactNativeTelemetry {
  let client: PostHog | undefined
  let starting: Promise<boolean> | undefined
  let pendingDistinctId: string | undefined
  let activeDistinctId: string | undefined

  const start = (distinctId: string): Promise<boolean> => {
    pendingDistinctId = distinctId
    if (!validDistinctId(distinctId)) return Promise.resolve(false)
    if (client && activeDistinctId === distinctId) return Promise.resolve(true)
    if (starting) return starting.then(() => start(distinctId))

    const host = postHogUsHost(options.host)
    if (!options.apiKey || !host) return Promise.resolve(false)
    const previousClient = client
    client = undefined
    activeDistinctId = undefined
    starting = (async () => {
      await previousClient?._shutdown(1_000).catch(() => undefined)
      const { PostHog: PostHogClient } = await import('posthog-react-native')
      const identity = pendingDistinctId
      if (!identity || !validDistinctId(identity)) return false
      const instance = new PostHogClient(options.apiKey ?? '', {
        host,
        persistence: 'memory',
        defaultOptIn: false,
        personProfiles: 'never',
        bootstrap: { distinctId: identity, isIdentifiedId: false },
        captureAppLifecycleEvents: false,
        capturePushNotificationOpened: false,
        capturePushNotificationSubscriptions: false,
        enableSessionReplay: false,
        errorTracking: { autocapture: false, exceptionSteps: { enabled: false } },
        setDefaultPersonProperties: false,
        before_send: (message) => {
          if (!message?.properties) return null
          const sanitized = sanitizeTelemetryProviderEvent(message)
          const eventDistinctId = message.properties.distinct_id
          const token = message.properties.token
          if (
            !sanitized ||
            typeof eventDistinctId !== 'string' ||
            !validDistinctId(eventDistinctId) ||
            typeof token !== 'string'
          ) {
            return null
          }
          return {
            event: sanitized.event,
            properties: {
              ...sanitized.properties,
              distinct_id: eventDistinctId,
              token,
              $process_person_profile: false,
            },
            ...(message.uuid === undefined ? {} : { uuid: message.uuid }),
            ...(message.timestamp === undefined ? {} : { timestamp: message.timestamp }),
          }
        },
      })
      const ready = await Promise.race([
        instance.ready().then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000)),
      ])
      if (!ready || pendingDistinctId !== identity) {
        await instance._shutdown(1_000).catch(() => undefined)
        return false
      }
      await instance.optIn()
      activeDistinctId = identity
      client = instance
      return true
    })()
      .catch(() => false)
      .finally(() => {
        starting = undefined
      })
    return starting
  }

  const adapter: ReactNativeTelemetry = {
    start,
    capture(event: TelemetryEvent) {
      const sanitized = sanitizeTelemetryEvent(event)
      if (!client || !sanitized || !activeDistinctId) return
      try {
        client.capture(
          sanitized.event,
          sanitized.properties as unknown as Record<string, string | number | boolean>,
        )
      } catch {
        // Mobile telemetry never changes product behavior.
      }
    },
    identify(distinctId) {
      pendingDistinctId = distinctId
      if (client && activeDistinctId !== distinctId) void start(distinctId)
    },
    resetIdentity() {
      pendingDistinctId = undefined
      activeDistinctId = undefined
      try {
        client?.reset()
      } catch {
        // Mobile telemetry never changes product behavior.
      }
    },
  }

  return adapter
}

function validDistinctId(value: string): boolean {
  return /^a[1-9][0-9]*_[A-Za-z0-9_-]{43}$/.test(value)
}
