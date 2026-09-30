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
}

export interface WorkingExercise {
  readonly position: number
  readonly movementId: string | null
  readonly movement: string
  readonly sets: readonly WorkingSet[]
}

const DEFAULT_SETS = 3

function targetSets(step: PlannedStep): number {
  const target = step.target as Record<string, unknown>
  const sets = target.target_sets
  return typeof sets === 'number' && sets > 0 ? sets : DEFAULT_SETS
}

function targetReps(step: PlannedStep): string {
  const target = step.target as Record<string, unknown>
  const reps = target.target_reps
  return typeof reps === 'number' ? String(reps) : ''
}

/** "60 × 12", or an em dash when the movement has no history. */
function previousLabel(step: PlannedStep, index: number): string {
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
    /** Added during this session, recorded or not. */
    readonly added?: readonly PickedMovement[]
  } = {},
): readonly WorkingExercise[] {
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
    const reps = targetReps(step)
    const rows = Math.max(targetSets(step), done.length)
    const sets: WorkingSet[] = []
    for (let index = 0; index < rows; index += 1) {
      order += 1
      const recorded = done[index]
      sets.push({
        order,
        loadKg:
          recorded && typeof recorded.load_value === 'number' ? String(recorded.load_value) : '',
        reps:
          recorded && typeof recorded.achieved_reps === 'number'
            ? String(recorded.achieved_reps)
            : reps,
        done: recorded !== undefined,
        previous: previousLabel(step, index),
      })
    }
    return {
      position: step.position,
      movementId: step.movement_id,
      movement: step.movement ?? 'Ejercicio',
      sets,
    }
  })

  // Whatever the plan never had: recorded sets first, in the order they were logged,
  // then what was added and has nothing recorded yet.
  const inPlan = new Set(execution.planned.map((step) => step.movement_id))
  const addedNames = new Map((extra.added ?? []).map((one) => [one.id, one.name]))
  const extras = [
    ...[...byMovement.keys()].filter((id) => !inPlan.has(id)),
    ...(extra.added ?? []).map((one) => one.id).filter((id) => !inPlan.has(id)),
  ].filter((id, index, all) => all.indexOf(id) === index)

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
        })
      }
      return {
        position: last + index + 1,
        movementId: id,
        movement: extra.names?.get(id) ?? addedNames.get(id) ?? 'Ejercicio',
        sets,
      }
    }),
  ]
}

/**
 * Appends what the picker handed back, each with three empty rows, and renumbers.
 *
 * Nothing is saved here: an added exercise reaches the server with its first ticked
 * set, like every other, because a set nobody ticked is not a set that happened.
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
      position: last + index + 1,
      movementId: one.id,
      movement: one.name,
      sets: Array.from({ length: DEFAULT_SETS }, () => ({
        order: 0,
        loadKg: '',
        reps: '',
        done: false,
        previous: '—',
      })),
    }))
  let order = 0
  return [...exercises, ...appended].map((exercise) => ({
    ...exercise,
    sets: exercise.sets.map((set) => ({ ...set, order: (order += 1) })),
  }))
}

const added = new Map<string, readonly PickedMovement[]>()

/**
 * Kept for the life of the process, per session.
 *
 * An added exercise with nothing ticked exists nowhere but on screen, and minimising
 * unmounts the screen. Without this, coming back would quietly drop it.
 */
export function rememberAdded(executionId: string, picked: readonly PickedMovement[]): void {
  const before = added.get(executionId) ?? []
  const known = new Set(before.map((one) => one.id))
  added.set(executionId, [...before, ...picked.filter((one) => !known.has(one.id))])
}

export function addedDuring(executionId: string): readonly PickedMovement[] {
  return added.get(executionId) ?? []
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
            { order: 0, loadKg: '', reps: last?.reps ?? '', done: false, previous: '—' },
          ]
        : exercise.sets
    return { ...exercise, sets: rows.map((set) => ({ ...set, order: (order += 1) })) }
  })
}

/** How many sets are ticked, and how many the session planned. */
export function setsProgress(exercises: readonly WorkingExercise[]): {
  done: number
  planned: number
} {
  return exercises.reduce(
    (total, exercise) => ({
      done: total.done + exercise.sets.filter((set) => set.done).length,
      planned: total.planned + exercise.sets.length,
    }),
    { done: 0, planned: 0 },
  )
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
        if (!set.done) return inner
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
 * What travels to the server: the ticked sets, and nothing else.
 *
 * No `segments`, and so no `segment_position`. The activity type was frozen onto the
 * execution when the attempt started, from the template it came from; declaring one
 * here could only contradict what is already recorded.
 */
export function resultsFrom(exercises: readonly WorkingExercise[]): ExecutionResults {
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
        }
      }),
  )
  return { strength_sets: strength }
}

/** Nothing ticked is nothing to close, which is what the server refuses. */
export function canFinish(exercises: readonly WorkingExercise[]): boolean {
  return setsProgress(exercises).done > 0
}
