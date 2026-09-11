/**
 * The two chip rows over the exercise list, and what they mean together.
 *
 * The picker opened with one way to narrow 38 movements: typing the name. That only
 * helps somebody who already knows what the exercise is called, and the question a
 * person actually has is «what can I do for my back, with dumbbells».
 *
 * **Several chips of one row are `or`; the two rows are `and`.** Picking a second
 * muscle widens, adding equipment narrows. That is how every filter reads, and the
 * database enforces the same rule — this is the copy of it the screen can be tested
 * against, not a second implementation: the server filters, and if the two ever
 * disagree the server wins.
 *
 * The vocabularies are asked once when the screen opens and never again. A chip row
 * that reshuffled as somebody typed could not be used: you would reach for a chip
 * that had moved.
 */

import type { CatalogueTerm, MuscleTerm } from './content'

export type FilterFacet = 'muscle' | 'equipment'

export interface ExerciseFilter {
  readonly muscles: readonly string[]
  readonly equipment: readonly string[]
}

export const NOTHING_FILTERED: ExerciseFilter = { muscles: [], equipment: [] }

/**
 * Adds a code to its row, or removes it if it was already on.
 *
 * Order follows the vocabulary rather than the taps, the same way `toggleFocus`
 * canonicalises its zones: what travels should read the way the row reads.
 */
export function toggleFilter(
  filter: ExerciseFilter,
  facet: FilterFacet,
  code: string,
  vocabulary: readonly { readonly code: string }[],
): ExerciseFilter {
  const current = facet === 'muscle' ? filter.muscles : filter.equipment
  const next = current.includes(code)
    ? current.filter((one) => one !== code)
    : vocabulary.map((term) => term.code).filter((one) => one === code || current.includes(one))
  return facet === 'muscle' ? { ...filter, muscles: next } : { ...filter, equipment: next }
}

export function isFiltered(filter: ExerciseFilter, facet: FilterFacet, code: string): boolean {
  return (facet === 'muscle' ? filter.muscles : filter.equipment).includes(code)
}

export function anyFilter(filter: ExerciseFilter): boolean {
  return filter.muscles.length > 0 || filter.equipment.length > 0
}

/** What the row above the list says, so the count is never a mystery. */
export function filterSummary(filter: ExerciseFilter, shown: number): string {
  const exercises = shown === 1 ? '1 EJERCICIO' : `${shown} EJERCICIOS`
  return anyFilter(filter) ? `${exercises} · FILTRADO` : exercises
}

export interface MuscleBlock {
  readonly region: string
  readonly title: string
  readonly muscles: readonly MuscleTerm[]
}

const REGION_TITLE: Record<string, string> = {
  upper: 'TREN SUPERIOR',
  lower: 'TREN INFERIOR',
  general: 'GENERAL',
}

/**
 * Nineteen chips in one row is a wall, so they come grouped.
 *
 * The grouping is the catalogue's — `region` travels on every muscle — and not this
 * screen's invention. Regions are derived from the rows rather than from a fixed list,
 * so a region the contract does not declare yet gets its own block instead of dropping
 * its muscles: a muscle nobody can reach is worse than a heading nobody expected.
 */
export function muscleBlocks(muscles: readonly MuscleTerm[]): readonly MuscleBlock[] {
  const order = ['upper', 'lower', 'general']
  const regions = [...new Set(muscles.map((muscle) => muscle.region))].sort(
    (left, right) => indexOf(order, left) - indexOf(order, right),
  )
  return regions.map((region) => ({
    region,
    title: REGION_TITLE[region] ?? region.toUpperCase(),
    muscles: muscles.filter((muscle) => muscle.region === region),
  }))
}

function indexOf(order: readonly string[], value: string): number {
  const at = order.indexOf(value)
  return at === -1 ? order.length : at
}

/** The chips somebody picked, named, for the line that says what is being filtered. */
export function chosenNames(
  filter: ExerciseFilter,
  muscles: readonly MuscleTerm[],
  equipment: readonly CatalogueTerm[],
): readonly string[] {
  return [
    ...muscles.filter((one) => filter.muscles.includes(one.code)).map((one) => one.name),
    ...equipment.filter((one) => filter.equipment.includes(one.code)).map((one) => one.name),
  ]
}
