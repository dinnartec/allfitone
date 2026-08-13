import { describe, expect, test } from 'bun:test'

import { canViewTeamDirectory, memberInitials, organizationRoleLabel } from './team-directory.js'

describe('team directory presentation rules', () => {
  test('exposes the directory only to roles that carry its V1 capabilities', () => {
    expect(canViewTeamDirectory(['owner'])).toBe(true)
    expect(canViewTeamDirectory(['admin'])).toBe(true)
    expect(canViewTeamDirectory(['staff'])).toBe(true)
    expect(canViewTeamDirectory(['coach'])).toBe(false)
    expect(canViewTeamDirectory(['coach', 'staff'])).toBe(true)
  })

  test('derives compact initials without exposing or requiring another identifier', () => {
    expect(memberInitials('Ana María Pérez')).toBe('AM')
    expect(memberInitials('  Álvaro  ')).toBe('Á')
  })

  test('uses the governed Spanish role vocabulary', () => {
    expect(organizationRoleLabel('owner')).toBe('Propietario')
    expect(organizationRoleLabel('admin')).toBe('Administrador')
    expect(organizationRoleLabel('coach')).toBe('Coach')
    expect(organizationRoleLabel('staff')).toBe('Staff')
  })
})
