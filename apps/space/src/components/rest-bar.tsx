/**
 * The rest between sets, counting down under the session (ADR-035, HU-SP-055 c12).
 *
 * **A ring, because a rest is read at a glance from arm's length.** The time left sits in
 * the middle of a ring that drains as it goes; a number alone has to be read, a ring
 * that is nearly empty is seen. It is the one accent on the bar: the controls beside it
 * are neutral, because a bar full of cyan made everything on it shout at once.
 *
 * **It drains on the UI thread.** One linear timing from what is left to zero, restarted
 * whenever the rest changes, drives the ring's dash; the number is the screen's
 * once-a-second render, which is all a number needs.
 *
 * **Three moments, one place.** Counting down, which inside a superset also says the
 * chain's next exercise; the handoff of a chain set to «Ninguno», which only says it;
 * and the end, when the ring fills green with a tick. The bar is where the eye already
 * goes between sets, so it says all three.
 *
 * **The middle of a rest has some personality.** The line says what comes next at the
 * start and the end, and a short phrase in between (`rest-lines`), crossfading.
 *
 * **The last seconds are felt, not only seen.** The number pulses once a second for the
 * final five, which is what makes somebody pick the bar up again mid-sip.
 */

import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { useEffect } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  FadeInDown,
  FadeOutUp,
  FadeOutDown,
  ReduceMotion,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Circle } from 'react-native-svg'

import { restLine, type RestLine } from '../client/rest-lines'
import { countdownLabel, remaining, type Rest } from '../client/rest-timer'

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1)
const ENTER = FadeInDown.duration(260).easing(EASE_OUT).reduceMotion(ReduceMotion.System)
const EXIT = FadeOutDown.duration(180).reduceMotion(ReduceMotion.System)
/**
 * A roll, not a swap: the old line rises away as the new one comes up from below, a beat
 * behind it, so the eye follows one movement instead of seeing a blink.
 */
const SWAP_IN = FadeInDown.duration(420)
  .delay(60)
  .easing(EASE_OUT)
  .withInitialValues({ opacity: 0, transform: [{ translateY: 10 }] })
  .reduceMotion(ReduceMotion.System)
const SWAP_OUT = FadeOutUp.duration(240).easing(EASE_OUT).reduceMotion(ReduceMotion.System)

