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
  accessLog?: AccessLogFixture
  organizationDirectory?: OrganizationDirectoryFixture
  organizationHandover?: OrganizationHandoverFixture
  organizationFiles?: OrganizationFileFixture
  teamInvitations?: TeamInvitationFixture
  accountRecovery?: AccountRecoveryFixture
  globalCatalogue?: GlobalCatalogueFixture
  platformPlans?: PlatformPlansFixture
  attention?: AttentionFixture
  business?: BusinessFixture
  verification?: VerificationFixture
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
  /**
   * The reason the next exercise is denied, consumed once. It stands for the real
   * race the screen cannot prevent: the duty is withdrawn, or the window lapses,
   * between the answer that offered the read and the click that took it.
   */
  nextExerciseDenial?: string | undefined
  /** What the subject has recorded. Only a body_progress read returns it. */
  bodyProgress?: BodyProgressRecordFixture[]
  /** What the subject has declared. Only a health_context read returns it. */
  healthContext?: HealthContextClaimFixture[]
  files: BreakGlassFileFixture[]
}

export interface HealthContextClaimFixture {
  id: string
  context_type: string
  description: string
  body_area: string | null
  provenance: string
  valid_from: string
  valid_to: string | null
  recorded_at: string
}

export interface BodyProgressRecordFixture {
  id: string
  metric_code: string
  value: number
  unit_code: string
  original_value: number | null
  original_unit_code: string | null
  measured_on: string
  has_media: boolean
  recorded_at: string
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

/**
 * The access log.
 *
 * The mock applies the filters and the per-case disqualification the way the two
 * closed queries do, and counts what it removed. A mock that returned a canned
 * page would let the screen pass while hiding the one failure that matters: an
 * incomplete answer that looks complete.
 */
export interface AccessLogFixture {
  refusal?: { status: number; code: string }
  events: AccessLogEventFixture[]
}

export interface AccessLogEventFixture {
  actor_person_id: string
  subject_person_id: string | null
  resource: string
  resource_id: string | null
  purpose: string
  result: string
  scope_code: string | null
  scope_version: number | null
  access_mode: string
  occurred_at: string
  /**
   * Whether this record belongs to a break-glass window the viewing auditor
   * requested or approved. The server derives it from the evidence rows; here it
   * is declared, because the E2E has no break-glass case to derive it from.
   */
  withheld_from_viewer?: boolean
}

export function accessEvent(overrides: Partial<AccessLogEventFixture> = {}): AccessLogEventFixture {
  return {
    actor_person_id: SUBJECT_PERSON_ID,
    subject_person_id: SUPPORT_SUBJECT_ID,
    resource: 'support.person_operational_state',
    resource_id: null,
    purpose: 'customer_support_request',
    result: 'allowed',
    scope_code: null,
    scope_version: null,
    access_mode: 'organization_operational',
    occurred_at: new Date(Date.now() - 3_600_000).toISOString(),
    withheld_from_viewer: false,
    ...overrides,
  }
}

/**
 * The organization directory.
 *
 * The mock keeps the closed read's rules rather than the screen's expectations: a
 * search shorter than two characters or an unknown state is refused, the search
 * matches the display name only and literally, and pages follow the name order
 * through an opaque cursor. Each organization carries a legal name so a test can
 * prove it is neither searched nor returned.
 */
export interface OrganizationDirectoryFixture {
  refusal?: { status: number; code: string }
  pageSize?: number
  organizations: DirectoryOrganizationFixture[]
}

export type DirectoryOrganizationStatus = 'unclaimed' | 'active' | 'closed' | 'cancelled'

export interface DirectoryOrganizationFixture {
  organization_id: string
  display_name: string
  legal_name: string
  type_code: string
  type_name: string
  status: DirectoryOrganizationStatus
  created_at: string
  claimed_at: string | null
  cancelled_at: string | null
  active_member_count: number
  site_count: number
  people_served: number | null
}

const DIRECTORY_STATUSES: readonly string[] = ['unclaimed', 'active', 'closed', 'cancelled']
let directorySequence = 0

/** The lifecycle dates follow the state, the way the table's check constraint requires. */
export function directoryOrganization(
  overrides: Partial<DirectoryOrganizationFixture> = {},
): DirectoryOrganizationFixture {
  directorySequence += 1
  const status = overrides.status ?? 'active'
  const createdAt = new Date(Date.now() - 30 * 86_400_000).toISOString()
  return {
    organization_id: `019a6000-0000-7000-8000-${String(directorySequence).padStart(12, '0')}`,
    display_name: `Gimnasio ${directorySequence}`,
    legal_name: `Razón social ${directorySequence} S.A.S.`,
    type_code: 'gym',
    type_name: 'Gimnasio',
    status,
    created_at: createdAt,
    claimed_at: status === 'active' || status === 'closed' ? createdAt : null,
    cancelled_at: status === 'cancelled' ? new Date(Date.now() - 86_400_000).toISOString() : null,
    active_member_count: status === 'active' ? 1 : 0,
    site_count: 1,
    people_served: null,
    ...overrides,
  }
}

/**
 * Gym files.
 *
 * The mock returns the projection as the database closes it: identifiers and roles,
 * never names, a natural person's address withheld, and what has no table yet as
 * `not_modelled`. It refuses a query it cannot read rather than ignoring it.
 */
export interface OrganizationFileFixture {
  refusal?: { status: number; code: string }
  files: OrganizationFileRecordFixture[]
}

export interface OrganizationFileRecordFixture {
  organization: {
    organization_id: string
    display_name: string
    type_code: 'professional_practice' | 'gym' | 'studio'
    type_name: string
    status: 'unclaimed' | 'active' | 'closed' | 'cancelled'
    party_kind: 'natural_person' | 'legal_entity'
    legal_name: string | null
    created_at: string
    claimed_at: string | null
    cancelled_at: string | null
  }
  owner: { person_id: string; membership_id: string; since: string } | null
  team: Array<{
    membership_id: string
    person_id: string
    roles: Array<'owner' | 'admin' | 'coach' | 'staff'>
    joined_at: string
  }>
  team_counts: { active: number; terminated: number }
  team_truncated: boolean
  sites: Array<{
    site_id: string
    name: string
    address: string | null
    address_withheld: boolean
    status: 'active' | 'inactive'
  }>
  people_served: number | null
  plans_availability: 'not_modelled'
  payment_method_availability: 'not_modelled'
  premium_availability: 'not_modelled'
}

let fileSequence = 0

export function organizationFileRecord(
  overrides: Partial<OrganizationFileRecordFixture> = {},
): OrganizationFileRecordFixture {
  fileSequence += 1
  const suffix = String(fileSequence).padStart(12, '0')
  return {
    organization: {
      organization_id: `019a9200-0000-7000-8000-${suffix}`,
      display_name: `Ficha Norte ${fileSequence}`,
      type_code: 'gym',
      type_name: 'Gimnasio',
      status: 'active',
      party_kind: 'legal_entity',
      legal_name: 'Norte Fitness SAS',
      created_at: '2026-06-01T12:00:00.000Z',
      claimed_at: '2026-06-01T12:00:00.000Z',
      cancelled_at: null,
    },
    owner: null,
    team: [],
    team_counts: { active: 0, terminated: 0 },
    team_truncated: false,
    sites: [],
    people_served: null,
    plans_availability: 'not_modelled',
    payment_method_availability: 'not_modelled',
    premium_availability: 'not_modelled',
    ...overrides,
  }
}

/**
 * Organization handovers.
 *
 * The mock keeps the commands' rules rather than the screen's expectations: a
 * natural person is never named, only an organization nobody claimed is resent or
 * cancelled, cancelling converges, a live invitation is resent as it is and a lapsed
 * one is replaced, and a repeated command id returns the same gym instead of a
 * second one.
 */
export interface OrganizationHandoverFixture {
  refusal?: { status: number; code: string }
  /** Consumed once: the owner accepts between the screen loading and the command. */
  nextCommandClaimedElsewhere?: boolean | undefined
  /** Consumed once: the creation reaches the server but its answer is lost. */
  nextCreateNetworkFailure?: boolean | undefined
  handovers: HandoverRecordFixture[]
  createdByCommand?: Record<string, string>
}

export interface HandoverRecordFixture {
  organization_id: string
  display_name: string
  type_code: 'professional_practice' | 'gym' | 'studio'
  type_name: string
  party_kind: 'natural_person' | 'legal_entity'
  legal_name: string | null
  status: 'unclaimed' | 'active' | 'closed' | 'cancelled'
  created_at: string
  claimed_at: string | null
  cancelled_at: string | null
  site: { site_id: string; name: string; address: string | null } | null
  invitation: {
    invitation_id: string
    status: 'pending' | 'completed' | 'revoked' | 'expired'
    intent_status: 'pending' | 'accepted' | 'rejected' | 'revoked' | 'expired'
    contact_hint: string
    expires_at: string
  } | null
}

let handoverSequence = 0

export function handoverRecord(
  overrides: Partial<HandoverRecordFixture> = {},
): HandoverRecordFixture {
  handoverSequence += 1
  const suffix = String(handoverSequence).padStart(12, '0')
  return {
    organization_id: `019a7000-0000-7000-8000-${suffix}`,
    display_name: `Gimnasio entregado ${handoverSequence}`,
    type_code: 'gym',
    type_name: 'Gimnasio',
    party_kind: 'legal_entity',
    legal_name: 'Entregado SAS',
    status: 'unclaimed',
    created_at: new Date(Date.now() - 86_400_000).toISOString(),
    claimed_at: null,
    cancelled_at: null,
    site: null,
    invitation: {
      invitation_id: `019a7100-0000-7000-8000-${suffix}`,
      status: 'pending',
      intent_status: 'pending',
      contact_hint: 'o***@example.test',
      expires_at: new Date(Date.now() + 6 * 86_400_000).toISOString(),
    },
    ...overrides,
  }
}

/**
 * Credential verification.
 *
 * The mock keeps the command's rules rather than the screen's expectations: a
 * decision needs a result, a conflicted viewer is refused, a decided request
 * answers 409, and a lapsed source cannot produce verified. The validity is
 * derived here the way the server derives it, so a screen that tried to send one
 * would not change what comes back.
 */
export interface VerificationFixture {
  refusal?: { status: number; code: string }
  /** Consumed once: somebody else decides the request between load and submit. */
  nextDecisionDecidedElsewhere?: boolean | undefined
  requests: VerificationRequestFixture[]
  renewals: RenewalDueFixture[]
}

export interface VerificationRequestFixture {
  request_id: string
  kind: 'initial' | 'renewal'
  requested_at: string
  credential_id: string
  credential_type_code: string
  credential_type_name: string
  issuer: string
  credential_name: string
  credential_identifier: string | null
  issued_on: string | null
  expires_on: string | null
  verification_url: string | null
  holder_person_id: string
  holder_given_name: string
  holder_family_name: string
  suggested_method: 'official_registry_lookup' | 'issuer_confirmation'
  previous_result: string | null
  previous_valid_to: string | null
  viewer_can_decide: boolean
  status: 'pending' | 'resolved' | 'cancelled'
}

export interface RenewalDueFixture {
  credential_id: string
  credential_type_code: string
  credential_type_name: string
  credential_name: string
  issuer: string
  holder_person_id: string
  holder_given_name: string
  holder_family_name: string
  last_valid_to: string
}

export function verificationRequest(
  overrides: Partial<VerificationRequestFixture> = {},
): VerificationRequestFixture {
  return {
    request_id: nextAssignmentId(),
    kind: 'initial',
    requested_at: new Date(Date.now() - 86_400_000).toISOString(),
    credential_id: nextAssignmentId(),
    credential_type_code: 'professional_license',
    credential_type_name: 'Licencia o matrícula profesional',
    issuer: 'Colegio Colombiano de Fisioterapeutas',
    credential_name: 'Tarjeta profesional',
    credential_identifier: 'TP-12345',
    issued_on: '2019-06-01',
    expires_on: null,
    verification_url: 'https://registro.example.test/TP-12345',
    holder_person_id: SUBJECT_PERSON_ID,
    holder_given_name: 'Valentina',
    holder_family_name: 'Ríos',
    suggested_method: 'official_registry_lookup',
    previous_result: null,
    previous_valid_to: null,
    viewer_can_decide: true,
    status: 'pending',
    ...overrides,
  }
}

export function renewalDue(overrides: Partial<RenewalDueFixture> = {}): RenewalDueFixture {
  return {
    credential_id: nextAssignmentId(),
    credential_type_code: 'academic_degree',
    credential_type_name: 'Título académico',
    credential_name: 'Fisioterapia',
    issuer: 'Universidad Nacional',
    holder_person_id: SUBJECT_PERSON_ID,
    holder_given_name: 'Valentina',
    holder_family_name: 'Ríos',
    last_valid_to: new Date(Date.now() - 10 * 86_400_000).toISOString(),
    ...overrides,
  }
}

/**
 * A gym's team invitations. The mock reproduces the command's rules: a live
 * invitation is redelivered as itself, an expired resendable one is replaced by a new
 * one Allfit signs while the old one stops being resendable, and anything else is a
 * conflict.
 */
export interface TeamInvitationFixture {
  refusal?: { status: number; code: string }
  resendRefusal?: { status: number; code: string }
  /** Resends dropped by the network before any answer, consumed one per attempt. */
  lostResends?: number
  lists: Record<string, TeamInvitationRecordFixture[]>
}

export interface TeamInvitationRecordFixture {
  invitation_id: string
  state: 'pending' | 'expired' | 'accepted' | 'rejected' | 'revoked'
  proposed_role_code: 'admin' | 'coach' | 'staff'
  contact_hint: string
  created_at: string
  expires_at: string
  issued_by: 'member' | 'allfit'
  reissues_invitation_id: string | null
  resendable: boolean
  last_resent_at: string | null
}

export function teamInvitationRecord(
  overrides: Partial<TeamInvitationRecordFixture> = {},
): TeamInvitationRecordFixture {
  return {
    invitation_id: nextAssignmentId(),
    state: 'pending',
    proposed_role_code: 'coach',
    contact_hint: 'l***@example.test',
    created_at: new Date(Date.now() - 86_400_000).toISOString(),
    expires_at: new Date(Date.now() + 6 * 86_400_000).toISOString(),
    issued_by: 'member',
    reissues_invitation_id: null,
    resendable: true,
    last_resent_at: null,
    ...overrides,
  }
}

/**
 * How the business is going. Whether a figure can be given at all is the
 * database's decision, so the fixture states the answer rather than deriving it.
 */
export interface BusinessFixture {
  refusal?: { status: number; code: string }
  panel?: BusinessPanelFixture
}

export interface BusinessMetricFixture {
  key: string
  availability: 'available' | 'below_threshold' | 'not_modelled'
  value: number | null
  reason: string | null
  period: { kind: 'total' | 'week' | 'month'; from: string | null; to: string }
}

export interface BusinessPanelFixture {
  generated_at: string
  minimum_aggregate: number
  metrics: BusinessMetricFixture[]
}

/** One of each answer: a figure, a true zero, a group too small, and four gaps. */
export function businessPanelRecord(
  overrides: Partial<BusinessPanelFixture> = {},
): BusinessPanelFixture {
  const now = new Date()
  const to = now.toISOString()
  const week = new Date(now.getTime() - 7 * 86_400_000).toISOString()
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const total = { kind: 'total', from: null, to } as const
  const lastWeek = { kind: 'week', from: week, to } as const

  return {
    generated_at: to,
    minimum_aggregate: 5,
    metrics: [
      {
        key: 'registered_people',
        availability: 'available',
        value: 1284,
        reason: null,
        period: total,
      },
      {
        key: 'new_people_this_week',
        availability: 'available',
        value: 37,
        reason: null,
        period: lastWeek,
      },
      {
        key: 'active_people_this_week',
        availability: 'not_modelled',
        value: null,
        reason: 'space_sessions_not_recorded',
        period: lastWeek,
      },
      {
        key: 'studio_active_professionals_this_week',
        availability: 'below_threshold',
        value: null,
        reason: null,
        period: lastWeek,
      },
      { key: 'organizations', availability: 'available', value: 12, reason: null, period: total },
      {
        key: 'operating_organizations',
        availability: 'available',
        value: 9,
        reason: null,
        period: total,
      },
      {
        key: 'unclaimed_organizations',
        availability: 'available',
        value: 0,
        reason: null,
        period: total,
      },
      {
        key: 'active_subscriptions',
        availability: 'not_modelled',
        value: null,
        reason: 'payments_not_modelled',
        period: total,
      },
      {
        key: 'billed_this_month',
        availability: 'not_modelled',
        value: null,
        reason: 'payments_not_modelled',
        period: { kind: 'month', from: month, to },
      },
      {
        key: 'premium_people',
        availability: 'not_modelled',
        value: null,
        reason: 'payments_not_modelled',
        period: total,
      },
    ],
    ...overrides,
  }
}

/**
 * The attention panel. Which notices are withheld is the database's decision, so
 * the fixture states the answer rather than simulating duties.
 */
export interface AttentionFixture {
  refusal?: { status: number; code: string }
  panel?: AttentionPanelFixture
}

type NoticeAvailability = 'available' | 'withheld'

export interface AttentionPanelFixture {
  generated_at: string
  billing: { availability: 'not_modelled' }
  credential_verifications: {
    availability: NoticeAvailability
    pending_count: number | null
    oldest_requested_at: string | null
    renewals_due_count: number | null
  }
  unclaimed_organizations: {
    availability: NoticeAvailability
    count: number | null
    oldest_created_at: string | null
    needs_follow_up_count: number | null
  }
  repeated_failures: {
    availability: NoticeAvailability
    window_hours: 24
    groups: Array<{
      source: 'notification' | 'command'
      label: string
      affected: number
      failures: number
      latest_occurred_at: string
      last_error_code: string | null
    }> | null
    groups_truncated: boolean | null
    open_circuits: Array<{
      event_type: string
      state: 'open' | 'half_open'
      failure_count: number
      opened_until: string | null
    }> | null
  }
}

/** Support's view: gyms and failures available, verifications withheld. */
export function attentionPanelRecord(
  overrides: Partial<AttentionPanelFixture> = {},
): AttentionPanelFixture {
  return {
    generated_at: new Date().toISOString(),
    billing: { availability: 'not_modelled' },
    credential_verifications: {
      availability: 'withheld',
      pending_count: null,
      oldest_requested_at: null,
      renewals_due_count: null,
    },
    unclaimed_organizations: {
      availability: 'available',
      count: 2,
      oldest_created_at: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      needs_follow_up_count: 1,
    },
    repeated_failures: {
      availability: 'available',
      window_hours: 24,
      groups: [
        {
          source: 'notification',
          label: 'identity.invitation_issued.v1',
          affected: 2,
          failures: 5,
          latest_occurred_at: new Date(Date.now() - 600_000).toISOString(),
          last_error_code: 'smtp_timeout',
        },
      ],
      groups_truncated: false,
      open_circuits: [
        {
          event_type: 'identity.invitation_issued.v1',
          state: 'open',
          failure_count: 12,
          opened_until: new Date(Date.now() + 3_600_000).toISOString(),
        },
      ],
    },
    ...overrides,
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
    if (
      request.path === '/backoffice/v1/verification-requests' ||
      request.path === '/backoffice/v1/verifications' ||
      request.path === '/backoffice/v1/verification-renewals'
    ) {
      await routeVerification(route, request, fixture)
      return
    }
    if (request.path === '/backoffice/v1/access-events') {
      await routeAccessLog(route, request, fixture)
      return
    }
    if (
      /^\/backoffice\/v1\/organizations\/[^/]+\/team-invitations(\/[^/]+\/resends)?$/.test(
        request.path,
      )
    ) {
      await routeTeamInvitations(route, request, fixture)
      return
    }
    if (request.method === 'GET' && /^\/backoffice\/v1\/organizations\/[^/]+$/.test(request.path)) {
      await routeOrganizationFile(route, request, fixture)
      return
    }
    if (request.path === '/backoffice/v1/organizations' && request.method === 'GET') {
      await routeOrganizationDirectory(route, request, fixture)
      return
    }
    if (request.path.startsWith('/backoffice/v1/organizations')) {
      await routeOrganizationHandover(route, request, fixture)
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
    if (request.path === '/backoffice/v1/support/attention') {
      await routeAttention(route, fixture)
      return
    }
    if (request.path === '/backoffice/v1/support/business') {
      await routeBusiness(route, fixture)
      return
    }
    if (
      request.path === '/backoffice/v1/support/operations' ||
      request.path === '/backoffice/v1/support/delivery-circuits'
    ) {
      await routeDiagnosis(route, request, fixture)
      return
    }
    if (
      /^\/backoffice\/v1\/people\/[^/]+\/account-recover(y|ies(\/[^/]+\/(resends|cancellation))?)$/.test(
        request.path,
      )
    ) {
      await routeAccountRecovery(route, request, fixture)
      return
    }
    if (/^\/backoffice\/v1\/catalogue(\/[^/]+(\/[^/]+\/archival)?)?$/.test(request.path)) {
      await routeGlobalCatalogue(route, request, fixture)
      return
    }
    if (request.path.startsWith('/backoffice/v1/platform-plans')) {
      await routePlatformPlans(route, request, fixture)
      return
    }
    if (request.path.startsWith('/backoffice/v1/support/')) {
      await routeSupport(route, request, fixture)
      return
    }
    await fulfill(route, 404, error('not-found'))
  })
}

/** Counters with no subject: like the API, the mock takes no case reference. */
async function routeAttention(route: Route, fixture: BackofficeFixture): Promise<void> {
  const attention = fixture.attention ?? {}
  if (attention.refusal) {
    await fulfillProblem(route, attention.refusal.status, attention.refusal.code)
    return
  }
  await fulfill(route, 200, attention.panel ?? attentionPanelRecord())
}

async function routeBusiness(route: Route, fixture: BackofficeFixture): Promise<void> {
  const business = fixture.business ?? {}
  if (business.refusal) {
    await fulfillProblem(route, business.refusal.status, business.refusal.code)
    return
  }
  await fulfill(route, 200, business.panel ?? businessPanelRecord())
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
  // The status is effective, not stored: a window whose end has passed and a
  // request nobody decided in time both read as expired, the way
  // `support.effective_break_glass_status` computes them.
  const status = breakGlassEffectiveStatus(file)
  return {
    ...row,
    status,
    viewer_can_decide: status === 'requested' && !file.viewer_is_requester && !viewer_has_decided,
    viewer_can_exercise: status === 'approved' && file.viewer_is_requester,
  }
}

function breakGlassEffectiveStatus(file: BreakGlassFileFixture): string {
  const now = Date.now()
  if (file.status === 'approved' && file.window_ends_at !== null) {
    return Date.parse(file.window_ends_at) <= now ? 'expired' : 'approved'
  }
  if (file.status === 'requested') {
    return Date.parse(file.request_expires_at) <= now ? 'expired' : 'requested'
  }
  return file.status
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
    if (breakGlassEffectiveStatus(file) !== 'requested') {
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
    // A category that returns content reads only its own table.
    const readable: Record<string, string> = {
      body_progress: 'identity.body_progress_records',
      health_context: 'identity.health_context_claims',
    }
    const ownTable = readable[category]
    const forced = glass.nextExerciseDenial
    glass.nextExerciseDenial = undefined
    const denial =
      forced ??
      (!file.viewer_is_requester
        ? 'not_the_requester'
        : breakGlassEffectiveStatus(file) !== 'approved'
          ? 'window_not_open'
          : !file.categories.includes(category)
            ? 'category_out_of_scope'
            : ownTable !== undefined && body?.resource_type !== ownTable
              ? 'resource_out_of_scope'
              : null)
    // Only an authorised attempt raises the counter, matching the projection, which
    // counts events with result 'allowed'. A denial is recorded too, as an event.
    if (denial === null) file.exercise_count += 1
    const event = {
      break_glass_event_id: nextAssignmentId(),
      occurred_at: now,
      ...(category ? { category } : {}),
    }
    if (denial !== null) {
      await fulfill(route, 200, { outcome: 'denied', reason_code: denial, ...event })
    } else if (category === 'body_progress') {
      await fulfill(route, 200, {
        outcome: 'allowed',
        reason_code: 'authorized_exercise',
        ...event,
        content: { body_progress: glass.bodyProgress ?? [] },
      })
    } else if (category === 'health_context') {
      await fulfill(route, 200, {
        outcome: 'allowed',
        reason_code: 'authorized_exercise',
        ...event,
        content: { health_context: glass.healthContext ?? [] },
      })
    } else {
      await fulfill(route, 200, {
        outcome: 'content_unavailable',
        reason_code: 'execution_and_nutrition_absent',
        ...event,
      })
    }
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

async function routeAccessLog(
  route: Route,
  request: MockRequest,
  fixture: BackofficeFixture,
): Promise<void> {
  const log = fixture.accessLog ?? { events: [] }
  fixture.accessLog = log
  if (log.refusal) {
    await fulfillProblem(route, log.refusal.status, log.refusal.code)
    return
  }

  const parameters = new URLSearchParams(request.query)
  const actor = parameters.get('actor_person_id')
  const subject = parameters.get('subject_person_id')
  const from = parameters.get('from')
  const to = parameters.get('to')

  const matching = log.events.filter(
    (event) =>
      (actor === null || event.actor_person_id === actor) &&
      (subject === null || event.subject_person_id === subject) &&
      (from === null || Date.parse(event.occurred_at) >= Date.parse(from)) &&
      (to === null || Date.parse(event.occurred_at) < Date.parse(to)),
  )

  // The count describes the same filtered set as the list, which is the whole
  // reason the real queries share one predicate.
  await fulfill(route, 200, {
    items: matching
      .filter((event) => event.withheld_from_viewer !== true)
      .map(({ withheld_from_viewer: _withheld, ...row }) => row),
    withheld_from_you: matching.filter((event) => event.withheld_from_viewer === true).length,
  })
}

async function routeOrganizationDirectory(
  route: Route,
  request: MockRequest,
  fixture: BackofficeFixture,
): Promise<void> {
  const directory = fixture.organizationDirectory ?? { organizations: [] }
  fixture.organizationDirectory = directory
  if (directory.refusal) {
    await fulfillProblem(route, directory.refusal.status, directory.refusal.code)
    return
  }
  if (request.method !== 'GET') {
    await fulfillProblem(route, 404, 'not-found')
    return
  }

  const parameters = new URLSearchParams(request.query)
  const search = parameters.get('q')?.trim() ?? null
  const status = parameters.get('status')
  const cursor = parameters.get('cursor')
  if (search !== null && (search.length < 2 || search.length > 120)) {
    await fulfillProblem(route, 400, 'invalid-request')
    return
  }
  if (status !== null && !DIRECTORY_STATUSES.includes(status)) {
    await fulfillProblem(route, 400, 'invalid-request')
    return
  }
  let after: { name: string; id: string } | undefined
  if (cursor !== null) {
    try {
      after = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
        name: string
        id: string
      }
    } catch {
      await fulfillProblem(route, 400, 'invalid-request')
      return
    }
  }

  const sortKey = (row: DirectoryOrganizationFixture) => row.display_name.toLowerCase()
  const ordered = directory.organizations
    .filter(
      (row) =>
        (search === null || sortKey(row).includes(search.toLowerCase())) &&
        (status === null || row.status === status),
    )
    .sort((left, right) =>
      sortKey(left) === sortKey(right)
        ? left.organization_id.localeCompare(right.organization_id)
        : sortKey(left) < sortKey(right)
          ? -1
          : 1,
    )
    .filter(
      (row) =>
        after === undefined ||
        sortKey(row) > after.name.toLowerCase() ||
        (sortKey(row) === after.name.toLowerCase() && row.organization_id > after.id),
    )

  const size = directory.pageSize ?? 25
  const visible = ordered.slice(0, size)
  const last = visible.at(-1)
  const hasMore = ordered.length > size
  await fulfill(route, 200, {
    data: visible.map(({ legal_name: _legalName, ...row }) => row),
    page: {
      has_more: hasMore,
      next_cursor:
        hasMore && last
          ? Buffer.from(
              JSON.stringify({ name: last.display_name, id: last.organization_id }),
              'utf8',
            ).toString('base64url')
          : null,
    },
  })
}

function maskedContact(email: string): string {
  const [local = '', domain = ''] = email.split('@')
  return `${local.slice(0, 1)}***@${domain}`
}

/**
 * The global catalogue as its curator sees it (`HU-BO-022`). Publishing and archiving
 * move it the way the real commands do — a published code is refused, an archived one is
 * republished only under the same name, and a discipline with published content is not
 * archived — so a screen that guessed would fail here.
 */
export interface GlobalCatalogueFixture {
  refusal?: { status: number; code: string }
  commandRefusal?: { status: number; code: string }
  lostCommands?: number
  disciplines: CatalogueEntryFixture[]
  activityTypes: CatalogueEntryFixture[]
  movements: CatalogueEntryFixture[]
}

export interface CatalogueEntryFixture {
  kind: 'discipline' | 'activity_type' | 'movement'
  id: string
  code: string | null
  discipline_code: string
  name: string
  status: 'draft' | 'published' | 'deprecated' | 'archived'
  created_at: string
  in_use_count: number
}

export function catalogueEntry(
  overrides: Partial<CatalogueEntryFixture> = {},
): CatalogueEntryFixture {
  const kind = overrides.kind ?? 'discipline'
  return {
    kind,
    id: nextAssignmentId(),
    code: kind === 'movement' ? null : 'test_global_yoga',
    discipline_code: 'test_global_yoga',
    name: 'Yoga',
    status: 'published',
    created_at: '2026-09-16T12:00:00.000Z',
    in_use_count: 0,
    ...overrides,
  }
}

export function globalCatalogueFixture(
  overrides: Partial<GlobalCatalogueFixture> = {},
): GlobalCatalogueFixture {
  return { disciplines: [], activityTypes: [], movements: [], ...overrides }
}

/**
 * Allfit's own plans. The mock keeps the rules the screen depends on seeing — one
 * proposal at a time, nobody publishes their own, a proposal that changes nothing is
 * refused, publishing retires the version in force — so a screen that ignored them would
 * be caught here rather than in production.
 */
export interface PlatformPlansFixture {
  refusal?: { status: number; code: string }
  commandRefusal?: { status: number; code: string }
  lostCommands?: number
  features: PlatformFeatureFixture[]
  plans: PlatformPlanFixture[]
}

export interface PlatformFeatureFixture {
  code: string
  name: string
  unit: string | null
}

export interface PlatformPlanLimitFixture {
  feature_code: string
  enabled: boolean
  limit_value: number | null
}

export interface PlatformPlanVersionFixture {
  id: string
  version_number: number
  status: 'draft' | 'published' | 'deprecated' | 'archived'
  amount_minor: number
  currency_code: string | null
  billing_period: 'month' | 'year' | null
  features: PlatformPlanLimitFixture[]
  supersedes_version_id: string | null
  changes: Array<{
    field: 'amount_minor' | 'currency_code' | 'billing_period' | 'feature'
    feature_code: string | null
    before: unknown
    after: unknown
  }> | null
  proposed_by_person_id: string
  proposed_by_self: boolean
  proposed_at: string
  published_by_person_id: string | null
  published_at: string | null
  deprecated_at: string | null
  withdrawn_by_person_id: string | null
  withdrawn_at: string | null
}

export interface PlatformPlanFixture {
  id: string
  code: string
  name: string
  plan_kind: 'free' | 'paid'
  status: 'draft' | 'published'
  created_by_person_id: string
  created_at: string
  versions: PlatformPlanVersionFixture[]
}

export const PLAN_OPERATOR_ID = '019a3000-0000-7000-8000-00000000c001'
export const PLAN_COLLEAGUE_ID = '019a3000-0000-7000-8000-00000000c002'

export function platformPlanVersion(
  overrides: Partial<PlatformPlanVersionFixture> = {},
): PlatformPlanVersionFixture {
  const proposedBySelf = overrides.proposed_by_self ?? false
  return {
    id: nextAssignmentId(),
    version_number: 1,
    status: 'published',
    amount_minor: 3990000,
    currency_code: 'COP',
    billing_period: 'month',
    features: [],
    supersedes_version_id: null,
    changes: null,
    proposed_by_person_id: proposedBySelf ? PLAN_OPERATOR_ID : PLAN_COLLEAGUE_ID,
    proposed_by_self: proposedBySelf,
    proposed_at: '2026-09-18T12:00:00.000Z',
    published_by_person_id: PLAN_OPERATOR_ID,
    published_at: '2026-09-18T12:05:00.000Z',
    deprecated_at: null,
    withdrawn_by_person_id: null,
    withdrawn_at: null,
    ...overrides,
  }
}

export function platformPlan(overrides: Partial<PlatformPlanFixture> = {}): PlatformPlanFixture {
  return {
    id: nextAssignmentId(),
    code: 'premium',
    name: 'Premium',
    plan_kind: 'paid',
    status: 'draft',
    created_by_person_id: PLAN_OPERATOR_ID,
    created_at: '2026-09-18T11:00:00.000Z',
    versions: [],
    ...overrides,
  }
}

export function platformPlansFixture(
  overrides: Partial<PlatformPlansFixture> = {},
): PlatformPlansFixture {
  return { features: [], plans: [], ...overrides }
}

function planProjection(plan: PlatformPlanFixture) {
  const { versions, ...rest } = plan
  return {
    ...rest,
    current_version: versions.find((version) => version.status === 'published') ?? null,
    proposal: versions.find((version) => version.status === 'draft') ?? null,
    history: [...versions].sort((left, right) => right.version_number - left.version_number),
  }
}

function planChanges(
  before: PlatformPlanVersionFixture,
  after: PlatformPlanVersionFixture,
): NonNullable<PlatformPlanVersionFixture['changes']> {
  const changes: NonNullable<PlatformPlanVersionFixture['changes']> = []
  for (const field of ['amount_minor', 'currency_code', 'billing_period'] as const) {
    if (before[field] !== after[field]) {
      changes.push({ field, feature_code: null, before: before[field], after: after[field] })
    }
  }
  const codes = new Set([...before.features, ...after.features].map((entry) => entry.feature_code))
  for (const code of [...codes].sort()) {
    const was = before.features.find((entry) => entry.feature_code === code)
    const is = after.features.find((entry) => entry.feature_code === code)
    const state = (entry: PlatformPlanLimitFixture | undefined) =>
      entry ? { enabled: entry.enabled, limit_value: entry.limit_value } : null
    if (JSON.stringify(state(was)) !== JSON.stringify(state(is))) {
      changes.push({ field: 'feature', feature_code: code, before: state(was), after: state(is) })
    }
  }
  return changes
}

async function routePlatformPlans(
  route: Route,
  request: MockRequest,
  fixture: BackofficeFixture,
): Promise<void> {
  const state = fixture.platformPlans ?? platformPlansFixture()
  fixture.platformPlans = state
  const segments = request.path.split('/').filter(Boolean)
  const now = new Date().toISOString()

  if (request.method === 'GET') {
    if (state.refusal) {
      await fulfillProblem(route, state.refusal.status, state.refusal.code)
      return
    }
    await fulfill(route, 200, {
      generated_at: now,
      feature_catalog: state.features,
      plans: [...state.plans]
        .sort((left, right) =>
          left.plan_kind === right.plan_kind
            ? left.code.localeCompare(right.code)
            : left.plan_kind === 'free'
              ? -1
              : 1,
        )
        .map(planProjection),
    })
    return
  }

  if (state.lostCommands && state.lostCommands > 0) {
    state.lostCommands -= 1
    await route.abort('failed')
    return
  }
  if (state.commandRefusal) {
    await fulfillProblem(route, state.commandRefusal.status, state.commandRefusal.code)
    return
  }

  const body = (request.body ?? {}) as Record<string, unknown>

  if (segments.length === 3) {
    const code = String(body.code ?? '')
    const kind = body.plan_kind === 'free' ? 'free' : 'paid'
    if (
      state.plans.some((plan) => plan.code === code) ||
      (kind === 'free' && state.plans.some((plan) => plan.plan_kind === 'free'))
    ) {
      await fulfillProblem(route, 409, 'conflict')
      return
    }
    const plan = platformPlan({ code, name: String(body.name ?? ''), plan_kind: kind })
    state.plans.push(plan)
    await fulfill(route, 201, planProjection(plan))
    return
  }

  const plan = state.plans.find((candidate) => candidate.id === segments[3])
  if (!plan) {
    await fulfillProblem(route, 404, 'not-found')
    return
  }
  const inForce = plan.versions.find((version) => version.status === 'published')
  const open = plan.versions.find((version) => version.status === 'draft')

  if (segments.length === 5) {
    if (open) {
      await fulfillProblem(route, 409, 'conflict')
      return
    }
    const proposal = platformPlanVersion({
      version_number: plan.versions.length + 1,
      status: 'draft',
      amount_minor: Number(body.amount_minor),
      currency_code: (body.currency_code as string | null) ?? null,
      billing_period: (body.billing_period as 'month' | 'year' | null) ?? null,
      features: (body.features as PlatformPlanLimitFixture[]) ?? [],
      supersedes_version_id: inForce?.id ?? null,
      proposed_by_self: true,
      proposed_at: now,
      published_by_person_id: null,
      published_at: null,
    })
    if (inForce) {
      proposal.changes = planChanges(inForce, proposal)
      if (proposal.changes.length === 0) {
        await fulfillProblem(route, 409, 'conflict')
        return
      }
    }
    plan.versions.push(proposal)
    await fulfill(route, 201, planProjection(plan))
    return
  }

  if (!open || open.id !== segments[5]) {
    await fulfillProblem(route, 409, 'conflict')
    return
  }
  if (segments[6] === 'publication') {
    if (open.proposed_by_self) {
      await fulfillProblem(route, 403, 'forbidden')
      return
    }
    if (inForce) {
      inForce.status = 'deprecated'
      inForce.deprecated_at = now
    }
    open.status = 'published'
    open.published_at = now
    open.published_by_person_id = PLAN_OPERATOR_ID
    plan.status = 'published'
  } else {
    open.status = 'archived'
    open.withdrawn_at = now
    open.withdrawn_by_person_id = PLAN_OPERATOR_ID
  }
  await fulfill(route, 200, planProjection(plan))
}

async function routeGlobalCatalogue(
  route: Route,
  request: MockRequest,
  fixture: BackofficeFixture,
): Promise<void> {
  const state = fixture.globalCatalogue ?? globalCatalogueFixture()
  fixture.globalCatalogue = state
  const segments = request.path.split('/').filter(Boolean)

  if (request.method === 'GET') {
    if (state.refusal) {
      await fulfillProblem(route, state.refusal.status, state.refusal.code)
      return
    }
    await fulfill(route, 200, {
      disciplines: state.disciplines,
      activity_types: state.activityTypes,
      movements: state.movements,
      equipment_availability: 'not_modelled',
    })
    return
  }

  if (state.lostCommands && state.lostCommands > 0) {
    state.lostCommands -= 1
    await route.abort('failed')
    return
  }
  if (state.commandRefusal) {
    await fulfillProblem(route, state.commandRefusal.status, state.commandRefusal.code)
    return
  }

  const body = (request.body ?? {}) as Record<string, unknown>
  const kind =
    segments[3] === 'disciplines'
      ? 'discipline'
      : segments[3] === 'activity-types'
        ? 'activity_type'
        : 'movement'
  const entries =
    kind === 'discipline'
      ? state.disciplines
      : kind === 'activity_type'
        ? state.activityTypes
        : state.movements

  if (segments.length === 4) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const code = typeof body.code === 'string' ? body.code : null
    const disciplineCode =
      typeof body.discipline_code === 'string' ? body.discipline_code : (code ?? '')
    if (name === '' || (kind !== 'movement' && code === null)) {
      await fulfillProblem(route, 422, 'validation-failed')
      return
    }
    const existing = entries.find((entry) =>
      kind === 'movement' ? entry.name.toLowerCase() === name.toLowerCase() : entry.code === code,
    )
    if (existing?.status === 'published') {
      await fulfillProblem(route, 409, 'conflict')
      return
    }
    if (existing) {
      if (existing.name !== name) {
        await fulfillProblem(route, 409, 'conflict')
        return
      }
      existing.status = 'published'
      await fulfill(route, 200, existing)
      return
    }
    const published = catalogueEntry({
      kind,
      code,
      discipline_code: disciplineCode,
      name,
      status: 'published',
    })
    entries.push(published)
    await fulfill(route, 200, published)
    return
  }

  const target = entries.find((entry) =>
    kind === 'movement' ? entry.id === segments[4] : entry.code === segments[4],
  )
  if (!target) {
    await fulfillProblem(route, 404, 'not-found')
    return
  }
  if (target.status !== 'published') {
    await fulfillProblem(route, 409, 'conflict')
    return
  }
  if (
    kind === 'discipline' &&
    [...state.activityTypes, ...state.movements].some(
      (entry) => entry.discipline_code === target.code && entry.status === 'published',
    )
  ) {
    await fulfillProblem(route, 409, 'conflict')
    return
  }
  target.status = 'archived'
  await fulfill(route, 200, target)
}

async function routeOrganizationFile(
  route: Route,
  request: MockRequest,
  fixture: BackofficeFixture,
): Promise<void> {
  const state = fixture.organizationFiles ?? { files: [] }
  fixture.organizationFiles = state
  if (state.refusal) {
    await fulfillProblem(route, state.refusal.status, state.refusal.code)
    return
  }
  if (request.query !== '') {
    await fulfillProblem(route, 400, 'invalid-request')
    return
  }
  const organizationId = request.path.split('/').filter(Boolean)[3]
  const record = state.files.find((file) => file.organization.organization_id === organizationId)
  if (!record) {
    await fulfillProblem(route, 404, 'not-found')
    return
  }
  await fulfill(route, 200, record)
}

async function routeTeamInvitations(
  route: Route,
  request: MockRequest,
  fixture: BackofficeFixture,
): Promise<void> {
  const state = fixture.teamInvitations ?? { lists: {} }
  fixture.teamInvitations = state
  const segments = request.path.split('/').filter(Boolean)
  const organizationId = segments[3] ?? ''
  const items = state.lists[organizationId] ?? []

  if (request.method === 'GET') {
    if (state.refusal) {
      await fulfillProblem(route, state.refusal.status, state.refusal.code)
      return
    }
    await fulfill(route, 200, { organization_id: organizationId, items, truncated: false })
    return
  }

  if (state.lostResends && state.lostResends > 0) {
    state.lostResends -= 1
    await route.abort('failed')
    return
  }
  if (state.resendRefusal) {
    await fulfillProblem(route, state.resendRefusal.status, state.resendRefusal.code)
    return
  }
  const target = items.find((item) => item.invitation_id === segments[5])
  if (!target) {
    await fulfillProblem(route, 404, 'not-found')
    return
  }
  if (!target.resendable) {
    await fulfillProblem(route, 409, 'conflict')
    return
  }

  const now = new Date()
  const renewedUntil = new Date(now.getTime() + 7 * 86_400_000).toISOString()
  if (target.state === 'pending') {
    target.expires_at = renewedUntil
    target.last_resent_at = now.toISOString()
    await fulfill(route, 200, { ...target, outcome: 'redelivered' })
    return
  }

  const reissued: TeamInvitationRecordFixture = {
    ...target,
    invitation_id: nextAssignmentId(),
    state: 'pending',
    created_at: now.toISOString(),
    expires_at: renewedUntil,
    issued_by: 'allfit',
    reissues_invitation_id: target.invitation_id,
    resendable: true,
    last_resent_at: null,
  }
  target.resendable = false
  target.last_resent_at = now.toISOString()
  state.lists[organizationId] = [reissued, ...items]
  await fulfill(route, 200, { ...reissued, outcome: 'reissued' })
}

/**
 * The recovery state of a person's card (`HU-BO-010`). Commands move it the way the real
 * ones do — a start opens a recovery that has not gone out, a resend keeps the same
 * request and address, a cancellation closes it — and refuse what the server refuses.
 * `lostCommands` drops that many command answers on the wire before applying them.
 */
export interface AccountRecoveryFixture {
  refusal?: { status: number; code: string }
  commandRefusal?: { status: number; code: string }
  lostCommands?: number
  states: Record<string, AccountRecoveryStateFixture>
}

export interface AccountRecoveryStateFixture {
  person_id: string
  availability: 'available' | 'unavailable'
  unavailable_reason: 'person_not_active' | 'no_access_account' | 'no_verified_email' | null
  contact_hint: string | null
  can_start: boolean
  requests: AccountRecoveryRequestFixture[]
}

export interface AccountRecoveryRequestFixture {
  request_id: string
  person_id: string
  state: 'initiated' | 'awaiting_verification' | 'confirmed' | 'expired' | 'cancelled' | 'failed'
  contact_hint: string
  case_reference: string
  created_at: string
  delivered_at: string | null
  expires_at: string
  confirmed_at: string | null
  cancelled_at: string | null
  failed_at: string | null
  failure_code: 'contact_changed' | 'delivery_failed' | null
  send_count: number
  resendable: boolean
  cancellable: boolean
}

export function accountRecoveryState(
  overrides: Partial<AccountRecoveryStateFixture> = {},
): AccountRecoveryStateFixture {
  return {
    person_id: SUPPORT_SUBJECT_ID,
    availability: 'available',
    unavailable_reason: null,
    contact_hint: '••••••••on@example.test',
    can_start: true,
    requests: [],
    ...overrides,
  }
}

export function accountRecoveryRequest(
  overrides: Partial<AccountRecoveryRequestFixture> = {},
): AccountRecoveryRequestFixture {
  const now = Date.now()
  return {
    request_id: nextAssignmentId(),
    person_id: SUPPORT_SUBJECT_ID,
    state: 'awaiting_verification',
    contact_hint: '••••••••on@example.test',
    case_reference: 'CASE-2026-001',
    created_at: new Date(now - 600_000).toISOString(),
    delivered_at: new Date(now - 590_000).toISOString(),
    expires_at: new Date(now + 900_000).toISOString(),
    confirmed_at: null,
    cancelled_at: null,
    failed_at: null,
    failure_code: null,
    send_count: 1,
    resendable: true,
    cancellable: true,
    ...overrides,
  }
}

async function routeAccountRecovery(
  route: Route,
  request: MockRequest,
  fixture: BackofficeFixture,
): Promise<void> {
  const state = fixture.accountRecovery ?? { states: {} }
  fixture.accountRecovery = state
  const segments = request.path.split('/').filter(Boolean)
  const current = state.states[segments[3] ?? '']

  if (request.method === 'GET') {
    if (state.refusal) {
      await fulfillProblem(route, state.refusal.status, state.refusal.code)
      return
    }
    const caseReference = new URLSearchParams(request.query).get('case_reference') ?? ''
    if (!/^[A-Z][A-Z0-9_-]{2,63}$/.test(caseReference)) {
      await fulfillProblem(route, 400, 'invalid-request')
      return
    }
    if (!current) {
      await fulfillProblem(route, 404, 'not-found')
      return
    }
    await fulfill(route, 200, current)
    return
  }

  if (state.lostCommands && state.lostCommands > 0) {
    state.lostCommands -= 1
    await route.abort('failed')
    return
  }
  if (state.commandRefusal) {
    await fulfillProblem(route, state.commandRefusal.status, state.commandRefusal.code)
    return
  }
  const body = (request.body ?? {}) as Record<string, unknown>
  const caseReference = body.case_reference
  if (
    Object.keys(body).join() !== 'case_reference' ||
    typeof caseReference !== 'string' ||
    !/^[A-Z][A-Z0-9_-]{2,63}$/.test(caseReference)
  ) {
    await fulfillProblem(route, 422, 'validation-failed')
    return
  }
  if (!current) {
    await fulfillProblem(route, 404, 'not-found')
    return
  }

  const now = new Date()
  if (segments.length === 5) {
    if (!current.can_start) {
      await fulfillProblem(route, 409, 'conflict')
      return
    }
    const started: AccountRecoveryRequestFixture = {
      ...accountRecoveryRequest({ person_id: current.person_id }),
      request_id: request.headers['command-id'] ?? nextAssignmentId(),
      state: 'initiated',
      contact_hint: current.contact_hint ?? '',
      case_reference: caseReference,
      created_at: now.toISOString(),
      delivered_at: null,
      expires_at: new Date(now.getTime() + 86_400_000).toISOString(),
      resendable: false,
    }
    current.requests = [started, ...current.requests]
    current.can_start = false
    await fulfill(route, 200, started)
    return
  }

  const target = current.requests.find((item) => item.request_id === segments[5])
  if (!target) {
    await fulfillProblem(route, 404, 'not-found')
    return
  }
  if (segments[6] === 'resends') {
    if (!target.resendable) {
      await fulfillProblem(route, 409, 'conflict')
      return
    }
    target.send_count += 1
    await fulfill(route, 200, target)
    return
  }
  if (!target.cancellable) {
    await fulfillProblem(route, 409, 'conflict')
    return
  }
  Object.assign(target, {
    state: 'cancelled',
    cancelled_at: now.toISOString(),
    resendable: false,
    cancellable: false,
  })
  current.can_start = current.availability === 'available'
  await fulfill(route, 200, target)
}

async function routeOrganizationHandover(
  route: Route,
  request: MockRequest,
  fixture: BackofficeFixture,
): Promise<void> {
  const state = fixture.organizationHandover ?? { handovers: [] }
  fixture.organizationHandover = state
  if (state.refusal) {
    await fulfillProblem(route, state.refusal.status, state.refusal.code)
    return
  }

  const segments = request.path.split('/').filter(Boolean)
  const commandId = request.headers['command-id'] ?? ''

  if (request.method === 'POST' && segments.length === 3) {
    const body = (request.body ?? {}) as Record<string, unknown>
    const partyKind = body.party_kind
    const legalName = typeof body.legal_name === 'string' ? body.legal_name.trim() : null
    const email = typeof body.owner_email === 'string' ? body.owner_email.trim().toLowerCase() : ''
    if (
      typeof body.display_name !== 'string' ||
      body.display_name.trim() === '' ||
      (partyKind !== 'natural_person' && partyKind !== 'legal_entity') ||
      (partyKind === 'legal_entity') !== Boolean(legalName) ||
      !/^[^\s@]+@[^\s@]+$/.test(email)
    ) {
      await fulfillProblem(route, 422, 'validation-failed')
      return
    }
    state.createdByCommand ??= {}
    const existingId = state.createdByCommand[commandId]
    const existing = state.handovers.find((row) => row.organization_id === existingId)
    if (existing) {
      await fulfill(route, 201, existing, { 'Idempotent-Replay': 'true' })
      return
    }
    const site = body.site as { name?: string; address?: string | null } | null | undefined
    const record = handoverRecord({
      display_name: body.display_name.trim(),
      type_code: body.type_code as HandoverRecordFixture['type_code'],
      type_name:
        body.type_code === 'studio'
          ? 'Estudio'
          : body.type_code === 'gym'
            ? 'Gimnasio'
            : 'Práctica profesional',
      party_kind: partyKind,
      legal_name: partyKind === 'legal_entity' ? legalName : null,
      created_at: new Date().toISOString(),
      site: site?.name
        ? {
            site_id: '019a7200-0000-7000-8000-000000000001',
            name: site.name,
            address: site.address ?? null,
          }
        : null,
    })
    record.invitation = {
      invitation_id: commandId,
      status: 'pending',
      intent_status: 'pending',
      contact_hint: maskedContact(email),
      expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    }
    state.handovers.push(record)
    state.createdByCommand[commandId] = record.organization_id
    if (state.nextCreateNetworkFailure) {
      state.nextCreateNetworkFailure = undefined
      await route.abort('failed')
      return
    }
    await fulfill(route, 201, record)
    return
  }

  const record = state.handovers.find((row) => row.organization_id === segments[3])
  if (!record) {
    await fulfillProblem(route, 404, 'not-found')
    return
  }

  if (request.method === 'GET' && segments[4] === 'handover' && segments.length === 5) {
    await fulfill(route, 200, record)
    return
  }

  const isResend =
    request.method === 'POST' && segments[4] === 'handover' && segments[5] === 'resends'
  const isCancel = request.method === 'POST' && segments[4] === 'cancellation'
  if (!isResend && !isCancel) {
    await fulfillProblem(route, 404, 'not-found')
    return
  }
  if (
    request.body !== undefined &&
    request.body !== null &&
    JSON.stringify(request.body) !== '{}'
  ) {
    await fulfillProblem(route, 422, 'validation-failed')
    return
  }
  if (state.nextCommandClaimedElsewhere) {
    state.nextCommandClaimedElsewhere = undefined
    record.status = 'active'
    record.claimed_at = new Date().toISOString()
    if (record.invitation) {
      record.invitation.status = 'completed'
      record.invitation.intent_status = 'accepted'
    }
  }

  if (isCancel && record.status === 'cancelled') {
    await fulfill(route, 200, record)
    return
  }
  if (record.status !== 'unclaimed') {
    await fulfillProblem(route, 409, 'conflict')
    return
  }

  if (isCancel) {
    record.status = 'cancelled'
    record.cancelled_at = new Date().toISOString()
    if (record.invitation?.status === 'pending') {
      record.invitation.status = 'revoked'
      record.invitation.intent_status = 'revoked'
    }
    await fulfill(route, 200, record)
    return
  }

  const invitation = record.invitation
  if (
    invitation &&
    invitation.status === 'pending' &&
    Date.parse(invitation.expires_at) > Date.now()
  ) {
    invitation.expires_at = new Date(Date.now() + 7 * 86_400_000).toISOString()
  } else {
    record.invitation = {
      invitation_id: commandId,
      status: 'pending',
      intent_status: 'pending',
      contact_hint: invitation?.contact_hint ?? 'o***@example.test',
      expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    }
  }
  await fulfill(route, 200, record)
}

async function routeVerification(
  route: Route,
  request: MockRequest,
  fixture: BackofficeFixture,
): Promise<void> {
  const verification = fixture.verification ?? { requests: [], renewals: [] }
  fixture.verification = verification
  if (verification.refusal) {
    await fulfillProblem(route, verification.refusal.status, verification.refusal.code)
    return
  }
  const now = Date.now()

  if (request.method === 'GET' && request.path === '/backoffice/v1/verification-requests') {
    await fulfill(route, 200, {
      items: verification.requests
        .filter((row) => row.status === 'pending')
        .map(({ status: _status, ...row }) => row),
    })
    return
  }

  if (request.method === 'GET' && request.path === '/backoffice/v1/verification-renewals') {
    await fulfill(route, 200, { items: verification.renewals })
    return
  }

  if (request.method === 'POST' && request.path === '/backoffice/v1/verifications') {
    const body = request.body as
      | { request_id?: string; result?: string; method?: string; source_valid_to?: string | null }
      | undefined
    const target = verification.requests.find((row) => row.request_id === body?.request_id)
    if (!target) {
      await fulfillProblem(route, 404, 'not-found')
      return
    }
    if (verification.nextDecisionDecidedElsewhere) {
      verification.nextDecisionDecidedElsewhere = undefined
      target.status = 'resolved'
      await fulfillProblem(route, 409, 'conflict')
      return
    }
    if (target.status !== 'pending') {
      await fulfillProblem(route, 409, 'conflict')
      return
    }
    if (!target.viewer_can_decide) {
      await fulfillProblem(route, 403, 'forbidden')
      return
    }
    const result = body?.result
    if (result !== 'verified' && result !== 'rejected' && result !== 'unverifiable') {
      await fulfillProblem(route, 422, 'validation-failed')
      return
    }
    const sourceValidTo = body?.source_valid_to ? Date.parse(body.source_valid_to) : null
    if (result === 'verified' && sourceValidTo !== null && sourceValidTo <= now) {
      await fulfillProblem(route, 422, 'validation-failed')
      return
    }

    target.status = 'resolved'
    const decidedAt = new Date(now).toISOString()
    const validTo =
      result === 'verified'
        ? new Date(
            Math.min(now + 365 * 86_400_000, sourceValidTo ?? Number.POSITIVE_INFINITY),
          ).toISOString()
        : null
    await fulfill(route, 201, {
      request_id: target.request_id,
      kind: target.kind,
      status: 'resolved',
      credential_id: target.credential_id,
      created_at: target.requested_at,
      resolved_at: decidedAt,
      verification: {
        id: nextAssignmentId(),
        result,
        method: body?.method ?? target.suggested_method,
        decided_at: decidedAt,
        valid_from: result === 'verified' ? decidedAt : null,
        valid_to: validTo,
      },
    })
    return
  }

  if (request.method === 'POST' && request.path === '/backoffice/v1/verification-renewals') {
    const body = request.body as { credential_id?: string } | undefined
    const index = verification.renewals.findIndex(
      (row) => row.credential_id === body?.credential_id,
    )
    const due = index === -1 ? undefined : verification.renewals.splice(index, 1)[0]
    if (!due) {
      await fulfillProblem(route, 409, 'conflict')
      return
    }
    const opened = verificationRequest({
      kind: 'renewal',
      credential_id: due.credential_id,
      credential_type_code: due.credential_type_code,
      credential_type_name: due.credential_type_name,
      credential_name: due.credential_name,
      issuer: due.issuer,
      holder_person_id: due.holder_person_id,
      holder_given_name: due.holder_given_name,
      holder_family_name: due.holder_family_name,
      previous_result: 'verified',
      previous_valid_to: due.last_valid_to,
    })
    verification.requests.push(opened)
    await fulfill(route, 201, {
      request_id: opened.request_id,
      kind: 'renewal',
      status: 'pending',
      credential_id: opened.credential_id,
      created_at: opened.requested_at,
      resolved_at: null,
      verification: null,
    })
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
