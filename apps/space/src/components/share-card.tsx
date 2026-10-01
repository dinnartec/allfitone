/**
 * The shareable cards of «Compártelo» (FIN-17, ADR-036).
 *
 * **Drawn on the design's own grid.** Every card is laid out at 300 × 533 points, the
 * size the pen.dev frames use, and scaled as a whole: the screen shows it at whatever
 * fits, and the capture renders it at 360 points so three device pixels per point give
 * a 1080 × 1920 story. Coordinates are the design's, so a card can be checked against
 * its frame point by point.
 *
 * **Turned the way the design turns.** pen.dev rotates a node about its top-left corner
 * and counts a negative angle clockwise, so `Turned` pins `transformOrigin` there and
 * flips the sign. Rotating about the centre, as React Native does by default, moves
 * every tilted band and title off its mark.
 *
 * **Artwork, not interface.** A card is a poster that leaves the app, always dark
 * whatever the theme, so it paints with the brand's primitives rather than the theme's
 * semantic roles. Names, figures and sign-offs are in the leaning Barlow (`poster`),
 * labels in Manrope. The brush face and the marker were tried and taken out: on the
 * phone «NUEVO RÉCORD» in brush read as informal, not as an achievement. Sizes are the
 * design's, set by eye, not the type scale.
 *
 * **The brush is generated, not drawn:** a seeded dry-brush swash, the same on every
 * render. The logo is the Design System's — never redrawn.
 */

import { BrandLogoCarrier, ProductLockup } from '@allfitone/react-native/brand'
import { nativeFontFamily } from '@allfitone/react-native/fonts'
import { FoundationIcon, type IconName } from '@allfitone/react-native/icons'
import { color } from '@allfitone/react-native/tokens'
import { Image } from 'expo-image'
import { useMemo, type ReactNode } from 'react'
import { StyleSheet, Text, View, type TextStyle } from 'react-native'
import Svg, { Defs, G, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg'

import type { Movement, MuscleTerm } from '../client/content'
import { litSlugsFor } from '../client/exercise-catalogue'
import { INERT_SLUGS } from '../client/focus-form'
import {
  bandFigureSize,
  durationLabel,
  exerciseShape,
  exercisesLabel,
  groupsTitle,
  headline,
  recordFigure,
  daysSince,
  recordJump,
  routineTitle,
  shortDay,
  streakSteps,
  weekStartLabel,
  whenLine,
  workedMuscles,
  type CardKind,
  type ShareSummary,
} from '../client/share-cards'
import { BodyFigure, faceShowing } from './body-figure'

export const CARD_WIDTH = 300
export const CARD_HEIGHT = 533

const INK = {
  text: color.neutral.chalk,
  muted: color.neutral.steel,
  accent: color.brand.primary,
  ink: color.ink.void,
  // The design's gradient starts on a blue a step above `ink.panel`; it exists only here.
  glow: '#0D1D28',
  panel: color.ink.panel,
  rule: '#86BEC824',
  ash: color.neutral.ash,
  deep: color.brand.turquoiseDark,
  rim: '#86BEC840',
} as const

const POSTER = nativeFontFamily.displayExtraboldItalic
// Manrope ships 400, 700 and 800; the design's 600 reads as the 700.
const BODY_BOLD = nativeFontFamily.bodyBold
const BODY_HEAVY = nativeFontFamily.bodyExtrabold

export interface ShareCatalogue {
  readonly movements: readonly Pick<Movement, 'id' | 'muscles'>[]
  readonly muscles: readonly MuscleTerm[]
}

export interface ShareCardProps {
  readonly kind: CardKind
  readonly summary: ShareSummary
  readonly catalogue: ShareCatalogue
  readonly timeZone: string
  /** The photograph for the photo card: the one picked, or the routine's. */
  readonly photo: string | null
}

/** One card, at the design's size; the caller scales it. */
export function ShareCard(props: ShareCardProps) {
  return (
    <View style={styles.card}>
      {cardFor(props)}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.rim]} />
    </View>
  )
}

function cardFor(props: ShareCardProps) {
  switch (props.kind) {
    case 'photo':
      return <MainCard {...props} withPhoto />
    case 'plain':
      return <MainCard {...props} withPhoto={false} />
    case 'record':
      return <RecordCard {...props} />
    case 'streak':
      return <StreakCard {...props} />
    case 'session':
      return <SessionCard {...props} />
    case 'muscles':
      return <MusclesCard {...props} />
    case 'number':
      return <NumberCard {...props} />
  }
}

/** A card drawn at `CARD_WIDTH × scale`, the whole of it scaled from its top-left. */
export function Scaled({
  scale,
  children,
}: {
  readonly scale: number
  readonly children: ReactNode
}) {
  return (
    <View style={{ width: CARD_WIDTH * scale, height: CARD_HEIGHT * scale }}>
      <View
        style={{
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
          transformOrigin: 'top left',
          transform: [{ scale }],
        }}
      >
        {children}
      </View>
    </View>
  )
}

// ———————————————————————————————————————————— shared pieces

