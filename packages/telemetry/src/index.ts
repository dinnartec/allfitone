/**
 * Provider-neutral telemetry contract.
 *
 * Every event is built from a closed property list. Callers cannot attach
 * arbitrary context, which is the primary guard against exporting identifiers,
 * health data, request bodies, URLs, or user-entered text.
 */

export const TELEMETRY_NOTICE_VERSION = 'analytics-v1' as const
export const ANALYTICS_PRIVACY_NOTICE_URL = 'https://www.allfit.one/privacy/analytics' as const

export {
  createClientTelemetryRuntime,
  type ClientTelemetryAdapter,
  type ClientTelemetryRuntime,
  type ClientTelemetryRuntimeOptions,
  type ClientTelemetryRuntimeScheduler,
  type ClientTelemetryRuntimeState,
} from './client-runtime.js'

export type TelemetryEnvironment = 'development' | 'preview' | 'production'
export type TelemetrySurface = 'backoffice' | 'space' | 'studio' | 'system'
export type TelemetryService =
  'allfit-api' | 'allfit-worker' | 'backoffice-web' | 'space' | 'studio-web'
export type TelemetryPlatform = 'android' | 'ios' | 'node' | 'web'
export type TelemetryOutcome =
  | 'cancelled'
  | 'error'
  | 'forbidden'
  | 'invalid-request'
  | 'rate-limited'
  | 'success'
  | 'unauthenticated'
  | 'unavailable'

export interface TelemetryCommonProperties {
  surface: TelemetrySurface
  service: TelemetryService
  environment: TelemetryEnvironment
  release: string
  platform: TelemetryPlatform
}

export const clientOperations = [
  'backoffice.auth.attempt',
  'backoffice.catalog.result_contract_deprecate',
  'backoffice.catalog.result_contract_publish',
  'backoffice.platform.duty_grant',
  'backoffice.platform.duty_list',
  'backoffice.platform.duty_revoke',
  'backoffice.platform.duty_suspend',
  'backoffice.platform.role_grant',
  'backoffice.platform.role_list',
  'backoffice.platform.role_revoke',
  'backoffice.auth.logout',
  'backoffice.auth.password',
  'backoffice.auth.password_reset',
  'backoffice.auth.totp_verification',
  'backoffice.session',
  'catalog.activity_type_result_contracts',
  'catalog.activity_types',
  'catalog.disciplines',
  'backoffice.access_log.read',
  'backoffice.break_glass.close',
  'backoffice.break_glass.decide',
  'backoffice.break_glass.exercise',
  'backoffice.break_glass.list',
  'backoffice.break_glass.request',
  'backoffice.organization.directory',
  'backoffice.organization.file',
  'backoffice.organization.handover_cancel',
  'backoffice.organization.handover_create',
  'backoffice.organization.handover_read',
  'backoffice.organization.handover_resend',
  'backoffice.organization.team_invitation_resend',
  'backoffice.organization.team_invitations',
  'backoffice.verification.decide',
  'backoffice.verification.list',
  'backoffice.verification.renewals',
  'backoffice.privacy.scope_definition_list',
  'backoffice.privacy.scope_definition_publish',
  'backoffice.support.attention',
  'backoffice.support.delivery_circuits',
  'backoffice.support.operations',
  'backoffice.support.people_search',
  'backoffice.support.person_metadata',
  'space.auth.password_reset',
  'space.auth.registration',
  'space.auth.registration_verification',
  'space.auth.session',
  'space.auth.session_refresh',
  'studio.catalog.credential_types',
  'studio.catalog.organization_roles',
  'studio.catalog.organization_types',
  'studio.catalog.professional_specialties',
  'studio.entry_context',
  'studio.invitation.create',
  'studio.invitation.decide',
  'studio.invitation.list',
  'studio.invitation.resolve',
  'studio.invitation.revoke',
  'studio.me',
  'studio.memberships',
  'studio.onboarding.complete',
  'studio.onboarding.eligibility',
  'studio.onboarding.start',
  'studio.organization.create',
  'studio.organization.memberships',
  'studio.professional.credential_declare',
  'studio.professional.credential_retire',
  'studio.professional.credential_revise',
  'studio.professional.profile_update',
  'studio.session',
] as const

