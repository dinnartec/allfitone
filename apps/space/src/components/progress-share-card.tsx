/**
 * The cards of «Comparte tu semana» and «Comparte tu mes» (PROG-SH3, PROG-SH3b,
 * PROG-SH3c, PROG-SH3d); the transparent stickers live in `progress-stickers`.
 *
 * **A card is a poster on the design's grid**, as in «Compártelo»: 300 × 533 points at
 * the frames' own coordinates, scaled as a whole by the caller, painted with the
 * brand's primitives because it leaves the app and is always dark. It borrows that
 * screen's ground, faces and type helper rather than drawing its own.
 */

import { ProductLockup } from '@allfitone/react-native/brand'
import { StyleSheet, Text, View, type TextStyle } from 'react-native'
import Svg, {
  Circle,
  Defs,
  Ellipse,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg'

import type { MuscleTerm } from '../client/content'
import { litSlugsFor } from '../client/exercise-catalogue'
import { INERT_SLUGS } from '../client/focus-form'
import { formatKilos } from '../client/progress'
import type { ProgressCardKind, ReceiptRow, ShareFacts } from '../client/progress-share'
import { BodyFigure } from './body-figure'
import {
  BODY_BOLD,
  BODY_HEAVY,
  CARD_HEIGHT,
  CARD_WIDTH,
  Frame,
  INK,
  POSTER,
  type,
} from './share-card'

const FAINT = '#FFFFFF14'
const TRACK = '#FFFFFF0A'
const REST = '#3E525B'

export interface ProgressCardProps {
  readonly kind: ProgressCardKind
  readonly facts: ShareFacts
  /** The week's sessions for the receipt; empty for any other card. */
  readonly receipt: readonly ReceiptRow[]
  readonly muscles: readonly MuscleTerm[]
}

/** «+18 %», «−4 %». */
export const signed = (value: number, unit = '') =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${String(Math.abs(value)).replace('.', ',')}${unit}`

const tons = (kg: number) => (kg / 1000).toFixed(1).replace('.', ',')

export function ProgressCard(props: ProgressCardProps) {
  return (
    <View style={styles.card}>
      <Frame>{cardFor(props)}</Frame>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.rim]} />
    </View>
  )
}

function cardFor(props: ProgressCardProps) {
  switch (props.kind) {
    case 'load':
      return <LoadCard {...props} />
    case 'receipt':
      return <ReceiptCard {...props} />
    case 'versus':
      return <VersusCard {...props} />
    case 'lift':
      return <LiftCard {...props} />
    case 'figure':
      return <FigureCard {...props} />
    case 'calendar':
      return <CalendarCard {...props} />
    case 'total':
      return <TotalCard {...props} />
    case 'dots':
      return <DotsCard {...props} />
    case 'muscles':
      return <MusclesCard {...props} />
  }
}

// ———————————————————————————————————————————— shared pieces

function Lockup() {
  return (
    <View style={[styles.at, { left: 16, top: 16 }]}>
      <ProductLockup product="space" surface="dark" width={104} height={26} decorative />
    </View>
  )
}

/** The lockup at the foot, centred: the minimal cards keep the top for the period. */
function FootLockup() {
  return (
    <View style={[styles.at, { left: 98, top: 491 }]}>
      <ProductLockup product="space" surface="dark" width={104} height={26} decorative />
    </View>
  )
}

function Kicker({ children, centred }: { readonly children: string; readonly centred?: boolean }) {
  return (
    <Text
      numberOfLines={1}
      style={[
        styles.at,
        centred ? [styles.wide, { top: 40 }] : { left: 20, top: 64 },
        type(BODY_HEAVY, 9.5, INK.accent, { tracking: 1.6 }),
      ]}
    >
      {children}
    </Text>
  )
}

/** The count of sessions, big, with what it is and how it stands against the plan. */
function Sessions({ facts, size }: { readonly facts: ShareFacts; readonly size: number }) {
  const unit = Math.round(size * 0.27)
  const pips = facts.planned > 0 && facts.planned <= 8
  return (
    <View style={[styles.at, styles.hero, { left: 16, top: 80 }]}>
      <Text style={type(POSTER, size, INK.accent, { leading: 0.9 })}>{String(facts.sessions)}</Text>
      <View style={[styles.heroSide, { paddingTop: size * 0.16 }]}>
        <Text style={type(POSTER, unit, INK.text, { leading: 0.9 })}>
          {facts.sessions === 1 ? 'SESIÓN' : 'SESIONES'}
        </Text>
        {pips ? (
          <View style={styles.pips}>
            {Array.from({ length: facts.planned }, (_, index) => (
              <View
                key={index}
                style={[
                  styles.pip,
                  { backgroundColor: index < facts.fulfilled ? INK.accent : FAINT },
                ]}
              />
            ))}
          </View>
        ) : facts.planned > 0 ? (
          <View style={[styles.planTrack, { width: unit * 4 }]}>
            <View
              style={[
                styles.planFill,
                { width: `${Math.round(Math.min(1, facts.fulfilled / facts.planned) * 100)}%` },
              ]}
            />
          </View>
        ) : null}
        <Text style={type(BODY_HEAVY, 9, INK.muted, { tracking: 1.4 })}>{planLine(facts)}</Text>
      </View>
    </View>
  )
}

const planLine = (facts: ShareFacts) =>
  facts.planned > 0
    ? `${String(facts.fulfilled)} DE ${String(facts.planned)} DEL PLAN`
    : 'ENTRENO LIBRE'

/** Three figures between a hairline and the foot. */
function Figures({
  figures,
}: {
  readonly figures: readonly (readonly [string, string, boolean])[]
}) {
  return (
    <>
      <View style={[styles.at, styles.rule, { top: 438 }]} />
      <View style={[styles.at, styles.figures]}>
        {figures.map(([value, label, accent]) => (
          <View key={label} style={styles.figure}>
            <Text
              numberOfLines={1}
              style={type(POSTER, 24, accent ? INK.accent : INK.text, { leading: 1 })}
            >
              {value}
            </Text>
            <Text style={type(BODY_HEAVY, 8.5, INK.muted, { tracking: 1 })}>{label}</Text>
          </View>
        ))}
      </View>
    </>
  )
}

export const kilosOf = (facts: ShareFacts) =>
  facts.volumeKg === null ? '0' : formatKilos(facts.volumeKg)

/** Cyan falling to the brand's deep turquoise, top to foot. */
function Fill({
  id,
  width,
  height,
  light,
}: {
  readonly id: string
  readonly width: number
  readonly height: number
  readonly light?: boolean
}) {
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={light ? '#B8FBFF' : INK.accent} />
          <Stop offset="1" stopColor="#1E8A99" />
        </LinearGradient>
      </Defs>
      <Rect width={width} height={height} rx={10} fill={`url(#${id})`} />
    </Svg>
  )
}

