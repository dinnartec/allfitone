/**
 * What «Progreso» says about the person's training, period against period (HU-SP-061).
 *
 * The database compares the periods (OP-EXE-026): totals, the work sets of each muscle
 * and each movement's best in every period. The volume day by day comes from the
 * history months the app already reads, because a cumulative line needs the days and
 * the comparison only has the periods. Everything here is pure and tested.
 *
 * Dates are parsed as parts, never through `Date.parse`, for the reason `history.ts`
 * gives: a bare `YYYY-MM-DD` is UTC and lands on the previous day west of Greenwich.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type PeriodComparison = AllfitV1Schemas['SpacePeriodComparison']
export type Period = AllfitV1Schemas['SpacePeriod']
export type PeriodMovement = AllfitV1Schemas['SpacePeriodMovement']
export type PeriodKind = PeriodComparison['period']

const MONTHS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
]
const DAY = 86_400_000

function dayOf(iso: string): Date {
  const [year = 1970, month = 1, day = 1] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

const isoOf = (date: Date) => date.toISOString().slice(0, 10)
const short = (date: Date) => (MONTHS[date.getUTCMonth()] ?? '').slice(0, 3).toLowerCase()

/** How many days a period has, counted from its first. */
function lengthOf(startsOn: string, kind: PeriodKind): number {
  if (kind === 'week') return 7
  const start = dayOf(startsOn)
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate()
}

/** «19 – 25 oct», «28 sep – 4 oct» or «Octubre 2026». */
export function periodLabel(startsOn: string, kind: PeriodKind): string {
  const start = dayOf(startsOn)
  if (kind === 'month')
    return `${MONTHS[start.getUTCMonth()] ?? ''} ${String(start.getUTCFullYear())}`
  const end = new Date(start.getTime() + 6 * DAY)
  return start.getUTCMonth() === end.getUTCMonth()
    ? `${String(start.getUTCDate())} – ${String(end.getUTCDate())} ${short(end)}`
    : `${String(start.getUTCDate())} ${short(start)} – ${String(end.getUTCDate())} ${short(end)}`
}

/** Rounded; null when either side is missing or the earlier one is zero. */
export function percentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous <= 0) return null
  return Math.round(((current - previous) / previous) * 100)
}

/** «12.480», «92,5»: a decimal comma, a thousands dot, one decimal at most. */
export function formatKilos(kilos: number): string {
  const rounded = Math.round(kilos * 10) / 10
  const [whole = '0', decimal] = String(rounded).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return decimal ? `${grouped},${decimal}` : grouped
}

/**
 * The volume added up day by day across one period, null from tomorrow on so the line
 * stops at today. A day without a weighed set adds nothing rather than breaking the line.
 */
export function cumulativeVolume(
  days: readonly { readonly trained_on: string; readonly volume_kg: number | null }[],
  startsOn: string,
  kind: PeriodKind,
  today: string,
): (number | null)[] {
  const start = dayOf(startsOn).getTime()
  const byDay = new Map(days.map((day) => [day.trained_on, day.volume_kg ?? 0]))
  let running = 0
  return Array.from({ length: lengthOf(startsOn, kind) }, (_, index) => {
    const iso = isoOf(new Date(start + index * DAY))
    if (iso > today) return null
    running += byDay.get(iso) ?? 0
    return running
  })
}

export interface MuscleRow {
  readonly code: string
  readonly name: string
  readonly sets: number
  /** Against the heaviest muscle of the period, 0 to 1. */
  readonly share: number
}

/** The period's muscles as the server ordered them, heaviest first. */
export function muscleRows(period: Period): MuscleRow[] {
  const heaviest = Math.max(1, ...period.muscles.map((muscle) => muscle.sets))
  return period.muscles.map((muscle) => ({ ...muscle, share: muscle.sets / heaviest }))
}

/** The muscles the period before trained and this one has not. */
export function untrained(current: Period, previous: Period | undefined): string[] {
  if (!previous) return []
  const now = new Set(current.muscles.map((muscle) => muscle.code))
  return previous.muscles.filter((muscle) => !now.has(muscle.code)).map((muscle) => muscle.name)
}

/** The movements whose best rose against the period before, the biggest rise first. */
export function liftedUp(movements: readonly PeriodMovement[]): PeriodMovement[] {
  return movements
    .filter((movement) => movement.change_kg !== null && movement.change_kg > 0)
    .sort((a, b) => (b.change_kg ?? 0) - (a.change_kg ?? 0))
}

/**
 * A movement's bests as an SVG path in a `width` × `height` box, skipping the periods it
 * was not trained in. Null with fewer than two points: one point is not a trend.
 */
export function sparkline(
  bests: readonly (number | null)[],
  width: number,
  height: number,
): string | null {
  const points = bests.filter((best): best is number => best !== null)
  if (points.length < 2) return null
  const low = Math.min(...points)
  const span = Math.max(...points) - low || 1
  const step = width / (points.length - 1)
  return points
    .map((value, index) => {
      const x = Math.round(index * step * 10) / 10
      const y = Math.round((height - ((value - low) / span) * height) * 10) / 10
      return `${index === 0 ? 'M' : 'L'}${String(x)} ${String(y)}`
    })
    .join(' ')
}

/** The first day of the period `today` falls in: its Monday, or the 1st of its month. */
export function periodStart(today: string, kind: PeriodKind): string {
  if (kind === 'month') return `${today.slice(0, 7)}-01`
  const date = dayOf(today)
  const fromMonday = (date.getUTCDay() + 6) % 7
  return isoOf(new Date(date.getTime() - fromMonday * DAY))
}

/** One sentence to share a period: what was lifted, in how many sessions, and the change. */
export function shareLine(current: Period, previous: Period | undefined, kind: PeriodKind): string {
  const sessions = `${String(current.sessions)} ${current.sessions === 1 ? 'sesión' : 'sesiones'}`
  const head = `Mi ${kind === 'week' ? 'semana' : 'mes'} en Allfit: `
  const work =
    current.volume_kg === null
      ? sessions
      : `${formatKilos(current.volume_kg)} kg levantados en ${sessions}`
  const change = percentChange(current.volume_kg, previous?.volume_kg ?? null)
  const against = kind === 'week' ? 'la semana pasada' : 'el mes pasado'
  return change === null
    ? `${head}${work}.`
    : `${head}${work}, ${change > 0 ? '+' : ''}${String(change)} % frente a ${against}.`
}

/**
 * The movements as they stood at the period `index` (oldest is 0): the best of that
 * period against the last earlier one. A movement not trained in it is left out.
 */
export function movementsAt(movements: readonly PeriodMovement[], index: number): PeriodMovement[] {
  return movements.flatMap((movement) => {
    const best = movement.bests[index]
    if (best === null || best === undefined) return []
    const before = movement.bests
      .slice(0, index)
      .filter((value): value is number => value !== null)
      .at(-1)
    const previous = before ?? null
    return [
      {
        ...movement,
        best_kg: best,
        previous_best_kg: previous,
        change_kg: previous === null ? null : Math.round((best - previous) * 100) / 100,
      },
    ]
  })
}

/** The start of the period before the one starting on `start`. */
export function previousStart(start: string, kind: PeriodKind): string {
  return periodStart(isoOf(new Date(dayOf(start).getTime() - DAY)), kind)
}
