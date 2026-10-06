/**
 * The rules for giving somebody a role in the organization.
 *
 * The one worth stating before anything uses it: **a role is not a consent.**
 * Making somebody a coach lets them work in Studio; it gives them access to no
 * person's data. That only ever comes from the person, category by category.
 * The two are easy to conflate — "coach" sounds like it comes with clients —
 * and the screen has to say so rather than let anyone assume it.
 */

import type { OrganizationMembership, OrganizationRole } from './studio-api'

const MANAGE_ROLES = 'manage_roles'

/** Owner is deliberately absent: it changes only through a transfer. */
export const ASSIGNABLE_ROLES = ['admin', 'coach', 'staff'] as const

export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number]

/**
 * Read from the role catalogue the server publishes, never from a list of role
 * codes written here: PostgreSQL grants this through a capability, and a second
 * copy of that mapping drifts the day the grant changes.
 */
export function canManageRoles(
  roles: readonly string[],
  catalog: readonly OrganizationRole[] | undefined,
): boolean {
  if (!catalog?.length) return false
  return roles.some((role) =>
    catalog
      .find((entry) => entry.code === role)
      ?.capabilities.some((capability) => capability.code === MANAGE_ROLES),
  )
}

/**
 * Only a live membership takes a new role, and only one it does not already
 * hold. Granting a role somebody has is harmless — the command refuses to
 * duplicate it — but offering it spends a click to change nothing, and leaves
 * the reader unsure whether anything happened.
 */
export function grantableRoles(membership: OrganizationMembership): readonly AssignableRole[] {
  if (membership.status !== 'active') return []
  return ASSIGNABLE_ROLES.filter((role) => !membership.roles.includes(role))
}

export function canReceiveARole(membership: OrganizationMembership): boolean {
  return grantableRoles(membership).length > 0
}

export type RoleGrantRefusal = 'not-allowed' | 'gone' | 'rejected' | 'unavailable'

export function roleGrantRefusalFor(status: number | undefined): RoleGrantRefusal {
  if (status === 403) return 'not-allowed'
  if (status === 404) return 'gone'
  if (status === 409 || status === 422) return 'rejected'
  return 'unavailable'
}

export function roleGrantRefusalTitle(refusal: RoleGrantRefusal): string {
  if (refusal === 'not-allowed') return 'No puedes cambiar roles'
  if (refusal === 'gone') return 'Esta membresía ya no está'
  if (refusal === 'rejected') return 'Ese rol no se puede otorgar aquí'
  return 'No pudimos otorgar el rol'
}

export function roleGrantRefusalDescription(refusal: RoleGrantRefusal): string {
  if (refusal === 'not-allowed') {
    return 'Tu rol en esta organización no incluye administrar los roles del equipo.'
  }
  if (refusal === 'gone') {
    return 'Puede que la persona haya salido del equipo mientras tenías esta pantalla abierta. Actualiza la lista.'
  }
  if (refusal === 'rejected') {
    // The one the server refuses by design: propietario changes only through a
    // transfer of ownership, never through this command.
    return 'La propiedad del gimnasio solo cambia con una transferencia, no otorgando un rol. Si la persona ya tenía el rol, no hacía falta volver a dárselo.'
  }
  return 'La conexión falló de forma temporal. Nadie cambió de rol, así que puedes intentarlo otra vez.'
}
