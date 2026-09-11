import type { BrowserContext, Route } from '@playwright/test'

const BACKOFFICE_ORIGIN = 'http://127.0.0.1:3102'

export interface BackofficeFixture {
  session?: SessionFixture | undefined
  attempt?: AttemptFixture | undefined
  passwordOutcome?: 'challenge' | 'enrollment' | 'unauthenticated' | 'disabled' | 'rate-limited'
  totpOutcome?: 'success' | 'invalid' | 'network-lost-after-success' | 'rate-limited'
  invalidTotpCount?: number
  logoutFails?: boolean
  sessionUnavailable?: boolean
  platformAccess?: PlatformAccessFixture
  resultContracts?: ResultContractFixture
  catalogue?: CatalogueFixture
  support?: SupportFixture
  diagnosis?: DiagnosisFixture
  scopes?: ScopeFixture
  breakGlass?: BreakGlassFixture
  requests: MockRequest[]
}

/**
 * The published permission definitions. Publishing appends a version rather than
 * replacing one, because that is what the real command does and the screen's whole
 * point is that an older version survives.
 */
export interface ScopeFixture {
  refusal?: { status: number; code: string }
  definitions: ScopeDefinitionFixture[]
}

export interface ScopeDefinitionFixture {
  id: string
  scope_code: string
  version_number: number
  status: string
  published_at: string | null
  rules: Array<{
    resource: string
    field: string
    data_classification_code: string
    max_action: 'read' | 'contribute'
    is_excluded: boolean
    historical_readable: boolean
  }>
}

export function scopeDefinition(
  overrides: Partial<ScopeDefinitionFixture> = {},
): ScopeDefinitionFixture {
  return {
    id: nextAssignmentId(),
    scope_code: 'body_progress',
    version_number: 1,
    status: 'published',
    published_at: new Date(Date.now() - 86_400_000).toISOString(),
    rules: [
      {
        resource: 'execution.body_measurements',
        field: 'weight_kg',
        data_classification_code: 'body',
        max_action: 'read',
        is_excluded: false,
        historical_readable: true,
      },
      {
        resource: 'nutrition.intake_entries',
        field: '*',
        data_classification_code: 'nutrition',
        max_action: 'read',
        is_excluded: true,
        historical_readable: false,
      },
    ],
    ...overrides,
  }
}

/**
 * Break-glass files.
 *
 * This mock reproduces the *command's* rules, not the screen's expectations. A
 * decision appends an approval and the window opens only once the quorum is
 * complete; the requester may never decide on their own file; a rejection is
 * final; and a denied attempt still answers 200 with its reason. A mock more
 * permissive than the real command would let the screen pass while production
 * refused — which is the whole failure this file exists to prevent.
 */
export interface BreakGlassFixture {
  refusal?: { status: number; code: string }
  nextCommandFailure?: { status: number; code: string } | undefined
  files: BreakGlassFileFixture[]
}

export interface BreakGlassFileFixture {
  id: string
  requester_person_id: string
  subject_person_id: string
  categories: string[]
  purpose: string
  case_reference: string
  sensitivity_tier: 'standard' | 'restricted'
  required_approvals: number
  requested_duration_minutes: number
  requested_at: string
  request_expires_at: string
  status: string
  window_starts_at: string | null
  window_ends_at: string | null
  closed_at: string | null
  reviewed_at: string | null
  review_outcome: string | null
  approvals: Array<{
    approver_person_id: string
    decision: 'approved' | 'rejected'
    reason_code: string
    decided_at: string
  }>
  exercise_count: number
  /**
   * Whether the viewer opened this file. The other two viewer fields are derived
   * from it on every answer, never set by a test, so a spec cannot grant itself a
   * button the server would withhold.
   */
  viewer_is_requester: boolean
  viewer_has_decided: boolean
}

export const BREAK_GLASS_PEER_ID = '019a4000-0000-7000-8000-000000000001'

const BREAK_GLASS_RESTRICTED = ['body_progress', 'health_context', 'nutrition_intake']

function breakGlassTier(categories: string[]): 'standard' | 'restricted' {
  return categories.some((category) => BREAK_GLASS_RESTRICTED.includes(category))
    ? 'restricted'
    : 'standard'
}

export function breakGlassFile(
  overrides: Partial<BreakGlassFileFixture> = {},
): BreakGlassFileFixture {
  const categories = overrides.categories ?? ['nutrition_guidance']
  const tier = breakGlassTier(categories)
  const now = Date.now()
  return {
    id: nextAssignmentId(),
    requester_person_id: ACTOR_PERSON_ID,
    subject_person_id: SUBJECT_PERSON_ID,
    categories,
    purpose: 'customer_support_request',
    case_reference: 'CASE-2026-001',
    sensitivity_tier: tier,
    required_approvals: tier === 'restricted' ? 2 : 1,
    requested_duration_minutes: tier === 'restricted' ? 15 : 30,
    requested_at: new Date(now - 120_000).toISOString(),
    request_expires_at: new Date(now + 1_680_000).toISOString(),
    status: 'requested',
    window_starts_at: null,
    window_ends_at: null,
    closed_at: null,
    reviewed_at: null,
    review_outcome: null,
    approvals: [],
    exercise_count: 0,
    viewer_is_requester: true,
    viewer_has_decided: false,
    ...overrides,
  }
}

