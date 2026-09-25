/**
 * Where a list has to scroll to so that something it just opened is wholly on screen.
 *
 * An exercise opens into a table of sets four times its shut height, and whatever was
 * below the fold stays below it — so every time somebody opened one they had to scroll
 * by hand to see what they had opened. This is the arithmetic that decides for them.
 *
 * Three cases and they are not the same. Something taller than the viewport can never
 * fit, so the only useful answer is to put its top at the top and let the rest run off
 * the bottom — scrolling to its end instead would hide the heading that says what it
 * is. Something hanging off the bottom scrolls up by exactly what hangs. Something
 * already whole answers nothing at all, because a scroll nobody needed is a scroll
 * that moved the list under somebody's finger.
 */

export interface Frame {
  /** Distance from the top of the scrollable content. */
  readonly y: number
  readonly height: number
}

export interface Viewport {
  /** How far the list is scrolled already. */
  readonly offset: number
  /** How much of the list is on screen. */
  readonly height: number
}

/** Air left above or below what is being revealed, so it does not touch the edge. */
export const REVEAL_MARGIN = 12

/** The offset to scroll to, or nothing when the list is already showing it whole. */
export function revealOffset(frame: Frame, viewport: Viewport): number | undefined {
  if (viewport.height <= 0) return undefined

  const top = frame.y - REVEAL_MARGIN
  const bottom = frame.y + frame.height + REVEAL_MARGIN

  // Taller than the screen: its top is the part worth showing.
  if (bottom - top > viewport.height) return atLeastZero(top)

  if (bottom > viewport.offset + viewport.height) return atLeastZero(bottom - viewport.height)
  if (top < viewport.offset) return atLeastZero(top)
  return undefined
}

function atLeastZero(offset: number): number {
  return Math.max(0, offset)
}
