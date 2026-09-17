/**
 * The sets of an exercise, and the schemes that fill them in one go.
 *
 * A routine that says «4 × 8» describes badly what somebody is about to do. Nobody
 * does four identical sets: the first warms up light, the middle ones are work, and
 * the last goes to failure with no rep count because the count is whatever comes out.
 * `ADR-030` is why the model carries a row per set; this is the part that makes filling
 * them bearable, because typing five rows by hand for every exercise is not.
 *
 * **The load is per set and its unit is per exercise.** A barbell is loaded in one
 * unit, not a different one on each set, and `planned_sets` stores the code on every
 * row because that is where the database keeps it — so the unit is written down onto
 * the rows on the way out rather than held twice.
 *
 * Nothing here knows which unit a person prefers, because nothing in the model does:
 * `identity.people` has no such column, and `body_progress_records` remembers the unit
 * of a measurement rather than a preference. `kg` is the opening because it is the
 * catalogue's canonical mass, and the exercise carries what was chosen instead.
 */

import type { BadgeTone } from '@allfitone/react-native/badge'

export type SetKind = 'normal' | 'warmup' | 'to_failure' | 'drop'

export type MassUnit = 'kg' | 'lb'

/** The catalogue's canonical mass, and what an exercise opens in. */
export const OPENING_UNIT: MassUnit = 'kg'

export interface WorkingSet {
  readonly kind: SetKind
  /** Absent for a set to failure, where the number is whatever comes out. */
  readonly reps?: number
  /** Absent until somebody says it: nothing invents a weight for another person. */
  readonly load?: number
}

const NORMAL = (reps: number): WorkingSet => ({ kind: 'normal', reps })

/** What an exercise starts with. Four of eight, and every one of them editable. */
export const OPENING_SETS: readonly WorkingSet[] = [NORMAL(8), NORMAL(8), NORMAL(8), NORMAL(8)]

export const SET_KIND_NAMES: Readonly<Record<SetKind, string>> = {
  normal: 'Normal',
  warmup: 'Calentamiento',
  to_failure: 'Al fallo',
  drop: 'Descendente',
}

/**
 * The badge's tone per kind, and each one is a meaning rather than a taste.
 *
 * `normal` stays neutral because it is the ordinary case and colour spent on the
 * default leaves none for the exception. A warm-up is a caution — it does not count
 * as work, and counting it is the mistake. To failure is the one that hurts. A drop
 * set borrows the palette's non-status hue, the same one the disciplines use when a
 * colour has to say «a different kind of thing» and not «something is wrong».
 */
export const SET_KIND_TONES: Readonly<Record<SetKind, BadgeTone>> = {
  normal: 'neutral',
  warmup: 'warning',
  to_failure: 'danger',
  drop: 'sport',
}

export const SET_KIND_DETAILS: Readonly<Record<SetKind, string>> = {
  normal: 'Serie de trabajo, la que cuenta para el volumen',
  warmup: 'Carga ligera, no suma al volumen',
  to_failure: 'Hasta no poder más. Sin número de repeticiones',
  drop: 'Bajas peso y sigues sin descansar',
}

/**
 * Changing a set's kind can invalidate its reps, and the database refuses the pair
 * rather than fixing it. A set to failure has no number by definition.
 */
export function withKind(set: WorkingSet, kind: SetKind): WorkingSet {
  const load = set.load === undefined ? {} : { load: set.load }
  if (kind === 'to_failure') return { kind, ...load }
  return { kind, reps: set.reps ?? 8, ...load }
}

/**
 * Reps and load, set or cleared. Both take `undefined` and drop the key rather than
 * carrying it: an absent weight and a weight of `undefined` are the same fact, and
 * only one of them is a shape `stepsToContent` can decide about.
 */
export function withReps(set: WorkingSet, reps: number | undefined): WorkingSet {
  const { reps: _was, ...rest } = set
  return reps === undefined ? rest : { ...rest, reps }
}

export function withLoad(set: WorkingSet, load: number | undefined): WorkingSet {
  const { load: _was, ...rest } = set
  return load === undefined ? rest : { ...rest, load }
}

/** What the weight column shows. A set nobody has loaded says so, not «0». */
export function loadLabel(load: number | undefined, unit: MassUnit): string {
  return load === undefined ? '—' : `${load} ${unit}`
}

/** The other one. The exercise carries a unit, so there is always one to swap to. */
export function otherUnit(unit: MassUnit): MassUnit {
  return unit === 'kg' ? 'lb' : 'kg'
}

/** What the row says under the name: «4 × 8», «3 series», «4 series · varía». */
export function setsLabel(sets: readonly WorkingSet[]): string {
  if (sets.length === 0) return 'Sin series'
  const counted = sets.filter((one) => one.kind !== 'warmup').length || sets.length
  const reps = new Set(sets.map((one) => one.reps))
  if (reps.size === 1) {
    const only = sets[0]?.reps
    if (only === undefined) return `${counted} series · al fallo`
    return `${counted} × ${only}`
  }
  return `${counted} series · varía`
}

/** Rest reads as a clock, because that is how somebody waiting for it thinks of it. */
export function restLabel(seconds: number | undefined): string {
  if (seconds === undefined) return 'Sin descanso definido'
  if (seconds === 0) return 'Sin descanso'
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes === 0) return `${rest} s`
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`
}

export const REST_PRESETS: readonly number[] = [0, 45, 60, 90, 120, 180, 300]

/** The step somebody edits, and the wheel moves in fifteens. */
export const REST_STEP_SECONDS = 15
