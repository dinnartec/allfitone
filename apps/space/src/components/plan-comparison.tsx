/**
 * The pieces of «Gratis y Pro» (`PRO-E`, `PRO-E2`, `PRO-E4`): the six cards of what Pro
 * opens, and the table side by side. There is no Gratis | Pro switch: the screen exists to
 * show Pro, and the table already says what Gratis keeps.
 *
 * Motion carries the argument, so it is not decoration: the history bar grows to «all»,
 * the analysis line draws itself, the scanner crosses the plate, the measurements arrive
 * one by one, the covers fan in and the limits turn into ∞ — each when its card comes
 * into view, never all at once. With reduced motion everything is in its final state.
 */

import { Badge } from '@allfitone/react-native/badge'
import { PageDots } from '@allfitone/react-native/page-dots'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { LinearGradient } from 'expo-linear-gradient'
import { useEffect, useState, type ReactNode } from 'react'
import { Image, StyleSheet, View, type ImageSourcePropType } from 'react-native'
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  ReduceMotion,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import Svg, { Defs, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg'

import type { ComparisonRow } from '../client/plan'

export type PlanChoice = 'free' | 'pro'

const CARD_WIDTH = 288
const CARD_GAP = 12

// ———————————————————————————————————————— the cards

interface CardContent {
  readonly label: string
  readonly title: string
  readonly pro: string
  readonly free: string
}

const CARDS: readonly CardContent[] = [
  {
    label: 'Historial',
    title: 'TODO LO QUE\nHAS ENTRENADO.',
    pro: 'Cada sesión desde el primer día, a un toque.',
    free: 'Con Gratis ves el último mes. Lo anterior no se borra: sigue guardado y con Pro lo vuelves a ver.',
  },
  {
    label: 'Análisis',
    title: 'MIRA CUÁNTO\nHAS SUBIDO.',
    pro: 'Tus cargas, tu volumen y tu constancia, semana a semana o mes a mes.',
    free: 'Con Gratis tienes el resumen de cada sesión. Con Pro ves cómo suben tus cargas mes a mes.',
  },
  {
    label: 'Nutrición',
    title: 'UNA FOTO\nY LISTO.',
    pro: 'Tomas una foto de tu plato y la app reconoce lo que comes.',
    free: 'Con Gratis registras buscando tus alimentos y fijas tu meta.',
  },
  {
    label: 'Cuerpo',
    title: 'MÍRATE\nCAMBIAR.',
    pro: 'Medidas y fotos de tu progreso, solo para ti.',
    free: 'Con Gratis registras tu peso y tu estatura.',
  },
  {
    label: 'Programas',
    title: 'TODO EL\nCATÁLOGO.',
    pro: 'Todos los programas de Allfit, según tu objetivo y tu nivel.',
    free: 'Con Gratis tienes una selección para empezar.',
  },
  {
    label: 'Tus programas',
    title: 'CREA TODO\nLO QUE QUIERAS.',
    pro: 'Rutinas y programas propios sin límite, y duplicar rutinas.',
    free: 'Con Gratis, un programa propio a la vez y hasta tres rutinas.',
  },
]

/** The six cards of what Pro opens; each one animates when it is the one in view. */
export function UnlockCarousel({
  plan,
  meal,
  covers,
}: {
  readonly plan: PlanChoice
  readonly meal: ImageSourcePropType
  readonly covers: readonly ImageSourcePropType[]
}) {
  const theme = useTheme()
  const [active, setActive] = useState(0)
  // As on Hoy: the dots follow the finger on the UI thread, and the card in front
  // changes when the scroll crosses half way, not when the momentum ends.
  const at = useSharedValue(0)
  const follow = useAnimatedScrollHandler((event) => {
    at.set(event.contentOffset.x / (CARD_WIDTH + CARD_GAP))
  })
  useAnimatedReaction(
    () => Math.min(CARDS.length - 1, Math.max(0, Math.round(at.get()))),
    (now, before) => {
      if (now !== before) scheduleOnRN(setActive, now)
    },
  )

  const visuals: readonly ((on: boolean) => ReactNode)[] = [
    (on) => <HistoryVisual on={on} free={plan === 'free'} />,
    (on) => <AnalysisVisual on={on} free={plan === 'free'} />,
    (on) => <NutritionVisual on={on} meal={meal} />,
    (on) => <BodyVisual on={on} free={plan === 'free'} />,
    (on) => <CatalogueVisual on={on} covers={covers} free={plan === 'free'} />,
    (on) => <LimitsVisual on={on} free={plan === 'free'} />,
  ]

  return (
    <View style={styles.carousel}>
      <View style={styles.carouselHead}>
        <Text role="display" size="2xl" uppercase accessibilityRole="header">
          Lo que abres con Pro
        </Text>
        <Text role="control" size="xs" color="muted">
          {`${String(active + 1)} / ${String(CARDS.length)}`}
        </Text>
      </View>
      <Animated.ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD_WIDTH + CARD_GAP}
        decelerationRate="fast"
        contentContainerStyle={styles.cards}
        onScroll={follow}
        scrollEventThrottle={16}
      >
        {CARDS.map((card, index) => (
          <View
            key={card.label}
            accessible
            accessibilityLabel={`${card.label}. ${plan === 'pro' ? card.pro : card.free}`}
            style={[styles.card, { borderColor: theme.color.accent.tonalBorder }]}
          >
            <LinearGradient
              colors={[theme.color.background.surfaceMuted, theme.color.background.surface]}
              style={StyleSheet.absoluteFill}
            />
            <Text role="control" size="2xs" color="accent" uppercase tracking={0.16}>
              {card.label}
            </Text>
            <Text role="display" size="3xl" uppercase>
              {card.title}
            </Text>
            <View style={styles.visual}>{visuals[index]?.(index === active)}</View>
            <Text role="body" size="sm" color="secondary">
              {plan === 'pro' ? card.pro : card.free}
            </Text>
          </View>
        ))}
      </Animated.ScrollView>
      <PageDots
        count={CARDS.length}
        active={active}
        at={at}
        color={theme.color.icon.accent}
        accessibilityLabel={`Tarjeta ${String(active + 1)} de ${String(CARDS.length)}`}
        style={styles.dots}
      />
    </View>
  )
}

