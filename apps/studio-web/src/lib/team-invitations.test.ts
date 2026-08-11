import { expect, test } from 'bun:test'

import { canInviteTeam, invitationRoleOptions } from './team-invitations.js'

test('owner and admin can propose every non-owner role', () => {
  expect(invitationRoleOptions(['owner']).map(({ value }) => value)).toEqual([
    'admin',
    'coach',
    'staff',
  ])
  expect(invitationRoleOptions(['admin']).map(({ value }) => value)).toEqual([
    'admin',
    'coach',
    'staff',
  ])
})

test('staff can only propose staff and coach cannot invite', () => {
  expect(invitationRoleOptions(['staff']).map(({ value }) => value)).toEqual(['staff'])
  expect(invitationRoleOptions(['coach'])).toEqual([])
  expect(canInviteTeam(['coach'])).toBeFalse()
})
