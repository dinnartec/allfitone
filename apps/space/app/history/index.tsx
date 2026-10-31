/**
 * «Historial»: every finished session, a month at a time (H-6, HU-SP-057, ADR-037).
 *
 * **A month at a time** because that is what the person asks of a history: «what did I
 * do in August». It opens on this month, or on the latest with something in it when this
 * one has nothing yet. The chip names the month and, like the calendar button, opens the
 * months there is something in. The card above the list sums the month up and marks
 * the days trained on its calendar, with a dot on the days that set a record.
 *
 * **Filters narrow the month, never the card.** «Con récord» changes the list; the card
 * still says what the month was, so filtering never makes a month look emptier than it
 * was. Discipline and free-session filters exist in the API but are not offered: with
 * strength the only discipline Space records, they answered the same list.
 *
 * **Search waits for the typing to stop**, a third of a second, so each letter is not a
 * request. It finds the routine's name or any of its exercises' (ADR-037).
 *
 * Grouped by ISO week, each group with what was done of what was planned. Rows load a
 * page at a time and the next page is asked for as the end comes into view.
 */

import { IconButton } from '@allfitone/react-native/icon-button'
import { Chip } from '@allfitone/react-native/chip'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Sheet } from '@allfitone/react-native/sheet'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { Text } from '@allfitone/react-native/text'
import { TextField } from '@allfitone/react-native/text-field'
import { useTheme } from '@allfitone/react-native/theme'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native'

import { createSpaceExecutionFlow } from '../../src/client/execution-transport'
import {
  dayLabel,
  daysTrainedUnit,
  longestStreak,
  monthCalendar,
  monthGrid,
  monthName,
  weekGroups,
  weekTally,
  type HistoryDay,
  type HistoryFilters,
  type HistoryItem,
  type HistoryMonth,
} from '../../src/client/history'
import { deviceTimezone } from '../../src/client/timezone'
import { trainedLabel } from '../../src/client/week'
import { HistoryGroupHeader, HistoryPanel, HistoryRow } from '../../src/components/history-row'
import { usePlan, useUpgradeSheet } from '../../src/components/upgrade-sheet'
import { shortDate } from '../../src/client/pro'

const PAGE = 20
const SEARCH_PAUSE_MS = 300
const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const

const READ_FAILED = 'No pudimos cargar tu historial. Inténtalo otra vez.'

/** Today in the person's zone, and the first day of its month. */
function localToday(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
}
const firstOfMonth = (iso: string) => `${iso.slice(0, 7)}-01`

interface Filters {
  readonly withRecord: boolean
}
const NO_FILTERS: Filters = { withRecord: false }

