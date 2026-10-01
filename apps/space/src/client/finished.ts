/**
 * A finished session as its detail shows it, and as its edit changes it (FIN-18, ADR-038).
 *
 * **Dates are said in the zone the person trains in**, worked out here rather than with
 * `Intl`'s Spanish month names, whose abbreviations vary by engine («sept.», «sep»): the
 * row on the phone has to read the same as the one in the test.
 *
 * **Editing reuses the session's own state** (`session-form.ts`), so a corrected set is
 * written exactly as a logged one. Two things differ. A past session opens with only what
 * was recorded, never the rows the routine proposed and nobody did; and each recorded set
 * carries its `origin`, so the screen can say «antes 65» and undo a change even after
 * sets above it were removed and the ladder renumbered.
 */

import type { ExecutionResults } from './execution'
import type { Execution, FinishedExecution, FinishedSet, InvalidationPreview } from './execution'
import { resultsFrom, withExtraSet, workingStateFrom, type WorkingExercise } from './session-form'

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

const figure = (value: number) => value.toLocaleString('es-CO', { maximumFractionDigits: 2 })

/** The local calendar day and clock of an instant, in the person's zone. */
function localParts(iso: string, timeZone: string) {
  const at = new Date(iso)
  const [year = 1970, month = 1, day = 1] = new Intl.DateTimeFormat('en-CA', { timeZone })
    .format(at)
    .split('-')
    .map(Number)
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at)
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? ''
  return { day, month: MONTHS[month - 1] ?? '', weekday, clock }
}

/** «18:02», the clock an instant shows in the person's zone. */
export function clockOf(iso: string, timeZone: string): string {
  return localParts(iso, timeZone).clock
}

/**
 * The instant at «HH:MM» on the same local day, in the person's zone; null for anything
 * that is not a clock. The zone's offset is read at that moment, so a change of offset
 * on another day cannot move it.
 */
export function withClock(iso: string, clock: string, timeZone: string): string | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(clock.trim())
  if (!match) return null
  const [year = 1970, month = 1, day = 1] = new Intl.DateTimeFormat('en-CA', { timeZone })
    .format(new Date(iso))
    .split('-')
    .map(Number)
  const wall = Date.UTC(year, month - 1, day, Number(match[1]), Number(match[2]))
  const shown = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(new Date(wall))
    .reduce<Record<string, number>>(
      (parts, part) => ({ ...parts, [part.type]: Number(part.value) }),
      {},
    )
  const offset =
    Date.UTC(
      shown.year ?? year,
      (shown.month ?? month) - 1,
      shown.day ?? day,
      shown.hour ?? 0,
      shown.minute ?? 0,
    ) - wall
  return new Date(wall - offset).toISOString()
}

/** «70 kg × 8», «10 reps», «70 kg», or «—» for a set with neither. */
export function setLine(set: FinishedSet): string {
  const unit = set.load_unit_code ?? 'kg'
  const load = set.load_value === null ? null : `${figure(set.load_value)} ${unit}`
  if (load && set.achieved_reps !== null) return `${load} × ${set.achieved_reps}`
  if (load) return load
  if (set.achieved_reps !== null) return `${set.achieved_reps} reps`
  return '—'
}

