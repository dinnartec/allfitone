import type { Page, Request, Route } from '@playwright/test'

const API_ORIGIN = 'http://127.0.0.1:8080'
const STUDIO_ORIGIN = 'http://127.0.0.1:3101'
export const TEST_ANALYTICS_ID = `a1_${'A'.repeat(43)}`

export interface MockRequest {
  method: string
  path: string
  search: string
  headers: Record<string, string>
  body: unknown
}

export interface MockResponse {
  status: number
  body?: unknown
  headers?: Record<string, string>
}

export interface StudioApiFixture {
  session: unknown
  memberships: unknown[]
  organizationMemberships: unknown[]
  organizationClients: unknown[]
  relationshipState: unknown
  relationshipHistory: unknown[]
  assignmentOutcome: 'created' | 'taken' | 'forbidden'
  reassignmentOutcome: 'reassigned' | 'no-holder' | 'forbidden'
  /**
   * `proposed` adds the pending cover to the fixture, the way the command does.
   * `already-proposed` is the `409` a partial unique index raises when the same
   * professional is already waiting on an answer for the same days — a double
   * click lands there, which is why the screen offers no retry.
   */
  substitutionOutcome: 'proposed' | 'already-proposed' | 'forbidden'
  /**
   * `ended` closes the cover in the fixture, the way the command does — the
   * screen refetches rather than trusting the answer, so the list has to agree.
   * `already-ended` is the `409` for a cover that is no longer running.
   */
  substitutionEndOutcome: 'ended' | 'already-ended' | 'forbidden'
  /**
   * `terminated` closes the relationship in the fixture, the way the command
   * does: the screen refetches rather than trusting the answer, so the page has
   * to agree with it.
   */
  terminationOutcome: 'terminated' | 'already-ended' | 'forbidden'
  organizationSubscriptions: unknown[]
  /**
   * `applied` moves the row in the fixture, the way the real command does; the other two
   * are the refusals the screen has wording for. `no-cause` is `409` on a reactivation
   * whose block the database cannot find — a state these operations cannot produce, which
   * is why the screen says it is not a retry.
   */
  subscriptionOutcome: 'applied' | 'no-cause' | 'forbidden'
  roleGrantOutcome: 'granted' | 'rejected' | 'forbidden'
  offerableScopes: unknown[]
  informationCategories: unknown[]
  organization: unknown
  organizationRoles: unknown[]
  organizationTypes: unknown[]
  me: { profile: Record<string, unknown> | null; memberships: unknown[] }
  specialties: Array<{ code: string; name: string; description: string | null }>
  credentialTypes: Array<{ code: string; name: string; description: string | null }>
  signedOut: boolean
  requests: MockRequest[]
  intercept?: (
    request: MockRequest,
    fixture: StudioApiFixture,
  ) => MockResponse | undefined | Promise<MockResponse | undefined>
}

/*
 * Timestamps carry a real time of day on purpose. `joined_at` and `ended_at`
 * are `format: date-time` and the database fills them with `clock_timestamp()`,
 * so no real row is ever midnight UTC. Fixtures that were made the screens read
 * a day early west of Greenwich — "31/12/2024" for a membership that started on
 * 1 January — which is correct for that instant and looks exactly like a bug.
 */
export const activeMembership = {
  membership_id: '01991600-1000-7000-8000-000000000001',
  organization_id: '01991600-1000-7000-8000-000000000002',
  display_name: 'Allfit Gym',
  type_code: 'gym',
  status: 'active',
  joined_at: '2025-01-01T14:32:07.418Z',
  ended_at: null,
  roles: ['owner'],
}

export const secondActiveMembership = {
  membership_id: '01991600-1000-7000-8000-000000000003',
  organization_id: '01991600-1000-7000-8000-000000000004',
  display_name: 'Movimiento Studio',
  type_code: 'studio',
  status: 'active',
  joined_at: '2025-02-01T09:11:53.204Z',
  ended_at: null,
  roles: ['coach'],
}

/**
 * The holder, signed in. `membership_id` matches `relationshipState.holder`
 * on purpose: in production both are `organization_memberships.id`, so a
 * persona whose id differs could never be recognised as the holder — and the
 * holder is the one actor `OP-REL-004` adds over its sibling operations.
 */
export const holderMembership = {
  membership_id: '01991600-7000-7000-8000-000000000002',
  organization_id: '01991600-1000-7000-8000-000000000002',
  display_name: 'Allfit Gym',
  type_code: 'gym',
  status: 'active',
  joined_at: '2025-02-01T09:11:53.204Z',
  ended_at: null,
  roles: ['coach'],
}

export const terminatedMembership = {
  membership_id: '01991600-1000-7000-8000-000000000005',
  organization_id: '01991600-1000-7000-8000-000000000006',
  display_name: 'Legacy Studio',
  type_code: 'studio',
  status: 'terminated',
  joined_at: '2023-01-01T16:45:22.870Z',
  ended_at: '2025-06-01T21:08:44.319Z',
  roles: ['staff'],
}

/*
 * The permission vocabulary, as Backoffice publishes it. Three of the seven, so
 * the picker has enough to show a list without the screen becoming a wall.
 */
/*
 * `OP-PRV-022`. Copied from what `privacy.list_information_categories()`
 * answers against a real database — the seven rows, their exact wording, the
 * five keys the contract declares and the order the function returns them in.
 * Not derived from `offerableScopeCatalog`: that one carries a definition id
 * and a version this operation deliberately does not have, and a fixture that
 * is merely plausible hides the defect it was written to catch.
 */
