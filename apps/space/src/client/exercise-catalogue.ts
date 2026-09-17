/**
 * The catalogue the exercise picker holds, and everything it decides about it.
 *
 * **It filters in memory.** The library is 38 movements and `OP-CAT-009` answers
 * all of them, with their muscles and their equipment, in one call. Holding that and
 * narrowing it here is what makes the counts instant — and it is the only way the
 * filter screens can say «Ver 12 ejercicios» *before* the filter is applied, which
 * with a server round trip would be a request per tap.
 *
 * The server still filters, and `OP-CAT-009` still takes `muscle` and `equipment`:
 * those are right for a catalogue past one page, and they stay. Today Space does not
 * call them. If the two ever disagree the server is the one that is right.
 *
 * **Several codes of one facet are `or`; the two facets are `and`.** Picking a second
 * muscle widens, adding equipment narrows. That is how a filter reads, and it is the
 * same rule the database enforces.
 *
 * Nothing here knows about screens. What a chosen filter looks like, and which screen
 * sets it, belongs to the screens; this answers what is in and what it is called.
 */

import type { CatalogueTerm, Movement, MuscleTerm } from './content'

export type FilterFacet = 'muscle' | 'equipment'

export interface ExerciseFilter {
  readonly muscles: readonly string[]
  readonly equipment: readonly string[]
}

export const NOTHING_FILTERED: ExerciseFilter = { muscles: [], equipment: [] }

/**
 * The caption is one line and never wraps, so it names the muscle the movement is
 * for and the thing it is done with. Four terms wrapped and left a word orphaned on
 * its own line, which is what made a long list look broken.
 */
const CAPTION_MUSCLES = 1

const CAPTION_EQUIPMENT = 1

export function codesIn(filter: ExerciseFilter, facet: FilterFacet): readonly string[] {
  return facet === 'muscle' ? filter.muscles : filter.equipment
}

export function isFiltered(filter: ExerciseFilter, facet: FilterFacet, code: string): boolean {
  return codesIn(filter, facet).includes(code)
}

export function anyFilter(filter: ExerciseFilter): boolean {
  return filter.muscles.length > 0 || filter.equipment.length > 0
}

/**
 * Adds a code to its facet, or removes it if it was already on.
 *
 * Order follows the vocabulary rather than the taps, the same way `toggleFocus`
 * canonicalises its zones: what travels should read the way the list reads.
 */
export function toggleFilter(
  filter: ExerciseFilter,
  facet: FilterFacet,
  code: string,
  vocabulary: readonly { readonly code: string }[],
): ExerciseFilter {
  const current = codesIn(filter, facet)
  const next = current.includes(code)
    ? current.filter((one) => one !== code)
    : vocabulary.map((term) => term.code).filter((one) => one === code || current.includes(one))
  return facet === 'muscle' ? { ...filter, muscles: next } : { ...filter, equipment: next }
}

export function clearFacet(filter: ExerciseFilter, facet: FilterFacet): ExerciseFilter {
  return facet === 'muscle' ? { ...filter, muscles: [] } : { ...filter, equipment: [] }
}

/** What survives the two facets and the name somebody typed. */
export function applyFilter(
  movements: readonly Movement[],
  filter: ExerciseFilter,
  query = '',
): readonly Movement[] {
  const typed = query.trim().toLowerCase()
  return movements.filter((movement) => {
    if (typed !== '' && !movement.name.toLowerCase().includes(typed)) return false
    if (
      filter.muscles.length > 0 &&
      !movement.muscles.some((one) => filter.muscles.includes(one))
    ) {
      return false
    }
    if (
      filter.equipment.length > 0 &&
      !movement.equipment.some((one) => filter.equipment.includes(one))
    ) {
      return false
    }
    return true
  })
}

