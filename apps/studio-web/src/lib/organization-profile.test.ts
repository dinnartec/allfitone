import { describe, expect, test } from 'bun:test'

import {
  allowedTypeCodes,
  canManageOrganization,
  organizationChanges,
  organizationDraftErrors,
  organizationToDraft,
  typeIsFixed,
} from './organization-profile.js'
import type { Organization, OrganizationRole } from './studio-api.js'

function role(code: OrganizationRole['code'], capabilities: string[]): OrganizationRole {
  return {
    code,
    name: code,
    capabilities: capabilities.map((capability) => ({ code: capability, name: capability })),
    fitness_data_access_policy: 'not_granted_by_role',
  }
}

const catalog = [
  role('owner', ['manage_organization', 'manage_sites', 'manage_team']),
  role('admin', ['manage_organization', 'manage_sites']),
  role('coach', ['read_directory']),
  role('staff', ['read_directory']),
]

describe('who may change the organization', () => {
  test('a role the catalog grants the capability to may', () => {
    expect(canManageOrganization(['owner'], catalog)).toBe(true)
    expect(canManageOrganization(['admin'], catalog)).toBe(true)
  })

  test('a role without it may not', () => {
    expect(canManageOrganization(['coach'], catalog)).toBe(false)
    expect(canManageOrganization(['staff'], catalog)).toBe(false)
  })

  test('holding several roles takes the widest of them', () => {
    expect(canManageOrganization(['coach', 'admin'], catalog)).toBe(true)
  })

  /*
   * The catalog is the server's answer, so until it arrives the client does not
   * know. Assuming permission would offer a control that fails; assuming none
   * only delays it, so absence denies.
   */
  test('without the catalog it denies rather than guesses', () => {
    expect(canManageOrganization(['owner'], undefined)).toBe(false)
    expect(canManageOrganization(['owner'], [])).toBe(false)
  })

  test('a role missing from the catalog grants nothing', () => {
    expect(canManageOrganization(['ghost'], catalog)).toBe(false)
  })

  /*
   * Managing sites and managing the organization are separate grants. They
   * happen to travel together on owner and admin today, and the screen must not
   * read one as the other.
   */
  test('managing sites alone does not carry the organization', () => {
    expect(canManageOrganization(['staff'], [role('staff', ['manage_sites'])])).toBe(false)
  })
})

/*
 * These mirror `organizations.organization_type_transitions`, seeded in
 * 20260817154245_studio_organization_team_core.sql and pinned row by row by
 * T-ORG-COMMANDS-01. If that test changes, these change with it.
 */
describe('where a type may still move', () => {
  test('a professional practice may become a gym or a studio', () => {
    expect(allowedTypeCodes('professional_practice')).toEqual([
      'professional_practice',
      'gym',
      'studio',
    ])
    expect(typeIsFixed('professional_practice')).toBe(false)
  })

  test('a gym and a studio have nowhere to go', () => {
    expect(allowedTypeCodes('gym')).toEqual(['gym'])
    expect(allowedTypeCodes('studio')).toEqual(['studio'])
    expect(typeIsFixed('gym')).toBe(true)
    expect(typeIsFixed('studio')).toBe(true)
  })

  /*
   * The move is one way, and nothing in the table walks it back. A list that
   * offered the origin again would promise an undo the trigger refuses.
   */
  test('nothing leads back to a professional practice', () => {
    expect(allowedTypeCodes('gym')).not.toContain('professional_practice')
    expect(allowedTypeCodes('studio')).not.toContain('professional_practice')
  })

  test('the current type is always offered, so the field can show itself', () => {
    for (const code of ['professional_practice', 'gym', 'studio'] as const) {
      expect(allowedTypeCodes(code)[0]).toBe(code)
    }
  })
})

describe('what the form refuses to send', () => {
  test('a name is required and blank space is not a name', () => {
    expect(
      organizationDraftErrors({ displayName: '', legalName: '', typeCode: 'gym' }).displayName,
    ).toBeDefined()
    expect(
      organizationDraftErrors({ displayName: '   ', legalName: '', typeCode: 'gym' }).displayName,
    ).toBeDefined()
  })

  test('a name is enough on its own: the legal name is optional', () => {
    expect(
      organizationDraftErrors({ displayName: 'Mi gimnasio', legalName: '', typeCode: 'gym' }),
    ).toEqual({})
  })
})

function organization(overrides: Partial<Organization> = {}): Organization {
  return {
    id: '01991600-1000-7000-8000-000000000001',
    display_name: 'Gimnasio Chapinero',
    legal_name: 'Gimnasio Chapinero S.A.S.',
    type_code: 'gym',
    status: 'active',
    revision_number: 4,
    sites: [],
    ...overrides,
  }
}

describe('what an edit actually sends', () => {
  test('nothing at all when nothing changed', () => {
    expect(organizationChanges(organization(), organizationToDraft(organization()))).toBeNull()
  })

  test('surrounding space is not a change', () => {
    expect(
      organizationChanges(organization(), {
        displayName: '  Gimnasio Chapinero  ',
        legalName: ' Gimnasio Chapinero S.A.S. ',
        typeCode: 'gym',
      }),
    ).toBeNull()
  })

  test('only the field that moved', () => {
    expect(
      organizationChanges(organization(), {
        displayName: 'Gimnasio Chapinero Norte',
        legalName: 'Gimnasio Chapinero S.A.S.',
        typeCode: 'gym',
      }),
    ).toEqual({ display_name: 'Gimnasio Chapinero Norte' })
  })

  /*
   * Clearing the legal name is a real edit, and `null` is how the contract says
   * it: PostgreSQL rejects a present but blank one.
   */
  test('a legal name cleared travels as null, not as an empty string', () => {
    expect(
      organizationChanges(organization(), {
        displayName: 'Gimnasio Chapinero',
        legalName: '   ',
        typeCode: 'gym',
      }),
    ).toEqual({ legal_name: null })
  })

  test('a legal name added where there was none', () => {
    expect(
      organizationChanges(organization({ legal_name: null }), {
        displayName: 'Gimnasio Chapinero',
        legalName: 'Chapinero S.A.S.',
        typeCode: 'gym',
      }),
    ).toEqual({ legal_name: 'Chapinero S.A.S.' })
  })

  test('a type change travels on its own', () => {
    expect(
      organizationChanges(organization({ type_code: 'professional_practice' }), {
        displayName: 'Gimnasio Chapinero',
        legalName: 'Gimnasio Chapinero S.A.S.',
        typeCode: 'studio',
      }),
    ).toEqual({ type_code: 'studio' })
  })

  test('all three at once', () => {
    expect(
      organizationChanges(organization({ type_code: 'professional_practice' }), {
        displayName: 'Estudio Norte',
        legalName: 'Estudio Norte S.A.S.',
        typeCode: 'studio',
      }),
    ).toEqual({
      display_name: 'Estudio Norte',
      legal_name: 'Estudio Norte S.A.S.',
      type_code: 'studio',
    })
  })

  test('an absent legal name left alone is not a change', () => {
    expect(
      organizationChanges(organization({ legal_name: null }), {
        displayName: 'Gimnasio Chapinero',
        legalName: '',
        typeCode: 'gym',
      }),
    ).toBeNull()
  })
})