/** 0 → 1 once the card is in view; straight to 1 with reduced motion. */
function useEntrance(on: boolean, duration = 900, delay = 0): SharedValue<number> {
  const reduced = useReducedMotion()
  const progress = useSharedValue(0)
  useEffect(() => {
    if (!on) return
    progress.set(
      reduced ? 1 : withDelay(delay, withTiming(1, { duration, easing: Easing.out(Easing.cubic) })),
    )
  }, [on, reduced, duration, delay, progress])
  return progress
}

/** Five months of training as a calendar of days, a column a week; how lit is how hard. */
const WEEKS = 21
const WEEK_DAYS = 7
const LAST_MONTH = 4
const CELL = 9
const CELL_STRIDE = 12
/** A fixed pattern, not a person's history: the card shows what the calendar looks like. */
const DAYS: readonly (readonly number[])[] = Array.from({ length: WEEKS }, (_, week) =>
  Array.from({ length: WEEK_DAYS }, (_, day) => {
    const seed = (week * 7 + day * 13 + week * day) % 11
    if (day === 3 || day === 6) return seed > 8 ? 1 : 0
    return seed < 4 ? 0 : seed < 6 ? 1 : seed < 9 ? 2 : 3
  }),
)
/** How lit a day is: nothing, then the accent at three strengths. */
const heat = (theme: ReturnType<typeof useTheme>, level: number) =>
  [
    theme.color.border.subtle,
    `${theme.color.icon.accent}4D`,
    `${theme.color.icon.accent}99`,
    theme.color.icon.accent,
  ][level] ?? theme.color.border.subtle
const MONTH_LABELS = ['JUN', 'JUL', 'AGO', 'SEP', 'OCT'] as const

