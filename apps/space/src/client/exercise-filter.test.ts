import { describe, expect, test } from 'bun:test'

import {
  NOTHING_FILTERED,
  anyFilter,
  chosenNames,
  filterSummary,
  isFiltered,
  muscleBlocks,
  toggleFilter,
} from './exercise-filter'
import type { CatalogueTerm, MuscleTerm } from './content'

const MUSCLES: MuscleTerm[] = [
  { code: 'chest', name: 'Pecho', region: 'upper', body_slug: 'chest' },
  { code: 'lats', name: 'Dorsales', region: 'upper', body_slug: null },
  { code: 'glutes', name: 'Glúteos', region: 'lower', body_slug: 'gluteal' },
  { code: 'cardio', name: 'Cardio', region: 'general', body_slug: null },
]

const EQUIPMENT: CatalogueTerm[] = [
  { code: 'barbell', name: 'Barra' },
  { code: 'dumbbell', name: 'Mancuernas' },
]

describe('the two chip rows', () => {
  test('T-SP-FILTER-01 tapping a chip turns it on and tapping it again turns it off', () => {
    const on = toggleFilter(NOTHING_FILTERED, 'muscle', 'chest', MUSCLES)
    expect(isFiltered(on, 'muscle', 'chest')).toBe(true)

    expect(toggleFilter(on, 'muscle', 'chest', MUSCLES).muscles).toEqual([])
  })

  test('T-SP-FILTER-02 the row keeps the vocabulary order, not the order of the taps', () => {
    const tapped = toggleFilter(
      toggleFilter(NOTHING_FILTERED, 'muscle', 'glutes', MUSCLES),
      'muscle',
      'chest',
      MUSCLES,
    )

    expect(tapped.muscles).toEqual(['chest', 'glutes'])
  })

  test('T-SP-FILTER-03 the two rows are independent, because they mean different things', () => {
    const both = toggleFilter(
      toggleFilter(NOTHING_FILTERED, 'muscle', 'chest', MUSCLES),
      'equipment',
      'barbell',
      EQUIPMENT,
    )

    expect(both.muscles).toEqual(['chest'])
    expect(both.equipment).toEqual(['barbell'])
    expect(isFiltered(both, 'muscle', 'barbell')).toBe(false)
  })

  test('T-SP-FILTER-04 nothing chosen is not filtered, which is a different state from empty', () => {
    expect(anyFilter(NOTHING_FILTERED)).toBe(false)
    expect(anyFilter(toggleFilter(NOTHING_FILTERED, 'equipment', 'barbell', EQUIPMENT))).toBe(true)
  })

  test('T-SP-FILTER-05 the count says when it is a filtered count and not the whole library', () => {
    expect(filterSummary(NOTHING_FILTERED, 38)).toBe('38 EJERCICIOS')
    expect(filterSummary(NOTHING_FILTERED, 1)).toBe('1 EJERCICIO')
    expect(filterSummary(toggleFilter(NOTHING_FILTERED, 'muscle', 'chest', MUSCLES), 4)).toBe(
      '4 EJERCICIOS · FILTRADO',
    )
  })
})

describe('nineteen chips come grouped, because nineteen in a row is a wall', () => {
  test('T-SP-FILTER-06 the blocks follow the catalogue regions, upper before lower', () => {
    const blocks = muscleBlocks(MUSCLES)

    expect(blocks.map((block) => block.region)).toEqual(['upper', 'lower', 'general'])
    expect(blocks[0]?.title).toBe('TREN SUPERIOR')
    expect(blocks[0]?.muscles.map((one) => one.code)).toEqual(['chest', 'lats'])
  })

  test('T-SP-FILTER-07 the order is the reading order, whatever order the rows arrive in', () => {
    // The catalogue orders by `display_order`, not by region, so the blocks cannot
    // assume the rows come grouped.
    const scrambled = [MUSCLES[3], MUSCLES[2], MUSCLES[0], MUSCLES[1]].filter(
      (one): one is MuscleTerm => one !== undefined,
    )

    expect(muscleBlocks(scrambled).map((block) => block.region)).toEqual([
      'upper',
      'lower',
      'general',
    ])
  })

  test('T-SP-FILTER-08 an empty vocabulary is no blocks, not one empty block', () => {
    expect(muscleBlocks([])).toEqual([])
  })
})

describe('saying what is being filtered', () => {
  test('T-SP-FILTER-09 names both rows, in the order they are drawn', () => {
    const both = toggleFilter(
      toggleFilter(NOTHING_FILTERED, 'muscle', 'glutes', MUSCLES),
      'equipment',
      'dumbbell',
      EQUIPMENT,
    )

    expect(chosenNames(both, MUSCLES, EQUIPMENT)).toEqual(['Glúteos', 'Mancuernas'])
  })

  test('T-SP-FILTER-10 a code the vocabulary no longer has is dropped, not drawn blank', () => {
    const stale = { muscles: ['retired'], equipment: [] }

    expect(chosenNames(stale, MUSCLES, EQUIPMENT)).toEqual([])
  })
})