export type ClientOperation = (typeof clientOperations)[number]

export const telemetryScreens = [
  'backoffice.access',
  'backoffice.catalogue_contracts',
  'backoffice.platform_access',
  'backoffice.access_log',
  'backoffice.attention_panel',
  'backoffice.break_glass',
  'backoffice.credential_verification',
  'backoffice.organization_directory',
  'backoffice.organization_file',
  'backoffice.organization_handover',
  'backoffice.scope_definitions',
  'backoffice.support_diagnosis',
  'backoffice.support_people',
  'backoffice.support_person',
  'backoffice.authentication_attempt',
  'backoffice.session',
  'space.create_account',
  'space.sign_in',
  'space.verify_email',
  'space.welcome',
  'studio.account',
  'studio.entry',
  'studio.invitation_decision',
  'studio.organization_overview',
  'studio.profile',
  'studio.team_directory',
  'studio.team_invitation_new',
  'studio.team_invitations',
  'studio.team_roles',
] as const

export type TelemetryScreen = (typeof telemetryScreens)[number]

export const telemetryFlows = [
  'backoffice.authentication',
  'space.registration',
  'space.sign_in',
  'space.password_reset',
  'studio.authentication',
  'studio.invitation',
  'studio.onboarding',
  'studio.organization',
  'studio.professional_credential',
  'studio.professional_profile',
  'studio.team_management',
] as const

export type TelemetryFlow = (typeof telemetryFlows)[number]

export const telemetryFlowSteps = [
  'attempt_presented',
  'callback_completed',
  'credential_declared',
  'credential_retired',
  'credential_revised',
  'eligibility_recorded',
  'invitation_accepted',
  'invitation_created',
  'invitation_rejected',
  'invitation_resolved',
  'invitation_revoked',
  'memberships_viewed',
  'organization_created',
  'password_reset_requested',
  'password_submitted',
  'person_activated',
  'profile_updated',
  'registration_requested',
  'roles_viewed',
  'session_confirmed',
  'session_issued',
  'totp_enrollment_presented',
  'totp_verified',
  'verification_submitted',
] as const

export type TelemetryFlowStep = (typeof telemetryFlowSteps)[number]

export type TelemetryEvent =
  | TelemetryEventOf<'client.screen.viewed.v1', { screen: TelemetryScreen }>
  | TelemetryEventOf<
      'client.api_request.completed.v1',
      {
        operation: ClientOperation
        method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'
        outcome: TelemetryOutcome
        status_group: '2xx' | '3xx' | '4xx' | '5xx' | 'network'
        duration_ms: number
        server_duration_ms?: number
        network_overhead_ms?: number
        external_dependency: 'none' | 'workos'
      }
    >
  | TelemetryEventOf<
      'client.performance.measured.v1',
      {
        metric: 'CLS' | 'FCP' | 'INP' | 'LCP' | 'TTFB' | 'app_start' | 'screen_transition'
        value: number
        rating: 'good' | 'needs-improvement' | 'poor' | 'unrated'
      }
    >
  | TelemetryEventOf<
      'client.failure.observed.v1',
      {
        code: 'configuration' | 'navigation' | 'network' | 'render' | 'unavailable' | 'unknown'
        boundary: 'navigation' | 'request' | 'root' | 'screen'
        recoverable: boolean
      }
    >
  | TelemetryEventOf<
      'product.flow_step.completed.v1',
      {
        flow: TelemetryFlow
        step: TelemetryFlowStep
        outcome: TelemetryOutcome
        duration_ms?: number
      }
    >
  | TelemetryEventOf<
      'server.http_request.completed.v1',
      {
        operation: string
        method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'
        status: number
        outcome: TelemetryOutcome
        duration_ms: number
        external_dependency: 'none' | 'workos'
        region: string
        session_db_ms?: number
        token_local_ms?: number
        workos_refresh_ms?: number
        actor_db_ms?: number
        business_db_ms?: number
      }
    >
  | TelemetryEventOf<
      'worker.job.completed.v1',
      {
        job: 'backoffice_auth_cleanup' | 'invitation_delivery' | 'outbox_batch'
        outcome: 'completed' | 'failed' | 'retrying'
        duration_ms: number
        item_count?: number
      }
    >