function HistoryVisual({ on, free }: { readonly on: boolean; readonly free: boolean }) {
  const theme = useTheme()
  const lit = useEntrance(on, 1100)
  return (
    <View style={styles.historyVisual}>
      <View style={styles.historyCount}>
        <Text role="poster" size="4xl" color={free ? 'primary' : 'accent'}>
          {free ? '12' : '86'}
        </Text>
        <Text role="control" size="xs" color="secondary" style={styles.historyUnit}>
          {free ? 'de 86 sesiones a la vista' : 'sesiones, todas a la vista'}
        </Text>
      </View>
      <View style={styles.heatmap}>
        {DAYS.map((week, index) => (
          <HeatColumn
            key={index}
            days={week}
            index={index}
            lit={lit}
            hidden={free && index < WEEKS - LAST_MONTH}
          />
        ))}
        {free ? (
          <>
            <View
              style={[
                styles.cut,
                {
                  left: (WEEKS - LAST_MONTH) * CELL_STRIDE - 2,
                  backgroundColor: theme.color.icon.accent,
                },
              ]}
            />
            <Text role="control" size="2xs" color="accent" uppercase style={styles.lastMonth}>
              Último mes
            </Text>
            <Badge label="Guardado · con Pro" variant="quiet" style={styles.kept} />
          </>
        ) : null}
      </View>
      <View style={styles.heatMonths}>
        {MONTH_LABELS.map((month) => (
          <Text key={month} role="control" size="2xs" color={month === 'OCT' ? 'accent' : 'muted'}>
            {month}
          </Text>
        ))}
      </View>
    </View>
  )
}

/** One week; it lights up as the cascade reaches it, oldest first. */
function HeatColumn({
  days,
  index,
  lit,
  hidden,
}: {
  readonly days: readonly number[]
  readonly index: number
  readonly lit: SharedValue<number>
  readonly hidden: boolean
}) {
  const theme = useTheme()
  const shown = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0.15, lit.get() * WEEKS - index + 1)),
  }))
  return (
    <Animated.View style={[styles.heatColumn, shown]}>
      {days.map((level, day) => (
        <View
          key={day}
          style={[
            styles.heatCell,
            {
              backgroundColor: hidden
                ? level > 0
                  ? theme.color.border.strong
                  : theme.color.border.subtle
                : heat(theme, level),
            },
          ]}
        />
      ))}
    </Animated.View>
  )
}

const AnimatedPath = Animated.createAnimatedComponent(Path)
/** Squat best, May to October: what a month of steady work looks like on a curve. */
const LOADS = [70, 72.5, 75, 80, 80, 92.5] as const
const CURVE_WIDTH = 252
const CURVE_HEIGHT = 120

function curvePoints(): readonly (readonly [number, number])[] {
  const low = 62
  const high = 96
  return LOADS.map((load, index) => [
    8 + (index * (CURVE_WIDTH - 16)) / (LOADS.length - 1),
    CURVE_HEIGHT - ((load - low) / (high - low)) * (CURVE_HEIGHT - 20),
  ])
}

/** A Catmull-Rom curve through the points, as cubic Béziers. */
function smooth(points: readonly (readonly [number, number])[]): string {
  return points.reduce((path, point, index) => {
    if (index === 0) return `M${point[0].toFixed(1)} ${point[1].toFixed(1)}`
    const before = points[index - 2] ?? points[index - 1] ?? point
    const from = points[index - 1] ?? point
    const after = points[index + 1] ?? point
    const c1 = [from[0] + (point[0] - before[0]) / 6, from[1] + (point[1] - before[1]) / 6]
    const c2 = [point[0] - (after[0] - from[0]) / 6, point[1] - (after[1] - from[1]) / 6]
    return `${path} C${(c1[0] ?? 0).toFixed(1)} ${(c1[1] ?? 0).toFixed(1)} ${(c2[0] ?? 0).toFixed(1)} ${(c2[1] ?? 0).toFixed(1)} ${point[0].toFixed(1)} ${point[1].toFixed(1)}`
  }, '')
}

const CURVE = curvePoints()
const CURVE_PATH = smooth(CURVE)
const CURVE_LENGTH = 340

