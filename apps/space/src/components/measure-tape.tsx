/**
 * The tape: marks in a window, with a fixed pointer and the reading above it.
 *
 * Both measurements use it. Height had a vertical rail of its own and it was the
 * weaker of the two — the scale hugged the left edge, the number floated to the right
 * joined by a thin line, and half the screen carried almost nothing. Two controls
 * that behave differently also make the person learn the screen twice.
 *
 * Eleven points per unit, a two-point stroke, and a label every five — the pitch is
 * what makes the tape readable, and it is why the window shows a range around the
 * value instead of the whole scale. Compressed to fit a whole scale at once the marks
 * would sit two points apart and stop being marks.
 *
 * **One long line marks the weight and never moves.** The tape travels under it. An
 * earlier version tinted whichever mark held the value, which meant the cyan slid
 * along with the numbers and nothing on screen stayed still — the reading had no
 * anchor and the movement read as drift. The line is taller than every mark on the
 * tape so it is plainly the pointer and not one more tick.
 *
 * Each mark crossed fires a selection tick. A ruler you drag with no feedback tells
 * you nothing until you stop and read, and the tick is what makes it feel like it
 * has detents. It fires only when the snapped value changes, so it follows the marks
 * rather than the frames.
 *
 * The drag runs on the UI thread. A pan handled in JavaScript stutters exactly when
 * the finger is moving fastest, which is the whole experience of the control.
 *
 * The whole window is the touch target, never a mark: a mark is two points wide and
 * could not satisfy the 44 pt minimum, and a tape is dragged rather than tapped.
 */

import * as Haptics from 'expo-haptics'

import { Text } from '@allfitone/react-native/text'
import {
  MARK_PITCH,
  tapeOffsetFor,
  tapeValueFor,
  verticalOffsetFor,
  verticalValueFor,
} from '../client/measures-form'
import { useTheme } from '@allfitone/react-native/theme'
import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated'

/**
 * One selection tick per mark crossed.
 *
 * The failure must never break the ruler — a build without the native module has to
 * keep dragging — but it must not be silent either. An earlier version swallowed it
 * whole, and when the phone turned out to be running a build made before the module
 * was added, the screen looked identical to a working one: no vibration, no error,
 * nothing to chase. It warns once, because a warning per crossed mark is a flood.
 */
let hapticsWarned = false

function tick(): void {
  try {
    void Haptics.selectionAsync().catch(() => undefined)
  } catch (cause) {
    if (!hapticsWarned) {
      hapticsWarned = true
      console.warn('[measures] haptics unavailable in this build', cause)
    }
  }
}

/** How tall the window is, and how the marks inside it are drawn. */
const WINDOW_HEIGHT = 66
const STROKE_TALL = 34
const STROKE_SHORT = 18

/** Room for a three digit label, centred over a mark a fifth of its width. */
const LABEL_WIDTH = 40

/** Taller than the tallest mark, so the pointer reads as the pointer. */
const POINTER_HEIGHT = 46

/** How wide the window is when the tape runs down: marks plus room for a label. */
const VERTICAL_WIDTH = 104

export interface MeasureTapeProps {
  min: number
  max: number
  /** Every how many units a mark is drawn tall and labelled. */
  major: number
  value: number
  onChange: (value: number) => void
  /** Measured width of the window, so the mark can sit at its centre. */
  width: number
  disabled?: boolean
  accessibilityLabel: string
  accessibilityText: string
  /** How a labelled mark reads. Feet and inches need `5′ 10″`, not the raw total. */
  formatLabel?: (mark: number) => string
  /**
   * Across for a weight, down for a height. Only the axis changes: the scale travels
   * and the pointer stays put either way, because that is the behaviour rather than
   * the shape. A height is read off a wall, so down is the honest axis for it.
   */
  orientation?: 'horizontal' | 'vertical'
  /** How long the window is along its own axis, needed when it runs down. */
  length?: number
}