/** The ground every card shares: a dark gradient, and the photograph when there is one. */
function Frame({
  children,
  photo,
}: {
  readonly children: ReactNode
  readonly photo?: string | null
}) {
  return (
    <View style={styles.frame}>
      <Svg width={CARD_WIDTH} height={CARD_HEIGHT} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="ground" x1="0.6" y1="0" x2="0.4" y2="1">
            <Stop offset="0" stopColor={INK.glow} />
            <Stop offset="0.7" stopColor={INK.ink} />
          </LinearGradient>
        </Defs>
        <Rect width={CARD_WIDTH} height={CARD_HEIGHT} fill="url(#ground)" />
      </Svg>
      {photo ? (
        <View style={styles.photo}>
          <Image source={photo} style={StyleSheet.absoluteFill} contentFit="cover" />
          {/* Darkened at the top for the header and to ink at the foot, where the band starts. */}
          <Svg width={CARD_WIDTH} height={330} style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id="veil" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={INK.ink} stopOpacity={0.67} />
                <Stop offset="0.25" stopColor={INK.ink} stopOpacity={0} />
                <Stop offset="0.6" stopColor={INK.ink} stopOpacity={0.5} />
                <Stop offset="1" stopColor={INK.ink} stopOpacity={1} />
              </LinearGradient>
            </Defs>
            <Rect width={CARD_WIDTH} height={330} fill="url(#veil)" />
          </Svg>
        </View>
      ) : null}
      {children}
    </View>
  )
}

interface Box {
  readonly x: number
  readonly y: number
  readonly width?: number
  readonly height?: number
  /** In pen.dev's sense: degrees, negative clockwise, about the top-left corner. */
  readonly turn?: number
}

/** Places a node at the design's coordinates and turns it as pen.dev does. */
function Turned({
  x,
  y,
  width,
  height,
  turn = 0,
  children,
}: Box & { readonly children: ReactNode }) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        ...(width === undefined ? {} : { width }),
        ...(height === undefined ? {} : { height }),
        transformOrigin: 'top left',
        transform: [{ rotate: `${-turn}deg` }],
      }}
    >
      {children}
    </View>
  )
}

/** Deterministic noise, so a card draws the same brush every time it renders. */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

interface Bristle {
  readonly d: string
  readonly width: number
  readonly alpha: number
}

/**
 * A dry-brush swash (prototype 54): a few hundred bristles, each a tapered stroke that
 * starts late, ends early and skips where the paint ran out. Even rows of bars read as
 * stripes; this reads as one stroke of a dry brush.
 */
function bristlesOf(width: number, height: number, seed: number): readonly Bristle[] {
  const rnd = seeded(seed)
  const rows = Math.round(height / 1.6)
  const out: Bristle[] = []
  for (let row = 0; row < rows; row += 1) {
    const t = row / (rows - 1)
    const edge = Math.min(t, 1 - t) * 2
    const y = t * height + (rnd() - 0.5) * 1.2
    const start = (1 - edge) * 0.12 * width + rnd() * 0.06 * width
    const end = width - (1 - edge) * 0.1 * width - rnd() * 0.08 * width
    let at = start
    while (at < end) {
      const stop = Math.min(end, at + (0.25 + rnd() * 0.75) * (end - start))
      const bow = (rnd() - 0.5) * 2.4
      out.push({
        d: `M${at.toFixed(1)} ${y.toFixed(1)}Q${((at + stop) / 2).toFixed(1)} ${(y + bow).toFixed(1)} ${stop.toFixed(1)} ${(y + bow * 0.3).toFixed(1)}`,
        width: 0.5 + rnd() * 1.6 * (0.4 + edge),
        alpha: (0.35 + rnd() * 0.65) * (0.45 + 0.55 * edge),
      })
      at = stop + rnd() * 0.07 * width
    }
  }
  return out
}

/** The swash at the design's coordinates, turned as pen.dev turns and faded at its ends. */
function Swash({
  seed,
  opacity,
  ...box
}: Box & {
  readonly width: number
  readonly height: number
  readonly seed: number
  readonly opacity: number
}) {
  const bristles = useMemo(
    () => bristlesOf(box.width, box.height, seed),
    [box.width, box.height, seed],
  )
  const id = `swash${String(seed)}`
  return (
    <Turned {...box}>
      <Svg width={box.width} height={box.height + 8}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={INK.accent} stopOpacity={0} />
            <Stop offset="0.18" stopColor={INK.accent} />
            <Stop offset="0.85" stopColor={INK.accent} />
            <Stop offset="1" stopColor={INK.accent} stopOpacity={0.2} />
          </LinearGradient>
        </Defs>
        <G fill="none" stroke={`url(#${id})`} strokeLinecap="round" opacity={opacity}>
          {bristles.map((bristle, index) => (
            <Path
              key={index}
              d={bristle.d}
              strokeWidth={bristle.width}
              strokeOpacity={bristle.alpha}
            />
          ))}
        </G>
      </Svg>
    </Turned>
  )
}

/** How far above a tight line an accent reaches, as a share of the size. */
const ACCENT_ROOM = 0.3

/** A line of text in one of the card faces; `leading` is pen.dev's multiplier. */
function type(
  family: string,
  size: number,
  fill: string,
  { tracking = 0, leading }: { readonly tracking?: number; readonly leading?: number } = {},
): TextStyle {
  return {
    fontFamily: family,
    fontSize: size,
    color: fill,
    letterSpacing: tracking,
    ...(leading === undefined ? {} : { lineHeight: size * leading }),
    // A line set tighter than the face clips its accents on iOS: «MÚSCULOS» lost its
    // «Ú». Room above, taken back by the margin, keeps them without moving the line.
    ...(leading !== undefined && leading < 1
      ? { paddingTop: size * ACCENT_ROOM, marginTop: -size * ACCENT_ROOM }
      : {}),
    includeFontPadding: false,
  }
}

