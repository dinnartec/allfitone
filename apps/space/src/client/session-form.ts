/**
 * What the session screen holds while somebody trains.
 *
 * The screen edits a list of sets and the server takes the session whole, so the
 * shape in the middle is this one: every planned exercise, with the sets recorded
 * against it and the target it was planned for.
 *
 * **The planned session is the skeleton, not the truth.** Somebody who does three
 * sets instead of four has done three, so the target only decides how many empty
 * rows start on screen; what is sent is what was ticked. A set nobody ticked is not a
 * set that happened.
 *
 * Set order is global across the session, not per exercise, because
 * `execution.strength_sets` is unique on `(session, set_order)` — one ladder, so two
 * exercises can never claim the same rung.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

import type { PickedMovement } from './exercise-pick'
import { blockAt, chainedBy, movedTo, renumbered, settled, unchained } from './chain-order'
import { REST_OPENING_SECONDS, type SetKind } from './set-scheme'

export type Execution = AllfitV1Schemas['SpaceExecution']
export type ExecutionResults = AllfitV1Schemas['ExecutionResultsReplace']
export type PlannedStep = AllfitV1Schemas['SpaceProgramStep']

export interface WorkingSet {
  /** Global across the session: the database keys sets on it. */
  readonly order: number
  readonly loadKg: string
  readonly reps: string
  readonly done: boolean
  /** What this set weighed last time, already written: "60 × 12", or "—". */
  readonly previous: string
  /** That weight alone, for filling the set when it is ticked empty. */
  readonly previousLoad?: string | undefined
  /** Proposed by the routine and changed by whoever trained it (ADR-033). */
  readonly kind: SetKind
  /** How hard it felt, 1 to 10. Absent is undeclared, never zero. */
  readonly rpe?: number | undefined
}

const KINDS: readonly SetKind[] = ['normal', 'warmup', 'to_failure', 'drop']

function kindOf(value: unknown): SetKind | undefined {
  return KINDS.find((kind) => kind === value)
}

function rpeOf(recorded: Record<string, unknown> | undefined): number | undefined {
  return recorded && typeof recorded.rpe === 'number' ? recorded.rpe : undefined
}

export interface WorkingExercise {
  readonly position: number
  readonly movementId: string | null
  readonly movement: string
  readonly sets: readonly WorkingSet[]
  /** Stable while the screen lives, so a row keeps its state when positions move. */
  readonly key?: string
  /** The routine step it came from; null for one added during the session. */
  readonly plannedStepId?: string | null
  readonly supersetGroup?: number
  /** Seconds to rest after its sets: today's, copied from the routine (ADR-035). */
  readonly restSeconds?: number
}

/** A routine step or a session exercise: whatever carries a target and a history. */
interface Source {
  readonly target: unknown
  readonly previous?: readonly { load_value: number | null; achieved_reps: number | null }[]
  readonly sets?: readonly {
    kind: SetKind
    target_reps: number | null
  }[]
}

type Listed = Execution['exercises'][number]

const DEFAULT_SETS = 3

function targetSets(step: Source): number {
  const target = (step.target ?? {}) as Record<string, unknown>
  const sets = target.target_sets
  return typeof sets === 'number' && sets > 0 ? sets : DEFAULT_SETS
}

function targetReps(step: Source): string {
  const target = (step.target ?? {}) as Record<string, unknown>
  const reps = target.target_reps
  return typeof reps === 'number' ? String(reps) : ''
}

function previousLoadOf(step: Source, index: number): string | undefined {
  const load = step.previous?.[index]?.load_value
  return typeof load === 'number' ? String(load) : undefined
}

/** "60 × 12", or an em dash when the movement has no history. */
function previousLabel(step: Source, index: number): string {
  const entry = step.previous?.[index]
  if (!entry || entry.load_value === null || entry.achieved_reps === null) return '—'
  return `${entry.load_value} × ${entry.achieved_reps}`
}