// ———————————————————————————————————————————— 1A · M1 · the load, column by column

const COLUMNS = { top: 232, height: 160, left: 20, width: 260 } as const

function LoadCard({ facts }: ProgressCardProps) {
  const week = facts.kind === 'week'
  const gap = week ? 6 : 7
  const width = (COLUMNS.width - gap * (facts.bars.length - 1)) / facts.bars.length
  const heaviest = Math.max(1, ...facts.bars.map((bar) => bar.kg ?? 0))
  return (
    <>
      <Lockup />
      <Kicker>{facts.kicker}</Kicker>
      <Sessions facts={facts} size={week && facts.sessions < 10 ? 150 : 110} />
      <Text
        style={[
          styles.at,
          { left: 20, top: COLUMNS.top - 16 },
          type(BODY_HEAVY, 7.5, INK.ash, { tracking: 1.4 }),
        ]}
      >
        {week ? 'TONELADAS POR DÍA' : 'TONELADAS POR SEMANA'}
      </Text>
      {facts.bars.map((bar, index) => {
        const x = COLUMNS.left + index * (width + gap)
        const height =
          bar.kg === null ? 0 : Math.max(28, Math.round((COLUMNS.height * bar.kg) / heaviest))
        return (
          <View key={bar.label}>
            <View style={[styles.at, styles.column, { left: x, top: COLUMNS.top, width }]} />
            {bar.kg === null ? (
              <View
                style={[
                  styles.at,
                  styles.restDot,
                  { left: x + width / 2 - 2.5, top: COLUMNS.top + COLUMNS.height - 14 },
                ]}
              />
            ) : (
              <View
                style={[
                  styles.at,
                  { left: x, top: COLUMNS.top + COLUMNS.height - height, width, height },
                ]}
              >
                <Fill
                  id={`load${String(index)}`}
                  width={width}
                  height={height}
                  light={!week && bar.kg === heaviest}
                />
                {bar.kg > 0 ? (
                  <Text
                    style={[styles.centre, { marginTop: 8 }, type(POSTER, week ? 14 : 16, INK.ink)]}
                  >
                    {tons(bar.kg)}
                  </Text>
                ) : null}
              </View>
            )}
            <Text
              style={[
                styles.at,
                styles.centre,
                { left: x, top: COLUMNS.top + COLUMNS.height + 8, width },
                type(BODY_HEAVY, week ? 11 : 9, bar.kg === null ? INK.ash : INK.accent),
              ]}
            >
              {bar.label}
            </Text>
          </View>
        )
      })}
      <Figures
        figures={[
          [kilosOf(facts), 'KG', false],
          [facts.duration, 'ENTRENANDO', false],
          facts.change === null
            ? [String(facts.workSets), 'SERIES', false]
            : [signed(facts.change, ' %'), 'VOLUMEN', true],
        ]}
      />
    </>
  )
}

