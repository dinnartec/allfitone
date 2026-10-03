/**
 * The rules for putting a coach in charge of a client.
 *
 * Two of them are worth stating before the screen uses them, because both are
 * the kind a client could get wrong in a way nobody notices until production:
 *
 * **Who may be assigned** is not "anybody on the team". The command refuses a
 * membership that is not an active coach of this same organization, so offering
 * a staff member or somebody who left spends a click to reach a refusal.
 *
 * **Assigning only fills an empty place.** Taking the client away from the coach
 * who already has them is a different operation, which owes the person a
 * notification this one never sends. A relationship that already has a holder
 * answers `409`, so the screen must not offer the action there at all.
 */

import type { OrganizationMembership, OrganizationRole } from './studio-api'

const ASSIGN_PROFESSIONALS = 'assign_professionals'
const COACH = 'coach'

/**
 * Read from the role catalogue the server publishes, never from a list of role
 * codes written here: PostgreSQL grants this through a capability, and a second
 * copy of that mapping drifts silently the day the grant changes.
 */
export function canAssignProfessionals(
  roles: readonly string[],
  catalog: readonly OrganizationRole[] | undefined,
): boolean {
  if (!catalog?.length) return false
  return roles.some((role) =>
    catalog
      .find((entry) => entry.code === role)
      ?.capabilities.some((capability) => capability.code === ASSIGN_PROFESSIONALS),
  )
}

/**
 * The people the command would actually accept: an active membership of this
 * organization carrying the coach role. Anybody else is a refusal waiting to
 * happen, so they never reach the list.
 */
export function assignableCoaches(
  memberships: readonly OrganizationMembership[],
): readonly OrganizationMembership[] {
  return memberships
    .filter((entry) => entry.status === 'active' && entry.roles.includes(COACH))
    .sort((left, right) => left.display_name.localeCompare(right.display_name, 'es'))
}

export type AssignmentRefusal = 'taken' | 'not-allowed' | 'gone' | 'unavailable'

/**
 * What the screen says when PostgreSQL refuses. `409` is the interesting one:
 * on this operation it means somebody else is already in charge, which is a
 * state the reader can see and act on, not an outage to retry.
 */
export function refusalFor(status: number | undefined): AssignmentRefusal {
  if (status === 409) return 'taken'
  if (status === 403) return 'not-allowed'
  if (status === 404) return 'gone'
  return 'unavailable'
}

export function refusalTitle(refusal: AssignmentRefusal): string {
  if (refusal === 'taken') return 'Ya tiene un profesional responsable'
  if (refusal === 'not-allowed') return 'No puedes asignar profesionales'
  if (refusal === 'gone') return 'Este vínculo ya no está'
  return 'No pudimos asignar al profesional'
}

export function refusalDescription(refusal: AssignmentRefusal): string {
  if (refusal === 'taken') {
    // Says what to do next rather than only what failed: changing the holder is
    // a different operation, and it is not built yet.
    return 'Alguien lo asignó mientras tenías esta pantalla abierta. Actualiza para ver quién la atiende; cambiar de responsable es una acción aparte.'
  }
  if (refusal === 'not-allowed') {
    return 'Tu rol en esta organización no incluye asignar al profesional responsable.'
  }
  if (refusal === 'gone') {
    return 'Puede que el vínculo haya terminado. Vuelve a clientes para elegir otro.'
  }
  return 'La conexión falló de forma temporal. Nadie quedó asignado, así que puedes intentarlo otra vez.'
}