/**
 * Builds the working state from what was planned and what is already recorded.
 *
 * A recorded set wins over its planned row: coming back to a session in progress has
 * to show what was actually done, not the plan it started from.
 *
 * **Recorded sets are matched to an exercise by movement, not by position in the
 * ladder.** Adding a set to the first exercise renumbers every set after it, so an
 * order-based match would hand the wrong numbers to the wrong exercise the moment
 * somebody reopened the session.
 *
 * **The row count is whichever is larger, the plan or what was recorded.** Somebody
 * who did five sets of four has done five, and rebuilding from the plan alone would
 * quietly drop the fifth.
 */
export function workingStateFrom(
  execution: Execution,
  extra: {
    /** What the library calls each movement: a recorded set carries only its id. */
    readonly names?: ReadonlyMap<string, string>
  } = {},
): readonly WorkingExercise[] {
  if (execution.exercises.length > 0) return fromList(execution, extra.names)

  const byMovement = new Map<string, Record<string, unknown>[]>()
  const unattributed: Record<string, unknown>[] = []
  for (const entry of [...execution.results].sort(orderOf)) {
    const value = entry as Record<string, unknown>
    if (value.family !== 'strength') continue
    const movement = value.movement_id
    if (typeof movement !== 'string') {
      unattributed.push(value)
      continue
    }
    const list = byMovement.get(movement)
    if (list) list.push(value)
    else byMovement.set(movement, [value])
  }

  let order = 0
  const planned = execution.planned.map((step) => {
    const done = step.movement_id ? (byMovement.get(step.movement_id) ?? []) : unattributed
    const sets = rowsFor(step, done, order)
    order += sets.length
    return {
      position: step.position,
      movementId: step.movement_id,
      movement: step.movement ?? 'Ejercicio',
      sets,
    }
  })

  // Whatever the plan never had, in the order it was first logged.
  const inPlan = new Set(execution.planned.map((step) => step.movement_id))
  const extras = [...byMovement.keys()].filter((id) => !inPlan.has(id))

  const last = planned.at(-1)?.position ?? 0
  return [
    ...planned,
    ...extras.map((id, index) => {
      const done = byMovement.get(id) ?? []
      const rows = Math.max(DEFAULT_SETS, done.length)
      const sets: WorkingSet[] = []
      for (let row = 0; row < rows; row += 1) {
        order += 1
        const recorded = done[row]
        sets.push({
          order,
          loadKg:
            recorded && typeof recorded.load_value === 'number' ? String(recorded.load_value) : '',
          reps:
            recorded && typeof recorded.achieved_reps === 'number'
              ? String(recorded.achieved_reps)
              : '',
          done: recorded !== undefined,
          previous: '—',
          kind: kindOf(recorded?.kind) ?? 'normal',
          rpe: rpeOf(recorded),
        })
      }
      return {
        position: last + index + 1,
        movementId: id,
        movement: extra.names?.get(id) ?? 'Ejercicio',
        sets,
      }
    }),
  ]
}

/**
 * One exercise's rows: the routine's own sets when it wrote them, else its summary,
 * and never fewer than what was recorded. A recorded set wins over its planned row.
 */
function rowsFor(
  source: Source,
  done: readonly Record<string, unknown>[],
  after: number,
): WorkingSet[] {
  const reps = targetReps(source)
  const prescribed = source.sets ?? []
  const rows = Math.max(prescribed.length || targetSets(source), done.length)
  const sets: WorkingSet[] = []
  for (let index = 0; index < rows; index += 1) {
    const recorded = done[index]
    const asked = prescribed[index]
    const askedReps = asked ? (asked.target_reps === null ? '' : String(asked.target_reps)) : reps
    sets.push({
      order: after + index + 1,
      loadKg:
        recorded && typeof recorded.load_value === 'number' ? String(recorded.load_value) : '',
      reps:
        recorded && typeof recorded.achieved_reps === 'number'
          ? String(recorded.achieved_reps)
          : askedReps,
      done: recorded !== undefined,
      previous: previousLabel(source, index),
      previousLoad: previousLoadOf(source, index),
      kind: kindOf(recorded?.kind) ?? asked?.kind ?? 'normal',
      rpe: rpeOf(recorded),
    })
  }
  return sets
}

