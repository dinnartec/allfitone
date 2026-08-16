'use client'

import {
  TELEMETRY_NOTICE_VERSION,
  createClientTelemetryRuntime,
  type AnalyticsConsentRecord,
  type ClientOperation,
  type TelemetryEnvironment,
  type TelemetryEvent,
  type TelemetryFlowStep,
  type TelemetryOutcome,
} from '@allfitone/telemetry'
import { createPostHogBrowserTelemetry } from '@allfitone/telemetry/posthog-browser'

const CONSENT_KEY = 'allfit.analytics-v1'
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080').replace(/\/$/, '')
const client = createPostHogBrowserTelemetry({
  apiKey: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
})

export interface StudioTelemetryState {
  active: boolean
  decision: AnalyticsConsentRecord['decision'] | 'undecided'
  privacySignalDenied: boolean
}

let state: StudioTelemetryState = {
  active: false,
  decision: 'undecided',
  privacySignalDenied: false,
}
const SERVER_STATE: StudioTelemetryState = {
  active: false,
  decision: 'undecided',
  privacySignalDenied: false,
}
let initialized = false
let distinctId: string | null = null
const listeners = new Set<() => void>()
const runtime = createClientTelemetryRuntime({
  adapter: client,
  gateUrl: `${API_URL}/studio/v1/telemetry-config`,
  noticeVersion: TELEMETRY_NOTICE_VERSION,
})
runtime.subscribe(syncRuntimeState)

export function initializeStudioTelemetry(): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  const privacySignalDenied = privacySignal()
  state = {
    ...state,
    privacySignalDenied,
    decision: privacySignalDenied ? 'denied' : readConsent(),
  }
  emit()
  reconcileRuntime()
}

export function setStudioAnalyticsConsent(decision: 'denied' | 'granted'): void {
  if (typeof window === 'undefined') return
  const effectiveDecision = privacySignal() ? 'denied' : decision
  const record: AnalyticsConsentRecord = {
    decision: effectiveDecision,
    notice_version: TELEMETRY_NOTICE_VERSION,
  }
  try {
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify(record))
  } catch {
    state = { ...state, active: false, decision: 'undecided' }
    emit()
    reconcileRuntime()
    return
  }
  state = { ...state, active: false, decision: effectiveDecision }
  emit()
  reconcileRuntime()
}

export function setStudioTelemetryIdentity(value: string | null): void {
  distinctId = value
  reconcileRuntime()
}

export function captureStudioTelemetry(event: TelemetryEvent): void {
  runtime.capture(event)
}

export function studioTelemetryCommon() {
  return {
    surface: 'studio' as const,
    service: 'studio-web' as const,
    environment: telemetryEnvironment(),
    release: telemetryRelease(),
    platform: 'web' as const,
  }
}

export function captureStudioApiRequest(input: {
  operation: ClientOperation
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'
  durationMs: number
  flowStep?: TelemetryFlowStep
  response?: Response
}): void {
  const status = input.response?.status
  const serverDuration = input.response
    ? serverTimingDuration(input.response.headers.get('Server-Timing'), 'total')
    : undefined
  captureStudioTelemetry({
    event: 'client.api_request.completed.v1',
    properties: {
      ...studioTelemetryCommon(),
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
        serverTimingDuration(input.response.headers.get('Server-Timing'), 'workos-refresh') !==
          undefined
          ? 'workos'
          : 'none',
    },
  })
  const flow = studioFlow(input.operation, input.flowStep)
  if (flow) {
    captureStudioTelemetry({
      event: 'product.flow_step.completed.v1',
      properties: {
        ...studioTelemetryCommon(),
        ...flow,
        outcome: status === undefined ? 'unavailable' : outcomeFor(status),
        duration_ms: round(input.durationMs),
      },
    })
  }
  if (!input.response) {
    captureStudioTelemetry({
      event: 'client.failure.observed.v1',
      properties: {
        ...studioTelemetryCommon(),
        code: 'network',
        boundary: 'request',
        recoverable: true,
      },
    })
  }
}

