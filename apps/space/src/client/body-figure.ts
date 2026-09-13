/**
 * Which paths the body figure draws, and what each one is for.
 *
 * The figure was rendered with the library's own `<Body>` component and came out
 * broken: a jagged silhouette, muscles separated by black gaps, and the chosen group
 * reading as a flat sticker. The paths were never the problem — the painting was.
 *
 * Three of the four causes were in props (`border="none"` removed the outline, a
 * `strokeWidth` of 1 scaled down to 0.28 CSS px and so the "seams" were the canvas
 * showing through, and flat fills gave no volume). The fourth needs a `<Defs>` inside
 * the SVG, which `<Body>` has no prop for. So the screen composes the wrapper itself,
 * and this is the part of that composition with decisions in it.
 *
 * **`head` carries only `path.common`.** Walking `left`/`right` alone drops it in
 * silence and the figure comes out decapitated, which is the failure this module
 * exists to make impossible: all three keys, always.
 *
 * **`hair` is dropped on the front only.** There it is two locks over the forehead and
 * reads as spikes. On the back it *is* the back of the skull, and dropping it leaves
 * the head open — a dark hollow with the ears sticking out of it, which is what it
 * looked like until the figure got big enough to see.
 *
 * The zone vocabulary is **not** redefined here. `focus-form.ts` owns which muscles a
 * zone lights, which ones are inert, and what a selection means; this only says which
 * `d` strings exist and how each should be painted.
 */

import type { BodyPart, Slug } from 'react-native-body-highlighter'

import type { BodySide, BodySlug } from './focus-form'

/** What is not drawn, which is not the same on both faces. */
export function hiddenFor(side: BodySide): readonly Slug[] {
  return side === 'front' ? ['hair'] : []
}

export type PaintRole = 'lit' | 'resting' | 'inert'

export interface FigureGroup {
  /** The app's own union, which mirrors the library's part for part. */
  readonly slug: BodySlug
  readonly role: PaintRole
  /** Every `d` of this muscle: `common` plus both sides. */
  readonly paths: readonly string[]
}

/**
 * One group per muscle, not one node per path.
 *
 * A face is 64 to 90 separate `d` strings — 157 across the two the screen shows at
 * once. Giving each its own press handler and its own fill made every tap re-diff
 * 157 native nodes, and the figure took seconds to answer. Grouping by muscle turns
 * that into 33: the fill is inherited from the group and the press belongs to the
 * muscle anyway, because a muscle is what a person taps.
 *
 * A part with no slug or no geometry is skipped rather than drawn unattributed: a
 * shape nothing can explain is a shape nothing can light.
 */
export function figureGroups(input: {
  readonly parts: readonly BodyPart[]
  readonly side: BodySide
  readonly lit: readonly string[]
  readonly inert: readonly string[]
}): readonly FigureGroup[] {
  const groups: FigureGroup[] = []
  const hidden = hiddenFor(input.side)

  for (const part of input.parts) {
    const slug = part.slug
    if (!slug || hidden.includes(slug)) continue

    // All three keys. `head` has only `common`, and walking the pair would drop it.
    const paths = (['common', 'left', 'right'] as const).flatMap(
      (member) => part.path?.[member] ?? [],
    )
    const drawable = paths.filter((d) => typeof d === 'string' && d !== '')
    if (drawable.length === 0) continue

    groups.push({ slug, role: roleFor(slug, input.lit, input.inert), paths: drawable })
  }

  return groups
}

export function roleFor(slug: string, lit: readonly string[], inert: readonly string[]): PaintRole {
  if (inert.includes(slug)) return 'inert'
  return lit.includes(slug) ? 'lit' : 'resting'
}

/** The gradient and filter ids a face uses, namespaced so front and back never collide. */
export function figureIds(side: BodySide): {
  readonly lit: string
  readonly resting: string
  readonly halo: string
} {
  return { lit: `lit-${side}`, resting: `resting-${side}`, halo: `halo-${side}` }
}
