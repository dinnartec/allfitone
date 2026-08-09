const ROLE_LABELS: Readonly<Record<string, string>> = {
  owner: 'Propietario',
  admin: 'Administrador',
  coach: 'Coach',
  staff: 'Staff',
}

export function membershipRoleSummary(roles: readonly string[]): string {
  if (roles.length === 0) return 'Miembro'
  return roles.map((role) => ROLE_LABELS[role] ?? role).join(' · ')
}
