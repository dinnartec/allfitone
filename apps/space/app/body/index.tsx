/**
 * «Cuerpo» (`BODY-2`, `BODY-2b`, `BODY-2c`, HU-SP-025 and HU-SP-026): weight, the
 * measures and the progress photos, newest on top of what came before.
 *
 * **Weight is always free**, so its card is always whole. The measures and the photos
 * are Pro: without them their cards sit behind a blur with the offer on top, never a
 * preview of invented figures. The database refuses the writes either way.
 *
 * The measures are drawn on the figure the app already uses for muscles, each figure
 * joined to where it is taken, because «82 cm» means nothing until it is somewhere.
 *
 * The photos compare two at a time: the oldest and the newest unless the person picks
 * two from the strip. «Deslizar» lays one over the other under a handle; «Lado a lado»
 * puts them next to each other. A body photo is the person's alone — no consent scope
 * covers it — and the screen says so where the photos are.
 */

import { Badge } from '@allfitone/react-native/badge'
import { Button } from '@allfitone/react-native/button'
import { CoverTile } from '@allfitone/react-native/cover-tile'
import { IconButton } from '@allfitone/react-native/icon-button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { SegmentedControl } from '@allfitone/react-native/segmented-control'
import { SelectableTile } from '@allfitone/react-native/selectable-tile'
import { Sheet } from '@allfitone/react-native/sheet'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { semanticMotion } from '@allfitone/react-native/tokens'
import type { IconName } from '@allfitone/icons'
import { BlurView } from 'expo-blur'
import { Image } from 'expo-image'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg'

import {
  comparedPhotos,
  daysApart,
  decimal,
  latestOf,
  measureChange,
  monthTicks,
  seriesOf,
  shortDay,
  tenths,
  timeline,
  type BodyMetric,
  type BodyPhoto,
  type BodyRecord,
} from '../../src/client/body'
import { readBodyPhotos, readBodyRecords } from '../../src/client/body-transport'
import { INERT_SLUGS } from '../../src/client/focus-form'
import { selectionTick } from '../../src/client/selection-tick'
import { opens } from '../../src/client/plan'
import { deviceTimezone } from '../../src/client/timezone'
import { BodyFigure } from '../../src/components/body-figure'
import { CardGlow, FIGURE_TRACKING } from '../../src/components/nutrition-ui'
import { usePlan, useUpgradeSheet } from '../../src/components/upgrade-sheet'

/** A frame past the sheet's exit, so its modal is gone before the next thing appears. */
const SHEET_SETTLE_MS = 60
const READ_FAILED = 'No pudimos cargar tus medidas. Inténtalo otra vez.'
const CHART_HEIGHT = 110
const FIGURE_SCALE = 0.78
const FIGURE_WIDTH = 200 * FIGURE_SCALE
const FIGURE_HEIGHT = 400 * FIGURE_SCALE
const PHOTO_HEIGHT = 330

/** The figures a locked «Medidas» shows blurred: a shape to look forward to, not data. */
const SAMPLE_MEASURES: readonly BodyRecord[] = (
  [
    ['chest', 98, 99],
    ['arm', 34.5, 34],
    ['waist', 82, 84],
    ['hip', 96, 97.5],
    ['thigh', 56, 55.5],
  ] as const
).flatMap(([metric, now, before], index) =>
  [now, before].map((value, step) => ({
    id: `sample-${String(index)}-${String(step)}`,
    metric_code: metric,
    value,
    unit_code: 'cm' as const,
    original_value: null,
    original_unit_code: null,
    measured_on: step === 0 ? '2026-10-20' : '2026-09-20',
    has_media: false,
    recorded_at: step === 0 ? '2026-10-20T12:00:00.000Z' : '2026-09-20T12:00:00.000Z',
  })),
)

type Range = '1' | '3' | '6' | '12'
const RANGES: readonly { value: Range; label: string; accessibilityLabel: string }[] = [
  { value: '1', label: '1M', accessibilityLabel: 'Un mes' },
  { value: '3', label: '3M', accessibilityLabel: 'Tres meses' },
  { value: '6', label: '6M', accessibilityLabel: 'Seis meses' },
  { value: '12', label: '1A', accessibilityLabel: 'Un año' },
]