export const informationCategoryCatalog = [
  {
    scope_code: 'relationship_training',
    display_name: 'Entrenamiento con nosotros',
    summary: 'Sesiones que le asignes y sus resultados, nada de lo que entrene por su cuenta.',
    description:
      'Las sesiones que te asignemos y sus resultados, solo las que ocurran dentro de esta relación. No incluye lo que entrenes por tu cuenta, ni tu cuerpo, ni tu salud.',
    default_purpose:
      'Prescribir tu entrenamiento y revisar cómo te va en las sesiones que te asignamos.',
  },
  {
    scope_code: 'prior_training_history',
    display_name: 'Tu historial de entrenamiento',
    summary: 'Entrenamientos anteriores y por su cuenta, sin cuerpo ni salud.',
    description:
      'Entrenamientos anteriores y por tu cuenta, y sus resultados. No incluye lo que hayas compartido con otras organizaciones, ni tu cuerpo, ni tu salud.',
    default_purpose:
      'Conocer tu punto de partida para no proponerte algo por encima o por debajo de lo que ya haces.',
  },
  {
    scope_code: 'body_progress',
    display_name: 'Progreso corporal',
    summary: 'Medidas y las fotos que elija, sin datos de salud.',
    description:
      'Medidas, composición corporal, tendencias y las fotos que tú selecciones. No incluye tu galería, ni la ubicación de las fotos, ni datos de salud.',
    default_purpose:
      'Seguir cómo cambia tu cuerpo y ajustar el plan a lo que muestren las medidas.',
  },
  {
    scope_code: 'health_context',
    display_name: 'Contexto de salud',
    summary: 'Dolores y lesiones que declare, sin historia clínica.',
    description:
      'Dolores, lesiones o limitaciones que tú declares, y tu recuperación. No incluye historia clínica, exámenes, medicamentos ni diagnósticos.',
    default_purpose: 'Adaptar los ejercicios a tus lesiones o limitaciones para no hacerte daño.',
  },
  {
    scope_code: 'nutrition_intake',
    display_name: 'Lo que comes',
    summary: 'Las comidas que registre. Nunca podrás editarlas.',
    description:
      'Las comidas que registres y lo que contienen. Solo las creas tú: un profesional nunca registra ni corrige una comida tuya.',
    default_purpose: 'Entender tu alimentación para acompañarte con objetivos realistas.',
  },
  {
    scope_code: 'nutrition_media',
    display_name: 'Fotos de tus comidas',
    summary: 'Las fotos de sus comidas. Requiere también ver lo que come.',
    description:
      'Las fotos que adjuntes a una comida. Requiere además que nos permitas ver lo que comes; por sí sola no muestra nada.',
    default_purpose:
      'Ver las fotos de tus comidas cuando el registro escrito no alcanza para entenderlas.',
  },
  {
    scope_code: 'nutrition_guidance',
    display_name: 'Objetivos nutricionales',
    summary: 'Objetivos de nutrición y sus decisiones, sin ver sus comidas.',
    description:
      'Los objetivos de nutrición que te propongamos y las decisiones que tomes sobre ellos. No incluye tus comidas ni sus fotos, y nunca es prescripción médica.',
    default_purpose: 'Proponerte objetivos de nutrición y revisar contigo si te sirven.',
  },
] as const

export const offerableScopeCatalog = [
  {
    scope_definition_id: '01991600-7000-7000-8000-000000000301',
    scope_code: 'relationship_training',
    version_number: 1,
    display_name: 'Entrenamiento con nosotros',
    summary: 'Sesiones que le asignes y sus resultados, nada de lo que entrene por su cuenta.',
    description:
      'Las sesiones que te asignemos y sus resultados, solo las que ocurran dentro de esta relación. No incluye lo que entrenes por tu cuenta, ni tu cuerpo, ni tu salud.',
    default_purpose:
      'Prescribir tu entrenamiento y revisar cómo te va en las sesiones que te asignamos.',
  },
  {
    scope_definition_id: '01991600-7000-7000-8000-000000000302',
    scope_code: 'body_progress',
    version_number: 1,
    display_name: 'Progreso corporal',
    summary: 'Medidas y las fotos que elija, sin datos de salud.',
    description:
      'Medidas, composición corporal, tendencias y las fotos que tú selecciones. No incluye tu galería, ni la ubicación de las fotos, ni datos de salud.',
    default_purpose:
      'Seguir cómo cambia tu cuerpo y ajustar el plan a lo que muestren las medidas.',
  },
  {
    scope_definition_id: '01991600-7000-7000-8000-000000000303',
    scope_code: 'health_context',
    version_number: 1,
    display_name: 'Contexto de salud',
    summary: 'Dolores y lesiones que declare, sin historia clínica.',
    description:
      'Dolores, lesiones o limitaciones que tú declares, y tu recuperación. No incluye historia clínica, exámenes, medicamentos ni diagnósticos.',
    default_purpose: 'Adaptar los ejercicios a tus lesiones o limitaciones para no hacerte daño.',
  },
]

/*
 * A directory entry is one of two kinds. The invitation one deliberately has no
 * `display_name` and no `person_id`: until somebody accepts, no person exists,
 * and a fixture that invented a name here would let the screen render something
 * the API can never send.
 */
/**
 * Somebody paying the organization.
 *
 * `amount_minor` is the minor unit, so this is $120.000 and not $12.000.000 — which is
 * exactly the confusion the screen's formatter is tested against. `current_period_end` is
 * null because nothing has reported a charge yet, which is the state a subscription sits
 * in between being created and the gateway's first webhook.
 */
export const activeSubscription = {
  subscription_id: '01991600-7000-7000-8000-000000000601',
  person_id: '01991600-7000-7000-8000-000000000201',
  person_name: 'Ana Álvarez',
  plan_name: 'Mensual',
  plan_version_id: '01991600-7000-7000-8000-000000000501',
  amount_minor: 12000000,
  currency_code: 'COP',
  billing_period: 'month',
  status: 'active',
  current_period_end: null,
  started_at: '2026-10-01T15:12:44.118Z',
  suspended_at: null,
  ended_at: null,
}

export const activeClient = {
  kind: 'relationship',
  relationship_id: '01991600-7000-7000-8000-000000000101',
  person_id: '01991600-7000-7000-8000-000000000201',
  display_name: 'Ana Álvarez',
  relationship_status: 'active',
  invitation_status: 'accepted',
  started_at: '2025-03-04T15:12:44.118Z',
  ended_at: null,
}

/**
 * How a relationship stands. Deliberately the fullest case: a holder, a
 * substitution still waiting for an answer, and three permissions in three
 * different states — one granted, one frozen by the link ending, one the person
 * took back. The screen has to say all three differently.
 */
export const relationshipState = {
  relationship_id: '01991600-7000-7000-8000-000000000101',
  person_id: '01991600-7000-7000-8000-000000000201',
  display_name: 'Ana Álvarez',
  status: 'active',
  started_at: '2025-03-04T15:12:44.118Z',
  ended_at: null,
  holder: {
    assignment_id: '01991600-7000-7000-8000-000000000301',
    membership_id: '01991600-7000-7000-8000-000000000002',
    professional_person_id: '01991600-7000-7000-8000-000000000202',
    display_name: 'Camilo Restrepo',
    valid_from: '2025-03-05T09:00:00.000Z',
  },
  substitutions: [
    {
      assignment_id: '01991600-7000-7000-8000-000000000302',
      membership_id: '01991600-7000-7000-8000-000000000003',
      professional_person_id: '01991600-7000-7000-8000-000000000203',
      display_name: 'Daniela Hoyos',
      status: 'proposed',
      /*
       * Midnight UTC, because that is what `OP-REL-004` writes: the start is a
       * calendar day cast to a timestamp, not an instant somebody picked. At
       * 09:00 the screen rendered the right day in every timezone by accident,
       * which is how a cover could read as starting a day early in production
       * with every sweep green.
       */
      valid_from: '2026-10-10T00:00:00.000Z',
      ends_on: '2026-10-24',
      accepted_by_person_at: null,
    },
  ],
  grants: [
    {
      grant_id: '01991600-7000-7000-8000-000000000401',
      scope_code: 'relationship_training',
      display_name: 'Entrenamiento con nosotros',
      version_number: 1,
      access_level: 'contribute',
      status: 'active',
      purpose: 'Planear y ajustar su entrenamiento',
      granted_at: '2025-03-04T15:14:02.000Z',
      revoked_at: null,
    },
    {
      grant_id: '01991600-7000-7000-8000-000000000402',
      scope_code: 'health_context',
      display_name: 'Dolores y lesiones',
      version_number: 2,
      access_level: 'read',
      status: 'active',
      purpose: 'Adaptar el entrenamiento a sus lesiones',
      granted_at: '2025-03-04T15:14:02.000Z',
      revoked_at: null,
    },
    {
      grant_id: '01991600-7000-7000-8000-000000000403',
      scope_code: 'body_progress',
      display_name: 'Medidas y fotos',
      version_number: 1,
      access_level: 'read',
      status: 'revoked',
      purpose: 'Seguir su progreso',
      granted_at: '2025-03-04T15:14:02.000Z',
      revoked_at: '2026-09-18T11:30:00.000Z',
    },
  ],
}