/** The lockup on the left, what was trained and when on the right. */
function Header({ title, when }: { readonly title: string; readonly when: string }) {
  return (
    <>
      <View style={styles.logo}>
        <ProductLockup product="space" surface="dark" width={104} height={26} decorative />
      </View>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[styles.headerTitle, type(POSTER, 13, INK.text, { leading: 0.9 })]}
      >
        {title}
      </Text>
      <Text style={[styles.headerWhen, type(BODY_HEAVY, 7.5, INK.muted, { tracking: 1 })]}>
        {when}
      </Text>
    </>
  )
}

/** The carrier at the foot, and the card's sign-off beside it. */
function Foot({
  motto,
  symbolAt = 496,
  mottoAt = 500,
}: {
  readonly motto?: string
  readonly symbolAt?: number
  readonly mottoAt?: number
}) {
  return (
    <>
      <View style={[styles.symbol, { top: symbolAt }]}>
        <BrandLogoCarrier width={24} height={25} decorative />
      </View>
      {motto ? (
        <Text
          style={[styles.motto, { top: mottoAt }, type(POSTER, 11, INK.muted, { tracking: 0.6 })]}
        >
          {motto.toUpperCase()}
        </Text>
      ) : null}
    </>
  )
}

/** A small capitalised line above a title. */
function Kicker({
  x,
  y,
  children,
}: {
  readonly x: number
  readonly y: number
  readonly children: string
}) {
  return (
    <Text
      style={[styles.at, { left: x, top: y }, type(BODY_HEAVY, 10, INK.accent, { tracking: 2.4 })]}
    >
      {children}
    </Text>
  )
}

const kilos = (value: number | null) =>
  (value ?? 0).toLocaleString('es-CO', { maximumFractionDigits: 0 })

/** Where the plain card's title block sits, for a title of two lines and of one. */
const TWO_LINE_BLOCK = { kicker: 94, title: 118, detail: 216 }
const SINGLE_LINE_BLOCK = { kicker: 116, title: 136, detail: 194 }

/** A title in one line when short, else two lines as even as its words allow. */
function balancedLines(title: string): string {
  const words = title.split(' ')
  if (title.length <= 10 || words.length < 2) return title
  let best = 1
  for (let cut = 1; cut < words.length; cut += 1) {
    const longest = (at: number) =>
      Math.max(words.slice(0, at).join(' ').length, words.slice(at).join(' ').length)
    if (longest(cut) < longest(best)) best = cut
  }
  return `${words.slice(0, best).join(' ')}\n${words.slice(best).join(' ')}`
}