function AnalysisVisual({ on, free }: { readonly on: boolean; readonly free: boolean }) {
  const theme = useTheme()
  const draw = useEntrance(on, 1300)
  const stroke = useAnimatedProps(() => ({ strokeDashoffset: CURVE_LENGTH * (1 - draw.get()) }))
  const september = CURVE[4] ?? [0, 0]
  const october = CURVE[5] ?? [0, 0]
  const glow = theme.color.icon.accent
  const line = free ? theme.color.text.disabled : glow
  return (
    <View style={styles.chart}>
      <View style={styles.curve}>
        <Svg
          width={CURVE_WIDTH}
          height={CURVE_HEIGHT}
          viewBox={`0 0 ${String(CURVE_WIDTH)} ${String(CURVE_HEIGHT)}`}
        >
          <Defs>
            <SvgGradient id="area" x1="0" y1="0" x2="0" y2="1">
              <Stop
                offset="0"
                stopColor={free ? theme.color.text.primary : glow}
                stopOpacity={free ? 0.06 : 0.3}
              />
              <Stop offset="1" stopColor={glow} stopOpacity={0} />
            </SvgGradient>
          </Defs>
          {[0.33, 0.66].map((guide) => (
            <Path
              key={guide}
              d={`M0 ${String(CURVE_HEIGHT * guide)} H${String(CURVE_WIDTH)}`}
              stroke={theme.color.border.subtle}
            />
          ))}
          <Path
            d={`${CURVE_PATH} L${october[0].toFixed(1)} ${String(CURVE_HEIGHT)} L8 ${String(CURVE_HEIGHT)} Z`}
            fill="url(#area)"
          />
          <AnimatedPath
            d={CURVE_PATH}
            stroke={line}
            strokeWidth={3}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={CURVE_LENGTH}
            animatedProps={stroke}
          />
          <Path
            d={`M${String(september[0] - 0.1)} ${String(september[1])} h0.2`}
            stroke={free ? line : theme.color.text.secondary}
            strokeWidth={9}
            strokeLinecap="round"
          />
          <Path
            d={`M${String(october[0] - 0.1)} ${String(october[1])} h0.2`}
            stroke={free ? theme.color.border.subtle : theme.color.accent.tonal}
            strokeWidth={24}
            strokeLinecap="round"
          />
          <Path
            d={`M${String(october[0] - 0.1)} ${String(october[1])} h0.2`}
            stroke={line}
            strokeWidth={10}
            strokeLinecap="round"
          />
        </Svg>
        {free ? (
          <Badge
            label="Comparar periodos es Pro"
            tone="accent"
            variant="quiet"
            style={styles.locked}
          />
        ) : (
          <>
            <View style={styles.rise}>
              <Text role="poster" size="3xl" color="accent">
                +12,5 kg
              </Text>
              <Text role="control" size="2xs" color="secondary">
                Sentadilla · en un mes
              </Text>
            </View>
            <Badge
              label="80 kg"
              style={[styles.loadTag, { left: september[0] - 26, top: september[1] + 10 }]}
            />
            <Badge
              label="92,5 kg"
              tone="accent"
              style={[styles.loadTag, { left: october[0] - 92, top: october[1] - 12 }]}
            />
          </>
        )}
      </View>
      <View style={styles.heatMonths}>
        {['MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT'].map((month) => (
          <Text
            key={month}
            role="control"
            size="2xs"
            color={month === 'OCT' && !free ? 'accent' : 'muted'}
          >
            {month}
          </Text>
        ))}
      </View>
    </View>
  )
}

function NutritionVisual({
  on,
  meal,
}: {
  readonly on: boolean
  readonly meal: ImageSourcePropType
}) {
  const theme = useTheme()
  const reduced = useReducedMotion()
  const scan = useSharedValue(0)
  useEffect(() => {
    if (!on || reduced) return
    scan.set(
      withRepeat(
        withSequence(
          withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
        ),
        3,
        false,
        undefined,
        ReduceMotion.System,
      ),
    )
  }, [on, reduced, scan])
  const line = useAnimatedStyle(() => ({ transform: [{ translateY: 8 + scan.get() * 104 }] }))
  return (
    <View style={styles.mealVisual}>
      <Image source={meal} style={styles.mealPhoto} resizeMode="cover" accessible={false} />
      <Animated.View
        style={[
          styles.scanLine,
          { backgroundColor: theme.color.icon.accent, shadowColor: theme.color.icon.accent },
          line,
        ]}
      />
      <View style={styles.chips}>
        <Badge label="520 kcal" tone="accent" variant="quiet" />
        <Badge label="38 g proteína" variant="quiet" />
      </View>
    </View>
  )
}

