/**
 * Filtrar por musculatura, en su propia pantalla.
 *
 * Eighteen muscles in three blocks do not fit above the list they filter without
 * taking half of it, so they get the room instead.
 *
 * **The figure and the list are one control.** Tapping a drawn part turns on the
 * muscles it draws, and tapping a row lights the part — they are two ways into the
 * same set, which is the same promise `/onboarding/focus` makes. The figure is the
 * shortcut; the list is the way that works for everyone, because a muscle path is
 * nowhere near the 44 pt DT-010 asks for.
 *
 * **A part can stand for two muscles.** The figure has no lat of its own, so Dorsales
 * takes the upper back and shares it with the muscle that owns it. Tapping that shape
 * turns both on, which is honest: the drawing cannot tell them apart, and leaving it
 * unlit made choosing Dorsales look broken. Telling them apart is what the list is for.
 *
 * Abductores is not in the vocabulary at all. The figure has no part even
 * approximately right for it — the glute was tried and read as a different muscle —
 * and the two movements it labelled already carry the glute or the adductor.
 *
 * Only Cardio and Cuerpo completo are list-only: they are not muscles at all, and are
 * the label the seven movements that are not strength carry.
 *
 * **Both faces at once, like onboarding.** A toggle makes somebody hunt for the face
 * their muscle lives on before they can even see it, and half of these span both —
 * the back shows lats and glutes, the front shows chest and quads. Two figures cost
 * one screen of width and remove the hunt.
 *
 * The button at the bottom says how many exercises are left **before** it is
 * pressed. That is only possible because the catalogue is filtered in memory.
 */

import { Button } from '@allfitone/react-native/button'
import { Chip } from '@allfitone/react-native/chip'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { createSpaceContentFlow } from '../../../src/client/content-transport'
import type { MuscleTerm } from '../../../src/client/content'
import {
  applyFilter,
  clearFacet,
  codesForBodySlug,
  isFiltered,
  litSlugsFor,
  muscleBlocks,
  resultLabel,
  toggleFilter,
  type ExerciseFilter,
} from '../../../src/client/exercise-catalogue'
import type { Movement } from '../../../src/client/content'
import { readExerciseLibrary } from '../../../src/client/exercise-library'
import { exerciseFilter, rememberExerciseFilter } from '../../../src/client/exercise-pick'
import { INERT_SLUGS, type BodySide, type BodySlug } from '../../../src/client/focus-form'
import { BodyFigure } from '../../../src/components/body-figure'
import { ScreenHeader } from '../../../src/components/screen-header'

const ONLY_IN_LIST =
  'Cardio y Cuerpo completo no son músculos y no están en la figura: van solo aquí.'

/**
 * Two figures side by side, as large as the narrowest phone allows.
 *
 * The library draws at 200 x 400 points times the scale, so the pair plus their gap
 * is `400 * scale + 4`. On a 375 pt screen, 48 of which is the screen's own inset,
 * that caps the scale at 0.80 — and the figure is the control here, so it takes it.
 */
const FIGURE_SCALE = 0.8

export default function MuscleFilter() {
  const router = useRouter()
  const flow = useMemo(() => createSpaceContentFlow(), [])

  const [filter, setFilter] = useState<ExerciseFilter>(() => exerciseFilter())
  const [muscles, setMuscles] = useState<readonly MuscleTerm[]>([])
  const [movements, setMovements] = useState<readonly Movement[]>([])

  useEffect(() => {
    let active = true

    readExerciseLibrary(flow)
      .then((library) => {
        if (!active) return
        setMuscles(library.muscles)
        setMovements(library.movements)
      })
      // The list still works from what is already chosen; a vocabulary that does not
      // arrive leaves an empty screen rather than a broken one.
      .catch(() => undefined)

    return () => {
      active = false
    }
  }, [flow])

  const change = useCallback((next: ExerciseFilter) => {
    setFilter(next)
    rememberExerciseFilter(next)
  }, [])

  // One part can stand for two muscles, so a tap on it is several toggles.
  const press = useCallback(
    (slug: BodySlug) => {
      const codes = codesForBodySlug(muscles, slug)
      if (codes.length === 0) return
      change(
        codes.reduce((current, code) => toggleFilter(current, 'muscle', code, muscles), filter),
      )
    },
    [change, filter, muscles],
  )

  const lit = litSlugsFor(muscles, filter.muscles)
  const left = applyFilter(movements, { muscles: filter.muscles, equipment: [] })

  return (
    <Screen edges={['top', 'bottom']}>
      {/* Outside the scroll: the way out and the way to undo must not be something
          somebody has to scroll back up to find. */}
      <View style={styles.head}>
        <ScreenHeader
          title="Musculatura"
          subtitle={
            filter.muscles.length === 0
              ? 'toca en la figura o en la lista'
              : `${filter.muscles.length} ${filter.muscles.length === 1 ? 'músculo' : 'músculos'}`
          }
          onClose={() => router.back()}
          onConfirm={
            filter.muscles.length === 0 ? undefined : () => change(clearFacet(filter, 'muscle'))
          }
          confirmLabel="Quitar"
          confirmText="Quitar"
        />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.faces}>
          {(['front', 'back'] as const).map((side: BodySide) => (
            <View key={side} style={styles.face}>
              <BodyFigure
                side={side}
                // Always the male figure, which onboarding does not do: the profile
                // that answers `bodyGender` is not on this flow, and fetching it is a
                // round trip for a control. Worth closing when the profile is nearer.
                gender="male"
                scale={FIGURE_SCALE}
                lit={lit}
                inert={INERT_SLUGS}
                onPressSlug={press}
              />
              <Text role="body" size="xs" color="muted" style={styles.faceName}>
                {side === 'front' ? 'FRENTE' : 'ESPALDA'}
              </Text>
            </View>
          ))}
        </View>

        {muscleBlocks(muscles).map((block) => (
          <View key={block.region} style={styles.block}>
            <Text role="eyebrow" size="2xs" color="muted">
              {block.title}
            </Text>
            <View style={styles.chips}>
              {block.muscles.map((muscle) => (
                <Chip
                  key={muscle.code}
                  label={muscle.name}
                  selected={isFiltered(filter, 'muscle', muscle.code)}
                  onPress={() => change(toggleFilter(filter, 'muscle', muscle.code, muscles))}
                />
              ))}
            </View>
          </View>
        ))}

        <Text role="body" size="xs" color="muted">
          {ONLY_IN_LIST}
        </Text>
      </ScrollView>

      <Button
        label={resultLabel(left.length)}
        disabled={left.length === 0}
        onPress={() => router.back()}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  // Clear of the button, which floats over the scroll rather than scrolling with it:
  // its own height plus the home indicator the screen already reserves.
  content: { gap: 14, paddingBottom: 96 },
  head: { paddingBottom: 14 },
  faces: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', gap: 4 },
  face: { alignItems: 'center' },
  faceName: { marginTop: 3, letterSpacing: 1.6 },
  block: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
})
