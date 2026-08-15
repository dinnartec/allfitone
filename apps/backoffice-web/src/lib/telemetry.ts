'use client'

import {
  TELEMETRY_NOTICE_VERSION,
  type AnalyticsConsentRecord,
  type ClientOperation,
  type TelemetryEnvironment,
  type TelemetryEvent,
  type TelemetryOutcome,
} from '@allfitone/telemetry'
import { createPostHogBrowserTelemetry } from '@allfitone/telemetry/posthog-browser'

const CONSENT_KEY = 'allfit.analytics-v1'
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080').replace(/\/$/, '')
const client = createPostHogBrowserTelemetry({
  apiKey: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
})

export interface BackofficeTelemetryState {
  active: boolean
  decision: AnalyticsConsentRecord['decision'] | 'undecided'
  privacySignalDenied: boolean
}

let state: BackofficeTelemetryState = {
  active: false,
  decision: 'undecided',
  privacySignalDenied: false,
}
const SERVER_STATE: BackofficeTelemetryState = {
  active: false,
  decision: 'undecided',
  privacySignalDenied: false,
}
let initialized = false
let distinctId: string | null = null
let startInFlight: Promise<void> | undefined
let gateCache: { enabled: boolean; expiresAt: number } | undefined
const listeners = new Set<() => void>()
const pendingEvents: TelemetryEvent[] = []

export function initializeBackofficeTelemetry(): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  const denied = privacySignal()
  state = { ...state, privacySignalDenied: denied, decision: denied ? 'denied' : readConsent() }
  emit()
  void maybeStart()
}

export function setBackofficeAnalyticsConsent(decision: 'denied' | 'granted'): void {
  if (typeof window === 'undefined') return
  const effectiveDecision = privacySignal() ? 'denied' : decision
  try {
    window.localStorage.setItem(
      CONSENT_KEY,
      JSON.stringify({ decision: effectiveDecision, notice_version: TELEMETRY_NOTICE_VERSION }),
    )
  } catch {
    // Storage failures remain fail-closed.
  }
  state = { ...state, active: false, decision: effectiveDecision }
  if (effectiveDecision === 'denied') {
    pendingEvents.length = 0
    client.resetIdentity()
  }
  emit()
  void maybeStart()
}

export function setBackofficeTelemetryIdentity(value: string | null): void {
  distinctId = value
  if (!value) {
    pendingEvents.length = 0
    client.resetIdentity()
    state = { ...state, active: false }
    emit()
    return
  }
  client.identify(value)
  void maybeStart()
}

export function captureBackofficeTelemetry(event: TelemetryEvent): void {
  if (state.active) {
    client.capture(event)
    return
  }
  if (state.decision === 'granted' && pendingEvents.length < 20) pendingEvents.push(event)
}

export function backofficeTelemetryCommon() {
  return {
    surface: 'backoffice' as const,
    service: 'backoffice-web' as const,
    environment: telemetryEnvironment(),
    release: telemetryRelease(),
    platform: 'web' as const,
  }
}

export function captureBackofficeApiRequest(input: {
  operation: ClientOperation
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'
  durationMs: number
  response?: Response
}): void {
  const status = input.response?.status
  const serverDuration = input.response
    ? timing(input.response.headers.get('Server-Timing'), 'total')
    : undefined
  captureBackofficeTelemetry({
    event: 'client.api_request.completed.v1',
    properties: {
      ...backofficeTelemetryCommon(),
      operation: input.operation,
      method: input.method,
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
  const step = backofficeFlowStep(input.operation)
  if (step) {
    captureBackofficeTelemetry({
      event: 'product.flow_step.completed.v1',
      properties: {
        ...backofficeTelemetryCommon(),
        flow: 'backoffice.authentication',
        step,
        outcome: status === undefined ? 'unavailable' : outcomeFor(status),
        duration_ms: round(input.durationMs),
      },
    })
  }
  if (!input.response) {
    captureBackofficeTelemetry({
      event: 'client.failure.observed.v1',
      properties: {
        ...backofficeTelemetryCommon(),
        code: 'network',
        boundary: 'request',
        recoverable: true,
      },
    })
  }
}

function backofficeFlowStep(
  operation: ClientOperation,
):
  | 'attempt_presented'
  | 'password_reset_requested'
  | 'password_submitted'
  | 'session_confirmed'
  | 'totp_verified'
  | undefined {
  const steps: Partial<
    Record<
      ClientOperation,
      | 'attempt_presented'
      | 'password_reset_requested'
      | 'password_submitted'
      | 'session_confirmed'
      | 'totp_verified'
    >
  > = {
    'backoffice.auth.password': 'password_submitted',
    'backoffice.auth.attempt': 'attempt_presented',
    'backoffice.auth.totp_verification': 'totp_verified',
    'backoffice.session': 'session_confirmed',
    'backoffice.auth.password_reset': 'password_reset_requested',
  }
  return steps[operation]
}

export function subscribeBackofficeTelemetry(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function backofficeTelemetrySnapshot(): BackofficeTelemetryState {
  return state
}

export function backofficeTelemetryServerSnapshot(): BackofficeTelemetryState {
  return SERVER_STATE
}

async function maybeStart(): Promise<void> {
  if (state.decision !== 'granted' || state.privacySignalDenied || !distinctId || startInFlight)
    return
  const currentId = distinctId
  startInFlight = (async () => {
    if (!(await telemetryGate()) || state.decision !== 'granted' || distinctId !== currentId) return
    const active = await client.start(currentId)
    if (active && distinctId === currentId && state.decision === 'granted') {
      state = { ...state, active: true }
      emit()
      for (const event of pendingEvents.splice(0)) client.capture(event)
    }
  })().finally(() => {
    startInFlight = undefined
  })
  await startInFlight
}

async function telemetryGate(): Promise<boolean> {
  if (gateCache && gateCache.expiresAt > Date.now()) return gateCache.enabled
  try {
    const response = await fetch(`${API_URL}/backoffice/v1/telemetry-config`, {
      credentials: 'omit',
    })
    const value: unknown = response.ok ? await response.json() : null
    const enabled =
      isRecord(value) && value.enabled === true && value.notice_version === TELEMETRY_NOTICE_VERSION
    gateCache = { enabled, expiresAt: Date.now() + 5 * 60_000 }
    return enabled
  } catch {
    gateCache = { enabled: false, expiresAt: Date.now() + 5 * 60_000 }
    return false
  }
}

function readConsent(): BackofficeTelemetryState['decision'] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(CONSENT_KEY) ?? 'null')
    if (
      isRecord(value) &&
      value.notice_version === TELEMETRY_NOTICE_VERSION &&
      (value.decision === 'granted' || value.decision === 'denied')
    ) {
      return value.decision
    }
  } catch {
    // Invalid or unavailable storage is the unconsented state.
  }
  return 'undecided'
}

function privacySignal(): boolean {
  const extended = navigator as Navigator & { globalPrivacyControl?: boolean }
  return extended.globalPrivacyControl === true || navigator.doNotTrack === '1'
}

function telemetryEnvironment(): TelemetryEnvironment {
  const value = process.env.NEXT_PUBLIC_ANALYTICS_ENVIRONMENT
  return value === 'production' || value === 'preview' ? value : 'development'
}

function telemetryRelease(): string {
  const raw = process.env.NEXT_PUBLIC_APP_RELEASE ?? 'local'
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
