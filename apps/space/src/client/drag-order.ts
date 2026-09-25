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

/** How close to an edge the finger has to get before the list starts moving itself. */
export const EDGE_ZONE = 72

/** The most it travels in one frame. Sixty of these a second is a brisk but followable list. */
export const EDGE_SPEED = 9

/**
 * How far the list should scroll itself this frame, with the finger where it is.
 *
 * **Without this a long routine cannot be reordered at all.** The drag lives inside the
 * list, so anything past the fold is unreachable: somebody has to drop the exercise,
 * scroll by hand, pick it up again, and repeat. The list has to come to the finger.
 *
 * The speed ramps with how far into the edge zone the finger is, rather than switching
 * on at full tilt — at the boundary it creeps, and pressed against the edge it runs. A
 * constant speed is the version that always feels wrong: too fast for a small
 * correction and too slow to cross a long list.
 *
 * Negative is upwards. Zero means the finger is in the middle and nothing should move.
 */
export function edgeScroll(finger: number, top: number, height: number): number {
  'worklet'
  if (height <= 0) return 0

  const intoTop = top + EDGE_ZONE - finger
  if (intoTop > 0) return -EDGE_SPEED * Math.min(1, intoTop / EDGE_ZONE)

  const intoBottom = finger - (top + height - EDGE_ZONE)
  if (intoBottom > 0) return EDGE_SPEED * Math.min(1, intoBottom / EDGE_ZONE)

  return 0
}

/**
 * Where the list ends up after one frame of chasing, and it is a clamp on both sides.
 *
 * **The defect this exists for:** only the top was bounded, so a finger held at the
 * bottom edge scrolled the list past its own content for as long as it was held — and
 * because the drag's travel is fed by whatever was scrolled, the destination ran off
 * with it. Coming back required letting go.
 *
 * Returning the current offset when there is nowhere to go is what stops the caller:
 * it compares, sees no movement, and leaves the travel alone.
 */
export function nextOffset(current: number, by: number, max: number): number {
  'worklet'
  return Math.max(0, Math.min(Math.max(0, max), current + by))
}
