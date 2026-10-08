import { describe, expect, test } from 'bun:test'

import {
  assignableCoaches,
  canAssignProfessionals,
  refusalDescription,
  refusalFor,
  refusalTitle,
} from './relationship-holder'
import type { OrganizationMembership, OrganizationRole } from './studio-api'

function member(overrides: Partial<OrganizationMembership> = {}): OrganizationMembership {
  return {
    membership_id: '01991600-7000-7000-8000-000000000002',
    display_name: 'Camilo Restrepo',
    status: 'active',
    joined_at: '2025-02-01T10:00:00.000Z',
    ended_at: null,
    roles: ['coach'],
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

describe('who may assign a professional', () => {
  test('a role the catalogue grants the capability to', () => {
    const roles = catalog([{ code: 'owner', capabilities: ['assign_professionals'] }])
    expect(canAssignProfessionals(['owner'], roles)).toBe(true)
  })

  test('not a role without it', () => {
    const roles = catalog([{ code: 'coach', capabilities: ['view_assigned_directory'] }])
    expect(canAssignProfessionals(['coach'], roles)).toBe(false)
  })

  /*
   * The catalogue is the server's answer. Until it arrives the screen must not
   * guess from the role code, because the mapping lives in PostgreSQL and a
   * copy here is a second source of truth that drifts the day a grant changes.
   */
  test('nothing is assumed before the catalogue arrives', () => {
    expect(canAssignProfessionals(['owner'], undefined)).toBe(false)
    expect(canAssignProfessionals(['owner'], [])).toBe(false)
  })
})

describe('who can be assigned', () => {
  test('an active coach of this organization', () => {
    expect(assignableCoaches([member()])).toHaveLength(1)
  })

  // The command refuses these, so offering them spends a click to reach a
  // refusal — and worse, suggests they were a valid choice.
  test('not somebody who is not a coach', () => {
    expect(assignableCoaches([member({ roles: ['staff'] })])).toHaveLength(0)
  })

  test('not somebody whose membership ended', () => {
    expect(
      assignableCoaches([member({ status: 'terminated', ended_at: '2026-07-30T11:56:08.245Z' })]),
    ).toHaveLength(0)
  })

  test('somebody who is both coach and admin still counts', () => {
    expect(assignableCoaches([member({ roles: ['admin', 'coach'] })])).toHaveLength(1)
  })

  test('the list reads in name order', () => {
    const ordered = assignableCoaches([
      member({ membership_id: 'b', display_name: 'Daniela Hoyos' }),
      member({ membership_id: 'a', display_name: 'Camilo Restrepo' }),
    ])
    expect(ordered.map((entry) => entry.membership_id)).toEqual(['a', 'b'])
  })
})

describe('what the screen says when the command refuses', () => {
  /*
   * The one worth distinguishing. On this operation a conflict means somebody
   * else is already in charge — a state the reader can see and act on, not an
   * outage to retry. Offering "Reintentar" there would offer something that
   * cannot succeed.
   */
  test('a conflict is somebody else already in charge', () => {
    expect(refusalFor(409)).toBe('taken')
    expect(refusalTitle('taken')).toContain('Ya tiene')
    expect(refusalDescription('taken')).toContain('Actualiza')
  })

  test('a refusal is not an outage', () => {
    expect(refusalFor(403)).toBe('not-allowed')
    expect(refusalDescription('not-allowed')).not.toContain('Reintent')
  })

  test('a relationship that is gone says where to go next', () => {
    expect(refusalFor(404)).toBe('gone')
    expect(refusalDescription('gone')).toContain('clientes')
  })

  // Nothing was written, so saying so is what makes retrying safe to offer.
  test('anything else is temporary, and says nobody was assigned', () => {
    expect(refusalFor(500)).toBe('unavailable')
    expect(refusalFor(undefined)).toBe('unavailable')
    expect(refusalDescription('unavailable')).toContain('Nadie quedó asignado')
  })
})