/** «ABDOMEN Y PECHO» as a line of prose: «Abdomen y pecho». */
const sentence = (title: string) => {
  const lower = title.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/**
 * The four figures as a row of fields (prototype 55): small label over a big figure,
 * between two hairlines. It replaced a cyan band whose brush read as scratches.
 */
function FigureRow({ figures }: { readonly figures: readonly (readonly [string, string])[] }) {
  const size = Math.min(24, bandFigureSize(figures.map(([, value]) => value)))
  return (
    <View style={[styles.at, styles.fieldRow]}>
      {figures.map(([label, value]) => (
        <View key={label} style={styles.field}>
          <Text numberOfLines={1} style={type(BODY_HEAVY, 7, INK.muted, { tracking: 1.2 })}>
            {label}
          </Text>
          <Text numberOfLines={1} style={type(POSTER, size, INK.text, { leading: 1 })}>
            {value}
          </Text>
        </View>
      ))}
    </View>
  )
}

// ———————————————————————————————————————————— 6 · 7 · the main card

/** «6 · Principal», with the photograph or without: what was done, the band, the list. */
function MainCard({
  summary,
  catalogue,
  timeZone,
  photo,
  withPhoto,
}: ShareCardProps & { readonly withPhoto: boolean }) {
  const groups = groupsTitle(summary, catalogue)
  const routine = routineTitle(summary, catalogue)
  // The routine leads the body of both, so the header gives the groups: never the
  // same thing twice on one card.
  const lines = balancedLines(routine)
  const single = !lines.includes('\n')
  // One line is a shorter block: it moves down whole, kicker and stroke with it, so it
  // stays centred over the band instead of leaving a gap under the kicker.
  const block = single ? SINGLE_LINE_BLOCK : TWO_LINE_BLOCK
  return (
    <Frame photo={withPhoto ? photo : null}>
      <Header title={groups} when={whenLine(summary, timeZone)} />
      {withPhoto ? (
        <View style={[styles.at, styles.who, { left: 20, top: 214 }]}>
          <Text style={type(BODY_HEAVY, 10, INK.accent, { tracking: 2.4 })}>
            ENTRENO COMPLETADO
          </Text>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            style={type(POSTER, 26, INK.text, { leading: 1 })}
          >
            {routine}
          </Text>
          {summary.username ? (
            <Text style={type(BODY_BOLD, 10.5, INK.muted)}>@{summary.username}</Text>
          ) : null}
        </View>
      ) : (
        <>
          <Kicker x={22} y={block.kicker}>
            ENTRENO COMPLETADO
          </Kicker>
          <Text
            numberOfLines={single ? 1 : 2}
            adjustsFontSizeToFit
            style={[
              styles.at,
              { left: 18, top: block.title, width: 264 },
              type(POSTER, 52, INK.text, { tracking: -1, leading: 0.88 }),
            ]}
          >
            {lines}
          </Text>
          <View style={[styles.at, styles.who, { left: 22, top: block.detail }]}>
            <Text style={type(BODY_BOLD, 11, INK.muted)}>
              {`${sentence(groups)} · ${exercisesLabel(summary.exercise_count)}`}
            </Text>
            {summary.username ? (
              <Text style={type(BODY_BOLD, 10.5, INK.muted)}>@{summary.username}</Text>
            ) : null}
          </View>
        </>
      )}
      <FigureRow
        figures={[
          ['DURACIÓN', durationLabel(summary.duration_seconds)],
          ['SERIES', String(summary.work_sets)],
          ['EJERCICIOS', String(summary.exercise_count)],
          ['KG TOTALES', kilos(summary.total_volume_kg)],
        ]}
      />
      <View style={[styles.at, styles.list, { left: 20, top: 378 }]}>
        <Text style={type(BODY_HEAVY, 8.5, INK.accent, { tracking: 1.6 })}>EJERCICIOS</Text>
        {summary.exercises.slice(0, 4).map((exercise) => (
          <View key={exercise.position} style={styles.listRow}>
            <Text numberOfLines={1} style={[type(BODY_BOLD, 10.5, INK.text), styles.grow]}>
              {exercise.movement ?? 'Ejercicio'}
            </Text>
            <Text style={type(POSTER, 14, INK.text, { leading: 1 })}>
              {exerciseShape(exercise)}
            </Text>
          </View>
        ))}
      </View>
    </Frame>
  )
}

// ———————————————————————————————————————————— 1 · record

/** The longest bar of the comparison: today's, the others drawn to its scale. */
const BAR = 196

/**
 * «1 · Récord» (prototype 51, option B): the new figure as the hero and two bars to
 * scale that show the jump without reading a word. Little else on purpose.
 */
function RecordCard({ summary, catalogue, timeZone }: ShareCardProps) {
  const record = headline(summary.records)
  if (!record) return <Frame>{null}</Frame>
  const figure = recordFigure(record)
  const jump = recordJump(record)
  const trainedOn = new Intl.DateTimeFormat('en-CA', { timeZone }).format(
    new Date(summary.started_at),
  )
  const days = daysSince(record, trainedOn)
  const stats: readonly (readonly [string, string])[] = [
    [`${jump.delta} ${figure.unit}`, 'MEJORA'],
    [
      record.reps ? String(record.reps) : figure.tail.toUpperCase(),
      record.reps ? 'REPS' : 'MEDIDA',
    ],
    [days === 1 ? '1 DÍA' : `${String(days)} DÍAS`, 'DESDE LA ANTERIOR'],
  ]
  return (
    <Frame>
      <Header title={routineTitle(summary, catalogue)} when={whenLine(summary, timeZone)} />
      <Kicker x={22} y={70}>
        NUEVO RÉCORD PERSONAL
      </Kicker>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[
          styles.at,
          { left: 22, top: 90, width: 256 },
          type(POSTER, 30, INK.text, { leading: 0.9 }),
        ]}
      >
        {record.movement.toUpperCase()}
      </Text>
      <Swash x={4} y={150} width={270} height={96} turn={-7} seed={11} opacity={0.32} />
      <View style={[styles.at, styles.hero]}>
        {/* Room on both sides: the italic leans past its box and iOS clipped the «1». */}
        <Text
          numberOfLines={1}
          style={[type(POSTER, 128, INK.accent, { leading: 0.9 }), styles.lean]}
        >
          {figure.big}
        </Text>
        <View style={styles.heroSide}>
          <Text style={type(POSTER, 40, INK.text, { leading: 0.9 })}>{figure.unit}</Text>
          {figure.tail ? (
            <Text style={type(POSTER, 20, INK.text, { leading: 1 })}>
              {figure.tail.startsWith('×') ? `${figure.tail} REPS` : figure.tail.toUpperCase()}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={[styles.at, styles.bars]}>
        <Text style={type(BODY_HEAVY, 8, INK.muted, { tracking: 1.6 })}>
          {figure.label} · TU PROGRESO
        </Text>
        <View style={styles.barRow}>
          <Text style={[type(BODY_HEAVY, 8, INK.muted, { tracking: 1 }), styles.barWhen]}>
            {shortDay(record.previous_on)}
          </Text>
          <View style={[styles.bar, styles.barBefore, { width: BAR * jump.ratio }]}>
            <Text numberOfLines={1} style={type(POSTER, 12, INK.muted)}>
              {jump.before} {figure.unit}
            </Text>
          </View>
        </View>
        <View style={styles.barRow}>
          <Text style={[type(BODY_HEAVY, 8, INK.accent, { tracking: 1 }), styles.barWhen]}>
            HOY
          </Text>
          <View style={[styles.bar, styles.barNow, { width: BAR }]}>
            <Text numberOfLines={1} style={type(POSTER, 12, INK.ink)}>
              {jump.now} {figure.unit}
            </Text>
          </View>
        </View>
        {/* The bracket spans exactly what today added to the earlier best. */}
        <View style={styles.bracketRow}>
          <View
            style={[styles.bracket, { left: 54 + BAR * jump.ratio, width: BAR * (1 - jump.ratio) }]}
          />
        </View>
        <Text style={[type(POSTER, 16, INK.accent), styles.delta]}>
          {jump.delta} {figure.unit}
        </Text>
      </View>
      <View style={[styles.at, styles.stats]}>
        {stats.map(([value, label]) => (
          <View key={label} style={styles.stat}>
            <Text numberOfLines={1} style={type(POSTER, 20, INK.text, { leading: 1 })}>
              {value}
            </Text>
            <Text numberOfLines={1} style={type(BODY_HEAVY, 7, INK.muted, { tracking: 1 })}>
              {label}
            </Text>
          </View>
        ))}
      </View>
      <Foot motto="pequeños avances, grandes resultados" />
    </Frame>
  )
}

// ———————————————————————————————————————————— 2 · streak

/** The steps' geometry: one a week, each a rise higher, on a shared floor. */
const STEP = { width: 36, gap: 4, left: 30, floor: 446, rise: 26 } as const
const stepX = (index: number) => STEP.left + index * (STEP.width + STEP.gap) + STEP.width / 2
const stepTop = (index: number) => STEP.floor - STEP.rise * (index + 1)

/**
 * «2 · Racha» as steps (prototype 54): a step a week, each higher than the last, and the
 * next one drawn and waiting. Two callouts name where it started and where it stands.
 */
function StreakCard({ summary, catalogue, timeZone }: ShareCardProps) {
  const weeks = summary.streak_weeks
  const { first, shown } = streakSteps(weeks)
  const last = shown - 1
  // Both callouts hang the same way: left-aligned, their line `CALL_INSET` in from the
  // text's edge, so the two read as one system rather than two placements.
  const nowCall = { left: stepX(last) - CALL_INSET, top: stepTop(last) - 82 }
  return (
    <Frame>
      <Header title={routineTitle(summary, catalogue)} when={whenLine(summary, timeZone)} />
      <Kicker x={22} y={70}>
        RACHA ACTIVA
      </Kicker>
      <Text
        numberOfLines={1}
        style={[
          styles.at,
          { left: 18, top: 100 },
          type(POSTER, 56, INK.text, { tracking: -1, leading: 0.9 }),
        ]}
      >
        {weeks} SEMANAS
      </Text>
      <Text style={[styles.at, { left: 22, top: 152 }, type(POSTER, 15, INK.muted)]}>
        + SIN SALTARTE NINGUNA
      </Text>
      <Svg width={CARD_WIDTH} height={CARD_HEIGHT} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="stepRest" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={INK.ash} />
            <Stop offset="1" stopColor={INK.ash} stopOpacity={0.5} />
          </LinearGradient>
          <LinearGradient id="stepLit" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={INK.accent} />
            <Stop offset="1" stopColor={INK.deep} />
          </LinearGradient>
        </Defs>
        {Array.from({ length: shown + 1 }, (_, index) => {
          const x = STEP.left + index * (STEP.width + STEP.gap)
          const height = STEP.rise * (index + 1)
          const next = index === shown
          const now = index === last
          return (
            <G key={index}>
              <Rect
                x={x}
                y={STEP.floor - height}
                width={STEP.width}
                height={height}
                rx={3}
                fill={next ? 'none' : now ? 'url(#stepLit)' : 'url(#stepRest)'}
                stroke={next ? INK.accent : INK.ink}
                strokeOpacity={next ? 0.55 : 1}
                {...(next ? { strokeDasharray: '3 3' } : {})}
              />
              <SvgText
                x={x + STEP.width / 2}
                y={STEP.floor - height + 14}
                textAnchor="middle"
                fontFamily={POSTER}
                fontSize={13}
                fill={next ? INK.accent : INK.ink}
                fillOpacity={next ? 0.7 : now ? 1 : 0.55}
              >
                {String(first + index)}
              </SvgText>
            </G>
          )
        })}
        <Path
          d={`M${String(stepX(0))} ${String(stepTop(0) - 4)}L${String(stepX(0))} 258`}
          stroke={INK.accent}
          strokeWidth={0.8}
        />
        <Path
          d={`M${String(stepX(last))} ${String(stepTop(last) - 4)}L${String(stepX(last))} ${String(nowCall.top + CALLOUT_HEIGHT)}`}
          stroke={INK.accent}
          strokeWidth={0.8}
        />
        <Path
          d={`M${String(stepX(shown))} ${String(stepTop(shown) - 4)}L${String(stepX(shown))} ${String(stepTop(shown) - 16)}`}
          stroke={INK.accent}
          strokeOpacity={0.55}
          strokeWidth={0.8}
        />
      </Svg>
      <Callout
        number={first}
        name={`SEMANA ${String(first)}`}
        caption={weekStartLabel(summary, timeZone, weeks - first)}
        style={{ left: stepX(0) - CALL_INSET, top: 214, width: 110 }}
      />
      <Callout
        number={weeks}
        name="ESTA SEMANA"
        caption="CUMPLIDA"
        style={{ ...nowCall, width: 90 }}
      />
      <Text
        style={[
          styles.at,
          { left: 22, top: 456 },
          type(BODY_HEAVY, 7, INK.accent, { tracking: 1 }),
        ]}
      >
        VAMOS POR LA {weeks + 1}
      </Text>
      <Foot symbolAt={490} />
    </Frame>
  )
}

/** A callout's height, number to caption: a straight line stops just under it. */
const CALLOUT_HEIGHT = 46
/** How far in from a callout's left edge its line falls. */
const CALL_INSET = 26

/** A numbered callout, as the anatomical plate labels its muscles. */
function Callout({
  number,
  name,
  caption,
  style,
}: {
  readonly number: number
  readonly name: string
  readonly caption: string
  readonly style: { readonly left: number; readonly top: number; readonly width: number }
}) {
  return (
    <View style={[styles.at, styles.callout, style]}>
      <Text style={type(BODY_HEAVY, 7.5, INK.accent, { tracking: 1 })}>
        {String(number).padStart(2, '0')}
      </Text>
      <Text style={type(POSTER, 15, INK.text, { leading: 1 })}>{name}</Text>
      <Text style={type(BODY_HEAVY, 7, INK.muted, { tracking: 1 })}>{caption}</Text>
    </View>
  )
}

// ———————————————————————————————————————————— 3 · session

const METRIC_ICONS: readonly IconName[] = ['time', 'frequency', 'training', 'target']

/** Each face of the session's figure: 200 × 400 units at scale 1, so 74 × 148 here. */
const SESSION_FIGURE = 0.37

/**
 * «3 · Entreno de hoy» (prototype 54, «punto medio»): the title on a dry-brush swash,
 * the four figures in a grid, and the body lit where the session worked in place of a
 * list of exercises.
 */
function SessionCard({ summary, catalogue, timeZone }: ShareCardProps) {
  const metrics: readonly (readonly [string, string])[] = [
    [durationLabel(summary.duration_seconds), 'DURACIÓN'],
    [String(summary.work_sets), 'SERIES'],
    [String(summary.exercise_count), 'EJERCICIOS'],
    [`${kilos(summary.total_volume_kg)} kg`, 'LEVANTADOS'],
  ]
  const worked = workedMuscles(summary, catalogue)
  const main = worked.filter((muscle) => muscle.main)
  const lit = litSlugsFor(
    catalogue.muscles,
    main.map((muscle) => muscle.code),
  )
  const helping = litSlugsFor(
    catalogue.muscles,
    worked.filter((muscle) => !muscle.main).map((muscle) => muscle.code),
  )
  return (
    <Frame>
      <Header title={routineTitle(summary, catalogue)} when={whenLine(summary, timeZone)} />
      <Swash x={30} y={96} width={270} height={84} turn={-7} seed={23} opacity={0.3} />
      <Kicker x={22} y={62}>
        RESUMEN DE LA SESIÓN
      </Kicker>
      <Text
        style={[styles.at, { left: 22, top: 88 }, type(POSTER, 50, INK.text, { leading: 0.9 })]}
      >
        ENTRENO
      </Text>
      <Text
        style={[styles.at, { left: 22, top: 130 }, type(POSTER, 50, INK.accent, { leading: 0.9 })]}
      >
        DE HOY
      </Text>
      <View style={[styles.at, styles.grid]}>
        {metrics.map(([value, label], index) => (
          <View key={label} style={styles.gridCell}>
            <FoundationIcon
              name={METRIC_ICONS[index] ?? 'target'}
              customSize={22}
              color={INK.accent}
              decorative
            />
            <View style={styles.metricText}>
              <Text numberOfLines={1} style={type(POSTER, 27, INK.text, { leading: 1 })}>
                {value}
              </Text>
              <Text style={type(BODY_HEAVY, 7, INK.muted, { tracking: 1 })}>{label}</Text>
            </View>
          </View>
        ))}
      </View>
      <View style={[styles.at, styles.sessionBody]}>
        {(['front', 'back'] as const).map((side) => (
          <BodyFigure
            key={side}
            side={side}
            gender="male"
            scale={SESSION_FIGURE}
            lit={lit}
            secondary={helping}
            inert={INERT_SLUGS}
            onPressSlug={() => undefined}
          />
        ))}
      </View>
      <View style={[styles.at, styles.sessionMuscles]}>
        {main.slice(0, 3).map((muscle) => (
          <Text
            key={muscle.code}
            style={type(BODY_HEAVY, 7, INK.text, { tracking: 1, leading: 1.7 })}
          >
            {muscle.name.toUpperCase()}
          </Text>
        ))}
      </View>
      <Foot />
    </Frame>
  )
}

// ———————————————————————————————————————————— 4 · muscles

/** The plate's figure: 200 × 400 units at scale 1, so 130 × 260 here. */
const PLATE_SCALE = 0.65
const PLATE = { x: 85, y: 190, width: 200 * PLATE_SCALE, height: 400 * PLATE_SCALE } as const

/**
 * Where a callout's line lands on each face, as a share of the figure's box. Read off
 * the figure, not anatomy: a slug missing here gets a callout without a line.
 */
const ANCHORS: Readonly<Record<string, readonly [number, number]>> = {
  chest: [0.4, 0.24],
  abs: [0.5, 0.37],
  obliques: [0.4, 0.4],
  quadriceps: [0.4, 0.6],
  adductors: [0.47, 0.57],
  tibialis: [0.4, 0.8],
  calves: [0.4, 0.8],
  biceps: [0.25, 0.3],
  triceps: [0.25, 0.3],
  deltoids: [0.29, 0.2],
  forearm: [0.18, 0.42],
  trapezius: [0.5, 0.16],
  'upper-back': [0.42, 0.27],
  'lower-back': [0.5, 0.4],
  gluteal: [0.44, 0.5],
  hamstring: [0.42, 0.64],
}

/** Callouts alternate sides, top to bottom, so no two lines cross. */
const CALLOUT_SLOTS = [
  { side: 'left', y: 214 },
  { side: 'right', y: 262 },
  { side: 'left', y: 330 },
] as const

/**
 * «4 · Músculos» as an anatomical plate (prototype 51, option C): the main muscle as
 * the headline, numbered callouts on the figure, and what only helped in an inset.
 */
function MusclesCard({ summary, catalogue, timeZone }: ShareCardProps) {
  const worked = workedMuscles(summary, catalogue)
  const main = worked.filter((muscle) => muscle.main).slice(0, CALLOUT_SLOTS.length)
  const helping = worked.filter((muscle) => !muscle.main).slice(0, 3)
  const slugOf = new Map(catalogue.muscles.map((muscle) => [muscle.code, muscle.body_slug]))
  const lit = litSlugsFor(
    catalogue.muscles,
    main.map((muscle) => muscle.code),
  )
  const assist = litSlugsFor(
    catalogue.muscles,
    helping.map((muscle) => muscle.code),
  )
  const face = faceShowing('male', lit)
  const [lead, ...rest] = main
  return (
    <Frame>
      <Header title={routineTitle(summary, catalogue)} when={whenLine(summary, timeZone)} />
      <Kicker x={22} y={70}>
        MÚSCULO PRINCIPAL
      </Kicker>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[
          styles.at,
          // Clear of the kicker even with an accent on a capital: «CUÁDRICEPS» reached it.
          { left: 18, top: 100, width: 264 },
          type(POSTER, 56, INK.text, { tracking: -1, leading: 0.9 }),
        ]}
      >
        {(lead?.name ?? 'Cuerpo completo').toUpperCase()}
      </Text>
      {rest.length > 0 ? (
        <Text style={[styles.at, { left: 22, top: 152 }, type(POSTER, 15, INK.muted)]}>
          + {rest.map((muscle) => muscle.name.toUpperCase()).join(' Y ')}
        </Text>
      ) : null}
      <View style={[styles.at, styles.plate]}>
        <BodyFigure
          side={face}
          gender="male"
          scale={PLATE_SCALE}
          lit={lit}
          secondary={assist}
          inert={INERT_SLUGS}
          onPressSlug={() => undefined}
        />
      </View>
      <Svg width={CARD_WIDTH} height={CARD_HEIGHT} style={StyleSheet.absoluteFill}>
        {main.map((muscle, index) => {
          const slot = CALLOUT_SLOTS[index]
          const anchor = ANCHORS[slugOf.get(muscle.code) ?? '']
          if (!slot || !anchor) return null
          // The figure is symmetric: a right-hand callout points at the mirrored side.
          const ax = PLATE.x + PLATE.width * (slot.side === 'left' ? anchor[0] : 1 - anchor[0])
          const ay = PLATE.y + PLATE.height * anchor[1]
          const from = slot.side === 'left' ? 82 : 218
          return (
            <Path
              key={muscle.code}
              d={`M${String(from)} ${String(slot.y + 14)} L${String(ax)} ${String(ay)}`}
              stroke={INK.accent}
              strokeWidth={0.8}
              fill="none"
            />
          )
        })}
      </Svg>
      {main.map((muscle, index) => {
        const slot = CALLOUT_SLOTS[index]
        if (!slot) return null
        return (
          <View
            key={muscle.code}
            style={[
              styles.at,
              styles.callout,
              slot.side === 'left' ? styles.calloutLeft : styles.calloutRight,
              { top: slot.y },
            ]}
          >
            <Text style={type(BODY_HEAVY, 7.5, INK.accent, { tracking: 1 })}>
              {String(index + 1).padStart(2, '0')}
            </Text>
            <Text numberOfLines={2} style={type(POSTER, 15, INK.text, { leading: 1 })}>
              {muscle.name.toUpperCase()}
            </Text>
            <Text style={type(BODY_HEAVY, 7, INK.muted, { tracking: 1 })}>
              {muscle.sets} SERIES
            </Text>
          </View>
        )
      })}
      {helping.length > 0 ? (
        <View style={[styles.at, styles.inset]}>
          <Text style={type(BODY_HEAVY, 7, INK.muted, { tracking: 1.4 })}>DE APOYO</Text>
          {helping.map((muscle) => (
            <Text key={muscle.code} style={type(BODY_BOLD, 9.5, INK.text)}>
              {muscle.name}
            </Text>
          ))}
        </View>
      ) : null}
      <Foot motto="tu cuerpo también progresa" symbolAt={490} mottoAt={484} />
    </Frame>
  )
}

// ———————————————————————————————————————————— 5 · number

/** The numeral's box: the design sets it at 230 on a 300-wide card. */
const NUMERAL = { top: 100, height: 210, size: 230 } as const

/**
 * «5 · Entreno número» (prototype 52, option C): the count as an outlined numeral, the
 * routine under it, and the figures as numbered callouts in the anatomical plate's way.
 * The outline is SVG text: React Native's text has no stroke.
 */
function NumberCard({ summary, catalogue, timeZone }: ShareCardProps) {
  const figures: readonly (readonly [string, string])[] = [
    [String(summary.work_sets), 'SERIES'],
    [String(summary.exercise_count), 'EJERCICIOS'],
    [`${kilos(summary.total_volume_kg)} KG`, 'LEVANTADOS'],
  ]
  return (
    <Frame>
      <Header title={groupsTitle(summary, catalogue)} when={whenLine(summary, timeZone)} />
      <Text
        style={[
          styles.at,
          styles.wide,
          { top: 84 },
          type(BODY_HEAVY, 10, INK.accent, { tracking: 2.4, leading: 1.2 }),
        ]}
      >
        ESTE FUE TU ENTRENO NÚMERO
      </Text>
      <Svg width={CARD_WIDTH} height={NUMERAL.height} style={[styles.at, { top: NUMERAL.top }]}>
        <SvgText
          x={CARD_WIDTH / 2}
          y={NUMERAL.height * 0.86}
          textAnchor="middle"
          fontFamily={POSTER}
          fontSize={NUMERAL.size}
          fill="none"
          stroke={INK.accent}
          strokeOpacity={0.85}
          strokeWidth={1.2}
        >
          {String(summary.session_number)}
        </SvgText>
      </Svg>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[styles.at, styles.routine, type(POSTER, 30, INK.text, { leading: 1 })]}
      >
        {routineTitle(summary, catalogue)}
      </Text>
      <View style={[styles.at, styles.hairline]} />
      {figures.map(([value, label], index) => (
        <View key={label} style={[styles.at, styles.numberCall, { left: CALL_LEFTS[index] }]}>
          <Text style={type(BODY_HEAVY, 7.5, INK.accent, { tracking: 1 })}>
            {String(index + 1).padStart(2, '0')}
          </Text>
          <Text numberOfLines={1} style={type(POSTER, 24, INK.text, { leading: 1 })}>
            {value}
          </Text>
          <Text style={type(BODY_HEAVY, 7.5, INK.muted, { tracking: 1 })}>{label}</Text>
        </View>
      ))}
      <Foot motto="mismo yo, mejor versión" />
    </Frame>
  )
}

