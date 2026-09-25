/**
 * One at a time, in the order they were asked for.
 *
 * **Why the editors need this.** Saving a draft answers with the etag the *next* save
 * has to send, so two saves in flight at once are a contradiction: the second carries
 * an etag the first is in the middle of replacing, and the server rightly refuses it
 * with a `409`. It is not a rare race either — it is exactly what pressing «guardar»
 * within the autosave's delay does, and the autosave delay exists precisely because
 * somebody is still typing.
 *
 * Clearing the pending timer is not enough: a timer that has already fired is a
 * request already in the air, and there is nothing left to cancel. So the work is
 * queued rather than raced.
 *
 * A failure does not poison the queue. The next piece of work runs whatever happened
 * to the last one — an editor whose save failed once must still be able to try again,
 * and a queue that stopped at the first error would be an editor that silently
 * stopped saving.
 */

export type Queue = <T>(work: () => Promise<T>) => Promise<T>

export function createQueue(): Queue {
  let last: Promise<unknown> = Promise.resolve()

  return <T>(work: () => Promise<T>): Promise<T> => {
    // Chained off a settled tail, never off the result: the caller sees the real
    // rejection, and the queue sees only that the turn is over.
    const run = last.then(work, work)
    last = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}
