/**
 * Detalle de un movimiento — `OP-CAT-010`.
 *
 * The picker offers a name and a line of metadata. Somebody who has never done a hip
 * thrust cannot find out what it is before putting it in their routine. This is where
 * they look: other names it goes by, what it trains and what it merely uses, how it is
 * done, and what to do instead.
 *
 * **One call.** The whole thing arrives from `read_movement`, because a screen that
 * fetched five pieces would draw itself five times.
 *
 * **The figure says two things at once.** The primary muscle is lit and the secondary
 * ones are shaded — a bench press trains the chest and uses the triceps, and painting
 * both the same would say they are the same thing.
 *
 * **The illustration leads and the figure is secondary.** They answer different
 * questions — one shows how the movement looks, the other where it lands — and giving
 * them equal room made the body read as the picture of the exercise, which it is not.
 * Where no illustration exists the two faces take the block instead: a fallback, and
 * it should look like one.
 *
 * **The drawing arrives by network, not in the app.** A catalogue of hundreds cannot
 * bundle its own demonstrations without the download becoming the product's first
 * impression. `demo_url` is composed by the API from configuration, and `expo-image`
 * keeps what it fetches on disk, so a movement seen once still draws without a signal.

 *
 * **It is the source's own drawing, untouched.** Recolouring it into our palette was
 * tried and thrown away: mapping luminance onto the alpha channel turns a crisp black
 * outline into translucent light ink and flattens the body's shading into one tone, so
 * the whole thing loses its definition. What the source draws is already legible —
 * black line, grey mass, red on what is worked — and it carries its own white paper, so
 * it needs no plate under it.
 *
 * **It is 180 px, and that is the ceiling.** The source's free tier serves no larger;
 * 360 and above need a paid plan. So it is kept at native size, encoded losslessly, and
 * shown below full width, because magnifying it is the one thing that cannot help.
 *
 * **The figure sits beside it, not on it, in a column of its own with the control.**
 * Over white artwork an overlay of either theme's figure washes out, and the two are
 * answering different questions anyway. Putting the column there also buys back the
 * sharpness that a full width illustration was spending.
 *
 * **It loops, so it can be stopped.** Moving content that starts on its own and never
 * ends is WCAG 2.2.2, and DT-010 makes AA the launch baseline. It starts stopped when
 * the system asks for reduced motion, and either way there is a control that says which
 * state it is in.
 *
 * **The illustration is provisional and not cleared to ship.** It comes from
 * ExerciseDB, whose free plan forbids commercial and SaaS use without a paid plan;
 * `packages/db/curation/import/MEDIA_NOTICE.md` carries the terms and what has to happen
 * before release. The drawing says where it comes from while that is true.
 *
 * **How it is done and what to do instead share one block, behind tabs.** Stacked, the
 * variants sat under five steps and nobody scrolled that far to find them — which is
 * the whole reason to know a movement has variants. The strip is drawn even when only
 * one panel has content, so the block starts in the same place on every movement; what
 * is left out is a tab with nothing behind it.
 *
 * Adding from here goes through the same mailbox the picker uses, so the routine
 * draft keeps exactly one writer.
 */

import { Button } from '@allfitone/react-native/button'
import { Chip } from '@allfitone/react-native/chip'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { IconButton } from '@allfitone/react-native/icon-button'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { StepList } from '@allfitone/react-native/step-list'
import { Tabs } from '@allfitone/react-native/tabs'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { Image } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { ApiError } from '../../../src/client'
import type { MovementDetail, MuscleTerm } from '../../../src/client/content'
import { createSpaceContentFlow } from '../../../src/client/content-transport'
import { litSlugsFor } from '../../../src/client/exercise-catalogue'
import { offerExercisePick } from '../../../src/client/exercise-pick'
import { INERT_SLUGS, type BodySide } from '../../../src/client/focus-form'
import { BodyFigure, faceShowing } from '../../../src/components/body-figure'

const EXPIRED = 'Tu sesión venció. Vuelve a entrar para continuar.'
const READ_FAILED = 'No pudimos abrir este ejercicio. Inténtalo otra vez.'

/** Owed while the source is what it is. See the NOTICE beside the curation. */
const PICTURE_SOURCE = 'ExerciseDB · provisional'

/**
 * The wrapper draws `200 * scale` wide by `400 * scale` tall, and the illustration
 * takes whatever width is left, so the two trade against each other. This size leaves
 * the figure and the control inside the plate's padding without either being cropped;
 * bigger, and the column starts winning an argument it should not be having.
 */