/** An open window with `minutes` left, so the countdown has something to say. */
export function openBreakGlassWindow(
  minutes: number,
  overrides: Partial<BreakGlassFileFixture> = {},
): BreakGlassFileFixture {
  const now = Date.now()
  const file = breakGlassFile(overrides)
  return {
    ...file,
    status: 'approved',
    reviewed_at: new Date(now - 60_000).toISOString(),
    review_outcome: 'approved',
    window_starts_at: new Date(now - 60_000).toISOString(),
    window_ends_at: new Date(now + minutes * 60_000).toISOString(),
    approvals: Array.from({ length: file.required_approvals }, (_unused, index) => ({
      approver_person_id: `019a4000-0000-7000-8000-00000000000${index + 1}`,
      decision: 'approved' as const,
      reason_code: 'REASON-APPROVED',
      decided_at: new Date(now - 60_000).toISOString(),
    })),
  }
}

export interface DiagnosisFixture {
  refusal?: { status: number; code: string }
  circuits: DiagnosisCircuitFixture[]
  operations: DiagnosisOperationFixture[]
  /** Rows per page, so the feed's cursor can be exercised. */
  pageSize?: number
}

export interface DiagnosisCircuitFixture {
  event_type: string
  state: string
  window_started_at: string
  success_count: number
  failure_count: number
  opened_until: string | null
}

export interface DiagnosisOperationFixture {
  source: 'notification' | 'command'
  reference_id: string
  subject_kind: string | null
  subject_id: string | null
  label: string
  state: string
  occurred_at: string
  attempt_count: number
  last_error_code: string | null
  resolved_at: string | null
}

export function diagnosisOperation(
  overrides: Partial<DiagnosisOperationFixture> = {},
): DiagnosisOperationFixture {
  return {
    source: 'notification',
    reference_id: nextAssignmentId(),
    subject_kind: 'invitation',
    subject_id: nextAssignmentId(),
    label: 'identity.invitation_issued.v1',
    state: 'retrying',
    occurred_at: new Date(Date.now() - 600_000).toISOString(),
    attempt_count: 3,
    last_error_code: 'smtp_timeout',
    resolved_at: null,
    ...overrides,
  }
}

export function diagnosisCircuit(
  overrides: Partial<DiagnosisCircuitFixture> = {},
): DiagnosisCircuitFixture {
  return {
    event_type: 'identity.invitation_issued.v1',
    state: 'closed',
    window_started_at: new Date(Date.now() - 3_600_000).toISOString(),
    success_count: 40,
    failure_count: 0,
    opened_until: null,
    ...overrides,
  }
}

/**
 * The projection the support surface answers with. `refusal` covers the common
 * real case: the duty is temporary, so an operator who could read yesterday is
 * refused today, and the screen has to say that rather than showing an error.
 */
export interface SupportFixture {
  refusal?: { status: number; code: string }
  people: SupportPersonFixture[]
}

export interface SupportPersonFixture {
  person_id: string
  account_status: string
  created_at: string
  activated_at: string | null
  contact_email_masked: string | null
  contact_phone_masked: string | null
  email_verified_at: string | null
  phone_verified_at: string | null
  has_access_account: boolean
  access_account_linked_at: string | null
  active_session_count: number
  last_seen_at: string | null
  has_professional_profile: boolean
  membership_count: number
  active_membership_count: number
  relationships_availability: 'available' | 'unknown' | 'not_modelled'
  plan_availability: 'available' | 'unknown' | 'not_modelled'
  premium_availability: 'available' | 'unknown' | 'not_modelled'
  permissions_availability: 'available' | 'unknown' | 'not_modelled'
}

export const SUPPORT_SUBJECT_ID = '019a5000-0000-7000-8000-000000000005'
export const SUPPORT_SUBJECT_EMAIL = 'subject.epsilon@example.test'

export function supportPerson(overrides: Partial<SupportPersonFixture> = {}): SupportPersonFixture {
  return {
    person_id: SUPPORT_SUBJECT_ID,
    account_status: 'active',
    created_at: '2026-01-04T10:00:00.000Z',
    activated_at: '2026-01-05T10:00:00.000Z',
    contact_email_masked: '••••••••on@example.test',
    contact_phone_masked: '••••••4567',
    email_verified_at: '2026-01-05T10:05:00.000Z',
    phone_verified_at: null,
    has_access_account: true,
    access_account_linked_at: '2026-01-05T10:01:00.000Z',
    active_session_count: 1,
    last_seen_at: '2026-09-09T18:00:00.000Z',
    has_professional_profile: false,
    membership_count: 2,
    active_membership_count: 1,
    relationships_availability: 'not_modelled',
    plan_availability: 'not_modelled',
    premium_availability: 'not_modelled',
    permissions_availability: 'not_modelled',
    ...overrides,
  }
}

/**
 * `/catalog/v1` is a surface of its own, not a Backoffice route, so the mock
 * answers it separately. The effective associations are derived from what the
 * curation commands published: two sources would let the screen show a state the
 * server never had.
 */