/**
 * The session's own list, in its order (ADR-034).
 *
 * Each set says which exercise it belongs to, so the same movement twice keeps two sets
 * of its own. A set from before the list existed lands on the first exercise of its
 * movement, which is where the backfill put it too.
 */
function fromList(
  execution: Execution,
  names: ReadonlyMap<string, string> | undefined,
): readonly WorkingExercise[] {
  const exercises = [...execution.exercises].sort((one, other) => one.position - other.position)
  const byExercise = new Map<number, Record<string, unknown>[]>()
  for (const entry of [...execution.results].sort(orderOf)) {
    const value = entry as Record<string, unknown>
    if (value.family !== 'strength') continue
    const owner =
      typeof value.exercise_position === 'number'
        ? value.exercise_position
        : exercises.find((one) => one.movement_id === value.movement_id)?.position
    if (owner === undefined) continue
    byExercise.set(owner, [...(byExercise.get(owner) ?? []), value])
  }

  let order = 0
  return exercises.map((listed: Listed) => {
    const sets = rowsFor(listed, byExercise.get(listed.position) ?? [], order)
    order += sets.length
    return {
      key: `listed-${listed.position}`,
      position: listed.position,
      movementId: listed.movement_id,
      movement:
        listed.movement ??
        (listed.movement_id ? names?.get(listed.movement_id) : undefined) ??
        'Ejercicio',
      plannedStepId: listed.planned_step_id,
      ...(listed.superset_group === null ? {} : { supersetGroup: listed.superset_group }),
      ...(listed.rest_seconds === null ? {} : { restSeconds: listed.rest_seconds }),
      sets,
    }
  })
}

/** The ladder is one per session: any change to the list renumbers it top to bottom. */
function laddered(exercises: readonly WorkingExercise[]): readonly WorkingExercise[] {
  let order = 0
  return exercises.map((exercise) => ({
    ...exercise,
    sets: exercise.sets.map((set) => ({ ...set, order: (order += 1) })),
  }))
}

/** Takes an exercise out, closes the gap, and dissolves a superset left with one. */
export function withoutExercise(
  exercises: readonly WorkingExercise[],
  position: number,
): readonly WorkingExercise[] {
  return laddered(settled(renumbered(exercises.filter((one) => one.position !== position))))
}

/** A drag, with a superset travelling whole: the editor's rule, from `chain-order`. */
export function movedExercise(
  exercises: readonly WorkingExercise[],
  from: number,
  to: number,
): readonly WorkingExercise[] {
  return laddered(movedTo(exercises, from, to))
}

export function chainedExercise(
  exercises: readonly WorkingExercise[],
  position: number,
  mate: number,
): readonly WorkingExercise[] {
  return laddered(chainedBy(exercises, position, mate, (one) => one.key ?? one.position))
}

export function unchainedExercise(
  exercises: readonly WorkingExercise[],
  position: number,
): readonly WorkingExercise[] {
  return laddered(unchained(exercises, position))
}

/** Today's rest for one exercise; the routine keeps its own (ADR-035). */
export function withRest(
  exercises: readonly WorkingExercise[],
  position: number,
  seconds: number | undefined,
): readonly WorkingExercise[] {
  return exercises.map((exercise) => {
    if (exercise.position !== position) return exercise
    const { restSeconds: _dropped, ...rest } = exercise
    return seconds === undefined ? rest : { ...rest, restSeconds: seconds }
  })
}

