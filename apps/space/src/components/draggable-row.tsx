/**
 * A row that can be picked up, with every other row getting out of its way as it goes.
 *
 * Shared by the routine editor and the session in progress, which reorder the same
 * way: an exercise list where a superset travels whole and a long press lifts a row.
 *
 * **The whole list moves during the drag, not after it.** Two shared values say it:
 * which position is in the air and how far it has travelled. Every row reads both in
 * its own `useAnimatedStyle` and works out whether the one in the air has passed over
 * it — if it has, the row steps aside by exactly one place. That computation is a
 * worklet, so it runs per frame on the UI runtime and React renders nothing at all
 * between picking up and putting down.
 *
 * **Held, not pressed.** The pan activates after a quarter of a second of stillness,
 * which is what both platforms use for reorder and what keeps this gesture from
 * fighting the scroll view it lives in — a pan that won immediately would make the
 * list unscrollable wherever a finger happened to land on a grip.
 *
 * **The layout animation stands down while a drag is on.** A reflow animates a row
 * from where it used to be to where it now is, which is exactly the wrong thing at the
 * moment of dropping: the transform has already put the row in its new place, so the
 * two would fight and the row would jump back a slot before sliding forward again.
 * The caller brings it back a frame after the order is committed, which is one
 * `setState` per gesture rather than per frame.
 */

import type { ReactNode } from 'react'
import type { StyleProp, ViewProps, ViewStyle } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  Easing,
  useAnimatedStyle,
  withTiming,
  type AnimatedProps,
  type SharedValue,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { aside, placeOf, ROW_SPAN } from '../client/drag-order'
import type { Frame } from '../client/reveal'

/** Quick enough that a row reads as answering the finger rather than following it. */
const STEP_ASIDE = { duration: 160, easing: Easing.bezier(0.23, 1, 0.32, 1) }

type Animations = Pick<AnimatedProps<ViewProps>, 'exiting' | 'layout'>

export function DraggableRow({
  position,
  count,
  open,
  from,
  travel,
  finger,
  span = ROW_SPAN,
  exiting,
  layout,
  onLift,
  onDrop,
  onFrame,
  style,
  children,
}: {
  readonly position: number
  readonly count: number
  /** An open row is not draggable: its own content takes the long press. */
  readonly open: boolean
  readonly from: SharedValue<number>
  readonly travel: SharedValue<number>
  /** Where the finger is on screen, for a list that scrolls itself near its edges. */
  readonly finger?: SharedValue<number>
  /** How tall one shut row is, gap included: what one place in the list measures. */
  readonly span?: number
  readonly exiting?: Animations['exiting']
  /** Left out while a drag is on; see the header. */
  readonly layout?: Animations['layout']
  readonly onLift: () => void
  readonly onDrop: (to: number) => void
  /** Where it sits in the list, so whatever opens can be scrolled into view. */
  readonly onFrame?: (frame: Frame) => void
  readonly style?: StyleProp<ViewStyle>
  readonly children: ReactNode
}) {
  const drag = Gesture.Pan()
    // Shut only. Open, the row holds a table of number fields, and a long press on one
    // of them would lift the whole exercise instead of putting a caret in it.
    .enabled(!open)
    .activateAfterLongPress(250)
    .onStart((event) => {
      from.set(position)
      travel.set(0)
      finger?.set(event.absoluteY)
      // Anything the caller starts lives on the RN runtime, so it is started from there.
      scheduleOnRN(onLift)
    })
    // `onChange` rather than `onUpdate`: what is added is the movement since the last
    // frame, so whatever else moves the row (an edge scroll) is not thrown away.
    .onChange((event) => {
      finger?.set(event.absoluteY)
      travel.set(travel.get() + event.changeY)
    })
    .onEnd((_event, success) => {
      const landed = success ? placeOf(position, travel.get(), count, span) : position
      scheduleOnRN(onDrop, landed)
    })

  const moving = useAnimatedStyle(() => {
    const lifted = from.get()
    if (lifted === 0) return { transform: [{ translateY: 0 }, { scale: 1 }], opacity: 1, zIndex: 0 }
    if (lifted === position) {
      return {
        transform: [{ translateY: travel.get() }, { scale: 1.02 }],
        opacity: 0.94,
        zIndex: 2,
      }
    }
    return {
      transform: [
        {
          translateY: withTiming(aside(position, lifted, travel.get(), count, span), STEP_ASIDE),
        },
        { scale: 1 },
      ],
      opacity: 1,
      zIndex: 0,
    }
  })

  return (
    <GestureDetector gesture={drag}>
      <Animated.View
        {...(exiting ? { exiting } : {})}
        {...(layout ? { layout } : {})}
        onLayout={(event) =>
          onFrame?.({ y: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height })
        }
        style={[style, moving]}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  )
}
