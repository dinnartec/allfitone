import type { Membership } from './studio-api.js'

export type MembershipDestination =
  | { kind: 'create' }
  | { kind: 'organization'; organizationId: string }
  | { kind: 'select'; memberships: Membership[] }

export function resolveMembershipDestination(
  memberships: readonly Membership[],
): MembershipDestination {
  const active = memberships.filter((membership) => membership.status === 'active')
  if (active.length === 0) return { kind: 'create' }
  const [onlyMembership] = active
  if (active.length === 1 && onlyMembership) {
    return { kind: 'organization', organizationId: onlyMembership.organization_id }
  }
  return { kind: 'select', memberships: active }
}
