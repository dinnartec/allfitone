/**
 * The energy goal on a track: one handle for an exact figure, two for a range (N-6f).
 *
 * Typing reaches any figure; the track is for feeling where it sits — 2.100 is a little
 * under the middle of 1.500–3.000 — and for nudging it without the keyboard. The handles
 * move on the UI thread and the figure above follows them a step at a time, with a tick
 * of haptics per step, so dragging never renders per frame.
 *
 * **The scale does not move under the handle.** It is fixed (see `energyScale`) and only
 * widens for a figure typed past an end; a scale centred on the goal re-centred after
 * each drag and moved the handle away from where the finger left it.
 *
 * Each handle is adjustable for VoiceOver: a swipe up or down moves it one step.
 */

import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import * as Haptics from 'expo-haptics'
import { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { energyScale, fractionOf, valueAt, type Scale } from '../client/goal-energy'

const HANDLE = 22
const SETTLE = { duration: 220 }
const figure = (value: number) => Math.round(value).toLocaleString('es-CO')

export function GoalSlider({
  low,
  high,
  step,
  unit,
  onChange,
  lowLabel,
  highLabel,
}: {
  readonly low: number
  /** The range's other end; null for an exact figure, which has one handle. */
  readonly high: number | null
  readonly step: number
  readonly unit: string
  readonly onChange: (low: number, high: number | null) => void
  readonly lowLabel: string
  readonly highLabel?: string
}) {
  const theme = useTheme()
  const reduced = useReducedMotion()
  const [width, setWidth] = useState(0)
  const [holding, setHolding] = useState(false)
  const [scale, setScale] = useState<Scale>(() => energyScale(low, high ?? low))
  const latest = useRef({ low, high, onChange })
  useEffect(() => {
    latest.current = { low, high, onChange }
  }, [low, high, onChange])

  useEffect(() => {
    if (!holding) setScale(energyScale(low, high ?? low))
  }, [low, high, holding])

  const range = useSharedValue<Scale>(scale)
  const lowX = useSharedValue(0)
  const highX = useSharedValue(0)
  const dragging = useSharedValue(false)
  const start = useSharedValue(0)

  useEffect(() => {
    range.set(scale)
    if (width === 0 || holding) return
    const place = (value: number) => fractionOf(value, scale) * width
    lowX.set(reduced ? place(low) : withTiming(place(low), SETTLE))
    if (high !== null) highX.set(reduced ? place(high) : withTiming(place(high), SETTLE))
  }, [scale, width, holding, low, high, reduced, range, lowX, highX])

  const report = (end: 'low' | 'high', value: number) => {
    void Haptics.selectionAsync()
    const current = latest.current
    if (end === 'low') current.onChange(value, current.high)
    else current.onChange(current.low, value)
  }

  // The figure follows the handle a step at a time, and only while a finger moves it.
  useAnimatedReaction(
    () => (width > 0 ? valueAt(lowX.get() / width, range.get(), step) : null),
    (now, before) => {
      if (dragging.get() && now !== null && before !== null && now !== before) {
        scheduleOnRN(report, 'low', now)
      }
    },
  )
  useAnimatedReaction(
    () => (width > 0 && high !== null ? valueAt(highX.get() / width, range.get(), step) : null),
    (now, before) => {
      if (dragging.get() && now !== null && before !== null && now !== before) {
        scheduleOnRN(report, 'high', now)
      }
    },
  )

  const drag = (end: 'low' | 'high') =>
    Gesture.Pan()
      .hitSlop({ horizontal: 12, vertical: 14 })
      .onBegin(() => {
        dragging.set(true)
        start.set(end === 'low' ? lowX.get() : highX.get())
        scheduleOnRN(setHolding, true)
      })
      .onUpdate((event) => {
        const next = start.get() + event.translationX
        if (end === 'low') {
          lowX.set(Math.min(high === null ? width : highX.get(), Math.max(0, next)))
        } else {
          highX.set(Math.min(width, Math.max(lowX.get(), next)))
        }
      })
      .onFinalize(() => {
        dragging.set(false)
        scheduleOnRN(setHolding, false)
      })

  const lowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: lowX.get() }] }))
  const highStyle = useAnimatedStyle(() => ({ transform: [{ translateX: highX.get() }] }))
  const spanStyle = useAnimatedStyle(() => ({
    left: lowX.get(),
    width: high === null ? 0 : Math.max(0, highX.get() - lowX.get()),
  }))

  const adjust = (end: 'low' | 'high', by: number) => {
    const current = latest.current
    const value = end === 'low' ? current.low : (current.high ?? current.low)
    report(end, Math.max(0, value + by))
  }
  const handle = (end: 'low' | 'high') => (
    <GestureDetector gesture={drag(end)}>
      <Animated.View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={end === 'low' ? lowLabel : (highLabel ?? lowLabel)}
        accessibilityValue={{ text: `${figure(end === 'low' ? low : (high ?? low))} ${unit}` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) =>
          adjust(end, event.nativeEvent.actionName === 'increment' ? step : -step)
        }
        style={[styles.handleSlot, end === 'low' ? lowStyle : highStyle]}
      >
        <View
          style={[
            styles.handle,
            {
              backgroundColor: end === 'low' ? theme.color.icon.accent : theme.color.text.primary,
              borderColor: theme.color.background.canvas,
            },
          ]}
        />
      </Animated.View>
    </GestureDetector>
  )

  return (
    <View style={styles.root}>
      <View style={styles.track} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        <View style={[styles.rail, { backgroundColor: theme.color.background.surfaceMuted }]} />
        <Animated.View
          style={[styles.span, { backgroundColor: theme.color.icon.accent }, spanStyle]}
        />
        {handle('low')}
        {high !== null ? handle('high') : null}
      </View>
      <View
        style={styles.scale}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text role="body" size="xs" color="muted">
          {figure(scale.min)}
        </Text>
        <Text role="body" size="xs" color="muted">
          {figure(scale.mid)}
        </Text>
        <Text role="body" size="xs" color="muted">
          {`${figure(scale.max)} ${unit}`}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  track: { height: HANDLE + 8, justifyContent: 'center', marginHorizontal: HANDLE / 2 },
  rail: { position: 'absolute', left: -HANDLE / 2, right: -HANDLE / 2, height: 6, borderRadius: 3 },
  span: { position: 'absolute', height: 6, borderRadius: 3 },
  handleSlot: {
    position: 'absolute',
    left: -HANDLE / 2,
    width: HANDLE,
    height: HANDLE,
  },
  handle: { width: HANDLE, height: HANDLE, borderRadius: HANDLE / 2, borderWidth: 3 },
  scale: { flexDirection: 'row', justifyContent: 'space-between' },
})