export interface CatalogueFixture {
  /** Every catalogue read is refused, as it is once the session ends. */
  refusal?: { status: number; code: string }
  disciplines: Array<{ code: string; name: string }>
  activityTypes: Array<{ id: string; discipline_code: string; code: string; name: string }>
}

export const CATALOGUE_ACTIVITY_TYPE_ID = '019a5000-0000-7000-8000-000000000301'

export function publishedCatalogue(): CatalogueFixture {
  return {
    disciplines: [
      { code: 'test_strength', name: 'Fuerza de prueba' },
      { code: 'test_endurance', name: 'Resistencia de prueba' },
    ],
    activityTypes: [
      {
        id: CATALOGUE_ACTIVITY_TYPE_ID,
        discipline_code: 'test_strength',
        code: 'test_strength_session',
        name: 'Sesión de fuerza de prueba',
      },
      {
        id: '019a5000-0000-7000-8000-000000000302',
        discipline_code: 'test_endurance',
        code: 'test_endurance_session',
        name: 'Sesión de resistencia de prueba',
      },
    ],
  }
}

export interface ResultContractFixture {
  /** The next command is refused with this code, once. */
  nextCommandFailure?: { status: number; code: string } | undefined
  /** Versions already published for a contract code, so the next one increments. */
  versions: Record<string, number>
  published: ResultContractRow[]
}

interface ResultContractRow {
  id: string
  contract_code: string
  version_number: number
  activity_family: string
  contract_schema_version: 1
  envelope: Record<string, unknown>
  minimums: Record<string, unknown>
  status: 'published' | 'deprecated'
  published_at: string
  fixtures: Array<{
    id: string
    kind: 'valid' | 'invalid'
    payload_schema_version: 1
    payload: Record<string, unknown>
    expected: string
  }>
  activity_type_bindings: Array<{
    id: string
    activity_type_id: string
    is_default: boolean
    valid_from: string
    valid_to: string | null
  }>
}

export interface PlatformAccessFixture {
  /** The inventory answers 403 when no reading duty is effective. */
  forbidden?: boolean
  roles: PlatformRoleFixture[]
  duties: PlatformDutyFixture[]
  /** The next command is refused with this code, once. */
  nextCommandFailure?: { status: number; code: string } | undefined
  /**
   * Rows per page. Absent means one page, as most tests want. The real
   * inventory pages on a cursor, and a screen that ignores it shows a truncated
   * list as if it were the whole team.
   */
  pageSize?: number
}

export interface PlatformRoleFixture {
  id: string
  person_id: string
  platform_role: 'allfit_admin'
  status: 'active' | 'revoked'
  granted_by_person_id: string
  granted_at: string
  revoked_by_person_id: string | null
  revoked_at: string | null
}

export interface PlatformDutyFixture {
  id: string
  person_id: string
  duty_code: string
  actor_mode: 'A10' | 'A11' | 'A12'
  status: 'scheduled' | 'active' | 'suspended' | 'expired' | 'revoked'
  valid_from: string
  valid_to: string
  required_aal: 2
  granted_by_person_id: string
  recertified_by_person_id: string | null
  recertified_at: string | null
  suspended_by_person_id: string | null
  suspended_at: string | null
  revoked_by_person_id: string | null
  revoked_at: string | null
  reason_code: string
}

interface SessionFixture {
  authenticated: true
  assurance_level: 2
  authentication_method: 'password_totp'
  operator: { given_name: string; family_name: string }
  assurance_verified_at: string
  inactivity_expires_at: string
  absolute_expires_at: string
}

interface AttemptFixture {
  next: 'totp-challenge' | 'totp-enrollment'
  expires_at: string
  enrollment?: { qr_code: string; manual_key: string }
}

export interface MockRequest {
  method: string
  path: string
  query: string
  headers: Record<string, string>
  body: unknown
}

export function createBackofficeFixture(
  overrides: Partial<BackofficeFixture> = {},
): BackofficeFixture {
  return {
    passwordOutcome: 'challenge',
    totpOutcome: 'success',
    catalogue: publishedCatalogue(),
    requests: [],
    ...overrides,
  }
}

