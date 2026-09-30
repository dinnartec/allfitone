/**
 * The session's scoreboard: the clock first, the rest beside it (prototipo 48, «A»).
 *
 * **The clock leads because it is read from a metre away.** Three equal cells made time,
 * volume and sets shout at the same size, and nothing was read first. Now the clock is
 * the large figure, its seconds set aside in grey; volume and sets are compact on the
 * right, where they are glanced at rather than read.
 *
 * **Sets as a bar, not as dots.** One dot per set was legible at twelve and a smear at
 * thirty, and a session can grow while it runs; a continuous bar reads the same at any
 * count. It fills with the success colour on the UI thread, by `scaleX`, so ticking a
 * set never re-lays anything out.
 *
 * **The live dot is the only thing that moves on its own.** It says the session is
 * running while minimised views look alike; reduced motion keeps it, still.
 */

import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

import { clockParts } from '../client/session-form'

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1)

export function SessionScoreboard({
  seconds,
  volumeKg,
  done,
  planned,
}: {
  readonly seconds: number
  readonly volumeKg: number
  readonly done: number
  readonly planned: number
}) {
  const theme = useTheme()
  const reduced = useReducedMotion()
  const clock = clockParts(seconds)
  const share = planned > 0 ? Math.min(1, done / planned) : 0

  const fill = useSharedValue(share)
  useEffect(() => {
    fill.set(reduced ? share : withTiming(share, { duration: 420, easing: EASE_OUT }))
  }, [share, reduced, fill])
  const filled = useAnimatedStyle(() => ({ transform: [{ scaleX: fill.get() }] }))

  const ripple = useSharedValue(0)
  useEffect(() => {
    if (reduced) return
    ripple.set(withRepeat(withTiming(1, { duration: 1800, easing: EASE_OUT }), -1, false))
  }, [reduced, ripple])
  const halo = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - ripple.get()),
    transform: [{ scale: 1 + ripple.get() * 1.6 }],
  }))

  return (
    <View
      style={[styles.board, { borderBottomColor: theme.color.border.subtle }]}
      accessible
      accessibilityLabel={`En curso, ${clock.lead}${clock.tail}. ${Math.round(volumeKg)} kilos. ${done} de ${planned} series`}
    >
      <View style={styles.clock}>
        <View style={styles.live}>
          <View style={styles.dotWrap}>
            <Animated.View
              style={[styles.dot, styles.halo, { backgroundColor: theme.color.icon.accent }, halo]}
            />
            <View style={[styles.dot, { backgroundColor: theme.color.icon.accent }]} />
          </View>
          <Text role="eyebrow" size="xs" color="accent">
            EN CURSO
          </Text>
        </View>
        <View style={styles.time}>
          <Text role="data" size="5xl">
            {clock.lead}
          </Text>
          {clock.tail ? (
            <Text role="data" size="2xl" color="muted" style={styles.tail}>
              {clock.tail}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.side}>
        <View style={styles.figure}>
          <View style={styles.amount}>
            <Text role="data" size="xl">
              {Math.round(volumeKg).toLocaleString('es-CO')}
            </Text>
            <Text role="control" size="xs" color="muted">
              kg
            </Text>
          </View>
          <Text role="eyebrow" size="xs" color="muted">
            VOLUMEN
          </Text>
        </View>
        <View style={styles.figure}>
          <View style={[styles.track, { backgroundColor: theme.color.background.surfaceSubtle }]}>
            <Animated.View
              style={[styles.bar, { backgroundColor: theme.color.status.success }, filled]}
            />
          </View>
          <Text role="eyebrow" size="xs" color="muted">
            {`${done} DE ${planned} SERIES`}
          </Text>
        </View>
      </View>
    </View>
  )
}

const DOT = 7

const styles = StyleSheet.create({
  board: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 16,
    marginTop: 14,
    paddingHorizontal: 4,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  clock: { gap: 2 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dotWrap: { width: DOT, height: DOT },
  dot: { position: 'absolute', width: DOT, height: DOT, borderRadius: DOT / 2 },
  halo: { opacity: 0 },
  time: { flexDirection: 'row', alignItems: 'baseline' },
  tail: { marginLeft: 1 },
  side: { width: 132, gap: 10, paddingBottom: 6 },
  figure: { alignItems: 'flex-end', gap: 4 },
  amount: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  track: { alignSelf: 'stretch', height: 5, borderRadius: 3, overflow: 'hidden' },
  // Grows from the left edge, where the first set is.
  bar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    borderRadius: 3,
    transformOrigin: 'left',
  },
})
