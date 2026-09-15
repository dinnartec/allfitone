import { describe, expect, test } from 'bun:test'

import {
  NOTHING_FILTERED,
  anyFilter,
  applyFilter,
  clearFacet,
  codesForBodySlug,
  countFor,
  facetSummary,
  isFiltered,
  listSummary,
  litSlugsFor,
  movementCaption,
  muscleBlocks,
  pillsFor,
  resultLabel,
  toggleFilter,
} from './exercise-catalogue'
import type { CatalogueTerm, Movement, MuscleTerm } from './content'

const MUSCLES: MuscleTerm[] = [
  { code: 'chest', name: 'Pecho', region: 'upper', body_slug: 'chest' },
  { code: 'lats', name: 'Dorsales', region: 'upper', body_slug: 'upper-back' },
  { code: 'upper_back', name: 'Espalda superior', region: 'upper', body_slug: 'upper-back' },
  { code: 'triceps', name: 'Tríceps', region: 'upper', body_slug: 'triceps' },
  { code: 'glutes', name: 'Glúteos', region: 'lower', body_slug: 'gluteal' },
  { code: 'cardio', name: 'Cardio', region: 'general', body_slug: null },
]

const EQUIPMENT: CatalogueTerm[] = [
  { code: 'barbell', name: 'Barra' },
  { code: 'dumbbell', name: 'Mancuernas' },
  { code: 'bench', name: 'Banco' },
]

const move = (name: string, muscles: string[], equipment: string[]): Movement => ({
  id: name,
  discipline_code: 'strength',
  demo_url: null,
  name,
  muscles,
  equipment,
})

const CATALOGUE: Movement[] = [
  move('Press de banca con barra', ['chest', 'triceps'], ['barbell', 'bench']),
  move('Press de banca con mancuernas', ['chest', 'triceps'], ['dumbbell', 'bench']),
  move('Jalón al pecho', ['lats', 'upper_back'], ['barbell']),
  move('Hip thrust', ['glutes'], ['barbell', 'bench']),
  move('Carrera continua', ['cardio'], []),
]

describe('what survives the filters', () => {
  const chest = toggleFilter(NOTHING_FILTERED, 'muscle', 'chest', MUSCLES)

  test('T-SP-CAT-01 one muscle answers the movements that work it', () => {
    expect(applyFilter(CATALOGUE, chest).map((one) => one.name)).toEqual([
      'Press de banca con barra',
      'Press de banca con mancuernas',
    ])
  })

  test('T-SP-CAT-02 a second value of the same facet widens, because it is or', () => {
    const both = toggleFilter(chest, 'muscle', 'glutes', MUSCLES)

    expect(applyFilter(CATALOGUE, both)).toHaveLength(3)
  })

  test('T-SP-CAT-03 the two facets narrow each other, because between them it is and', () => {
    // The pair that proves the semantics are not uniformly `or` — the mistake that
    // looks right until somebody uses it.
    const narrowed = toggleFilter(chest, 'equipment', 'dumbbell', EQUIPMENT)

    expect(applyFilter(CATALOGUE, narrowed).map((one) => one.name)).toEqual([
      'Press de banca con mancuernas',
    ])
  })

  test('T-SP-CAT-04 the typed name narrows on top of both', () => {
    expect(applyFilter(CATALOGUE, chest, 'mancuernas')).toHaveLength(1)
    expect(applyFilter(CATALOGUE, NOTHING_FILTERED, 'press')).toHaveLength(2)
  })

  test('T-SP-CAT-05 a movement with no equipment is not lost, only never matched by one', () => {
    const free = toggleFilter(NOTHING_FILTERED, 'equipment', 'barbell', EQUIPMENT)

    expect(applyFilter(CATALOGUE, NOTHING_FILTERED)).toHaveLength(5)
    expect(applyFilter(CATALOGUE, free).some((one) => one.name === 'Carrera continua')).toBe(false)
  })

  test('T-SP-CAT-06 nothing chosen is not filtering, which is a different state from empty', () => {
    expect(anyFilter(NOTHING_FILTERED)).toBe(false)
    expect(anyFilter(chest)).toBe(true)
    expect(anyFilter(clearFacet(chest, 'muscle'))).toBe(false)
  })
})

describe('the numbers a filter screen shows', () => {
  test('T-SP-CAT-07 a tile counts what stands behind it, not what would remain', () => {
    // Counting the intersection would read zero for half the grid the moment
    // anything else was on, and the number is there to say what the tile holds.
    expect(countFor(CATALOGUE, 'equipment', 'bench')).toBe(3)
    expect(countFor(CATALOGUE, 'muscle', 'chest')).toBe(2)
    expect(countFor(CATALOGUE, 'muscle', 'nothing')).toBe(0)
  })

  test('T-SP-CAT-08 the button says how many, in the right number', () => {
    expect(resultLabel(0)).toBe('Ver 0 ejercicios')
    expect(resultLabel(1)).toBe('Ver 1 ejercicio')
    expect(resultLabel(12)).toBe('Ver 12 ejercicios')
  })

  test('T-SP-CAT-09 a facet says what it is set to without being opened', () => {
    const one = toggleFilter(NOTHING_FILTERED, 'muscle', 'chest', MUSCLES)

    expect(facetSummary(NOTHING_FILTERED, 'muscle')).toBe('cualquiera')
    expect(facetSummary(one, 'muscle')).toBe('1 grupo')
    expect(facetSummary(toggleFilter(one, 'muscle', 'glutes', MUSCLES), 'muscle')).toBe('2 grupos')
    expect(
      facetSummary(toggleFilter(NOTHING_FILTERED, 'equipment', 'barbell', EQUIPMENT), 'equipment'),
    ).toBe('1 tipo')
  })

  test('T-SP-CAT-10 the list count says when it is filtered and not the whole library', () => {
    expect(listSummary(38, false)).toBe('38 ejercicios')
    expect(listSummary(1, false)).toBe('1 ejercicio')
    expect(listSummary(4, true)).toBe('4 ejercicios · filtrado')
  })
})

