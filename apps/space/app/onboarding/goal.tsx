/**
 * What do you want to achieve — HU-SP-010.
 *
 * The chosen goal is the one shown large, with the two bodies; the rest stay as
 * rows. That is the whole interaction: tapping a row promotes it to the card, so
 * the selection is the layout rather than a mark added on top of it. There is no
 * separate radio, and there is no chevron: nothing here navigates anywhere.
 *
 * Photographs rather than illustration, because the goal is about a body and the
 * app's identity is already photographic. Which body depends on what was declared
 * one screen earlier — female brings the woman, male and declining bring the man,
 * decided in `bodyVariant` and explained there.
 *
 * Only `maintain` ships a single figure. It is the one goal with no "after": the
 * point of it is that the body stays as it is, and a pair would promise a change
 * the goal explicitly does not make.
 *
 * The card geometry is measured from the laid-out row rather than derived from the
 * window. `Screen` already applies `panelInset` on each side, and computing from
 * the window double-counts it — the mistake that cut the second card off the sex
 * screen. See `goal-form.ts`, where the arithmetic and the reasoning live.
 *
 * Nothing arrives preselected. A default here would be an opinion about someone's
 * training dressed as a convenience, and the person has to actually choose.
 */

import { AmbientBackdrop } from '@allfitone/react-native/backdrop'
import { Button } from '@allfitone/react-native/button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Image, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native'
import Animated, {
  Easing,
  FadeInDown,
  LinearTransition,
  useReducedMotion,
} from 'react-native-reanimated'

/**
 * A height with no width makes React Native fall back to the file's intrinsic
 * width, and the box then spreads left across the whole card — which is exactly
 * how the copy ended up sitting on top of the bodies. The aspect comes from the
 * asset itself rather than a baked constant, so re-exporting the artwork at a
 * different size cannot silently break the layout.
 */
function figureAspect(source: number): number {
  const asset = Image.resolveAssetSource(source)
  if (!asset?.width || !asset?.height) return 0
  return asset.width / asset.height
}

import { OnboardingHeader } from '../../src/components/onboarding-header'
import {
  cssDuration,
  durationFor,
  easingFor,
  liftFor,
  PRESS_DURATION,
  PRESS_SCALE,
  shouldPlayEntrance,
  staggerDelays,
} from '../../src/client/motion'
import { ApiError } from '../../src/client'
import { createSpaceOnboardingFlow } from '../../src/client/onboarding-transport'
import { guardStep, nextRouteAfter } from '../../src/client/onboarding-steps'
import {
  bodyVariant,
  canSubmitGoal,
  CARD_GAP,
  goalSlots,
  heroGeometry,
  pairHeight,
  TRAINING_GOALS,
  type TrainingGoal,
} from '../../src/client/goal-form'

import loseWeightMaleBefore from '../../assets/images/goal/goal-lose-weight-male-before.webp'
import loseWeightMaleAfter from '../../assets/images/goal/goal-lose-weight-male-after.webp'
import loseWeightFemaleBefore from '../../assets/images/goal/goal-lose-weight-female-before.webp'
import loseWeightFemaleAfter from '../../assets/images/goal/goal-lose-weight-female-after.webp'
import buildMuscleMaleBefore from '../../assets/images/goal/goal-build-muscle-male-before.webp'
import buildMuscleMaleAfter from '../../assets/images/goal/goal-build-muscle-male-after.webp'
import buildMuscleFemaleBefore from '../../assets/images/goal/goal-build-muscle-female-before.webp'
import buildMuscleFemaleAfter from '../../assets/images/goal/goal-build-muscle-female-after.webp'
import getFitMaleBefore from '../../assets/images/goal/goal-get-fit-male-before.webp'
import getFitMaleAfter from '../../assets/images/goal/goal-get-fit-male-after.webp'
import getFitFemaleBefore from '../../assets/images/goal/goal-get-fit-female-before.webp'
import getFitFemaleAfter from '../../assets/images/goal/goal-get-fit-female-after.webp'
import runARaceMaleBefore from '../../assets/images/goal/goal-run-a-race-male-before.webp'
import runARaceMaleAfter from '../../assets/images/goal/goal-run-a-race-male-after.webp'
import runARaceFemaleBefore from '../../assets/images/goal/goal-run-a-race-female-before.webp'
import runARaceFemaleAfter from '../../assets/images/goal/goal-run-a-race-female-after.webp'
import maintainMaleSingle from '../../assets/images/goal/goal-maintain-male-single.webp'
import maintainFemaleSingle from '../../assets/images/goal/goal-maintain-female-single.webp'
import halo from '../../assets/images/goal/goal-halo.webp'