/** Where each measure is taken, as a share of the figure's box; and which side it reads on. */
const CALLOUTS: readonly {
  readonly code: BodyMetric
  readonly label: string
  readonly at: readonly [number, number]
  readonly side: 'left' | 'right'
}[] = [
  { code: 'chest', label: 'Pecho', at: [0.42, 0.27], side: 'left' },
  { code: 'arm', label: 'Brazo', at: [0.25, 0.36], side: 'left' },
  { code: 'waist', label: 'Cintura', at: [0.36, 0.4], side: 'left' },
  { code: 'hip', label: 'Cadera', at: [0.64, 0.5], side: 'right' },
  { code: 'thigh', label: 'Muslo', at: [0.6, 0.6], side: 'right' },
]

function localToday(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
}

export default function BodyScreen() {
  const router = useRouter()
  const theme = useTheme()
  const today = localToday(deviceTimezone())
  const features = usePlan()
  const upgrade = useUpgradeSheet(features)
  const { handled } = upgrade
  const measuresOpen = opens(features, 'body_measurements')
  const photosOpen = opens(features, 'body_photos')

  const [records, setRecords] = useState<BodyRecord[] | undefined>(undefined)
  const [photos, setPhotos] = useState<BodyPhoto[]>([])
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [choosing, setChoosing] = useState(false)

  // Read again whenever it is looked at: coming back from recording shows the new one.
  useFocusEffect(
    useCallback(() => {
      let active = true
      setFailure(undefined)
      readBodyRecords()
        .then((read) => active && setRecords(read))
        .catch((cause: unknown) => {
          if (active && !handled(cause)) setFailure(READ_FAILED)
        })
      readBodyPhotos()
        .then((read) => active && setPhotos(read))
        .catch(() => undefined)
      return () => {
        active = false
      }
    }, [handled]),
  )

  const record = (path: '/body/weight' | '/body/measures' | '/body/photo', feature?: string) => {
    const go = () => {
      if (feature && !opens(features, feature)) upgrade.offer(feature)
      else router.push(path)
    }
    if (!choosing) {
      go()
      return
    }
    // iOS cannot present a screen or a sheet while the «Registrar» modal is still
    // leaving: it stays mounted, invisible, over everything and swallows every touch.
    setChoosing(false)
    setTimeout(go, semanticMotion.exit.duration + SHEET_SETTLE_MS)
  }

  return (
    <Screen edges={['top', 'bottom']} padded={false}>
      <View style={styles.header}>
        <IconButton
          icon="back"
          accessibilityLabel="Volver"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/profile'))}
        />
        <Text role="control" size="xl" accessibilityRole="header" style={styles.title}>
          Cuerpo
        </Text>
        <IconButton
          icon="add"
          variant="solid"
          accessibilityLabel="Registrar"
          onPress={() => setChoosing(true)}
        />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {failure ? <InlineAlert message={failure} /> : null}
        {records ? (
          <>
            <WeightCard records={records} today={today} onRecord={() => record('/body/weight')} />
            <SectionTitle
              title="Medidas"
              extra={measuresOpen ? measuredLine(records) : 'Peso y estatura gratis'}
            />
            {measuresOpen ? (
              <MeasuresCard records={records} onRecord={() => record('/body/measures')} />
            ) : (
              <Locked
                icon="target"
                title="Todas tus medidas"
                body="Con Gratis registras tu peso y tu estatura. Con Pro, también pecho, cintura, brazo, cadera y más."
                onUpgrade={() => router.push('/pro/plans')}
                preview={<MeasuresCard records={SAMPLE_MEASURES} onRecord={() => undefined} />}
              />
            )}
            {photosOpen ? null : <SectionTitle title="Fotos" />}
            {photosOpen ? (
              <PhotosCard photos={photos} onNew={() => record('/body/photo', 'body_photos')} />
            ) : (
              <Locked
                icon="camera"
                title="Mírate cambiar"
                body="Guarda fotos de tu progreso y compáralas lado a lado. Solo para ti."
                onUpgrade={() => router.push('/pro/plans')}
                preview={<PhotoPreview />}
              />
            )}
          </>
        ) : null}
      </ScrollView>

      <Sheet visible={choosing} onDismiss={() => setChoosing(false)} title="Registrar">
        <View style={styles.choices}>
          <Choice
            icon="weight"
            title="Peso"
            caption={weightCaption(records)}
            tone={theme.color.discipline.strength}
            onPress={() => record('/body/weight')}
          />
          <Choice
            icon="target"
            title="Medidas"
            caption="Pecho, brazo, cintura, cadera, muslo y grasa"
            tone={theme.color.discipline.highIntensity}
            pro={!measuresOpen}
            onPress={() => record('/body/measures', 'body_measurements')}
          />
          <Choice
            icon="camera"
            title="Foto de progreso"
            caption={
              photos[0] ? `Última: ${shortDay(photos[0].taken_on)}` : 'Alinea tu cuerpo y compárate'
            }
            tone={theme.color.discipline.rhythm}
            pro={!photosOpen}
            onPress={() => record('/body/photo', 'body_photos')}
          />
        </View>
      </Sheet>
      {upgrade.sheet}
    </Screen>
  )
}

