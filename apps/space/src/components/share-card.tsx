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
 * **The strokes are the design's geometry**, copied from its paths rather than drawn
 * again, and the logo is the Design System's — never redrawn.
 */

import { BrandLogoCarrier, ProductLockup } from '@allfitone/react-native/brand'
import { nativeFontFamily } from '@allfitone/react-native/fonts'
import { FoundationIcon, type IconName } from '@allfitone/react-native/icons'
import { color } from '@allfitone/react-native/tokens'
import { Image } from 'expo-image'
import type { ReactNode } from 'react'
import { StyleSheet, Text, View, type TextStyle } from 'react-native'
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg'

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
  rim: '#86BEC840',
  divider: '#86BEC855',
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

const STROKES = {
  short: {
    viewBox: '0 -2 600 95',
    d: 'M54 2l14-3 452-1 18 4-18 3-452 0z m10 8l14-4 403 0 18 4-18 4-403 0z m24 5l14-3 189 0 18 3-18 3-189 0z m214 0l14-4 255 0 18 4-18 3-255 0z m-285 4l14-3 456 0 18 3-18 3-456 0z m2 7l14-4 328 0 18 4-18 4-328 0z m402 2l14-4 83 0 18 4-18 5-83 0z m-400 5l14-4 138-1 18 5-18 5-138 0z m182-1l14-5 347 0 18 5-18 4-347 0z m-190 7l14-4 365 0 18 4-18 3-365 0z m429-3l14-4 57 0 18 4-18 4-57 0z m-397 9l14-5 512 0 18 5-18 4-512 0z m-12 3l14-3 514-1 18 4-18 3-514 0z m10 7l14-3 184-1 18 4-18 3-184 0z m260-1l14-5 192 0 18 5-18 4-192 0z m-290 4l14-3 502 0 18 3-18 3-502 0z m28 9l14-4 476-1 18 5-18 4-476 0z m-16 3l14-4 338 0 18 4-18 4-338 0z m414 1l14-3 59 0 18 3-18 3-59 0z m-394 8l14-4 436-1 18 5-18 4-436 0z m-11 8l14-4 495 0 18 4-18 3-495 0z',
  },
  band: {
    viewBox: '0 0 1000 205',
    d: 'M89 10l14-4 868 0 18 4-18 4-868 0z m21 4l14-4 287 0 18 4-18 4-287 0z m342 2l14-3 168-1 18 4-18 4-168 0z m241 0l14-4 215 0 18 4-18 4-215 0z m-622 4l14-3 833-1 18 4-18 3-833 0z m64 8l14-4 826-1 18 5-18 5-826 0z m-20 4l14-4 189 0 18 4-18 3-189 0z m258 3l14-4 267 0 18 4-18 5-267 0z m345 1l14-5 74 0 18 5-18 4-74 0z m-631 4l14-3 831 0 18 3-18 3-831 0z m-14 6l14-5 648 0 18 5-18 4-648 0z m581 2l14-5 168 0 18 5-18 4-168 0z m-533 2l14-3 231-1 18 4-18 3-231 0z m304 1l14-4 458-1 18 5-18 4-458 0z m-385 8l14-5 533 0 18 5-18 5-533 0z m369-2l14-5 496 0 18 5-18 4-496 0z m-318 4l14-3 346-1 18 4-18 3-346 0z m424 3l14-5 78 0 18 5-18 5-78 0z m154 0l14-4 222 0 18 4-18 3-222 0z m-563 3l14-4 791 0 18 4-18 3-791 0z m-7 9l14-4 826 0 18 4-18 3-826 0z m-74 5l14-5 425 0 18 5-18 5-425 0z m503-1l14-5 423 0 18 5-18 4-423 0z m-470 6l14-4 576 0 18 4-18 4-576 0z m635-1l14-4 236 0 18 4-18 4-236 0z m-620 8l14-4 836 0 18 4-18 3-836 0z m-46 5l14-4 880 0 18 4-18 3-880 0z m15 7l14-4 894-1 18 5-18 5-894 0z m-6 6l14-4 628-1 18 5-18 3-628 0z m540-1l14-3 351 0 18 3-18 3-351 0z m-557 4l14-4 854 0 18 4-18 4-854 0z m72 9l14-4 381-1 18 5-18 5-381 0z m440-3l14-3 322-1 18 4-18 4-322 0z m-465 7l14-5 430 0 18 5-18 4-430 0z m509 1l14-4 258 0 18 4-18 5-258 0z m-516 7l14-4 574-1 18 5-18 4-574 0z m573-2l14-3 266-1 18 4-18 3-266 0z m-540 6l14-3 552 0 18 3-18 4-552 0z m623 0l14-4 126 0 18 4-18 5-126 0z m-651 6l14-4 650-1 18 5-18 5-650 0z m591 1l14-5 258 0 18 5-18 4-258 0z m-567 7l14-5 203 0 18 5-18 5-203 0z m256-5l14-3 390 0 18 3-18 4-390 0z m458 1l14-4 12 0 18 4-18 4-12 0z m-722 6l14-3 777 0 18 3-18 4-777 0z m-57 9l14-4 907 0 18 4-18 4-907 0z m30 6l14-5 387 0 18 5-18 5-387 0z m439-2l14-3 285 0 18 3-18 3-285 0z m-396 5l14-4 280 0 18 4-18 4-280 0z m352 1l14-4 467 0 18 4-18 4-467 0z m-304 8l14-4 767-1 18 5-18 5-767 0z m-122 5l14-4 825 0 18 4-18 5-825 0z m26 6l14-4 804-1 18 5-18 4-804 0z m38 5l14-3 523-1 18 4-18 4-523 0z m567 1l14-5 120 0 18 5-18 4-120 0z',
  },
} as const

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