export function MeasureTape({
  min,
  max,
  major,
  value,
  onChange,
  width,
  disabled = false,
  accessibilityLabel,
  accessibilityText,
  formatLabel,
  orientation = 'horizontal',
  length,
}: MeasureTapeProps) {
  const theme = useTheme()
  const vertical = orientation === 'vertical'
  const centre = (vertical ? (length ?? 0) : width) / 2

  const offset = useSharedValue(
    vertical ? verticalOffsetFor(value, max) : tapeOffsetFor(value, min),
  )
  const start = useSharedValue(0)

  // While the finger is down the shared value owns the tape; otherwise it follows the
  // state, so switching unit or resuming slides it too.
  useEffect(() => {
    offset.value = vertical ? verticalOffsetFor(value, max) : tapeOffsetFor(value, min)
  }, [max, min, offset, value, vertical])

  const report = (next: number) => {
    const snapped = vertical ? verticalValueFor(next, min, max) : tapeValueFor(next, min, max)
    if (snapped === value) return
    tick()
    onChange(snapped)
  }

  const pan = Gesture.Pan()
    .enabled(!disabled)
    .onBegin(() => {
      start.value = offset.value
    })
    .onUpdate((event) => {
      const low = vertical ? verticalOffsetFor(min, max) : tapeOffsetFor(max, min)
      const high = vertical ? verticalOffsetFor(max, max) : tapeOffsetFor(min, min)
      const moved = vertical ? event.translationY : event.translationX
      offset.value = Math.min(high, Math.max(low, start.value + moved))
      runOnJS(report)(offset.value)
    })

  const tapeStyle = useAnimatedStyle(() =>
    vertical ? { top: centre + offset.value } : { left: centre + offset.value },
  )

  // Ascending across, descending down: a height reads with the tallest at the top,
  // and the offset counts from `max` for exactly that reason. Ordered the other way
  // the tape ran upside down — 165 above 185.
  const marks: number[] = []
  for (let mark = min; mark <= max; mark += 1) marks.push(mark)
  if (vertical) marks.reverse()

  return (
    <GestureDetector gesture={pan}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: accessibilityText }}
        accessibilityState={{ disabled }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          if (disabled) return
          const step = event.nativeEvent.actionName === 'increment' ? 1 : -1
          onChange(Math.min(max, Math.max(min, value + step)))
        }}
        style={[
          styles.window,
          vertical ? { width: VERTICAL_WIDTH, height: length ?? 0 } : { height: WINDOW_HEIGHT },
        ]}
      >
        <Animated.View
          style={[vertical ? styles.tapeDown : styles.tapeAcross, tapeStyle]}
          pointerEvents="none"
        >
          {marks.map((mark) => {
            const labelled = mark % major === 0
            const reach = labelled ? STROKE_TALL : STROKE_SHORT
            return (
              <View
                key={mark}
                style={vertical ? { height: MARK_PITCH, justifyContent: 'center' } : styles.mark}
              >
                <View
                  style={[
                    vertical
                      ? { height: 2, width: reach, borderRadius: 2 }
                      : { width: 2, height: reach, borderRadius: 2 },
                    { backgroundColor: theme.color.border.default },
                  ]}
                />
                {labelled ? (
                  <Text
                    role="body"
                    size="xs"
                    color="muted"
                    numberOfLines={1}
                    style={vertical ? styles.labelDown : styles.labelAcross}
                  >
                    {formatLabel ? formatLabel(mark) : mark}
                  </Text>
                ) : null}
              </View>
            )
          })}
        </Animated.View>

        {/* The pointer. Fixed, and longer than any mark so it cannot be mistaken for
            one — this is the line that says what the measurement is. */}
        <View
          pointerEvents="none"
          style={[
            vertical
              ? {
                  position: 'absolute',
                  left: 0,
                  top: centre - 1.5,
                  height: 3,
                  width: POINTER_HEIGHT,
                }
              : {
                  position: 'absolute',
                  top: 0,
                  left: centre - 1.5,
                  width: 3,
                  height: POINTER_HEIGHT,
                },
            { borderRadius: 2, backgroundColor: theme.color.border.accent },
          ]}
        />
      </View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  window: { overflow: 'hidden', position: 'relative' },
  tapeAcross: { position: 'absolute', top: 0, flexDirection: 'row', alignItems: 'flex-start' },
  tapeDown: { position: 'absolute', left: 0, flexDirection: 'column', alignItems: 'flex-start' },
  mark: { width: MARK_PITCH, alignItems: 'center' },
  // Wider than the mark it belongs to and centred over it: at eleven points a two
  // digit number wraps, and "55" came out as a 5 above a 5.
  labelAcross: {
    position: 'absolute',
    top: STROKE_TALL + 6,
    width: LABEL_WIDTH,
    left: (MARK_PITCH - LABEL_WIDTH) / 2,
    textAlign: 'center',
    fontSize: 10,
  },
  // Clear of the pointer, which is longer than any mark: at the mark's own width the
  // label for the current value sat under it.
  labelDown: { position: 'absolute', left: POINTER_HEIGHT + 10, fontSize: 10 },
})
