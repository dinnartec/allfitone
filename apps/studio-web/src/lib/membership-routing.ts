import type { Membership } from './studio-api.js'

export type MembershipDestination =
  | { kind: 'create' }
  | { kind: 'organization'; organizationId: string }
  | { kind: 'select'; memberships: Membership[] }

export type OrganizationContextResolution =
  { kind: 'ready'; current: Membership; memberships: Membership[] } | { kind: 'forbidden' }

export function resolveMembershipDestination(
  memberships: readonly Membership[],
): MembershipDestination {
  const active = activeMemberships(memberships)
  if (active.length === 0) return { kind: 'create' }
  const [onlyMembership] = active
  if (active.length === 1 && onlyMembership) {
    return { kind: 'organization', organizationId: onlyMembership.organization_id }
  }
  return { kind: 'select', memberships: active }
}

export function resolveOrganizationContext(
  memberships: readonly Membership[],
  organizationId: string,
): OrganizationContextResolution {
  const active = activeMemberships(memberships)
  const current = active.find((membership) => membership.organization_id === organizationId)
  return current ? { kind: 'ready', current, memberships: active } : { kind: 'forbidden' }
}

function activeMemberships(memberships: readonly Membership[]): Membership[] {
  return memberships.filter((membership) => membership.status === 'active')
}