/** How far the front figure sits from the card edge, and how much of the one
 *  behind it hides. Both were tuned against the approved prototype. */
const EDGE = 10
const OVERLAP = 0.55

/**
 * How far the glow spreads past the figures. Kept modest and faint: at 1.7 and
 * 40 % it read as a cyan blob beside the bodies rather than as light behind them,
 * and DT-009 reserves cyan for action and focus — it never decorates.
 */
const HALO_SCALE = 1.25

/**
 * The reflow when a row becomes the card. Built at module scope: an inline
 * builder is rebuilt on every render, and this one carries no per-item delay.
 */
const cardReflow = LinearTransition.duration(200)

/**
 * The press transition, passed in the style rather than through
 * `StyleSheet.create`, which rejects these properties. 3 % and 120 ms is the
 * ceiling for something touched as often as a row in this list.
 *
 * `ease-out` by name, not the parametrised curve: the style types accept only the
 * predefined keywords, and the stronger bezier is reachable only through
 * `css.create`, whose generic collides with this project's
 * `exactOptionalPropertyTypes`. Over 120 ms and 3 % the difference between the
 * two is not perceptible — where the curve does matter, the entrance below, it
 * gets the strong one.
 */
const PRESS_TRANSITION = {
  transitionProperty: 'transform',
  transitionDuration: cssDuration(PRESS_DURATION, false),
  transitionTimingFunction: 'ease-out',
} as const

/** Keeps the button off the very bottom edge, the same amount on every step. */
const FOOTER_LIFT = 16

const EXPIRED = 'Tu sesión venció. Vuelve a entrar para guardar tu respuesta.'
const UNREACHABLE = 'No pudimos guardar tu respuesta. Inténtalo otra vez.'

/**
 * Copy and artwork per goal. The icon names come from the design system, whose
 * catalogue owns what an icon means; the app never decides that.
 */
const GOALS: Record<
  TrainingGoal,
  {
    name: string
    why: string
    icon: 'weight' | 'training' | 'activity' | 'race' | 'heart'
    male: { before: number; after: number | null }
    female: { before: number; after: number | null }
  }
> = {
  lose_weight: {
    name: 'Bajar de peso',
    why: 'Reduce grasa corporal y mejora tu composición.',
    icon: 'weight',
    male: { before: loseWeightMaleBefore, after: loseWeightMaleAfter },
    female: { before: loseWeightFemaleBefore, after: loseWeightFemaleAfter },
  },
  build_muscle: {
    name: 'Construir músculo',
    why: 'Aumenta tu masa muscular y tu fuerza.',
    icon: 'training',
    male: { before: buildMuscleMaleBefore, after: buildMuscleMaleAfter },
    female: { before: buildMuscleFemaleBefore, after: buildMuscleFemaleAfter },
  },
  get_fit: {
    name: 'Ponerme en forma',
    why: 'Mejora tu condición física y energía diaria.',
    icon: 'activity',
    male: { before: getFitMaleBefore, after: getFitMaleAfter },
    female: { before: getFitFemaleBefore, after: getFitFemaleAfter },
  },
  run_a_race: {
    name: 'Correr una carrera',
    why: 'Prepárate para completar tu próxima carrera.',
    icon: 'race',
    male: { before: runARaceMaleBefore, after: runARaceMaleAfter },
    female: { before: runARaceFemaleBefore, after: runARaceFemaleAfter },
  },
  maintain: {
    name: 'Mantenerme',
    why: 'Mantén tu estado actual y hábitos saludables.',
    icon: 'heart',
    male: { before: maintainMaleSingle, after: null },
    female: { before: maintainFemaleSingle, after: null },
  },
}