// ———————————————————————————————————————————— 1B · the week as a receipt

const RECEIPT = { top: 184, row: 34 } as const

function ReceiptCard({ facts, receipt }: ProgressCardProps) {
  const total = RECEIPT.top + receipt.length * RECEIPT.row + 6
  const detail = [facts.duration]
  if (facts.change !== null) detail.push(`${signed(facts.change, ' %')} FRENTE A ${facts.against}`)
  return (
    <>
      <Lockup />
      <Kicker>{facts.kicker}</Kicker>
      <Sessions facts={facts} size={96} />
      <View style={[styles.at, styles.rule, { top: RECEIPT.top - 8 }]} />
      {receipt.map((row, index) => {
        const y = RECEIPT.top + index * RECEIPT.row
        return (
          <View key={row.day}>
            <Text
              style={[
                styles.at,
                { left: 20, top: y + 8 },
                type(BODY_HEAVY, 9, row.title ? INK.accent : INK.ash, { tracking: 1.2 }),
              ]}
            >
              {row.day}
            </Text>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              style={[
                styles.at,
                { left: 78, top: y + 5, width: 104 },
                type(POSTER, 17, row.title ? INK.text : REST),
              ]}
            >
              {row.title ?? 'DESCANSO'}
            </Text>
            {row.title ? (
              <>
                <Text
                  style={[
                    styles.at,
                    styles.right,
                    { left: 180, top: y + 8, width: 62 },
                    type(BODY_HEAVY, 9, INK.text, { tracking: 0.6 }),
                  ]}
                >
                  {row.kg === null ? '' : `${formatKilos(row.kg)} KG`}
                </Text>
                <Text
                  style={[
                    styles.at,
                    styles.right,
                    { left: 248, top: y + 8, width: 32 },
                    type(BODY_HEAVY, 9, INK.muted),
                  ]}
                >
                  {`${String(row.minutes)}'`}
                </Text>
              </>
            ) : null}
            <View style={[styles.at, styles.rule, { top: y + RECEIPT.row - 8 }]} />
          </View>
        )
      })}
      <Text
        style={[
          styles.at,
          { left: 20, top: total + 10 },
          type(BODY_HEAVY, 9, INK.muted, { tracking: 1.6 }),
        ]}
      >
        TOTAL
      </Text>
      <Text
        style={[
          styles.at,
          styles.right,
          { left: 110, top: total, width: 170 },
          type(POSTER, 34, INK.accent, { leading: 0.9 }),
        ]}
      >
        {`${kilosOf(facts)} KG`}
      </Text>
      <Text
        style={[
          styles.at,
          styles.right,
          { left: 20, top: total + 40, width: 260 },
          type(BODY_HEAVY, 8, INK.muted, { tracking: 1 }),
        ]}
      >
        {detail.join('  ·  ')}
      </Text>
    </>
  )
}

