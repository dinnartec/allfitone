import type { Membership, TeamInvitationCreate } from './studio-api'

export type TeamInvitationRole = TeamInvitationCreate['intents'][number]['proposed_role_code']

const ROLE_LABELS: Readonly<Record<TeamInvitationRole, string>> = {
  admin: 'Administrador',
  coach: 'Coach',
  staff: 'Staff',
}

export function canInviteTeam(roles: readonly string[]): boolean {
  return roles.some((role) => role === 'owner' || role === 'admin' || role === 'staff')
}

export function invitationRoleOptions(
  roles: Membership['roles'],
): Array<{ value: TeamInvitationRole; label: string }> {
  const allowed: TeamInvitationRole[] = roles.some((role) => role === 'owner' || role === 'admin')
    ? ['admin', 'coach', 'staff']
    : roles.includes('staff')
      ? ['staff']
      : []
  return allowed.map((value) => ({ value, label: ROLE_LABELS[value] }))
}

export function invitationRoleLabel(role: TeamInvitationRole): string {
  return ROLE_LABELS[role]
}
