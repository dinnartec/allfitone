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

export type ProgramDay = AllfitV1Schemas['SpaceProgramDay']
export type ProgramStep = AllfitV1Schemas['SpaceProgramStep']

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
  // Short forms of what the onboarding calls them — "Estoy empezando", "Tengo algo de
  // práctica", "Tengo experiencia". Never "principiante": that vocabulary was
  // rejected there, and a chip is not the place to bring it back.
  starting: 'empezando',
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

/**
 * Lo que la tarjeta del catálogo escribe debajo del nombre.
 *
 * Las tres cosas que `HU-SP-100` criterio 4 pide que se vean antes de elegir y que caben
 * en una línea: cuántos días, cuánto dura y para qué nivel es. Las zonas son la cuarta y
 * no van aquí —son fichas, no palabras—, porque siete zonas en una línea son un párrafo.
 *
 * **«Sin fin» y no un hueco**: un programa que se repite hasta que alguien lo cambie no
 * tiene un número que dar, y dejar el sitio vacío se lee como un dato que falta.
 */
export function posterCaption(program: ProgramSummary): string {
  const days = `${program.days_per_week} días`
  const lasting = program.weeks === null ? 'Sin fin' : `${program.weeks} semanas`
  const level = (['starting', 'some_practice', 'experienced'] as const).find((candidate) =>
    program.levels.includes(candidate),
  )
  return level ? `${days} · ${lasting} · ${LEVEL_LABEL[level]}` : `${days} · ${lasting}`
}

/** La lista que el primer día enseña, y cuántos programas quedan sin enseñar. */
export interface CatalogueList {
  readonly cards: readonly ProgramCard[]
  readonly hidden: number
}

/**
 * Lo que se lista en el primer día, plegado o extendido.
 *
 * **Plegado son las tres frecuencias** —`cardsFor`—, que es la pregunta que el onboarding
 * nunca hizo. **Extendido es el catálogo entero ordenado por correspondencia**, en la
 * misma pantalla y sin perder la marca: el programa sugerido sigue siéndolo cuando la
 * lista crece, o extenderla parecería haber cambiado de recomendación.
 *
 * **Y el sugerido va primero en las dos.** Las frecuencias salían en orden ascendente,
 * así que la recomendación podía quedar segunda o tercera y había que buscarla; y en el
 * catálogo entero, ordenar por correspondencia la deja arriba casi siempre, que no es lo
 * mismo que siempre. Lo que se recomienda se lee primero.
 */
export function catalogueList(
  programs: readonly ProgramSummary[],
  profile: TrainingProfile,
  expanded: boolean,
): CatalogueList {
  const folded = cardsFor(programs, profile)
  const marked = folded.find((card) => card.suggested)?.program.program_version_id
  if (!expanded) {
    return {
      cards: suggestedFirst(folded),
      hidden: Math.max(0, programs.length - folded.length),
    }
  }

  return {
    cards: suggestedFirst(
      rankCatalogue(programs, profile).map((program) => ({
        program,
        suggested: program.program_version_id === marked,
      })),
    ),
    hidden: 0,
  }
}

/** El sugerido delante y el resto en el orden en que venían. */
function suggestedFirst(cards: readonly ProgramCard[]): readonly ProgramCard[] {
  const marked = cards.filter((card) => card.suggested)
  return marked.length === 0 ? cards : [...marked, ...cards.filter((card) => !card.suggested)]
}

/**
 * Los minutos que el encabezado del detalle anuncia por sesión.
 *
 * **El promedio de los días y no el total del programa.** Lo que alguien está decidiendo
 * es cuánto le va a costar una tarde, no cuántas horas suma el plan entero; sumarlos
 * daría una cifra grande y sin uso. Se redondea a los cinco más cercanos porque es una
 * estimación y escribirla al minuto la haría parecer medida.
 *
 * Los días que no estiman nada —ninguno de sus pasos dice cuánto dura— no entran en el
 * promedio en vez de contar como cero, que lo hundiría.
 */
