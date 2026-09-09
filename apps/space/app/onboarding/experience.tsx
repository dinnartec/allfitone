/**
 * How much have you trained — HU-SP-012, criterion 2.
 *
 * Three levels, and the bars are the only thing that says which is which. The words
 * deliberately avoid `principiante`, `intermedio`, `avanzado`: HU-SP-012 asks for
 * simple terms, and the reason is behavioural rather than stylistic — "advanced"
 * makes people underrate themselves, pick below their real level, and get a plan
 * that bores them until they leave. So the scale is drawn and never named.
 *
 * The chosen card says **what changes in the plan**. A card that only highlights
 * itself asks somebody to guess what they are choosing; naming the consequence is
 * what lets them answer honestly instead of modestly, which is the entire point of
 * the level. It reveals in place, like the goal screen's card, so nothing below it
 * jumps away from the finger that just tapped.
 *
 * The notice under the cards is **fixed, not revealed**. Someone afraid of being
 * mislabelled has to read that the loads move from the first week *before* they
 * answer; showing it only after a selection would be showing it once it no longer
 * helps them choose.
 *
 * Re-tapping the chosen level leaves it chosen. "No level" is not an answer this
 * question offers — unlike the biological sex, where declining means something. But
 * nothing arrives selected either: a default would write a declaration nobody made.
 *
 * One global level, not one per discipline. The criterion read "in each one", and
 * that was amended: the discipline catalogue holds no production rows and is not
 * readable by the runtime role at all, so there is nothing to hang a per-discipline
 * level on. Were it to become readable, that is a new attribute rather than a wider
 * version of this one.
 *
 * The consequence copy is **not validated**. "Medium volume" and "progressions from
 * the first week" describe what the plan will do, and nothing consumes an experience
 * level today, so they state an intention. Recorded as pending confirmation in
 * `allfitone-docs`; the alternative was to let it look settled because it is written
 * in code.
 */

import { AmbientBackdrop } from '@allfitone/react-native/backdrop'
import { Button } from '@allfitone/react-native/button'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  FadeInDown,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'

import { OnboardingHeader } from '../../src/components/onboarding-header'
import {
  cssDuration,
  durationFor,
  easingFor,
  liftFor,
  PRESS_DURATION,
  PRESS_SCALE,
  shouldPlayEntrance,
  SPRING,
  staggerDelays,
} from '../../src/client/motion'
import { ApiError } from '../../src/client'
import { createSpaceOnboardingFlow } from '../../src/client/onboarding-transport'
import { guardStep, nextRouteAfter } from '../../src/client/onboarding-steps'
import {
  barsFor,
  canSubmitExperience,
  chooseLevel,
  EXPERIENCE_LEVELS,
  NOT_A_LABEL_BODY,
  NOT_A_LABEL_TITLE,
  readLevel,
  type TrainingExperience,
} from '../../src/client/experience-form'

const PRESS_TRANSITION = {
  transitionProperty: 'transform',
  transitionDuration: cssDuration(PRESS_DURATION, false),
  transitionTimingFunction: 'ease-out',
} as const

/** Keeps the button off the very bottom edge, the same amount on every step. */
const FOOTER_LIFT = 16

const EXPIRED = 'Tu sesión venció. Vuelve a entrar para guardar tu respuesta.'
const READ_FAILED = 'No pudimos leer tus respuestas. Inténtalo otra vez.'
const SAVE_FAILED = 'No pudimos guardar tu respuesta. Inténtalo otra vez.'

