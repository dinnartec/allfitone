/**
 * What the history says about the sessions it lists (H-2 on Hoy, H-6 on its screen).
 *
 * Pure, so every line a row prints and every group a list makes can be asserted without
 * drawing them. The server summarises each row and each month when it is read
 * (ADR-037); this file only groups them by week and words them.
 *
 * **Weeks are ISO weeks, Monday to Sunday**, the same weeks the streak and the week on
 * Hoy count. A session is grouped by the day it was trained in the person's zone, which
 * is what `trained_on` already is, so no zone is needed here.
 *
 * Dates are parsed as parts, never through `Date.parse`: a bare `YYYY-MM-DD` is read as
 * UTC and lands on the previous day for anybody west of Greenwich.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type HistoryItem = AllfitV1Schemas['SpaceHistoryItem']
export type HistoryPage = AllfitV1Schemas['SpaceHistoryPage']
export type HistoryMonth = AllfitV1Schemas['SpaceHistoryMonth']
export type HistoryWeek = AllfitV1Schemas['SpaceHistoryWeek']

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
const WEEKDAYS = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB']
const DAY = 86_400_000

/** A local calendar date as UTC midnight, so adding days never meets a clock change. */
function dayOf(iso: string): Date {
  const [year = 1970, month = 1, day = 1] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

const isoOf = (date: Date) => date.toISOString().slice(0, 10)

/** The Monday of the ISO week a date falls in. */
export function mondayOf(iso: string): string {
  const date = dayOf(iso)
  const fromMonday = (date.getUTCDay() + 6) % 7
  return isoOf(new Date(date.getTime() - fromMonday * DAY))
}

export interface WeekGroup {
  readonly weekStartsOn: string
  readonly label: string
  readonly items: readonly HistoryItem[]
}

const shortMonth = (date: Date) => (MONTHS[date.getUTCMonth()] ?? '').slice(0, 3).toUpperCase()

/** «ESTA SEMANA», «SEMANA PASADA», «HACE DOS SEMANAS», then «17 – 23 AGO». */
function weekLabel(monday: string, today: string): string {
  const weeksAgo = Math.round(
    (dayOf(mondayOf(today)).getTime() - dayOf(monday).getTime()) / (7 * DAY),
  )
  if (weeksAgo === 0) return 'ESTA SEMANA'
  if (weeksAgo === 1) return 'SEMANA PASADA'
  if (weeksAgo === 2) return 'HACE DOS SEMANAS'
  const start = dayOf(monday)
  const end = new Date(start.getTime() + 6 * DAY)
  const sameMonth = start.getUTCMonth() === end.getUTCMonth()
  return sameMonth
    ? `${start.getUTCDate()} – ${end.getUTCDate()} ${shortMonth(end)}`
    : `${start.getUTCDate()} ${shortMonth(start)} – ${end.getUTCDate()} ${shortMonth(end)}`
}

/** Consecutive rows of one week, in the order the server answered: newest first. */
export function weekGroups(items: readonly HistoryItem[], today: string): readonly WeekGroup[] {
  const groups: { weekStartsOn: string; label: string; items: HistoryItem[] }[] = []
  for (const row of items) {
    const monday = mondayOf(row.trained_on)
    const last = groups.at(-1)
    if (last && last.weekStartsOn === monday) last.items.push(row)
    else groups.push({ weekStartsOn: monday, label: weekLabel(monday, today), items: [row] })
  }
  return groups
}

const kilos = (value: number) => value.toLocaleString('es-CO', { maximumFractionDigits: 0 })
const plural = (count: number, one: string, many: string) =>
  `${String(count)} ${count === 1 ? one : many}`

/** «48 min · 12 series · 3.840 kg», with only the parts there are. */
export function historyDetail(row: HistoryItem): string {
  const parts = [
    row.is_free ? 'Entreno libre' : null,
    `${String(Math.round(row.duration_seconds / 60))} min`,
    row.work_sets > 0 ? plural(row.work_sets, 'serie', 'series') : null,
    row.total_volume_kg === null ? null : `${kilos(row.total_volume_kg)} kg`,
  ]
  return parts.filter((part): part is string => part !== null).join(' · ')
}

/** «2 récords nuevos», or nothing: no record is not news. */
export function recordsLine(count: number): string | null {
  return count === 0 ? null : plural(count, 'récord nuevo', 'récords nuevos')
}

/** «MIÉ» over «26». */
export function dayParts(iso: string): { readonly weekday: string; readonly day: string } {
  const date = dayOf(iso)
  return { weekday: WEEKDAYS[date.getUTCDay()] ?? '', day: String(date.getUTCDate()) }
}

/**
 * «2 de 3», «1 de 4 · +3 extra». Each planned session counts once towards the plan; a
 * repeat or a free session is training on top of it. With nothing planned the week just
 * says how many.
 */
export function weekTally(week: HistoryWeek): string {
  if (week.planned === 0) return plural(week.completed, 'entreno', 'entrenos')
  const done = `${String(week.fulfilled)} de ${String(week.planned)}`
  const extra = week.completed - week.fulfilled
  return extra > 0 ? `${done} · +${String(extra)} extra` : done
}

/** «Agosto». */
export function monthName(iso: string): string {
  return MONTHS[dayOf(iso).getUTCMonth()] ?? ''
}

export interface HistoryFilters {
  readonly timezone: string
  /** Any day of the month to list; omitted, every month. */
  readonly month?: string
  /** A day picked on the month's calendar. */
  readonly day?: string
  readonly discipline?: string
  readonly withRecord?: boolean
  readonly free?: boolean
  readonly query?: string
  readonly cursor?: string
  readonly limit?: number
}

/** `OP-EXE-014` with only the filters that are on: an absent one is no filter at all. */
export function historyPath(filters: HistoryFilters): string {
  const params = new URLSearchParams({ timezone: filters.timezone })
  if (filters.month) params.set('month', filters.month)
  if (filters.day) params.set('day', filters.day)
  if (filters.discipline) params.set('discipline', filters.discipline)
  if (filters.withRecord !== undefined) params.set('with_record', String(filters.withRecord))
  if (filters.free !== undefined) params.set('free', String(filters.free))
  const text = filters.query?.trim()
  if (text) params.set('q', text)
  if (filters.cursor) params.set('cursor', filters.cursor)
  if (filters.limit !== undefined) params.set('limit', String(filters.limit))
  return `/space/v1/executions?${params.toString()}`
}

export type HistoryDay = AllfitV1Schemas['SpaceHistoryDay']

export interface CalendarDay {
  readonly date: string
  readonly day: number
  readonly trained: boolean
  readonly record: boolean
  readonly today: boolean
}

/** The month as rows of seven, Monday first, with `null` for the days outside it. */
export function monthCalendar(
  month: string,
  days: readonly HistoryDay[],
  today: string,
): readonly (readonly (CalendarDay | null)[])[] {
  const trained = new Map(days.map((entry) => [entry.trained_on, entry]))
  const [year, monthNumber] = month.split('-').map(Number)
  const first = new Date(Date.UTC(year ?? 1970, (monthNumber ?? 1) - 1, 1))
  const length = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  const cells: (CalendarDay | null)[] = Array.from(
    { length: (first.getUTCDay() + 6) % 7 },
    () => null,
  )
  for (let number = 1; number <= length; number += 1) {
    const date = `${month.slice(0, 8)}${String(number).padStart(2, '0')}`
    const entry = trained.get(date)
    cells.push({
      date,
      day: number,
      trained: entry !== undefined,
      record: (entry?.records ?? 0) > 0,
      today: date === today,
    })
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return Array.from({ length: cells.length / 7 }, (_, row) => cells.slice(row * 7, row * 7 + 7))
}

/** The most days trained one after another in the month. */
export function longestStreak(days: readonly HistoryDay[]): number {
  const DAY = 86_400_000
  let longest = 0
  let run = 0
  let previous = Number.NaN
  for (const time of days.map((entry) => Date.parse(entry.trained_on)).sort((a, b) => a - b)) {
    run = time - previous === DAY ? run + 1 : 1
    longest = Math.max(longest, run)
    previous = time
  }
  return longest
}

/** Days and not sessions: two sessions on one day are one square on the calendar. */
export function daysTrainedUnit(count: number): string {
  return count === 1 ? 'Día entrenado' : 'Días entrenados'
}

/** «MIÉ 30 SEP»: the day picked on the calendar, said as the rows say it. */
export function dayLabel(iso: string): string {
  const { weekday, day } = dayParts(iso)
  return `${weekday} ${day} ${shortMonth(dayOf(iso))}`
}

export interface MonthChoice {
  readonly month: string
  readonly label: string
  /** Only a month with something finished in it can be picked. */
  readonly available: boolean
  readonly current: boolean
}

/**
 * A year of the month picker: its twelve months, and the years the arrows lead to, null
 * where there is nothing further to see.
 */
export function monthGrid(
  year: number,
  available: readonly string[],
  currentMonth: string,
): {
  readonly months: readonly MonthChoice[]
  readonly previous: number | null
  readonly next: number | null
} {
  const trained = new Set(available)
  const years = available.map((month) => Number(month.slice(0, 4)))
  const earliest = Math.min(...years, Number(currentMonth.slice(0, 4)))
  const latest = Math.max(...years, Number(currentMonth.slice(0, 4)))
  const months = MONTHS.map((name, index) => {
    const month = `${String(year)}-${String(index + 1).padStart(2, '0')}-01`
    return {
      month,
      label: name.slice(0, 3),
      available: trained.has(month),
      current: month === currentMonth,
    }
  })
  return {
    months,
    previous: year > earliest ? year - 1 : null,
    next: year < latest ? year + 1 : null,
  }
}
