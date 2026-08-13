import { describe, expect, test } from 'bun:test'

import {
  countPage,
  formatTotal,
  invitationsExpiringWithin,
  recentMembers,
} from './organization-overview.js'
import type { OrganizationMembership, TeamInvitationListItem } from './studio-api.js'

function member(overrides: Partial<OrganizationMembership> = {}): OrganizationMembership {
  return {
    membership_id: '01991600-1000-7000-8000-000000000001',
    display_name: 'Ada Lovelace',
    status: 'active',
    joined_at: '2025-01-14T00:00:00.000Z',
    ended_at: null,
    roles: ['owner'],
    ...overrides,
  }
}

function invitation(overrides: Partial<TeamInvitationListItem> = {}): TeamInvitationListItem {
  return {
    id: '01991600-1000-7000-8000-000000000010',
    status: 'pending',
    channel: 'email',
    contact: 'nueva@example.test',
    created_at: '2026-08-01T00:00:00.000Z',
    expires_at: '2026-08-20T00:00:00.000Z',
    intents: [],
    ...overrides,
  }
}

describe('organization overview totals', () => {
  test('counts an exhausted page exactly', () => {
    const total = countPage({ data: [member(), member()], page: { next_cursor: null } })

    expect(total).toEqual({ value: 2, atLeast: false })
  })

  test('marks a capped page as a lower bound rather than inventing a total', () => {
    const total = countPage({ data: [member(), member()], page: { next_cursor: 'cursor' } })

    expect(total).toEqual({ value: 2, atLeast: true })
  })

  test('renders a lower bound so the number never overstates what was read', () => {
    expect(formatTotal({ value: 12, atLeast: false })).toBe('12')
    expect(formatTotal({ value: 50, atLeast: true })).toBe('50+')
    expect(formatTotal({ value: 0, atLeast: false })).toBe('0')
  })
})

describe('invitations that need attention', () => {
  const now = new Date('2026-08-13T12:00:00.000Z')

  test('selects pending invitations expiring inside the window', () => {
    const soon = invitation({ id: 'soon', expires_at: '2026-08-16T00:00:00.000Z' })
    const later = invitation({ id: 'later', expires_at: '2026-09-30T00:00:00.000Z' })

    expect(invitationsExpiringWithin([soon, later], 7, now).map((item) => item.id)).toEqual([
      'soon',
    ])
  })

  test('ignores invitations that are no longer pending', () => {
    const decided = invitation({
      id: 'decided',
      status: 'completed',
      expires_at: '2026-08-16T00:00:00.000Z',
    })

    expect(invitationsExpiringWithin([decided], 7, now)).toEqual([])
  })

  test('treats an already expired invitation as needing attention', () => {
    const overdue = invitation({ id: 'overdue', expires_at: '2026-08-10T00:00:00.000Z' })

    expect(invitationsExpiringWithin([overdue], 7, now).map((item) => item.id)).toEqual(['overdue'])
  })

  test('orders the soonest to expire first', () => {
    const second = invitation({ id: 'second', expires_at: '2026-08-18T00:00:00.000Z' })
    const first = invitation({ id: 'first', expires_at: '2026-08-14T00:00:00.000Z' })

    expect(invitationsExpiringWithin([second, first], 7, now).map((item) => item.id)).toEqual([
      'first',
      'second',
    ])
  })
})

describe('recent members', () => {
  test('shows the most recently joined first', () => {
    const older = member({ membership_id: 'older', joined_at: '2024-02-09T00:00:00.000Z' })
    const newer = member({ membership_id: 'newer', joined_at: '2026-01-14T00:00:00.000Z' })

    expect(recentMembers([older, newer], 5).map((item) => item.membership_id)).toEqual([
      'newer',
      'older',
    ])
  })

  test('leaves terminated memberships out of the recent list', () => {
    const active = member({ membership_id: 'active' })
    const terminated = member({
      membership_id: 'terminated',
      status: 'terminated',
      joined_at: '2026-07-01T00:00:00.000Z',
      ended_at: '2026-07-29T00:00:00.000Z',
    })

    expect(recentMembers([active, terminated], 5).map((item) => item.membership_id)).toEqual([
      'active',
    ])
  })

  test('caps the list at the requested size', () => {
    const many = Array.from({ length: 9 }, (_unused, index) =>
      member({
        membership_id: `m-${index}`,
        joined_at: `2026-0${(index % 9) + 1}-01T00:00:00.000Z`,
      }),
    )

    expect(recentMembers(many, 4)).toHaveLength(4)
  })
})
