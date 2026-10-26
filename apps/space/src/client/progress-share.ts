/**
 * What «Comparte tu semana» and «Comparte tu mes» say (PROG-SH3, PROG-SH4, PROG-SH6).
 *
 * Pure, so every figure a card or a sticker prints can be asserted without drawing one.
 * Everything comes from the comparison «Progreso» already reads (OP-EXE-026), for the
 * period on screen and the programme chosen; only the receipt needs the sessions
 * themselves, which the history lists.
 *
 * **A card that has nothing true to say does not appear**, as in «Compártelo»: no
 * change against an empty period, no streak of one, no load that did not rise. A week
 * and a month share the cards that read the same and differ where the scale does: a
 * week's bars are its days, a month's are its calendar weeks, and only a month has a
 * calendar.
 *
 * Dates are parsed as parts, never through `Date.parse`, for the reason `history.ts`
 * gives: a bare `YYYY-MM-DD` is UTC and lands on the previous day west of Greenwich.
 */

import type { HistoryItem } from './history'
import {
  liftedUp,
  movementsAt,
  percentChange,
  periodLabel,
  type PeriodComparison,
  type PeriodKind,
} from './progress'

export type ProgressCardKind =
  'load' | 'receipt' | 'versus' | 'lift' | 'figure' | 'calendar' | 'total' | 'dots' | 'muscles'

export type ProgressStickerKind =
  'figures' | 'change' | 'bars' | 'ring' | 'streak' | 'lift' | 'strip' | 'calendar' | 'muscles'

export interface Bar {
  /** «L» for a day of the week, «7–13» for a week of the month. */
  readonly label: string
  /** Null when nothing was trained; zero when trained with nothing weighed. */
  readonly kg: number | null
}

export interface CalendarCell {
  readonly day: number
  /** 0 untrained, then 1 to 3 by the day's load against the month's heaviest. */
  readonly level: 0 | 1 | 2 | 3
}

export interface Lift {
  readonly name: string
  readonly from: number
  readonly to: number
  readonly change: number
  /** The movement's best in every period up to this one, oldest first. */
  readonly points: readonly (number | null)[]
  readonly labels: readonly string[]
}

export interface ShareFacts {
  readonly kind: PeriodKind
  /** «MI SEMANA · 19 – 25 OCT», «MI MES · SEPTIEMBRE 2026». */
  readonly kicker: string
  readonly label: string
  /** The month alone, for the calendar: «SEPTIEMBRE». */
  readonly monthName: string
  readonly noun: 'semana' | 'mes'
  /** What the change is against: «LA SEMANA PASADA», «AGOSTO». */
  readonly against: string
  readonly sessions: number
  readonly planned: number
  readonly fulfilled: number
  readonly workSets: number
  readonly volumeKg: number | null
  readonly previousKg: number | null
  readonly change: number | null
  readonly setsChange: number | null
  readonly duration: string
  readonly bars: readonly Bar[]
  /** Blank cells before the 1st, Monday first. */
  readonly offset: number
  readonly cells: readonly CalendarCell[]
  /** Whether each period read kept its plan, oldest first. */
  readonly kept: readonly boolean[]
  /** Periods in a row, back from this one, that kept their plan. */
  readonly streak: number
  readonly muscles: readonly {
    readonly code: string
    readonly name: string
    readonly sets: number
  }[]
  readonly lift: Lift | null
}

const MONTHS = [
  'ENERO',
  'FEBRERO',
  'MARZO',
  'ABRIL',
  'MAYO',
  'JUNIO',
  'JULIO',
  'AGOSTO',
  'SEPTIEMBRE',
  'OCTUBRE',
  'NOVIEMBRE',
  'DICIEMBRE',
]
const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
const RECEIPT_DAYS = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM']
const DAY = 86_400_000
/** Below this, a run of periods is not yet a streak worth its own sticker. */
const SHORTEST_STREAK = 2