export function sessionMinutes(days: readonly ProgramDay[]): number {
  const estimates = days.map(estimatedMinutes).filter((minutes) => minutes > 0)
  if (estimates.length === 0) return 0
  const average = estimates.reduce((total, minutes) => total + minutes, 0) / estimates.length
  return Math.max(5, Math.round(average / 5) * 5)
}

/** Cuántos ejercicios tiene el reparto entero, que es lo que dice si es denso o ligero. */
export function totalExercises(days: readonly ProgramDay[]): number {
  return days.reduce((total, day) => total + day.steps.length, 0)
}

/** Lo que la tarjeta de un día escribe bajo su nombre: «5 ej · ~50 min». */
export function dayFigures(day: ProgramDay): string {
  const exercises = `${day.steps.length} ej`
  const minutes = estimatedMinutes(day)
  return minutes > 0 ? `${exercises} · ~${minutes} min` : exercises
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

/**
 * How a target reads on screen: "4 × 8", "5 km", "30 min", "8 × 40s".
 *
 * The server sends the target structured rather than formatted so this can be
 * asserted in a test instead of being judged from a screenshot, and so the same
 * numbers can be shown differently somewhere else without a second endpoint.
 */
export function targetLabel(target: ProgramStep['target']): string {
  const value = (key: string): number | undefined => {
    const raw = (target as Record<string, unknown>)[key]
    return typeof raw === 'number' ? raw : undefined
  }
  const family = (target as { family?: unknown }).family

  if (family === 'strength') {
    const sets = value('target_sets')
    const reps = value('target_reps')
    if (sets === undefined) return ''
    // No reps is a hold — a plank is three sets of "as long as you can".
    return reps === undefined ? `${sets} series` : `${sets} × ${reps}`
  }
  if (family === 'endurance') {
    const distance = value('target_distance_value')
    if (distance !== undefined) {
      const unit = (target as { target_distance_unit_code?: unknown }).target_distance_unit_code
      return `${distance} ${typeof unit === 'string' ? unit : ''}`.trim()
    }
    const seconds = value('target_duration_seconds')
    return seconds === undefined ? '' : `${Math.round(seconds / 60)} min`
  }
  if (family === 'interval') {
    const rounds = value('rounds')
    const work = value('work_duration_seconds')
    if (rounds === undefined || work === undefined) return ''
    return `${rounds} × ${work}s`
  }
  if (family === 'mobility') {
    const hold = value('hold_duration_seconds')
    const reps = value('target_repetitions')
    if (hold !== undefined) return `${hold}s`
    return reps === undefined ? '' : `${reps} rep`
  }
  return ''
}

/** Rest between strength sets, which nothing in the catalogue records. */
const SECONDS_PER_SET = 180
/** A kilometre at a conversational pace, which is what these programs prescribe. */
const SECONDS_PER_KM = 360
const MOBILITY_DEFAULT_SECONDS = 60

/**
 * Roughly how long a day takes, in minutes, rounded to five.
 *
 * **It is an estimate and the screen says so with a `~`.** Nothing in the catalogue
 * records rest between sets or the pace somebody runs at, so two coefficients are
 * assumed and named above rather than buried: three minutes a set, six minutes a
 * kilometre. Everything else comes from the targets themselves.
 *
 * Zero when a day carries nothing measurable, and the caller shows nothing rather
 * than "~0 min".
 */
export function estimatedMinutes(day: ProgramDay): number {
  const seconds = day.steps.reduce((total, step) => {
    const target = step.target as Record<string, unknown>
    const number = (key: string): number => (typeof target[key] === 'number' ? target[key] : 0)

    switch (target.family) {
      case 'strength':
        return total + number('target_sets') * SECONDS_PER_SET
      case 'endurance':
        return (
          total +
          (number('target_duration_seconds') || number('target_distance_value') * SECONDS_PER_KM)
        )
      case 'interval':
        return (
          total +
          number('rounds') * (number('work_duration_seconds') + number('rest_duration_seconds'))
        )
      case 'mobility':
        return total + (number('hold_duration_seconds') || MOBILITY_DEFAULT_SECONDS)
      default:
        return total
    }
  }, 0)

  return Math.round(seconds / 60 / 5) * 5
}