/**
 * The rest that follows ticking a set of this exercise, or nothing to count.
 *
 * Every exercise rests its own, inside a superset too: the transition is still time, and
 * a bar that only says «next» leaves somebody guessing how long they have (ADR-035). A
 * routine that never said rests the editor's opening value: a timer that never appears
 * reads as broken.
 */
export function restAfter(
  exercises: readonly WorkingExercise[],
  position: number,
): number | undefined {
  const exercise = exercises.find((one) => one.position === position)
  if (!exercise) return undefined
  // Unsaid is the opening rest, the editor's own; only «Ninguno» (0) rests nothing.
  const seconds = exercise.restSeconds ?? REST_OPENING_SECONDS
  return seconds > 0 ? seconds : undefined
}

/**
 * What comes after the rest.
 *
 * Mid-chain, the chain's next exercise. Otherwise this exercise again, or the first of
 * its superset for another round — unless that was the last set, and then the next
 * exercise still to do after it; nothing, once the session has nothing left.
 */
export function resumesWith(
  exercises: readonly WorkingExercise[],
  position: number,
): { readonly movement: string; readonly chained: boolean } {
  const exercise = exercises.find((one) => one.position === position)
  const following = exercises.find((one) => one.position === position + 1)
  if (
    exercise?.supersetGroup !== undefined &&
    following?.supersetGroup === exercise.supersetGroup
  ) {
    return { movement: following.movement, chained: true }
  }
  const block = blockAt(exercises, position)
  const members = exercises.filter((one) => block.includes(one.position))
  const finished = (one: WorkingExercise) => one.sets.every((set) => set.done)
  if (!members.every(finished)) {
    const first = members[0]
    return { movement: first?.movement ?? '', chained: false }
  }
  const last = block.at(-1) ?? position
  const next = exercises.find((one) => one.position > last && !finished(one))
  return { movement: next?.movement ?? '', chained: false }
}

/**
 * Appends what the picker handed back, each with three empty rows, and renumbers.
 *
 * It joins the session's list, which the screen saves at once, so an added exercise
 * with nothing ticked survives a restart like any other (ADR-034).
 */
export function withAddedExercises(
  exercises: readonly WorkingExercise[],
  picked: readonly PickedMovement[],
): readonly WorkingExercise[] {
  const present = new Set(exercises.map((exercise) => exercise.movementId))
  const last = exercises.at(-1)?.position ?? 0
  const appended = picked
    .filter((one) => !present.has(one.id))
    .map((one, index) => ({
      key: `added-${one.id}-${last + index + 1}`,
      position: last + index + 1,
      movementId: one.id,
      movement: one.name,
      plannedStepId: null,
      sets: Array.from({ length: DEFAULT_SETS }, () => ({
        order: 0,
        loadKg: '',
        reps: '',
        done: false,
        previous: '—',
        kind: 'normal' as const,
      })),
    }))
  let order = 0
  return [...exercises, ...appended].map((exercise) => ({
    ...exercise,
    sets: exercise.sets.map((set) => ({ ...set, order: (order += 1) })),
  }))
}

function orderOf(left: unknown, right: unknown): number {
  const a = (left as { set_order?: number }).set_order ?? 0
  const b = (right as { set_order?: number }).set_order ?? 0
  return a - b
}

/**
 * Removes one set and renumbers the ladder.
 *
 * The last row of an exercise stays. An exercise with no rows at all has nowhere to
 * record anything, and getting it back would mean reopening the session.
 */
export function withoutSet(
  exercises: readonly WorkingExercise[],
  position: number,
  order: number,
): readonly WorkingExercise[] {
  let rung = 0
  return exercises.map((exercise) => {
    const keep =
      exercise.position === position && exercise.sets.length > 1
        ? exercise.sets.filter((set) => set.order !== order)
        : exercise.sets
    return { ...exercise, sets: keep.map((set) => ({ ...set, order: (rung += 1) })) }
  })
}

