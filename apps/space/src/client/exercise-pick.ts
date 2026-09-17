/**
 * Choosing several exercises on one screen, and handing them to the editor.
 *
 * The picker used to be a `Sheet` inside the routine editor. A sheet is anchored to
 * the bottom edge, which is where the keyboard appears, so searching left about three
 * results visible; and each pick wrote the draft, so adding five exercises was five
 * saves. The canvas drew a route in the first place.
 *
 * **What crosses between the two screens is a selection, never a draft.** That is the
 * whole design. The editor's header rejected a route because it would mean "a second
 * copy of that draft with a way to disagree with this one", and it was right: each
 * screen builds its own `createSpaceContentFlow()`, so each holds its own etag map,
 * and two writers would be two etags and a 409. The picker therefore never saves. It
 * chooses, and the editor — still the only writer — appends the batch in one save.
 *
 * The handover is a one-shot mailbox rather than a route parameter. `useLocalSearchParams`
 * only carries data forward, and there is no API in expo-router for returning a value;
 * the app's one precedent for module state is `telemetry.ts`, and this follows it,
 * minus the subscription, because nobody has to react to a deposit — the editor reads
 * it when it is looked at again.
 *
 * **Taking empties it.** Otherwise coming back to the editor a second time, having
 * picked nothing, would append the previous batch again.
 */

import type { Movement } from './content'
import { NOTHING_FILTERED, type ExerciseFilter } from './exercise-catalogue'

export interface PickedMovement {
  readonly id: string
  readonly name: string
}

/**
 * Adds one, or removes it if it was already chosen.
 *
 * Ordered by name rather than by when it was tapped, the same way `toggleFocus`
 * canonicalises its zones: the list somebody confirms should read the way the list
 * they picked from reads.
 */
export function togglePick(
  picked: readonly PickedMovement[],
  movement: PickedMovement,
): readonly PickedMovement[] {
  if (isPicked(picked, movement.id)) {
    return picked.filter((one) => one.id !== movement.id)
  }
  return [...picked, movement].sort((left, right) => left.name.localeCompare(right.name, 'es'))
}

export function isPicked(picked: readonly PickedMovement[], id: string): boolean {
  return picked.some((one) => one.id === id)
}

/** What the confirm says. Counting out loud is the only way the batch is visible. */
export function pickLabel(count: number): string {
  if (count <= 0) return 'Añadir'
  if (count === 1) return 'Añadir 1 ejercicio'
  return `Añadir ${count} ejercicios`
}

/**
 * The same thing, short enough to be drawn at a size somebody can read.
 *
 * The full phrase set in a pill beside the title left room for nothing but a tiny
 * face; the noun is already on the screen, in its heading, so only the count is news.
 * `pickLabel` stays the accessible name, which is where the whole sentence belongs.
 */
export function pickButton(count: number): string {
  return count <= 0 ? 'Añadir' : `Añadir ${count}`
}

/** The catalogue minus what the routine already trains, which is not offered twice. */
export function offerable(
  movements: readonly Movement[],
  already: readonly string[],
): readonly Movement[] {
  const inRoutine = new Set(already)
  return movements.filter((movement) => !inRoutine.has(movement.id))
}

let offered: readonly PickedMovement[] = []
let already: readonly string[] = []
let filter: ExerciseFilter = NOTHING_FILTERED

/** Deposited by the picker when somebody confirms. */
export function offerExercisePick(movements: readonly PickedMovement[]): void {
  offered = movements
}

/** Collected by the editor, and emptied: a second look must not append the batch again. */
export function takeExercisePick(): readonly PickedMovement[] {
  const taken = offered
  offered = []
  return taken
}

/** Left by the editor before it pushes, so the picker knows what not to offer. */
export function declareAlreadyIn(ids: readonly string[]): void {
  already = ids
}

let replacing: number | undefined

/**
 * Which exercise the picker is opening to substitute, or nothing when it is adding.
 *
 * Declared on **both** paths and not only on the replacing one. If it were set and
 * never cleared, backing out of a substitution without choosing would leave the flag
 * behind, and the next plain «Añadir ejercicio» would silently overwrite an exercise
 * instead of appending one — a bug nobody would connect to a screen they left.
 */
export function declareReplacing(position: number | undefined): void {
  replacing = position
}

export function replacingPosition(): number | undefined {
  return replacing
}

export function alreadyIn(): readonly string[] {
  return already
}

/**
 * The filter, which now outlives the screen that shows it.
 *
 * Choosing muscles and choosing equipment are two screens above the list, so the
 * filter cannot live in any of the three: whichever held it would lose it on the way
 * to the others. Unlike the picked batch this is **not** emptied on read — it is the
 * state of the search, and it stays until somebody clears it.
 */
export function rememberExerciseFilter(next: ExerciseFilter): void {
  filter = next
}

export function exerciseFilter(): ExerciseFilter {
  return filter
}

/** Starting a new routine starts a new search; the last one's filter is not it. */
export function forgetExerciseFilter(): void {
  filter = NOTHING_FILTERED
}
