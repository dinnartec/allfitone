/**
 * The seven days the closing screen shows, and nothing else.
 *
 * It is **not a calendar week**. The first chip is today, and the six that follow
 * are the days after it, because the screen says "tu primera semana" and the first
 * week of somebody who just finished starts the moment they finish — not on the
 * Monday they may already have missed.
 *
 * It promises no sessions. Nothing schedules training yet, and the chips say when
 * what follows begins and nothing more; a chip that implied a planned session would
 * be the screen inventing a plan that does not exist.
 *
 * The letters are Spanish initials, which collide on purpose: martes and miércoles
 * are both `M`, as they are on every wall calendar here. Disambiguating them would
 * be inventing a convention nobody reads.
 */

/**
 * Sunday first, matching `Date.getDay()`. A string rather than an array so the
 * lookup answers a `string` without a cast or an unreachable fallback branch.
 */
const LETTERS = 'DLMMJVS'

export interface WeekDay {
  /** Stable across a render, and distinct even when two letters repeat. */
  readonly key: string
  readonly letter: string
  readonly today: boolean
}

export function weekFromToday(from: Date): readonly WeekDay[] {
  return Array.from({ length: 7 }, (_unused, offset) => {
    // Local midnight plus a day count: `setDate` past the end of the month rolls
    // over, and it is the only arithmetic here that daylight saving cannot skew.
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset)
    return {
      key: `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`,
      letter: LETTERS.charAt(day.getDay()),
      today: offset === 0,
    }
  })
}
