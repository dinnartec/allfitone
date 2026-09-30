/**
 * The rest between sets, counting down under the session (ADR-035, HU-SP-055 c12).
 *
 * **Anchored at the bottom, where the thumb already is.** Sums, rests and skips are made
 * between sets with the phone in one hand, so they live in the reach of that hand, and
 * the list above keeps scrolling while it counts.
 *
 * **The bar drains on the UI thread.** One timing from what is left to zero, restarted
 * whenever the rest changes, and drawn with `scaleX` so nothing re-lays-out per frame;
 * the number beside it is the screen's once-a-second render, which is all it needs.
 */

import { Button } from '@allfitone/react-native/button'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  FadeInDown,
  FadeOutDown,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'

import { countdownLabel, remaining, type Rest } from '../client/rest-timer'

const ENTER = FadeInDown.duration(220).reduceMotion(ReduceMotion.System)
const EXIT = FadeOutDown.duration(180).reduceMotion(ReduceMotion.System)

export function RestBar({
  rest,
  now,
  onAdjust,
  onSkip,
}: {
  /** Absent once it is over: the bar then says so, for the moment it stays. */
  readonly rest: Rest | undefined
  readonly now: number
  readonly onAdjust: (seconds: number) => void
  readonly onSkip: () => void
}) {
  const theme = useTheme()
  const fill = useSharedValue(1)
  const endsAt = rest?.endsAt
  const total = rest?.total

  useEffect(() => {
    if (endsAt === undefined || total === undefined || total <= 0) {
      fill.set(0)
      return
    }
    const left = Math.max(0, endsAt - Date.now())
    fill.set(left / (total * 1000))
    fill.set(withTiming(0, { duration: left, easing: Easing.linear }))
  }, [endsAt, total, fill])

  const drained = useAnimatedStyle(() => ({ transform: [{ scaleX: fill.get() }] }))

  const left = rest ? remaining(rest, now) : 0

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
      <View style={[styles.track, { backgroundColor: theme.color.background.surfaceSubtle }]}>
        <Animated.View
          style={[styles.fill, { backgroundColor: theme.color.icon.accent }, drained]}
        />
      </View>
      <View style={styles.row}>
        <View style={styles.reading}>
          <Text role="eyebrow" size="xs" color="muted">
            DESCANSO
          </Text>
          <Text
            role="data"
            size="2xl"
            color="accent"
            accessibilityLabel={rest ? `Quedan ${Math.ceil(left)} segundos` : 'Descanso terminado'}
          >
            {rest ? countdownLabel(left) : '¡A darle!'}
          </Text>
        </View>
        {rest ? (
          <View style={styles.actions}>
            <Button
              label="−15"
              variant="secondary"
              size="sm"
              accessibilityLabel="Quitar 15 segundos"
              onPress={() => onAdjust(-15)}
              style={styles.adjust}
            />
            <Button
              label="+15"
              variant="secondary"
              size="sm"
              accessibilityLabel="Sumar 15 segundos"
              onPress={() => onAdjust(15)}
              style={styles.adjust}
            />
            <Button label="Saltar" variant="ghost" size="sm" onPress={onSkip} />
          </View>
        ) : null}
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  bar: {
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 8,
    overflow: 'hidden',
  },
  // Drained from the right: the left edge is where it started, and it stays put.
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    borderRadius: 2,
    transformOrigin: 'left',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  reading: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  adjust: { minWidth: 52, paddingHorizontal: 0 },
})