function weightCaption(records: readonly BodyRecord[] | undefined): string {
  const latest = records ? latestOf(records, 'body_weight') : undefined
  return latest
    ? `Último: ${tenths(latest.value)} kg · ${shortDay(latest.measured_on)}`
    : 'Tu primer registro'
}

function measuredLine(records: readonly BodyRecord[]): string | undefined {
  const dates = CALLOUTS.flatMap((callout) => latestOf(records, callout.code)?.measured_on ?? [])
  const newest = dates.sort().at(-1)
  return newest ? `Último: ${shortDay(newest)}` : undefined
}

function SectionTitle({
  title,
  extra,
  control,
}: {
  readonly title: string
  readonly extra?: string | undefined
  /** Drawn where `extra` would go, for a section whose title row carries its switch. */
  readonly control?: ReactNode
}) {
  return (
    <View style={styles.sectionTitle}>
      <Text role="control" size="md" accessibilityRole="header">
        {title}
      </Text>
      {control ??
        (extra ? (
          <Text role="control" size="xs" color="muted">
            {extra}
          </Text>
        ) : null)}
    </View>
  )
}

function Card({ children, style }: { readonly children: ReactNode; readonly style?: object }) {
  const theme = useTheme()
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.color.background.surface, borderColor: theme.color.border.subtle },
        style,
      ]}
    >
      {children}
    </View>
  )
}

function WeightCard({
  records,
  today,
  onRecord,
}: {
  readonly records: readonly BodyRecord[]
  readonly today: string
  readonly onRecord: () => void
}) {
  const theme = useTheme()
  const [range, setRange] = useState<Range>('3')
  const [width, setWidth] = useState(0)
  const months = Number(range)
  const latest = latestOf(records, 'body_weight')
  const series = seriesOf(records, 'body_weight', months, today)
  const first = series[0]
  const change =
    latest && first && series.length > 1 ? Math.round((latest.value - first.value) * 10) / 10 : null

  return (
    <Card style={styles.hero}>
      <CardGlow />
      <View style={styles.heroTop}>
        <Text role="control" size="2xs" color="muted" uppercase tracking={0.12}>
          Peso
        </Text>
        {latest ? (
          <SegmentedControl
            size="sm"
            items={RANGES}
            value={range}
            onChange={(next) => {
              selectionTick()
              setRange(next)
            }}
            accessibilityLabel="Periodo"
            style={styles.centered}
          />
        ) : null}
      </View>
      {latest ? (
        <>
          <View style={styles.figure}>
            <Text role="display" tracking={FIGURE_TRACKING} size="6xl">
              {tenths(latest.value)}
            </Text>
            <Text role="control" size="lg" color="secondary" style={styles.unit}>
              kg
            </Text>
          </View>
          {change !== null && first ? (
            <View style={styles.change}>
              <FoundationIcon
                name="progress"
                size="sm"
                color={theme.color.icon.accent}
                decorative
              />
              <Text role="control" size="xs" color="accent">
                {`${change > 0 ? '+' : change < 0 ? '−' : ''}${decimal(Math.abs(change))} kg desde el ${shortDay(first.measured_on)}`}
              </Text>
            </View>
          ) : (
            <Text role="body" size="xs" color="muted">
              {`Registrado el ${shortDay(latest.measured_on)}. Con el próximo verás cómo cambia.`}
            </Text>
          )}
          <View onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}>
            {width > 0 ? (
              <WeightChart
                width={width}
                points={timeline(series.length > 0 ? series : [latest], months, today)}
              />
            ) : null}
            <View style={styles.axis}>
              {monthTicks(months, today).map((month, index, all) => (
                <Text
                  key={`${month}-${String(index)}`}
                  role="control"
                  size="2xs"
                  color={index === all.length - 1 ? 'accent' : 'muted'}
                  tracking={0.08}
                >
                  {month}
                </Text>
              ))}
            </View>
          </View>
        </>
      ) : (
        <>
          <Text role="body" size="sm" color="secondary">
            Registra tu peso para ver cómo cambia con el tiempo.
          </Text>
          <Button label="Registrar peso" onPress={onRecord} />
        </>
      )}
    </Card>
  )
}