/**
 * The same relationship after it ended. `frozen` only makes sense here: ending
 * the link freezes what the organization already had and stops anything after
 * the cut, so a frozen permission on an *active* relationship is a state the
 * product does not produce — and a screen designed against it would be designed
 * against nothing.
 */
export const endedRelationshipState = {
  ...relationshipState,
  status: 'terminated',
  ended_at: '2026-09-28T16:00:00.000Z',
  substitutions: [],
  grants: relationshipState.grants.map((entry) =>
    entry.status === 'active' ? { ...entry, status: 'frozen' } : entry,
  ),
}

/**
 * What that relationship has been through, newest first, as the server orders
 * it.
 *
 * Deliberately longer than one page of 25 would be awkward to write, so the
 * spec asks for a smaller page instead — what matters is that it holds a
 * handover whose two halves **share an instant**, which is what a reassignment
 * really produces, and a closure declared by the person, where the reason is
 * withheld and the screen has to say why rather than look empty.
 */
export const relationshipHistory = [
  {
    type: 'relationship_ended',
    occurred_at: '2026-09-28T16:00:00.000Z',
    source_id: '01991600-7000-7000-8000-000000000101',
    detail: { ended_by_kind: 'person', declared_by_us: false, reason: null },
  },
  {
    type: 'holder_assigned',
    occurred_at: '2026-09-20T09:00:00.000Z',
    source_id: '01991600-7000-7000-8000-000000000302',
    detail: { display_name: 'Diana Entrante' },
  },
  {
    type: 'holder_ended',
    occurred_at: '2026-09-20T09:00:00.000Z',
    source_id: '01991600-7000-7000-8000-000000000301',
    detail: { display_name: 'Camilo Saliente' },
  },
  {
    type: 'consent_decided',
    occurred_at: '2026-09-02T10:30:00.000Z',
    source_id: '01991600-7000-7000-8000-000000000401',
    detail: { scope_code: 'health_context', decision: 'accepted' },
  },
  {
    type: 'relationship_started',
    occurred_at: '2026-09-01T08:00:00.000Z',
    source_id: '01991600-7000-7000-8000-000000000101',
    detail: { continues_relationship_id: null },
  },
]

/** The same history, closed by the organization, which does share its reason. */
export const relationshipHistoryClosedByUs = [
  {
    type: 'relationship_ended',
    occurred_at: '2026-09-28T16:00:00.000Z',
    source_id: '01991600-7000-7000-8000-000000000101',
    detail: {
      ended_by_kind: 'professional',
      declared_by_us: true,
      reason: 'Dejó de asistir sin avisar',
    },
  },
  ...relationshipHistory.slice(1),
]

export const terminatedClient = {
  kind: 'relationship',
  relationship_id: '01991600-7000-7000-8000-000000000102',
  person_id: '01991600-7000-7000-8000-000000000202',
  display_name: 'Bruno Bello',
  relationship_status: 'terminated',
  invitation_status: 'accepted',
  started_at: '2024-11-20T17:05:03.771Z',
  ended_at: '2025-06-30T22:41:19.204Z',
}

/* A long masked contact, because that is the value with nowhere to break. */
export const pendingClientInvitation = {
  kind: 'invitation',
  invitation_id: '01991600-7000-7000-8000-000000000103',
  contact_hint: 'c***@correo-institucional-muy-largo.example.test',
  invitation_status: 'pending',
  invited_at: '2025-07-02T19:33:58.640Z',
}

export const activeTeamMember = {
  membership_id: '01991600-7000-7000-8000-000000000001',
  display_name: 'Ada Lovelace',
  status: 'active',
  joined_at: '2025-01-15T13:27:36.052Z',
  ended_at: null,
  roles: ['owner'],
}

export const activeCoach = {
  membership_id: '01991600-7000-7000-8000-000000000002',
  display_name: 'Camilo Restrepo',
  status: 'active',
  joined_at: '2025-02-01T10:00:00.000Z',
  ended_at: null,
  roles: ['coach'],
}

export const secondActiveCoach = {
  membership_id: '01991600-7000-7000-8000-000000000003',
  display_name: 'Daniela Hoyos',
  status: 'active',
  joined_at: '2025-04-12T10:00:00.000Z',
  ended_at: null,
  roles: ['coach'],
}

/**
 * Active, of this organization, and **not** a coach. The command refuses this
 * membership, so the list must never offer it — which is what the fixture is
 * here to prove.
 */
export const activeStaffMember = {
  membership_id: '01991600-7000-7000-8000-000000000004',
  display_name: 'Sara Posada',
  status: 'active',
  joined_at: '2025-05-20T10:00:00.000Z',
  ended_at: null,
  roles: ['staff'],
}

/**
 * The roster a gym needs to assign somebody: two coaches to choose between, an
 * active staff member and a coach who left — both of which the command refuses,
 * so the list must not offer them.
 *
 * Declared here and passed by the cases that need it, never folded into the
 * default fixture: a routing test asserts that a brand-new organization reads
 * "Integrante activo" in the singular, and adding members to the shared default
 * broke it.
 */
export const coachedTeam = () => [
  activeTeamMember,
  activeCoach,
  secondActiveCoach,
  activeStaffMember,
  terminatedTeamMember,
]

export const terminatedTeamMember = {
  membership_id: '01991600-7000-7000-8000-000000000002',
  display_name: 'Camila Torres',
  status: 'terminated',
  joined_at: '2024-02-10T18:03:19.661Z',
  ended_at: '2026-07-30T11:56:08.245Z',
  roles: ['staff'],
}

const capabilityNames = {
  invite: 'Invitar al equipo',
  manage_organization: 'Mantener los datos de la organización',
  manage_sites: 'Administrar sedes',
  manage_memberships: 'Administrar membresías del equipo',
  manage_roles: 'Administrar roles',
  invite_clients: 'Invitar clientes',
  view_directory: 'Consultar directorios organizacionales sin datos fitness',
  manage_relationships: 'Administrar relaciones de servicio',
  assign_professionals: 'Asignar profesionales responsables',
  terminate_relationships: 'Terminar relaciones de servicio',
  manage_plans: 'Administrar planes comerciales',
  manage_billing: 'Administrar cobros y suscripciones',
  manage_historical_access: 'Administrar casos históricos sin conceder lectura',
  connect_billing_account: 'Conectar la cuenta de cobro',
  close_organization: 'Cerrar la organización',
  view_assigned_directory: 'Únicamente personas asignadas',
  manage_content: 'Crear y publicar contenido de entrenamiento',
  assign_programs: 'Asignar programas',
  exercise_grants: 'Ejercer grants solo con relación, asignación y grant vigentes',
  observe_training: 'Observar ejecuciones autorizadas',
  propose_corrections: 'Proponer correcciones de entrenamiento',
  guide_nutrition: 'Orientar nutrición únicamente con credencial verificada',
} as const