// ———————————————————————————————————————————— 3 · against the period before

function VersusCard({ facts }: ProgressCardProps) {
  const change = facts.change ?? 0
  const now = facts.volumeKg ?? 0
  const before = facts.previousKg ?? 0
  const heaviest = Math.max(1, now, before)
  const week = facts.kind === 'week'
  const what = `${change >= 0 ? 'MÁS' : 'MENOS'} VOLUMEN QUE\n${week ? 'LA SEMANA PASADA' : `EN ${facts.against}`}`
  const bars: readonly [string, number, boolean][] = [
    [week ? 'ESTA SEMANA' : 'ESTE MES', now, true],
    [week ? 'LA PASADA' : facts.against, before, false],
  ]
  return (
    <>
      <Lockup />
      <Kicker>{facts.kicker}</Kicker>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[
          styles.at,
          { left: 14, top: 84, width: 272 },
          type(POSTER, 120, INK.accent, { leading: 0.9 }),
        ]}
      >
        {signed(change, '%')}
      </Text>
      <Text
        style={[styles.at, { left: 20, top: 200 }, type(POSTER, 26, INK.text, { leading: 0.95 })]}
      >
        {what}
      </Text>
      {bars.map(([label, kg, current], index) => (
        <View key={label}>
          <Text
            style={[
              styles.at,
              { left: 20, top: 300 + index * 70 },
              type(BODY_HEAVY, 9.5, current ? INK.accent : INK.muted, { tracking: 1.2 }),
            ]}
          >
            {label}
          </Text>
          <View
            style={[
              styles.at,
              styles.versusBar,
              {
                top: 316 + index * 70,
                width: Math.max(96, Math.round((260 * kg) / heaviest)),
                backgroundColor: current ? INK.accent : '#FFFFFF1F',
              },
            ]}
          >
            <Text
              style={type(POSTER, 22, current ? INK.ink : INK.text)}
            >{`${formatKilos(kg)} KG`}</Text>
          </View>
        </View>
      ))}
      <Figures
        figures={[
          [String(facts.sessions), facts.sessions === 1 ? 'SESIÓN' : 'SESIONES', false],
          [String(facts.workSets), 'SERIES', false],
          [facts.duration, 'ENTRENANDO', false],
        ]}
      />
    </>
  )
}

// ———————————————————————————————————————————— 4 · the load that rose most

const CHART = { left: 22, right: 278, top: 300, bottom: 462 } as const

/** The movement's bests as a line across the chart; periods it was not trained are skipped. */
export function trendPoints(
  points: readonly (number | null)[],
  box: { left: number; right: number; top: number; bottom: number },
) {
  const known = points.filter((point): point is number => point !== null)
  const low = Math.min(...known)
  const span = Math.max(...known) - low || 1
  const step = points.length > 1 ? (box.right - box.left) / (points.length - 1) : 0
  return points.flatMap((point, index) =>
    point === null
      ? []
      : [
          {
            x: box.left + index * step,
            y: box.bottom - ((point - low) / span) * (box.bottom - box.top),
          },
        ],
  )
}

export const pathOf = (points: readonly { x: number; y: number }[]) =>
  points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ')

