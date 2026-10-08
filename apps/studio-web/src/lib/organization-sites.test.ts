import { describe, expect, test } from 'bun:test'

import { canManageSites, siteChanges, siteDraftErrors } from './organization-sites.js'
import type { OrganizationRole, OrganizationSite } from './studio-api.js'

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

function site(overrides: Partial<OrganizationSite> = {}): OrganizationSite {
  return {
    id: '01991600-2000-7000-8000-000000000001',
    name: 'Sede Chapinero',
    address: 'Calle 63 #11-40',
    status: 'active',
    revision_number: 4,
    ...overrides,
  }
}

/*
 * The two tests that stood here covered `siteEtag`, which formatted the revision
 * for the `If-Match` header. The revision now goes in the body as a plain
 * number, so there is no formatting left to get wrong. What still matters — that
 * a revision of zero survives the trip rather than reading as absent — is
 * covered where it now lives, in the studio-api client test.
 */

describe('what an edit actually sends', () => {
  test('nothing at all when nothing changed', () => {
    expect(siteChanges(site(), { name: 'Sede Chapinero', address: 'Calle 63 #11-40' })).toBeNull()
  })

  test('surrounding space is not a change', () => {
    expect(
      siteChanges(site(), { name: '  Sede Chapinero  ', address: ' Calle 63 #11-40 ' }),
    ).toBeNull()
  })

  test('only the field that moved', () => {
    expect(
      siteChanges(site(), { name: 'Sede Chapinero Norte', address: 'Calle 63 #11-40' }),
    ).toEqual({
      name: 'Sede Chapinero Norte',
    })
  })

  /*
   * Clearing the address is a real edit, and `null` is how the contract says
   * it: an empty string would be rejected for failing minLength.
   */
  test('an address cleared travels as null, not as an empty string', () => {
    expect(siteChanges(site(), { name: 'Sede Chapinero', address: '   ' })).toEqual({
      address: null,
    })
  })

  test('an address added where there was none', () => {
    expect(
      siteChanges(site({ address: null }), { name: 'Sede Chapinero', address: 'Calle 1' }),
    ).toEqual({
      address: 'Calle 1',
    })
  })

  test('both fields at once', () => {
    expect(siteChanges(site(), { name: 'Sede Norte', address: 'Calle 2' })).toEqual({
      name: 'Sede Norte',
      address: 'Calle 2',
    })
  })
})
