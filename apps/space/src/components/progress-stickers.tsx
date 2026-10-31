/**
 * The transparent stickers of «Comparte tu semana» and «Comparte tu mes» (PROG-SH4,
 * PROG-SH5): the figures alone on nothing, to paste over any photograph, Strava's way.
 *
 * **Drawn at the size they are captured, never enlarged.** iOS rasterises text at the
 * size it is laid out; a sticker drawn at its box and scaled up twice for the capture
 * came out soft, every letter blurred. So each sticker takes a `scale` and multiplies
 * every measure by it — type, gaps, marks — and the capture draws it at twice its box,
 * natively. The preview draws it at whatever fits, which only ever scales down.
 *
 * They draw no panel: white and cyan type and marks, with a soft shadow that keeps
 * them legible on a light photograph.
 */

import { FoundationIcon } from '@allfitone/react-native/icons'
import { StyleSheet, Text, View, type TextStyle } from 'react-native'
import Svg, { Circle, Path } from 'react-native-svg'

import type { MuscleTerm } from '../client/content'
import { formatKilos } from '../client/progress'
import type { ProgressStickerKind, ShareFacts } from '../client/progress-share'
import { Faces, kilosOf, litOf, pathOf, signed, trendPoints } from './progress-share-card'
import { BODY_BOLD, BODY_HEAVY, INK, POSTER, type } from './share-card'

const WHITE = '#FFFFFF'

/** Each sticker's box at scale 1, as its frame in PROG-SH4 and PROG-SH5 gives it. */
export const STICKER_SIZE: Readonly<
  Record<ProgressStickerKind, { readonly width: number; readonly height: number }>
> = {
  figures: { width: 280, height: 84 },
  change: { width: 260, height: 172 },
  bars: { width: 240, height: 172 },
  ring: { width: 200, height: 250 },
  streak: { width: 260, height: 216 },
  lift: { width: 260, height: 220 },
  strip: { width: 276, height: 60 },
  calendar: { width: 220, height: 272 },
  muscles: { width: 260, height: 300 },
}

export interface ProgressStickerProps {
  readonly kind: ProgressStickerKind
  readonly facts: ShareFacts
  readonly muscles: readonly MuscleTerm[]
  /** How many points each of the design's points takes. */
  readonly scale: number
}

/** How a sticker measures at its scale; the stickers of «Compártelo» draw with it too. */
export interface StickerPen {
  /** The design's measure at this sticker's scale. */
  readonly u: (value: number) => number
  /** A line of type at this scale, with the shadow that keeps it legible. */
  readonly ink: (
    family: string,
    size: number,
    fill: string,
    options?: { readonly tracking?: number; readonly leading?: number },
  ) => TextStyle
}

export function stickerPen(scale: number): StickerPen {
  const u = (value: number) => value * scale
  return {
    u,
    ink: (family, size, fill, { tracking = 0, leading } = {}) => ({
      ...type(family, u(size), fill, { tracking: u(tracking), ...(leading ? { leading } : {}) }),
      textShadowColor: 'rgba(0, 0, 0, 0.35)',
      textShadowOffset: { width: 0, height: u(1) },
      textShadowRadius: u(6),
    }),
  }
}

interface Drawn extends StickerPen {
  readonly facts: ShareFacts
  readonly muscles: readonly MuscleTerm[]
}

/** A sticker at its own box, with nothing behind it. */
export function ProgressSticker({ kind, facts, muscles, scale }: ProgressStickerProps) {
  const drawn: Drawn = { facts, muscles, ...stickerPen(scale) }
  const { u } = drawn
  const box = STICKER_SIZE[kind]
  return (
    <View style={{ width: u(box.width), height: u(box.height) }}>{stickerFor(kind, drawn)}</View>
  )
}

function stickerFor(kind: ProgressStickerKind, drawn: Drawn) {
  switch (kind) {
    case 'figures':
      return <FiguresSticker {...drawn} />
    case 'change':
      return <ChangeSticker {...drawn} />
    case 'bars':
      return <BarsSticker {...drawn} />
    case 'ring':
      return <RingSticker {...drawn} />
    case 'streak':
      return <StreakSticker {...drawn} />
    case 'lift':
      return <LiftSticker {...drawn} />
    case 'strip':
      return <StripSticker {...drawn} />
    case 'calendar':
      return <CalendarSticker {...drawn} />
    case 'muscles':
      return <MusclesSticker {...drawn} />
  }
}

const sessionsWord = (count: number) => (count === 1 ? 'SESIÓN' : 'SESIONES')