const RING = 64
const STROKE = 5
const RADIUS = (RING - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** From here down, every second pulses. */
const FINAL_SECONDS = 5

const AnimatedCircle = Animated.createAnimatedComponent(Circle)

export type RestMoment =
  | {
      readonly kind: 'rest'
      readonly rest: Rest
      readonly movement: string
      readonly chained: boolean
    }
  | { readonly kind: 'done'; readonly next: string }
  | { readonly kind: 'chain'; readonly next: string }

export function RestBar({
  moment,
  now,
  onAdjust,
  onSkip,
}: {
  readonly moment: RestMoment
  readonly now: number
  readonly onAdjust: (seconds: number) => void
  readonly onSkip: () => void
}) {
  const theme = useTheme()
  const reduced = useReducedMotion()
  const fill = useSharedValue(1)
  const pulse = useSharedValue(1)

  const rest = moment.kind === 'rest' ? moment.rest : undefined
  const endsAt = rest?.endsAt
  const total = rest?.total
  const left = rest ? remaining(rest, now) : 0
  const whole = Math.ceil(left)

  useEffect(() => {
    if (endsAt === undefined || total === undefined || total <= 0) {
      fill.set(1)
      return
    }
    const ahead = Math.max(0, endsAt - Date.now())
    fill.set(ahead / (total * 1000))
    fill.set(withTiming(0, { duration: ahead, easing: Easing.linear }))
  }, [endsAt, total, fill])

  useEffect(() => {
    if (reduced || moment.kind !== 'rest' || whole > FINAL_SECONDS || whole <= 0) return
    pulse.set(withSequence(withTiming(1.18, { duration: 120 }), withTiming(1, { duration: 260 })))
  }, [whole, moment.kind, reduced, pulse])

  const dash = useAnimatedProps(() => ({ strokeDashoffset: CIRCUMFERENCE * (1 - fill.get()) }))
  const beat = useAnimatedStyle(() => ({ transform: [{ scale: pulse.get() }] }))

  const ringColor = moment.kind === 'done' ? theme.color.status.success : theme.color.icon.accent
  // Mid-superset it says the chain's next exercise the whole time it counts.
  const chained = moment.kind === 'chain' || (moment.kind === 'rest' && moment.chained)
  const next = moment.kind === 'rest' ? moment.movement : moment.next
  const eyebrow =
    moment.kind === 'done' ? '¡A DARLE!' : chained ? 'SUPERSERIE · DESCANSO' : 'DESCANSO'
  const line = !next ? '' : chained ? `Ahora: ${next}` : `Sigue con ${next}`
  // While it counts, the long middle says something with some personality (rest-lines).
  const shown: RestLine = rest ? restLine(rest, now, line) : { kind: 'next', text: line }

  return (
    <Animated.View
      entering={ENTER}
      exiting={EXIT}
      accessibilityLiveRegion="polite"
      style={[
        styles.bar,
        {
          backgroundColor: theme.color.background.surface,
          borderColor: theme.color.border.subtle,
        },
      ]}
    >
      <View
        style={styles.ring}
        accessible
        accessibilityLabel={
          moment.kind === 'rest' ? `Quedan ${whole} segundos de descanso` : line || eyebrow
        }
      >
        <Svg width={RING} height={RING} style={styles.svg}>
          <Circle
            cx={RING / 2}
            cy={RING / 2}
            r={RADIUS}
            stroke={theme.color.background.surfaceSubtle}
            strokeWidth={STROKE}
            fill="none"
          />
          <AnimatedCircle
            cx={RING / 2}
            cy={RING / 2}
            r={RADIUS}
            stroke={ringColor}
            strokeWidth={STROKE}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={CIRCUMFERENCE}
            animatedProps={dash}
            // Drains from twelve o'clock, the way a clock face does.
            transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
          />
        </Svg>
        {moment.kind === 'rest' ? (
          <Animated.View style={beat}>
            <Text role="data" size="lg" accessible={false}>
              {countdownLabel(left)}
            </Text>
          </Animated.View>
        ) : (
          <FoundationIcon
            name={moment.kind === 'done' ? 'check' : 'next'}
            size="md"
            color={ringColor}
            decorative
          />
        )}
      </View>

      <View style={styles.body}>
        <View style={styles.words}>
          <Text role="eyebrow" size="xs" color="muted">
            {eyebrow}
          </Text>
          {/* Keyed by what it says; both lines share one fixed slot while they cross, so
              the bar never grows by a line mid-change. */}
          {shown.text ? (
            <View style={styles.slot}>
              <Animated.View
                key={shown.text}
                entering={SWAP_IN}
                exiting={SWAP_OUT}
                style={styles.line}
              >
                <Text
                  role={shown.kind === 'phrase' ? 'body' : 'control'}
                  size="sm"
                  color={shown.kind === 'phrase' ? 'secondary' : 'primary'}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}
                >
                  {shown.text}
                </Text>
              </Animated.View>
            </View>
          ) : null}
        </View>
        {moment.kind === 'rest' ? (
          <View style={styles.actions}>
            <Nudge label="−15" hint="Quitar 15 segundos" onPress={() => onAdjust(-15)} />
            <Nudge label="+15" hint="Sumar 15 segundos" onPress={() => onAdjust(15)} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Saltar el descanso"
              onPress={onSkip}
              hitSlop={8}
              style={({ pressed }) => [styles.skip, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text role="control" size="sm" color="secondary">
                Saltar
              </Text>
              <FoundationIcon
                name="forward"
                customSize={14}
                color={theme.color.icon.secondary}
                decorative
              />
            </Pressable>
          </View>
        ) : null}
      </View>
    </Animated.View>
  )
}

/** A neutral pill: the ring is the accent, and two cyan buttons beside it would compete. */
function Nudge({
  label,
  hint,
  onPress,
}: {
  readonly label: string
  readonly hint: string
  readonly onPress: () => void
}) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hint}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.nudge,
        {
          backgroundColor: theme.color.background.surfaceSubtle,
          transform: [{ scale: pressed ? 0.94 : 1 }],
        },
      ]}
    >
      <Text role="control" size="sm">
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  ring: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  svg: { position: 'absolute' },
  body: { flex: 1, gap: 8 },
  words: { gap: 2 },
  slot: { height: 22, overflow: 'hidden' },
  line: { position: 'absolute', left: 0, right: 0, top: 0 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nudge: {
    minWidth: 56,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  skip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 36,
    paddingHorizontal: 8,
    marginLeft: 'auto',
  },
})