function BodyVisual({ on, free }: { readonly on: boolean; readonly free: boolean }) {
  const theme = useTheme()
  const rows = [
    ['Cintura', '82 → 78 cm', '−4'],
    ['Brazo', '31 → 33 cm', '+2'],
    ['Peso', '64 → 62 kg', '−2'],
  ] as const
  return (
    <View style={styles.bodyVisual}>
      {rows.map(([name, change, delta], index) =>
        on ? (
          <Animated.View
            key={name}
            entering={FadeInDown.delay(index * 140)
              .duration(420)
              .reduceMotion(ReduceMotion.System)}
            style={[
              styles.bodyRow,
              { backgroundColor: theme.color.background.surface },
              free && name !== 'Peso' ? styles.dim : null,
            ]}
          >
            <Text role="control" size="sm">
              {name}
            </Text>
            <View style={styles.inline}>
              <Text role="body" size="xs" color="secondary">
                {change}
              </Text>
              <Text role="data" size="lg" color="accent">
                {delta}
              </Text>
            </View>
          </Animated.View>
        ) : (
          <View key={name} style={styles.bodyRowSpace} />
        ),
      )}
    </View>
  )
}

function CatalogueVisual({
  on,
  covers,
  free,
}: {
  readonly on: boolean
  readonly covers: readonly ImageSourcePropType[]
  readonly free: boolean
}) {
  const theme = useTheme()
  return (
    <View style={styles.covers}>
      {covers.map((cover, index) =>
        on ? (
          <Animated.View
            key={index}
            entering={FadeInDown.delay(index * 110)
              .duration(460)
              .reduceMotion(ReduceMotion.System)}
            style={[styles.cover, free && index > 0 ? styles.dim : null]}
          >
            <Image source={cover} style={styles.coverImage} resizeMode="cover" accessible={false} />
            {free && index > 0 ? (
              <View style={styles.coverLock}>
                <FoundationIcon
                  name="locked"
                  size="sm"
                  color={theme.color.text.primary}
                  decorative
                />
              </View>
            ) : null}
          </Animated.View>
        ) : (
          <View key={index} style={styles.cover} />
        ),
      )}
    </View>
  )
}

function LimitsVisual({ on, free }: { readonly on: boolean; readonly free: boolean }) {
  const theme = useTheme()
  const pop = useEntrance(on, 600, 350)
  const infinity = useAnimatedStyle(() => ({
    opacity: pop.get(),
    transform: [{ scale: 0.6 + pop.get() * 0.4 }],
  }))
  return (
    <View style={styles.limits}>
      {(
        [
          ['Programas activos', '1'],
          ['Rutinas propias', '3'],
        ] as const
      ).map(([name, count]) => (
        <View key={name} style={styles.limitRow}>
          <Text role="control" size="sm" color="secondary">
            {name}
          </Text>
          <View style={styles.inline}>
            <Text role="data" size="3xl" color="muted">
              {count}
            </Text>
            <FoundationIcon
              name="forward"
              size="sm"
              color={theme.color.icon.secondary}
              decorative
            />
            <Animated.View style={free ? styles.dim : infinity}>
              <Text role="data" size="4xl" color="accent">
                ∞
              </Text>
            </Animated.View>
          </View>
        </View>
      ))}
    </View>
  )
}

// ———————————————————————————————————————— the table

