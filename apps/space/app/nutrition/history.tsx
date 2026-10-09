/**
 * Historial y resúmenes de nutrición (N-5, HU-SP-071, ADR-040).
 *
 * Seven, fourteen or thirty-one days, the last of them today. The card averages the
 * days with something recorded — an empty day is no evidence and says so — and draws a
 * bar a day against the energy goal, today in accent and an empty day as an outline.
 * Below, the macros' averages against their goals, and the days one by one.
 */

import { IconButton } from '@allfitone/react-native/icon-button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { SegmentedControl } from '@allfitone/react-native/segmented-control'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import {
  averageOfLogged,
  dayTitle,
  eatenFor,
  emptyDaysNote,
  goalFigure,
  NUTRIENT_SHORT_NAMES,
  type DailySummary,
  type GoalTarget,
  type NutritionMeal,
} from '../../src/client/nutrition'
import { createSpaceNutritionFlow } from '../../src/client/nutrition-transport'
import { deviceTimezone } from '../../src/client/timezone'
import { FIGURE_TRACKING, macroColor, MealThumb } from '../../src/components/nutrition-ui'

const READ_FAILED = 'No pudimos cargar tu historial. Inténtalo otra vez.'
const SPANS = [7, 14, 31] as const
const LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S']
const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const BAR_HEIGHT = 110

const localDay = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())
const minusDays = (iso: string, days: number) => {
  const at = new Date(`${iso}T12:00:00Z`)
  at.setUTCDate(at.getUTCDate() - days)
  return at.toISOString().slice(0, 10)
}
const weekdayOf = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay()

