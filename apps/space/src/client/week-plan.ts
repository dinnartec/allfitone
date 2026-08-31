/**
 * What the training tab decides on its own.
 *
 * The week is the unit and the day inside it is a suggestion, so the screen's job
 * is not to say what today is: it is to say **which routine to reach for next**,
 * and to make every other one just as reachable.
 *
 * **Suggested is the first one still pending, in the order the programme wrote
 * them.** Nothing cleverer, because nothing cleverer could be explained to
 * somebody standing in a gym. It orients; it never decides.
 *
 * **Done marks, it does not bar.** A routine already closed keeps its place and
 * offers to be done again: repeating is legitimate, the repeat is another attempt,
 * and the first one keeps what it earned. A screen that hid it would be telling
 * somebody they cannot do what they are about to do anyway.
 */

import type { WeekPlan, WeekRoutine } from './programs'

export type { WeekPlan, WeekRoutine }

export type RoutineState = 'suggested' | 'pending' | 'done' | 'open'

export interface RoutineCard {
  readonly routine: WeekRoutine
  readonly state: RoutineState
}

/**
 * The week's routines, each with the one thing the screen renders differently.
 *
 * An open attempt outranks everything: coming back to something left half-done is
 * more urgent than starting the next thing, and offering the next thing would
 * strand it.
 */
export function cardsFor(plan: WeekPlan | undefined): readonly RoutineCard[] {
  if (!plan) return []
  const open = plan.sessions.find((session) => session.open_execution_id !== null)
  const suggested = plan.sessions.find((session) => !session.done)

  return plan.sessions.map((routine) => ({
    routine,
    state:
      routine.open_execution_id !== null
        ? 'open'
        : open
          ? routine.done
            ? 'done'
            : 'pending'
          : routine === suggested
            ? 'suggested'
            : routine.done
              ? 'done'
              : 'pending',
  }))
}

/** How much of the week is behind you, counted in routines rather than in attempts. */
export function weekProgress(plan: WeekPlan | undefined): { done: number; planned: number } {
  if (!plan) return { done: 0, planned: 0 }
  return {
    done: plan.sessions.filter((session) => session.done).length,
    planned: plan.sessions.length,
  }
}

/** True once nothing is left. What `H-E` draws instead of pulling next week forward. */
export function weekIsDone(plan: WeekPlan | undefined): boolean {
  const progress = weekProgress(plan)
  return progress.planned > 0 && progress.done === progress.planned
}

/** "6 ejercicios · 18 series", or just the exercises when nothing is counted in sets. */
export function routineCaption(routine: WeekRoutine): string {
  const exercises = `${routine.exercise_count} ${routine.exercise_count === 1 ? 'ejercicio' : 'ejercicios'}`
  if (routine.set_count <= 0) return exercises
  return `${exercises} · ${routine.set_count} ${routine.set_count === 1 ? 'serie' : 'series'}`
}

/** What the button says, which is the whole difference between the three states. */
export function actionLabel(state: RoutineState): string {
  if (state === 'open') return 'Continuar'
  if (state === 'done') return 'Repetir'
  return 'Empezar'
}