function LiftCard({ facts }: ProgressCardProps) {
  const lift = facts.lift
  if (!lift) return null
  const points = trendPoints(lift.points, CHART)
  const last = points.at(-1)
  const first = points[0]
  const step = lift.labels.length > 1 ? (CHART.right - CHART.left) / (lift.labels.length - 1) : 0
  return (
    <>
      <Lockup />
      <Kicker>{facts.kicker}</Kicker>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[
          styles.at,
          { left: 20, top: 84, width: 260 },
          type(POSTER, 44, INK.text, { leading: 0.9 }),
        ]}
      >
        {lift.name.toUpperCase()}
      </Text>
      <View style={[styles.at, styles.hero, { left: 16, top: 128, alignItems: 'flex-end' }]}>
        <Text style={type(POSTER, 96, INK.accent, { leading: 0.9 })}>{signed(lift.change)}</Text>
        <Text style={[{ marginBottom: 8 }, type(POSTER, 30, INK.accent)]}>KG</Text>
      </View>
      <Text style={[styles.at, { left: 20, top: 250 }, type(BODY_BOLD, 13, INK.muted)]}>
        {`De ${formatKilos(lift.from)} kg a ${formatKilos(lift.to)} kg`}
      </Text>
      <Svg width={CARD_WIDTH} height={CARD_HEIGHT} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="liftArea" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={INK.accent} stopOpacity={0.22} />
            <Stop offset="1" stopColor={INK.accent} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {first && last ? (
          <Path
            d={`${pathOf(points)} L${last.x.toFixed(1)} ${String(CHART.bottom + 10)} L${first.x.toFixed(1)} ${String(CHART.bottom + 10)} Z`}
            fill="url(#liftArea)"
          />
        ) : null}
        <Path
          d={pathOf(points)}
          stroke={INK.accent}
          strokeWidth={4}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {last ? (
          <Circle
            cx={last.x}
            cy={last.y}
            r={8}
            fill={INK.accent}
            stroke={INK.ink}
            strokeWidth={3}
          />
        ) : null}
      </Svg>
      {lift.labels.map((label, index) => (
        <Text
          key={`${label}-${String(index)}`}
          style={[
            styles.at,
            styles.centre,
            { left: CHART.left + index * step - 24, top: 482, width: 48 },
            type(BODY_HEAVY, 9, index === lift.labels.length - 1 ? INK.accent : INK.ash),
          ]}
        >
          {label}
        </Text>
      ))}
    </>
  )
}

// ———————————————————————————————————————————— 5A · the muscles on the figure

export function litOf(facts: ShareFacts, muscles: readonly MuscleTerm[]) {
  return litSlugsFor(
    muscles,
    facts.muscles.map((muscle) => muscle.code),
  )
}

export function Faces({
  lit,
  scale,
  gap,
}: {
  readonly lit: readonly string[]
  readonly scale: number
  readonly gap: number
}) {
  return (
    <View style={[styles.faces, { gap }]}>
      {(['front', 'back'] as const).map((side) => (
        <BodyFigure
          key={side}
          side={side}
          gender="male"
          scale={scale}
          lit={lit}
          inert={INERT_SLUGS}
          onPressSlug={() => undefined}
        />
      ))}
    </View>
  )
}

function SetsHead({ facts }: { readonly facts: ShareFacts }) {
  const count = facts.muscles.length
  return (
    <View style={[styles.at, styles.hero, { left: 18, top: 84 }]}>
      <Text style={type(POSTER, 96, INK.accent, { leading: 0.9 })}>{String(facts.workSets)}</Text>
      <View style={[styles.heroSide, { paddingTop: 12, gap: 2 }]}>
        <Text style={type(POSTER, 34, INK.text, { leading: 0.9 })}>SERIES</Text>
        <Text style={type(POSTER, 17, INK.muted, { leading: 0.9 })}>
          {`EN ${String(count)} ${count === 1 ? 'MÚSCULO' : 'MÚSCULOS'}`}
        </Text>
      </View>
    </View>
  )
}

