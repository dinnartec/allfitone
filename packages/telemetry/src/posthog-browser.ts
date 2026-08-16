import type { PostHogInterface } from 'posthog-js'

import {
  sanitizeTelemetryEvent,
  sanitizeTelemetryProviderEvent,
  type TelemetryPort,
} from './index.js'
import { postHogUsHost } from './posthog-host.js'

export interface BrowserTelemetry extends TelemetryPort {
  start(distinctId: string): Promise<boolean>
  stop(): Promise<void>
}

export interface BrowserTelemetryOptions {
  apiKey?: string | undefined
  host?: string | undefined
}

/** Loads PostHog only after the caller has confirmed consent and the remote gate. */
export function createPostHogBrowserTelemetry(options: BrowserTelemetryOptions): BrowserTelemetry {
  let client: PostHogInterface | undefined
  let starting: Promise<boolean> | undefined
  let pendingDistinctId: string | undefined
  let activeDistinctId: string | undefined
  let generation = 0

  return {
    start(distinctId) {
      if (!validDistinctId(distinctId)) return Promise.resolve(false)
      pendingDistinctId = distinctId
      if (client) {
        try {
          client.opt_in_capturing()
          activeDistinctId = distinctId
          return Promise.resolve(true)
        } catch {
          return Promise.resolve(false)
        }
      }
      if (starting) return starting
      const host = postHogUsHost(options.host)
      if (!options.apiKey || !host) return Promise.resolve(false)
      const startGeneration = generation

      starting = import('posthog-js')
        .then(
          ({ default: posthog }) =>
            new Promise<boolean>((resolve) => {
              let settled = false
              const timeout = window.setTimeout(() => {
                settled = true
                resolve(false)
              }, 5_000)
              try {
                posthog.init(options.apiKey ?? '', {
                  api_host: host,
                  autocapture: false,
                  capture_pageview: false,
                  capture_pageleave: false,
                  capture_exceptions: false,
                  disable_session_recording: true,
                  disable_surveys: true,
                  advanced_disable_feature_flags: true,
                  opt_out_capturing_by_default: true,
                  persistence: 'memory',
                  person_profiles: 'never',
                  loaded: (loadedClient) => {
                    if (settled) return
                    settled = true
                    window.clearTimeout(timeout)
                    const identity = pendingDistinctId
                    if (generation !== startGeneration || !identity || !validDistinctId(identity)) {
                      loadedClient.opt_out_capturing()
                      loadedClient.reset(false)
                      resolve(false)
                      return
                    }
                    loadedClient.opt_in_capturing()
                    activeDistinctId = identity
                    client = loadedClient
                    resolve(true)
                  },
                  before_send: (message) => {
                    if (!message?.properties) return null
                    const sanitized = sanitizeTelemetryProviderEvent(message)
                    const distinctId = message.properties.distinct_id
                    const token =
                      typeof message.properties.token === 'string'
                        ? message.properties.token
                        : options.apiKey
                    if (
                      !sanitized ||
                      typeof distinctId !== 'string' ||
                      !validDistinctId(distinctId) ||
                      typeof token !== 'string'
                    ) {
                      return null
                    }
                    return {
                      event: sanitized.event,
                      properties: {
                        ...sanitized.properties,
                        distinct_id: distinctId,
                        token,
                        $process_person_profile: false,
                      },
                      uuid: message.uuid,
                      ...(message.timestamp === undefined ? {} : { timestamp: message.timestamp }),
                    }
                  },
                })
              } catch {
                window.clearTimeout(timeout)
                settled = true
                resolve(false)
              }
            }),
        )
        .catch(() => false)
        .finally(() => {
          starting = undefined
        })
      return starting
    },
    capture(event) {
      const sanitized = sanitizeTelemetryEvent(event)
      if (!client || !sanitized || !activeDistinctId) return
      try {
        client.capture(sanitized.event, {
          ...sanitized.properties,
          distinct_id: activeDistinctId,
          $process_person_profile: false,
        })
      } catch {
        // Client telemetry never changes product behavior.
      }
    },
    identify(distinctId) {
      pendingDistinctId = distinctId
      if (client && validDistinctId(distinctId)) activeDistinctId = distinctId
    },
    resetIdentity() {
      pendingDistinctId = undefined
      activeDistinctId = undefined
      try {
        client?.reset(false)
      } catch {
        // Client telemetry never changes product behavior.
      }
    },
    async stop() {
      generation += 1
      pendingDistinctId = undefined
      activeDistinctId = undefined
      try {
        client?.opt_out_capturing()
        client?.reset(false)
      } catch {
        // Client telemetry never changes product behavior.
      }
    },
  }
}

function validDistinctId(value: string): boolean {
  return /^a[1-9][0-9]*_[A-Za-z0-9_-]{43}$/.test(value)
}
