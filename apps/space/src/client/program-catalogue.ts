/**
 * Which programs to offer, and which one to suggest.
 *
 * The three cards are the **three frequencies** of the person's goal and level: same
 * objective, same band, and the only thing that changes is how many days a week they
 * can commit. A first cut hung the frequency off each program instead of treating it
 * as an axis, and somebody starting who could train five days was offered content
 * written for somebody advanced. That is why the catalogue holds every combination
 * and why this picks one program per frequency rather than the three highest scores.
 *
 * Scoring is deliberately blunt. It exists to break ties inside a frequency and to
 * order the full catalogue, not to be clever: the goal decides, the level narrows,
 * the declared zones nudge, and the affinity nudges least. Anything subtler would be
 * a recommendation engine, and V1 does not have one.
 *
 * Every field of the profile can be absent — the sex may have been declined, and the
 * steps behind the rest can be revisited — so each term simply drops out. A person
 * who answered nothing still gets three frequencies.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type ProgramSummary = AllfitV1Schemas['SpaceProgramSummary']
export type TrainingProfile = AllfitV1Schemas['SpaceTrainingProfile']
export type TrainingExperience = AllfitV1Schemas['TrainingExperience']

/** The frequencies the catalogue offers for every goal and every level. */
export const FREQUENCIES = [3, 4, 5] as const

const GOAL_WEIGHT = 4
const LEVEL_WEIGHT = 2
const EMPHASIS_WEIGHT = 1
const AFFINITY_WEIGHT = 0.5

/**
 * More experience, more days. It is the only rule the suggestion needs, and unlike a
 * score it can be explained to the person in one line.
 */
const SUGGESTED_FREQUENCY: Record<TrainingExperience, number> = {
  starting: 3,
  some_practice: 4,
  experienced: 5,
}

/** The middle of the three: the one most people can actually hold to. */
const DEFAULT_FREQUENCY = 4

export function scoreProgram(program: ProgramSummary, profile: TrainingProfile): number {
  let score = 0
  if (profile.primary_training_goal && program.goals.includes(profile.primary_training_goal)) {
    score += GOAL_WEIGHT
  }
  if (profile.training_experience && program.levels.includes(profile.training_experience)) {
    score += LEVEL_WEIGHT
  }
  for (const area of profile.focus_areas) {
    if (program.emphases.includes(area)) score += EMPHASIS_WEIGHT
  }
  if (profile.biological_sex && program.sex_affinity === profile.biological_sex) {
    score += AFFINITY_WEIGHT
  }
  return score
}

export function suggestedFrequency(experience: TrainingExperience | null): number {
  return experience ? SUGGESTED_FREQUENCY[experience] : DEFAULT_FREQUENCY
}

export interface ProgramCard {
  readonly program: ProgramSummary
  readonly suggested: boolean
}

/**
 * One card per frequency, in ascending order of days. A frequency the catalogue
 * cannot serve is simply absent rather than filled with something from another band:
 * offering the wrong level is worse than offering less.
 */
export function cardsFor(
  programs: readonly ProgramSummary[],
  profile: TrainingProfile,
): readonly ProgramCard[] {
  const best = FREQUENCIES.map((frequency) => bestAt(programs, profile, frequency)).filter(
    (program): program is ProgramSummary => program !== undefined,
  )
  if (best.length === 0) return []

  const wanted = suggestedFrequency(profile.training_experience)
  // The suggestion falls back to the closest frequency on offer, so the mark never
  // disappears just because the catalogue is missing the exact one.
  const marked = best.reduce((closest, program) =>
    Math.abs(program.days_per_week - wanted) < Math.abs(closest.days_per_week - wanted)
      ? program
      : closest,
  )

  return best.map((program) => ({
    program,
    suggested: program.program_version_id === marked.program_version_id,
  }))
}

/** The whole catalogue, best match first, for the screen behind "ver todos". */
export function rankCatalogue(
  programs: readonly ProgramSummary[],
  profile: TrainingProfile,
): readonly ProgramSummary[] {
  return [...programs].sort((left, right) => {
    const difference = scoreProgram(right, profile) - scoreProgram(left, profile)
    if (difference !== 0) return difference
    if (left.days_per_week !== right.days_per_week) return left.days_per_week - right.days_per_week
    return left.title.localeCompare(right.title)
  })
}

function bestAt(
  programs: readonly ProgramSummary[],
  profile: TrainingProfile,
  frequency: number,
): ProgramSummary | undefined {
  return programs
    .filter((program) => program.days_per_week === frequency)
    .reduce<ProgramSummary | undefined>((best, program) => {
      if (!best) return program
      const difference = scoreProgram(program, profile) - scoreProgram(best, profile)
      if (difference > 0) return program
      // A stable tiebreak, so two runs of the same catalogue never disagree.
      if (difference === 0 && program.title.localeCompare(best.title) < 0) return program
      return best
    }, undefined)
}

/** What the card says under the title: "5 días · con práctica". */
export const LEVEL_LABEL: Record<TrainingExperience, string> = {
  starting: 'empieza',
  some_practice: 'con práctica',
  experienced: 'con experiencia',
}

export function programCaption(program: ProgramSummary): string {
  const days = `${program.days_per_week} días`
  // The lowest band it serves: a program for both is described by where it starts.
  const level = (['starting', 'some_practice', 'experienced'] as const).find((candidate) =>
    program.levels.includes(candidate),
  )
  return level ? `${days} · ${LEVEL_LABEL[level]}` : days
}

export interface CatalogueFilter {
  readonly key: string
  readonly label: string
}

/**
 * The filters the "ver todos" screen offers, derived from the catalogue rather than
 * hardcoded: a frequency nobody publishes must not be offerable, and one that appears
 * later must appear here without anybody remembering to add it.
 *
 * `suggested` comes first because it is the only one that knows who is asking.
 */
export function filtersFor(programs: readonly ProgramSummary[]): readonly CatalogueFilter[] {
  const frequencies = [...new Set(programs.map((program) => program.days_per_week))].sort(
    (left, right) => left - right,
  )
  return [
    { key: 'suggested', label: 'Sugeridos' },
    { key: 'all', label: 'Todos' },
    ...frequencies.map((days) => ({ key: `days:${days}`, label: `${days} días` })),
  ]
}

/**
 * What a filter shows. `suggested` is the same three frequencies the first screen
 * offers, so the two screens cannot disagree about what "for you" means.
 */
export function applyFilter(
  key: string,
  programs: readonly ProgramSummary[],
  profile: TrainingProfile,
): readonly ProgramSummary[] {
  if (key === 'suggested') return cardsFor(programs, profile).map((card) => card.program)
  const ranked = rankCatalogue(programs, profile)
  const days = key.startsWith('days:') ? Number(key.slice('days:'.length)) : undefined
  if (days === undefined || Number.isNaN(days)) return ranked
  return ranked.filter((program) => program.days_per_week === days)
}
