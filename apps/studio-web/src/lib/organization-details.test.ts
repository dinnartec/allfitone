import { describe, expect, test } from 'bun:test'

import { partitionSites, siteStatusLabel } from './organization-details.js'
import type { OrganizationSite } from './studio-api.js'

function site(overrides: Partial<OrganizationSite> = {}): OrganizationSite {
  return {
    id: '01991600-2000-7000-8000-000000000001',
    name: 'Sede Chapinero',
    address: 'Calle 63 #11-40',
    status: 'active',
    revision_number: 1,
    ...overrides,
  }
}

describe('organization site presentation rules', () => {
  test('separates the sites in service from the ones withdrawn', () => {
    const chapinero = site({ id: '01991600-2000-7000-8000-000000000001', status: 'active' })
    const chico = site({ id: '01991600-2000-7000-8000-000000000002', status: 'inactive' })
    const usaquen = site({ id: '01991600-2000-7000-8000-000000000003', status: 'active' })

    const partition = partitionSites([chapinero, chico, usaquen])

    expect(partition.active).toEqual([chapinero, usaquen])
    expect(partition.inactive).toEqual([chico])
  })

  test('keeps the order the API delivered within each group', () => {
    const second = site({ id: '01991600-2000-7000-8000-000000000002', name: 'Segunda' })
    const first = site({ id: '01991600-2000-7000-8000-000000000001', name: 'Primera' })

    expect(partitionSites([second, first]).active.map((entry) => entry.name)).toEqual([
      'Segunda',
      'Primera',
    ])
  })

  test('an organization with no sites yet partitions into two empty groups', () => {
    expect(partitionSites([])).toEqual({ active: [], inactive: [] })
  })

  test('names each status in the vocabulary the screen shows', () => {
    expect(siteStatusLabel('active')).toBe('Activa')
    expect(siteStatusLabel('inactive')).toBe('Inactiva')
  })
})