export default function HistoryScreen() {
  const router = useRouter()
  const theme = useTheme()
  const timezone = deviceTimezone()
  const today = localToday(timezone)
  const flow = useMemo(() => createSpaceExecutionFlow(), [])

  const [month, setMonth] = useState(firstOfMonth(today))
  const [summary, setSummary] = useState<HistoryMonth | undefined>(undefined)
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [typed, setTyped] = useState('')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<readonly HistoryItem[] | undefined>(undefined)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [choosingMonth, setChoosingMonth] = useState(false)
  const [pickerYear, setPickerYear] = useState(Number(today.slice(0, 4)))
  /** A day picked on the calendar: the card and the list narrow to it. */
  const [day, setDay] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  // The first day the plan shows, when older sessions are kept behind it.
  const [keptBefore, setKeptBefore] = useState<string | null>(null)
  const features = usePlan()
  const upgrade = useUpgradeSheet(features)
  /** Which request is current: an answer to an older one is dropped, not drawn. */
  const asked = useRef(0)
  /** Set once the person picks a month; until then an empty month gives way to the latest. */
  const picked = useRef(false)

  // Coming back from a session that was edited or deleted, the month and list read again.
  const [seen, setSeen] = useState(0)
  const shown = useRef(false)
  useFocusEffect(
    useCallback(() => {
      if (shown.current) setSeen((count) => count + 1)
      shown.current = true
    }, []),
  )

  useEffect(() => {
    const pause = setTimeout(() => setQuery(typed), SEARCH_PAUSE_MS)
    return () => clearTimeout(pause)
  }, [typed])

  useEffect(() => {
    let active = true
    flow
      .readHistoryMonth(month, timezone)
      .then((read) => {
        if (!active) return
        // The first days of a month have nothing yet: open on the latest one that has.
        const latest = read.months_available[0]
        if (!picked.current && read.sessions === 0 && latest && latest !== month) {
          picked.current = true
          setDay(null)
          setMonth(latest)
          return
        }
        setSummary(read)
      })
      .catch(() => active && setFailure(READ_FAILED))
    return () => {
      active = false
    }
  }, [flow, month, timezone, seen])

  const request = (after: string | null): HistoryFilters => ({
    timezone,
    month,
    ...(day ? { day } : {}),
    ...(filters.withRecord ? { withRecord: true } : {}),
    ...(query ? { query } : {}),
    ...(after ? { cursor: after } : {}),
    limit: PAGE,
  })

  useEffect(() => {
    const id = (asked.current += 1)
    setItems(undefined)
    setFailure(undefined)
    flow
      .listHistory(request(null))
      .then((page) => {
        if (asked.current !== id) return
        setItems(page.data)
        setCursor(page.page.has_more ? page.page.next_cursor : null)
        setKeptBefore(page.window.has_hidden ? page.window.visible_from : null)
      })
      .catch(() => asked.current === id && setFailure(READ_FAILED))
    // `request` reads exactly these, so the list is asked again when any of them changes.
  }, [flow, month, day, filters, query, timezone, seen])

  const loadMore = () => {
    if (!cursor || loadingMore || !items) return
    const id = asked.current
    setLoadingMore(true)
    flow
      .listHistory(request(cursor))
      .then((page) => {
        if (asked.current !== id) return
        setItems([...items, ...page.data])
        setCursor(page.page.has_more ? page.page.next_cursor : null)
      })
      .catch(() => asked.current === id && setFailure(READ_FAILED))
      .finally(() => setLoadingMore(false))
  }

  const pickMonth = (chosen: string) => {
    picked.current = true
    setChoosingMonth(false)
    setFilters(NO_FILTERS)
    setDay(null)
    setMonth(chosen)
  }
  const openMonths = () => {
    setPickerYear(Number(month.slice(0, 4)))
    setChoosingMonth(true)
  }
  const grid = monthGrid(pickerYear, summary?.months_available ?? [], firstOfMonth(today))

  const groups = items ? weekGroups(items, today) : []
  const weekOf = new Map((summary?.weeks ?? []).map((week) => [week.week_starts_on, week]))
  const filtered = filters.withRecord || query.length > 0

  return (
    <Screen edges={['top', 'bottom']} padded={false}>
      {/* Fixed, as on every list screen: searching and filtering are done while
          scrolling, and the way back must never scroll away. */}
      <View style={styles.header}>
        <View style={styles.top}>
          <IconButton
            icon="back"
            accessibilityLabel="Volver"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/today'))}
          />
          <Text role="control" size="xl" accessibilityRole="header" style={styles.title}>
            Historial
          </Text>
          <IconButton icon="calendar" accessibilityLabel="Elegir mes" onPress={openMonths} />
        </View>

        <TextField
          label="Buscar en el historial"
          hideLabel
          placeholder="Busca una rutina o un ejercicio"
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />

        <View style={styles.chips}>
          <Chip
            label={monthName(month)}
            icon="expand"
            selected
            onPress={openMonths}
            accessibilityLabel={`Mes: ${monthName(month)}. Cambiar`}
          />
          <Chip
            label="Con récord"
            icon="record"
            selected={filters.withRecord}
            onPress={() => setFilters({ withRecord: !filters.withRecord })}
          />
        </View>
      </View>
      <FlatList
        data={groups}
        keyExtractor={(group) => group.weekStartsOn}
        contentContainerStyle={styles.content}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.listHead}>
            {summary ? (
              <MonthCard
                summary={summary}
                today={today}
                picked={day}
                onPick={(chosen) => setDay(chosen === day ? null : chosen)}
              />
            ) : null}
            {failure ? <InlineAlert message={failure} /> : null}
          </View>
        }
        renderItem={({ item: group }) => {
          const week = weekOf.get(group.weekStartsOn)
          // A picked day is not its week: the week's tally would count what is not shown.
          const tally = week && !day ? weekTally(week) : undefined
          return (
            <View style={styles.group}>
              <HistoryGroupHeader
                label={group.label}
                {...(tally ? { tally } : {})}
                tallyAccent={
                  week !== undefined && week.planned > 0 && week.fulfilled >= week.planned
                }
              />
              <HistoryPanel>
                {group.items.map((item, index) => (
                  <HistoryRow
                    key={item.executed_session_id}
                    item={item}
                    first={index === 0}
                    size="list"
                    onPress={() =>
                      router.push({
                        pathname: '/history/[executionId]',
                        params: { executionId: item.executed_session_id },
                      })
                    }
                  />
                ))}
              </HistoryPanel>
            </View>
          )
        }}
        ListEmptyComponent={
          items === undefined ? (
            <ActivityIndicator color={theme.color.icon.accent} style={styles.loading} />
          ) : (
            <Text role="body" size="sm" color="muted" style={styles.empty}>
              {filtered
                ? 'Nada de este mes coincide con lo que buscas.'
                : `${monthName(month)} todavía no tiene entrenos terminados.`}
            </Text>
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator color={theme.color.icon.accent} style={styles.loading} />
          ) : !cursor && keptBefore ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => upgrade.offer('training_history_months')}
              style={[
                styles.kept,
                {
                  borderColor: theme.color.accent.tonalBorder,
                  backgroundColor: theme.color.accent.tonal,
                },
              ]}
            >
              <FoundationIcon name="locked" size="md" color={theme.color.icon.accent} decorative />
              <View style={styles.keptCopy}>
                <Text role="control" size="sm">
                  {`Lo anterior al ${shortDate(`${keptBefore}T12:00:00`)} sigue guardado`}
                </Text>
                <Text role="body" size="xs" color="secondary">
                  Con Pro lo vuelves a ver, desde tu primer entreno.
                </Text>
              </View>
            </Pressable>
          ) : null
        }
      />

      <Sheet visible={choosingMonth} onDismiss={() => setChoosingMonth(false)} title="Elige un mes">
        <View style={styles.picker}>
          <View style={styles.yearBar}>
            <IconButton
              icon="back"
              accessibilityLabel="Año anterior"
              disabled={grid.previous === null}
              onPress={() => grid.previous !== null && setPickerYear(grid.previous)}
            />
            <Text role="poster" size="2xl">
              {pickerYear}
            </Text>
            <IconButton
              icon="next"
              accessibilityLabel="Año siguiente"
              disabled={grid.next === null}
              onPress={() => grid.next !== null && setPickerYear(grid.next)}
            />
          </View>
          <View style={styles.monthGrid}>
            {grid.months.map((choice) => {
              const selected = choice.month === month
              return (
                <Pressable
                  key={choice.month}
                  accessibilityRole="button"
                  accessibilityLabel={`${monthName(choice.month)} ${String(pickerYear)}`}
                  accessibilityState={{ selected, disabled: !choice.available }}
                  disabled={!choice.available}
                  onPress={() => pickMonth(choice.month)}
                  style={[
                    styles.monthCell,
                    {
                      backgroundColor: selected
                        ? theme.color.icon.accent
                        : choice.available
                          ? theme.color.background.surfaceMuted
                          : 'transparent',
                      borderColor: choice.current ? theme.color.text.secondary : 'transparent',
                    },
                  ]}
                >
                  <Text
                    role="control"
                    size="sm"
                    color={selected ? 'inverse' : choice.available ? 'primary' : 'disabled'}
                  >
                    {choice.label}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </View>
      </Sheet>
      {upgrade.sheet}
    </Screen>
  )
}

/** The month at a glance: how many, the days trained on its calendar, and four figures. */
function MonthCard({
  summary,
  today,
  picked,
  onPick,
}: {
  readonly summary: HistoryMonth
  readonly today: string
  readonly picked: string | null
  readonly onPick: (day: string) => void
}) {
  const theme = useTheme()
  const chosen: HistoryDay | undefined = summary.days.find((entry) => entry.trained_on === picked)
  const weeks = monthCalendar(summary.month, summary.days, today)
  const streak = longestStreak(summary.days)
  // With a day picked, every figure is that day's.
  const scope = chosen ?? summary
  const kilos = ((chosen ? chosen.volume_kg : summary.total_volume_kg) ?? 0).toLocaleString(
    'es-CO',
    { maximumFractionDigits: 0 },
  )
  const figures: readonly (readonly [string, string, boolean])[] = [
    [trainedLabel(scope.trained_seconds), 'Entrenando', false],
    [String(scope.work_sets), 'Series', false],
    [kilos, 'Kg levantados', false],
    [String(scope.records), 'Récords', true],
  ]

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.color.background.surface, borderColor: theme.color.border.subtle },
      ]}
    >
      <View style={styles.cardTop}>
        <View style={styles.cardCount}>
          <View style={styles.scopeLine}>
            <Text role="eyebrow" size="xs" color="accent" uppercase>
              {chosen ? dayLabel(chosen.trained_on) : monthName(summary.month)}
            </Text>
            {chosen ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => onPick(chosen.trained_on)}
                hitSlop={10}
              >
                <Text role="control" size="xs" color="accent">
                  ✕ Ver todo el mes
                </Text>
              </Pressable>
            ) : null}
          </View>
          <View style={styles.countLine}>
            {/* The italic leans past its box; the padding keeps its edge from being cut. */}
            <Text role="display" size="5xl" style={styles.count}>
              {chosen ? chosen.sessions : summary.days.length}
            </Text>
            <Text role="control" size="sm" color="secondary" style={styles.countUnit}>
              {chosen
                ? chosen.sessions === 1
                  ? 'Entreno'
                  : 'Entrenos'
                : daysTrainedUnit(summary.days.length)}
            </Text>
          </View>
        </View>
        {streak > 1 && !chosen ? (
          <Text role="eyebrow" size="2xs" color="muted" uppercase style={styles.streak}>
            {`Racha más larga · ${String(streak)} días`}
          </Text>
        ) : null}
      </View>

      <View style={styles.calendar}>
        <View style={styles.calendarRow}>
          {WEEKDAYS.map((weekday) => (
            <Text
              key={weekday}
              role="eyebrow"
              size="2xs"
              color="muted"
              align="center"
              style={styles.cell}
            >
              {weekday}
            </Text>
          ))}
        </View>
        {weeks.map((week, row) => (
          <View key={week.find(Boolean)?.date ?? String(row)} style={styles.calendarRow}>
            {week.map((cell, column) =>
              cell ? (
                <Pressable
                  key={cell.date}
                  disabled={!cell.trained}
                  accessible={cell.trained}
                  accessibilityRole="button"
                  accessibilityLabel={`${dayLabel(cell.date)}${cell.record ? ', con récord' : ''}`}
                  accessibilityState={{ selected: cell.date === picked }}
                  onPress={() => onPick(cell.date)}
                  style={[
                    styles.cell,
                    styles.day,
                    {
                      backgroundColor: cell.trained
                        ? theme.color.icon.accent
                        : theme.color.background.surfaceMuted,
                      // The rest of the month steps back so the picked day stands alone.
                      opacity: picked && cell.date !== picked ? 0.25 : 1,
                    },
                    cell.date === picked
                      ? { borderWidth: 2, borderColor: theme.color.text.primary }
                      : cell.today
                        ? { borderWidth: 1.5, borderColor: theme.color.text.secondary }
                        : null,
                  ]}
                >
                  <Text role="control" size="xs" color={cell.trained ? 'inverse' : 'muted'}>
                    {cell.day}
                  </Text>
                  {cell.record ? (
                    <View
                      style={[
                        styles.recordDot,
                        {
                          backgroundColor: theme.color.text.inverse,
                          borderColor: theme.color.text.primary,
                        },
                      ]}
                    />
                  ) : null}
                </Pressable>
              ) : (
                <View key={`blank-${String(column)}`} style={styles.cell} />
              ),
            )}
          </View>
        ))}
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View
              style={[
                styles.legendDot,
                {
                  backgroundColor: theme.color.text.inverse,
                  borderColor: theme.color.text.primary,
                },
              ]}
            />
            <Text role="body" size="xs" color="muted">
              Récord
            </Text>
          </View>
        </View>
      </View>

      <View style={[styles.figures, { borderTopColor: theme.color.border.subtle }]}>
        {figures.map(([value, label, accent]) => (
          <View key={label} style={styles.figure}>
            <Text role="poster" size="xl" color={accent ? 'accent' : 'primary'} numberOfLines={1}>
              {value}
            </Text>
            {/* The same label Hoy puts under its figures, so a figure reads alike on both. */}
            <Text role="body" size="xs" color="muted" numberOfLines={1}>
              {label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  kept: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    marginTop: 12,
  },
  keptCopy: { flex: 1, gap: 2 },
  header: { gap: 14, paddingTop: 8, paddingBottom: 14, paddingHorizontal: 20 },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 14 },
  listHead: { gap: 14 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { flex: 1 },
  chips: { flexDirection: 'row', gap: 8 },
  card: { borderRadius: 24, borderWidth: 1, padding: 18, gap: 16 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  cardCount: { gap: 2 },
  countLine: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  count: { paddingRight: 6 },
  countUnit: { paddingBottom: 6 },
  streak: { paddingBottom: 8 },
  scopeLine: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  picker: { gap: 14, paddingBottom: 8 },
  yearBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  monthCell: {
    width: '31.5%',
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendar: { gap: 5 },
  calendarRow: { flexDirection: 'row', gap: 5 },
  cell: { flex: 1 },
  day: { aspectRatio: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  recordDot: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 1.5,
  },
  legend: { flexDirection: 'row', gap: 14, marginTop: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 9, height: 9, borderRadius: 5, borderWidth: 1.5 },
  figures: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    paddingTop: 12,
  },
  figure: { gap: 3 },
  group: { gap: 10 },
  loading: { marginTop: 24 },
  empty: { marginTop: 16, textAlign: 'center' },
})