type TelemetryEventOf<Name extends string, Properties extends object> = {
  event: Name
  properties: TelemetryCommonProperties & Properties
}

export type TelemetryEventName = TelemetryEvent['event']
export type TelemetryEventFor<Name extends TelemetryEventName> = Extract<
  TelemetryEvent,
  { event: Name }
>

export interface TelemetryPort {
  capture(event: TelemetryEvent): void
  identify(distinctId: string): void
  resetIdentity(): void
}

export interface AnalyticsConsentRecord {
  decision: 'denied' | 'granted'
  notice_version: typeof TELEMETRY_NOTICE_VERSION
}

const COMMON_KEYS = ['environment', 'platform', 'release', 'service', 'surface'] as const
const EVENT_KEYS: Record<TelemetryEventName, readonly string[]> = {
  'client.screen.viewed.v1': ['screen'],
  'client.api_request.completed.v1': [
    'duration_ms',
    'external_dependency',
    'method',
    'network_overhead_ms',
    'operation',
    'outcome',
    'server_duration_ms',
    'status_group',
  ],
  'client.performance.measured.v1': ['metric', 'rating', 'value'],
  'client.failure.observed.v1': ['boundary', 'code', 'recoverable'],
  'product.flow_step.completed.v1': ['duration_ms', 'flow', 'outcome', 'step'],
  'server.http_request.completed.v1': [
    'actor_db_ms',
    'business_db_ms',
    'duration_ms',
    'external_dependency',
    'method',
    'operation',
    'outcome',
    'region',
    'session_db_ms',
    'status',
    'token_local_ms',
    'workos_refresh_ms',
  ],
  'worker.job.completed.v1': ['duration_ms', 'item_count', 'job', 'outcome'],
}

const EVENT_NAMES = new Set<string>(Object.keys(EVENT_KEYS))
const RELEASE = /^[A-Za-z0-9._-]{1,80}$/
const ROUTE_TEMPLATE = /^\/(?:backoffice|catalog|space|studio)\/v1\/[A-Za-z0-9_/:.*-]{1,180}$/
const UUID_IN_ROUTE = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/|$)/i
const REGION = /^[A-Za-z0-9_-]{1,32}$/

/**
 * Refuses unknown keys and unsafe primitive values. It returns a detached copy
 * so a caller cannot mutate an accepted event after validation.
 */
export function sanitizeTelemetryEvent(value: unknown): TelemetryEvent | undefined {
  if (!isRecord(value) || typeof value.event !== 'string' || !EVENT_NAMES.has(value.event)) {
    return undefined
  }
  if (!isRecord(value.properties)) return undefined
  const name = value.event as TelemetryEventName
  const allowed = new Set<string>([...COMMON_KEYS, ...EVENT_KEYS[name]])
  if (Object.keys(value.properties).some((key) => !allowed.has(key))) return undefined
  if (!validCommon(value.properties)) return undefined

  const valid = validateSpecific(name, value.properties)
  if (!valid) return undefined
  return {
    event: name,
    properties: { ...value.properties },
  } as unknown as TelemetryEvent
}

/**
 * Final provider egress filter. SDKs attach URL, device and library properties
 * after capture; this rebuilds the event exclusively from the policy allowlist.
 */
export function sanitizeTelemetryProviderEvent(value: unknown): TelemetryEvent | undefined {
  if (!isRecord(value) || typeof value.event !== 'string' || !EVENT_NAMES.has(value.event)) {
    return undefined
  }
  if (!isRecord(value.properties)) return undefined
  const name = value.event as TelemetryEventName
  const properties: Record<string, unknown> = {}
  for (const key of [...COMMON_KEYS, ...EVENT_KEYS[name]]) {
    if (Object.hasOwn(value.properties, key)) properties[key] = value.properties[key]
  }
  return sanitizeTelemetryEvent({ event: name, properties })
}

