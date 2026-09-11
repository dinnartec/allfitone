/**
 * The muscle figure of `/onboarding/focus`, composed rather than configured.
 *
 * The library's `<Body>` drew a jagged silhouette, muscles separated by black gaps,
 * and a chosen group that read as a flat sticker. The paths were always right; the
 * painting was not, in four ways:
 *
 * 1. `border="none"` — the wrapper only draws the full-body outline when `border` is
 *    something, so the silhouette was open and the pieces looked loose. The heaviest
 *    of the four. The previous code justified it by saying the library ships an
 *    outline for the man and none for the woman; **that is false** — `SvgFemaleWrapper`
 *    ships both faces. Both figures get the outline.
 * 2. `defaultStrokeWidth={1}` — the wrapper fits 724 viewBox units into `200 * scale`
 *    px, about 0.276 at scale 1, so a stroke of 1 arrived as 0.28 CSS px: invisible.
 *    What separated the muscles was the canvas showing through the gaps between
 *    paths, not a seam.
 * 3. Flat fills — one flat cyan and one flat grey. No gradient, no volume.
 * 4. No halo on the chosen group.
 *
 * `vectorEffect="non-scaling-stroke"` fixes the seam properly: the width is in device
 * pixels, so it stops depending on `scale` and on the four different viewBoxes the
 * two sexes and two faces use. It is what the wrapper's own outline already does.
 *
 * **The light palette is not the dark one recoloured.** On dark, the chosen group is
 * brighter than the resting muscle and that is the hierarchy. The same idea on light
 * inverts it: against a light canvas a brighter group is a *paler* one, and it reads
 * as washed out rather than picked. On light the chosen group is therefore more
 * saturated and darker.
 *
 * Both ramps run light at the top, because that is where the light comes from; what
 * changes is where the whole ramp sits. Measured against the canvas, every stop of
 * the chosen group out-contrasts the resting muscle in both themes — on light 5.4 and
 * 14.2 against the resting 4.4, on dark 14.4 and 5.2 against 3.8. `border.accent` was
 * the obvious light top and is the one that does not hold: at 3.5 it sits *below* the
 * resting muscle, which is the inversion itself.
 *
 * **The figure confirms; the chips decide.** A muscle path is nowhere near the 44 pt
 * DT-010 asks for, so tapping one is a shortcut and never the only way in — `HU-SP-097`
 * criterion 1 requires the list as a real alternative, and it is the list that carries
 * the accessible names and the checkbox semantics.
 *
 * Nothing here animates, so there is no reduced-motion branch to write: the honest
 * way to respect that setting is not to add motion that would need excusing.
 *
 * **It has to be cheap, and the first version was not.** A face is 64 to 90 separate
 * `d` strings and the screen shows two at once, so the first version put 157 touchable
 * nodes on screen, gave each a fresh press handler on every render, and ran a separate
 * Gaussian blur for each lit one. A tap took seconds to answer. Three things fix it,
 * and the blur is the big one:
 *
 * - **One blur for the whole chosen group**, not one per path. `<G filter>` wrapping
 *   the lit muscles is a single pass instead of one per shape.
 * - **One node per muscle**, not per path: 33 instead of 157, and the press belongs to
 *   the muscle anyway, because a muscle is what a person taps.
 * - **Memoised**, so the untouched face does no work when the other one changes.
 */

import { useTheme } from '@allfitone/react-native/theme'
import { memo, useCallback, useMemo } from 'react'
import { bodyBack } from 'react-native-body-highlighter/dist/assets/bodyBack'
import { bodyFemaleBack } from 'react-native-body-highlighter/dist/assets/bodyFemaleBack'
import { bodyFemaleFront } from 'react-native-body-highlighter/dist/assets/bodyFemaleFront'
import { bodyFront } from 'react-native-body-highlighter/dist/assets/bodyFront'
import { SvgFemaleWrapper } from 'react-native-body-highlighter/dist/components/SvgFemaleWrapper'
import { SvgMaleWrapper } from 'react-native-body-highlighter/dist/components/SvgMaleWrapper'
import {
  Defs,
  FeGaussianBlur,
  FeMerge,
  FeMergeNode,
  Filter,
  G,
  LinearGradient,
  Path,
  Stop,
} from 'react-native-svg'

