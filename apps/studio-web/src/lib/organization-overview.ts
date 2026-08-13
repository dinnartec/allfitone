/**
 * Derivations behind the organization overview.
 *
 * The Studio surfaces expose cursor pages, not totals, so a count read from one
 * page is a lower bound whenever a cursor remains. These helpers keep that
 * distinction in the type rather than rounding it away: the overview may say
 * "50+", never a number it cannot stand behind.
 */
import type { OrganizationMembership, TeamInvitationListItem } from './studio-api'

export interface CountedTotal {
  value: number
  atLeast: boolean
}

const DAY_IN_MS = 24 * 60 * 60 * 1000

export function countPage(page: {
  data: readonly unknown[]
  page: { next_cursor: string | null }
}): CountedTotal {
  return { value: page.data.length, atLeast: page.page.next_cursor !== null }
}

export function formatTotal(total: CountedTotal): string {
  return total.atLeast ? `${total.value}+` : String(total.value)
}

export function invitationsExpiringWithin(
  items: readonly TeamInvitationListItem[],
  days: number,
  now: Date,
): TeamInvitationListItem[] {
  const deadline = now.getTime() + days * DAY_IN_MS

  return items
    .filter((item) => item.status === 'pending' && Date.parse(item.expires_at) <= deadline)
    .toSorted((left, right) => Date.parse(left.expires_at) - Date.parse(right.expires_at))
}

export function recentMembers(
  items: readonly OrganizationMembership[],
  limit: number,
): OrganizationMembership[] {
  return items
    .filter((item) => item.status === 'active')
    .toSorted((left, right) => Date.parse(right.joined_at) - Date.parse(left.joined_at))
    .slice(0, limit)
}