function validateSpecific(name: TelemetryEventName, properties: Record<string, unknown>): boolean {
  switch (name) {
    case 'client.screen.viewed.v1':
      return includes(telemetryScreens, properties.screen)
    case 'client.api_request.completed.v1':
      return (
        includes(clientOperations, properties.operation) &&
        includes(['DELETE', 'GET', 'PATCH', 'POST', 'PUT'] as const, properties.method) &&
        validOutcome(properties.outcome) &&
        includes(['2xx', '3xx', '4xx', '5xx', 'network'] as const, properties.status_group) &&
        duration(properties.duration_ms) &&
        optionalDuration(properties.server_duration_ms) &&
        optionalDuration(properties.network_overhead_ms) &&
        includes(['none', 'workos'] as const, properties.external_dependency)
      )
    case 'client.performance.measured.v1':
      return (
        includes(
          ['CLS', 'FCP', 'INP', 'LCP', 'TTFB', 'app_start', 'screen_transition'] as const,
          properties.metric,
        ) &&
        duration(properties.value) &&
        includes(['good', 'needs-improvement', 'poor', 'unrated'] as const, properties.rating)
      )
    case 'client.failure.observed.v1':
      return (
        includes(
          ['configuration', 'navigation', 'network', 'render', 'unavailable', 'unknown'] as const,
          properties.code,
        ) &&
        includes(['navigation', 'request', 'root', 'screen'] as const, properties.boundary) &&
        typeof properties.recoverable === 'boolean'
      )
    case 'product.flow_step.completed.v1':
      return (
        includes(telemetryFlows, properties.flow) &&
        includes(telemetryFlowSteps, properties.step) &&
        validOutcome(properties.outcome) &&
        optionalDuration(properties.duration_ms)
      )
    case 'server.http_request.completed.v1':
      return (
        typeof properties.operation === 'string' &&
        (properties.operation === 'unmatched' ||
          (ROUTE_TEMPLATE.test(properties.operation) &&
            !UUID_IN_ROUTE.test(properties.operation))) &&
        includes(['DELETE', 'GET', 'PATCH', 'POST', 'PUT'] as const, properties.method) &&
        Number.isInteger(properties.status) &&
        Number(properties.status) >= 100 &&
        Number(properties.status) <= 599 &&
        validOutcome(properties.outcome) &&
        duration(properties.duration_ms) &&
        includes(['none', 'workos'] as const, properties.external_dependency) &&
        typeof properties.region === 'string' &&
        REGION.test(properties.region) &&
        optionalDuration(properties.session_db_ms) &&
        optionalDuration(properties.token_local_ms) &&
        optionalDuration(properties.workos_refresh_ms) &&
        optionalDuration(properties.actor_db_ms) &&
        optionalDuration(properties.business_db_ms)
      )
    case 'worker.job.completed.v1':
      return (
        includes(
          ['backoffice_auth_cleanup', 'invitation_delivery', 'outbox_batch'] as const,
          properties.job,
        ) &&
        includes(['completed', 'failed', 'retrying'] as const, properties.outcome) &&
        duration(properties.duration_ms) &&
        optionalCount(properties.item_count)
      )
  }
}

function validCommon(properties: Record<string, unknown>): boolean {
  return (
    includes(['backoffice', 'space', 'studio', 'system'] as const, properties.surface) &&
    includes(
      ['allfit-api', 'allfit-worker', 'backoffice-web', 'space', 'studio-web'] as const,
      properties.service,
    ) &&
    includes(['development', 'preview', 'production'] as const, properties.environment) &&
    typeof properties.release === 'string' &&
    RELEASE.test(properties.release) &&
    includes(['android', 'ios', 'node', 'web'] as const, properties.platform)
  )
}

function validOutcome(value: unknown): value is TelemetryOutcome {
  return includes(
    [
      'cancelled',
      'error',
      'forbidden',
      'invalid-request',
      'rate-limited',
      'success',
      'unauthenticated',
      'unavailable',
    ] as const,
    value,
  )
}

function duration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function optionalDuration(value: unknown): boolean {
  return value === undefined || duration(value)
}

function optionalCount(value: unknown): boolean {
  return value === undefined || (Number.isSafeInteger(value) && Number(value) >= 0)
}

function includes<const Values extends readonly (boolean | number | string)[]>(
  values: Values,
  value: unknown,
): value is Values[number] {
  return values.some((candidate) => candidate === value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
