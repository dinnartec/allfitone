import { describe, expect, test } from 'bun:test'

import {
  canViewClientDirectory,
  clientInitials,
  directoryEntryId,
  directoryEntryLabel,
  seesEveryClient,
} from './client-directory'
import type { ClientDirectoryItem, OrganizationRole } from './studio-api'

function role(code: string, capabilities: string[]): OrganizationRole {
  return {
    code,
    name: code,
    capabilities: capabilities.map((capability) => ({ code: capability, name: capability })),
    fitness_data_access_policy: 'not_granted_by_role',
  } as OrganizationRole
}

const STAFF = role('staff', ['view_directory'])
const COACH = role('coach', ['view_assigned_directory'])
const BILLING = role('billing', ['manage_billing'])

const RELATIONSHIP = {
  kind: 'relationship',
  relationship_id: '019ad000-0000-7000-8000-000000000301',
  person_id: '019ad000-0000-7000-8000-000000000001',
  display_name: 'Ana Alvarez',
  relationship_status: 'active',
  invitation_status: 'accepted',
  started_at: '2026-01-10T14:02:11.000Z',
  ended_at: null,
} as ClientDirectoryItem

const INVITATION = {
  kind: 'invitation',
  invitation_id: '019ad000-0000-7000-8000-000000000501',
  contact_hint: 'b***@example.test',
  invitation_status: 'pending',
  invited_at: '2026-02-01T09:00:00.000Z',
} as ClientDirectoryItem

describe('who may open the directory', () => {
  test('the catalog decides, not a list of role codes written here', () => {
    expect(canViewClientDirectory(['staff'], [STAFF])).toBe(true)
  })

  test('a coach may open it too: seeing less is still seeing a directory', () => {
    expect(canViewClientDirectory(['coach'], [COACH])).toBe(true)
  })

  test('a role with neither capability may not', () => {
    expect(canViewClientDirectory(['billing'], [BILLING])).toBe(false)
  })

  /*
   * Fail closed. An empty catalog means the answer has not arrived, and
   * assuming permission while waiting would flash a directory the caller may
   * not be allowed to see.
   */
  test('nobody may, while the catalog is still unknown', () => {
    expect(canViewClientDirectory(['staff'], undefined)).toBe(false)
    expect(canViewClientDirectory(['staff'], [])).toBe(false)
  })

  test('a role the catalog does not define grants nothing', () => {
    expect(canViewClientDirectory(['ghost'], [STAFF, COACH])).toBe(false)
  })
})

describe('who sees the whole organization', () => {
  test('staff does', () => {
    expect(seesEveryClient(['staff'], [STAFF])).toBe(true)
  })

  test('a coach does not, which is why the screen words itself differently', () => {
    expect(seesEveryClient(['coach'], [COACH])).toBe(false)
  })

  test('holding both, the wider one wins', () => {
    expect(seesEveryClient(['coach', 'staff'], [COACH, STAFF])).toBe(true)
  })
})

describe('how an entry is identified and labelled', () => {
  test('a relationship is keyed by its relationship id', () => {
    expect(directoryEntryId(RELATIONSHIP)).toBe('019ad000-0000-7000-8000-000000000301')
  })

  test('an invitation is keyed by its invitation id', () => {
    expect(directoryEntryId(INVITATION)).toBe('019ad000-0000-7000-8000-000000000501')
  })

  test('a person is labelled by name', () => {
    expect(directoryEntryLabel(RELATIONSHIP)).toBe('Ana Alvarez')
  })

  test('an invitation is labelled by the masked contact, because it has no name', () => {
    expect(directoryEntryLabel(INVITATION)).toBe('b***@example.test')
  })
})

describe('initials', () => {
  test('takes the first letter of the first two words', () => {
    expect(clientInitials('Ana Alvarez')).toBe('AA')
  })

  test('ignores extra words rather than growing', () => {
    expect(clientInitials('Ana Maria Alvarez Castro')).toBe('AM')
  })

  test('survives a single name', () => {
    expect(clientInitials('Ana')).toBe('A')
  })
})
