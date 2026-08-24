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
  LinearTransition,
  useReducedMotion,
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

/** The reflow when a card reveals its consequence, built once at module scope. */
const cardReflow = LinearTransition.duration(200)

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
  const theme = useTheme()
  const flow = useMemo(() => createSpaceOnboardingFlow(), [])

  const [level, setLevel] = useState<TrainingExperience | undefined>(undefined)
  const [submitting, setSubmitting] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [pressing, setPressing] = useState<TrainingExperience | undefined>(undefined)
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

        {EXPERIENCE_LEVELS.map((entry, index) => {
          const chosen = entry.level === level
          // exactOptionalPropertyTypes rejects an explicit undefined, so the props
          // are spread in only when there is something to spread.
          const motionProps = {
            ...(entering && entrances[index + 1] ? { entering: entrances[index + 1] } : {}),
            ...(reduceMotion ? {} : { layout: cardReflow }),
          }

          return (
            <Animated.View key={entry.level} {...motionProps} style={styles.slot}>
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected: chosen, disabled: !pressable }}
                // The consequence is part of the answer, so a screen reader hears it
                // on the card that carries it rather than only seeing it.
                accessibilityLabel={
                  chosen
                    ? `${entry.name}. ${entry.description} ${entry.outcome.before}${entry.outcome.emphasis}${entry.outcome.after}`
                    : `${entry.name}. ${entry.description}`
                }
                disabled={!pressable}
                onPress={() => setLevel((current) => chooseLevel(current, entry.level))}
                onPressIn={() => setPressing(entry.level)}
                onPressOut={() => setPressing(undefined)}
                hitSlop={8}
                pressRetentionOffset={16}
              >
                <Animated.View
                  style={[
                    styles.card,
                    PRESS_TRANSITION,
                    { transform: [{ scale: pressing === entry.level ? PRESS_SCALE : 1 }] },
                    {
                      borderColor: chosen ? theme.color.border.accent : theme.color.border.subtle,
                      backgroundColor: chosen
                        ? theme.color.accent.tonal
                        : theme.color.background.surfaceSubtle,
                    },
                  ]}
                >
                  <View style={styles.head}>
                    <Text role="display" size="lg" uppercase color={chosen ? 'accent' : 'primary'}>
                      {entry.name}
                    </Text>
                    {/* Never colour alone: the bars carry the rank, the border and
                        the tonal fill carry the selection, and the state is
                        announced. That is DT-010 and it is what the other steps do. */}
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
                            {
                              backgroundColor: filled
                                ? theme.color.border.accent
                                : theme.color.border.default,
                            },
                          ]}
                        />
                      ))}
                    </View>
                  </View>

                  <Text role="body" size="xs" color="muted" style={styles.description}>
                    {entry.description}
                  </Text>

                  {chosen ? (
                    <View
                      style={[styles.outcome, { borderTopColor: theme.color.border.subtle }]}
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    >
                      <Text role="body" size="sm" color="secondary">
                        {entry.outcome.before}
                        <Text role="body" size="sm" color="accent">
                          {entry.outcome.emphasis}
                        </Text>
                        {entry.outcome.after}
                      </Text>
                    </View>
                  ) : null}
                </Animated.View>
              </Pressable>
            </Animated.View>
          )
        })}

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
  outcome: { marginTop: 11, paddingTop: 10, borderTopWidth: 1 },
  notice: { marginTop: 5 },
  footer: { paddingTop: 4, paddingBottom: FOOTER_LIFT },
  alert: { marginTop: 12 },
  cta: { marginTop: 10 },
  signIn: { marginTop: 10 },
})
