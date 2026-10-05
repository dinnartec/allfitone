import { describe, expect, test } from 'bun:test'

import {
  accessLevelLabel,
  grantStatusLabel,
  grantStatusTone,
  orderGrants,
  substitutionStatusLabel,
} from './relationship-state'
import type { RelationshipGrant } from './studio-api'

function grant(overrides: Partial<RelationshipGrant> = {}): RelationshipGrant {
  return {
    grant_id: '01991600-7000-7000-8000-000000000401',
    scope_code: 'body_progress',
    display_name: 'Medidas y fotos',
    version_number: 1,
    access_level: 'read',
    status: 'active',
    purpose: 'Seguir su progreso',
    granted_at: '2026-03-04T15:14:02.000Z',
    revoked_at: null,
    ...overrides,
  }
}

describe('how permissions are ordered', () => {
  test('the ones in force come first', () => {
    const ordered = orderGrants([
      grant({ grant_id: 'a', scope_code: 'health_context', status: 'revoked' }),
      grant({ grant_id: 'b', scope_code: 'relationship_training', status: 'active' }),
    ])
    expect(ordered.map((entry) => entry.grant_id)).toEqual(['b', 'a'])
  })

  /*
   * Most the organization can still do, first. Sorting the two stopped states
   * alphabetically instead put "Retirado" — where the gym has nothing — above
   * "Sin nuevos datos", where it keeps what it already had.
   */
  test('what the organization still holds outranks what it lost', () => {
    const ordered = orderGrants([
      grant({ grant_id: 'a', scope_code: 'body_progress', status: 'revoked' }),
      grant({ grant_id: 'b', scope_code: 'health_context', status: 'frozen' }),
    ])
    expect(ordered.map((entry) => entry.grant_id)).toEqual(['b', 'a'])
  })

  // A permission that stopped is the record that somebody said no. Dropping it
  // would hide the decision rather than report it.
  test('the ones that stopped are kept, not dropped', () => {
    const ordered = orderGrants([
      grant({ grant_id: 'a', status: 'revoked' }),
      grant({ grant_id: 'b', status: 'frozen' }),
    ])
    expect(ordered).toHaveLength(2)
  })

  test('within the same state they read in a stable order', () => {
    const ordered = orderGrants([
      grant({ grant_id: 'b', scope_code: 'nutrition_intake' }),
      grant({ grant_id: 'a', scope_code: 'body_progress' }),
    ])
    expect(ordered.map((entry) => entry.grant_id)).toEqual(['a', 'b'])
  })

  test('ordering leaves the given list alone', () => {
    const grants = [grant({ grant_id: 'a', status: 'revoked' }), grant({ grant_id: 'b' })]
    orderGrants(grants)
    expect(grants.map((entry) => entry.grant_id)).toEqual(['a', 'b'])
  })
})

describe('the words on a permission', () => {
  test('a frozen permission is named by what it means, not by the mechanism', () => {
    expect(grantStatusLabel('frozen')).toBe('Sin nuevos datos')
    expect(grantStatusLabel('frozen')).not.toContain('ongel')
  })

  test('only a live permission reads as a success', () => {
    expect(grantStatusTone('active')).toBe('success')
    expect(grantStatusTone('frozen')).toBe('secondary')
    expect(grantStatusTone('revoked')).toBe('secondary')
  })

  /*
   * `contribute` is more than reading: the organization may write into the
   * person's record. Saying only "lectura" for both would understate what the
   * person agreed to.
   */
  test('being able to write is said, not implied', () => {
    expect(accessLevelLabel('contribute')).toBe('Puede leer y registrar')
    expect(accessLevelLabel('read')).toBe('Solo lectura')
  })
})

describe('the words on a substitution', () => {
  test('one nobody has answered says it is waiting', () => {
    expect(substitutionStatusLabel('proposed')).toBe('Esperando respuesta')
  })
})
