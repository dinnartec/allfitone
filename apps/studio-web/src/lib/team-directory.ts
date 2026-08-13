import type { OrganizationRoleCode } from './studio-api'

const DIRECTORY_ROLES = new Set<OrganizationRoleCode>(['owner', 'admin', 'staff'])

const ROLE_LABELS: Readonly<Record<OrganizationRoleCode, string>> = {
  owner: 'Propietario',
  admin: 'Administrador',
  coach: 'Coach',
  staff: 'Staff',
}

export function canViewTeamDirectory(roles: readonly string[]): boolean {
  return roles.some((role) => DIRECTORY_ROLES.has(role as OrganizationRoleCode))
}

export function organizationRoleLabel(role: OrganizationRoleCode): string {
  return ROLE_LABELS[role]
}

export function memberInitials(displayName: string): string {
  return displayName
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => Array.from(part)[0]?.toLocaleUpperCase('es-CO') ?? '')
    .join('')
}
