import { organizationRoleLabel } from './team-directory'
import type { OrganizationRoleCode } from './studio-api'

/**
 * One label per role. Cards that show roles as separate badges need the list,
 * not the joined sentence: a single badge does not wrap, so a two-role summary
 * ran past the viewport on a narrow phone.
 */
export function membershipRoleLabels(roles: readonly string[]): string[] {
  if (roles.length === 0) return ['Miembro']
  return roles.map((role) =>
    role === 'owner' || role === 'admin' || role === 'coach' || role === 'staff'
      ? organizationRoleLabel(role as OrganizationRoleCode)
      : role,
  )
}

export function membershipRoleSummary(roles: readonly string[]): string {
  return membershipRoleLabels(roles).join(' · ')
}