function studioFlow(
  operation: ClientOperation,
  explicitStep?: TelemetryFlowStep,
):
  | {
      flow:
        | 'studio.authentication'
        | 'studio.invitation'
        | 'studio.onboarding'
        | 'studio.organization'
        | 'studio.professional_credential'
        | 'studio.professional_profile'
        | 'studio.team_management'
      step:
        | 'attempt_presented'
        | 'credential_declared'
        | 'credential_retired'
        | 'credential_revised'
        | 'eligibility_recorded'
        | 'invitation_accepted'
        | 'invitation_created'
        | 'invitation_rejected'
        | 'invitation_resolved'
        | 'invitation_revoked'
        | 'memberships_viewed'
        | 'organization_created'
        | 'person_activated'
        | 'profile_updated'
        | 'roles_viewed'
        | 'session_confirmed'
    }
  | undefined {
  if (
    operation === 'studio.invitation.decide' &&
    (explicitStep === 'invitation_accepted' || explicitStep === 'invitation_rejected')
  ) {
    return { flow: 'studio.invitation', step: explicitStep }
  }
  const flows: Partial<Record<ClientOperation, { flow: string; step: string }>> = {
    'studio.session': { flow: 'studio.authentication', step: 'session_confirmed' },
    'studio.entry_context': { flow: 'studio.organization', step: 'memberships_viewed' },
    'studio.onboarding.start': { flow: 'studio.onboarding', step: 'attempt_presented' },
    'studio.onboarding.eligibility': { flow: 'studio.onboarding', step: 'eligibility_recorded' },
    'studio.onboarding.complete': { flow: 'studio.onboarding', step: 'person_activated' },
    'studio.organization.create': { flow: 'studio.organization', step: 'organization_created' },
    'studio.professional.profile_update': {
      flow: 'studio.professional_profile',
      step: 'profile_updated',
    },
    'studio.professional.credential_declare': {
      flow: 'studio.professional_credential',
      step: 'credential_declared',
    },
    'studio.professional.credential_revise': {
      flow: 'studio.professional_credential',
      step: 'credential_revised',
    },
    'studio.professional.credential_retire': {
      flow: 'studio.professional_credential',
      step: 'credential_retired',
    },
    'studio.invitation.create': { flow: 'studio.invitation', step: 'invitation_created' },
    'studio.invitation.resolve': { flow: 'studio.invitation', step: 'invitation_resolved' },
    'studio.invitation.revoke': { flow: 'studio.invitation', step: 'invitation_revoked' },
    'studio.organization.memberships': {
      flow: 'studio.team_management',
      step: 'memberships_viewed',
    },
    'studio.catalog.organization_roles': { flow: 'studio.team_management', step: 'roles_viewed' },
  }
  return flows[operation] as ReturnType<typeof studioFlow>
}

export function subscribeStudioTelemetry(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function studioTelemetrySnapshot(): StudioTelemetryState {
  return state
}

export function studioTelemetryServerSnapshot(): StudioTelemetryState {
  return SERVER_STATE
}

function reconcileRuntime(): void {
  runtime.reconcile({
    allowed: state.decision === 'granted' && !state.privacySignalDenied,
    distinctId,
  })
}

function syncRuntimeState(): void {
  const { active } = runtime.snapshot()
  if (state.active === active) return
  state = { ...state, active }
  emit()
}

function readConsent(): StudioTelemetryState['decision'] {
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
  const navigatorWithGpc = navigator as Navigator & { globalPrivacyControl?: boolean }
  return navigatorWithGpc.globalPrivacyControl === true || navigator.doNotTrack === '1'
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

function serverTimingDuration(header: string | null, metric: string): number | undefined {
  if (!header) return undefined
  for (const entry of header.split(',')) {
    const [name, ...parameters] = entry.trim().split(';')
    if (name !== metric) continue
    const duration = parameters.find((parameter) => parameter.trim().startsWith('dur='))
    const value = Number(duration?.trim().slice(4))
    return Number.isFinite(value) && value >= 0 ? round(value) : undefined
  }
  return undefined
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