export async function mockBackofficeApi(
  context: BrowserContext,
  fixture: BackofficeFixture,
): Promise<void> {
  await context.addInitScript(() => {
    localStorage.setItem(
      'allfit.analytics-v1',
      JSON.stringify({ decision: 'denied', notice_version: 'analytics-v1' }),
    )
  })
  await context.route('http://127.0.0.1:8080/catalog/v1/**', async (route) => {
    const request = toMockRequest(route)
    fixture.requests.push(request)
    if (request.method === 'OPTIONS') {
      await fulfill(route, 204)
      return
    }
    await routeCatalogue(route, request, fixture)
  })
  await context.route('http://127.0.0.1:8080/backoffice/v1/**', async (route) => {
    const request = toMockRequest(route)
    fixture.requests.push(request)

    if (request.method === 'OPTIONS') {
      await fulfill(route, 204)
      return
    }
    if (request.method === 'GET' && request.path === '/backoffice/v1/session') {
      if (fixture.sessionUnavailable) {
        await fulfill(route, 503, error('upstream-unavailable'))
        return
      }
      if (!fixture.session) {
        await fulfill(route, 401, error('unauthenticated'))
        return
      }
      await fulfill(route, 200, fixture.session)
      return
    }
    if (request.method === 'GET' && request.path === '/backoffice/v1/auth/attempt') {
      if (!fixture.attempt) {
        await fulfill(route, 401, error('unauthenticated'))
        return
      }
      await fulfill(route, 200, fixture.attempt)
      return
    }
    if (request.method === 'POST' && request.path === '/backoffice/v1/auth/password') {
      if (fixture.passwordOutcome === 'unauthenticated') {
        await fulfill(route, 401, error('unauthenticated'))
        return
      }
      if (fixture.passwordOutcome === 'disabled') {
        await fulfill(route, 503, error('service-degraded'))
        return
      }
      if (fixture.passwordOutcome === 'rate-limited') {
        await fulfill(route, 429, error('rate-limited'), { 'Retry-After': '2' })
        return
      }
      fixture.attempt =
        fixture.passwordOutcome === 'enrollment' ? enrollmentAttempt() : challengeAttempt()
      await fulfill(route, 200, fixture.attempt)
      return
    }
    if (request.method === 'POST' && request.path === '/backoffice/v1/auth/totp/verification') {
      if (fixture.totpOutcome === 'invalid') {
        fixture.invalidTotpCount = (fixture.invalidTotpCount ?? 0) + 1
        if (fixture.invalidTotpCount >= 5) fixture.attempt = undefined
        await fulfill(route, 401, error('unauthenticated'))
        return
      }
      if (fixture.totpOutcome === 'rate-limited') {
        await fulfill(route, 429, error('rate-limited'), { 'Retry-After': '2' })
        return
      }
      fixture.session = activeSession()
      fixture.attempt = undefined
      if (fixture.totpOutcome === 'network-lost-after-success') {
        fixture.totpOutcome = 'success'
        await route.abort('failed')
        return
      }
      await fulfill(route, 204)
      return
    }
    if (request.method === 'POST' && request.path === '/backoffice/v1/auth/logout') {
      if (fixture.logoutFails) {
        fixture.logoutFails = false
        await route.abort('failed')
        return
      }
      fixture.session = undefined
      await fulfill(route, 204)
      return
    }
    if (request.method === 'POST' && request.path === '/backoffice/v1/auth/password-resets') {
      await fulfill(route, 202)
      return
    }
    if (request.path.startsWith('/backoffice/v1/platform/')) {
      await routePlatformAccess(route, request, fixture)
      return
    }
    if (request.path.startsWith('/backoffice/v1/result-contracts')) {
      await routeResultContracts(route, request, fixture)
      return
    }
    if (request.path.startsWith('/backoffice/v1/break-glass/')) {
      await routeBreakGlass(route, request, fixture)
      return
    }
    if (request.path === '/backoffice/v1/scope-definitions') {
      await routeScopes(route, request, fixture)
      return
    }
    if (
      request.path === '/backoffice/v1/support/operations' ||
      request.path === '/backoffice/v1/support/delivery-circuits'
    ) {
      await routeDiagnosis(route, request, fixture)
      return
    }
    if (request.path.startsWith('/backoffice/v1/support/')) {
      await routeSupport(route, request, fixture)
      return
    }
    await fulfill(route, 404, error('not-found'))
  })
}

/**
 * The platform routes answer RFC 9457, unlike the authentication ones. The mock
 * reproduces that difference on purpose: a client that only understood the legacy
 * envelope would show a generic failure for every real refusal.
 */
async function routePlatformAccess(
  route: Route,
  request: MockRequest,
  fixture: BackofficeFixture,
): Promise<void> {
  const access = fixture.platformAccess ?? { roles: [], duties: [] }
  if (access.forbidden) {
    await fulfillProblem(route, 403, 'forbidden')
    return
  }
  if (request.method === 'GET') {
    const rows: Array<PlatformRoleFixture | PlatformDutyFixture> =
      request.path === '/backoffice/v1/platform/role-assignments' ? access.roles : access.duties
    await fulfill(route, 200, paginate(rows, access.pageSize, cursorOf(request)))
    return
  }
  const failure = access.nextCommandFailure
  if (failure) {
    access.nextCommandFailure = undefined
    await fulfillProblem(route, failure.status, failure.code)
    return
  }
  const segments = request.path.split('/').filter(Boolean)
  const resource = segments[3]
  const action = segments[5]
  const now = new Date().toISOString()

  if (resource === 'role-assignments' && action === 'revocation') {
    const target = access.roles.find((role) => role.id === segments[4])
    if (target) {
      target.status = 'revoked'
      target.revoked_at = now
      target.revoked_by_person_id = ACTOR_PERSON_ID
      // Withdrawing the base role closes every effective duty, as the command does.
      for (const duty of access.duties) {
        if (duty.person_id === target.person_id && !isClosedDuty(duty.status)) {
          duty.status = 'revoked'
          duty.revoked_at = now
          duty.revoked_by_person_id = ACTOR_PERSON_ID
        }
      }
    }
    await fulfill(route, 200, target ?? {})
    return
  }
  if (resource === 'duty-assignments' && (action === 'suspension' || action === 'revocation')) {
    const target = access.duties.find((duty) => duty.id === segments[4])
    if (target) {
      if (action === 'suspension') {
        target.status = 'suspended'
        target.suspended_at = now
        target.suspended_by_person_id = ACTOR_PERSON_ID
      } else {
        target.status = 'revoked'
        target.revoked_at = now
        target.revoked_by_person_id = ACTOR_PERSON_ID
      }
    }
    await fulfill(route, 200, target ?? {})
    return
  }
  if (resource === 'role-assignments') {
    const body = request.body as { person_id?: string } | undefined
    const created = platformRole({ person_id: body?.person_id ?? SUBJECT_PERSON_ID })
    access.roles.push(created)
    await fulfill(route, 201, created)
    return
  }
  if (resource === 'duty-assignments') {
    const body = request.body as
      | { person_id?: string; duty_code?: string; valid_to?: string; reason_code?: string }
      | undefined
    const created = platformDuty({
      person_id: body?.person_id ?? SUBJECT_PERSON_ID,
      duty_code: body?.duty_code ?? 'diagnose_support_metadata',
      valid_to: body?.valid_to ?? new Date(Date.now() + 30 * 86400000).toISOString(),
      reason_code: body?.reason_code ?? 'CASE-000',
    })
    access.duties.push(created)
    await fulfill(route, 201, created)
    return
  }
  await fulfillProblem(route, 404, 'not-found')
}