const adminCapabilities = [
  'invite',
  'manage_organization',
  'manage_sites',
  'manage_memberships',
  'manage_roles',
  'invite_clients',
  'view_directory',
  'manage_relationships',
  'assign_professionals',
  'terminate_relationships',
  'manage_plans',
  'manage_billing',
  'manage_historical_access',
] as const

const coachCapabilities = [
  'invite_clients',
  'view_assigned_directory',
  'manage_content',
  'assign_programs',
  'exercise_grants',
  'observe_training',
  'propose_corrections',
  'guide_nutrition',
] as const

function capabilities(codes: readonly (keyof typeof capabilityNames)[]) {
  return codes.map((code) => ({ code, name: capabilityNames[code] }))
}

export const organizationRoleCatalog = [
  {
    code: 'owner',
    name: 'Propietario',
    capabilities: capabilities([
      ...adminCapabilities,
      'connect_billing_account',
      'close_organization',
    ]),
    fitness_data_access_policy: 'not_granted_by_role',
  },
  {
    code: 'admin',
    name: 'Administrador',
    capabilities: capabilities(adminCapabilities),
    fitness_data_access_policy: 'not_granted_by_role',
  },
  {
    code: 'coach',
    name: 'Coach',
    capabilities: capabilities(coachCapabilities),
    fitness_data_access_policy: 'requires_relationship_assignment_and_grant',
  },
  {
    code: 'staff',
    name: 'Staff',
    capabilities: capabilities(['invite', 'invite_clients', 'view_directory']),
    fitness_data_access_policy: 'not_granted_by_role',
  },
]

export const professionalProfile = {
  id: '01991600-2000-7000-8000-000000000001',
  headline: 'Entrenadora de fuerza',
  bio: 'Acompaño procesos sostenibles de fuerza y movilidad.',
  practice_started_year: 2018,
  experience_years: 8,
  specialties: [
    {
      code: 'strength_conditioning',
      name: 'Fuerza y acondicionamiento',
      description: null,
    },
  ],
  credentials: [],
  created_at: '2026-08-09T12:00:00.000Z',
  updated_at: '2026-08-09T12:00:00.000Z',
}

export const professionalCredential = {
  id: '01991600-3000-7000-8000-000000000001',
  credential_type_code: 'professional_certification',
  credential_type_name: 'Certificación profesional',
  issuer: 'NSCA',
  name: 'Fuerza aplicada',
  identifier: 'CERT-001',
  issued_on: '2024-01-01',
  expires_on: '2028-01-01',
  verification_url: 'https://example.test/cert-001',
  status: 'active',
  supersedes_credential_id: null,
  created_at: '2026-08-09T12:00:00.000Z',
  retired_at: null,
  verification: {
    state: 'unverified',
    valid_from: null,
    valid_to: null,
    effective: false,
  },
}

interface SiteRow {
  id: string
  name: string
  address: string | null
  status: string
  revision_number: number
}

let siteSequence = 900

// Named rather than positional: the specs reach for a particular site, and
// `sites[0]!` costs a forbidden non-null assertion to say the same thing less
// clearly.
export const chapineroSite = {
  id: '01991600-2000-7000-8000-000000000001',
  name: 'Sede Chapinero',
  address: 'Calle 63 #11-40, Bogotá',
  status: 'active',
  revision_number: 2,
}

export const usaquenSite = {
  id: '01991600-2000-7000-8000-000000000002',
  name: 'Sede Usaquén',
  address: null,
  status: 'active',
  revision_number: 1,
}

export const chicoSite = {
  id: '01991600-2000-7000-8000-000000000003',
  name: 'Sede Chicó',
  address: 'Carrera 11 #93-45, Bogotá',
  status: 'inactive',
  revision_number: 3,
}

/*
 * The longest a person can actually type: the form caps the name at 120
 * characters and the address at 240. Every other fixture is comfortably short,
 * so without this one the sweep only ever measures rows that were never going
 * to break. The name is one unbroken word on purpose — a string with spaces
 * wraps, and the hard case is the one that cannot.
 */
export const longestSite = {
  id: '01991600-2000-7000-8000-000000000004',
  name: `Sede ${'Villavicencio'.repeat(8)}`.slice(0, 120),
  address: `Autopista Norte kilómetro 21 costado occidental ${'bodega 14 '.repeat(20)}`
    .trim()
    .slice(0, 240),
  status: 'active',
  revision_number: 1,
}

export const organizationWithSites = {
  id: '01991600-1000-7000-8000-000000000002',
  display_name: 'Allfit Gym',
  legal_name: 'Allfit Gym SAS',
  type_code: 'gym',
  status: 'active',
  revision_number: 4,
  sites: [chapineroSite, usaquenSite, chicoSite],
}

export const organizationWithLongSite = {
  ...organizationWithSites,
  sites: [longestSite],
}

// No legal name and no site registered. Both absences are legitimate, and the
// screen has to say so rather than drop the rows and leave the reader
// wondering whether it even asked.
export const organizationWithoutSites = {
  ...organizationWithSites,
  legal_name: null,
  sites: [],
}

export function createStudioApiFixture(
  overrides: Partial<StudioApiFixture> = {},
): StudioApiFixture {
  return {
    session: {
      authenticated: true,
      registration_status: 'complete',
      identity: { given_name: 'Ada', family_name: 'Lovelace' },
      analytics: { distinct_id: TEST_ANALYTICS_ID },
    },
    memberships: [],
    organizationMemberships: [activeTeamMember, terminatedTeamMember],
    organizationClients: [activeClient, pendingClientInvitation, terminatedClient],
    relationshipState: structuredClone(relationshipState),
    relationshipHistory: structuredClone(relationshipHistory),
    assignmentOutcome: 'created',
    reassignmentOutcome: 'reassigned',
    substitutionOutcome: 'proposed',
    substitutionEndOutcome: 'ended',
    terminationOutcome: 'terminated',
    organizationSubscriptions: [structuredClone(activeSubscription)],
    subscriptionOutcome: 'applied',
    roleGrantOutcome: 'granted',
    offerableScopes: [...offerableScopeCatalog],
    informationCategories: [...informationCategoryCatalog],
    /*
     * A copy, not the shared object. Sites are now editable, and the mock
     * writes the change into this fixture so the screen the form returns to
     * shows it. Handing out the module-level object let one test's rename or
     * withdrawal reach every test that ran after it, which makes a suite whose
     * result depends on its order.
     */
    organization: structuredClone(organizationWithSites),
    organizationRoles: organizationRoleCatalog,
    organizationTypes: [
      { code: 'professional_practice', name: 'Profesional independiente', description: null },
      { code: 'gym', name: 'Gimnasio', description: null },
      { code: 'studio', name: 'Estudio', description: null },
    ],
    me: { profile: null, memberships: [] },
    specialties: [
      { code: 'personal_training', name: 'Entrenamiento personal', description: null },
      {
        code: 'strength_conditioning',
        name: 'Fuerza y acondicionamiento',
        description: null,
      },
    ],
    credentialTypes: [
      { code: 'academic_degree', name: 'Título académico', description: null },
      {
        code: 'professional_certification',
        name: 'Certificación profesional',
        description: null,
      },
    ],
    signedOut: false,
    requests: [],
    ...overrides,
  }
}

