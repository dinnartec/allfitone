/**
 * Recording the measures, one at a time (`REG-3`, OP-IDN-006). Pro (`body_measurements`).
 *
 * One measure fills the screen: where to put the tape, lit on the figure; the reading;
 * the last one beside it; and how to take it. A form with seven fields asks somebody
 * holding a tape in one hand to type with the other, and it says nothing about where.
 *
 * **Each measure is saved when the next one is asked for.** Leaving half way keeps
 * what was measured, and «Saltar» leaves a measure empty rather than at zero: an empty
 * waist is not a waist of zero centimetres.
 *
 * The wheel starts at the last reading of that measure, so a second session corrects a
 * known number instead of searching from nothing.
 */

import { Button } from '@allfitone/react-native/button'
import { Chip } from '@allfitone/react-native/chip'
import { IconButton } from '@allfitone/react-native/icon-button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { WheelPicker } from '@allfitone/react-native/wheel-picker'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import Svg, { Ellipse } from 'react-native-svg'

import {
  MEASURES,
  decimal,
  declarationOf,
  latestOf,
  runAround,
  shortDay,
  type BodyRecord,
  type Measure,
} from '../../src/client/body'
import { readBodyRecords, recordBodyMeasure } from '../../src/client/body-transport'
import { INERT_SLUGS } from '../../src/client/focus-form'
import { selectionTick } from '../../src/client/selection-tick'
import { deviceTimezone } from '../../src/client/timezone'
import { BodyFigure } from '../../src/components/body-figure'
import { FIGURE_TRACKING } from '../../src/components/nutrition-ui'
import { usePlan, useUpgradeSheet } from '../../src/components/upgrade-sheet'

const SAVE_FAILED = 'No pudimos guardar esta medida. Inténtalo otra vez.'
const FIGURE_SCALE = 0.8
const FIGURE_WIDTH = 200 * FIGURE_SCALE
const FIGURE_HEIGHT = 400 * FIGURE_SCALE
/** About one chip and its gap; the row scrolls by it, so precision is not needed. */
const CHIP_STRIDE = 96

/** Where the tape goes, as a share of the figure's box: centre and width. None for a scale reading. */
const TAPE: Partial<Record<Measure['code'], readonly [number, number, number]>> = {
  chest: [0.5, 0.27, 0.5],
  arm: [0.25, 0.35, 0.16],
  waist: [0.5, 0.4, 0.38],
  hip: [0.5, 0.47, 0.46],
  thigh: [0.4, 0.6, 0.2],
}

