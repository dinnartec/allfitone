/**
 * Comida: the day's line (N-1e, HU-SP-068, HU-SP-071, ADR-040).
 *
 * **What is left, before what was eaten.** The card leads with the kcal the day still has
 * room for against the goal, and the eaten share as a ring; the three macro cards say the
 * same of protein, carbohydrates and fat, and slide on to fibre and water. Without a goal
 * the card says what was eaten and offers to set one: a remainder against nothing is not
 * a number.
 *
 * **The day is a line in time**: meals at their hour, the day's workouts among them, a
 * mark at now, and the meal the hour is asking for with what is left for it. Every
 * figure here is the server's sum of what was written; nothing missing becomes a zero.
 *
 * The week above it picks the day. The header stays put; the day scrolls.
 */

import { IconButton } from '@allfitone/react-native/icon-button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { PageDots } from '@allfitone/react-native/page-dots'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import * as Haptics from 'expo-haptics'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native'
import Animated, { FadeInDown, FadeOut, ReduceMotion } from 'react-native-reanimated'

import type { HistoryItem } from '../../src/client/history'
import { mondayOf } from '../../src/client/history'
import { createSpaceExecutionFlow } from '../../src/client/execution-transport'
import {
  dayTitle,
  eatenFor,
  goalFigure,
  mealPrompt,
  mealTotals,
  MEAL_NAMES,
  NUTRIENT_SHORT_NAMES,
  remainingFor,
  type DailySummary,
  type GoalTarget,
  type Goals,
  type NutrientCode,
  type NutritionMeal,
} from '../../src/client/nutrition'
import { createSpaceNutritionFlow } from '../../src/client/nutrition-transport'
import { twelveHour } from '../../src/client/finished'
import { takeSavedMeal, type SavedMeal } from '../../src/client/saved-meal'
import { deviceTimezone } from '../../src/client/timezone'
import { trainedLabel } from '../../src/client/week'
import {
  FIGURE_TRACKING,
  macroColor,
  CardGlow,
  MacroDots,
  MealThumb,
  PulsingPlus,
  Ring,
} from '../../src/components/nutrition-ui'
import { DOCK_HEIGHT } from '../../src/components/tab-bar'

const READ_FAILED = 'No pudimos cargar tu día. Inténtalo otra vez.'
const WEEK_LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const

const localDay = (timeZone: string, at = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(at)
const plusDays = (iso: string, days: number) => {
  const at = new Date(`${iso}T12:00:00Z`)
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}
const clock = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso))
const kcal = (value: number) => Math.round(value).toLocaleString('es-CO')

type LineEntry =
  | { readonly kind: 'meal'; readonly at: string; readonly meal: NutritionMeal }
  | { readonly kind: 'workout'; readonly at: string; readonly workout: HistoryItem }

