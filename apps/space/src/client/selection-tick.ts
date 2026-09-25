/**
 * One selection tick per detent.
 *
 * Lives here rather than in the Design System because a tick is a native capability
 * and the wheel is a drawing: `@allfitone/react-native` takes no dependency on
 * `expo-haptics`, so the consumer fires this from the control's `onChange` — which is
 * exactly once per detent, by the control's own contract.
 *
 * The failure must never break the control — a build without the native module has to
 * keep scrolling — but it must not be silent either. An earlier version swallowed it
 * whole, and when the phone turned out to be running a build made before the module
 * was added, the screen looked identical to a working one: no vibration, no error,
 * nothing to chase. It warns once, because a warning per detent is a flood.
 */

import * as Haptics from 'expo-haptics'

let warned = false

export function selectionTick(): void {
  try {
    void Haptics.selectionAsync().catch(() => undefined)
  } catch (cause) {
    if (!warned) {
      warned = true
      console.warn('[measures] haptics unavailable in this build', cause)
    }
  }
}
