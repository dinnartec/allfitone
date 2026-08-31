/**
 * A list somebody puts in order by dragging.
 *
 * **Absolute rows over a fixed-height stage.** Reordering by re-rendering the array
 * as the finger moves fights every layout animation and makes the row under the
 * finger jump. Here the array never moves while dragging: each row is placed at
 * `index × height` and the drag only changes which index a row is placed at, so the
 * lifted row follows the finger exactly and everything else slides.
 *
 * **The order is committed once, on release.** Writing on every crossing would send
 * one request per pixel of travel; the caller gets one final order.
 *
 * **Only the handle drags.** The row itself stays tappable, and a list that moves
 * when somebody meant to press something is a list that feels broken.
 *
 * The stage's height is `rows × (height + gap)`, so the caller does not have to
 * compute it and cannot get it wrong.
 */

import { FoundationIcon } from '@allfitone/react-native/icons'
import { useTheme } from '@allfitone/react-native/theme'
import { semanticMotion } from '@allfitone/react-native/tokens'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'
import { StyleSheet, View } from 'react-native'

const SPRING = {
  damping: semanticMotion.feedback.spring.damping,
  stiffness: semanticMotion.feedback.spring.stiffness,
  mass: semanticMotion.feedback.spring.mass,
}

export interface ReorderableProps<T> {
  readonly items: readonly T[]
  readonly keyOf: (item: T) => string
  readonly rowHeight: number
  readonly gap: number
  readonly onReorder: (keys: readonly string[]) => void
  readonly children: (item: T, dragging: boolean) => React.ReactNode
}

export function Reorderable<T>({
  items,
  keyOf,
  rowHeight,
  gap,
  onReorder,
  children,
}: ReorderableProps<T>) {
  const step = rowHeight + gap
  const keys = items.map(keyOf)

  return (
    <View style={{ height: items.length * step - gap }}>
      {items.map((item, index) => (
        <Row
          key={keyOf(item)}
          index={index}
          count={items.length}
          step={step}
          rowHeight={rowHeight}
          onDrop={(from, to) => {
            if (from === to) return
            const next = [...keys]
            const [moved] = next.splice(from, 1)
            if (moved === undefined) return
            next.splice(to, 0, moved)
            onReorder(next)
          }}
        >
          {(dragging) => children(item, dragging)}
        </Row>
      ))}
    </View>
  )
}

function Row({
  index,
  count,
  step,
  rowHeight,
  onDrop,
  children,
}: {
  readonly index: number
  readonly count: number
  readonly step: number
  readonly rowHeight: number
  readonly onDrop: (from: number, to: number) => void
  readonly children: (dragging: boolean) => React.ReactNode
}) {
  const theme = useTheme()
  const held = useSharedValue(0)
  const shift = useSharedValue(0)
  const lifted = useSharedValue(0)

  const drag = Gesture.Pan()
    .activeOffsetY([-6, 6])
    .onStart(() => {
      lifted.value = withSpring(1, SPRING)
    })
    .onUpdate((event) => {
      held.value = event.translationY
      // Clamped to the list: a row cannot be dropped where there is no row.
      const target = Math.min(Math.max(index + Math.round(event.translationY / step), 0), count - 1)
      shift.value = target
    })
    .onEnd(() => {
      const target = Math.min(Math.max(shift.value, 0), count - 1)
      lifted.value = withSpring(0, SPRING)
      held.value = withSpring(0, SPRING)
      runOnJS(onDrop)(index, target)
    })

  const style = useAnimatedStyle(() => ({
    top: index * step,
    transform: [{ translateY: held.value }, { scale: 1 + lifted.value * 0.02 }],
    // Lifted rows travel over the others, not under them.
    zIndex: lifted.value > 0 ? 2 : 1,
    opacity: 1 - lifted.value * 0.06,
  }))

  const handle = useAnimatedStyle(() => ({ opacity: 0.6 + lifted.value * 0.4 }))

  return (
    <Animated.View style={[styles.row, { height: rowHeight }, style]}>
      <View style={styles.content}>{children(false)}</View>
      <GestureDetector gesture={drag}>
        <Animated.View style={[styles.handle, handle]} accessible={false}>
          <FoundationIcon name="menu" size="sm" color={theme.color.icon.secondary} decorative />
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  row: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center' },
  content: { flex: 1 },
  // Wide enough to grab without aiming, which is the whole difference between a
  // handle that works and one that people give up on.
  handle: { width: 44, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
})