function FiguresSticker({ facts, u, ink }: Drawn) {
  const figures: readonly (readonly [string, string])[] = [
    [String(facts.sessions), sessionsWord(facts.sessions)],
    facts.volumeKg === null ? [String(facts.workSets), 'SERIES'] : [kilosOf(facts), 'KG'],
    [facts.duration, 'TIEMPO'],
  ]
  return (
    <View style={styles.column}>
      <Text style={ink(BODY_HEAVY, 10, INK.accent, { tracking: 1.6 })}>
        {`ALLFIT SPACE · ${facts.kind === 'week' ? 'MI SEMANA' : 'MI MES'}`}
      </Text>
      <View style={[styles.row, { gap: u(14), marginTop: u(10) }]}>
        {figures.map(([value, label]) => (
          <View key={label} style={styles.column}>
            <Text numberOfLines={1} style={ink(POSTER, 46, WHITE, { leading: 1 })}>
              {value}
            </Text>
            <Text style={ink(BODY_HEAVY, 9, WHITE, { tracking: 1.2 })}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function ChangeSticker({ facts, ink }: Drawn) {
  const change = facts.change ?? 0
  const sessions = `${String(facts.sessions)} ${facts.sessions === 1 ? 'sesión' : 'sesiones'}`
  return (
    <View style={styles.column}>
      <Text style={ink(BODY_HEAVY, 10, INK.accent, { tracking: 1.6 })}>
        {facts.kind === 'week' ? 'MI SEMANA' : 'MI MES'}
      </Text>
      <Text numberOfLines={1} style={ink(POSTER, 110, WHITE, { leading: 0.95 })}>
        {signed(change, '%')}
      </Text>
      <Text style={ink(POSTER, 28, INK.accent, { leading: 1 })}>
        {change >= 0 ? 'MÁS VOLUMEN' : 'MENOS VOLUMEN'}
      </Text>
      <Text style={ink(BODY_BOLD, 12, WHITE)}>{`${kilosOf(facts)} kg · ${sessions}`}</Text>
    </View>
  )
}

function BarsSticker({ facts, u, ink }: Drawn) {
  const heaviest = Math.max(1, ...facts.bars.map((bar) => bar.kg ?? 0))
  return (
    <View>
      <Text style={ink(POSTER, 46, WHITE, { leading: 0.9 })}>
        {facts.planned > 0
          ? `${String(facts.fulfilled)} DE ${String(facts.planned)}`
          : `${String(facts.sessions)} ${sessionsWord(facts.sessions)}`}
      </Text>
      <Text style={[{ marginTop: u(4) }, ink(BODY_HEAVY, 9.5, INK.accent, { tracking: 1.2 })]}>
        {facts.planned > 0 ? `SESIONES · ${facts.label}` : facts.label}
      </Text>
      <View style={[styles.row, styles.foot, { gap: u(8), marginTop: u(14), height: u(112) }]}>
        {facts.bars.map((bar) => (
          <View key={bar.label} style={[styles.column, { width: u(26), gap: u(6) }]}>
            <View
              style={{
                width: u(26),
                borderRadius: u(6),
                height: u(bar.kg === null ? 5 : 30 + (60 * bar.kg) / heaviest),
                backgroundColor: bar.kg === null ? '#FFFFFF66' : INK.accent,
              }}
            />
            <Text style={ink(BODY_HEAVY, 10, WHITE)}>{bar.label}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function RingSticker({ facts, u, ink }: Drawn) {
  const size = u(180)
  const stroke = u(12)
  const radius = (size - stroke) / 2
  const length = 2 * Math.PI * radius
  const share = Math.min(1, facts.fulfilled / Math.max(1, facts.planned))
  const done = facts.fulfilled >= facts.planned
  return (
    <View style={styles.column}>
      <View style={[styles.centred, { width: size, height: size }]}>
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="#FFFFFF40"
            strokeWidth={stroke}
            fill="none"
          />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={INK.accent}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${String(length * share)} ${String(length)}`}
            transform={`rotate(-90 ${String(size / 2)} ${String(size / 2)})`}
          />
        </Svg>
        <Text style={ink(POSTER, 64, WHITE, { leading: 1 })}>
          {`${String(facts.fulfilled)}/${String(facts.planned)}`}
        </Text>
        <Text style={ink(BODY_HEAVY, 10, WHITE, { tracking: 1.6 })}>SESIONES</Text>
      </View>
      <Text style={[{ marginTop: u(18) }, ink(POSTER, 26, INK.accent, { leading: 1.1 })]}>
        {done ? (facts.kind === 'week' ? 'SEMANA CUMPLIDA' : 'MES CUMPLIDO') : 'DEL PLAN'}
      </Text>
      <Text style={ink(BODY_HEAVY, 9.5, WHITE, { tracking: 1.2 })}>
        {`${facts.label} · ALLFIT`}
      </Text>
    </View>
  )
}

function StreakSticker({ facts, u, ink }: Drawn) {
  return (
    <View style={styles.column}>
      <Text style={ink(POSTER, 130, INK.accent, { leading: 0.9 })}>{String(facts.streak)}</Text>
      <Text style={[{ marginTop: u(6) }, ink(POSTER, 30, WHITE, { leading: 1 })]}>
        {facts.kind === 'week' ? 'SEMANAS SEGUIDAS' : 'MESES SEGUIDOS'}
      </Text>
      <View style={[styles.row, { gap: u(8), marginVertical: u(12) }]}>
        {facts.kept.slice(-6).map((kept, index) => (
          <View
            key={index}
            style={[
              styles.centred,
              {
                width: u(28),
                height: u(28),
                borderRadius: u(14),
                backgroundColor: kept ? INK.accent : '#FFFFFF33',
              },
            ]}
          >
            {kept ? (
              <FoundationIcon name="check" customSize={u(14)} color={INK.ink} decorative />
            ) : null}
          </View>
        ))}
      </View>
      <Text style={ink(BODY_HEAVY, 10, WHITE, { tracking: 1.4 })}>SIN FALLARLE AL PLAN</Text>
    </View>
  )
}

function LiftSticker({ facts, u, ink }: Drawn) {
  const lift = facts.lift
  if (!lift) return null
  const points = trendPoints(lift.points, {
    left: u(4),
    right: u(248),
    top: u(128),
    bottom: u(206),
  })
  const figure = signed(lift.change, ' KG')
  const last = points.at(-1)
  return (
    <View>
      <Text style={ink(BODY_HEAVY, 11, INK.accent, { tracking: 1.8 })}>
        {lift.name.toUpperCase()}
      </Text>
      <Text
        numberOfLines={1}
        style={ink(POSTER, figure.length > 8 ? 52 : 66, WHITE, { leading: 1 })}
      >
        {figure}
      </Text>
      <Text style={[{ marginTop: u(6) }, ink(BODY_BOLD, 12, WHITE)]}>
        {`de ${formatKilos(lift.from)} a ${formatKilos(lift.to)} kg en ${facts.kind === 'week' ? 'una semana' : 'un mes'}`}
      </Text>
      <Svg width={u(260)} height={u(220)} style={StyleSheet.absoluteFill}>
        <Path
          d={pathOf(points)}
          stroke={INK.accent}
          strokeWidth={u(4)}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {last ? (
          <Circle
            cx={last.x}
            cy={last.y}
            r={u(8)}
            fill={INK.accent}
            stroke={WHITE}
            strokeWidth={u(2)}
          />
        ) : null}
      </Svg>
    </View>
  )
}

function StripSticker({ facts, u, ink }: Drawn) {
  const figures: (readonly [string, string])[] = [
    [String(facts.sessions), 'SES'],
    [kilosOf(facts), 'KG'],
    [facts.duration.replace(' ', ''), 'TIEMPO'],
  ]
  if (facts.change !== null) figures.push([signed(facts.change, '%'), 'VOL'])
  return (
    <View>
      <View style={{ height: u(2), backgroundColor: INK.accent }} />
      <Text style={[{ marginTop: u(8) }, ink(BODY_HEAVY, 8.5, INK.accent, { tracking: 1.4 })]}>
        {`ALLFIT · ${facts.label}`}
      </Text>
      <View style={[styles.row, styles.spread, { marginTop: u(4) }]}>
        {figures.map(([value, label]) => (
          <View key={label} style={[styles.row, styles.foot, { gap: u(3) }]}>
            <Text style={ink(POSTER, 24, WHITE, { leading: 1 })}>{value}</Text>
            <Text style={ink(BODY_HEAVY, 8, WHITE, { tracking: 1 })}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

const SHADES = ['#FFFFFF33', '#55EFFB80', '#55EFFBCC', INK.accent] as const

function CalendarSticker({ facts, u, ink }: Drawn) {
  return (
    <View>
      <Text numberOfLines={1} style={ink(POSTER, 52, WHITE, { leading: 0.9 })}>
        {facts.monthName}
      </Text>
      <Text style={[{ marginTop: u(4) }, ink(BODY_HEAVY, 10, INK.accent, { tracking: 1.4 })]}>
        {`${String(facts.sessions)} ${sessionsWord(facts.sessions)} · ${kilosOf(facts)} KG`}
      </Text>
      {facts.cells.map((cell) => {
        const at = facts.offset + cell.day - 1
        return (
          <View
            key={cell.day}
            style={{
              position: 'absolute',
              left: u((at % 7) * 31),
              top: u(80 + Math.floor(at / 7) * 31),
              width: u(25),
              height: u(25),
              borderRadius: u(7),
              backgroundColor: SHADES[cell.level],
            }}
          />
        )
      })}
    </View>
  )
}

function MusclesSticker({ facts, muscles, u, ink }: Drawn) {
  return (
    <View style={styles.column}>
      <Faces lit={litOf(facts, muscles)} scale={u(0.52)} gap={u(10)} />
      <Text style={[{ marginTop: u(14) }, ink(POSTER, 40, WHITE, { leading: 1 })]}>
        {`${String(facts.workSets)} SERIES`}
      </Text>
      <Text
        numberOfLines={1}
        style={[
          { marginTop: u(4), maxWidth: u(260) },
          ink(BODY_HEAVY, 9.5, INK.accent, { tracking: 1.2 }),
        ]}
      >
        {facts.muscles
          .slice(0, 3)
          .map((muscle) => `${muscle.name.toUpperCase()} ${String(muscle.sets)}`)
          .join(' · ')}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  column: { alignItems: 'center' },
  row: { flexDirection: 'row' },
  foot: { alignItems: 'flex-end' },
  spread: { justifyContent: 'space-between' },
  centred: { alignItems: 'center', justifyContent: 'center' },
})
