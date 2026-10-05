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
