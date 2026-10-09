/**
 * One tab's screen, kept alive and dissolved into view instead of cut in.
 *
 * The router's slot hides the screens you are not on with `display: none`, and on the
 * new architecture that tears their native views down: coming back built every view
 * again, on the same thread that moves the bar's drop. That is what froze the drop on
 * each switch and what made a screen look as if it died and was rebuilt.
 *
 * So every visited screen stays mounted, stacked, and the hidden ones are only
 * transparent and untouchable. Switching is a cross-dissolve, in a stacking order that
 * never changes: reordering by z-index re-inserted whole screens, glass included, on
 * the thread that moves the drop, and the drop stalled for up to 115 ms. A rise of a few points is all the movement there is,
 * since tabs are peers and a slide would claim a direction between them.
 *
 * The slot is told not to detach screens, which turns its native container into a
 * plain view: with it on, it accepted only native `Screen`s and managed their order
 * itself, which aborted the app on unmount and left a screen hidden under another.
 *
 * Hidden screens are hidden from screen readers too. With reduced motion the rise
 * goes and the dissolve stays.
 */

import { useEffect, type ReactNode } from 'react'
import { StyleSheet } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'

/** How long a screen takes to arrive; reads that redraw it wait this long. */
export const ENTRANCE_MS = 240
const ENTER = { duration: ENTRANCE_MS, easing: Easing.bezier(0.33, 1, 0.68, 1) }
const RISE = 4

// The screen the app opens on is simply there; every later one dissolves in.
let opened = false

export function TabScene({
  focused,
  children,
}: {
  readonly focused: boolean
  readonly children: ReactNode
}) {
  const reduced = useReducedMotion()
  const shown = useSharedValue(focused && !opened ? 1 : 0)

  useEffect(() => {
    opened = true
    shown.set(withTiming(focused ? 1 : 0, ENTER))
  }, [focused, shown])

  const style = useAnimatedStyle(() => {
    const progress = shown.get()
    const rise = reduced || !focused ? 0 : (1 - progress) * RISE
    return { opacity: progress, transform: [{ translateY: rise }] }
  })

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, style]}
      pointerEvents={focused ? 'auto' : 'none'}
      accessibilityElementsHidden={!focused}
      importantForAccessibility={focused ? 'auto' : 'no-hide-descendants'}
    >
      {children}
    </Animated.View>
  )
}