function FigureCard({ facts, muscles }: ProgressCardProps) {
  const top = facts.muscles.slice(0, 5)
  return (
    <>
      <Lockup />
      <Kicker>{facts.kicker}</Kicker>
      <SetsHead facts={facts} />
      <Svg width={CARD_WIDTH} height={CARD_HEIGHT} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="halo" cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor={INK.accent} stopOpacity={0.12} />
            <Stop offset="1" stopColor={INK.accent} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={150} cy={315} rx={190} ry={165} fill="url(#halo)" />
      </Svg>
      <View style={[styles.at, { left: 0, top: 168, width: CARD_WIDTH }]} pointerEvents="none">
        <Faces lit={litOf(facts, muscles)} scale={0.72} gap={8} />
      </View>
      {top.map((muscle, index) => {
        const lead = index === 0
        const name = muscle.name.toUpperCase()
        return (
          <View
            key={muscle.code}
            style={[
              styles.at,
              styles.chip,
              {
                left: 20 + index * 53,
                backgroundColor: lead ? '#55EFFB1F' : TRACK,
                borderColor: lead ? '#55EFFB66' : '#FFFFFF10',
              },
            ]}
          >
            <Text style={type(POSTER, 22, lead ? INK.accent : INK.text, { leading: 0.9 })}>
              {String(muscle.sets)}
            </Text>
            <Text
              numberOfLines={2}
              style={[
                styles.centre,
                type(BODY_HEAVY, name.length > 8 ? 5.6 : 6.5, INK.muted, { tracking: 0.6 }),
              ]}
            >
              {name}
            </Text>
          </View>
        )
      })}
    </>
  )
}

// ———————————————————————————————————————————— 2 · the month as a calendar

const SHADES = [TRACK, '#55EFFB55', '#55EFFB99', INK.accent] as const

function CalendarCard({ facts }: ProgressCardProps) {
  const rows = Math.ceil((facts.offset + facts.cells.length) / 7)
  const step = rows > 5 ? 31 : 36
  const trained = facts.cells.filter((cell) => cell.level > 0).length
  const [big, small] =
    facts.streak >= 2
      ? [`${String(facts.streak)} MESES`, 'SIN FALLARLE AL PLAN']
      : facts.planned > 0
        ? [`${String(facts.fulfilled)} DE ${String(facts.planned)}`, 'SESIONES DEL PLAN']
        : [`${String(trained)} ${trained === 1 ? 'DÍA' : 'DÍAS'}`, 'ENTRENADOS']
  return (
    <>
      <Lockup />
      <Kicker>MI MES</Kicker>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[
          styles.at,
          { left: 16, top: 80, width: 268 },
          type(POSTER, 64, INK.text, { leading: 0.9 }),
        ]}
      >
        {facts.monthName}
      </Text>
      <Text style={[styles.at, { left: 20, top: 142 }, type(BODY_BOLD, 12, INK.muted)]}>
        {`${String(facts.sessions)} ${facts.sessions === 1 ? 'sesión' : 'sesiones'} · ${kilosOf(facts)} kg levantados`}
      </Text>
      {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((day, index) => (
        <Text
          key={day}
          style={[
            styles.at,
            styles.centre,
            { left: 20 + index * 36, top: 180, width: 30 },
            type(BODY_HEAVY, 10, INK.ash),
          ]}
        >
          {day}
        </Text>
      ))}
      {facts.cells.map((cell) => {
        const at = facts.offset + cell.day - 1
        return (
          <View
            key={cell.day}
            style={[
              styles.at,
              styles.cell,
              {
                left: 20 + (at % 7) * 36,
                top: 200 + Math.floor(at / 7) * step,
                height: step - 6,
                backgroundColor: SHADES[cell.level],
              },
            ]}
          />
        )
      })}
      <Text
        style={[styles.at, { left: 20, top: 412 }, type(POSTER, 36, INK.text, { leading: 0.95 })]}
      >
        {big}
      </Text>
      <Text
        style={[styles.at, { left: 20, top: 446 }, type(POSTER, 22, INK.accent, { leading: 0.95 })]}
      >
        {small}
      </Text>
    </>
  )
}

