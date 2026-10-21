import { describe, expect, test } from 'bun:test'

import { consentLine, groupConsents, groupCaption, revokeCopy, type Consent } from './sharing'

const ACTIVE = '019c8000-0000-7000-8000-000000000201'
const ENDED = '019c8000-0000-7000-8000-000000000202'

function consent(overrides: Partial<Consent> = {}): Consent {
  return {
    relationship_id: ACTIVE,
    organization_id: '019c8000-0000-7000-8000-000000000101',
    organization_name: 'Bodytech Chicó',
    relationship_status: 'active',
    started_at: '2026-09-12T15:00:00.000Z',
    ended_at: null,
    scope_code: 'body_progress',
    presented_snapshot: { title: 'Medidas del cuerpo' },
    decision: 'accepted',
    decided_at: '2026-09-12T15:00:00.000Z',
    grant_id: '019c8000-0000-7000-8000-000000000501',
    grant_status: 'active',
    access_level: 'read',
    granted_at: '2026-09-12T15:00:00.000Z',
    frozen_at: null,
    revoked_at: null,
    ...overrides,
  }
}

describe('what she shares', () => {
  test('T-SPC-UNIT-321 gyms she trains at come first, nutrition apart from the rest', () => {
    const groups = groupConsents([
      consent({
        relationship_id: ENDED,
        relationship_status: 'terminated',
        organization_name: 'Smart Fit',
      }),
      consent({ scope_code: 'nutrition_intake', presented_snapshot: { title: 'Tus comidas' } }),
      consent({
        scope_code: 'relationship_training',
        presented_snapshot: { title: 'Entrenamiento' },
      }),
      consent(),
    ])
    expect(groups.map((group) => group.organizationName)).toEqual(['Bodytech Chicó', 'Smart Fit'])
    expect(groups[0]?.training.map((item) => item.scope_code)).toEqual([
      'relationship_training',
      'body_progress',
    ])
    expect(groups[0]?.nutrition.map((item) => item.scope_code)).toEqual(['nutrition_intake'])
  })

  test('T-SPC-UNIT-322 each category says how it stands, in her words', () => {
    expect(consentLine(consent())).toBe('Lectura · desde el 12 sep')
    expect(consentLine(consent({ access_level: 'contribute' }))).toBe(
      'Lectura y propuestas · desde el 12 sep',
    )
    expect(consentLine(consent({ decision: 'rejected', grant_id: null, grant_status: null }))).toBe(
      'Elegiste no compartirlo',
    )
    expect(
      consentLine(consent({ grant_status: 'revoked', revoked_at: '2026-10-21T15:00:00.000Z' })),
    ).toBe('Dejaste de compartirlo el 21 oct')
    expect(
      consentLine(consent({ grant_status: 'frozen', frozen_at: '2026-10-01T15:00:00.000Z' })),
    ).toBe('Aún pueden ver lo compartido hasta el 1 oct')
  })

  test('T-SPC-UNIT-323 a gym says since when and how much of what it asked she shares', () => {
    const [group] = groupConsents([
      consent(),
      consent({
        scope_code: 'health_context',
        decision: 'rejected',
        grant_id: null,
        grant_status: null,
      }),
      consent({ scope_code: 'nutrition_intake', grant_status: 'revoked' }),
    ])
    expect(group && groupCaption(group)).toBe('Activa desde el 12 sep · 1 de 3 categorías')
  })

  test('T-SPC-UNIT-324 an ended gym says it sees nothing new', () => {
    const [group] = groupConsents([
      consent({
        relationship_status: 'terminated',
        ended_at: '2026-06-03T15:00:00.000Z',
        grant_status: 'frozen',
        frozen_at: '2026-06-03T15:00:00.000Z',
      }),
    ])
    expect(group && groupCaption(group)).toBe('Terminó el 3 jun · ya no ven nada nuevo')
  })
})

describe('taking one back', () => {
  test('T-SPC-UNIT-325 the sheet names the category and the gym, and what does not change', () => {
    const copy = revokeCopy(consent({ presented_snapshot: { title: 'Tus comidas' } }))
    expect(copy.title).toBe('¿Dejar de compartir tus comidas con Bodytech Chicó?')
    expect(copy.lines).toEqual([
      'Dejan de ver tus comidas ahora mismo.',
      'Lo demás que compartes no cambia: cada permiso es aparte.',
      'No se borra nada tuyo. Sigue en tu Fitness ID.',
      'No se puede deshacer: para volver a compartir hará falta un permiso nuevo.',
    ])
  })

  test('T-SPC-UNIT-326 for an ended gym it is what they kept that goes', () => {
    const copy = revokeCopy(consent({ relationship_status: 'terminated', grant_status: 'frozen' }))
    expect(copy.lines[0]).toBe(
      'Dejan de conservar medidas del cuerpo, también lo que ya les compartiste.',
    )
  })
})