export async function installStudioApiMock(
  page: Page,
  fixture: StudioApiFixture,
  options: { consent?: 'denied' | 'undecided' } = {},
): Promise<void> {
  if (options.consent !== 'undecided') {
    await page.addInitScript(() => {
      localStorage.setItem(
        'allfit.analytics-v1',
        JSON.stringify({ decision: 'denied', notice_version: 'analytics-v1' }),
      )
    })
  }
  /*
   * Studio reads two surfaces, not one. `/catalog/v1` is the tenant-less
   * catalogue that Space and Backoffice read as well, and leaving it
   * unintercepted let a request escape to a server that is not running — which
   * the screen could only report as a failed load.
   */
  const handle = async (route: Route) => {
    const request = toMockRequest(route.request())
    if (request.method === 'OPTIONS') {
      await fulfill(route, { status: 204 })
      return
    }

    fixture.requests.push(request)
    const intercepted = await fixture.intercept?.(request, fixture)
    if (intercepted) {
      await fulfill(route, intercepted)
      return
    }

    const response = defaultResponse(request, fixture)
    await fulfill(route, response ?? { status: 500, body: { error: { code: 'unmocked-route' } } })
  }

  await page.route(`${API_ORIGIN}/studio/v1/**`, handle)
  await page.route(`${API_ORIGIN}/catalog/v1/**`, handle)
}