/** «Mejor serie 70 kg × 8», or nothing when no work set was weighed. */
export function bestSetLine(
  best: FinishedExecution['exercises'][number]['best_set'],
): string | null {
  return best ? `Mejor serie ${figure(best.load_kg)} kg × ${best.reps}` : null
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** «4 ejercicios · 12 series». A warmup is not a work set. */
export function exercisesLine(detail: FinishedExecution): string {
  const work = detail.exercises.reduce(
    (total, exercise) => total + exercise.sets.filter((one) => one.kind !== 'warmup').length,
    0,
  )
  return `${plural(detail.exercises.length, 'ejercicio', 'ejercicios')} · ${plural(work, 'serie', 'series')}`
}

/** «+4 % de carga frente al 17 sep», against the last time the same routine was done. */
export function comparisonLine(
  previous: FinishedExecution['previous'],
  timeZone: string,
): string | null {
  if (!previous || previous.change_percent === null) return null
  const { day, month } = localParts(previous.started_at, timeZone)
  const when = `${day} ${month}`
  const change = Math.round(previous.change_percent)
  if (change === 0) return `La misma carga que el ${when}`
  const sign = change > 0 ? '+' : '−'
  return `${sign}${Math.abs(change)} % de carga frente al ${when}`
}

/** «mar 29 sep · 18:02–18:50». */
export function whenRange(detail: FinishedExecution, timeZone: string): string {
  const start = localParts(detail.started_at, timeZone)
  const end = localParts(detail.ended_at, timeZone)
  return `${start.weekday} ${start.day} ${start.month} · ${start.clock}–${end.clock}`
}

/** «Tirón · mar 29», the title of the session's menu. */
export function menuTitle(name: string, startedAt: string, timeZone: string): string {
  const { weekday, day } = localParts(startedAt, timeZone)
  return `${name} · ${weekday} ${day}`
}

const WEEKDAYS_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

/** «Tirón del martes 29 sale de tu historial…»: what «Eliminar» is about to do. */
export function deletionLine(name: string, startedAt: string, timeZone: string): string {
  const { weekday, day } = localParts(startedAt, timeZone)
  const long = WEEKDAYS_LONG[WEEKDAYS.indexOf(weekday)] ?? weekday
  return `${name} del ${long} ${day} sale de tu historial y no se puede recuperar.`
}

export interface Consequence {
  readonly icon: 'record' | 'energy' | 'weight'
  readonly text: string
}

/** What annulling takes with it, said before it is confirmed (FIN-18c). */
export function annulConsequences(preview: InvalidationPreview): readonly Consequence[] {
  const lines: Consequence[] = []
  if (preview.records === 1) lines.push({ icon: 'record', text: 'Se pierde su récord' })
  else if (preview.records > 1) {
    lines.push({ icon: 'record', text: `Se pierden sus ${preview.records} récords` })
  }
  const { streak_weeks: now, streak_weeks_after: after } = preview
  if (after < now) {
    lines.push({
      icon: 'energy',
      text:
        after === 0
          ? `Tu racha de ${plural(now, 'semana', 'semanas')} se pierde`
          : `Tu racha baja de ${now} a ${plural(after, 'semana', 'semanas')}`,
    })
  }
  lines.push({ icon: 'weight', text: 'Tus totales se recalculan' })
  return lines
}

// ———————————————————————————————————————— editing

const originOf = (position: number, order: number) => `${position}:${order}`

/** What was recorded, and nothing the routine proposed that nobody did. */
export function editStateFrom(
  execution: Execution,
  names?: ReadonlyMap<string, string>,
): readonly WorkingExercise[] {
  let order = 0
  return workingStateFrom(execution, names ? { names } : {}).map((exercise) => ({
    ...exercise,
    key: exercise.key ?? `edit-${exercise.position}`,
    sets: exercise.sets
      .filter((one) => one.done)
      .map((one) => ({
        ...one,
        order: (order += 1),
        origin: originOf(exercise.position, one.order),
      })),
  }))
}

export function withEditedSet(
  exercises: readonly WorkingExercise[],
  position: number,
  order: number,
  patch: { readonly loadKg?: string; readonly reps?: string },
): readonly WorkingExercise[] {
  return exercises.map((exercise) =>
    exercise.position !== position
      ? exercise
      : {
          ...exercise,
          sets: exercise.sets.map((one) => (one.order === order ? { ...one, ...patch } : one)),
        },
  )
}

/** A set added while editing is one that was done: it arrives counted. */
export function withAddedSet(
  exercises: readonly WorkingExercise[],
  position: number,
): readonly WorkingExercise[] {
  return withExtraSet(exercises, position).map((exercise) =>
    exercise.position !== position
      ? exercise
      : {
          ...exercise,
          sets: exercise.sets.map((one, index) =>
            index === exercise.sets.length - 1 ? { ...one, done: true } : one,
          ),
        },
  )
}

const numeric = (text: string) => {
  const value = Number(text.replace(',', '.'))
  return text.trim() === '' || !Number.isFinite(value) ? null : value
}

type Set = WorkingExercise['sets'][number]

const sameSet = (one: Set, other: Set) =>
  numeric(one.loadKg) === numeric(other.loadKg) &&
  numeric(one.reps) === numeric(other.reps) &&
  one.kind === other.kind &&
  one.rpe === other.rpe

const recordedSets = (exercises: readonly WorkingExercise[]) =>
  new Map(
    exercises.flatMap((exercise) =>
      exercise.sets.flatMap((one) => (one.origin ? [[one.origin, one] as const] : [])),
    ),
  )

/** The recorded set a working one started as, for «antes 65»; undefined for a new one. */
export function originalOf(before: readonly WorkingExercise[], set: Set): Set | undefined {
  return set.origin ? recordedSets(before).get(set.origin) : undefined
}

/** How many things changed: each set edited, added or removed, the order, and the time. */
export function changesBetween(
  before: readonly WorkingExercise[],
  after: readonly WorkingExercise[],
  timeChanged: boolean,
): number {
  const recorded = recordedSets(before)
  const kept = new Set<string>()
  let changes = 0
  for (const one of after.flatMap((exercise) => exercise.sets)) {
    const original = one.origin ? recorded.get(one.origin) : undefined
    if (!one.origin || !original) changes += 1
    else {
      kept.add(one.origin)
      if (!sameSet(original, one)) changes += 1
    }
  }
  changes += recorded.size - kept.size
  const keys = (list: readonly WorkingExercise[]) => list.map((exercise) => exercise.key)
  const shared = new Set(keys(after))
  const order = keys(before).filter((key) => shared.has(key))
  const reordered = keys(after).filter((key) => order.includes(key))
  if (order.join() !== reordered.join()) changes += 1
  return changes + (timeChanged ? 1 : 0)
}

/** Puts one set back as it was recorded. */
export function revertedSet(
  before: readonly WorkingExercise[],
  after: readonly WorkingExercise[],
  position: number,
  order: number,
): readonly WorkingExercise[] {
  const recorded = recordedSets(before)
  return after.map((exercise) =>
    exercise.position !== position
      ? exercise
      : {
          ...exercise,
          sets: exercise.sets.map((one) => {
            const original = one.origin ? recorded.get(one.origin) : undefined
            return one.order === order && original
              ? {
                  ...one,
                  loadKg: original.loadKg,
                  reps: original.reps,
                  kind: original.kind,
                  rpe: original.rpe,
                }
              : one
          }),
        },
  )
}

/** The sets with a figure, renumbered; «67,5» is sixty-seven and a half. */
export function editResults(exercises: readonly WorkingExercise[]): ExecutionResults {
  let order = 0
  return resultsFrom(
    exercises.map((exercise) => ({
      ...exercise,
      sets: exercise.sets
        .filter((one) => numeric(one.loadKg) !== null || numeric(one.reps) !== null)
        .map((one) => ({
          ...one,
          order: (order += 1),
          done: true,
          loadKg: one.loadKg.replace(',', '.'),
          reps: one.reps.replace(',', '.'),
        })),
    })),
  )
}
