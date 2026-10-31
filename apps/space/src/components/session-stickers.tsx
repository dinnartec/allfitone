/**
 * The transparent stickers of «Compártelo» (FIN-SH2): a finished session's figures
 * alone on nothing, to paste over a photograph of the person's own.
 *
 * Drawn the way the stickers of «Progreso» are (`progress-stickers`): at the size they
 * are captured, never enlarged, so the type stays sharp; white and cyan with a soft
 * shadow, and no panel behind.
 */

import { FoundationIcon } from '@allfitone/react-native/icons'
import { StyleSheet, Text, View } from 'react-native'

import { litSlugsFor } from '../client/exercise-catalogue'
import {
  durationLabel,
  headline,
  recordGain,
  routineTitle,
  whenLine,
  workedMuscles,
  type ShareSummary,
  type StickerKind,
} from '../client/share-cards'
import { Faces } from './progress-share-card'
import { stickerPen, type StickerPen } from './progress-stickers'
import { BODY_HEAVY, INK, POSTER, type ShareCatalogue } from './share-card'

const WHITE = '#FFFFFF'

/** Each sticker's box at scale 1, as its frame in FIN-SH2 gives it. */
export const SESSION_STICKER_SIZE: Readonly<
  Record<StickerKind, { readonly width: number; readonly height: number }>
> = {
  figures: { width: 280, height: 90 },
  record: { width: 260, height: 200 },
  streak: { width: 260, height: 220 },
  strip: { width: 276, height: 60 },
  muscles: { width: 260, height: 300 },
  number: { width: 260, height: 200 },
}

export interface SessionStickerProps {
  readonly kind: StickerKind
  readonly summary: ShareSummary
  readonly catalogue: ShareCatalogue
  readonly timeZone: string
  /** How many points each of the design's points takes. */
  readonly scale: number
}

interface Drawn extends StickerPen {
  readonly summary: ShareSummary
  readonly catalogue: ShareCatalogue
  readonly timeZone: string
}

export function SessionSticker({ kind, scale, ...rest }: SessionStickerProps) {
  const drawn: Drawn = { ...rest, ...stickerPen(scale) }
  const box = SESSION_STICKER_SIZE[kind]
  return (
    <View style={{ width: drawn.u(box.width), height: drawn.u(box.height) }}>
      {stickerFor(kind, drawn)}
    </View>
  )
}

function stickerFor(kind: StickerKind, drawn: Drawn) {
  switch (kind) {
    case 'figures':
      return <FiguresSticker {...drawn} />
    case 'record':
      return <RecordSticker {...drawn} />
    case 'streak':
      return <StreakSticker {...drawn} />
    case 'strip':
      return <StripSticker {...drawn} />
    case 'muscles':
      return <MusclesSticker {...drawn} />
    case 'number':
      return <NumberSticker {...drawn} />
  }
}

const kilos = (value: number | null) =>
  (value ?? 0).toLocaleString('es-CO', { maximumFractionDigits: 0 })

/** «MAR 20», the day alone from «MAR 20 · SESIÓN 10». */
const dayOf = (summary: ShareSummary, timeZone: string) =>
  whenLine(summary, timeZone).split(' · ')[0] ?? ''

