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
import { Pressable, StyleSheet, View } from 'react-native'

import { stepPosition, type OnboardingStepRoute } from '../client/onboarding-steps'

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
  const { total, completed, previous } = stepPosition(step)

  return (
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
              style={[
                styles.segment,
                {
                  backgroundColor:
                    done || current ? theme.color.border.accent : theme.color.border.subtle,
                  opacity: current && !done ? CURRENT_SEGMENT_OPACITY : 1,
                },
              ]}
            />
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44 },
  back: { width: 28, height: 44, alignItems: 'flex-start', justifyContent: 'center' },
  bar: { flex: 1, flexDirection: 'row', gap: 6 },
  segment: { flex: 1, height: 3, borderRadius: 999 },
})
