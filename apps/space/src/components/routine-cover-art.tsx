/**
 * What a routine's cover actually draws.
 *
 * The tile is the Design System's and knows nothing about routines; this is the part
 * that does. It answers `null` for a routine with no cover, which is what makes the
 * empty tile the tile's own business rather than every caller's.
 *
 * **An icon is a glyph, muscles are a drawing and a photograph is bytes from the API**,
 * and the three live together because the choice between them is one choice. A caller
 * that had to know which kind it was holding would be a caller reimplementing this on
 * every screen.
 *
 * **La fotografía es del catálogo y viene con su dirección hecha.** Desde la segunda
 * revisión de `ADR-031` nadie sube una foto: la clase `foto` pide una de las portadas
 * públicas y la región de los músculos que la rutina trabaja elige cuál. El servidor
 * compone la dirección; aquí sólo se dibuja. Sin dirección no se dibuja nada, que es lo
 * que le pasa a una rutina que todavía no dice qué trabaja.
 *
 * **The figure is scaled to the tile's height, not its width.** The library draws on a
 * 200×400 field, so a square tile fits a standing figure with room at the sides; fitting
 * the width instead would put the head and the feet outside the corners.
 *
 * **`coverArt` and not `<CoverArt>` at the call sites.** `CoverTile` decides it is empty
 * by looking at its children, and a component that renders nothing is still an element
 * object — passing `<CoverArt cover={undefined} />` left every tile looking full and its
 * hint undrawn. The factory hands back `null` itself, so the decision lives here once
 * instead of as a conditional on every screen.
 */

import { FoundationIcon } from '@allfitone/react-native/icons'
import { useTheme } from '@allfitone/react-native/theme'
import { Image } from 'expo-image'
import { StyleSheet, View } from 'react-native'

import type { MuscleTerm } from '../client/content'
import { litSlugsFor } from '../client/exercise-catalogue'
import { BODY_BASE_HEIGHT, INERT_SLUGS } from '../client/focus-form'
import { drawsSomething, glyphFor, type RoutineCover } from '../client/routine-cover'
import { BodyFigure, faceShowing } from './body-figure'

export interface CoverArtProps {
  readonly cover: RoutineCover | undefined
  /** The muscle codes the routine works, for a cover that draws them. */
  readonly worked: readonly string[]
  readonly muscles: readonly MuscleTerm[]
  /** The side of the tile it has to fit inside. */
  readonly side: number
  /** Dónde está la fotografía, compuesta por el servidor. Nula: no hay ninguna que dibujar. */
  readonly coverUrl?: string | number | null | undefined
}

/**
 * The art, or nothing at all — which is what makes a tile read as empty.
 *
 * **Every reason to draw nothing is decided here, not inside.** The docblock above says
 * why the factory exists, and then a photograph without an address slipped through it
 * anyway: `<CoverArt>` returned `null` from inside, but the element object it was
 * wrapped in is not `null`, so a caller asking «did this draw anything?» was told yes.
 * On the cover screen that left the «Foto» tab showing an empty square, which reads as
 * a control that did nothing.
 */
export function coverArt(props: CoverArtProps): React.ReactNode {
  return drawsSomething(props.cover, props.coverUrl) ? <CoverArt {...props} /> : null
}

/** Big enough to read on the tile, small enough to keep the square breathing. */
const GLYPH_RATIO = 0.42

function CoverArt({ cover, worked, muscles, side, coverUrl }: CoverArtProps) {
  const theme = useTheme()
  if (cover === undefined) return null

  if (cover.kind === 'photo') {
    if (!coverUrl) return null
    return (
      <Image
        source={coverUrl}
        style={{ width: side, height: side }}
        contentFit="cover"
        contentPosition="top"
        transition={200}
      />
    )
  }

  if (cover.kind === 'icon') {
    const glyph = glyphFor(cover.icon)
    if (glyph === undefined) return null
    return (
      <FoundationIcon
        name={glyph}
        customSize={Math.round(side * GLYPH_RATIO)}
        color={theme.color.icon.accent}
        decorative
      />
    )
  }

  const lit = litSlugsFor(muscles, worked)
  return (
    <View style={styles.figure}>
      <BodyFigure
        // The face that draws something, front first. A back routine shown from the
        // front is a figure with nothing lit on it, which reads as a bug.
        side={faceShowing('male', lit)}
        // The same figure the exercise detail draws, and for the same reason it does:
        // this is anatomy, not a portrait, and nobody has told us anything else.
        gender="male"
        scale={side / BODY_BASE_HEIGHT}
        lit={lit}
        // No shading of what the routine merely uses: at this size the difference
        // between trained and used is a shade nobody can see.
        inert={INERT_SLUGS}
        onPressSlug={() => undefined}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  figure: { alignItems: 'center', justifyContent: 'center' },
})