function FiguresSticker({ summary, catalogue, u, ink }: Drawn) {
  const figures: readonly (readonly [string, string])[] = [
    [durationLabel(summary.duration_seconds), 'TIEMPO'],
    [String(summary.work_sets), 'SERIES'],
    summary.total_volume_kg === null
      ? [String(summary.exercise_count), 'EJERCICIOS']
      : [kilos(summary.total_volume_kg), 'KG'],
  ]
  return (
    <View style={styles.column}>
      <Text numberOfLines={1} style={ink(BODY_HEAVY, 10, INK.accent, { tracking: 1.6 })}>
        {`${routineTitle(summary, catalogue)} · SESIÓN ${String(summary.session_number)}`}
      </Text>
      <View style={[styles.row, { gap: u(18), marginTop: u(6) }]}>
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

function RecordSticker({ summary, u, ink }: Drawn) {
  const lead = headline(summary.records)
  if (!lead) return null
  const { gain, meaning } = recordGain(lead)
  return (
    <View style={styles.column}>
      <Text style={ink(BODY_HEAVY, 10, INK.accent, { tracking: 2 })}>NUEVO RÉCORD</Text>
      <Text
        numberOfLines={1}
        style={[{ marginTop: u(4), maxWidth: u(260) }, ink(POSTER, 40, WHITE, { leading: 1 })]}
      >
        {lead.movement.toUpperCase()}
      </Text>
      <Text
        numberOfLines={1}
        style={ink(POSTER, gain.length > 8 ? 76 : 96, INK.accent, { leading: 1 })}
      >
        {gain}
      </Text>
      <Text style={ink(BODY_HEAVY, 9.5, WHITE, { tracking: 1.2 })}>
        {`${kilos(lead.value)} KG · ${meaning}`}
      </Text>
    </View>
  )
}

/** The most weeks the marks draw; a longer streak shows its last ones. */
const MOST_MARKS = 6

function StreakSticker({ summary, u, ink }: Drawn) {
  const weeks = summary.streak_weeks
  return (
    <View style={styles.column}>
      <Text style={ink(POSTER, 130, INK.accent, { leading: 0.9 })}>{String(weeks)}</Text>
      <Text style={[{ marginTop: u(6) }, ink(POSTER, 30, WHITE, { leading: 1 })]}>
        SEMANAS SEGUIDAS
      </Text>
      <View style={[styles.row, { gap: u(8), marginVertical: u(12) }]}>
        {Array.from({ length: Math.min(weeks, MOST_MARKS) }, (_, index) => (
          <View
            key={index}
            style={[
              styles.centred,
              { width: u(28), height: u(28), borderRadius: u(14), backgroundColor: INK.accent },
            ]}
          >
            <FoundationIcon name="check" customSize={u(14)} color={INK.ink} decorative />
          </View>
        ))}
      </View>
      <Text style={ink(BODY_HEAVY, 10, WHITE, { tracking: 1.4 })}>ENTRENANDO SIN PARAR</Text>
    </View>
  )
}

function StripSticker({ summary, catalogue, timeZone, u, ink }: Drawn) {
  const figures: (readonly [string, string])[] = [
    [durationLabel(summary.duration_seconds), 'MIN'],
    [String(summary.work_sets), 'SERIES'],
  ]
  if (summary.total_volume_kg !== null) figures.push([kilos(summary.total_volume_kg), 'KG'])
  if (summary.records.length > 0) figures.push([String(summary.records.length), 'PR'])
  return (
    <View>
      <View style={{ height: u(2), backgroundColor: INK.accent }} />
      <Text
        numberOfLines={1}
        style={[{ marginTop: u(8) }, ink(BODY_HEAVY, 8.5, INK.accent, { tracking: 1.4 })]}
      >
        {`ALLFIT · ${routineTitle(summary, catalogue)} · ${dayOf(summary, timeZone)}`}
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

function MusclesSticker({ summary, catalogue, u, ink }: Drawn) {
  const main = workedMuscles(summary, catalogue).filter((muscle) => muscle.main)
  const lit = litSlugsFor(
    catalogue.muscles,
    main.map((muscle) => muscle.code),
  )
  return (
    <View style={styles.column}>
      <Faces lit={lit} scale={u(0.52)} gap={u(10)} />
      <Text style={[{ marginTop: u(14) }, ink(POSTER, 40, WHITE, { leading: 1 })]}>
        {`${String(summary.work_sets)} ${summary.work_sets === 1 ? 'SERIE' : 'SERIES'}`}
      </Text>
      <Text
        numberOfLines={1}
        style={[
          { marginTop: u(4), maxWidth: u(260) },
          ink(BODY_HEAVY, 9.5, INK.accent, { tracking: 1.2 }),
        ]}
      >
        {main
          .slice(0, 3)
          .map((muscle) => `${muscle.name.toUpperCase()} ${String(muscle.sets)}`)
          .join(' · ')}
      </Text>
    </View>
  )
}

function NumberSticker({ summary, catalogue, u, ink }: Drawn) {
  return (
    <View style={styles.column}>
      <Text style={ink(BODY_HEAVY, 10, INK.accent, { tracking: 2.4 })}>ENTRENO NÚMERO</Text>
      {/* Room either side: the leaning face overhangs its box and the capture cut it;
          the foot is taken back, as the face leaves room below its figures. */}
      <Text
        numberOfLines={1}
        style={[
          styles.numeral,
          ink(POSTER, 170, INK.accent, { leading: 0.95 }),
          { paddingHorizontal: u(12), marginBottom: u(-20) },
        ]}
      >
        {String(summary.session_number)}
      </Text>
      <Text numberOfLines={1} style={ink(POSTER, 34, WHITE, { leading: 1 })}>
        {routineTitle(summary, catalogue)}
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
  numeral: { textAlign: 'center' },
})