import { figureGroups, figureIds, type FigureGroup } from '../client/body-figure'
import type { BodySide, BodySlug } from '../client/focus-form'

/**
 * The seam between muscles, in device pixels.
 *
 * Device and not viewBox units, through `vectorEffect`, so it reads the same at every
 * scale and on all four viewBoxes. Below about this the muscles fuse into one shape.
 */
const SEAM_WIDTH = 0.8

/** Wide enough to read as a glow around the group rather than a second outline. */
const HALO_BLUR = 6

export const BodyFigure = memo(function BodyFigure({
  side,
  gender,
  scale,
  lit,
  inert,
  onPressSlug,
}: {
  readonly side: BodySide
  readonly gender: 'male' | 'female'
  readonly scale: number
  readonly lit: readonly string[]
  readonly inert: readonly string[]
  readonly onPressSlug: (slug: BodySlug) => void
}) {
  const theme = useTheme()
  const Wrapper = gender === 'female' ? SvgFemaleWrapper : SvgMaleWrapper
  const ids = figureIds(side)

  const groups = useMemo(
    () => figureGroups({ parts: assetFor(gender, side), lit, inert }),
    [gender, side, lit, inert],
  )
  const chosen = groups.filter((group) => group.role === 'lit')
  const rest = groups.filter((group) => group.role !== 'lit')

  // Dark lifts the chosen group above the resting one; light deepens it instead.
  // Both run lighter at the top: what changes is where the ramp sits, not its direction.
  const light = theme.name === 'light'
  const litTop = light ? theme.color.border.strong : theme.color.action.primary
  const litBottom = light ? theme.color.accent.onAccent : theme.color.border.strong

  const muscle = useCallback(
    (group: FigureGroup, fill: string) => (
      <G
        key={group.slug}
        fill={fill}
        {...(group.role === 'inert' ? {} : { onPress: () => onPressSlug(group.slug) })}
      >
        {group.paths.map((d, index) => (
          <Path key={index} d={d} />
        ))}
      </G>
    ),
    [onPressSlug],
  )

  return (
    <Wrapper side={side} gender={gender} scale={scale} border={theme.color.border.default}>
      <Defs>
        {/* Vertical, so the light reads as coming from above on both faces. */}
        <LinearGradient id={ids.lit} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={litTop} stopOpacity="1" />
          <Stop offset="1" stopColor={litBottom} stopOpacity="1" />
        </LinearGradient>
        {/* One colour, two opacities: volume without inventing a second grey. */}
        <LinearGradient id={ids.resting} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={theme.color.border.default} stopOpacity="1" />
          <Stop offset="1" stopColor={theme.color.border.default} stopOpacity="0.66" />
        </LinearGradient>
        <Filter id={ids.halo} x="-25%" y="-25%" width="150%" height="150%">
          <FeGaussianBlur in="SourceAlpha" stdDeviation={HALO_BLUR} result="glow" />
          <FeMerge>
            <FeMergeNode in="glow" />
            <FeMergeNode in="SourceGraphic" />
          </FeMerge>
        </Filter>
      </Defs>

      {/* The seam is set once here and inherited: 33 nodes do not each need to say it. */}
      <G
        stroke={theme.color.background.canvas}
        strokeWidth={SEAM_WIDTH}
        vectorEffect="non-scaling-stroke"
      >
        {rest.map((group) =>
          muscle(
            group,
            group.role === 'inert' ? theme.color.border.subtle : `url(#${ids.resting})`,
          ),
        )}

        {/* One blur for the whole chosen group. One per shape is what made a tap slow. */}
        {chosen.length > 0 ? (
          <G filter={`url(#${ids.halo})`}>
            {chosen.map((group) => muscle(group, `url(#${ids.lit})`))}
          </G>
        ) : null}
      </G>
    </Wrapper>
  )
})

function assetFor(gender: 'male' | 'female', side: BodySide) {
  if (gender === 'female') return side === 'front' ? bodyFemaleFront : bodyFemaleBack
  return side === 'front' ? bodyFront : bodyBack
}
