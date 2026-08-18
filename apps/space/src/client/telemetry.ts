import {
  TELEMETRY_NOTICE_VERSION,
  createClientTelemetryRuntime,
  type AnalyticsConsentRecord,
  type TelemetryEnvironment,
  type TelemetryEvent,
  type TelemetryOutcome,
} from '@allfitone/telemetry'
import { createPostHogReactNativeTelemetry } from '@allfitone/telemetry/posthog-react-native'
import Constants from 'expo-constants'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

const CONSENT_KEY = 'allfit.analytics-v1'
export const ANALYTICS_IDENTITY_KEY = 'allfit.analyticsIdentity'
const client = createPostHogReactNativeTelemetry({
  apiKey: process.env.EXPO_PUBLIC_POSTHOG_KEY,
  host: process.env.EXPO_PUBLIC_POSTHOG_HOST,
})

export interface SpaceTelemetryState {
  active: boolean
  decision: AnalyticsConsentRecord['decision'] | 'undecided'
}

let state: SpaceTelemetryState = { active: false, decision: 'undecided' }
let initialized = false
let distinctId: string | null = null
const listeners = new Set<() => void>()
const runtime = createClientTelemetryRuntime({
  adapter: client,
  gateUrl: `${resolveBaseUrl()}/space/v1/telemetry-config`,
  noticeVersion: TELEMETRY_NOTICE_VERSION,
})
runtime.subscribe(syncRuntimeState)

export async function initializeSpaceTelemetry(): Promise<void> {
  if (initialized) return
  initialized = true
  try {
    const [consentJson, storedDistinctId] = await Promise.all([
      SecureStore.getItemAsync(CONSENT_KEY),
      SecureStore.getItemAsync(ANALYTICS_IDENTITY_KEY),
    ])
    state = { ...state, decision: parseConsent(consentJson) }
    distinctId = validDistinctId(storedDistinctId) ? storedDistinctId : null
  } catch {
    state = { active: false, decision: 'undecided' }
    distinctId = null
  }
  emit()
  reconcileRuntime()
}

export async function setSpaceAnalyticsConsent(decision: 'denied' | 'granted'): Promise<void> {
  const record: AnalyticsConsentRecord = {
    decision,
    notice_version: TELEMETRY_NOTICE_VERSION,
  }
  try {
    await SecureStore.setItemAsync(CONSENT_KEY, JSON.stringify(record))
  } catch {
    state = { ...state, active: false, decision: 'undecided' }
    emit()
    return
  }
  state = { ...state, active: false, decision }
  emit()
  reconcileRuntime()
}

export function setSpaceTelemetryIdentity(value: string | null): void {
  distinctId = validDistinctId(value) ? value : null
  reconcileRuntime()
}

export function captureSpaceTelemetry(event: TelemetryEvent): void {
  runtime.capture(event)
}

export function spaceTelemetryCommon() {
  return {
    surface: 'space' as const,
    service: 'space' as const,
    environment: telemetryEnvironment(),
    release: telemetryRelease(),
    platform: Platform.OS === 'ios' ? ('ios' as const) : ('android' as const),
  }
}

export function captureSpaceApiRequest(input: {
  operation:
    | 'space.auth.registration'
    | 'space.auth.registration_verification'
    | 'space.auth.session'
    | 'space.auth.session_refresh'
    | 'space.auth.password_reset'
  durationMs: number
  response?: Response
}): void {
  const status = input.response?.status
  const serverDuration = input.response
    ? timing(input.response.headers.get('Server-Timing'), 'total')
    : undefined
  captureSpaceTelemetry({
    event: 'client.api_request.completed.v1',
    properties: {
      ...spaceTelemetryCommon(),
      operation: input.operation,
      method: 'POST',
      outcome: status === undefined ? 'unavailable' : outcomeFor(status),
      status_group: status === undefined ? 'network' : statusGroup(status),
      duration_ms: round(input.durationMs),
      ...(serverDuration === undefined ? {} : { server_duration_ms: serverDuration }),
      ...(serverDuration === undefined
        ? {}
        : { network_overhead_ms: round(Math.max(0, input.durationMs - serverDuration)) }),
      external_dependency:
        input.response &&
        timing(input.response.headers.get('Server-Timing'), 'workos-refresh') !== undefined
          ? 'workos'
          : 'none',
    },
  })
  if (!input.response) {
    captureSpaceTelemetry({
      event: 'client.failure.observed.v1',
      properties: {
        ...spaceTelemetryCommon(),
        code: 'network',
        boundary: 'request',
        recoverable: true,
      },
    })
  }
}

export function subscribeSpaceTelemetry(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function spaceTelemetrySnapshot(): SpaceTelemetryState {
  return state
}

function reconcileRuntime(): void {
  runtime.reconcile({ allowed: state.decision === 'granted', distinctId })
}

function syncRuntimeState(): void {
  const { active } = runtime.snapshot()
  if (state.active === active) return
  state = { ...state, active }
  emit()
}

function resolveBaseUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL.replace(/\/$/, '')
  const host = Constants.expoConfig?.hostUri?.split(':')[0]
  return host ? `http://${host}:8080` : 'http://localhost:8080'
}

function parseConsent(value: string | null): SpaceTelemetryState['decision'] {
  try {
    const parsed: unknown = JSON.parse(value ?? 'null')
    if (
      isRecord(parsed) &&
      parsed.notice_version === TELEMETRY_NOTICE_VERSION &&
      (parsed.decision === 'granted' || parsed.decision === 'denied')
    ) {
      return parsed.decision
    }
  } catch {
    // Invalid secure storage remains unconsented.
  }
  return 'undecided'
}

function validDistinctId(value: string | null): value is string {
  return typeof value === 'string' && /^a[1-9][0-9]*_[A-Za-z0-9_-]{43}$/.test(value)
}

function telemetryEnvironment(): TelemetryEnvironment {
  const value = process.env.EXPO_PUBLIC_ANALYTICS_ENVIRONMENT
  return value === 'production' || value === 'preview' ? value : 'development'
}

function telemetryRelease(): string {
  const raw = process.env.EXPO_PUBLIC_APP_RELEASE ?? Constants.expoConfig?.version ?? 'local'
  return raw.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'local'
}

function outcomeFor(status: number): TelemetryOutcome {
  if (status < 400) return 'success'
  if (status === 401) return 'unauthenticated'
  if (status === 403) return 'forbidden'
  if (status === 429) return 'rate-limited'
  if (status === 503) return 'unavailable'
  if (status < 500) return 'invalid-request'
  return 'error'
}

function statusGroup(status: number): '2xx' | '3xx' | '4xx' | '5xx' {
  if (status < 300) return '2xx'
  if (status < 400) return '3xx'
  if (status < 500) return '4xx'
  return '5xx'
}

function timing(header: string | null, name: string): number | undefined {
  const match = header
    ?.split(',')
    .find((entry) => entry.trim().split(';')[0] === name)
    ?.match(/(?:^|;)\s*dur=([0-9.]+)/)
  const value = Number(match?.[1])
  return Number.isFinite(value) && value >= 0 ? round(value) : undefined
}

function round(value: number): number {
  return Math.round(Math.max(0, value) * 10) / 10
}

function emit(): void {
  for (const listener of listeners) listener()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