/** Side by side, the selected plan's column lit; rows arrive in a cascade. */
export function ComparisonTable({
  rows,
  selected,
}: {
  readonly rows: readonly ComparisonRow[]
  readonly selected: PlanChoice
}) {
  const theme = useTheme()
  const lit = (plan: PlanChoice) =>
    selected === plan
      ? {
          backgroundColor: theme.color.accent.tonal,
          borderColor: theme.color.border.accent,
        }
      : { backgroundColor: 'transparent', borderColor: 'transparent' }

  return (
    <View style={styles.table}>
      <Text role="display" size="2xl" uppercase accessibilityRole="header">
        Lado a lado
      </Text>
      <View>
        <View style={[styles.column, styles.freeColumn, lit('free')]} />
        <View style={[styles.column, styles.proColumn, lit('pro')]} />
        <View style={styles.headerRow}>
          <View style={styles.labelCell} />
          <Text role="control" size="sm" color="secondary" align="center" style={styles.valueCell}>
            Gratis
          </Text>
          <View style={[styles.valueCell, styles.proHead]}>
            <FoundationIcon name="favourite" size="xs" color={theme.color.icon.accent} decorative />
            <Text role="control" size="sm" color="accent">
              Pro
            </Text>
          </View>
        </View>
        {rows.map((row, index) => (
          <Animated.View
            key={row.key}
            entering={FadeIn.delay(index * 60)
              .duration(360)
              .reduceMotion(ReduceMotion.System)}
            style={[styles.row, index > 0 ? { borderTopColor: theme.color.border.subtle } : null]}
            accessible
            accessibilityLabel={`${row.label}. Gratis: ${row.free === true ? 'incluido' : row.free}. Pro: ${row.pro === true ? 'incluido' : row.pro}.`}
          >
            <Text role="control" size="sm" style={styles.labelCell}>
              {row.label}
            </Text>
            <Cell value={row.free} pro={false} />
            <Cell value={row.pro} pro />
          </Animated.View>
        ))}
      </View>
    </View>
  )
}

function Cell({ value, pro }: { readonly value: string | true; readonly pro: boolean }) {
  const theme = useTheme()
  if (value === true) {
    return (
      <View style={styles.valueCell}>
        <FoundationIcon
          name={pro ? 'success' : 'check'}
          size="md"
          color={pro ? theme.color.icon.accent : theme.color.icon.secondary}
          decorative
        />
      </View>
    )
  }
  return (
    <Text
      role={pro ? 'control' : 'body'}
      size="xs"
      color={pro ? 'accent' : 'secondary'}
      align="center"
      style={styles.valueCell}
    >
      {value}
    </Text>
  )
}

const styles = StyleSheet.create({
  carousel: { gap: 14 },
  carouselHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: 24,
  },
  cards: { paddingHorizontal: 24, gap: CARD_GAP },
  card: {
    width: CARD_WIDTH,
    minHeight: 380,
    borderRadius: 28,
    borderWidth: 1,
    padding: 22,
    gap: 10,
    overflow: 'hidden',
  },
  visual: { height: 172, justifyContent: 'center' },
  dots: { alignSelf: 'center' },
  historyVisual: { gap: 8 },
  historyCount: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  historyUnit: { paddingBottom: 6 },
  heatmap: { flexDirection: 'row', height: WEEK_DAYS * CELL_STRIDE, marginTop: 12 },
  heatColumn: { width: CELL_STRIDE, gap: CELL_STRIDE - CELL },
  heatCell: { width: CELL, height: CELL, borderRadius: 2.5 },
  cut: { position: 'absolute', top: -6, width: 1.5, height: WEEK_DAYS * CELL_STRIDE + 6 },
  lastMonth: { position: 'absolute', top: -20, right: 0 },
  kept: { position: 'absolute', left: 24, top: 26 },
  heatMonths: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 },
  dim: { opacity: 0.35 },
  chart: { gap: 6 },
  curve: { height: CURVE_HEIGHT },
  rise: { position: 'absolute', left: 0, top: 0 },
  loadTag: { position: 'absolute' },
  locked: { position: 'absolute', left: 0, top: 0 },
  mealVisual: { height: 150, borderRadius: 18, overflow: 'hidden' },
  mealPhoto: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    shadowOpacity: 1,
    shadowRadius: 8,
  },
  chips: { position: 'absolute', left: 10, bottom: 10, flexDirection: 'row', gap: 6 },
  bodyVisual: { gap: 8 },
  bodyRow: {
    height: 40,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bodyRowSpace: { height: 40 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  covers: { flexDirection: 'row', gap: 6, height: 150 },
  cover: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  coverImage: { width: '100%', height: '100%' },
  coverLock: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  limits: { gap: 14 },
  limitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  table: { gap: 14 },
  column: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 100,
    borderRadius: 22,
    borderWidth: 1.5,
  },
  freeColumn: { right: 100 },
  proColumn: { right: 0 },
  headerRow: { flexDirection: 'row', alignItems: 'center', height: 52 },
  proHead: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'transparent',
  },
  labelCell: { flex: 1, paddingRight: 8 },
  valueCell: { width: 100, paddingHorizontal: 6, alignItems: 'center' },
})
