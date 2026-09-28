import { describe, expect, test } from 'bun:test'

import { canManageSites, siteDraftErrors } from './organization-sites.js'
import type { OrganizationRole } from './studio-api.js'

function role(code: OrganizationRole['code'], capabilities: string[]): OrganizationRole {
  return {
    code,
    name: code,
    capabilities: capabilities.map((capability) => ({ code: capability, name: capability })),
    fitness_data_access_policy: 'not_granted_by_role',
  }
}

const catalog = [
  role('owner', ['manage_sites', 'manage_team']),
  role('admin', ['manage_sites']),
  role('coach', ['read_directory']),
  role('staff', ['read_directory']),
]

describe('who may register a site', () => {
  test('a role the catalog grants the capability to may', () => {
    expect(canManageSites(['admin'], catalog)).toBe(true)
    expect(canManageSites(['owner'], catalog)).toBe(true)
  })

  test('a role without it may not, whatever else it carries', () => {
    expect(canManageSites(['coach'], catalog)).toBe(false)
    expect(canManageSites(['staff'], catalog)).toBe(false)
  })

  test('holding several roles takes the widest of them', () => {
    expect(canManageSites(['coach', 'admin'], catalog)).toBe(true)
  })

  /*
   * The catalog is the server's answer, so until it arrives the client does not
   * know. Assuming permission would offer a control that fails; assuming none
   * only delays it, so absence denies.
   */
  test('without the catalog it denies rather than guesses', () => {
    expect(canManageSites(['owner'], undefined)).toBe(false)
    expect(canManageSites(['owner'], [])).toBe(false)
  })

  test('a role missing from the catalog grants nothing', () => {
    expect(canManageSites(['ghost'], catalog)).toBe(false)
  })
})

describe('what the site form refuses to send', () => {
  test('a name is required and blank space is not a name', () => {
    expect(siteDraftErrors({ name: '', address: '' }).name).toBeDefined()
    expect(siteDraftErrors({ name: '   ', address: '' }).name).toBeDefined()
  })

  test('a name is enough on its own: the address is optional', () => {
    expect(siteDraftErrors({ name: 'Sede Chapinero', address: '' })).toEqual({})
  })

  /*
   * PostgreSQL rejects an address that is present but blank, so trimming to
   * empty has to mean "not given" here rather than travel and come back 422.
   */
  test('an address of only spaces counts as not given', () => {
    expect(siteDraftErrors({ name: 'Sede Chapinero', address: '   ' })).toEqual({})
  })

  test('both fields trimmed are what gets sent', () => {
    expect(siteDraftErrors({ name: '  Sede Usaquén  ', address: '  Calle 1  ' })).toEqual({})
  })
})
