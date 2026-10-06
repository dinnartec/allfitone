import { describe, expect, test } from 'bun:test'

import {
  ASSIGNABLE_ROLES,
  canManageRoles,
  canReceiveARole,
  grantableRoles,
  roleGrantRefusalDescription,
  roleGrantRefusalFor,
} from './team-roles'
import type { OrganizationMembership, OrganizationRole } from './studio-api'

function member(overrides: Partial<OrganizationMembership> = {}): OrganizationMembership {
  return {
    membership_id: '01991600-7000-7000-8000-000000000002',
    display_name: 'Camilo Restrepo',
    status: 'active',
    joined_at: '2025-02-01T10:00:00.000Z',
    ended_at: null,
    roles: ['staff'],
    ...overrides,
  }
}

function catalog(
  entries: Array<{ code: string; capabilities: string[] }>,
): readonly OrganizationRole[] {
  return entries.map(({ code, capabilities }) => ({
    code,
    name: code,
    description: null,
    capabilities: capabilities.map((capability) => ({
      code: capability,
      name: capability,
      description: null,
    })),
  })) as unknown as readonly OrganizationRole[]
}

describe('who may change roles', () => {
  test('a role the catalogue grants the capability to', () => {
    expect(
      canManageRoles(['owner'], catalog([{ code: 'owner', capabilities: ['manage_roles'] }])),
    ).toBe(true)
  })

  test('not a role without it', () => {
    expect(
      canManageRoles(
        ['coach'],
        catalog([{ code: 'coach', capabilities: ['view_assigned_directory'] }]),
      ),
    ).toBe(false)
  })

  // The mapping lives in PostgreSQL. Guessing from the role code before the
  // catalogue arrives would be a second source of truth.
  test('nothing is assumed before the catalogue arrives', () => {
    expect(canManageRoles(['owner'], undefined)).toBe(false)
  })
})

describe('which roles can be given', () => {
  /*
   * Criterion 1. Owner is not a role this command grants at all: ownership
   * moves through a transfer, which is a different story with different
   * consequences, so it never reaches the list.
   */
  test('owner is never offered', () => {
    expect(ASSIGNABLE_ROLES).toEqual(['admin', 'coach', 'staff'])
    expect(grantableRoles(member({ roles: [] }))).not.toContain('owner')
  })

  // Criterion 4: granting a role somebody has does not duplicate it. The
  // command refuses to, and offering it would spend a click to change nothing.
  test('a role the person already holds is not offered', () => {
    expect(grantableRoles(member({ roles: ['coach'] }))).toEqual(['admin', 'staff'])
  })

  test('somebody who holds all three has nothing left to receive', () => {
    expect(canReceiveARole(member({ roles: ['admin', 'coach', 'staff'] }))).toBe(false)
  })

  // A membership that ended takes no new role, so the action is never offered.
  test('a membership that ended takes nothing', () => {
    expect(
      grantableRoles(member({ status: 'terminated', ended_at: '2026-07-30T11:56:08.245Z' })),
    ).toEqual([])
  })
})

describe('what the screen says when the command refuses', () => {
  test('a refusal is not an outage, and offers no retry', () => {
    expect(roleGrantRefusalFor(403)).toBe('not-allowed')
    expect(roleGrantRefusalDescription('not-allowed')).not.toContain('intentarlo otra vez')
  })

  // The server rejects owner by design; the copy says why rather than leaving
  // the reader to guess what was wrong with their choice.
  test('a rejected role explains that ownership moves another way', () => {
    expect(roleGrantRefusalFor(422)).toBe('rejected')
    expect(roleGrantRefusalFor(409)).toBe('rejected')
    expect(roleGrantRefusalDescription('rejected')).toContain('transferencia')
  })

  test('anything else is temporary, and says nobody changed', () => {
    expect(roleGrantRefusalFor(500)).toBe('unavailable')
    expect(roleGrantRefusalDescription('unavailable')).toContain('Nadie cambió de rol')
  })
})
