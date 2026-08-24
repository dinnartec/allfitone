/**
 * Timing for the onboarding animations.
 *
 * Durations and curves are never numbers typed into a screen: `@allfitone/tokens`
 * owns them, and a screen that picks its own 250 ms drifts from every other screen
 * the moment the token changes. What lives here is the arithmetic on top — which
 * token a movement uses, how a stagger is spaced, and the timing function a
 * Reanimated CSS transition needs.
 *
 * `emphasized` is `[0.16, 1, 0.3, 1]`: almost all the distance is covered in the
 * first frames, then it settles. That is the shape a UI entrance wants, and it is
 * within a hair of the strong ease-out the motion playbook prescribes
 * (`0.23, 1, 0.32, 1`) — so the token is used rather than a second near-identical
 * curve hand-typed into the app, which DT-008 forbids anyway.
 *
 * The first version of this file got three things wrong, all corrected here.
 * It used `enter`, `[0, 0, 0.2, 1]`, which leaves the origin linearly so the
 * opening frames barely move and the whole thing reads as sluggish. Its durations
 * were too long once the stagger stacked on top — 240 ms behind up to 180 ms of
 * delay is 420 ms before the last row settles, past the 300 ms budget. And it
 * collapsed everything to zero under reduced motion, which overshoots the ask:
 * fewer and gentler, not none. The fade explains that something arrived; only the
 * movement goes.
 */

import { motion } from '@allfitone/react-native/tokens'

export type MotionDuration = keyof typeof motion.duration
export type MotionEasing = keyof typeof motion.easing

/** How far a block lifts as it fades in, and nothing under reduced motion. */
export const LIFT_PX = 8

export function liftFor(reduceMotion: boolean): number {
  return reduceMotion ? 0 : LIFT_PX
}

/** The duration a movement should use. */
export function durationFor(name: MotionDuration, reduceMotion: boolean): number {
  // Still animated under reduced motion, just the shortest step that reads as a
  // transition rather than a cut. Movement is what gets removed, not the fade.
  return reduceMotion ? motion.duration.fastest : motion.duration[name]
}

/** The four control points of a named curve. */
export function easingFor(name: MotionEasing): readonly [number, number, number, number] {
  const [a, b, c, d] = motion.easing[name]
  return [a ?? 0, b ?? 0, c ?? 1, d ?? 1]
}

/**
 * This module stays free of Reanimated on purpose. Importing it pulls in
 * `react-native/index.js`, whose Flow syntax Bun cannot parse, and the file stops
 * being testable — which is the whole reason the logic lives here rather than in
 * the screen. The curve is handed over as four numbers and the screen wraps them
 * in `cubicBezier` at the point of use.
 */

/** A duration as a CSS string, for the same reason. */
export function cssDuration(name: MotionDuration, reduceMotion: boolean): string {
  return `${durationFor(name, reduceMotion)}ms`
}

/**
 * When each item of a staggered entrance starts. Inside the playbook's 30–80 ms
 * window, and capped so the whole entrance stays under the 300 ms budget: with
 * five rows at 45 ms each the last one used to start after the first had finished,
 * and the list read as loading rather than arriving.
 */
export const STAGGER_STEP_MS = 30
export const STAGGER_CAP_MS = 90

export function staggerDelays(count: number, reduceMotion: boolean): readonly number[] {
  if (count <= 0) return []
  // The stagger is decoration and must never hold up interaction, so it is the
  // first thing to go when motion is reduced.
  if (reduceMotion) return Array.from({ length: count }, () => 0)
  return Array.from({ length: count }, (_, index) =>
    Math.min(index * STAGGER_STEP_MS, STAGGER_CAP_MS),
  )
}

/** The whole entrance, delay included, so the budget can be asserted. */
export function entranceSpanMs(count: number, reduceMotion: boolean): number {
  const delays = staggerDelays(count, reduceMotion)
  return (delays.at(-1) ?? 0) + durationFor('fast', reduceMotion)
}

/**
 * Whether the entrance should play at all. Coming back to correct an answer is
 * not an arrival: the person already saw the screen, and replaying the entrance
 * every time would punish exactly the editing this onboarding was built to allow.
 * Reduced motion does not suppress it — the fade is what it keeps.
 */
export function shouldPlayEntrance(alreadyAnswered: boolean): boolean {
  return !alreadyAnswered
}

/**
 * Press feedback. 3 % and 120 ms is the ceiling for something touched this often:
 * row selection sits in the tens-of-times-a-day tier, where the playbook allows
 * near-imperceptible motion or none at all.
 */
export const PRESS_SCALE = 0.97
export const PRESS_DURATION: MotionDuration = 'fast'
