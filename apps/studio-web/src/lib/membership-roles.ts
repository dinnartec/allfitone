import { organizationRoleLabel } from './team-directory'
import type { OrganizationRoleCode } from './studio-api'

export function membershipRoleSummary(roles: readonly string[]): string {
  if (roles.length === 0) return 'Miembro'
  return roles
    .map((role) =>
      role === 'owner' || role === 'admin' || role === 'coach' || role === 'staff'
        ? organizationRoleLabel(role as OrganizationRoleCode)
        : role,
    )
    .join(' · ')
}