function WeightChart({
  width,
  points,
}: {
  readonly width: number
  readonly points: readonly { readonly at: number; readonly value: number }[]
}) {
  const theme = useTheme()
  const values = points.map((point) => point.value)
  const low = Math.min(...values) - 0.8
  const span = Math.max(...values) + 0.8 - low
  const placed = points.map(
    (point) =>
      [
        8 + point.at * (width - 16),
        10 + (1 - (point.value - low) / span) * (CHART_HEIGHT - 20),
      ] as const,
  )
  const line = placed
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ')
  const first = placed[0]
  const last = placed.at(-1)
  return (
    <Svg width={width} height={CHART_HEIGHT} accessibilityElementsHidden>
      <Defs>
        <LinearGradient id="weightArea" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={theme.color.icon.accent} stopOpacity={0.24} />
          <Stop offset="1" stopColor={theme.color.icon.accent} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      {[0.33, 0.66].map((guide) => (
        <Path
          key={guide}
          d={`M0 ${String(CHART_HEIGHT * guide)} H${String(width)}`}
          stroke={theme.color.border.subtle}
          strokeWidth={1}
        />
      ))}
      {first && last ? (
        <Path
          d={`${line} L${last[0].toFixed(1)} ${String(CHART_HEIGHT)} L${first[0].toFixed(1)} ${String(CHART_HEIGHT)} Z`}
          fill="url(#weightArea)"
        />
      ) : null}
      <Path
        d={line}
        stroke={theme.color.icon.accent}
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
      />
      {last ? (
        <>
          <Circle cx={last[0]} cy={last[1]} r={11} fill={theme.color.accent.tonal} />
          <Circle
            cx={last[0]}
            cy={last[1]}
            r={5}
            fill={theme.color.icon.accent}
            stroke={theme.color.background.surface}
            strokeWidth={2}
          />
        </>
      ) : null}
    </Svg>
  )
}