function defaultResponse(
  request: MockRequest,
  fixture: StudioApiFixture,
): MockResponse | undefined {
  if (request.method === 'GET' && request.path === '/studio/v1/telemetry-config') {
    return {
      status: 200,
      body: { enabled: true, notice_version: 'analytics-v1' },
      headers: { 'Cache-Control': 'public, max-age=300' },
    }
  }
  if (request.method === 'GET' && request.path === '/studio/v1/entry-context') {
    if (fixture.signedOut) return { status: 401, body: error('unauthenticated') }
    const session = objectValue(fixture.session)
    const identity = objectValue(session.identity)
    const givenName = typeof identity.given_name === 'string' ? identity.given_name : null
    const familyName = typeof identity.family_name === 'string' ? identity.family_name : null
    return {
      status: 200,
      body: {
        authenticated: true,
        registration_status:
          session.registration_status === 'registration_incomplete' ? 'incomplete' : 'complete',
        identity: {
          name: givenName && familyName ? `${givenName} ${familyName}` : null,
          email: null,
        },
        memberships: fixture.memberships,
        analytics: objectValue(session.analytics),
      },
    }
  }
  if (request.method === 'GET' && request.path === '/studio/v1/session') {
    if (fixture.signedOut) return { status: 401, body: error('unauthenticated') }
    return { status: 200, body: fixture.session }
  }
  if (request.method === 'POST' && request.path === '/studio/v1/auth/logout') {
    fixture.signedOut = true
    return { status: 303, headers: { Location: `${STUDIO_ORIGIN}/` } }
  }
  if (request.method === 'GET' && request.path === '/studio/v1/me/memberships') {
    return { status: 200, body: { items: fixture.memberships } }
  }
  if (
    request.method === 'GET' &&
    /^\/studio\/v1\/organizations\/[^/]+\/memberships$/.test(request.path)
  ) {
    const status = new URLSearchParams(request.search).get('status')
    const data = status
      ? fixture.organizationMemberships.filter(
          (membership) =>
            typeof membership === 'object' &&
            membership !== null &&
            'status' in membership &&
            membership.status === status,
        )
      : fixture.organizationMemberships
    return { status: 200, body: { data, page: { has_more: false, next_cursor: null } } }
  }
  if (request.method === 'GET' && request.path === '/studio/v1/offerable-scopes') {
    return { status: 200, body: { items: fixture.offerableScopes } }
  }
  // The catalogue surface, not `/studio/v1`: the wording is shared with Space.
  if (request.method === 'GET' && request.path === '/catalog/v1/information-categories') {
    return { status: 200, body: { items: fixture.informationCategories } }
  }
  if (
    request.method === 'POST' &&
    /^\/studio\/v1\/organizations\/[^/]+\/client-invitations$/.test(request.path)
  ) {
    return {
      status: 201,
      body: {
        id: '01991600-7000-7000-8000-000000000401',
        invitation_intent_id: '01991600-7000-7000-8000-000000000402',
        status: 'pending',
        channel: 'email',
        contact_hint: 'a***@example.test',
        expires_at: '2030-01-01T12:00:00.000Z',
        scope_codes: ['body_progress'],
        reused: false,
      },
    }
  }
  if (
    request.method === 'GET' &&
    /^\/studio\/v1\/organizations\/[^/]+\/clients$/.test(request.path)
  ) {
    const status = new URLSearchParams(request.search).get('status')
    // The filter is one value over two kinds of row: `invited` selects the
    // invitations, the other two select relationships by their own state.
    const data = status
      ? fixture.organizationClients.filter((entry) => {
          if (typeof entry !== 'object' || entry === null || !('kind' in entry)) return false
          if (status === 'invited') return entry.kind === 'invitation'
          return (
            entry.kind === 'relationship' &&
            'relationship_status' in entry &&
            entry.relationship_status === status
          )
        })
      : fixture.organizationClients
    return { status: 200, body: { data, page: { has_more: false, next_cursor: null } } }
  }
  if (
    request.method === 'GET' &&
    /^\/studio\/v1\/organizations\/[^/]+\/subscriptions$/.test(request.path)
  ) {
    const status = new URLSearchParams(request.search).get('status')
    const data = status
      ? fixture.organizationSubscriptions.filter(
          (entry) =>
            typeof entry === 'object' &&
            entry !== null &&
            'status' in entry &&
            entry.status === status,
        )
      : fixture.organizationSubscriptions
    return { status: 200, body: { data, page: { has_more: false, next_cursor: null } } }
  }
  /*
   * The three transitions answer the same shape and differ only in the state they leave
   * behind, so one handler reads the verb from the path. Writing the new state into the
   * fixture is what lets a test assert that the list the screen returns to has moved.
   */
  {
    const transition =
      request.method === 'POST'
        ? /^\/studio\/v1\/organizations\/[^/]+\/subscriptions\/([^/]+)\/(suspension|reactivation|termination)$/.exec(
            request.path,
          )
        : null
    if (transition) {
      const subscriptionId = transition[1] ?? ''
      const verb = transition[2]
      if (fixture.subscriptionOutcome !== 'applied') {
        return {
          status: fixture.subscriptionOutcome === 'no-cause' ? 409 : 403,
          body: {
            error: fixture.subscriptionOutcome === 'no-cause' ? 'conflict' : 'forbidden',
          },
        }
      }
      const status =
        verb === 'suspension' ? 'suspended' : verb === 'reactivation' ? 'active' : 'ended'
      fixture.organizationSubscriptions = fixture.organizationSubscriptions.map((entry) => {
        if (
          typeof entry !== 'object' ||
          entry === null ||
          !('subscription_id' in entry) ||
          entry.subscription_id !== subscriptionId
        ) {
          return entry
        }
        return {
          ...entry,
          status,
          suspended_at: status === 'suspended' ? '2026-10-20T09:00:00.000Z' : null,
          ended_at: status === 'ended' ? '2026-10-20T09:00:00.000Z' : null,
        }
      })
      return { status: 200, body: { subscription_id: subscriptionId, status } }
    }
  }
  if (
    request.method === 'POST' &&
    /^\/studio\/v1\/organizations\/[^/]+\/relationships\/[^/]+\/termination$/.test(request.path)
  ) {
    if (fixture.terminationOutcome !== 'terminated') {
      return {
        status: fixture.terminationOutcome === 'already-ended' ? 409 : 403,
        body: {
          error: fixture.terminationOutcome === 'already-ended' ? 'conflict' : 'forbidden',
        },
      }
    }
    const current = fixture.relationshipState as Record<string, unknown>
    const endedAt = '2026-11-04T15:20:00.000Z'
    const grants = ((current.grants ?? []) as Array<Record<string, unknown>>).map((grant) =>
      grant.status === 'active' ? { ...grant, status: 'frozen' } : grant,
    )
    fixture.relationshipState = {
      ...current,
      status: 'terminated',
      ended_at: endedAt,
      holder: null,
      substitutions: ((current.substitutions ?? []) as Array<Record<string, unknown>>).map(
        (cover) => (cover.status === 'active' ? { ...cover, status: 'ended' } : cover),
      ),
      grants,
    }
    return {
      status: 200,
      body: {
        relationship_id: relationshipState.relationship_id,
        person_id: relationshipState.person_id,
        ended_at: endedAt,
        frozen_grants: grants.filter((grant) => grant.status === 'frozen').length,
        closed_assignments: 1,
      },
    }
  }

  const ending = request.path.match(
    /^\/studio\/v1\/organizations\/[^/]+\/relationships\/[^/]+\/substitutions\/([^/]+)\/termination$/,
  )
  if (request.method === 'POST' && ending) {
    if (fixture.substitutionEndOutcome !== 'ended') {
      return {
        status: fixture.substitutionEndOutcome === 'already-ended' ? 409 : 403,
        body: {
          error: fixture.substitutionEndOutcome === 'already-ended' ? 'conflict' : 'forbidden',
        },
      }
    }
    const current = fixture.relationshipState as Record<string, unknown>
    const covers = (current.substitutions ?? []) as Array<Record<string, unknown>>
    const endedAt = '2026-11-04T15:20:00.000Z'
    fixture.relationshipState = {
      ...current,
      substitutions: covers.map((cover) =>
        cover.assignment_id === ending[1] ? { ...cover, status: 'ended' } : cover,
      ),
    }
    const closed = covers.find((cover) => cover.assignment_id === ending[1])
    return {
      status: 200,
      body: {
        assignment_id: ending[1],
        relationship_id: relationshipState.relationship_id,
        membership_id: closed?.membership_id ?? '',
        professional_person_id: closed?.professional_person_id ?? '',
        ended_at: endedAt,
      },
    }
  }

  if (
    request.method === 'POST' &&
    /^\/studio\/v1\/organizations\/[^/]+\/relationships\/[^/]+\/substitutions$/.test(request.path)
  ) {
    if (fixture.substitutionOutcome !== 'proposed') {
      return {
        status: fixture.substitutionOutcome === 'already-proposed' ? 409 : 403,
        body: {
          error: fixture.substitutionOutcome === 'already-proposed' ? 'conflict' : 'forbidden',
        },
      }
    }
    const asked = (request.body ?? {}) as {
      membership_id?: string
      starts_on?: string
      ends_on?: string
    }
    const cover = fixture.organizationMemberships.find(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        'membership_id' in entry &&
        entry.membership_id === asked.membership_id,
    ) as { membership_id: string; display_name: string } | undefined
    const assignmentId = '01991600-7000-7000-8000-000000000399'
    /*
     * The screen refetches rather than trusting the answer, so the fixture has
     * to carry the new cover too — and it carries it as `proposed`, because
     * proposing grants nothing until the person answers.
     */
    const current = fixture.relationshipState as Record<string, unknown>
    fixture.relationshipState = {
      ...current,
      substitutions: [
        ...((current.substitutions ?? []) as unknown[]),
        {
          assignment_id: assignmentId,
          membership_id: cover?.membership_id ?? '',
          professional_person_id: '01991600-7000-7000-8000-000000000299',
          display_name: cover?.display_name ?? '',
          valid_from: `${asked.starts_on}T00:00:00.000Z`,
          status: 'proposed',
          ends_on: asked.ends_on ?? null,
          accepted_by_person_at: null,
        },
      ],
    }
    return {
      status: 201,
      body: {
        assignment_id: assignmentId,
        relationship_id: relationshipState.relationship_id,
        membership_id: cover?.membership_id ?? '',
        professional_person_id: '01991600-7000-7000-8000-000000000299',
        starts_on: asked.starts_on ?? '',
        ends_on: asked.ends_on ?? '',
      },
    }
  }
  if (
    request.method === 'POST' &&
    /^\/studio\/v1\/organizations\/[^/]+\/relationships\/[^/]+\/professional-assignments\/reassignment$/.test(
      request.path,
    )
  ) {
    if (fixture.reassignmentOutcome !== 'reassigned') {
      return {
        status: fixture.reassignmentOutcome === 'no-holder' ? 409 : 403,
        body: { error: fixture.reassignmentOutcome === 'no-holder' ? 'conflict' : 'forbidden' },
      }
    }
    const moving = (request.body ?? {}) as { membership_id?: string }
    const incoming = fixture.organizationMemberships.find(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        'membership_id' in entry &&
        entry.membership_id === moving.membership_id,
    ) as { membership_id: string; display_name: string } | undefined
    const previous = (fixture.relationshipState as { holder?: { assignment_id?: string } }).holder
    fixture.relationshipState = {
      ...(fixture.relationshipState as Record<string, unknown>),
      holder: {
        assignment_id: '01991600-7000-7000-8000-000000000398',
        membership_id: incoming?.membership_id ?? '',
        professional_person_id: '01991600-7000-7000-8000-000000000298',
        display_name: incoming?.display_name ?? '',
        valid_from: '2026-10-05T12:00:00.000Z',
      },
    }
    return {
      status: 201,
      body: {
        assignment_id: '01991600-7000-7000-8000-000000000398',
        relationship_id: relationshipState.relationship_id,
        membership_id: incoming?.membership_id ?? '',
        professional_person_id: '01991600-7000-7000-8000-000000000298',
        valid_from: '2026-10-05T12:00:00.000Z',
        replaced_assignment_id: previous?.assignment_id ?? null,
      },
    }
  }
  if (
    request.method === 'POST' &&
    /^\/studio\/v1\/organizations\/[^/]+\/relationships\/[^/]+\/professional-assignments$/.test(
      request.path,
    )
  ) {
    if (fixture.assignmentOutcome !== 'created') {
      return {
        status: fixture.assignmentOutcome === 'taken' ? 409 : 403,
        body: { error: fixture.assignmentOutcome === 'taken' ? 'conflict' : 'forbidden' },
      }
    }
    // The screen refetches rather than trusting the answer, so the fixture has
    // to change too: without this the panel would reappear with the form.
    const chosen = (request.body ?? {}) as { membership_id?: string }
    const coach = fixture.organizationMemberships.find(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        'membership_id' in entry &&
        entry.membership_id === chosen.membership_id,
    ) as { membership_id: string; display_name: string } | undefined
    fixture.relationshipState = {
      ...(fixture.relationshipState as Record<string, unknown>),
      holder: {
        assignment_id: '01991600-7000-7000-8000-000000000399',
        membership_id: coach?.membership_id ?? '',
        professional_person_id: '01991600-7000-7000-8000-000000000299',
        display_name: coach?.display_name ?? '',
        valid_from: '2026-10-02T12:00:00.000Z',
      },
    }
    return { status: 201, body: fixture.relationshipState }
  }
  if (
    request.method === 'GET' &&
    /^\/studio\/v1\/organizations\/[^/]+\/relationships\/[^/]+$/.test(request.path)
  ) {
    // Absent and not-permitted answer the same 404 here as in PostgreSQL: a
    // fixture that told them apart would let a screen be built on a difference
    // production never reports.
    if (fixture.relationshipState === null) return { status: 404, body: { error: 'not-found' } }
    return { status: 200, body: fixture.relationshipState }
  }
  if (
    request.method === 'GET' &&
    /^\/studio\/v1\/organizations\/[^/]+\/relationships\/[^/]+\/events$/.test(request.path)
  ) {
    if (fixture.relationshipState === null) return { status: 404, body: { error: 'not-found' } }

    /*
     * Paged for real rather than returned whole. The screen's «cargar más» is
     * the only way to reach a second page, and a fixture that handed everything
     * over at once would let it ship without ever being pressed.
     */
    const search = new URLSearchParams(request.search ?? '')
    const limit = Number(search.get('limit') ?? '25')
    const cursor = search.get('cursor')
    const all = fixture.relationshipHistory
    const from = cursor ? Number(cursor) : 0
    const slice = all.slice(from, from + limit)
    const next = from + limit < all.length ? String(from + limit) : null
    return {
      status: 200,
      body: { data: slice, page: { next_cursor: next, has_more: next !== null } },
    }
  }
  if (
    request.method === 'POST' &&
    /^\/studio\/v1\/organizations\/[^/]+\/memberships\/[^/]+\/roles$/.test(request.path)
  ) {
    if (fixture.roleGrantOutcome !== 'granted') {
      return {
        status: fixture.roleGrantOutcome === 'rejected' ? 422 : 403,
        body: {
          error: fixture.roleGrantOutcome === 'rejected' ? 'validation-failed' : 'forbidden',
        },
      }
    }
    const membershipId = request.path.split('/').slice(-2, -1)[0]
    const granted = (request.body ?? {}) as { role_code?: string }
    // The list is re-read after a grant, so the fixture has to carry the new
    // role or the screen would show the roles it had before.
    fixture.organizationMemberships = fixture.organizationMemberships.map((entry) => {
      if (
        typeof entry !== 'object' ||
        entry === null ||
        !('membership_id' in entry) ||
        entry.membership_id !== membershipId
      ) {
        return entry
      }
      const member = entry as unknown as { roles: string[] }
      return { ...member, roles: [...member.roles, granted.role_code ?? ''] }
    })
    return {
      status: 200,
      body: {
        membership_id: membershipId,
        role_code: granted.role_code,
        valid_from: '2026-10-06T10:00:00.000Z',
      },
    }
  }
  if (
    request.method === 'GET' &&
    /^\/studio\/v1\/organizations\/[^/]+\/roles$/.test(request.path)
  ) {
    return {
      status: 200,
      body: { items: fixture.organizationRoles },
      headers: { ETag: '"organization-roles-v1"' },
    }
  }
  if (
    request.method === 'PATCH' &&
    /^\/studio\/v1\/organizations\/[^/]+\/sites\/[^/]+$/.test(request.path)
  ) {
    const siteId = request.path.split('/').pop() ?? ''
    const organization = fixture.organization as { sites: SiteRow[] } | null
    const existing = organization?.sites.find((entry) => entry.id === siteId)
    if (!existing) return { status: 404, body: error('not-found') }

    const patch = request.body as (Partial<SiteRow> & { expected_revision?: number }) | undefined
    if (!patch || Object.keys(patch).length === 0) {
      return { status: 400, body: error('invalid-request') }
    }

    /*
     * The server compares the revision the screen was showing with the row it
     * holds, so the mock has to as well: without it the conflict state has no
     * way to be reached from a test.
     *
     * It arrives in the body now. It used to be `If-Match`, and that header made
     * Vercel's Edge answer the write `412` before the function ran — see
     * `studio-api.ts`. The header is still read when the body omits it, exactly
     * as the server does, so this mock keeps covering a client that has not
     * moved.
     */
    const { expected_revision: expectedRevision, ...fields } = patch
    const ifMatch = request.headers['if-match']
    if (expectedRevision === undefined && !ifMatch) {
      return { status: 428, body: error('precondition-required') }
    }
    const expected =
      expectedRevision ?? Number(/:r([0-9]+)"$/.exec(String(ifMatch))?.[1] ?? Number.NaN)
    if (expected !== existing.revision_number) {
      return { status: 409, body: error('conflict') }
    }

    // `expected_revision` says which revision to write over, not what to write.
    if (Object.keys(fields).length === 0) {
      return { status: 400, body: error('invalid-request') }
    }
    Object.assign(existing, fields, { revision_number: existing.revision_number + 1 })
    return { status: 200, body: existing }
  }
  if (
    request.method === 'POST' &&
    /^\/studio\/v1\/organizations\/[^/]+\/sites$/.test(request.path)
  ) {
    const body = request.body as { name?: string; address?: string } | undefined
    if (!body?.name?.trim()) return { status: 422, body: error('validation-failed') }
    const site = {
      id: `01991600-2000-7000-8000-${String(siteSequence++).padStart(12, '0')}`,
      name: body.name.trim(),
      address: body.address?.trim() ? body.address.trim() : null,
      status: 'active',
      revision_number: 1,
    }
    // The screen the form returns to reads the organization, so a site that is
    // only echoed back would vanish on arrival.
    const organization = fixture.organization as { sites: unknown[] } | null
    if (organization) organization.sites = [...organization.sites, site]
    return { status: 201, body: site }
  }
  if (request.method === 'GET' && /^\/studio\/v1\/organizations\/[^/]+$/.test(request.path)) {
    if (fixture.organization === null) return { status: 404, body: error('not-found') }
    return {
      status: 200,
      body: fixture.organization,
      headers: { ETag: '"organization-v1"' },
    }
  }
  if (request.method === 'GET' && request.path === '/studio/v1/organization-types') {
    return { status: 200, body: { items: fixture.organizationTypes } }
  }
  if (request.method === 'GET' && request.path === '/studio/v1/me') {
    return { status: 200, body: fixture.me }
  }
  if (request.method === 'GET' && request.path === '/studio/v1/professional-specialties') {
    return {
      status: 200,
      body: { items: fixture.specialties },
      headers: { ETag: '"specialties-v1"' },
    }
  }
  if (request.method === 'GET' && request.path === '/studio/v1/professional-credential-types') {
    return {
      status: 200,
      body: { items: fixture.credentialTypes },
      headers: { ETag: '"credential-types-v1"' },
    }
  }
  if (request.method === 'POST' && request.path === '/studio/v1/onboarding-attempts') {
    return {
      status: 201,
      body: {
        id: '01991600-4000-7000-8000-000000000001',
        status: 'open',
        eligibility_status: 'unknown',
        // Relative, never a literal. This was a fixed 2026-08-11, so on that day
        // every screen built on the default attempt silently switched to the
        // expired state — "La activación venció", submit disabled — and the
        // audit swept that instead of the form real people see for over a month.
        // The specs that exercise activation had already overridden it locally.
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        // Both required by `StudioOnboardingAttempt` in the contract, and both
        // were missing from the default.
        terms_version: 'platform_terms_v1',
        privacy_notice_version: 'privacy_notice_v1',
      },
    }
  }
  if (request.method === 'POST' && request.path === '/studio/v1/organizations') {
    return {
      status: 201,
      body: {
        id: '01991600-5000-7000-8000-000000000001',
        display_name: 'Nuevo espacio',
        type_code: 'gym',
        status: 'active',
        membership_id: '01991600-5000-7000-8000-000000000002',
        role: 'owner',
      },
    }
  }
  if (
    request.method === 'POST' &&
    /^\/studio\/v1\/organizations\/[^/]+\/invitations$/.test(request.path)
  ) {
    return {
      status: 201,
      body: {
        id: '01991600-6000-7000-8000-000000000001',
        status: 'pending',
        channel: 'email',
        contact_hint: 'p***@example.test',
        // Seven days from now, as the invitation form promises. A literal here
        // showed a just-created invitation as having expired a month earlier.
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        reused: false,
        intents: [
          {
            id: '01991600-6000-7000-8000-000000000002',
            kind: 'membership',
            status: 'pending',
            proposed_role_code: 'staff',
          },
        ],
      },
    }
  }
  if (request.method === 'PUT' && request.path === '/studio/v1/me/professional-profile') {
    const body = request.body as {
      headline: string
      bio: string
      practice_started_year: number
      specialty_codes: string[]
    }
    const existing = fixture.me.profile
    const profile = {
      ...professionalProfile,
      ...existing,
      headline: body.headline,
      bio: body.bio,
      practice_started_year: body.practice_started_year,
      experience_years: new Date().getUTCFullYear() - body.practice_started_year,
      specialties: fixture.specialties.filter((item) => body.specialty_codes.includes(item.code)),
      credentials: existing?.credentials ?? [],
      updated_at: '2026-08-10T12:00:00.000Z',
    }
    fixture.me.profile = profile
    return { status: 200, body: profile }
  }
  if (request.method === 'POST' && request.path === '/studio/v1/me/professional-credentials') {
    const credential = credentialFromRequest(request, professionalCredential.id)
    appendCredential(fixture, credential)
    return { status: 201, body: credential }
  }
  if (
    request.method === 'POST' &&
    request.path.endsWith('/revisions') &&
    request.path.startsWith('/studio/v1/me/professional-credentials/')
  ) {
    const credentialId = request.path.split('/').at(-2) ?? ''
    const successor = credentialFromRequest(
      request,
      '01991600-3000-7000-8000-000000000002',
      credentialId,
    )
    replaceWithRevision(fixture, credentialId, successor)
    return { status: 201, body: successor }
  }
  if (
    request.method === 'POST' &&
    request.path.endsWith('/retirement') &&
    request.path.startsWith('/studio/v1/me/professional-credentials/')
  ) {
    const credentialId = request.path.split('/').at(-2) ?? ''
    const retired = retireCredential(fixture, credentialId)
    return retired ? { status: 200, body: retired } : { status: 404, body: error('not-found') }
  }
  return undefined
}

function credentialFromRequest(request: MockRequest, id: string, supersedes: string | null = null) {
  const body = request.body as Record<string, unknown>
  const type = body.credential_type_code
  return {
    ...professionalCredential,
    ...body,
    id,
    credential_type_name:
      type === 'academic_degree' ? 'Título académico' : 'Certificación profesional',
    supersedes_credential_id: supersedes,
  }
}

function credentials(fixture: StudioApiFixture): Array<Record<string, unknown>> {
  const value = fixture.me.profile?.credentials
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []
}

function appendCredential(fixture: StudioApiFixture, credential: Record<string, unknown>): void {
  if (fixture.me.profile) fixture.me.profile.credentials = [credential, ...credentials(fixture)]
}

function replaceWithRevision(
  fixture: StudioApiFixture,
  previousId: string,
  successor: Record<string, unknown>,
): void {
  if (!fixture.me.profile) return
  const revised = credentials(fixture).map((credential) =>
    credential.id === previousId
      ? { ...credential, status: 'retired', retired_at: '2026-08-10T12:00:00.000Z' }
      : credential,
  )
  fixture.me.profile.credentials = [successor, ...revised]
}

function retireCredential(
  fixture: StudioApiFixture,
  credentialId: string,
): Record<string, unknown> | undefined {
  let retired: Record<string, unknown> | undefined
  if (!fixture.me.profile) return undefined
  fixture.me.profile.credentials = credentials(fixture).map((credential) => {
    if (credential.id !== credentialId) return credential
    retired = { ...credential, status: 'retired', retired_at: '2026-08-10T12:00:00.000Z' }
    return retired
  })
  return retired
}

function toMockRequest(request: Request): MockRequest {
  const url = new URL(request.url())
  return {
    method: request.method(),
    path: url.pathname,
    search: url.search,
    headers: request.headers(),
    body: parseBody(request),
  }
}

function parseBody(request: Request): unknown {
  const body = request.postData()
  if (!body) return undefined
  try {
    return JSON.parse(body) as unknown
  } catch {
    return body
  }
}

async function fulfill(route: Route, response: MockResponse): Promise<void> {
  const hasBody = response.body !== undefined
  await route.fulfill({
    status: response.status,
    body: hasBody ? JSON.stringify(response.body) : '',
    headers: {
      'Access-Control-Allow-Origin': STUDIO_ORIGIN,
      'Access-Control-Allow-Credentials': 'true',
      // Mirrors the API's own policy for the studio surface. A method or
      // header missing here is refused at preflight, so the failure looks like
      // broken client code rather than a stale fixture.
      'Access-Control-Allow-Headers':
        'Content-Type, Idempotency-Key, Command-Id, If-Match, If-None-Match',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, OPTIONS',
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...response.headers,
    },
  })
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function error(code: string, detail?: string): { error: { code: string; detail?: string } } {
  return { error: { code, ...(detail ? { detail } : {}) } }
}
