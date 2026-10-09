/**
 * Keeps what a screen holds when the API answers the same thing again.
 *
 * Screens re-read on every visit, and an equal answer is still a new object: handing it
 * to `setState` redraws everything below for nothing. Returning the held one instead
 * lets React skip the draw. Answers are plain JSON parsed in the same key order, so
 * comparing their serialisation is exact and cheap beside a draw.
 */
export function keepIfSame<T>(held: T | undefined, next: T): T {
  if (held === undefined) return next
  return JSON.stringify(held) === JSON.stringify(next) ? held : next
}