/**
 * How many movements one code stands for, ignoring everything else that is on.
 *
 * Deliberately not "how many would remain": a tile that counted the intersection
 * would read zero for half the grid the moment anything else was chosen, and the
 * number is there to say what is behind the tile, not to predict the next screen.
 */
export function countFor(movements: readonly Movement[], facet: FilterFacet, code: string): number {
  return movements.filter((movement) =>
    (facet === 'muscle' ? movement.muscles : movement.equipment).includes(code),
  ).length
}

/** What the button at the bottom of a filter screen says. */
export function resultLabel(count: number): string {
  return count === 1 ? 'Ver 1 ejercicio' : `Ver ${count} ejercicios`
}

/** What a facet's button says it is set to, without opening it. */
export function facetSummary(filter: ExerciseFilter, facet: FilterFacet): string {
  const chosen = codesIn(filter, facet).length
  if (chosen === 0) return 'cualquiera'
  if (facet === 'muscle') return chosen === 1 ? '1 grupo' : `${chosen} grupos`
  return chosen === 1 ? '1 tipo' : `${chosen} tipos`
}

/** The count over the list, saying when it is a filtered count and not the library. */
export function listSummary(shown: number, filtering: boolean): string {
  const exercises = shown === 1 ? '1 ejercicio' : `${shown} ejercicios`
  return filtering ? `${exercises} · filtrado` : exercises
}

/** What a row says under the name: what it works, and what it needs. */
export function movementCaption(
  movement: Movement,
  muscles: readonly CatalogueTerm[],
  equipment: readonly CatalogueTerm[],
): string {
  const worked = movement.muscles
    .map((code) => nameFor(muscles, code))
    .filter((name) => name !== undefined)
    .slice(0, CAPTION_MUSCLES)
  const needed = movement.equipment
    .map((code) => nameFor(equipment, code))
    .filter((name) => name !== undefined)
    .slice(0, CAPTION_EQUIPMENT)
  return [...worked, ...needed].join(' · ')
}

export interface FilterPill {
  readonly facet: FilterFacet
  readonly code: string
  readonly name: string
}

/**
 * Everything that is on, named, each one removable by itself.
 *
 * A code the vocabulary no longer has is dropped rather than drawn blank: a pill
 * with no name is one somebody cannot decide about.
 */
export function pillsFor(
  filter: ExerciseFilter,
  muscles: readonly CatalogueTerm[],
  equipment: readonly CatalogueTerm[],
): readonly FilterPill[] {
  return [...pillsOf(filter, 'muscle', muscles), ...pillsOf(filter, 'equipment', equipment)]
}

function pillsOf(
  filter: ExerciseFilter,
  facet: FilterFacet,
  vocabulary: readonly CatalogueTerm[],
): readonly FilterPill[] {
  return codesIn(filter, facet)
    .map((code) => ({ facet, code, name: nameFor(vocabulary, code) }))
    .filter((pill): pill is FilterPill => pill.name !== undefined)
}

function nameFor(vocabulary: readonly CatalogueTerm[], code: string): string | undefined {
  return vocabulary.find((term) => term.code === code)?.name
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

/**
 * Which catalogue muscles a part of the figure stands for.
 *
 * The figure speaks the library's slugs and the filter speaks catalogue codes, and
 * `body_slug` is the bridge. It is many-to-one in this direction — several muscles can
 * share a drawn part — so tapping one part turns on everything it draws.
 */
export function codesForBodySlug(muscles: readonly MuscleTerm[], slug: string): readonly string[] {
  return muscles.filter((muscle) => muscle.body_slug === slug).map((muscle) => muscle.code)
}

/** The parts to light: every slug whose muscles are on. */
export function litSlugsFor(
  muscles: readonly MuscleTerm[],
  chosen: readonly string[],
): readonly string[] {
  return muscles
    .filter((muscle) => muscle.body_slug !== null && chosen.includes(muscle.code))
    .map((muscle) => muscle.body_slug)
    .filter((slug): slug is string => slug !== null)
}
