/**
 * Where the floating tab bar sits, and how high something must float to clear it.
 *
 * One place for both, so a toast cannot drift behind the bar again: it was placed from the
 * screen's edge while the bar stood on the safe area, and on a phone with a home indicator
 * the two met.
 */

/** The bar's height. */
export const DOCK_HEIGHT = 70

/** The bar's distance from the bottom edge: the safe area, never closer than 12. */
export const dockBottom = (insetBottom: number): number => Math.max(insetBottom, 12)

/** The bottom of something that floats above the bar, with a gap between them. */
export const aboveDock = (insetBottom: number, gap = 12): number =>
  dockBottom(insetBottom) + DOCK_HEIGHT + gap

/** The bar's inner padding, either side of the four columns. */
export const BAR_PADDING = 2

/** What the drop is made of: Liquid Glass where the phone draws it and the person wants it. */
export function dropMaterial(input: {
  readonly liquidGlass: boolean
  readonly reduceTransparency: boolean
}): 'glass' | 'tint' {
  return input.liquidGlass && !input.reduceTransparency ? 'glass' : 'tint'
}

/** Where the drop's left edge sits over a tab, in a bar of some width and columns. */
export function dropOffset(index: number, width: number, count: number): number {
  'worklet'
  return BAR_PADDING + index * ((width - BAR_PADDING * 2) / count)
}

/** The tab a drop released at some offset lands on: the nearest column, inside the bar. */
export function nearestTab(offset: number, width: number, count: number): number {
  'worklet'
  const column = (width - BAR_PADDING * 2) / count
  return Math.min(count - 1, Math.max(0, Math.round((offset - BAR_PADDING) / column)))
}

/** How much a drop moving at some speed (points per second) stretches: 0 resting, 1 at most. */
export function stretchFor(velocity: number): number {
  'worklet'
  return Math.min(1, Math.abs(velocity) / 2400)
}

/** Whether a touch at some offset lands on the drop, with 12 points of room either side. */
export function onDrop(touch: number, dropLeft: number, dropWidth: number): boolean {
  'worklet'
  return touch >= dropLeft - 12 && touch <= dropLeft + dropWidth + 12
}