/** One of the design's strokes, in the accent. */
function Stroke({
  shape,
  opacity = 1,
  ...box
}: Box & {
  readonly shape: keyof typeof STROKES
  readonly width: number
  readonly height: number
  readonly opacity?: number
}) {
  const { viewBox, d } = STROKES[shape]
  return (
    <Turned {...box}>
      <Svg width={box.width} height={box.height} viewBox={viewBox} preserveAspectRatio="none">
        <Path d={d} fill={INK.accent} opacity={opacity} />
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
const TWO_LINE_BLOCK = { kicker: 84, title: 108, stroke: 124, strokeHeight: 92, detail: 206 }
const SINGLE_LINE_BLOCK = { kicker: 108, title: 128, stroke: 116, strokeHeight: 62, detail: 186 }

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

/** The band of four figures, level and in four centred columns of one size. */
function FigureBand({ figures }: { readonly figures: readonly (readonly [string, string])[] }) {
  const size = bandFigureSize(figures.map(([, value]) => value))
  return (
    <>
      {/* Solid under the figures: the brush's gaps ran through the labels. */}
      <View style={[styles.at, styles.bandFill]} />
      <View style={[styles.at, styles.bandFigures]}>
        {figures.map(([label, value]) => (
          <View key={label} style={styles.bandFigure}>
            <Text numberOfLines={1} style={type(BODY_HEAVY, 7.5, INK.ink, { tracking: 0.6 })}>
              {label}
            </Text>
            <Text numberOfLines={1} style={type(POSTER, size, INK.ink)}>
              {value}
            </Text>
          </View>
        ))}
      </View>
    </>
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
        <View style={[styles.at, styles.who, { left: 20, top: 190 }]}>
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
          <Stroke
            shape="short"
            x={4}
            y={block.stroke}
            width={290}
            height={block.strokeHeight}
            turn={-7}
            opacity={0.14}
          />
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
      <Stroke shape="band" x={-30} y={276} width={370} height={96} turn={-6} />
      <FigureBand
        figures={[
          ['DURACIÓN', durationLabel(summary.duration_seconds)],
          ['SERIES', String(summary.work_sets)],
          ['EJERCICIOS', String(summary.exercise_count)],
          ['KG TOTALES', kilos(summary.total_volume_kg)],
        ]}
      />
      <View style={[styles.at, styles.list, { left: 20, top: 390 }]}>
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
      <Stroke shape="short" x={40} y={150} width={260} height={110} opacity={0.14} />
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

/** The strip shows the last eight weeks; a longer streak still says its number. */
const WEEKS_SHOWN = 8

/** «2 · Racha»: the weeks as a number and as a strip of the last eight, this one last. */
function StreakCard({ summary, catalogue, timeZone }: ShareCardProps) {
  const weeks = summary.streak_weeks
  return (
    <Frame>
      <Stroke shape="short" x={60} y={106} width={240} height={120} opacity={0.14} />
      <Header title={routineTitle(summary, catalogue)} when={whenLine(summary, timeZone)} />
      <Kicker x={22} y={70}>
        RACHA ACTIVA
      </Kicker>
      <View style={[styles.at, styles.streakTitle]}>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={[type(POSTER, 176, INK.accent, { leading: 0.9 }), styles.streakNumber]}
        >
          {String(weeks)}
        </Text>
        <View style={styles.streakWords}>
          <Text style={type(POSTER, 44, INK.text, { leading: 0.9 })}>SEMANAS</Text>
          <Text style={type(POSTER, 44, INK.text, { leading: 0.9 })}>SEGUIDAS</Text>
        </View>
      </View>
      <View style={[styles.at, styles.strip]}>
        <Text style={type(BODY_HEAVY, 8, INK.muted, { tracking: 1.6 })}>
          TUS ÚLTIMAS {WEEKS_SHOWN} SEMANAS
        </Text>
        <View style={styles.weeks}>
          {Array.from({ length: WEEKS_SHOWN }, (_, index) => {
            const trained = WEEKS_SHOWN - index <= weeks
            return (
              <View
                key={index}
                style={[
                  styles.week,
                  trained ? styles.weekOn : styles.weekOff,
                  index === WEEKS_SHOWN - 1 ? styles.weekNow : null,
                ]}
              />
            )
          })}
        </View>
        <View style={styles.weekEnds}>
          <Text style={type(BODY_HEAVY, 7.5, INK.muted, { tracking: 1 })}>
            HACE {WEEKS_SHOWN - 1} SEM.
          </Text>
          <Text style={type(BODY_HEAVY, 7.5, INK.accent, { tracking: 1 })}>ESTA SEMANA</Text>
        </View>
      </View>
      <View style={[styles.at, styles.quote]}>
        <View style={styles.quoteBar} />
        <View style={styles.quoteText}>
          <Text style={type(POSTER, 27, INK.text, { leading: 0.95 })}>
            {`${String(weeks)} SEMANAS SIN PARAR.\nVAMOS POR LA ${String(weeks + 1)}.`}
          </Text>
          <Text style={type(BODY_BOLD, 10.5, INK.muted)}>
            Un entreno por semana la mantiene viva.
          </Text>
        </View>
      </View>
      <Foot symbolAt={490} />
    </Frame>
  )
}

// ———————————————————————————————————————————— 3 · session

const METRIC_ICONS: readonly IconName[] = ['time', 'frequency', 'training', 'target']

/** «3 · La sesión»: four figures with their icons, and the list below. */
function SessionCard({ summary, catalogue, timeZone }: ShareCardProps) {
  const metrics: readonly (readonly [string, string])[] = [
    ['DURACIÓN', durationLabel(summary.duration_seconds)],
    ['SERIES', String(summary.work_sets)],
    ['EJERCICIOS', String(summary.exercise_count)],
    ['LEVANTADOS', `${kilos(summary.total_volume_kg)} kg`],
  ]
  return (
    <Frame>
      {/* Behind the two lines of the title, not above them. */}
      <Stroke shape="short" x={40} y={94} width={260} height={84} opacity={0.14} />
      <Header title={routineTitle(summary, catalogue)} when={whenLine(summary, timeZone)} />
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
      <View style={[styles.at, styles.metrics, { left: 26, top: 194 }]}>
        {metrics.map(([label, value], index) => (
          <View key={label} style={styles.metric}>
            <FoundationIcon
              name={METRIC_ICONS[index] ?? 'target'}
              customSize={24}
              color={INK.accent}
              decorative
            />
            <View style={styles.metricText}>
              <Text style={type(POSTER, 27, INK.text, { leading: 1 })}>{value}</Text>
              <Text style={type(BODY_HEAVY, 7.5, INK.muted, { tracking: 1.2 })}>{label}</Text>
            </View>
          </View>
        ))}
      </View>
      <View style={[styles.at, styles.box, { left: 20, top: 390 }]}>
        <Text style={type(BODY_HEAVY, 8.5, INK.accent, { tracking: 1.6 })}>EJERCICIOS</Text>
        {summary.exercises.slice(0, 4).map((exercise) => (
          <View key={exercise.position} style={styles.boxRow}>
            <Text numberOfLines={1} style={[type(BODY_BOLD, 10.5, INK.text), styles.grow]}>
              {exercise.movement ?? 'Ejercicio'}
            </Text>
            <Text style={type(POSTER, 15, INK.text, { leading: 1 })}>
              {exerciseShape(exercise)}
            </Text>
          </View>
        ))}
      </View>
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

/** «5 · Entreno número»: the count as a race bib, what was trained on the band. */
function NumberCard({ summary, catalogue, timeZone }: ShareCardProps) {
  const title = groupsTitle(summary, catalogue)
  const figures: readonly (readonly [string, string])[] = [
    ['SERIES', String(summary.work_sets)],
    ['EJERCICIOS', String(summary.exercise_count)],
    ['LEVANTADOS', `${kilos(summary.total_volume_kg)} kg`],
  ]
  const size = bandFigureSize(figures.map(([, value]) => value))
  return (
    <Frame>
      <Header title={title} when={whenLine(summary, timeZone)} />
      <Text
        style={[
          styles.at,
          styles.wide,
          { top: 84 },
          type(BODY_HEAVY, 10.5, INK.accent, { tracking: 3, leading: 1.2 }),
        ]}
      >
        ESTE FUE TU ENTRENO NÚMERO
      </Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[
          styles.at,
          styles.wide,
          { top: 112 },
          type(POSTER, 230, INK.text, { tracking: -6, leading: 0.9 }),
        ]}
      >
        {String(summary.session_number)}
      </Text>
      <Stroke shape="band" x={-40} y={262} width={390} height={92} turn={-8} />
      {/* Solid under the words: the brush's dark gaps swallowed the letters. */}
      <Turned x={-20} y={300} width={340} height={40} turn={-8}>
        <View style={styles.wordFill} />
      </Turned>
      {/* The routine, centred on the band and shrunk to fit so a long name stays on it. */}
      <Turned x={40} y={313} width={220} turn={-8}>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={[type(POSTER, 22, INK.ink, { tracking: 2, leading: 0.9 }), styles.centre]}
        >
          {routineTitle(summary, catalogue)}
        </Text>
      </Turned>
      <View style={[styles.at, styles.numberFigures]}>
        {figures.map(([label, value], index) => (
          <View key={label} style={[styles.numberFigure, index > 0 ? styles.numberDivider : null]}>
            <Text numberOfLines={1} style={type(POSTER, size - 4, INK.text, { leading: 1 })}>
              {value}
            </Text>
            <Text style={type(BODY_HEAVY, 7.5, INK.muted, { tracking: 1.2 })}>{label}</Text>
          </View>
        ))}
      </View>
      <Foot motto="mismo yo, mejor versión" />
    </Frame>
  )
}

const styles = StyleSheet.create({
  card: { width: CARD_WIDTH, height: CARD_HEIGHT, borderRadius: 24, overflow: 'hidden' },
  // Drawn over the card and inside it: a border on the box itself grew it by two points
  // and the carousel cut the bottom edge.
  rim: { borderRadius: 24, borderWidth: 1, borderColor: INK.rim },
  frame: { width: CARD_WIDTH, height: CARD_HEIGHT, backgroundColor: INK.ink },
  photo: { position: 'absolute', left: 0, top: 0, width: CARD_WIDTH, height: 330 },
  at: { position: 'absolute' },
  right: { textAlign: 'right' },
  centre: { textAlign: 'center' },
  wide: { left: 0, width: CARD_WIDTH, textAlign: 'center' },
  grow: { flex: 1 },
  logo: { position: 'absolute', left: 12, top: 16 },
  headerTitle: { position: 'absolute', left: 146, top: 16, width: 140, textAlign: 'right' },
  headerWhen: { position: 'absolute', left: 166, top: 33, width: 120, textAlign: 'right' },
  symbol: { position: 'absolute', left: 16 },
  motto: { position: 'absolute', left: 120, width: 164, textAlign: 'right' },
  who: { gap: 4, width: 260 },
  bandFill: { left: 0, top: 313, width: CARD_WIDTH, height: 46, backgroundColor: INK.accent },
  bandFigures: { left: 16, top: 316, width: 268, flexDirection: 'row' },
  bandFigure: { flex: 1, alignItems: 'center', gap: 2 },
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
  heroSide: { paddingBottom: 18, gap: 4 },
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
  streakTitle: { left: 18, top: 100, width: 270, flexDirection: 'row' },
  streakNumber: { maxWidth: 170 },
  streakWords: { marginLeft: 14, marginTop: 32, gap: 6 },
  strip: { left: 26, top: 286, width: 248, gap: 8 },
  weeks: { flexDirection: 'row', justifyContent: 'space-between' },
  week: { width: 25, height: 36, borderRadius: 6 },
  weekOn: { backgroundColor: INK.accent },
  weekOff: { borderWidth: 1, borderColor: INK.rim },
  weekNow: { borderWidth: 2, borderColor: INK.text },
  weekEnds: { flexDirection: 'row', justifyContent: 'space-between' },
  quote: { left: 28, top: 392, width: 250, flexDirection: 'row', gap: 12 },
  quoteBar: { width: 3, height: 66, backgroundColor: INK.accent },
  quoteText: { flex: 1, gap: 8 },
  metrics: { gap: 6 },
  metric: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 38 },
  metricText: { gap: 1 },
  box: {
    width: 260,
    height: 124,
    borderWidth: 1,
    borderRadius: 8,
    borderColor: '#55EFFB59',
    backgroundColor: '#0B141DB3',
    padding: 12,
    gap: 7,
  },
  boxRow: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 15 },
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
  wordFill: { flex: 1, backgroundColor: INK.accent },
  numberFigures: { left: 20, top: 404, flexDirection: 'row', width: 260, height: 39 },
  numberFigure: { flex: 1, alignItems: 'center', gap: 3 },
  numberDivider: { borderLeftWidth: 1, borderLeftColor: INK.divider },
})