// ———————————————————————————————————————————— N1 · N3 · N5 · N2 · N4 · N6 · the minimal ones

const minimalKicker = (facts: ShareFacts) => (facts.kind === 'week' ? facts.kicker : facts.label)

function Centred({
  y,
  style,
  children,
}: {
  readonly y: number
  readonly style: TextStyle
  readonly children: string
}) {
  return <Text style={[styles.at, styles.wide, { top: y }, style]}>{children}</Text>
}

function TotalCard({ facts }: ProgressCardProps) {
  return (
    <>
      <Kicker centred>{minimalKicker(facts)}</Kicker>
      <Centred y={196} style={type(POSTER, 76, INK.text, { leading: 0.9 })}>
        {kilosOf(facts)}
      </Centred>
      <Centred y={272} style={type(BODY_HEAVY, 10, INK.muted, { tracking: 3 })}>
        KILOS LEVANTADOS
      </Centred>
      {facts.change === null ? null : (
        <>
          <Centred y={318} style={type(POSTER, 20, INK.accent)}>
            {signed(facts.change, ' %')}
          </Centred>
          <Centred y={342} style={type(BODY_HEAVY, 8, INK.ash, { tracking: 1.6 })}>
            {`FRENTE A ${facts.against}`}
          </Centred>
        </>
      )}
      <FootLockup />
    </>
  )
}

const WEEK_DOTS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const

function DotsCard({ facts }: ProgressCardProps) {
  const week = facts.kind === 'week'
  return (
    <>
      <Kicker centred>{minimalKicker(facts)}</Kicker>
      <Centred y={week ? 150 : 110} style={type(POSTER, 120, INK.text, { leading: 0.9 })}>
        {String(facts.sessions)}
      </Centred>
      <Centred y={week ? 262 : 222} style={type(BODY_HEAVY, 10, INK.muted, { tracking: 3 })}>
        {facts.sessions === 1 ? 'SESIÓN' : 'SESIONES'}
      </Centred>
      {week ? (
        facts.bars.map((bar, index) => {
          const x = 53 + index * 30
          const on = bar.kg !== null
          return (
            <View key={bar.label}>
              <View
                style={[
                  styles.at,
                  styles.weekDot,
                  {
                    left: x,
                    borderColor: on ? INK.accent : '#FFFFFF33',
                    backgroundColor: on ? INK.accent : 'transparent',
                  },
                ]}
              />
              <Text
                style={[
                  styles.at,
                  styles.centre,
                  { left: x - 3, top: 344, width: 20 },
                  type(BODY_HEAVY, 8.5, on ? INK.accent : INK.ash),
                ]}
              >
                {WEEK_DOTS[index] ?? ''}
              </Text>
            </View>
          )
        })
      ) : (
        <>
          {WEEK_DOTS.map((day, index) => (
            <Text
              key={day}
              style={[
                styles.at,
                styles.centre,
                { left: 62 + index * 26, top: 262, width: 20 },
                type(BODY_HEAVY, 8, INK.ash),
              ]}
            >
              {day}
            </Text>
          ))}
          {facts.cells.map((cell) => {
            const at = facts.offset + cell.day - 1
            return (
              <View
                key={cell.day}
                style={[
                  styles.at,
                  styles.monthDot,
                  {
                    left: 67 + (at % 7) * 26,
                    top: 280 + Math.floor(at / 7) * 26,
                    backgroundColor: cell.level > 0 ? INK.accent : '#FFFFFF1F',
                  },
                ]}
              />
            )
          })}
        </>
      )}
      <FootLockup />
    </>
  )
}

