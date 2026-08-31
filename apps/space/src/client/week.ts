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

/** Spanish month names, for the same reason the letters are literal: no ICU to trust. */
const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

/**
 * "martes 26 de agosto", written out rather than formatted.
 *
 * `Intl` with a Spanish locale is not something to depend on across two engines and
 * two operating systems for a line of copy, and a wrong month name would be visible
 * to everybody on the first screen after signing up.
 */
export function longDateLabel(date: Date): string {
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} de ${MONTHS[date.getMonth()]}`
}

/** "LUN 25", for a history row. Same reason as the month names: no ICU to trust. */
export function shortDayLabel(isoDate: string): string {
  // Parsed as parts, not through `Date.parse`: a bare `YYYY-MM-DD` is read as UTC,
  // which lands on the previous day for anybody west of Greenwich.
  const [year, month, day] = isoDate.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) return ''
  const date = new Date(year, month - 1, day)
  return `${(WEEKDAYS[date.getDay()] ?? '').slice(0, 3).toUpperCase()} ${day}`
}

/** "4h 30m", or "45m" while a week has not reached an hour. */
export function trainedLabel(totalSeconds: number): string {
  const minutes = Math.round(Math.max(0, totalSeconds) / 60)
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}
