/**
 * Where a dragged row lands, and how far the rows around it step aside.
 *
 * This is the arithmetic of a reorder and nothing else — no view, no gesture, no
 * shared value — so it can be asserted without a device. The boundaries are where
 * this sort of code goes wrong: whether the row directly under the one in the air
 * moves, and whether it moves the same way going up as going down. Both are one
 * `<=` away from being wrong in a manner nobody sees until a routine comes out in
 * an order somebody did not ask for.
 *
 * **Both functions are worklets.** They are called from `useAnimatedStyle` and from
 * the gesture's own callbacks, which run on the UI runtime; the directive is what
 * lets the Babel plugin compile them for it. Living in their own module does not
 * change that — it only makes them reachable by the test runner.
 */

/** How far the finger travels to move an exercise one place. */
export const ROW_SPAN = 80

/**
 * Where a drag of this length leaves the row it started on.
 *
 * Rounding rather than truncating is what makes half a row's travel commit to the
 * nearer place: a drag of forty-one points has visibly crossed its neighbour, and
 * truncating would leave the row exactly where it started.
 */
export function placeOf(position: number, translation: number, count: number): number {
  'worklet'
  const places = Math.round(translation / ROW_SPAN)
  return Math.min(count, Math.max(1, position + places))
}

/**
 * How far a row steps aside, in points, once the one in the air has passed over it.
 *
 * Dragging down, every row from the one after the gap through the destination moves
 * up by one place; dragging up, the mirror. A row outside that span does not move,
 * and neither does the one being dragged — its own offset is the finger's.
 */
export function aside(
  position: number,
  lifted: number,
  translation: number,
  count: number,
): number {
  'worklet'
  if (position === lifted) return 0
  const to = placeOf(lifted, translation, count)
  if (lifted < position && position <= to) return -ROW_SPAN
  if (to <= position && position < lifted) return ROW_SPAN
  return 0
}