/**
 * Adds a set to one exercise and renumbers the ladder.
 *
 * The order is global and unique per session, so a set inserted in the middle pushes
 * every set after it up one. Renumbering here rather than at the edges is what keeps
 * `execution.strength_sets` from rejecting the write.
 */
export function withExtraSet(
  exercises: readonly WorkingExercise[],
  position: number,
): readonly WorkingExercise[] {
  let order = 0
  return exercises.map((exercise) => {
    const last = exercise.sets.at(-1)
    const rows =
      exercise.position === position
        ? [
            ...exercise.sets,
            // The next set usually repeats the last one, so it arrives ready to tick;
            // after a warmup it is the work that follows, not more warming up.
            {
              order: 0,
              loadKg: last?.loadKg ?? '',
              reps: last?.reps ?? '',
              done: false,
              previous: '—',
              kind: last === undefined || last.kind === 'warmup' ? ('normal' as const) : last.kind,
            },
          ]
        : exercise.sets
    return { ...exercise, sets: rows.map((set) => ({ ...set, order: (order += 1) })) }
  })
}

/** How many working sets are ticked, and how many the session holds. A warmup is not one. */
export function setsProgress(exercises: readonly WorkingExercise[]): {
  done: number
  planned: number
} {
  return exercises.reduce(
    (total, exercise) => {
      const working = exercise.sets.filter((set) => set.kind !== 'warmup')
      return {
        done: total.done + working.filter((set) => set.done).length,
        planned: total.planned + working.length,
      }
    },
    { done: 0, planned: 0 },
  )
}

/**
 * Ticks a set, or unticks it, and fills an empty weight on the way in.
 *
 * Somebody who ticks without typing lifted something, and it was most likely what
 * they lifted last time, or else what the set above carried. A warmup lends nothing to
 * a working set: its weight is the light one on purpose.
 */
export function withTick(
  exercises: readonly WorkingExercise[],
  position: number,
  order: number,
): readonly WorkingExercise[] {
  return exercises.map((exercise) => {
    if (exercise.position !== position) return exercise
    const index = exercise.sets.findIndex((set) => set.order === order)
    const set = exercise.sets[index]
    if (!set) return exercise
    const done = !set.done
    const above = exercise.sets
      .slice(0, index)
      .reverse()
      .find((one) => one.loadKg !== '' && (set.kind === 'warmup' || one.kind !== 'warmup'))
    const loadKg =
      done && set.loadKg === '' ? (set.previousLoad ?? above?.loadKg ?? '') : set.loadKg
    return {
      ...exercise,
      sets: exercise.sets.map((one) => (one.order === order ? { ...one, done, loadKg } : one)),
    }
  })
}

/** Changes one set's kind. Reps stay: what was done to failure still has a count. */
export function withSetKind(
  exercises: readonly WorkingExercise[],
  position: number,
  order: number,
  kind: SetKind,
): readonly WorkingExercise[] {
  return changeSet(exercises, position, order, (set) => ({ ...set, kind }))
}

/** Marks how hard one set felt, or takes it back. */
export function withSetRpe(
  exercises: readonly WorkingExercise[],
  position: number,
  order: number,
  rpe: number | undefined,
): readonly WorkingExercise[] {
  return changeSet(exercises, position, order, (set) => ({ ...set, rpe }))
}

function changeSet(
  exercises: readonly WorkingExercise[],
  position: number,
  order: number,
  change: (set: WorkingSet) => WorkingSet,
): readonly WorkingExercise[] {
  return exercises.map((exercise) =>
    exercise.position !== position
      ? exercise
      : {
          ...exercise,
          sets: exercise.sets.map((set) => (set.order === order ? change(set) : set)),
        },
  )
}

const MARKS: Readonly<Record<Exclude<SetKind, 'normal'>, string>> = {
  warmup: 'W',
  drop: 'D',
  to_failure: 'F',
}