const INSET_SCALE = 0.38

/** The whole block when there is no illustration, two faces across the width. */
const FALLBACK_SCALE = 0.78

type TabValue = 'how' | 'variants'

const HOW_TITLE = 'CÓMO SE HACE'
const VARIANTS_TITLE = 'VARIANTES'

export default function MovementDetailScreen() {
  const router = useRouter()
  const theme = useTheme()
  const flow = useMemo(() => createSpaceContentFlow(), [])
  const params = useLocalSearchParams<{ movementId: string }>()
  const movementId = params.movementId

  const [movement, setMovement] = useState<MovementDetail | undefined>(undefined)
  const [muscles, setMuscles] = useState<readonly MuscleTerm[]>([])
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [playing, setPlaying] = useState(true)
  const [tab, setTab] = useState<TabValue>('how')
  const player = useRef<Image>(null)

  useEffect(() => {
    let active = true
    if (!movementId) return

    Promise.all([flow.readMovement(movementId), flow.readMuscles()])
      .then(([found, vocabulary]) => {
        if (!active) return
        setMovement(found)
        setMuscles(vocabulary)
        setFailure(undefined)
        // Opening a variant replaces this screen without unmounting it, and the
        // person asked for that movement, not for its own variants.
        setTab('how')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setFailure(
          cause instanceof ApiError && cause.failure === 'unauthenticated' ? EXPIRED : READ_FAILED,
        )
      })

    return () => {
      active = false
    }
  }, [flow, movementId])

  // Reduced motion is a system setting that can change while the screen is open.
  useEffect(() => {
    let active = true
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (active) setPlaying(!reduced)
    })
    const watch = AccessibilityInfo.addEventListener('reduceMotionChanged', (reduced) =>
      setPlaying(!reduced),
    )
    return () => {
      active = false
      watch.remove()
    }
  }, [])

  const worked = movement?.muscles ?? []
  const steps = movement?.instructions ?? []
  const variants = movement?.variants ?? []

  // Only what has something behind it: a tab over an empty panel is a control that
  // does nothing. The strip shows even with one, so the heading never moves.
  const panels = [
    ...(steps.length > 0 ? [{ value: 'how' as const, label: HOW_TITLE }] : []),
    ...(variants.length > 0 ? [{ value: 'variants' as const, label: VARIANTS_TITLE }] : []),
  ]
  const shownTab = panels.some((one) => one.value === tab) ? tab : (panels[0]?.value ?? 'how')
  const picture = movement?.demo_url ?? undefined

  const lit = litSlugsFor(
    muscles,
    worked.filter((one) => one.primary).map((one) => one.code),
  )
  const shaded = litSlugsFor(
    muscles,
    worked.filter((one) => !one.primary).map((one) => one.code),
  )

  useEffect(() => {
    const image = player.current
    if (!image) return
    void (playing ? image.startAnimating() : image.stopAnimating())
  }, [playing, picture])

  // Replace and not push: walking variant to variant would build a stack somebody
  // has to tap back through one by one.
  const openVariant = (id: string) => router.replace(`/routines/exercises/${id}`)

  const add = () => {
    if (!movement) return
    offerExercisePick([{ id: movement.id, name: movement.name }])
    router.back()
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.top}>
          <IconButton icon="back" accessibilityLabel="Volver" onPress={() => router.back()} />
        </View>

        <View style={styles.heading}>
          <Text role="eyebrow" size="2xs" color="muted">
            MOVIMIENTO DEL CATÁLOGO
          </Text>
          <Text role="display" size="3xl" uppercase accessibilityRole="header">
            {movement?.name ?? ' '}
          </Text>
          {movement !== undefined && movement.aliases.length > 0 ? (
            <Text role="body" size="sm" color="muted">
              {`También: ${movement.aliases.join(' · ')}`}
            </Text>
          ) : null}
        </View>

        {failure ? <InlineAlert message={failure} /> : null}

        {movement === undefined && !failure ? (
          <Text role="body" size="sm" color="muted">
            Cargando el ejercicio…
          </Text>
        ) : null}

        {movement !== undefined ? (
          <>
            {picture === undefined ? (
              <View style={styles.fallback}>
                {(['front', 'back'] as const).map((side: BodySide) => (
                  <BodyFigure
                    key={side}
                    side={side}
                    gender="male"
                    scale={FALLBACK_SCALE}
                    lit={lit}
                    secondary={shaded}
                    inert={INERT_SLUGS}
                    onPressSlug={() => undefined}
                  />
                ))}
              </View>
            ) : (
              <>
                <View style={styles.demoRow}>
                  <View style={styles.demo}>
                    <Image
                      ref={player}
                      source={{ uri: picture }}
                      style={styles.picture}
                      contentFit="contain"
                      autoplay={playing}
                      accessible
                      accessibilityRole="image"
                      accessibilityLabel={`Ejecución de ${movement.name}`}
                    />
                  </View>
                  <View
                    style={[
                      styles.demoAside,
                      {
                        backgroundColor: theme.color.background.surfaceSubtle,
                        borderColor: theme.color.border.subtle,
                      },
                    ]}
                  >
                    <BodyFigure
                      side={faceShowing('male', lit)}
                      gender="male"
                      scale={INSET_SCALE}
                      lit={lit}
                      secondary={shaded}
                      inert={INERT_SLUGS}
                      onPressSlug={() => undefined}
                    />
                    <IconButton
                      icon={playing ? 'pause' : 'start'}
                      accessibilityLabel={
                        playing ? 'Detener la demostración' : 'Reproducir la demostración'
                      }
                      onPress={() => setPlaying((on) => !on)}
                    />
                  </View>
                </View>
                <Text role="data" size="xs" color="muted">
                  {PICTURE_SOURCE}
                </Text>
              </>
            )}

            <View style={styles.section}>
              <Text role="eyebrow" size="2xs" color="muted">
                QUÉ TRABAJA
              </Text>
              <View style={styles.chips}>
                {worked.map((one) => (
                  <Chip
                    key={one.code}
                    label={one.name}
                    selected={one.primary}
                    onPress={() => undefined}
                  />
                ))}
              </View>
            </View>

            {panels.length > 0 ? (
              <View style={styles.section}>
                <Tabs
                  items={panels}
                  value={shownTab}
                  onChange={setTab}
                  accessibilityLabel="Secciones del ejercicio"
                />
                {shownTab === 'how' ? (
                  <StepList steps={steps} accessibilityLabel={HOW_TITLE} />
                ) : (
                  <Variants variants={variants} onOpen={openVariant} />
                )}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      {movement === undefined ? null : <Button label="Añadir a la rutina" onPress={add} />}
    </Screen>
  )
}

/**
 * The variants panel. Its sibling, the steps, is `StepList` from the Design System —
 * the numbered marker and the leading it has to match are not this screen's to invent.
 */
function Variants({
  variants,
  onOpen,
}: {
  readonly variants: MovementDetail['variants']
  readonly onOpen: (id: string) => void
}) {
  const theme = useTheme()
  return (
    <View style={styles.section}>
      {variants.map((one) => (
        <Pressable
          key={one.id}
          accessibilityRole="button"
          accessibilityLabel={`Ver ${one.name}`}
          onPress={() => onOpen(one.id)}
          style={[
            styles.variant,
            {
              backgroundColor: theme.color.background.surface,
              borderColor: theme.color.border.subtle,
            },
          ]}
        >
          <View style={styles.variantText}>
            <Text role="display" size="sm" uppercase numberOfLines={1}>
              {one.name}
            </Text>
            {one.note === null ? null : (
              <Text role="body" size="xs" color="muted" numberOfLines={1}>
                {one.note}
              </Text>
            )}
          </View>
          <FoundationIcon name="forward" size="sm" color={theme.color.icon.secondary} decorative />
        </Pressable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  content: { gap: 14, paddingBottom: 96 },
  top: { flexDirection: 'row' },
  heading: { gap: 4 },
  demoRow: { flexDirection: 'row', gap: 12 },
  // Whatever the column leaves, and square because the source is. Narrower than the
  // screen also means less upscaling of a 180 px illustration, which it needs.
  demo: { flex: 1, aspectRatio: 1, alignSelf: 'flex-start', borderRadius: 16, overflow: 'hidden' },
  picture: { width: '100%', height: '100%' },
  // Anchored to the illustration's edges, not floating in the middle of the column.
  // A plate of its own, as tall as the illustration beside it. Floating on the ground
  // the figure read as leftover space next to a bright white block.
  demoAside: {
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  fallback: { flexDirection: 'row', justifyContent: 'center', gap: 2 },
  section: { gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  variant: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 58,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
  },
  variantText: { flex: 1, gap: 2 },
})
