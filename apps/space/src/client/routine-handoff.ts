/**
 * What the routine editor hands back when it publishes.
 *
 * **Why this exists rather than a comparison.** The programme editor used to work out
 * which routine had just been written by diffing the list against what it had seen
 * before leaving. That is a guess, and it is wrong in every case where the guess is
 * ambiguous: somebody who publishes two routines in one trip, somebody who republishes
 * an existing one — which mints a new version id and so looks new — and somebody whose
 * list simply came back in a state the diff could not read. A screen that assembles a
 * programme out of guesses is worse than one that asks.
 *
 * The editor knows exactly what it published, because publishing answers with the
 * version. So it says so, and nobody has to deduce anything.
 *
 * The shape is the one-shot mailbox `exercise-pick` already established, for the same
 * reason: `expo-router` carries data forward and has no way of returning a value, and
 * module state is the app's one precedent for handing something back. **Taking empties
 * it**, or a second visit to the programme would place the same routine again.
 */

export interface PublishedRoutine {
  readonly templateId: string
  readonly versionId: string
}

let published: PublishedRoutine | undefined

/** Left by the routine editor the moment a version exists. */
export function offerPublishedRoutine(routine: PublishedRoutine): void {
  published = routine
}

/** Collected by whoever was waiting for it, and emptied. */
export function takePublishedRoutine(): PublishedRoutine | undefined {
  const taken = published
  published = undefined
  return taken
}

/** Nobody is waiting any more. Starting a programme starts it without a leftover. */
export function forgetPublishedRoutine(): void {
  published = undefined
}