function dayOf(iso: string): Date {
  const [year = 1970, month = 1, day = 1] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

const isoOf = (date: Date) => date.toISOString().slice(0, 10)
const plus = (iso: string, days: number) => isoOf(new Date(dayOf(iso).getTime() + days * DAY))
const shortMonth = (date: Date) => (MONTHS[date.getUTCMonth()] ?? '').slice(0, 3)

/** «3H 40», or «45 MIN» under an hour. */
export function hoursAndMinutes(seconds: number): string {
  const minutes = Math.round(Math.max(0, seconds) / 60)
  if (minutes < 60) return `${String(minutes)} MIN`
  return `${String(Math.floor(minutes / 60))}H ${String(minutes % 60).padStart(2, '0')}`
}

function daysIn(startsOn: string): number {
  const start = dayOf(startsOn)
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate()
}

/** Each day's load, null where nothing was trained. */
function loadsOf(
  days: readonly { readonly trained_on: string; readonly volume_kg: number | null }[],
) {
  const loads = new Map<string, number>()
  for (const day of days)
    loads.set(day.trained_on, (loads.get(day.trained_on) ?? 0) + (day.volume_kg ?? 0))
  return loads
}

function sumOf(loads: Map<string, number>, from: string, count: number): number | null {
  let total: number | null = null
  for (let index = 0; index < count; index += 1) {
    const load = loads.get(plus(from, index))
    if (load !== undefined) total = (total ?? 0) + load
  }
  return total
}

/** A week's bars are its days; a month's, its calendar weeks cut at the month's ends. */
function barsOf(loads: Map<string, number>, startsOn: string, kind: PeriodKind): Bar[] {
  if (kind === 'week')
    return WEEKDAYS.map((label, index) => ({ label, kg: sumOf(loads, plus(startsOn, index), 1) }))
  const length = daysIn(startsOn)
  const bars: Bar[] = []
  let first = 1
  while (first <= length) {
    const weekday = (dayOf(plus(startsOn, first - 1)).getUTCDay() + 6) % 7
    const last = Math.min(length, first + 6 - weekday)
    bars.push({
      label: `${String(first)}–${String(last)}`,
      kg: sumOf(loads, plus(startsOn, first - 1), last - first + 1),
    })
    first = last + 1
  }
  return bars
}

function cellsOf(loads: Map<string, number>, startsOn: string): CalendarCell[] {
  const heaviest = Math.max(0, ...loads.values())
  return Array.from({ length: daysIn(startsOn) }, (_, index) => {
    const load = loads.get(plus(startsOn, index))
    if (load === undefined) return { day: index + 1, level: 0 }
    const share = heaviest > 0 ? load / heaviest : 0
    return { day: index + 1, level: share > 2 / 3 ? 3 : share > 1 / 3 ? 2 : 1 }
  })
}

function periodTag(startsOn: string, kind: PeriodKind): string {
  const start = dayOf(startsOn)
  return kind === 'week' ? `${String(start.getUTCDate())} ${shortMonth(start)}` : shortMonth(start)
}

function liftAt(comparison: PeriodComparison, index: number): Lift | null {
  const [top] = liftedUp(movementsAt(comparison.movements, index))
  if (!top || top.previous_best_kg === null || top.change_kg === null) return null
  const source = comparison.movements.find((one) => one.movement_id === top.movement_id)
  return {
    name: top.name,
    from: top.previous_best_kg,
    to: top.best_kg,
    change: top.change_kg,
    points: (source?.bests ?? []).slice(0, index + 1),
    labels: comparison.periods
      .slice(0, index + 1)
      .map((one) => periodTag(one.starts_on, comparison.period)),
  }
}

/** Everything a card or a sticker can say about the period at `index`. */
export function shareFacts(comparison: PeriodComparison, index: number): ShareFacts {
  const kind = comparison.period
  const current = comparison.periods[index]
  const previous = comparison.periods[index - 1]
  const startsOn = current?.starts_on ?? '1970-01-01'
  const start = dayOf(startsOn)
  const label = periodLabel(startsOn, kind).toUpperCase()
  const loads = loadsOf(current?.days ?? [])
  const kept = comparison.periods.map((one) => one.planned > 0 && one.fulfilled >= one.planned)
  const streak = kept
    .slice(0, index + 1)
    .reverse()
    .findIndex((one) => !one)
  return {
    kind,
    kicker: `${kind === 'week' ? 'MI SEMANA' : 'MI MES'} · ${label}`,
    label,
    monthName: MONTHS[start.getUTCMonth()] ?? '',
    noun: kind === 'week' ? 'semana' : 'mes',
    against: previous
      ? kind === 'week'
        ? 'LA SEMANA PASADA'
        : (MONTHS[dayOf(previous.starts_on).getUTCMonth()] ?? '')
      : '',
    sessions: current?.sessions ?? 0,
    planned: current?.planned ?? 0,
    fulfilled: current?.fulfilled ?? 0,
    workSets: current?.work_sets ?? 0,
    volumeKg: current?.volume_kg ?? null,
    previousKg: previous?.volume_kg ?? null,
    change: percentChange(current?.volume_kg ?? null, previous?.volume_kg ?? null),
    setsChange:
      current && previous && previous.work_sets > 0 ? current.work_sets - previous.work_sets : null,
    duration: hoursAndMinutes(current?.trained_seconds ?? 0),
    bars: barsOf(loads, startsOn, kind),
    offset: (start.getUTCDay() + 6) % 7,
    cells: kind === 'month' ? cellsOf(loads, startsOn) : [],
    kept,
    streak: streak === -1 ? index + 1 : streak,
    muscles: current?.muscles ?? [],
    lift: liftAt(comparison, index),
  }
}

/** The image cards, in the order of PROG-SH3; the receipt needs the sessions listed. */
export function cardsFor(facts: ShareFacts, withSessions: boolean): ProgressCardKind[] {
  const muscles = facts.muscles.length > 0
  const all: [ProgressCardKind, boolean][] = [
    ['load', true],
    ['receipt', facts.kind === 'week' && withSessions],
    ['calendar', facts.kind === 'month'],
    ['versus', facts.change !== null],
    ['lift', facts.lift !== null],
    ['figure', muscles],
    ['total', facts.volumeKg !== null],
    ['dots', true],
    ['muscles', muscles],
  ]
  return all.filter(([, shown]) => shown).map(([kind]) => kind)
}

/** The transparent stickers, in the order of PROG-SH4 and PROG-SH5. */
export function stickersFor(facts: ShareFacts): ProgressStickerKind[] {
  const all: [ProgressStickerKind, boolean][] = [
    ['figures', true],
    ['change', facts.change !== null],
    ['bars', facts.kind === 'week'],
    ['calendar', facts.kind === 'month'],
    ['ring', facts.planned > 0],
    ['streak', facts.streak >= SHORTEST_STREAK],
    ['lift', facts.lift !== null],
    ['strip', true],
    ['muscles', facts.muscles.length > 0],
  ]
  return all.filter(([, shown]) => shown).map(([kind]) => kind)
}

export interface ReceiptRow {
  readonly day: string
  /** Null on a day with nothing trained. */
  readonly title: string | null
  readonly kg: number | null
  readonly minutes: number
}

/** The week a line per day: what was trained, its load and its minutes. */
export function receiptRows(items: readonly HistoryItem[], startsOn: string): ReceiptRow[] {
  return RECEIPT_DAYS.map((weekday, index) => {
    const iso = plus(startsOn, index)
    const day = `${weekday} ${String(dayOf(iso).getUTCDate())}`
    const trained = items.filter((item) => item.trained_on === iso)
    if (trained.length === 0) return { day, title: null, kg: null, minutes: 0 }
    const weighed = trained.filter((item) => item.total_volume_kg !== null)
    return {
      day,
      title:
        trained.length > 1
          ? `${String(trained.length)} SESIONES`
          : (trained[0]?.title ?? 'ENTRENO LIBRE').toUpperCase(),
      kg:
        weighed.length === 0
          ? null
          : weighed.reduce((sum, item) => sum + (item.total_volume_kg ?? 0), 0),
      minutes: Math.round(trained.reduce((sum, item) => sum + item.duration_seconds, 0) / 60),
    }
  })
}