function MeasuresCard({
  records,
  onRecord,
}: {
  readonly records: readonly BodyRecord[]
  readonly onRecord: () => void
}) {
  const theme = useTheme()
  const [width, setWidth] = useState(0)
  const taken = CALLOUTS.filter((callout) => latestOf(records, callout.code))
  const extras = (
    [
      ['body_height', 'Estatura', 'cm'],
      ['body_fat', 'Grasa', '%'],
      ['muscle_mass', 'Masa muscular', 'kg'],
    ] as const
  ).flatMap(([code, label, unit]) => {
    const latest = latestOf(records, code)
    return latest ? [`${label} ${decimal(latest.value)} ${unit}`] : []
  })

  if (taken.length === 0) {
    return (
      <Card>
        <Text role="body" size="sm" color="secondary">
          Mide tu pecho, tu cintura o tu brazo y verás aquí cómo cambian.
        </Text>
        <Button label="Registrar medidas" variant="secondary" onPress={onRecord} />
      </Card>
    )
  }

  const left = (width - FIGURE_WIDTH) / 2
  return (
    <Card style={styles.measures}>
      <View
        style={styles.stage}
        onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      >
        {width > 0 ? (
          <CardGlow size={FIGURE_HEIGHT} right={(width - FIGURE_HEIGHT) / 2} top={0} />
        ) : null}
        <View style={[styles.figureBox, { left }]} accessible={false}>
          <BodyFigure
            side="front"
            gender="male"
            scale={FIGURE_SCALE}
            lit={[]}
            inert={INERT_SLUGS}
            onPressSlug={() => undefined}
          />
        </View>
        {width > 0 ? (
          <Svg
            width={width}
            height={FIGURE_HEIGHT}
            style={StyleSheet.absoluteFill}
            accessibilityElementsHidden
          >
            {taken.map((callout) => {
              const x = left + callout.at[0] * FIGURE_WIDTH
              const y = callout.at[1] * FIGURE_HEIGHT
              const labelY = labelTop(callout, taken) + 20
              const edge = callout.side === 'left' ? 78 : width - 78
              const bend = callout.side === 'left' ? edge + 12 : edge - 12
              return (
                <Path
                  key={callout.code}
                  d={`M${String(edge)} ${String(labelY)} L${String(bend)} ${String(labelY)} L${x.toFixed(1)} ${y.toFixed(1)}`}
                  stroke={theme.color.border.accent}
                  strokeWidth={1}
                  fill="none"
                />
              )
            })}
            {taken.map((callout) => (
              <Circle
                key={callout.code}
                cx={left + callout.at[0] * FIGURE_WIDTH}
                cy={callout.at[1] * FIGURE_HEIGHT}
                r={3}
                fill={theme.color.icon.accent}
              />
            ))}
          </Svg>
        ) : null}
        {taken.map((callout) => {
          const latest = latestOf(records, callout.code)
          const change = measureChange(records, callout.code)
          if (!latest) return null
          return (
            <View
              key={callout.code}
              accessible
              accessibilityLabel={`${callout.label}: ${decimal(latest.value)} centímetros`}
              style={[
                styles.callout,
                { top: labelTop(callout, taken) },
                callout.side === 'left' ? styles.calloutLeft : styles.calloutRight,
              ]}
            >
              <Text role="control" size="2xs" color="muted" uppercase tracking={0.08}>
                {callout.label}
              </Text>
              <View style={styles.calloutValue}>
                <Text role="poster" tracking={FIGURE_TRACKING} size="xl">
                  {decimal(latest.value)}
                </Text>
                <Text role="body" size="2xs" color="secondary">
                  cm
                </Text>
              </View>
              {change && change.change !== 0 ? (
                <Text role="control" size="2xs" color="accent">
                  {`${change.change > 0 ? '▲' : '▼'} ${decimal(Math.abs(change.change))} cm`}
                </Text>
              ) : null}
            </View>
          )
        })}
      </View>
      {extras.length > 0 ? (
        <Text role="body" size="xs" color="secondary" align="center">
          {extras.join(' · ')}
        </Text>
      ) : null}
    </Card>
  )
}

/** Labels on one side share its height evenly, whichever of them were measured. */
function labelTop(
  callout: (typeof CALLOUTS)[number],
  taken: readonly (typeof CALLOUTS)[number][],
): number {
  const side = taken.filter((one) => one.side === callout.side)
  const index = side.findIndex((one) => one.code === callout.code)
  const slot = (FIGURE_HEIGHT - 40) / Math.max(1, side.length)
  return 20 + index * slot + (slot - 60) / 2
}