export default function OnboardingTrainingGoal() {
  const router = useRouter()
  const theme = useTheme()
  const { height } = useWindowDimensions()
  const flow = useMemo(() => createSpaceOnboardingFlow(), [])

  const [rowWidth, setRowWidth] = useState(0)
  const [goal, setGoal] = useState<TrainingGoal | undefined>(undefined)
  const [declaredSex, setDeclaredSex] = useState<'male' | 'female' | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const reduceMotion = useReducedMotion()
  const [pressing, setPressing] = useState<TrainingGoal | undefined>(undefined)
  const [entering, setEntering] = useState(false)

  // Built outside the JSX: an inline chain rebuilds the builder on every render,
  // and a per-index delay cannot live at module scope.
  const entrances = useMemo(() => {
    const delays = staggerDelays(TRAINING_GOALS.length + 1, reduceMotion)
    return delays.map((delay) =>
      FadeInDown.duration(durationFor('fast', reduceMotion))
        .delay(delay)
        .easing(Easing.bezier(...easingFor('emphasized')).factory())
        .withInitialValues({ transform: [{ translateY: liftFor(reduceMotion) }] }),
    )
  }, [reduceMotion])

  const { cardWidth, cardHeight } = heroGeometry(rowWidth, height)

  useEffect(() => {
    let active = true

    flow
      .resume()
      .then((current) => {
        if (!active) return
        // Only backwards: a missing prerequisite cannot be skipped, but an answer
        // already given is editable, which is what the back arrow is for.
        const owed = guardStep('/onboarding/goal', current)
        if (owed) {
          router.replace(owed)
          return
        }
        setDeclaredSex(current.answers.biological_sex.value ?? null)
        const declared = current.answers.primary_training_goal.value
        if (declared) setGoal(declared)

        setEntering(shouldPlayEntrance(Boolean(declared)))
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof ApiError && cause.failure === 'unauthenticated') {
          setSessionExpired(true)
          setFailure(EXPIRED)
          return
        }
        setFailure(UNREACHABLE)
      })

    return () => {
      active = false
    }
  }, [flow, router])

  const pressable = !submitting && !sessionExpired
  const submittable = canSubmitGoal({ goal, submitting, sessionExpired })

  const submit = async () => {
    if (goal === undefined) return
    setSubmitting(true)
    setFailure(undefined)
    try {
      await flow.declareTrainingGoal(goal)
      router.replace(nextRouteAfter('/onboarding/goal'))
    } catch (cause: unknown) {
      if (cause instanceof ApiError && cause.failure === 'unauthenticated') {
        setSessionExpired(true)
        setFailure(EXPIRED)
      } else {
        setFailure(UNREACHABLE)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <AmbientBackdrop />
      <OnboardingHeader step="/onboarding/goal" />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View {...(entering && entrances[0] ? { entering: entrances[0] } : {})}>
          <Text role="display" size="4xl" uppercase accessibilityRole="header">
            ¿Qué quieres{'\n'}lograr?
          </Text>
          <Text role="body" size="md" color="secondary" style={styles.lede}>
            Elige uno. Es la dirección que toma tu entrenamiento, y puedes cambiarlo cuando quieras.
          </Text>
        </Animated.View>

        {/* Decoded on mount, not when a card opens. What made the photograph
            arrive late was the first render of the asset, and neither prefetch nor
            downloadAsync touches that — only having it already mounted does. Zero
            height so it costs nothing in layout, and never read by a screen
            reader. */}
        <View
          style={styles.preload}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {TRAINING_GOALS.flatMap((option) => {
            const art = GOALS[option][bodyVariant(declaredSex, option)]
            return [art.before, art.after]
              .filter(Boolean)
              .map((source, index) => (
                <Image
                  key={`${option}-${index}`}
                  source={source as number}
                  style={{ height: cardHeight, width: undefined, aspectRatio: 1 }}
                  accessible={false}
                />
              ))
          })}
        </View>

        <View onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}>
          {goalSlots(goal).map((slot, index) => {
            const entry = GOALS[slot.goal]
            // exactOptionalPropertyTypes rejects an explicit undefined, so the
            // props are spread in only when there is something to spread.
            const motionProps = {
              ...(entering && entrances[index + 1] ? { entering: entrances[index + 1] } : {}),
              ...(reduceMotion ? {} : { layout: cardReflow }),
            }
            const bodies = entry[bodyVariant(declaredSex, slot.goal)]

            // The card opens where the row was, so nothing below it moves.
            if (slot.expanded && cardWidth > 0) {
              const beforeAspect = figureAspect(bodies.before)
              const afterAspect = bodies.after ? figureAspect(bodies.after) : 0
              const figureHeight = bodies.after
                ? pairHeight(cardWidth, cardHeight, beforeAspect, afterAspect, OVERLAP, EDGE)
                : Math.min(cardHeight, (cardWidth * 0.34) / (beforeAspect || 1))
              const afterWidth = figureHeight * afterAspect
              const beforeWidth = figureHeight * beforeAspect

              return (
                <Animated.View key={slot.goal} {...motionProps} style={styles.slot}>
                  <View
                    accessible
                    accessibilityRole="radio"
                    accessibilityState={{ selected: true }}
                    accessibilityLabel={`${entry.name}. ${entry.why}`}
                    style={[
                      styles.hero,
                      {
                        width: cardWidth,
                        height: cardHeight,
                        borderColor: theme.color.border.accent,
                        backgroundColor: theme.color.background.surfaceSubtle,
                      },
                    ]}
                  >
                    {/* No radial gradient exists in React Native, so the glow is
                      an asset tinted with the accent token — the cyan differs
                      between themes and a baked one would be wrong on light. */}
                    <Image
                      source={halo}
                      style={[
                        styles.halo,
                        {
                          width: figureHeight * HALO_SCALE,
                          height: figureHeight * HALO_SCALE,
                          // Centred on the pair as a whole, by arithmetic: a
                          // percentage offset with a translate centres nothing in
                          // React Native, and centring it on the front figure alone
                          // pushed the glow out to one side of the group.
                          top: cardHeight - figureHeight / 2 - (figureHeight * HALO_SCALE) / 2,
                          right:
                            EDGE +
                            (afterWidth * OVERLAP + beforeWidth) / 2 -
                            (figureHeight * HALO_SCALE) / 2,
                          tintColor: theme.color.border.accent,
                        },
                      ]}
                      resizeMode="contain"
                      accessible={false}
                    />

                    {bodies.after ? (
                      <>
                        {/* Already softened in the artwork: React Native has no
                          blur filter, and opacity alone read as nothing. */}
                        <Image
                          source={bodies.before}
                          style={[
                            styles.figure,
                            styles.behind,
                            {
                              height: figureHeight,
                              width: beforeWidth,
                              right: EDGE + afterWidth * OVERLAP,
                            },
                          ]}
                          resizeMode="cover"
                          accessible={false}
                        />
                        <Image
                          source={bodies.after}
                          style={[
                            styles.figure,
                            { height: figureHeight, width: afterWidth, right: EDGE },
                          ]}
                          resizeMode="cover"
                          accessible={false}
                        />
                      </>
                    ) : (
                      <Image
                        source={bodies.before}
                        style={[
                          styles.figure,
                          { height: figureHeight, width: beforeWidth, right: EDGE * 4 },
                        ]}
                        resizeMode="cover"
                        accessible={false}
                      />
                    )}

                    <View style={styles.copy}>
                      <Text role="display" size="xl" uppercase>
                        {entry.name}
                      </Text>
                      <Text role="body" size="xs" color="secondary" style={styles.why}>
                        {entry.why}
                      </Text>
                    </View>

                    <View style={[styles.check, { backgroundColor: theme.color.border.accent }]}>
                      <FoundationIcon
                        name="check"
                        customSize={12}
                        strokeScale="compact"
                        color={theme.color.accent.onAccent}
                        decorative
                      />
                    </View>
                  </View>
                </Animated.View>
              )
            }

            return (
              <Animated.View key={slot.goal} {...motionProps} style={styles.slot}>
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected: false, disabled: !pressable }}
                  accessibilityLabel={`${entry.name}. ${entry.why}`}
                  disabled={!pressable}
                  onPress={() => setGoal(slot.goal)}
                  onPressIn={() => setPressing(slot.goal)}
                  onPressOut={() => setPressing(undefined)}
                  hitSlop={8}
                  pressRetentionOffset={16}
                >
                  <Animated.View
                    style={[
                      styles.row,
                      PRESS_TRANSITION,
                      { transform: [{ scale: pressing === slot.goal ? PRESS_SCALE : 1 }] },
                      {
                        borderColor: theme.color.border.subtle,
                        backgroundColor: theme.color.background.surfaceSubtle,
                      },
                    ]}
                  >
                    <View style={[styles.icon, { backgroundColor: theme.color.accent.tonal }]}>
                      <FoundationIcon
                        name={entry.icon}
                        size="sm"
                        color={theme.color.border.accent}
                        decorative
                      />
                    </View>
                    <View style={styles.rowText}>
                      <Text role="display" size="lg" uppercase>
                        {entry.name}
                      </Text>
                      <Text role="body" size="xs" color="muted" style={styles.why}>
                        {entry.why}
                      </Text>
                    </View>
                  </Animated.View>
                </Pressable>
              </Animated.View>
            )
          })}
        </View>
      </ScrollView>

      {/* Outside the scroll: expanding a row grows the list, and with the
          button inside it slid down on every selection, which read as the
          whole screen lurching. */}
      <View style={styles.footer}>
        {failure ? <InlineAlert message={failure} style={styles.alert} /> : null}

        <Button
          label="Continuar"
          disabled={!submittable}
          loading={submitting}
          onPress={submit}
          style={styles.cta}
        />

        {sessionExpired ? (
          <Button
            label="Iniciar sesión"
            variant="secondary"
            onPress={() => router.replace('/sign-in')}
            style={styles.signIn}
          />
        ) : null}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  lede: { marginTop: 9, marginBottom: 16 },
  // Both branches hang off an identical container so the reflow is the same
  // wherever the card opens. It clips, which is what makes the card reveal from
  // its top edge instead of the middle.
  slot: { overflow: 'hidden' },
  // Off-screen rather than zero-sized: the decoded bitmap is cached per size, so
  // mounting these at 2×2 would cache a 2×2 and decode again at the real size.
  preload: { position: 'absolute', left: -10000, top: 0, opacity: 0 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 4 },
  footer: { paddingTop: 4, paddingBottom: FOOTER_LIFT },
  hero: {
    borderWidth: 2,
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: CARD_GAP,
  },
  // Behind the figures and off to their side, so the glow reads as light on them
  // rather than as a shape of its own.
  halo: { position: 'absolute', opacity: 0.14 },
  // Anchored right in pixels, so the copy keeps the left of the card to itself.
  figure: { position: 'absolute', bottom: 0 },
  behind: { opacity: 0.75 },
  copy: { position: 'absolute', left: 16, bottom: 14, width: '42%' },
  why: { marginTop: 5 },
  check: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 10,
    borderWidth: 1.5,
    borderRadius: 14,
    marginBottom: 7,
  },
  icon: { width: 40, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0 },
  alert: { marginTop: 12 },
  cta: { marginTop: 10 },
  signIn: { marginTop: 10 },
})