export default function OnboardingExperience() {
  const router = useRouter()
  const flow = useMemo(() => createSpaceOnboardingFlow(), [])

  const [level, setLevel] = useState<TrainingExperience | undefined>(undefined)
  const [submitting, setSubmitting] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [entering, setEntering] = useState(false)
  const reduceMotion = useReducedMotion()

  // Built outside the JSX: an inline chain rebuilds the builder on every render,
  // and a per-index delay cannot live at module scope.
  const entrances = useMemo(() => {
    const delays = staggerDelays(EXPERIENCE_LEVELS.length + 2, reduceMotion)
    return delays.map((delay) =>
      FadeInDown.duration(durationFor('fast', reduceMotion))
        .delay(delay)
        .easing(Easing.bezier(...easingFor('emphasized')).factory())
        .withInitialValues({ transform: [{ translateY: liftFor(reduceMotion) }] }),
    )
  }, [reduceMotion])

  useEffect(() => {
    let active = true

    flow
      .resume()
      .then((current) => {
        if (!active) return
        // Only backwards: a missing prerequisite cannot be skipped, but an answer
        // already given is editable, which is what the back arrow is for.
        const owed = guardStep('/onboarding/experience', current)
        if (owed) {
          router.replace(owed)
          return
        }
        const declared = readLevel(current.answers.training_experience.value)
        if (declared) setLevel(declared)

        setEntering(shouldPlayEntrance(Boolean(declared)))
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof ApiError && cause.failure === 'unauthenticated') {
          setSessionExpired(true)
          setFailure(EXPIRED)
          return
        }
        setFailure(READ_FAILED)
      })

    return () => {
      active = false
    }
  }, [flow, router])

  const pressable = !submitting && !sessionExpired
  const submittable = canSubmitExperience({ level, submitting, sessionExpired })

  const submit = async () => {
    if (level === undefined) return
    setSubmitting(true)
    setFailure(undefined)
    try {
      await flow.declareTrainingExperience(level)
      router.replace(nextRouteAfter('/onboarding/experience'))
    } catch (cause: unknown) {
      if (cause instanceof ApiError && cause.failure === 'unauthenticated') {
        setSessionExpired(true)
        setFailure(EXPIRED)
      } else {
        setFailure(SAVE_FAILED)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <AmbientBackdrop />
      <OnboardingHeader step="/onboarding/experience" />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View {...(entering && entrances[0] ? { entering: entrances[0] } : {})}>
          <Text role="display" size="4xl" uppercase accessibilityRole="header">
            ¿Cuánto has{'\n'}entrenado?
          </Text>
          <Text role="body" size="md" color="secondary" style={styles.lede}>
            Para no tratarte como principiante si no lo eres, ni al revés.
          </Text>
        </Animated.View>

        {EXPERIENCE_LEVELS.map((entry, index) => (
          <ExperienceCard
            key={entry.level}
            entry={entry}
            chosen={entry.level === level}
            pressable={pressable}
            reduceMotion={reduceMotion}
            onPress={() => setLevel((current) => chooseLevel(current, entry.level))}
            {...(entering && entrances[index + 1] ? { entering: entrances[index + 1] } : {})}
          />
        ))}

        {/* Fixed rather than revealed: it is what someone worried about being
            labelled needs before answering, not after. */}
        <Animated.View
          {...(entering && entrances[EXPERIENCE_LEVELS.length + 1]
            ? { entering: entrances[EXPERIENCE_LEVELS.length + 1] }
            : {})}
          style={styles.notice}
        >
          <Text role="body" size="xs" color="muted">
            <Text role="body" size="xs" color="secondary">
              {NOT_A_LABEL_TITLE}
            </Text>
            {NOT_A_LABEL_BODY}
          </Text>
        </Animated.View>
      </ScrollView>

      {/* Outside the scroll so the button sits in the same place on every step of
          the onboarding, whatever the content above it does. */}
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

/**
 * One level, chosen or not, and every state in between.
 *
 * The same shape as the session screen's `Exercise` and for the same reason: the
 * consequence used to be `chosen ? <View/> : null`, so it appeared and vanished in a
 * frame while a `LinearTransition` slid the cards below it. Now it never unmounts —
 * a clipping drawer animates between zero and the height the content reports, and
 * everything else the selection changes rides the same spring.
 *
 * The name is two copies stacked rather than one whose colour animates: the Design
 * System's `Text` is a plain function component, so wrapping it in an animated one
 * has no ref to drive on the UI thread. Both copies carry the same word in the same
 * place, so the cross-fade is invisible — which is exactly what is wanted here, and
 * the opposite of the goal screen, where the two faces sit apart and the handover
 * had to be staged.
 */
function ExperienceCard({
  entry,
  chosen,
  pressable,
  reduceMotion,
  onPress,
  entering,
}: {
  readonly entry: (typeof EXPERIENCE_LEVELS)[number]
  readonly chosen: boolean
  readonly pressable: boolean
  readonly reduceMotion: boolean
  readonly onPress: () => void
  readonly entering?: FadeInDown
}) {
  const theme = useTheme()
  const progress = useSharedValue(chosen ? 1 : 0)
  const outcomeHeight = useSharedValue(0)
  const [pressing, setPressing] = useState(false)

  useEffect(() => {
    // Reduced motion keeps the change and drops the travel: which level is chosen is
    // state the card exists to report, so the consequence still opens — it just does
    // not slide.
    const target = chosen ? 1 : 0
    progress.value = reduceMotion ? target : withSpring(target, SPRING)
  }, [chosen, progress, reduceMotion])

  const subtle = theme.color.border.subtle
  const accent = theme.color.border.accent
  const resting = theme.color.background.surfaceSubtle
  const tonal = theme.color.accent.tonal

  const shell = useAnimatedStyle(() => ({
    borderColor: interpolateColor(progress.value, [0, 1], [subtle, accent]),
    backgroundColor: interpolateColor(progress.value, [0, 1], [resting, tonal]),
  }))

  const quiet = useAnimatedStyle(() => ({ opacity: 1 - progress.value }))
  const loud = useAnimatedStyle(() => ({ opacity: progress.value }))

  const drawer = useAnimatedStyle(() => ({
    // Always a number. Falling back to `undefined` while the height is unknown lets a
    // shut drawer take its natural height for a frame.
    height: outcomeHeight.value * progress.value,
  }))

  // The consequence slides out from under the description on the same spring that
  // opens the clip, so it reads as a drawer rather than as a box being resized.
  const contents = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (progress.value - 1) * outcomeHeight.value }],
  }))

  return (
    <Animated.View style={styles.slot} {...(entering ? { entering } : {})}>
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ selected: chosen, disabled: !pressable }}
        // The consequence is part of the answer, so a screen reader hears it on the
        // card that carries it rather than only seeing it.
        accessibilityLabel={
          chosen
            ? `${entry.name}. ${entry.description} ${entry.outcome.before}${entry.outcome.emphasis}${entry.outcome.after}`
            : `${entry.name}. ${entry.description}`
        }
        disabled={!pressable}
        onPress={onPress}
        onPressIn={() => setPressing(true)}
        onPressOut={() => setPressing(false)}
        hitSlop={8}
        pressRetentionOffset={16}
      >
        <Animated.View
          style={[
            styles.card,
            shell,
            PRESS_TRANSITION,
            { transform: [{ scale: pressing ? PRESS_SCALE : 1 }] },
          ]}
        >
          <View style={styles.head}>
            <View>
              <Animated.View style={quiet}>
                <Text role="display" size="lg" uppercase>
                  {entry.name}
                </Text>
              </Animated.View>
              <Animated.View style={[styles.nameOver, loud]} pointerEvents="none">
                <Text role="display" size="lg" uppercase color="accent">
                  {entry.name}
                </Text>
              </Animated.View>
            </View>

            {/* Never colour alone: the bars carry the rank, the border and the tonal
                fill carry the selection, and the state is announced. That is DT-010
                and it is what the other steps do. */}
            <View
              style={styles.bars}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {barsFor(entry.level).map((filled, bar) => (
                <View
                  key={bar}
                  style={[
                    styles.bar,
                    { backgroundColor: filled ? accent : theme.color.border.default },
                  ]}
                />
              ))}
            </View>
          </View>

          <Text role="body" size="xs" color="muted" style={styles.description}>
            {entry.description}
          </Text>

          <Animated.View style={[styles.drawer, drawer]}>
            {/* Out of flow, so it can never add its height to the card it is
                measuring. In flow it did, and a shut card briefly claimed the space
                it would take if it were open. */}
            <Animated.View
              style={[styles.measure, contents]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              onLayout={(event) => {
                const measured = event.nativeEvent.layout.height
                if (measured > 0) outcomeHeight.value = measured
              }}
            >
              <View style={[styles.outcome, { borderTopColor: subtle }]}>
                <Text role="body" size="sm" color="secondary">
                  {entry.outcome.before}
                  <Text role="body" size="sm" color="accent">
                    {entry.outcome.emphasis}
                  </Text>
                  {entry.outcome.after}
                </Text>
              </View>
            </Animated.View>
          </Animated.View>
        </Animated.View>
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 4 },
  lede: { marginTop: 9, marginBottom: 16 },
  // Clips, so the consequence reveals from the card's own edge rather than the
  // middle. The same container wraps every card, chosen or not, so the reflow does
  // not depend on which one opened.
  slot: { overflow: 'hidden' },
  card: {
    padding: 14,
    borderWidth: 1.5,
    borderRadius: 16,
    marginBottom: 9,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  bar: { width: 14, height: 6, borderRadius: 3 },
  description: { marginTop: 7 },
  // The name in the accent, laid exactly over the resting one so the cross-fade has
  // nowhere to drift to.
  nameOver: { position: 'absolute', left: 0, top: 0 },
  drawer: { overflow: 'hidden' },
  measure: { position: 'absolute', left: 0, right: 0, top: 0 },
  outcome: { marginTop: 11, paddingTop: 10, borderTopWidth: 1 },
  notice: { marginTop: 5 },
  footer: { paddingTop: 4, paddingBottom: FOOTER_LIFT },
  alert: { marginTop: 12 },
  cta: { marginTop: 10 },
  signIn: { marginTop: 10 },
})