export default function MeasuresScreen() {
  const router = useRouter()
  const theme = useTheme()
  const today = useMemo(
    () => new Intl.DateTimeFormat('en-CA', { timeZone: deviceTimezone() }).format(new Date()),
    [],
  )
  const features = usePlan()
  const upgrade = useUpgradeSheet(features)

  const [records, setRecords] = useState<BodyRecord[]>([])
  const [step, setStep] = useState(0)
  const [values, setValues] = useState<Partial<Record<Measure['code'], number>>>({})
  const [saved, setSaved] = useState<Partial<Record<Measure['code'], number>>>({})
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const chips = useRef<ScrollView>(null)

  // The measure being taken stays in sight as the row moves on.
  useEffect(() => {
    chips.current?.scrollTo({ x: Math.max(0, step * CHIP_STRIDE - CHIP_STRIDE), animated: true })
  }, [step])

  useEffect(() => {
    let active = true
    readBodyRecords()
      .then((read) => active && setRecords(read))
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  const measure = MEASURES[step]
  if (!measure) return null
  const last = latestOf(records, measure.code)
  const value = values[measure.code] ?? last?.value ?? measure.resting
  const run = runAround(last?.value ?? measure.resting, measure.step, 25, measure.min, measure.max)
  const nextMeasure = MEASURES[step + 1]

  const advance = () => {
    if (nextMeasure) setStep(step + 1)
    else router.back()
  }

  const saveAndAdvance = async () => {
    setSaving(true)
    setFailure(undefined)
    try {
      await recordBodyMeasure(declarationOf(measure.code, value, today))
      setSaved({ ...saved, [measure.code]: value })
      advance()
    } catch (cause) {
      if (!upgrade.handled(cause)) setFailure(SAVE_FAILED)
    } finally {
      setSaving(false)
    }
  }

  const tape = TAPE[measure.code]

  return (
    <Screen edges={['top', 'bottom']} padded={false}>
      <View style={styles.header}>
        <IconButton icon="close" accessibilityLabel="Terminar" onPress={() => router.back()} />
        <Text role="control" size="xl" accessibilityRole="header" style={styles.title}>
          Medidas
        </Text>
        <Text role="control" size="xs" color="muted" style={styles.step}>
          {`${String(step + 1)} de ${String(MEASURES.length)}`}
        </Text>
      </View>
      <ScrollView
        ref={chips}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        style={styles.chipRow}
      >
        {/* A chip per measure: the one being taken is on, a saved one carries its tick, and
            any of them jumps straight to that measure. */}
        {MEASURES.map((one, index) => {
          const done = saved[one.code]
          return (
            <Chip
              key={one.code}
              label={
                done !== undefined && index !== step ? `${one.label} ${decimal(done)}` : one.label
              }
              selected={index === step}
              {...(done !== undefined ? { icon: 'check' as const } : {})}
              onPress={() => setStep(index)}
            />
          )
        })}
      </ScrollView>

      <View style={styles.stage} accessible={false}>
        <View style={styles.figure}>
          <BodyFigure
            side="front"
            gender="male"
            scale={FIGURE_SCALE}
            lit={[]}
            inert={INERT_SLUGS}
            onPressSlug={() => undefined}
          />
          {tape ? (
            <Svg width={FIGURE_WIDTH} height={FIGURE_HEIGHT} style={StyleSheet.absoluteFill}>
              <Ellipse
                cx={tape[0] * FIGURE_WIDTH}
                cy={tape[1] * FIGURE_HEIGHT}
                rx={(tape[2] * FIGURE_WIDTH) / 2 + 6}
                ry={9}
                stroke={theme.color.accent.tonal}
                strokeWidth={10}
                fill="none"
              />
              <Ellipse
                cx={tape[0] * FIGURE_WIDTH}
                cy={tape[1] * FIGURE_HEIGHT}
                rx={(tape[2] * FIGURE_WIDTH) / 2}
                ry={6}
                stroke={theme.color.icon.accent}
                strokeWidth={2.5}
                fill="none"
              />
            </Svg>
          ) : null}
        </View>
      </View>

      <View style={styles.reading}>
        <Text role="control" size="xs" color="accent" uppercase tracking={0.16}>
          {measure.label}
        </Text>
        <View style={styles.value}>
          <Text role="display" tracking={FIGURE_TRACKING} size="6xl">
            {decimal(value)}
          </Text>
          <Text role="control" size="lg" color="secondary" style={styles.unit}>
            {measure.suffix}
          </Text>
        </View>
        <Text role="body" size="xs" color="secondary">
          {last
            ? `La última vez: ${decimal(last.value)} ${measure.suffix}, el ${shortDay(last.measured_on)}`
            : 'Tu primera medida'}
        </Text>
      </View>

      <WheelPicker
        orientation="horizontal"
        values={run}
        value={value}
        onChange={(chosen) => {
          setValues({ ...values, [measure.code]: chosen })
          selectionTick()
        }}
        formatValue={(shown) => decimal(shown)}
        suffix={measure.suffix}
        accessibilityLabel={measure.label}
        accessibilityText={`${decimal(value)} ${measure.suffix}`}
      />

      <View style={styles.bottom}>
        <View style={[styles.how, { backgroundColor: theme.color.background.surface }]}>
          <FoundationIcon name="info" size="sm" color={theme.color.icon.accent} decorative />
          <Text role="body" size="xs" color="secondary" style={styles.grow}>
            {measure.how}
          </Text>
        </View>
        {failure ? <InlineAlert message={failure} /> : null}
        <View style={styles.actions}>
          <Button label="Saltar" variant="secondary" onPress={advance} style={styles.skip} />
          <Button
            label={nextMeasure ? `Siguiente: ${nextMeasure.short}` : 'Terminar'}
            icon={nextMeasure ? 'forward' : 'check'}
            loading={saving}
            onPress={() => void saveAndAdvance()}
            style={styles.grow}
          />
        </View>
      </View>
      {upgrade.sheet}
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  title: { flex: 1, textAlign: 'center' },
  step: { width: 44, textAlign: 'right' },
  chipRow: { flexGrow: 0, flexShrink: 0 },
  chips: { gap: 8, paddingHorizontal: 20, paddingVertical: 4 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: FIGURE_HEIGHT },
  figure: { width: FIGURE_WIDTH, height: FIGURE_HEIGHT },
  reading: { alignItems: 'center', gap: 4, paddingBottom: 8 },
  value: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  unit: { paddingBottom: 8 },
  bottom: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, gap: 12 },
  how: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, padding: 12 },
  actions: { flexDirection: 'row', gap: 10 },
  skip: { width: 110 },
  grow: { flex: 1 },
})
