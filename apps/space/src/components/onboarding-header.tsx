/**
 * The onboarding header: where you are, and the way back.
 *
 * One component for every step rather than a copy per screen, because the bar has
 * to agree with the router about the order and a copy would drift on the first
 * screen inserted. Both read `ONBOARDING_STEPS`.
 *
 * The bar shows one segment per declared step, so it grows on its own as screens
 * are added. Completed steps are lit; the current one is lit at reduced strength.
 * That last part is a deliberate departure from `prototipos/11-sexo-elegida.html`,
 * which lights only what is behind you: on the very first step that leaves an
 * entirely dim bar, which reads as broken rather than as "not started".
 *
 * No back arrow where there is nothing revisitable behind: the first step, and the
 * identity step, whose only predecessor is the adult declaration. The bar then takes
 * the full width rather than sitting indented against an arrow that is not there.
 *
 * It is pinned above the scrolling content on purpose. Placed inside it, the age
 * screen — which centres its content vertically — pushed the bar to the middle of
 * the screen.
 *
 * On the first step only, a gym whose invitation is waiting says so (INV-2): she
 * finishes her own profile first, and decides on the gym at the end.
 *
 * **Going back edits.** The two commands behind these screens used to refuse a
 * second write, which would have put this arrow in front of a request that always
 * failed; they now correct instead. The adult declaration is the exception and the
 * reason it has no arrow: it is the evidence that gated creating the person, and
 * retracting it would leave a Fitness ID standing on a declaration that no longer
 * does.
 */

import { FoundationIcon } from '@allfitone/react-native/icons'
import { useTheme } from '@allfitone/react-native/theme'
import { useRouter } from 'expo-router'
import { useEffect } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'

import { durationFor, easingFor } from '../client/motion'
import { stepPosition, type OnboardingStepRoute } from '../client/onboarding-steps'
import { WaitingGym } from './gym-ui'

const CURRENT_SEGMENT_OPACITY = 0.6

export interface OnboardingHeaderProps {
  /** The step being shown, which is what the bar and the arrow are derived from. */
  readonly step: OnboardingStepRoute
}

/**
 * The arrow on its own, for screens that are not steps and so carry no bar.
 * Exported rather than copied: two arrows would drift in size and hit area.
 */
export function OnboardingBack({ to }: { readonly to: OnboardingStepRoute }) {
  const theme = useTheme()
  const router = useRouter()

  return (
    <Pressable
      onPress={() => router.replace(to)}
      accessibilityRole="button"
      accessibilityLabel="Volver al paso anterior"
      hitSlop={12}
      style={styles.back}
    >
      <FoundationIcon name="back" size="lg" color={theme.color.icon.primary} decorative />
    </Pressable>
  )
}

export function OnboardingHeader({ step }: OnboardingHeaderProps) {
  const theme = useTheme()
  const reduceMotion = useReducedMotion()
  const { total, completed, previous } = stepPosition(step)
  const grown = useSharedValue(0)

  // The step you are on fills in rather than appearing lit. Keyed to which segment
  // that is, not to mount, so it fills again when the person moves.
  useEffect(() => {
    grown.set(0)
    grown.set(
      withTiming(1, {
        duration: durationFor('normal', reduceMotion),
        easing: Easing.bezier(...easingFor('emphasized')),
      }),
    )
  }, [completed, grown, reduceMotion])

  // The sanctioned width animation: the fill is absolutely positioned with no
  // children, so nothing else re-lays-out, and its corner radius survives —
  // scaleX would smear those rounded ends into ovals.
  const fillStyle = useAnimatedStyle(() => ({ width: `${grown.get() * 100}%` }))

  return (
    <View style={styles.header}>
      <View style={styles.row}>
        {previous ? <OnboardingBack to={previous} /> : null}

        <View
          style={styles.bar}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 1, max: total, now: completed + 1 }}
        >
          {Array.from({ length: total }, (_, index) => {
            const done = index < completed
            const current = index === completed
            return (
              <View
                key={index}
                style={[styles.segment, { backgroundColor: theme.color.border.subtle }]}
              >
                {done || current ? (
                  <Animated.View
                    style={[
                      styles.fill,
                      {
                        backgroundColor: theme.color.border.accent,
                        opacity: current && !done ? CURRENT_SEGMENT_OPACITY : 1,
                      },
                      index === completed ? fillStyle : styles.filled,
                    ]}
                  />
                ) : null}
              </View>
            )
          })}
        </View>
      </View>
      {completed === 0 ? <WaitingGym /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  header: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44 },
  back: { width: 28, height: 44, alignItems: 'flex-start', justifyContent: 'center' },
  bar: { flex: 1, flexDirection: 'row', gap: 6 },
  segment: { flex: 1, height: 3, borderRadius: 999, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 999 },
  filled: { width: '100%' },
})