const SEGMENT_SHADES = [
  '#55EFFB',
  '#3FC9D6',
  '#2E9FAE',
  '#257C89',
  '#1D5F69',
  '#18494F',
  '#153A40',
  '#132F34',
]

function MusclesCard({ facts }: ProgressCardProps) {
  const total = facts.muscles.reduce((sum, muscle) => sum + muscle.sets, 0) || 1
  const gaps = 2 * (facts.muscles.length - 1)
  let x = 50
  return (
    <>
      <Kicker centred>{minimalKicker(facts)}</Kicker>
      <Centred y={130} style={type(POSTER, 120, INK.text, { leading: 0.9 })}>
        {String(facts.workSets)}
      </Centred>
      <Centred y={242} style={type(BODY_HEAVY, 10, INK.muted, { tracking: 3 })}>
        SERIES
      </Centred>
      {facts.muscles.map((muscle, index) => {
        const width = Math.max(2, Math.round(((200 - gaps) * muscle.sets) / total))
        const left = x
        x += width + 2
        return (
          <View
            key={muscle.code}
            style={[
              styles.at,
              styles.segment,
              {
                left,
                width,
                backgroundColor: SEGMENT_SHADES[Math.min(index, SEGMENT_SHADES.length - 1)],
              },
            ]}
          />
        )
      })}
      {facts.muscles.slice(0, 3).map((muscle, index) => {
        const y = 326 + index * 30
        return (
          <View key={muscle.code}>
            <View
              style={[
                styles.at,
                styles.legendDot,
                { top: y + 4, backgroundColor: SEGMENT_SHADES[index] },
              ]}
            />
            <Text
              style={[
                styles.at,
                { left: 76, top: y + 2 },
                type(BODY_HEAVY, 9, INK.muted, { tracking: 1.6 }),
              ]}
            >
              {muscle.name.toUpperCase()}
            </Text>
            <Text
              style={[
                styles.at,
                styles.right,
                { left: 190, top: y, width: 56 },
                type(POSTER, 18, index === 0 ? INK.accent : INK.text),
              ]}
            >
              {String(muscle.sets)}
            </Text>
          </View>
        )
      })}
      <FootLockup />
    </>
  )
}

const styles = StyleSheet.create({
  card: { width: CARD_WIDTH, height: CARD_HEIGHT, borderRadius: 24, overflow: 'hidden' },
  rim: { borderRadius: 24, borderWidth: 1, borderColor: INK.rim },
  at: { position: 'absolute' },
  wide: { left: 0, width: CARD_WIDTH, textAlign: 'center' },
  centre: { textAlign: 'center' },
  right: { textAlign: 'right' },
  hero: { flexDirection: 'row', gap: 10 },
  heroSide: { gap: 8 },
  pips: { flexDirection: 'row', gap: 4 },
  pip: { width: 16, height: 6, borderRadius: 3 },
  planTrack: { height: 6, borderRadius: 3, backgroundColor: FAINT, overflow: 'hidden' },
  planFill: { height: 6, borderRadius: 3, backgroundColor: INK.accent },
  rule: { left: 20, width: 260, height: 1, backgroundColor: FAINT },
  figures: {
    left: 20,
    top: 454,
    width: 260,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  figure: { gap: 2 },
  column: { height: COLUMNS.height, borderRadius: 10, backgroundColor: '#FFFFFF08' },
  restDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#FFFFFF26' },
  versusBar: {
    left: 20,
    height: 34,
    borderRadius: 10,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  faces: { flexDirection: 'row', justifyContent: 'center' },
  chip: {
    top: 462,
    width: 48,
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 3,
  },
  cell: { width: 30, borderRadius: 8 },
  weekDot: { top: 322, width: 14, height: 14, borderRadius: 7, borderWidth: 1.5 },
  monthDot: { width: 10, height: 10, borderRadius: 5 },
  segment: { top: 292, height: 6, borderRadius: 3 },
  legendDot: { left: 62, width: 6, height: 6, borderRadius: 3 },
})
