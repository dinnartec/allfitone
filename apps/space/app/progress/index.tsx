/**
 * «Progreso» (`PROG-2`, HU-SP-061): the person's training, this period against the one
 * before, week by week or month by month.
 *
 * The volume card is the Comida hero in another key — a big figure, what changed, and a
 * line underneath — because both say «where you stand» and should read alike. The line
 * adds the volume up day by day, this period over the last one dashed, so a Thursday
 * reads against last Thursday and not against a whole week still to come.
 *
 * It is Pro (`period_analysis`). Without it the screen does not pretend: the cards stay
 * behind a blur with nothing real in them, and the offer says what Pro opens. The
 * database refuses the comparison anyway; the blur is only so nobody meets a refusal.
 *
 * Muscles count each set to the movement's primary muscle, the rule the routine cards
 * already follow, so the same session never reads two ways in two screens.
 */

import { Badge } from '@allfitone/react-native/badge'
import { Button } from '@allfitone/react-native/button'
import { IconButton } from '@allfitone/react-native/icon-button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Sheet } from '@allfitone/react-native/sheet'
import { SegmentedControl } from '@allfitone/react-native/segmented-control'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { BlurView } from 'expo-blur'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import Animated, {
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg'

import { createSpaceContentFlow } from '../../src/client/content-transport'
import { readExerciseLibrary } from '../../src/client/exercise-library'
import { litSlugsFor } from '../../src/client/exercise-catalogue'
import { INERT_SLUGS } from '../../src/client/focus-form'
import { opens } from '../../src/client/plan'
import { selectionTick } from '../../src/client/selection-tick'
import {
  cumulativeVolume,
  formatKilos,
  liftedUp,
  movementsAt,
  muscleRows,
  percentChange,
  periodLabel,
  periodStart,
  previousStart,
  programOptions,
  sparkline,
  untrained,
  type Period,
  type PeriodComparison,
  type PeriodKind,
  type PeriodMovement,
  type ProgramOption,
} from '../../src/client/progress'
import { comparePeriods } from '../../src/client/progress-transport'
import { deviceTimezone } from '../../src/client/timezone'
import { BodyFigure } from '../../src/components/body-figure'
import { CardGlow, FIGURE_TRACKING, Ring } from '../../src/components/nutrition-ui'
import { refusedFeature, usePlan, useUpgradeSheet } from '../../src/components/upgrade-sheet'

/** Six periods: the two compared, and four more so a movement's trend has a shape. */
const PERIODS = 6
const CHART_HEIGHT = 104
const SPARK_WIDTH = 56
const SPARK_HEIGHT = 22
const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const

const READ_FAILED = 'No pudimos cargar tu progreso. Inténtalo otra vez.'

const AnimatedPath = Animated.createAnimatedComponent(Path)

function localToday(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
}

type Muscles = Awaited<ReturnType<typeof readExerciseLibrary>>['muscles']

export default function ProgressScreen() {
  const router = useRouter()
  const theme = useTheme()
  const timezone = deviceTimezone()
  const today = localToday(timezone)
  const features = usePlan()
  const upgrade = useUpgradeSheet(features)
  const { offer } = upgrade
  // The plan arrives after the first read; a refusal for this function means Gratis.
  const [refused, setRefused] = useState(false)
  const open = opens(features, 'period_analysis') && !refused

  const [kind, setKind] = useState<PeriodKind>('week')
  const [comparison, setComparison] = useState<PeriodComparison | undefined>(undefined)
  const [muscles, setMuscles] = useState<Muscles>([])
  /** How many periods back from the latest; 0 is this one. */
  const [offset, setOffset] = useState(0)
  /** An assignment id, `free`, or null for everything (PROG-4a). */
  const [program, setProgram] = useState<string | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useFocusEffect(
    useCallback(() => {
      if (!open) return undefined
      let active = true
      setFailure(undefined)
      Promise.all([
        comparePeriods(kind, PERIODS, timezone, program),
        readExerciseLibrary(createSpaceContentFlow()).catch(() => undefined),
      ])
        .then(([read, library]) => {
          if (!active) return
          setComparison(read)
          setMuscles(library?.muscles ?? [])
        })
        .catch((cause: unknown) => {
          if (!active) return
          if (refusedFeature(cause) === 'period_analysis') setRefused(true)
          else setFailure(READ_FAILED)
        })
      return () => {
        active = false
      }
    }, [open, kind, timezone, program]),
  )

  const index = comparison ? comparison.periods.length - 1 - offset : -1
  const current = comparison?.periods[index]
  const previous = comparison?.periods[index - 1]

  const start = current?.starts_on ?? periodStart(today, kind)
  const before = previous?.starts_on ?? previousStart(start, kind)
  const oldest = !comparison || index <= 1
  const options = comparison ? programOptions(comparison.programs, comparison.periods, index) : []
  const chosen = options.find((option) => option.key === program) ?? options[0]

  const share = () => {
    if (!open || !current) {
      offer('period_analysis')
      return
    }
    router.push({
      pathname: '/progress/share',
      params: { kind, offset: String(offset), ...(program ? { program } : {}) },
    })
  }

  return (
    <Screen edges={['top', 'bottom']} padded={false}>
      <View style={styles.header}>
        <IconButton
          icon="back"
          accessibilityLabel="Volver"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/profile'))}
        />
        <View style={styles.titles}>
          <Text role="control" size="xl" accessibilityRole="header" align="center">
            Progreso
          </Text>
          {/* What is being read, under the title, as Apple's Health and Fitness do. */}
          {chosen ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Ver el progreso de: ${chosen.label}. Cambiar`}
              hitSlop={10}
              testID="progress-program"
              onPress={() => setChoosing(true)}
              style={styles.program}
            >
              <View
                style={[
                  styles.programDot,
                  {
                    backgroundColor: programColor(
                      theme,
                      chosen.key,
                      options.findIndex((option) => option.key === chosen.key),
                    ),
                  },
                ]}
              />
              <Text role="control" size="xs" color="accent" numberOfLines={1}>
                {chosen.label}
              </Text>
              <FoundationIcon name="expand" size="xs" color={theme.color.icon.accent} decorative />
            </Pressable>
          ) : null}
        </View>
        <IconButton icon="share" accessibilityLabel="Compartir tu progreso" onPress={share} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <SegmentedControl
          items={[
            { value: 'week', label: 'Semana' },
            { value: 'month', label: 'Mes' },
          ]}
          value={kind}
          onChange={(next) => {
            setOffset(0)
            setKind(next)
          }}
          accessibilityLabel="Comparar por"
        />
        <View style={styles.period}>
          <IconButton
            icon="back"
            variant="plain"
            size="sm"
            accessibilityLabel={kind === 'week' ? 'Semana anterior' : 'Mes anterior'}
            disabled={oldest}
            onPress={() => setOffset(offset + 1)}
            style={oldest ? styles.off : null}
          />
          <View style={styles.periodText}>
            <Text role="control" size="md">
              {periodLabel(start, kind)}
            </Text>
            <Text role="body" size="xs" color="muted">
              {`Frente a ${periodLabel(before, kind)}`}
            </Text>
          </View>
          <IconButton
            icon="forward"
            variant="plain"
            size="sm"
            accessibilityLabel={kind === 'week' ? 'Semana siguiente' : 'Mes siguiente'}
            disabled={offset === 0}
            onPress={() => setOffset(offset - 1)}
            style={offset === 0 ? styles.off : null}
          />
        </View>
        {failure ? <InlineAlert message={failure} /> : null}
        {open && comparison && current ? (
          <Comparison
            current={current}
            previous={previous}
            movements={movementsAt(comparison.movements, index)}
            muscles={muscles}
            kind={kind}
            today={today}
          />
        ) : !open ? (
          <ProVeil kind={kind} today={today} onUpgrade={() => router.push('/pro/plans')} />
        ) : null}
      </ScrollView>
      <Sheet visible={choosing} onDismiss={() => setChoosing(false)} title="Ver el progreso de">
        <View style={styles.options}>
          {options.map((option, position) => (
            <ProgramChoice
              key={option.key ?? 'all'}
              option={option}
              color={programColor(theme, option.key, position)}
              selected={option.key === (chosen?.key ?? null)}
              onPress={() => {
                selectionTick()
                setProgram(option.key)
                setChoosing(false)
              }}
            />
          ))}
        </View>
      </Sheet>
      {upgrade.sheet}
    </Screen>
  )
}

/** Each programme keeps a colour of its own: the same dot under the title and in the sheet. */
function programColor(
  theme: ReturnType<typeof useTheme>,
  key: string | null,
  position: number,
): string {
  if (key === null) return theme.color.icon.accent
  if (key === 'free') return theme.color.icon.secondary
  const palette = [
    theme.color.icon.accent,
    theme.color.discipline.highIntensity,
    theme.color.discipline.rhythm,
    theme.color.discipline.wellbeing,
  ]
  return palette[(position - 1) % palette.length] ?? theme.color.icon.accent
}

/** One choice of the sheet, as `PROG-4` draws it: a card, its dot, done of planned. */
function ProgramChoice({
  option,
  color,
  selected,
  onPress,
}: {
  readonly option: ProgramOption
  readonly color: string
  readonly selected: boolean
  readonly onPress: () => void
}) {
  const theme = useTheme()
  const figure =
    option.planned === null
      ? String(option.done)
      : `${String(option.done)} de ${String(option.planned)}`
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${option.label}. ${option.caption}. ${figure}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        selected
          ? { backgroundColor: theme.color.accent.tonal, borderColor: theme.color.border.accent }
          : {
              backgroundColor: theme.color.background.surface,
              borderColor: theme.color.border.subtle,
            },
        pressed ? styles.pressed : null,
      ]}
    >
      {option.key === null ? (
        <FoundationIcon name="overview" size="sm" color={theme.color.icon.accent} decorative />
      ) : (
        <View style={[styles.choiceDot, { backgroundColor: color }]} />
      )}
      <View style={styles.grow}>
        <Text role="control" size="sm" color={selected ? 'accent' : 'primary'}>
          {option.label}
        </Text>
        <Text role="body" size="xs" color="secondary">
          {option.caption}
        </Text>
      </View>
      <Text role="poster" tracking={FIGURE_TRACKING} size="lg" color="secondary">
        {figure}
      </Text>
      {selected ? (
        <FoundationIcon name="check" size="sm" color={theme.color.icon.accent} decorative />
      ) : null}
    </Pressable>
  )
}

function Comparison({
  current,
  previous,
  movements,
  muscles,
  kind,
  today,
}: {
  readonly current: Period
  readonly previous: Period | undefined
  readonly movements: readonly PeriodMovement[]
  readonly muscles: Muscles
  readonly kind: PeriodKind
  readonly today: string
}) {
  const rows = muscleRows(current)
  const missing = untrained(current, previous)
  const lit = litSlugsFor(
    muscles,
    rows.map((row) => row.code),
  )
  const risen = liftedUp(movements).slice(0, 3)

  return (
    <View style={styles.sections}>
      <VolumeCard
        kind={kind}
        today={today}
        days={[...(previous?.days ?? []), ...current.days]}
        current={current}
        previous={previous}
      />
      <View style={styles.tiles}>
        <Tile
          value={String(current.sessions)}
          label="Sesiones"
          detail={current.planned > 0 ? `De ${String(current.planned)} planeadas` : 'Sin plan'}
          share={current.planned > 0 ? current.fulfilled / current.planned : 0}
          tone="strength"
        />
        <Tile
          value={String(Math.round(current.trained_seconds / 60))}
          label="Minutos"
          detail={changeLine(
            current.trained_seconds / 60,
            previous ? previous.trained_seconds / 60 : null,
            'min',
          )}
          share={
            previous && previous.trained_seconds > 0
              ? current.trained_seconds / previous.trained_seconds
              : 0
          }
          tone="highIntensity"
        />
        <Tile
          value={String(current.work_sets)}
          label="Series"
          detail={changeLine(current.work_sets, previous?.work_sets ?? null, 'series')}
          share={previous && previous.work_sets > 0 ? current.work_sets / previous.work_sets : 0}
          tone="rhythm"
        />
      </View>

      <SectionTitle
        title={kind === 'week' ? 'Músculos de la semana' : 'Músculos del mes'}
        extra="Series"
      />
      <MusclesCard rows={rows} lit={lit} missing={missing} />

      {risen.length > 0 ? (
        <>
          <SectionTitle title="Cargas que subieron" />
          <LoadsCard movements={risen} />
        </>
      ) : null}
    </View>
  )
}

/** «+25 min», «−6 series», or how much there was when nothing came before. */
function changeLine(current: number, previous: number | null, unit: string): string {
  if (previous === null) return `${String(Math.round(current))} ${unit}`
  const change = Math.round(current - previous)
  if (change === 0) return 'Igual que antes'
  return `${change > 0 ? '+' : '−'}${String(Math.abs(change))} ${unit}`
}

function VolumeCard({
  kind,
  today,
  days,
  current,
  previous,
}: {
  readonly kind: PeriodKind
  readonly today: string
  readonly days: Period['days']
  readonly current: NonNullable<PeriodComparison['periods'][number]>
  readonly previous: PeriodComparison['periods'][number] | undefined
}) {
  const theme = useTheme()
  const [width, setWidth] = useState(0)
  const change = percentChange(current.volume_kg, previous?.volume_kg ?? null)
  const now = cumulativeVolume(days, current.starts_on, kind, today)
  const before = previous ? cumulativeVolume(days, previous.starts_on, kind, today) : []

  return (
    <View
      style={[
        styles.hero,
        { backgroundColor: theme.color.background.surface, borderColor: theme.color.border.subtle },
      ]}
    >
      <CardGlow />
      <View style={styles.heroTop}>
        <Text role="control" size="2xs" color="muted" uppercase tracking={0.12}>
          Volumen levantado
        </Text>
        <View style={styles.legend}>
          <Legend label="Esta" color={theme.color.icon.accent} />
          <Legend label="Anterior" color={theme.color.text.muted} />
        </View>
      </View>
      <View style={styles.figure}>
        <Text role="display" tracking={FIGURE_TRACKING} size="6xl">
          {current.volume_kg === null ? '—' : formatKilos(current.volume_kg)}
        </Text>
        <Text role="control" size="lg" color="secondary" style={styles.unit}>
          kg
        </Text>
      </View>
      {change !== null ? (
        <View style={styles.change}>
          <FoundationIcon name="progress" size="sm" color={theme.color.icon.accent} decorative />
          <Text role="control" size="xs" color="accent">
            {`${change > 0 ? '+' : ''}${String(change)} % frente ${kind === 'week' ? 'a la semana pasada' : 'al mes pasado'}`}
          </Text>
        </View>
      ) : null}
      <View onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}>
        {width > 0 ? <CumulativeChart width={width} now={now} before={before} /> : null}
        <View style={styles.axis}>
          {axisLabels(kind, now.length).map((label, index) => (
            <Text
              key={`${label}-${String(index)}`}
              role="control"
              size="2xs"
              color="muted"
              style={styles.axisLabel}
            >
              {label}
            </Text>
          ))}
        </View>
      </View>
    </View>
  )
}

function axisLabels(kind: PeriodKind, days: number): readonly string[] {
  if (kind === 'week') return WEEKDAYS
  return ['1', '8', '15', '22', String(days)]
}

function Legend({ label, color }: { readonly label: string; readonly color: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Text role="body" size="2xs" color="secondary">
        {label}
      </Text>
    </View>
  )
}

/** The two cumulative lines; this period's draws itself in once it is shown. */
function CumulativeChart({
  width,
  now,
  before,
}: {
  readonly width: number
  readonly now: readonly (number | null)[]
  readonly before: readonly (number | null)[]
}) {
  const theme = useTheme()
  const reduced = useReducedMotion()
  const drawn = useSharedValue(reduced ? 1 : 0)
  const top = Math.max(1, ...now.map((value) => value ?? 0), ...before.map((value) => value ?? 0))
  const step = width / Math.max(1, now.length - 1)
  const at = (value: number, index: number) =>
    [index * step, CHART_HEIGHT - (value / top) * (CHART_HEIGHT - 10) - 2] as const

  const line = (values: readonly (number | null)[]) =>
    values
      .flatMap((value, index) => (value === null ? [] : [at(value, index)]))
      .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
      .join(' ')

  const shown = now.flatMap((value, index) => (value === null ? [] : [at(value, index)]))
  const last = shown.at(-1)
  const length = shown.reduce((sum, point, index) => {
    const prior = shown[index - 1]
    return prior ? sum + Math.hypot(point[0] - prior[0], point[1] - prior[1]) : sum
  }, 0)
  const nowPath = line(now)
  const area = last
    ? `${nowPath} L${last[0].toFixed(1)} ${String(CHART_HEIGHT)} L0 ${String(CHART_HEIGHT)} Z`
    : ''

  useEffect(() => {
    drawn.set(reduced ? 1 : withTiming(1, { duration: 1100, easing: Easing.out(Easing.cubic) }))
  }, [drawn, reduced])
  const draw = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - drawn.get()) }))

  return (
    <Svg width={width} height={CHART_HEIGHT} accessibilityElementsHidden>
      <Defs>
        <LinearGradient id="progressArea" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={theme.color.icon.accent} stopOpacity={0.24} />
          <Stop offset="1" stopColor={theme.color.icon.accent} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      {[0.25, 0.5, 0.75].map((guide) => (
        <Path
          key={guide}
          d={`M0 ${String(CHART_HEIGHT * guide)} H${String(width)}`}
          stroke={theme.color.border.subtle}
          strokeWidth={1}
        />
      ))}
      <Path
        d={line(before)}
        stroke={theme.color.text.muted}
        strokeWidth={2}
        strokeDasharray="4 5"
        strokeLinecap="round"
        fill="none"
      />
      {area ? <Path d={area} fill="url(#progressArea)" /> : null}
      <AnimatedPath
        d={nowPath}
        stroke={theme.color.icon.accent}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        strokeDasharray={length}
        animatedProps={draw}
      />
      {last ? (
        <>
          <Path
            d={`M${String(last[0] - 0.1)} ${String(last[1])} h0.2`}
            stroke={theme.color.accent.tonal}
            strokeWidth={22}
            strokeLinecap="round"
          />
          <Path
            d={`M${String(last[0] - 0.1)} ${String(last[1])} h0.2`}
            stroke={theme.color.icon.accent}
            strokeWidth={10}
            strokeLinecap="round"
          />
        </>
      ) : null}
    </Svg>
  )
}

type Tone = 'strength' | 'highIntensity' | 'rhythm'

function Tile({
  value,
  label,
  detail,
  share,
  tone,
}: {
  readonly value: string
  readonly label: string
  readonly detail: string
  readonly share: number
  readonly tone: Tone
}) {
  const theme = useTheme()
  const color = theme.color.discipline[tone]
  return (
    <View
      style={[
        styles.tile,
        { backgroundColor: theme.color.background.surface, borderColor: theme.color.border.subtle },
      ]}
    >
      <View style={styles.tileTop}>
        <Text role="poster" tracking={FIGURE_TRACKING} size="2xl" numberOfLines={1}>
          {value}
        </Text>
        <Ring size={32} stroke={4} share={share} color={color} />
      </View>
      <Text role="control" size="xs" style={{ color }}>
        {label}
      </Text>
      <Text role="body" size="xs" color="muted" numberOfLines={1}>
        {detail}
      </Text>
    </View>
  )
}

function SectionTitle({ title, extra }: { readonly title: string; readonly extra?: string }) {
  return (
    <View style={styles.sectionTitle}>
      <Text role="control" size="md" accessibilityRole="header">
        {title}
      </Text>
      {extra ? (
        <Text role="control" size="xs" color="muted">
          {extra}
        </Text>
      ) : null}
    </View>
  )
}

function MusclesCard({
  rows,
  lit,
  missing,
}: {
  readonly rows: ReturnType<typeof muscleRows>
  readonly lit: readonly string[]
  readonly missing: readonly string[]
}) {
  const theme = useTheme()
  if (rows.length === 0) {
    return (
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.color.background.surface,
            borderColor: theme.color.border.subtle,
          },
        ]}
      >
        <Text role="body" size="sm" color="secondary">
          Cuando registres series con carga, aquí verás qué músculos trabajaste.
        </Text>
      </View>
    )
  }
  return (
    <View
      style={[
        styles.card,
        styles.muscles,
        { backgroundColor: theme.color.background.surface, borderColor: theme.color.border.subtle },
      ]}
    >
      <View style={styles.figures} accessible={false}>
        {(['front', 'back'] as const).map((side) => (
          <BodyFigure
            key={side}
            side={side}
            gender="male"
            scale={0.4}
            lit={lit}
            inert={INERT_SLUGS}
            onPressSlug={() => undefined}
          />
        ))}
      </View>
      <View style={styles.muscleList}>
        {rows.slice(0, 5).map((row) => (
          <View
            key={row.code}
            accessible
            accessibilityLabel={`${row.name}: ${String(row.sets)} series`}
            style={styles.muscleRow}
          >
            <View style={styles.muscleTop}>
              <Text role="control" size="xs" numberOfLines={1} style={styles.grow}>
                {row.name}
              </Text>
              <Text role="poster" tracking={FIGURE_TRACKING} size="md">
                {String(row.sets)}
              </Text>
            </View>
            <View style={[styles.track, { backgroundColor: theme.color.background.surfaceMuted }]}>
              <View
                style={[
                  styles.fill,
                  {
                    width: `${Math.round(row.share * 100)}%`,
                    backgroundColor: theme.color.icon.accent,
                  },
                ]}
              />
            </View>
          </View>
        ))}
        {missing.length > 0 ? (
          <View style={styles.missing}>
            <View style={[styles.dot, { backgroundColor: theme.color.status.warning }]} />
            <Text
              role="control"
              size="2xs"
              style={{ color: theme.color.status.warning }}
              numberOfLines={2}
            >
              {`Sin trabajar: ${missing.slice(0, 2).join(', ')}`}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  )
}

function LoadsCard({ movements }: { readonly movements: ReturnType<typeof liftedUp> }) {
  const theme = useTheme()
  return (
    <View
      style={[
        styles.card,
        styles.loads,
        { backgroundColor: theme.color.background.surface, borderColor: theme.color.border.subtle },
      ]}
    >
      {movements.map((movement, index) => {
        const path = sparkline(movement.bests, SPARK_WIDTH, SPARK_HEIGHT)
        return (
          <View
            key={movement.movement_id}
            accessible
            accessibilityLabel={`${movement.name}: de ${formatKilos(movement.previous_best_kg ?? 0)} a ${formatKilos(movement.best_kg)} kilos`}
            style={[
              styles.loadRow,
              index > 0 ? { borderTopWidth: 1, borderTopColor: theme.color.border.subtle } : null,
            ]}
          >
            <View style={styles.grow}>
              <Text role="control" size="sm" numberOfLines={1}>
                {movement.name}
              </Text>
              <Text role="body" size="xs" color="secondary">
                {`${formatKilos(movement.previous_best_kg ?? 0)} → ${formatKilos(movement.best_kg)} kg`}
              </Text>
            </View>
            {path ? (
              <Svg width={SPARK_WIDTH} height={SPARK_HEIGHT + 4}>
                <Path
                  d={path}
                  transform="translate(0 2)"
                  stroke={theme.color.icon.accent}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </Svg>
            ) : null}
            <Badge label={`+${formatKilos(movement.change_kg ?? 0)} kg`} tone="accent" />
          </View>
        )
      })}
    </View>
  )
}

/**
 * Without `period_analysis`: the real screen, drawn from a fixed sample and blurred.
 * Blurred enough that no figure can be read, so it promises the shape of what Pro shows
 * and never passes the sample off as the person's own week.
 */
function ProVeil({
  kind,
  today,
  onUpgrade,
}: {
  readonly kind: PeriodKind
  readonly today: string
  readonly onUpgrade: () => void
}) {
  const theme = useTheme()
  const start = periodStart(today, kind)
  const sample = (
    startsOn: string,
    volume: number,
    sessions: number,
    days: Period['days'],
  ): Period => ({
    starts_on: startsOn,
    sessions,
    active_days: sessions,
    trained_seconds: sessions * 3300,
    work_sets: sessions * 10,
    volume_kg: volume,
    planned: 4,
    fulfilled: sessions,
    unplanned: 0,
    days,
    muscles: [
      { code: 'chest', name: 'Pecho', sets: 12 },
      { code: 'lats', name: 'Dorsal', sets: 10 },
      { code: 'quadriceps', name: 'Cuádriceps', sets: 8 },
      { code: 'shoulders', name: 'Hombros', sets: 6 },
    ],
  })
  const earlier = previousStart(start, kind)
  const before = sample(earlier, 10600, 3, [
    { trained_on: addDays(earlier, 0), volume_kg: 3200 },
    { trained_on: addDays(earlier, 2), volume_kg: 3700 },
    { trained_on: addDays(earlier, 4), volume_kg: 3700 },
  ])
  const now = sample(start, 12480, 4, [
    { trained_on: addDays(start, 0), volume_kg: 3600 },
    { trained_on: addDays(start, 2), volume_kg: 4500 },
    { trained_on: addDays(start, 4), volume_kg: 4380 },
  ])
  return (
    <View style={styles.veilWrap}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Comparison
          current={now}
          previous={before}
          movements={(
            [
              ['Sentadilla', 80, 92.5],
              ['Press banca', 60, 65],
              ['Remo con barra', 50, 55],
            ] as const
          ).map(([name, from, to]) => ({
            movement_id: name,
            name,
            best_kg: to,
            previous_best_kg: from,
            change_kg: to - from,
            bests: [from - 5, from, from, to],
          }))}
          muscles={[]}
          kind={kind}
          today={addDays(start, 6)}
        />
      </View>
      <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFill} />
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: `${theme.color.background.canvas}66` }]}
      />
      <View style={styles.veil}>
        <View
          style={[
            styles.offer,
            {
              backgroundColor: theme.color.background.surface,
              borderColor: theme.color.border.accent,
            },
          ]}
        >
          <Badge label="Pro" tone="accent" style={styles.centered} />
          <Text role="display" size="4xl" uppercase align="center">
            {'Mira cuánto\nhas avanzado'}
          </Text>
          <Text role="body" size="sm" color="secondary" align="center">
            Compara esta semana con la anterior: tu volumen, tus cargas, los músculos que trabajaste
            y tu constancia.
          </Text>
          <View style={styles.includes}>
            {(
              [
                ['progress', 'Semana a semana o mes a mes'],
                ['weight', 'Las cargas que subieron'],
                ['arms', 'Tus músculos trabajados'],
              ] as const
            ).map(([icon, label]) => (
              <View key={label} style={styles.includeRow}>
                <FoundationIcon name={icon} size="sm" color={theme.color.icon.accent} decorative />
                <Text role="control" size="sm">
                  {label}
                </Text>
              </View>
            ))}
          </View>
          <Button label="Hazte Pro" size="sm" onPress={onUpgrade} style={styles.centered} />
          <Text role="body" size="xs" color="muted" align="center">
            El resumen de cada sesión sigue siendo gratis.
          </Text>
        </View>
      </View>
    </View>
  )
}

/** A day `days` after `iso`, as parts so no zone moves it. */
function addDays(iso: string, days: number): string {
  const [year = 1970, month = 1, day = 1] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  titles: { flex: 1, alignItems: 'center', gap: 2 },
  program: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: 220 },
  programDot: { width: 7, height: 7, borderRadius: 4 },
  options: { gap: 10 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 62,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 16,
  },
  choiceDot: { width: 9, height: 9, borderRadius: 5, marginHorizontal: 4 },
  pressed: { opacity: 0.8 },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 48, gap: 16 },
  sections: { gap: 16 },
  period: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  periodText: { flex: 1, alignItems: 'center', gap: 2 },
  off: { opacity: 0.3 },
  centered: { alignSelf: 'center' },
  hero: { borderRadius: 28, borderWidth: 1, padding: 20, gap: 10, overflow: 'hidden' },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  legend: { flexDirection: 'row', gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendSwatch: { width: 12, height: 3, borderRadius: 2 },
  figure: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  unit: { paddingBottom: 10 },
  change: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  axisLabel: { minWidth: 14, textAlign: 'center' },
  tiles: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, borderRadius: 20, borderWidth: 1, padding: 12, gap: 4 },
  tileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  card: { borderRadius: 24, borderWidth: 1, padding: 16, gap: 10 },
  muscles: { flexDirection: 'row', alignItems: 'center', gap: 8, overflow: 'hidden' },
  figures: { flexDirection: 'row' },
  muscleList: { flex: 1, gap: 10 },
  muscleRow: { gap: 5 },
  muscleTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  track: { height: 5, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 5, borderRadius: 3 },
  missing: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  loads: { paddingVertical: 4, gap: 0 },
  loadRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  grow: { flex: 1 },
  veilWrap: { borderRadius: 28, overflow: 'hidden' },
  // Low enough that the top of the volume card shows, blurred, above the offer.
  veil: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, paddingTop: 110 },
  offer: { borderRadius: 28, borderWidth: 1.5, padding: 24, gap: 14, alignItems: 'center' },
  includes: { alignSelf: 'stretch', gap: 9, paddingHorizontal: 8 },
  includeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
})