export default function FoodScreen() {
  const router = useRouter()
  const theme = useTheme()
  const timeZone = useMemo(() => deviceTimezone(), [])
  const nutrition = useMemo(() => createSpaceNutritionFlow(), [])
  const training = useMemo(() => createSpaceExecutionFlow(), [])
  const today = localDay(timeZone)

  const [day, setDay] = useState(today)
  const [week, setWeek] = useState<readonly DailySummary[]>([])
  const [streak, setStreak] = useState(0)
  const [meals, setMeals] = useState<readonly NutritionMeal[]>([])
  const [workouts, setWorkouts] = useState<readonly HistoryItem[]>([])
  const [goals, setGoals] = useState<Goals>({ active: null, proposals: [] })
  const [failure, setFailure] = useState<string | undefined>(undefined)
  // R-F5 / R-A5: the meal just saved, offered back for a few seconds.
  const [saved, setSaved] = useState<SavedMeal | null>(null)
  const [version, setVersion] = useState(0)

  const monday = mondayOf(day)

  useEffect(() => {
    if (!saved) return
    const timer = setTimeout(() => setSaved(null), 6000)
    return () => clearTimeout(timer)
  }, [saved])

  useFocusEffect(
    useCallback(() => {
      let active = true
      const handed = takeSavedMeal()
      if (handed) setSaved(handed)
      Promise.all([
        nutrition.readDays(monday, plusDays(monday, 6), timeZone),
        nutrition.listMeals(day, day),
        nutrition.readGoals(),
        training.listHistory({ timezone: timeZone, day, limit: 20 }).catch(() => undefined),
      ])
        .then(([days, page, read, history]) => {
          if (!active) return
          setWeek(days.data)
          setStreak(days.streak_days)
          setMeals(page.data)
          setGoals(read)
          setWorkouts(history?.data ?? [])
          setFailure(undefined)
        })
        .catch(() => active && setFailure(READ_FAILED))
      return () => {
        active = false
      }
    }, [nutrition, training, monday, day, timeZone, version]),
  )

  const undo = (meal: SavedMeal) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setSaved(null)
    nutrition
      .deleteMeal(meal.id)
      .then(() => setVersion((current) => current + 1))
      .catch(() => setFailure(READ_FAILED))
  }

  const summary = week.find((one) => one.local_date === day)
  const target = (code: NutrientCode) =>
    goals.active?.targets.find((one) => one.nutrient_code === code)
  const energy = target('energy')
  const eatenEnergy = eatenFor(summary, 'energy')
  const left = (code: NutrientCode) => {
    const goal = target(code)
    return goal ? remainingFor(goal, eatenFor(summary, code)).left : null
  }

  const line: readonly LineEntry[] = [
    ...meals.map((meal) => ({ kind: 'meal' as const, at: meal.occurred_at, meal })),
    ...workouts.map((workout) => ({ kind: 'workout' as const, at: workout.started_at, workout })),
  ].sort((one, other) => one.at.localeCompare(other.at))
  const pending = goals.proposals.find((one) => one.status === 'proposed')
  const prompt = mealPrompt(
    new Date().toISOString(),
    timeZone,
    { energy: left('energy'), protein: left('protein') },
    meals.map((meal) => meal.meal_type),
  )

  // R-0: the camera is the way in; typing by hand is its «Plato» tab.
  const log = (type?: string) =>
    router.push({ pathname: '/nutrition/capture', params: { day, ...(type ? { type } : {}) } })

  return (
    <Screen edges={['top']} padded={false}>
      <View style={styles.header}>
        <View style={[styles.streak, { backgroundColor: theme.color.background.surfaceMuted }]}>
          <FoundationIcon name="burn" size="xs" color={theme.color.icon.accent} decorative />
          <Text
            role="control"
            size="sm"
            color="accent"
            accessibilityLabel={`Racha de ${String(streak)} días`}
          >
            {String(streak)}
          </Text>
        </View>
        <Text role="control" size="lg" style={styles.headerTitle} accessibilityRole="header">
          {dayTitle(day, today)}
        </Text>
        <IconButton
          icon="history"
          accessibilityLabel="Historial de comidas"
          onPress={() => router.push('/nutrition/history')}
        />
        <IconButton
          icon="target"
          accessibilityLabel="Mi meta"
          onPress={() => router.push('/nutrition/goal')}
        />
      </View>

      <View style={styles.week}>
        {Array.from({ length: 7 }, (_, index) => {
          const date = plusDays(monday, index)
          const logged = (week.find((one) => one.local_date === date)?.meal_count ?? 0) > 0
          const picked = date === day
          const future = date > today
          return (
            <Pressable
              key={date}
              accessibilityRole="button"
              accessibilityState={{ selected: picked, disabled: future }}
              accessibilityLabel={dayTitle(date, today)}
              disabled={future}
              onPress={() => setDay(date)}
              style={styles.weekDay}
            >
              <Text role="eyebrow" size="2xs" color="muted">
                {WEEK_LETTERS[index]}
              </Text>
              <View
                style={[
                  styles.weekNumber,
                  {
                    backgroundColor: picked ? theme.color.icon.accent : 'transparent',
                    borderColor: picked ? 'transparent' : theme.color.border.subtle,
                    opacity: future ? 0.4 : 1,
                  },
                ]}
              >
                <Text role="control" size="sm" color={picked ? 'inverse' : 'primary'}>
                  {String(Number(date.slice(8)))}
                </Text>
              </View>
              <View
                style={[
                  styles.weekDot,
                  { backgroundColor: logged ? theme.color.icon.accent : 'transparent' },
                ]}
              />
            </Pressable>
          )
        })}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {failure ? <InlineAlert message={failure} /> : null}

        {pending ? (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.push({ pathname: '/nutrition/proposal/[id]', params: { id: pending.id } })
            }
            style={[
              styles.proposal,
              {
                backgroundColor: theme.color.background.surface,
                borderColor: theme.color.border.accent,
              },
            ]}
          >
            <FoundationIcon name="target" size="sm" color={theme.color.icon.accent} decorative />
            <Text role="body" size="sm" style={styles.grow}>
              {`${proposerOf(pending.author)} te propone una meta`}
            </Text>
            <FoundationIcon name="next" size="xs" color={theme.color.icon.secondary} decorative />
          </Pressable>
        ) : null}

        <EnergyCard
          goal={energy}
          eaten={eatenEnergy}
          onSetGoal={() => router.push('/nutrition/goal')}
        />

        <MacroCards summary={summary} target={target} />

        <View style={styles.line}>
          {line.map((entry) =>
            entry.kind === 'meal' ? (
              <LineRow key={entry.meal.id} time={clock(entry.at, timeZone)}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    router.push({
                      pathname: '/nutrition/[mealId]',
                      params: { mealId: entry.meal.id },
                    })
                  }
                  style={[
                    styles.mealCard,
                    {
                      backgroundColor: theme.color.background.surface,
                      borderColor: theme.color.border.subtle,
                    },
                  ]}
                >
                  <MealThumb meal={entry.meal} size={64} />
                  <View style={styles.grow}>
                    <View style={styles.mealHead}>
                      <Text role="control" size="lg">
                        {MEAL_NAMES[entry.meal.meal_type]}
                      </Text>
                      {mealTotals(entry.meal.items).energy !== undefined ? (
                        <Text role="poster" tracking={FIGURE_TRACKING} size="lg">
                          {kcal(mealTotals(entry.meal.items).energy ?? 0)}
                          <Text role="body" size="xs" color="muted">
                            {' kcal'}
                          </Text>
                        </Text>
                      ) : null}
                    </View>
                    <MacroDots totals={mealTotals(entry.meal.items)} />
                    <Text role="body" size="xs" color="muted">
                      {`${String(entry.meal.items.length)} ${entry.meal.items.length === 1 ? 'alimento' : 'alimentos'}`}
                    </Text>
                  </View>
                </Pressable>
              </LineRow>
            ) : (
              <LineRow
                key={entry.workout.executed_session_id}
                time={clock(entry.at, timeZone)}
                accent
              >
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    router.push({
                      pathname: '/history/[executionId]',
                      params: { executionId: entry.workout.executed_session_id },
                    })
                  }
                  style={[
                    styles.workout,
                    {
                      backgroundColor: `${theme.color.icon.accent}14`,
                      borderColor: `${theme.color.icon.accent}40`,
                    },
                  ]}
                >
                  <View style={styles.grow}>
                    <Text role="control" size="md">
                      {entry.workout.title ?? 'Entreno libre'}
                    </Text>
                    <Text role="body" size="sm" color="accent">
                      {`${trainedLabel(entry.workout.duration_seconds)} · ${String(entry.workout.work_sets)} series`}
                    </Text>
                  </View>
                  <View
                    style={[styles.workoutTag, { borderColor: `${theme.color.icon.accent}55` }]}
                  >
                    <FoundationIcon
                      name="training"
                      size="xs"
                      color={theme.color.icon.accent}
                      decorative
                    />
                    <Text role="control" size="xs" color="accent">
                      Entreno
                    </Text>
                  </View>
                </Pressable>
              </LineRow>
            ),
          )}

          <LineRow
            time={day === today ? clock(new Date().toISOString(), timeZone) : 'Añadir'}
            accent={day === today}
          >
            <Pressable
              accessibilityRole="button"
              onPress={() => log(day === today ? prompt.type : undefined)}
              style={[
                styles.prompt,
                // Lighter than a logged meal: a card still waiting to be filled (R-0).
                {
                  backgroundColor: `${theme.color.text.primary}08`,
                  borderColor: `${theme.color.text.primary}2E`,
                },
              ]}
            >
              <View style={styles.grow}>
                <Text role="control" size="md">
                  {day === today ? prompt.title : 'Registrar una comida'}
                </Text>
                {day === today && prompt.detail ? (
                  <Text role="body" size="sm" color="secondary">
                    {prompt.detail}
                  </Text>
                ) : null}
              </View>
              {day === today ? (
                <PulsingPlus>
                  <FoundationIcon
                    name="add"
                    size="md"
                    color={theme.color.text.inverse}
                    decorative
                  />
                </PulsingPlus>
              ) : (
                <View style={[styles.plus, { backgroundColor: theme.color.icon.accent }]}>
                  <FoundationIcon
                    name="add"
                    size="md"
                    color={theme.color.text.inverse}
                    decorative
                  />
                </View>
              )}
            </Pressable>
          </LineRow>
        </View>
      </ScrollView>
      {saved ? (
        <Animated.View
          entering={FadeInDown.duration(240).reduceMotion(ReduceMotion.System)}
          exiting={FadeOut.duration(160)}
          style={[styles.saved, { backgroundColor: theme.color.status.success }]}
          accessibilityLiveRegion="polite"
        >
          <FoundationIcon name="success" size="sm" color={theme.color.text.inverse} decorative />
          <Text role="control" size="md" color="inverse" style={styles.grow}>
            {`${saved.label} guardada${saved.kcal === null ? '' : ` · ${String(Math.round(saved.kcal))} kcal`}`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Deshacer: borrar la ${saved.label.toLowerCase()}`}
            onPress={() => undo(saved)}
            hitSlop={10}
          >
            <Text role="control" size="md" color="inverse">
              Deshacer
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </Screen>
  )
}

const proposerOf = (author: Goals['proposals'][number]['author']) =>
  ('display_name' in author && typeof author.display_name === 'string'
    ? author.display_name
    : null) ?? 'Tu profesional'

function EnergyCard({
  goal,
  eaten,
  onSetGoal,
}: {
  readonly goal: GoalTarget | undefined
  readonly eaten: number
  readonly onSetGoal: () => void
}) {
  const theme = useTheme()
  const remaining = goal ? remainingFor(goal, eaten) : null
  return (
    <View
      style={[
        styles.energy,
        { backgroundColor: theme.color.background.surface, borderColor: theme.color.border.subtle },
      ]}
    >
      <CardGlow />
      <View style={styles.grow}>
        <View style={styles.energyFigure}>
          <Text role="display" tracking={FIGURE_TRACKING} size="5xl" style={styles.energyNumber}>
            {kcal(remaining ? remaining.left : eaten)}
          </Text>
          <Text role="control" size="md" color="secondary" style={styles.energyUnit}>
            kcal
          </Text>
        </View>
        <Text role="body" size="md">
          {remaining ? 'Restante para hoy' : 'Consumido hoy'}
        </Text>
        {goal ? (
          <Text role="body" size="sm" color="muted">
            {`Consumido ${kcal(eaten)} · Meta ${goalFigure(goal).label}`}
          </Text>
        ) : (
          <Pressable accessibilityRole="button" onPress={onSetGoal} hitSlop={8}>
            <Text role="control" size="sm" color="accent">
              Fija tu meta
            </Text>
          </Pressable>
        )}
      </View>
      {remaining ? (
        <Ring size={104} stroke={10} share={remaining.share} color={theme.color.icon.accent}>
          <Text role="poster" tracking={FIGURE_TRACKING} size="xl">
            {`${String(Math.round(remaining.share * 100))}%`}
          </Text>
          <Text role="body" size="xs" color="muted">
            Consumido
          </Text>
        </Ring>
      ) : null}
    </View>
  )
}

/** Three cards a page: the macros, then fibre and water. */
function MacroCards({
  summary,
  target,
}: {
  readonly summary: DailySummary | undefined
  readonly target: (code: NutrientCode) => GoalTarget | undefined
}) {
  const theme = useTheme()
  const { width } = useWindowDimensions()
  const [page, setPage] = useState(0)
  const pages: readonly (readonly NutrientCode[])[] = [
    ['protein', 'carbohydrates', 'fat'],
    ['fiber', 'water'],
  ]
  const pageWidth = width - 40
  return (
    <View style={styles.macros}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) =>
          setPage(Math.round(event.nativeEvent.contentOffset.x / pageWidth))
        }
        style={{ width: pageWidth }}
      >
        {pages.map((codes) => (
          <View key={codes.join()} style={[styles.macroPage, { width: pageWidth }]}>
            {codes.map((code) => {
              const goal = target(code)
              const eaten = eatenFor(summary, code)
              const unit = code === 'water' ? 'ml' : 'g'
              const remaining = goal ? remainingFor(goal, eaten) : null
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
                  <View style={styles.macroTop}>
                    <Text role="poster" tracking={FIGURE_TRACKING} size="2xl">
                      {String(Math.round(remaining ? remaining.left : eaten))}
                      <Text role="body" size="xs" color="muted">{` ${unit}`}</Text>
                    </Text>
                    <Ring
                      size={36}
                      stroke={4}
                      share={remaining?.share ?? 0}
                      color={macroColor(theme, code)}
                    />
                  </View>
                  <Text
                    role="control"
                    size="xs"
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.85}
                    style={{ color: macroColor(theme, code) }}
                  >
                    {remaining
                      ? `${NUTRIENT_SHORT_NAMES[code]} ${code === 'carbohydrates' ? 'restantes' : 'restante'}`
                      : NUTRIENT_SHORT_NAMES[code]}
                  </Text>
                  <Text role="body" size="xs" color="muted">
                    {goal
                      ? `${String(Math.round(eaten))} de ${goalFigure(goal).label} ${unit}`
                      : 'Sin meta'}
                  </Text>
                </View>
              )
            })}
          </View>
        ))}
      </ScrollView>
      <PageDots
        count={pages.length}
        active={page}
        accessibilityLabel={`Página ${String(page + 1)} de ${String(pages.length)}`}
      />
    </View>
  )
}

function LineRow({
  time,
  accent = false,
  children,
}: {
  readonly time: string
  readonly accent?: boolean
  readonly children: React.ReactNode
}) {
  const theme = useTheme()
  // A clock reads in twelve hours with its half of the day beneath; «Añadir» reads as it is.
  const shown = /^\d{2}:\d{2}$/.test(time) ? twelveHour(time) : null
  return (
    <View style={styles.lineRow}>
      <View style={styles.lineTime}>
        <View style={styles.lineClock}>
          <Text
            role="poster"
            tracking={FIGURE_TRACKING}
            size="md"
            color={accent ? 'accent' : 'secondary'}
          >
            {shown ? shown.time : time}
          </Text>
          {shown ? (
            <Text role="body" size="2xs" color={accent ? 'accent' : 'muted'}>
              {shown.period}
            </Text>
          ) : null}
        </View>
        <View
          style={[
            styles.node,
            {
              borderColor: accent ? theme.color.icon.accent : theme.color.border.default,
              backgroundColor: accent ? theme.color.icon.accent : theme.color.background.canvas,
            },
          ]}
        />
      </View>
      <View style={styles.grow}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  saved: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: DOCK_HEIGHT + 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
  },
  headerTitle: { flex: 1, textAlign: 'center' },
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  week: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  weekDay: { alignItems: 'center', gap: 4, minWidth: 40 },
  weekNumber: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekDot: { width: 5, height: 5, borderRadius: 3 },
  content: { paddingHorizontal: 20, paddingBottom: DOCK_HEIGHT + 40, gap: 14 },
  proposal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  energy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 24,
    borderWidth: 1,
    padding: 20,
    overflow: 'hidden',
  },
  energyFigure: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  energyNumber: { paddingRight: 4 },
  energyUnit: { paddingBottom: 8 },
  macros: { gap: 8, alignItems: 'center' },
  macroPage: { flexDirection: 'row', gap: 10 },
  macro: { flex: 1, borderRadius: 18, borderWidth: 1, padding: 12, gap: 4 },
  macroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  line: { gap: 12, paddingTop: 4 },
  lineRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  lineTime: {
    width: 62,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  lineClock: { alignItems: 'flex-end' },
  node: { width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  mealCard: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    padding: 10,
  },
  mealHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  workout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
  },
  workoutTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  prompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 20,
    borderWidth: 1,
    padding: 14,
  },
  plus: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, gap: 4 },
})