/** The three callouts' columns, as the prototype spaces them. */
const CALL_LEFTS = [20, 112, 196] as const

const styles = StyleSheet.create({
  card: { width: CARD_WIDTH, height: CARD_HEIGHT, borderRadius: 24, overflow: 'hidden' },
  // Drawn over the card and inside it: a border on the box itself grew it by two points
  // and the carousel cut the bottom edge.
  rim: { borderRadius: 24, borderWidth: 1, borderColor: INK.rim },
  frame: { width: CARD_WIDTH, height: CARD_HEIGHT, backgroundColor: INK.ink },
  photo: { position: 'absolute', left: 0, top: 0, width: CARD_WIDTH, height: 330 },
  at: { position: 'absolute' },
  wide: { left: 0, width: CARD_WIDTH, textAlign: 'center' },
  grow: { flex: 1 },
  logo: { position: 'absolute', left: 12, top: 16 },
  headerTitle: { position: 'absolute', left: 146, top: 16, width: 140, textAlign: 'right' },
  headerWhen: { position: 'absolute', left: 166, top: 33, width: 120, textAlign: 'right' },
  symbol: { position: 'absolute', left: 16 },
  motto: { position: 'absolute', left: 120, width: 164, textAlign: 'right' },
  who: { gap: 4, width: 260 },
  fieldRow: {
    left: 20,
    top: 300,
    width: 260,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: INK.rim,
  },
  field: { gap: 4 },
  list: { width: 260, gap: 6 },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: INK.rule,
  },
  hero: { left: 18, top: 150, flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  heroSide: { paddingBottom: 34, gap: 4 },
  bars: { left: 22, top: 318, width: 256, gap: 10 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barWhen: { width: 44 },
  bar: { height: 24, borderRadius: 6, justifyContent: 'center', paddingHorizontal: 8 },
  barBefore: { backgroundColor: INK.panel, borderWidth: 1, borderColor: INK.rim },
  barNow: { backgroundColor: INK.accent },
  delta: { alignSelf: 'flex-end', marginTop: -4 },
  lean: { paddingHorizontal: 8, marginHorizontal: -8 },
  bracketRow: { height: 8, marginTop: -4 },
  bracket: {
    position: 'absolute',
    top: 0,
    height: 8,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: INK.accent,
  },
  stats: { left: 22, top: 452, width: 256, flexDirection: 'row', gap: 16 },
  stat: { gap: 2 },
  metricText: { gap: 1 },
  grid: { left: 22, top: 204, width: 256, flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 },
  gridCell: { width: '50%', flexDirection: 'row', alignItems: 'center', gap: 10 },
  sessionBody: { left: 52, top: 322, flexDirection: 'row' },
  sessionMuscles: { left: 206, top: 368 },
  plate: { left: PLATE.x, top: PLATE.y, width: PLATE.width, height: PLATE.height },
  callout: { width: 66, gap: 2 },
  calloutLeft: { left: 16 },
  calloutRight: { left: 220 },
  inset: {
    left: 214,
    top: 380,
    width: 72,
    gap: 3,
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: INK.rim,
  },
  routine: { left: 20, top: 318, width: 260, textAlign: 'center' },
  hairline: { left: 20, top: 372, width: 260, height: 1, backgroundColor: INK.rim },
  numberCall: { top: 388, gap: 3 },
})