function PhotosCard({
  photos,
  onNew,
}: {
  readonly photos: readonly BodyPhoto[]
  readonly onNew: () => void
}) {
  const theme = useTheme()
  const [chosen, setChosen] = useState<string[]>([])
  const [mode, setMode] = useState<'slide' | 'side'>('slide')
  const pair = comparedPhotos(photos, chosen)

  const choose = (id: string) =>
    setChosen((current) =>
      current.includes(id) ? current.filter((one) => one !== id) : [...current, id].slice(-2),
    )

  return (
    <View style={styles.photos}>
      {/* The switch sits on the title row, off the photo: over a picture it was easy to miss. */}
      <SectionTitle
        title="Fotos"
        control={
          pair.length === 2 ? (
            <SegmentedControl
              size="sm"
              items={[
                { value: 'slide', label: 'Deslizar' },
                { value: 'side', label: 'Lado a lado' },
              ]}
              value={mode}
              onChange={(next) => {
                selectionTick()
                setMode(next)
              }}
              accessibilityLabel="Cómo comparar"
              style={styles.centered}
            />
          ) : undefined
        }
      />
      {pair.length === 0 ? (
        <Card style={styles.emptyPhotos}>
          <FoundationIcon name="camera" size="lg" color={theme.color.icon.accent} decorative />
          <Text role="body" size="sm" color="secondary" align="center">
            Tu primera foto es el punto de partida. La próxima la comparas con ella.
          </Text>
          <Button label="Tomar foto" onPress={onNew} />
        </Card>
      ) : (
        <View style={[styles.compare, { borderColor: theme.color.border.subtle }]}>
          {pair[0] && pair[1] ? (
            <Badge
              label={daysApart(pair[0].taken_on, pair[1].taken_on)}
              variant="quiet"
              style={styles.days}
            />
          ) : null}
          {pair.length === 2 && mode === 'slide' ? (
            <SlideCompare older={pair[0]} newer={pair[1]} />
          ) : pair.length === 2 ? (
            <View style={styles.side}>
              {pair.map((one, index) => (
                <View key={one.id} style={styles.sideHalf}>
                  <Image
                    source={{ uri: one.photo.url }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                  />
                  <PhotoDate
                    photo={one}
                    accent={index === 1}
                    align={index === 0 ? 'left' : 'right'}
                  />
                </View>
              ))}
            </View>
          ) : pair[0] ? (
            <View style={styles.side}>
              <View style={styles.sideHalf}>
                <Image
                  source={{ uri: pair[0].photo.url }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                />
                <PhotoDate photo={pair[0]} accent align="left" />
              </View>
            </View>
          ) : null}
        </View>
      )}
      {photos.length > 0 ? (
        // «Nueva» stays put while the photos scroll past it: taking one is always a tap away.
        <View style={styles.stripRow}>
          <CoverTile
            size="md"
            onPress={onNew}
            accessibilityLabel="Nueva foto"
            hint={
              <FoundationIcon name="camera" size="md" color={theme.color.icon.accent} decorative />
            }
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}
            style={styles.grow}
          >
            {photos.map((one) => (
              <SelectableTile
                key={one.id}
                name={shortDay(one.taken_on)}
                selected={pair.some((shown) => shown.id === one.id)}
                onPress={() => choose(one.id)}
                accessibilityLabel={`Foto del ${shortDay(one.taken_on)}`}
                style={styles.thumb}
              >
                <Image
                  source={{ uri: one.photo.url }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                />
              </SelectableTile>
            ))}
          </ScrollView>
        </View>
      ) : null}
      {photos.length > 2 ? (
        <Text role="body" size="xs" color="muted">
          Toca dos fotos para compararlas.
        </Text>
      ) : null}
      <View style={[styles.privacy, { borderColor: theme.color.border.subtle }]}>
        <FoundationIcon name="locked" size="sm" color={theme.color.icon.accent} decorative />
        <Text role="body" size="xs" color="secondary" style={styles.grow}>
          Tus fotos son solo tuyas: ni tu gimnasio ni tu entrenador pueden verlas.
        </Text>
      </View>
    </View>
  )
}

function PhotoDate({
  photo,
  accent,
  align,
}: {
  readonly photo: BodyPhoto
  readonly accent: boolean
  readonly align: 'left' | 'right'
}) {
  return (
    <View style={[styles.photoDate, align === 'left' ? styles.dateLeft : styles.dateRight]}>
      <Text
        role="poster"
        tracking={FIGURE_TRACKING}
        size="xl"
        uppercase
        color={accent ? 'accent' : 'primary'}
      >
        {shortDay(photo.taken_on)}
      </Text>
    </View>
  )
}

/** One photo over the other; the handle says how much of the newer one shows. */
function SlideCompare({
  older,
  newer,
}: {
  readonly older: BodyPhoto | undefined
  readonly newer: BodyPhoto | undefined
}) {
  const theme = useTheme()
  const [width, setWidth] = useState(0)
  const split = useSharedValue(0.5)
  const from = useSharedValue(0.5)
  // Sideways only: a vertical drag is the page scrolling, and the page keeps it.
  const pan = Gesture.Pan()
    .activeOffsetX([-6, 6])
    .failOffsetY([-12, 12])
    .onStart(() => {
      from.set(split.get())
    })
    .onUpdate((event) => {
      if (width <= 0) return
      split.set(Math.min(0.95, Math.max(0.05, from.get() + event.translationX / width)))
    })
  const reveal = useAnimatedStyle(() => ({
    left: split.get() * width,
    width: width - split.get() * width,
  }))
  const inner = useAnimatedStyle(() => ({ left: -split.get() * width }))
  const handle = useAnimatedStyle(() => ({ left: split.get() * width - 22 }))
  const rule = useAnimatedStyle(() => ({ left: split.get() * width - 1 }))
  if (!older || !newer) return null
  return (
    <GestureDetector gesture={pan}>
      <View
        style={styles.slide}
        onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
        accessible
        accessibilityLabel={`Comparación del ${shortDay(older.taken_on)} y el ${shortDay(newer.taken_on)}`}
      >
        <Image
          source={{ uri: older.photo.url }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
        <Animated.View style={[styles.revealed, reveal]}>
          <Animated.View style={[styles.revealedInner, { width }, inner]}>
            <Image
              source={{ uri: newer.photo.url }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
            />
          </Animated.View>
        </Animated.View>
        <Animated.View style={[styles.rule, { backgroundColor: theme.color.icon.accent }, rule]} />
        <Animated.View
          style={[styles.handle, { backgroundColor: theme.color.icon.accent }, handle]}
        >
          <FoundationIcon
            name="frequency"
            size="md"
            color={theme.color.accent.onAccent}
            decorative
          />
        </Animated.View>
        <PhotoDate photo={older} accent={false} align="left" />
        <PhotoDate photo={newer} accent align="right" />
      </View>
    </GestureDetector>
  )
}

/**
 * A Pro section on Gratis: the section itself, drawn from a sample and blurred so no
 * figure reads, with the offer over it. The shape is the promise; the numbers are not.
 */
function Locked({
  icon,
  title,
  body,
  onUpgrade,
  preview,
}: {
  readonly icon: IconName
  readonly title: string
  readonly body: string
  readonly onUpgrade: () => void
  readonly preview: ReactNode
}) {
  const theme = useTheme()
  return (
    <View style={[styles.locked, { borderColor: theme.color.border.accent }]}>
      <View
        style={styles.lockedPreview}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {preview}
      </View>
      <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFill} />
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: `${theme.color.background.canvas}59` }]}
      />
      <View style={styles.lockedOffer}>
        <View
          style={[
            styles.lockedIcon,
            {
              backgroundColor: theme.color.accent.tonal,
              borderColor: theme.color.accent.tonalBorder,
            },
          ]}
        >
          <FoundationIcon name={icon} size="lg" color={theme.color.icon.accent} decorative />
        </View>
        <Badge label="Pro" tone="accent" style={styles.centered} />
        <Text role="display" size="3xl" uppercase align="center">
          {title}
        </Text>
        <Text role="body" size="sm" color="secondary" align="center">
          {body}
        </Text>
        <Button label="Hazte Pro" size="sm" onPress={onUpgrade} style={styles.centered} />
      </View>
    </View>
  )
}

