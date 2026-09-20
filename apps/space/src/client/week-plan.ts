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

export type WeekPlanFailure = 'expired' | 'unassigned' | 'failed'

/**
 * What a failed week read means to the tab.
 *
 * `unassigned` is not an error: somebody who follows no programme gets the catalogue,
 * **drawn in the tab**. It used to be answered by navigating there, and from inside a
 * tab that meant replacing the tab navigator's own entry on the root stack — the dock
 * disappeared and going back reported that no navigator would handle it.
 */
export function weekPlanFailure(failure: string | undefined): WeekPlanFailure {
  if (failure === 'unauthenticated') return 'expired'
  if (failure === 'not-found') return 'unassigned'
  return 'failed'
}
