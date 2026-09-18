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
 * **The photograph carries a bearer token in its headers.** `ADR-031` keeps the bytes in
 * the database and serves them through the API, so there is no public url: `expo-image`
 * fetches them itself and has to be told who is asking. Without a token it draws nothing,
 * which is the right answer for a screen whose session has gone.
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

import { apiBaseUrl } from '../client'

import type { MuscleTerm } from '../client/content'
import { litSlugsFor } from '../client/exercise-catalogue'
import { BODY_BASE_HEIGHT, INERT_SLUGS } from '../client/focus-form'
import { glyphFor, type RoutineCover } from '../client/routine-cover'
import { BodyFigure, faceShowing } from './body-figure'

export interface CoverArtProps {
  readonly cover: RoutineCover | undefined
  /** The muscle codes the routine works, for a cover that draws them. */
  readonly worked: readonly string[]
  readonly muscles: readonly MuscleTerm[]
  /** The side of the tile it has to fit inside. */
  readonly side: number
  /** What a photograph needs to be fetched with. Absent means it cannot be drawn. */
  readonly token?: string | undefined
}

/** The art, or nothing at all — which is what makes a tile read as empty. */
export function coverArt(props: CoverArtProps): React.ReactNode {
  return props.cover === undefined ? null : <CoverArt {...props} />
}

/** Big enough to read on the tile, small enough to keep the square breathing. */
const GLYPH_RATIO = 0.42

function CoverArt({ cover, worked, muscles, side, token }: CoverArtProps) {
  const theme = useTheme()
  if (cover === undefined) return null

  if (cover.kind === 'photo') {
    if (token === undefined) return null
    return (
      <Image
        source={{
          uri: `${apiBaseUrl()}/space/v1/routine-covers/${cover.photo_id}`,
          headers: { Authorization: `Bearer ${token}` },
        }}
        style={{ width: side, height: side }}
        contentFit="cover"
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