/**
 * The version number is assigned by the server, and publishing a new default
 * closes the previous association with a window instead of removing it. The mock
 * reproduces both, because they are what the screen shows as evidence.
 */
async function routeResultContracts(
  route: Route,
  request: MockRequest,
  fixture: BackofficeFixture,
): Promise<void> {
  const contracts = fixture.resultContracts ?? { versions: {}, published: [] }
  fixture.resultContracts = contracts
  const failure = contracts.nextCommandFailure
  if (failure) {
    contracts.nextCommandFailure = undefined
    await fulfillProblem(route, failure.status, failure.code)
    return
  }

  const segments = request.path.split('/').filter(Boolean)
  if (segments.length === 5) {
    const target = contracts.published.find((contract) => contract.id === segments[3])
    if (!target) {
      await fulfillProblem(route, 404, 'not-found')
      return
    }
    target.status = 'deprecated'
    for (const binding of target.activity_type_bindings) {
      binding.valid_to = binding.valid_to ?? new Date().toISOString()
    }
    await fulfill(route, 200, target)
    return
  }

  const body = request.body as
    | {
        contract_code?: string
        activity_family?: string
        envelope?: Record<string, unknown>
        minimums?: Record<string, unknown>
        fixtures?: Array<{
          kind: 'valid' | 'invalid'
          payload: Record<string, unknown>
          expected: string
        }>
        activity_type_id?: string
      }
    | undefined
  const code = body?.contract_code ?? 'test.contract'
  const version = (contracts.versions[code] ?? 0) + 1
  contracts.versions[code] = version
  const now = new Date().toISOString()
  const activityTypeId = body?.activity_type_id ?? SUBJECT_PERSON_ID

  // A previous default for the same activity type is closed, never deleted.
  const superseded = contracts.published
    .flatMap((contract) => contract.activity_type_bindings)
    .filter((binding) => binding.activity_type_id === activityTypeId && binding.valid_to === null)
  for (const binding of superseded) binding.valid_to = now

  const created: ResultContractRow = {
    id: nextAssignmentId(),
    contract_code: code,
    version_number: version,
    activity_family: body?.activity_family ?? 'strength',
    contract_schema_version: 1,
    envelope: body?.envelope ?? {},
    minimums: body?.minimums ?? {},
    status: 'published',
    published_at: now,
    fixtures: (body?.fixtures ?? []).map((entry) => ({
      id: nextAssignmentId(),
      kind: entry.kind,
      payload_schema_version: 1,
      payload: entry.payload,
      expected: entry.expected,
    })),
    activity_type_bindings: [
      ...superseded.map((binding) => ({ ...binding })),
      {
        id: nextAssignmentId(),
        activity_type_id: activityTypeId,
        is_default: true,
        valid_from: now,
        valid_to: null,
      },
    ],
  }
  contracts.published.push(created)
  await fulfill(route, 201, created)
}

async function routeCatalogue(
  route: Route,
  request: MockRequest,
  fixture: BackofficeFixture,
): Promise<void> {
  const catalogue = fixture.catalogue ?? { disciplines: [], activityTypes: [] }
  if (catalogue.refusal) {
    await fulfillProblem(route, catalogue.refusal.status, catalogue.refusal.code)
    return
  }
  const segments = request.path.split('/').filter(Boolean)
  if (segments[2] === 'disciplines') {
    await fulfill(route, 200, { items: catalogue.disciplines })
    return
  }
  if (segments[2] !== 'activity-types') {
    await fulfillProblem(route, 404, 'not-found')
    return
  }
  if (segments.length === 3) {
    await fulfill(route, 200, { items: catalogue.activityTypes })
    return
  }

  const activityTypeId = segments[3]
  if (activityTypeId === undefined) {
    await fulfillProblem(route, 404, 'not-found')
    return
  }
  if (!catalogue.activityTypes.some((activityType) => activityType.id === activityTypeId)) {
    await fulfillProblem(route, 404, 'not-found')
    return
  }
  await fulfill(route, 200, { items: effectiveAssociations(fixture, activityTypeId) })
}