/**
 * What the set's cell says: its number, or the letter of its kind.
 *
 * A warmup does not take a number, so the first working set is still the first; the
 * letters are the ones Strong and Hevy use, so nobody has to learn a new code.
 */
export function setMark(sets: readonly WorkingSet[], index: number): string {
  const set = sets[index]
  if (!set) return ''
  if (set.kind !== 'normal') return MARKS[set.kind]
  return String(sets.slice(0, index + 1).filter((one) => one.kind !== 'warmup').length)
}

/**
 * Total load moved, in kilos.
 *
 * Only ticked sets count, and only those with both a load and a repetition count: a
 * set with no weight is bodyweight, which is real training and not volume anybody can
 * add up.
 */
export function totalVolumeKg(exercises: readonly WorkingExercise[]): number {
  return exercises.reduce(
    (total, exercise) =>
      total +
      exercise.sets.reduce((inner, set) => {
        if (!set.done || set.kind === 'warmup') return inner
        const load = Number(set.loadKg)
        const reps = Number(set.reps)
        if (!Number.isFinite(load) || !Number.isFinite(reps) || load <= 0 || reps <= 0) return inner
        return inner + load * reps
      }, 0),
    0,
  )
}

/** `mm:ss`, or `h:mm:ss` once a session runs past the hour. */
export function elapsedLabel(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const pad = (value: number) => String(value).padStart(2, '0')
  const minutes = Math.floor(whole / 60) % 60
  const hours = Math.floor(whole / 3600)
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(whole % 60)}` : `${minutes}:${pad(whole % 60)}`
}

/**
 * The clock split for a scoreboard that leads with what is read from a distance.
 *
 * Past an hour the lead is hours and minutes and the seconds sit aside, smaller; under
 * an hour the minutes and seconds are the whole clock.
 */
export function clockParts(seconds: number): { readonly lead: string; readonly tail: string } {
  const whole = Math.max(0, Math.floor(seconds))
  const pad = (value: number) => String(value).padStart(2, '0')
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor(whole / 60) % 60
  return hours > 0
    ? { lead: `${hours}:${pad(minutes)}`, tail: `:${pad(whole % 60)}` }
    : { lead: `${minutes}:${pad(whole % 60)}`, tail: '' }
}

/**
 * What travels to the server: the ticked sets, and nothing else.
 *
 * No `segments`, and so no `segment_position`. The activity type was frozen onto the
 * execution when the attempt started, from the template it came from; declaring one
 * here could only contradict what is already recorded.
 */
export function resultsFrom(exercises: readonly WorkingExercise[]): ExecutionResults {
  const listed = exercises.map((exercise) => ({
    position: exercise.position,
    movement_id: exercise.movementId,
    planned_step_id: exercise.plannedStepId ?? null,
    superset_group: exercise.supersetGroup ?? null,
    rest_seconds: exercise.restSeconds ?? null,
  }))
  const strength = exercises.flatMap((exercise) =>
    exercise.sets
      .filter((set) => set.done)
      .map((set) => {
        const load = Number(set.loadKg)
        const reps = Number(set.reps)
        return {
          order: set.order,
          ...(exercise.movementId ? { movement_id: exercise.movementId } : {}),
          ...(Number.isFinite(reps) && reps > 0 ? { achieved_reps: reps } : {}),
          ...(Number.isFinite(load) && load > 0
            ? { load: { value: load, unit: 'kg' as const } }
            : {}),
          ...(set.rpe === undefined ? {} : { rpe: set.rpe }),
          kind: set.kind,
          exercise_position: exercise.position,
        }
      }),
  )
  return { strength_sets: strength, exercises: listed }
}

/** Nothing ticked is nothing to close, which is what the server refuses. */
export function canFinish(exercises: readonly WorkingExercise[]): boolean {
  return setsProgress(exercises).done > 0
}
