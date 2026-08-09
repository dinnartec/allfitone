import { describe, expect, test } from 'bun:test'

import { membershipRoleSummary } from './membership-roles.js'

describe('Studio membership role labels', () => {
  test('renders the effective owner role in Spanish', () => {
    expect(membershipRoleSummary(['owner'])).toBe('Propietario')
  })

  test('renders every effective role instead of assuming ownership', () => {
    expect(membershipRoleSummary(['admin', 'coach'])).toBe('Administrador · Coach')
  })

  test('falls back to a neutral membership label when no role is effective', () => {
    expect(membershipRoleSummary([])).toBe('Miembro')
  })
})