export default function NutritionHistoryScreen() {
  const router = useRouter()
  const theme = useTheme()
  const timeZone = useMemo(() => deviceTimezone(), [])
  const flow = useMemo(() => createSpaceNutritionFlow(), [])
  const today = localDay(timeZone)

  const [span, setSpan] = useState<(typeof SPANS)[number]>(7)
  const [days, setDays] = useState<readonly DailySummary[]>([])
  const [meals, setMeals] = useState<readonly NutritionMeal[]>([])
  const [goal, setGoal] = useState<readonly GoalTarget[]>([])
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useFocusEffect(
    useCallback(() => {
      let active = true
      const from = minusDays(today, span - 1)
      Promise.all([
        flow.readDays(from, today, timeZone),
        flow.listMeals(from, today),
        flow.readGoals(),
      ])
        .then(([read, page, goals]) => {
          if (!active) return
          setDays(read.data)
          setMeals(page.data)
          setGoal(goals.active?.targets ?? [])
          setFailure(undefined)
        })
        .catch(() => active && setFailure(READ_FAILED))
      return () => {
        active = false
      }
    }, [flow, span, today, timeZone]),
  )

  const energyGoal = goal.find((one) => one.nutrient_code === 'energy')
  const average = averageOfLogged(days, 'energy')
  const tallest = Math.max(
    1,
    ...days.map((one) => eatenFor(one, 'energy')),
    energyGoal ? goalFigure(energyGoal).value : 0,
  )
  const emptyNote = emptyDaysNote(days, today)
  const newestFirst = [...days].reverse()

  return (
    <Screen edges={['top', 'bottom']} padded={false}>
      <View style={styles.header}>
        <IconButton icon="back" accessibilityLabel="Volver" onPress={() => router.back()} />
        <Text role="control" size="xl" accessibilityRole="header" style={styles.grow}>
          Historial
        </Text>
      </View>
      <View style={styles.spans}>
        <SegmentedControl
          accessibilityLabel="Cuántos días"
          items={SPANS.map((value) => ({ value: String(value), label: `${String(value)} días` }))}
          value={String(span)}
          onChange={(value) => setSpan(Number(value) as (typeof SPANS)[number])}
        />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {failure ? <InlineAlert message={failure} /> : null}

        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.color.background.surface,
              borderColor: theme.color.border.subtle,
            },
          ]}
        >
          <Text role="eyebrow" size="2xs" color="muted" uppercase>
            Promedio diario
          </Text>
          <View style={styles.averageRow}>
            <View style={styles.averageFigure}>
              <Text
                role="display"
                tracking={FIGURE_TRACKING}
                size="4xl"
                style={styles.averageNumber}
              >
                {average.value === null ? '—' : average.value.toLocaleString('es-CO')}
              </Text>
              <Text role="control" size="sm" color="secondary" style={styles.averageUnit}>
                kcal
              </Text>
            </View>
            <Text role="body" size="sm" color="muted">
              {`En ${String(average.days)} ${average.days === 1 ? 'día' : 'días'} con registro`}
            </Text>
          </View>

          <View style={styles.chart}>
            {energyGoal ? (
              <View
                style={[
                  styles.goalLine,
                  {
                    bottom: 22 + (goalFigure(energyGoal).value / tallest) * BAR_HEIGHT,
                    borderTopColor: theme.color.border.default,
                  },
                ]}
              >
                <Text role="body" size="sm" color="muted" style={styles.goalLabel}>
                  {`Meta ${goalFigure(energyGoal).label}`}
                </Text>
              </View>
            ) : null}
            <View style={styles.bars}>
              {days.map((one) => {
                const eaten = eatenFor(one, 'energy')
                const isToday = one.local_date === today
                const hollow = one.meal_count === 0
                return (
                  <View key={one.local_date} style={styles.barColumn}>
                    <View style={[styles.barTrack, { height: BAR_HEIGHT }]}>
                      <View
                        style={[
                          styles.bar,
                          hollow
                            ? {
                                height: 26,
                                borderWidth: 1.5,
                                borderColor: theme.color.border.default,
                              }
                            : {
                                height: Math.max(6, (eaten / tallest) * BAR_HEIGHT),
                                backgroundColor: isToday
                                  ? theme.color.icon.accent
                                  : `${theme.color.icon.accent}55`,
                              },
                        ]}
                      />
                    </View>
                    {span <= 14 ? (
                      <Text role="control" size="xs" color={isToday ? 'accent' : 'muted'}>
                        {LETTERS[weekdayOf(one.local_date)]}
                      </Text>
                    ) : null}
                  </View>
                )
              })}
            </View>
          </View>
          {emptyNote ? (
            <Text role="body" size="xs" color="muted">
              {emptyNote}
            </Text>
          ) : null}
        </View>

        <View style={styles.macros}>
          {(['protein', 'carbohydrates', 'fat'] as const).map((code) => {
            const mean = averageOfLogged(days, code)
            const target = goal.find((one) => one.nutrient_code === code)
            return (
              <View
                key={code}
                style={[
                  styles.macro,
                  {
                    backgroundColor: theme.color.background.surface,
                    borderColor: theme.color.border.subtle,
                  },
                ]}
              >
                <View style={styles.macroHead}>
                  <View style={[styles.swatch, { backgroundColor: macroColor(theme, code) }]} />
                  <Text role="eyebrow" size="2xs" color="muted" uppercase>
                    {NUTRIENT_SHORT_NAMES[code]}
                  </Text>
                </View>
                <Text role="poster" tracking={FIGURE_TRACKING} size="2xl">
                  {mean.value === null ? '—' : `${String(mean.value)} g`}
                </Text>
                <Text role="body" size="xs" color="muted">
                  {target ? `De ${goalFigure(target).label} g` : 'Sin meta'}
                </Text>
              </View>
            )
          })}
        </View>

        <Text role="control" size="lg">
          Día a día
        </Text>
        {newestFirst.map((one) => {
          const dayMeals = meals.filter((meal) => meal.local_date === one.local_date)
          const title = dayTitle(one.local_date, today)
          const plain = `${WEEKDAYS[weekdayOf(one.local_date)] ?? ''} ${String(Number(one.local_date.slice(8)))}`
          return (
            <View
              key={one.local_date}
              style={[
                styles.dayRow,
                {
                  backgroundColor: theme.color.background.surface,
                  borderColor: theme.color.border.subtle,
                },
              ]}
            >
              {one.meal_count === 0 ? (
                <View style={styles.stack}>
                  <View style={[styles.emptyMark, { borderColor: theme.color.border.default }]}>
                    <FoundationIcon
                      name="subtract"
                      size="sm"
                      color={theme.color.icon.secondary}
                      decorative
                    />
                  </View>
                </View>
              ) : (
                <View style={styles.stack}>
                  {dayMeals.slice(0, 3).map((meal, index) => (
                    <View
                      key={meal.id}
                      style={[
                        styles.stacked,
                        {
                          marginLeft: index === 0 ? 0 : -14,
                          borderColor: theme.color.background.surface,
                        },
                      ]}
                    >
                      <MealThumb meal={meal} size={40} />
                    </View>
                  ))}
                </View>
              )}
              <View style={styles.grow}>
                <Text role="control" size="md">
                  {title}
                </Text>
                <Text role="body" size="sm" color="muted">
                  {one.meal_count === 0
                    ? 'Sin registro'
                    : `${title === 'Hoy' || title === 'Ayer' ? `${plain} · ` : ''}${String(one.meal_count)} ${one.meal_count === 1 ? 'comida' : 'comidas'}`}
                </Text>
              </View>
              {one.meal_count > 0 ? (
                <Text role="poster" tracking={FIGURE_TRACKING} size="xl">
                  {Math.round(eatenFor(one, 'energy')).toLocaleString('es-CO')}
                  <Text role="body" size="xs" color="muted">
                    {' kcal'}
                  </Text>
                </Text>
              ) : null}
            </View>
          )
        })}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  grow: { flex: 1, gap: 2 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 10,
  },
  spans: { paddingHorizontal: 20, paddingBottom: 10 },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 12 },
  card: { borderRadius: 24, borderWidth: 1, padding: 18, gap: 10 },
  averageRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  averageFigure: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  averageNumber: { paddingRight: 4 },
  averageUnit: { paddingBottom: 6 },
  chart: { paddingTop: 18 },
  goalLine: { position: 'absolute', left: 0, right: 0, borderTopWidth: 1 },
  goalLabel: { position: 'absolute', right: 0, top: -22 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  barColumn: { flex: 1, alignItems: 'center', gap: 6 },
  barTrack: { width: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  bar: { width: '80%', borderRadius: 8 },
  macros: { flexDirection: 'row', gap: 10 },
  macro: { flex: 1, borderRadius: 18, borderWidth: 1, padding: 12, gap: 4 },
  macroHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 8, height: 8, borderRadius: 2 },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 20,
    borderWidth: 1,
    padding: 14,
  },
  stack: { flexDirection: 'row', width: 92 },
  stacked: { borderRadius: 16, borderWidth: 2 },
  emptyMark: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