/** Only associations still open, joined to the published version they carry. */
function effectiveAssociations(fixture: BackofficeFixture, activityTypeId: string) {
  return (fixture.resultContracts?.published ?? [])
    .filter((contract) => contract.status === 'published')
    .flatMap((contract) =>
      contract.activity_type_bindings
        .filter(
          (binding) => binding.activity_type_id === activityTypeId && binding.valid_to === null,
        )
        .map((binding) => ({
          result_contract_id: contract.id,
          contract_code: contract.contract_code,
          version_number: contract.version_number,
          activity_family: contract.activity_family,
          contract_schema_version: contract.contract_schema_version,
          envelope: contract.envelope,
          minimums: contract.minimums,
          is_default: binding.is_default,
          valid_from: binding.valid_from,
        })),
    )
}

/**
 * The cursor is opaque to the client, so the mock uses the simplest thing that
 * round-trips: the offset of the next row.
 */
function cursorOf(request: MockRequest): number {
  return Number(new URLSearchParams(request.query).get('cursor') ?? 0)
}

function paginate<T>(rows: T[], pageSize: number | undefined, offset: number) {
  if (!pageSize) return { data: rows, page: { has_more: false, next_cursor: null } }
  const page = rows.slice(offset, offset + pageSize)
  const next = offset + pageSize
  return {
    data: page,
    page: {
      has_more: next < rows.length,
      next_cursor: next < rows.length ? String(next) : null,
    },
  }
}

/**
 * Publishing appends the next version and never touches an earlier one, so the
 * E2E can assert what the story actually promises rather than what one screen
 * happens to render.
 */
/**
 * The two derived viewer fields. Deriving them here rather than letting a test set
 * them is what keeps the mock honest: the rule is the one the database trigger
 * enforces — an approver is never the requester and never decides twice.
 */
function breakGlassProjection(file: BreakGlassFileFixture) {
  const { viewer_has_decided, ...row } = file
  return {
    ...row,
    viewer_can_decide:
      file.status === 'requested' && !file.viewer_is_requester && !viewer_has_decided,
    viewer_can_exercise: file.status === 'approved' && file.viewer_is_requester,
  }
}

async function routeBreakGlass(
  route: Route,
  request: MockRequest,
  fixture: BackofficeFixture,
): Promise<void> {
  const glass = fixture.breakGlass ?? { files: [] }
  fixture.breakGlass = glass
  if (glass.refusal) {
    await fulfillProblem(route, glass.refusal.status, glass.refusal.code)
    return
  }
  const segments = request.path.split('/').filter(Boolean)

  if (request.method === 'GET') {
    const status = new URLSearchParams(request.query).get('status')
    const rows = status ? glass.files.filter((file) => file.status === status) : glass.files
    await fulfill(route, 200, { items: rows.map((file) => breakGlassProjection(file)) })
    return
  }

  const failure = glass.nextCommandFailure
  if (failure) {
    glass.nextCommandFailure = undefined
    await fulfillProblem(route, failure.status, failure.code)
    return
  }

  if (segments.length === 4) {
    const body = request.body as
      | {
          subject_person_id?: string
          categories?: string[]
          purpose?: string
          case_reference?: string
        }
      | undefined
    // Tier, quorum and duration are derived from the categories here exactly as the
    // server derives them, so a body that tried to set them would be ignored.
    const created = breakGlassFile({
      ...(body?.subject_person_id ? { subject_person_id: body.subject_person_id } : {}),
      ...(body?.categories ? { categories: body.categories } : {}),
      ...(body?.purpose ? { purpose: body.purpose } : {}),
      ...(body?.case_reference ? { case_reference: body.case_reference } : {}),
      viewer_is_requester: true,
    })
    glass.files.push(created)
    await fulfill(route, 201, breakGlassProjection(created))
    return
  }

  const file = glass.files.find((row) => row.id === segments[4])
  if (!file) {
    await fulfillProblem(route, 404, 'not-found')
    return
  }
  const action = segments[5]
  const now = new Date().toISOString()

  if (action === 'decisions') {
    if (file.viewer_is_requester || file.viewer_has_decided) {
      await fulfillProblem(route, 403, 'forbidden')
      return
    }
    if (file.status !== 'requested') {
      await fulfillProblem(route, 409, 'conflict')
      return
    }
    const body = request.body as
      { decision?: 'approved' | 'rejected'; reason_code?: string } | undefined
    const decision = body?.decision === 'rejected' ? 'rejected' : 'approved'
    file.approvals.push({
      approver_person_id: ACTOR_PERSON_ID,
      decision,
      reason_code: body?.reason_code ?? 'REASON-UNSTATED',
      decided_at: now,
    })
    file.viewer_has_decided = true
    file.reviewed_at = now
    file.review_outcome = decision
    const approved = file.approvals.filter((approval) => approval.decision === 'approved').length
    if (decision === 'rejected') {
      // One rejection is final. No later approval reopens the file.
      file.status = 'rejected'
    } else if (approved >= file.required_approvals) {
      file.status = 'approved'
      file.window_starts_at = now
      file.window_ends_at = new Date(
        Date.now() + file.requested_duration_minutes * 60_000,
      ).toISOString()
    }
    await fulfill(route, 200, breakGlassProjection(file))
    return
  }

  if (action === 'reads') {
    const body = request.body as { category?: string; resource_type?: string } | undefined
    const category = body?.category ?? ''
    const open =
      file.status === 'approved' &&
      file.window_ends_at !== null &&
      Date.parse(file.window_ends_at) > Date.now()
    const denial = !file.viewer_is_requester
      ? 'not_the_requester'
      : !open
        ? 'window_not_open'
        : !file.categories.includes(category)
          ? 'category_out_of_scope'
          : null
    // Only an authorised attempt raises the counter, matching the projection, which
    // counts events with result 'allowed'. A denial is recorded too, as an event.
    if (denial === null) file.exercise_count += 1
    await fulfill(route, 200, {
      outcome: denial === null ? 'content_unavailable' : 'denied',
      reason_code: denial ?? 'execution_and_nutrition_absent',
      break_glass_event_id: nextAssignmentId(),
      occurred_at: now,
      ...(category ? { category } : {}),
    })
    return
  }

  if (action === 'closure') {
    if (!file.viewer_is_requester) {
      await fulfillProblem(route, 403, 'forbidden')
      return
    }
    file.status = 'closed'
    file.closed_at = now
    await fulfill(route, 200, breakGlassProjection(file))
    return
  }

  await fulfillProblem(route, 404, 'not-found')
}