describe('what each row and each pill says', () => {
  test('T-SP-CAT-11 a row names what it works and what it needs, muscles first', () => {
    const bench = move('Press de banca con barra', ['chest', 'triceps'], ['barbell', 'bench'])

    expect(movementCaption(bench, MUSCLES, EQUIPMENT)).toBe('Pecho · Tríceps · Barra · Banco')
  })

  test('T-SP-CAT-12 a row names at most two muscles, because the line is one line', () => {
    const many = move('Peso muerto', ['chest', 'triceps', 'glutes', 'lats'], ['barbell'])

    expect(movementCaption(many, MUSCLES, EQUIPMENT)).toBe('Pecho · Tríceps · Barra')
  })

  test('T-SP-CAT-13 a code the vocabulary does not have is dropped, not drawn blank', () => {
    const odd = move('Rara', ['retired'], ['gone'])

    expect(movementCaption(odd, MUSCLES, EQUIPMENT)).toBe('')
    expect(pillsFor({ muscles: ['retired'], equipment: [] }, MUSCLES, EQUIPMENT)).toEqual([])
  })

  test('T-SP-CAT-14 each pill knows its own facet, so removing one removes only it', () => {
    const both = toggleFilter(
      toggleFilter(NOTHING_FILTERED, 'muscle', 'chest', MUSCLES),
      'equipment',
      'bench',
      EQUIPMENT,
    )
    const pills = pillsFor(both, MUSCLES, EQUIPMENT)

    expect(pills).toEqual([
      { facet: 'muscle', code: 'chest', name: 'Pecho' },
      { facet: 'equipment', code: 'bench', name: 'Banco' },
    ])

    const [first] = pills
    if (first === undefined) throw new Error('the pills are the point of this test')
    const withoutChest = toggleFilter(both, first.facet, first.code, MUSCLES)
    expect(withoutChest.muscles).toEqual([])
    expect(withoutChest.equipment).toEqual(['bench'])
  })
})

describe('the figure and the muscle list say the same thing', () => {
  test('T-SP-CAT-15 one part stands for every muscle that shares it', () => {
    // The figure has no lat of its own, so Dorsales takes the upper back and shares
    // it. Tapping the shape turns both on, because the drawing cannot tell them apart.
    expect(codesForBodySlug(MUSCLES, 'upper-back')).toEqual(['lats', 'upper_back'])
    expect(codesForBodySlug(MUSCLES, 'chest')).toEqual(['chest'])
    expect(codesForBodySlug(MUSCLES, 'nothing')).toEqual([])
  })

  test('T-SP-CAT-16 choosing a shared muscle lights its part, rather than nothing', () => {
    // The defect this replaces: Dorsales had no part, so choosing it lit nothing and
    // the figure looked broken.
    expect(litSlugsFor(MUSCLES, ['lats'])).toEqual(['upper-back'])
  })

  test('T-SP-CAT-17 a muscle that is not a body part lights nothing rather than failing', () => {
    // Cardio and whole body are chosen from the list alone, which is why the list is
    // not optional.
    expect(litSlugsFor(MUSCLES, ['cardio'])).toEqual([])
    expect(litSlugsFor(MUSCLES, ['chest', 'cardio'])).toEqual(['chest'])
  })

  test('T-SP-CAT-18 the blocks follow the catalogue regions, upper before lower', () => {
    const blocks = muscleBlocks(MUSCLES)

    expect(blocks.map((block) => block.region)).toEqual(['upper', 'lower', 'general'])
    expect(blocks[0]?.title).toBe('TREN SUPERIOR')
    expect(blocks[0]?.muscles).toHaveLength(4)
  })

  test('T-SP-CAT-19 an empty vocabulary is no blocks, not one empty block', () => {
    expect(muscleBlocks([])).toEqual([])
  })
})

describe('turning one on and off', () => {
  test('T-SP-CAT-20 tapping twice takes it back', () => {
    const on = toggleFilter(NOTHING_FILTERED, 'muscle', 'chest', MUSCLES)

    expect(isFiltered(on, 'muscle', 'chest')).toBe(true)
    expect(toggleFilter(on, 'muscle', 'chest', MUSCLES).muscles).toEqual([])
  })

  test('T-SP-CAT-21 the facet keeps the vocabulary order, not the order of the taps', () => {
    const tapped = toggleFilter(
      toggleFilter(NOTHING_FILTERED, 'muscle', 'glutes', MUSCLES),
      'muscle',
      'chest',
      MUSCLES,
    )

    expect(tapped.muscles).toEqual(['chest', 'glutes'])
  })

  test('T-SP-CAT-22 the two facets are independent, because they mean different things', () => {
    const both = toggleFilter(
      toggleFilter(NOTHING_FILTERED, 'muscle', 'chest', MUSCLES),
      'equipment',
      'barbell',
      EQUIPMENT,
    )

    expect(isFiltered(both, 'muscle', 'barbell')).toBe(false)
    expect(clearFacet(both, 'equipment').muscles).toEqual(['chest'])
  })
})
