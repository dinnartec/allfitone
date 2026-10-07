/**
 * The long edge a meal photo is kept at, and how to get a larger one there.
 * The API stores 1600 px (`ADR-039`); shrinking to the same edge on the phone stores the
 * same image and sends a fraction of it.
 */
export const PHOTO_EDGE = 1600

/** The resize that brings a photo within the edge along its long side; null if it is. */
export function shrinkTo(
  width: number,
  height: number,
): { readonly width: number } | { readonly height: number } | null {
  if (Math.max(width, height) <= PHOTO_EDGE) return null
  return width >= height ? { width: PHOTO_EDGE } : { height: PHOTO_EDGE }
}