async function routeScopes(
  route: Route,
  request: MockRequest,
  fixture: BackofficeFixture,
): Promise<void> {
  const scopes = fixture.scopes ?? { definitions: [] }
  fixture.scopes = scopes
  if (scopes.refusal) {
    await fulfillProblem(route, scopes.refusal.status, scopes.refusal.code)
    return
  }
  if (request.method === 'GET') {
    await fulfill(route, 200, { items: scopes.definitions })
    return
  }

  const body = request.body as
    { scope_code?: string; rules?: ScopeDefinitionFixture['rules'] } | undefined
  const code = body?.scope_code ?? 'body_progress'
  const next =
    Math.max(
      0,
      ...scopes.definitions
        .filter((definition) => definition.scope_code === code)
        .map((definition) => definition.version_number),
    ) + 1
  const created = scopeDefinition({
    scope_code: code,
    version_number: next,
    published_at: new Date().toISOString(),
    ...(body?.rules ? { rules: body.rules } : {}),
  })
  scopes.definitions.push(created)
  await fulfill(route, 201, created)
}

/**
 * The diagnosis feed has no subject, so unlike every other support read it takes
 * no case reference. The mock reflects that rather than demanding one, or the
 * E2E would enforce a rule the API does not have.
 */
async function routeDiagnosis(
  route: Route,
  request: MockRequest,
  fixture: BackofficeFixture,
): Promise<void> {
  const diagnosis = fixture.diagnosis ?? { circuits: [], operations: [] }
  if (diagnosis.refusal) {
    await fulfillProblem(route, diagnosis.refusal.status, diagnosis.refusal.code)
    return
  }
  if (request.path.endsWith('/delivery-circuits')) {
    await fulfill(route, 200, { items: diagnosis.circuits })
    return
  }

  const parameters = new URLSearchParams(request.query)
  const source = parameters.get('source')
  const state = parameters.get('state')
  const matching = diagnosis.operations.filter(
    (operation) =>
      (source === null || operation.source === source) &&
      (state === null || operation.state === state),
  )
  const offset = Number(parameters.get('cursor') ?? 0)
  const size = diagnosis.pageSize ?? matching.length
  const page = matching.slice(offset, offset + size)
  const next = offset + size
  await fulfill(route, 200, {
    data: page,
    page: {
      has_more: next < matching.length,
      next_cursor: next < matching.length ? String(next) : null,
    },
  })
}

/**
 * The real surface refuses without a traceable case reference, so the mock does
 * too: a screen that forgot to send one would otherwise pass its own E2E.
 */
async function routeSupport(
  route: Route,
  request: MockRequest,
  fixture: BackofficeFixture,
): Promise<void> {
  const support = fixture.support ?? { people: [] }
  if (support.refusal) {
    await fulfillProblem(route, support.refusal.status, support.refusal.code)
    return
  }

  const parameters = new URLSearchParams(request.query)
  const caseReference = parameters.get('case_reference') ?? ''
  if (!/^[A-Z][A-Z0-9_-]{2,63}$/.test(caseReference)) {
    await fulfillProblem(route, 400, 'invalid-request')
    return
  }

  const segments = request.path.split('/').filter(Boolean)
  if (segments.length === 5) {
    const found = support.people.find((person) => person.person_id === segments[4])
    if (!found) {
      await fulfillProblem(route, 404, 'not-found')
      return
    }
    await fulfill(route, 200, found)
    return
  }

  const lookups = (['identifier', 'email', 'phone'] as const).filter((kind) => parameters.has(kind))
  if (lookups.length !== 1) {
    await fulfillProblem(route, 400, 'invalid-request')
    return
  }
  const [kind] = lookups
  const value = parameters.get(kind ?? 'email') ?? ''
  const found = support.people.find((person) =>
    kind === 'identifier'
      ? person.person_id === value
      : kind === 'email'
        ? value === SUPPORT_SUBJECT_EMAIL
        : value === '+573001234567',
  )
  await fulfill(route, 200, {
    outcome: found ? 'found' : 'not_found',
    items: found ? [found] : [],
  })
}