/** What the photos section looks like with two photos in it, without any photo. */
function PhotoPreview() {
  const theme = useTheme()
  return (
    <View style={styles.previewPhotos}>
      {[0, 1].map((side) => (
        <View
          key={side}
          style={[styles.previewPhoto, { backgroundColor: theme.color.background.surfaceMuted }]}
        >
          <BodyFigure
            side="front"
            gender="male"
            scale={0.62}
            lit={[]}
            inert={INERT_SLUGS}
            onPressSlug={() => undefined}
          />
        </View>
      ))}
    </View>
  )
}

/**
 * One thing to record, as `REG-1` draws it: a card on the sheet, its glyph in its own
 * colour. `ContentRow` was tried here and lost the card against the sheet's surface.
 */
function Choice({
  icon,
  title,
  caption,
  tone,
  pro = false,
  onPress,
}: {
  readonly icon: IconName
  readonly title: string
  readonly caption: string
  readonly tone: string
  readonly pro?: boolean
  readonly onPress: () => void
}) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={pro ? `${title}. ${caption}. Con Pro` : `${title}. ${caption}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        {
          backgroundColor: theme.color.background.surfaceMuted,
          borderColor: theme.color.border.subtle,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={[styles.choiceIcon, { backgroundColor: `${tone}1F`, borderColor: `${tone}59` }]}>
        <FoundationIcon name={icon} size="md" color={tone} decorative />
      </View>
      <View style={styles.grow}>
        <Text role="control" size="md">
          {title}
        </Text>
        <Text role="body" size="xs" color="secondary" numberOfLines={1}>
          {caption}
        </Text>
      </View>
      {pro ? (
        <Badge label="Pro" tone="accent" />
      ) : (
        <FoundationIcon name="next" size="sm" color={theme.color.icon.secondary} decorative />
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  title: { flex: 1, textAlign: 'center' },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 48, gap: 16 },
  card: { borderRadius: 24, borderWidth: 1, padding: 16, gap: 12, overflow: 'hidden' },
  hero: { borderRadius: 28, padding: 20, gap: 10 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  change: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingHorizontal: 4,
  },
  figure: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  unit: { paddingBottom: 10 },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  measures: { paddingHorizontal: 12 },
  stage: { height: FIGURE_HEIGHT },
  figureBox: { position: 'absolute', top: 0 },
  callout: { position: 'absolute', width: 76, gap: 1 },
  calloutLeft: { left: 0, alignItems: 'flex-start' },
  calloutRight: { right: 0, alignItems: 'flex-end' },
  calloutValue: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  photos: { gap: 12 },
  emptyPhotos: { alignItems: 'center', paddingVertical: 28 },
  compare: { height: PHOTO_HEIGHT, borderRadius: 28, borderWidth: 1, overflow: 'hidden' },
  side: { flex: 1, flexDirection: 'row', gap: 2 },
  sideHalf: { flex: 1, overflow: 'hidden' },
  slide: { flex: 1 },
  revealed: { position: 'absolute', top: 0, bottom: 0, overflow: 'hidden' },
  revealedInner: { position: 'absolute', top: 0, bottom: 0 },
  rule: { position: 'absolute', top: 0, bottom: 0, width: 2 },
  handle: {
    position: 'absolute',
    top: PHOTO_HEIGHT / 2 - 22,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  days: { position: 'absolute', zIndex: 1, top: 14, right: 14 },
  photoDate: { position: 'absolute', bottom: 14 },
  dateLeft: { left: 14 },
  dateRight: { right: 14 },
  // The small control fits its labels and sits at its parent's start; this centres it.
  centered: { alignSelf: 'center' },
  stripRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  strip: { gap: 10 },
  thumb: { width: 92 },
  privacy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
  },
  locked: { borderRadius: 28, borderWidth: 1, overflow: 'hidden' },
  lockedPreview: { position: 'absolute', top: 0, right: 0, left: 0 },
  lockedOffer: { paddingHorizontal: 24, paddingVertical: 32, gap: 12, alignItems: 'center' },
  previewPhotos: { flexDirection: 'row', gap: 2, height: 360 },
  previewPhoto: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  lockedIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choices: { gap: 10 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 22,
    borderWidth: 1,
    padding: 14,
  },
  choiceIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: { flex: 1 },
})
