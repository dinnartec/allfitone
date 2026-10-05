import { describe, expect, test } from 'bun:test'

import {
  catalogueCommandMessage,
  catalogueKindLabel,
  catalogueOutcomeMessage,
  catalogueStatusLabel,
  catalogueStatusTone,
  equipmentExplanation,
  globalCatalogueMessage,
  inUseExplanation,
  isValidCatalogueCode,
  isValidCatalogueName,
  publishedDisciplines,
  type GlobalCatalogueEntry,
} from './global-catalogue'

function entry(overrides: Partial<GlobalCatalogueEntry> = {}): GlobalCatalogueEntry {
  return {
    kind: 'discipline',
    id: '019b2000-0000-7000-8000-000000000801',
    code: 'test_global_yoga',
    discipline_code: 'test_global_yoga',
    name: 'Yoga',
    status: 'published',
    created_at: '2026-09-16T12:00:00.000Z',
    in_use_count: 0,
    ...overrides,
  }
}

describe('global catalogue presentation', () => {
  test('a code is checked before it travels, and so is a name', () => {
    expect(isValidCatalogueCode('yoga_flow')).toBeTrue()
    expect(isValidCatalogueCode('Yoga Flow')).toBeFalse()
    expect(isValidCatalogueCode('yogá')).toBeFalse()
    expect(isValidCatalogueName('  Yoga  ')).toBeTrue()
    expect(isValidCatalogueName('   ')).toBeFalse()
    expect(isValidCatalogueName('y'.repeat(121))).toBeFalse()
  })

  test('every state reads differently and archived never looks published', () => {
    for (const status of ['draft', 'published', 'deprecated', 'archived'] as const) {
      expect(catalogueStatusLabel(status)).not.toBe('')
    }
    expect(catalogueStatusTone('archived')).not.toBe(catalogueStatusTone('published'))
    expect(catalogueKindLabel('activity_type')).toBe('Tipo de actividad')
  })

  test('what depends on an entry is said before anyone archives it', () => {
    expect(inUseExplanation(entry())).toContain('Nada lo usa')
    expect(inUseExplanation(entry({ in_use_count: 1 }))).toContain('1 referencia.')
    const many = inUseExplanation(entry({ in_use_count: 4 }))
    expect(many).toContain('4 referencias')
    expect(many).toContain('siguen funcionando')
  })

  test('only a published discipline can receive new content', () => {
    const catalogue = {
      disciplines: [entry(), entry({ id: 'x', code: 'old', status: 'archived' })],
      activity_types: [],
      movements: [],
      equipment_availability: 'not_modelled' as const,
    }
    expect(publishedDisciplines(catalogue).map((item) => item.code)).toEqual(['test_global_yoga'])
  })

  test('the outcome says what publishing and archiving actually did', () => {
    expect(catalogueOutcomeMessage('publish', entry())).toContain('gimnasios y personas')
    const archived = catalogueOutcomeMessage('archive', entry({ status: 'archived' }))
    expect(archived).toContain('Sale de las búsquedas')
    expect(archived).toContain('sigue funcionando')
  })

  test('absent equipment is a statement about Allfit, not about the catalogue', () => {
    expect(equipmentExplanation('not_modelled')).toContain('no existe dónde ponerlo')
    expect(equipmentExplanation('available')).not.toContain('todavía no guarda')
  })

  test('refusals explain themselves', () => {
    expect(globalCatalogueMessage('forbidden')).toContain('deber de curaduría')
    expect(catalogueCommandMessage('conflict')).toContain('ya nombra otra cosa')
    expect(catalogueCommandMessage('not-found')).toContain('contenido privado')
    expect(catalogueCommandMessage('something-new')).toBe('No se pudo completar la acción.')
  })
})