function isClosedDuty(status: PlatformDutyFixture['status']): boolean {
  return status === 'expired' || status === 'revoked'
}

export const ACTOR_PERSON_ID = '019a3000-0000-7000-8000-000000000001'
export const SUBJECT_PERSON_ID = '019a3000-0000-7000-8000-000000000002'

let identifierSequence = 0

function nextAssignmentId(): string {
  identifierSequence += 1
  return `019a3000-0000-7000-8000-${String(identifierSequence).padStart(12, '0')}`
}

export function platformRole(overrides: Partial<PlatformRoleFixture> = {}): PlatformRoleFixture {
  return {
    id: nextAssignmentId(),
    person_id: SUBJECT_PERSON_ID,
    platform_role: 'allfit_admin',
    status: 'active',
    granted_by_person_id: ACTOR_PERSON_ID,
    granted_at: new Date().toISOString(),
    revoked_by_person_id: null,
    revoked_at: null,
    ...overrides,
  }
}

/** The mode is derived from the duty code by a CHECK, never chosen. */
export function actorModeFor(dutyCode: string): PlatformDutyFixture['actor_mode'] {
  if (
    [
      'curate_global_catalog',
      'verify_professional_credentials',
      'manage_platform_commercial',
    ].includes(dutyCode)
  ) {
    return 'A11'
  }
  if (
    [
      'manage_platform_access',
      'audit_platform_access',
      'approve_break_glass',
      'audit_break_glass',
      'manage_privacy_requests',
    ].includes(dutyCode)
  ) {
    return 'A12'
  }
  return 'A10'
}

export function platformDuty(overrides: Partial<PlatformDutyFixture> = {}): PlatformDutyFixture {
  const now = Date.now()
  const dutyCode = overrides.duty_code ?? 'diagnose_support_metadata'
  return {
    id: nextAssignmentId(),
    person_id: SUBJECT_PERSON_ID,
    duty_code: dutyCode,
    actor_mode: actorModeFor(dutyCode),
    status: 'active',
    valid_from: new Date(now).toISOString(),
    valid_to: new Date(now + 30 * 86400000).toISOString(),
    required_aal: 2,
    granted_by_person_id: ACTOR_PERSON_ID,
    recertified_by_person_id: null,
    recertified_at: null,
    suspended_by_person_id: null,
    suspended_at: null,
    revoked_by_person_id: null,
    revoked_at: null,
    reason_code: 'CASE-2026-001',
    ...overrides,
  }
}

export function activeSession(): SessionFixture {
  const now = Date.now()
  return {
    authenticated: true,
    assurance_level: 2,
    authentication_method: 'password_totp',
    operator: { given_name: 'Ada', family_name: 'Lovelace' },
    assurance_verified_at: new Date(now).toISOString(),
    inactivity_expires_at: new Date(now + 15 * 60_000).toISOString(),
    absolute_expires_at: new Date(now + 8 * 60 * 60_000).toISOString(),
  }
}

export function challengeAttempt(): AttemptFixture {
  return {
    next: 'totp-challenge',
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  }
}

export function enrollmentAttempt(): AttemptFixture {
  return {
    next: 'totp-enrollment',
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    enrollment: {
      qr_code:
        'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="180" height="180"%3E%3Crect width="180" height="180" fill="white"/%3E%3Cpath d="M20 20h45v45H20zM115 20h45v45h-45zM20 115h45v45H20zM80 80h20v20H80zM115 115h20v20h-20z" fill="%23030713"/%3E%3C/svg%3E',
      manual_key: 'JBSWY3DPEHPK3PXP',
    },
  }
}

function toMockRequest(route: Route): MockRequest {
  const request = route.request()
  const url = new URL(request.url())
  return {
    method: request.method(),
    path: url.pathname,
    query: url.search,
    headers: request.headers(),
    body: parseBody(request.postData()),
  }
}

function parseBody(value: string | null): unknown {
  if (!value) return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

async function fulfillProblem(route: Route, status: number, code: string): Promise<void> {
  await fulfill(route, status, {
    type: `https://errors.allfit.invalid/${code}`,
    title: code,
    status,
    request_id: '01JEXAMPLE0000000000000000',
  })
}

async function fulfill(
  route: Route,
  status: number,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<void> {
  await route.fulfill({
    status,
    body: body === undefined ? '' : JSON.stringify(body),
    headers: {
      'Access-Control-Allow-Origin': BACKOFFICE_ORIGIN,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key, Command-Id',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Expose-Headers': 'Retry-After',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
  })
}

function error(code: string): { error: { code: string } } {
  return { error: { code } }
}
