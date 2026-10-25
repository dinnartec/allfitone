/**
 * Recording weight (`REG-2`, OP-IDN-006). Always free.
 *
 * The reading is the screen: a big figure, what changed since the last one, and the
 * same wheel the onboarding weighs with, now in tenths of a kilo — the onboarding's
 * whole kilos are a first estimate, and progress lives in the decimals.
 *
 * The wheel starts at the last weight, so moving it is a correction of a known number,
 * not a search from 70. The day defaults to today and can go back a week, for the
 * weigh-in somebody forgot to write down.
 *
 * What is sent is what was read, in the unit it was read in; the database converts.
 */

import { Button } from '@allfitone/react-native/button'
import { Chip } from '@allfitone/react-native/chip'
import { IconButton } from '@allfitone/react-native/icon-button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { SegmentedControl } from '@allfitone/react-native/segmented-control'
import { SelectableRow } from '@allfitone/react-native/selectable-row'
import { Sheet } from '@allfitone/react-native/sheet'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { WheelPicker } from '@allfitone/react-native/wheel-picker'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import {
  decimal,
  latestOf,
  massIn,
  runAround,
  shortDay,
  tenths,
  type BodyRecord,
} from '../../src/client/body'
import { readBodyRecords, recordBodyMeasure } from '../../src/client/body-transport'
import { toCanonical, type MassUnit } from '../../src/client/measures-form'
import { selectionTick } from '../../src/client/selection-tick'
import { deviceTimezone } from '../../src/client/timezone'
import { CardGlow, FIGURE_TRACKING } from '../../src/components/nutrition-ui'

const SAVE_FAILED = 'No pudimos guardar tu peso. Inténtalo otra vez.'
const RESTING_KG = 70
const DAY = 86_400_000

function localDay(timezone: string, daysBack: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(
    new Date(Date.now() - daysBack * DAY),
  )
}

export default function WeightScreen() {
  const router = useRouter()
  const theme = useTheme()
  const timezone = deviceTimezone()
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, back) => localDay(timezone, back)),
    [timezone],
  )

  const [records, setRecords] = useState<BodyRecord[]>([])
  const [kilos, setKilos] = useState(RESTING_KG)
  const [unit, setUnit] = useState<MassUnit>('kg')
  const [day, setDay] = useState(0)
  const [choosingDay, setChoosingDay] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useEffect(() => {
    let active = true
    readBodyRecords()
      .then((read) => {
        if (!active) return
        setRecords(read)
        const latest = latestOf(read, 'body_weight')
        if (latest) setKilos(latest.value)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  const latest = latestOf(records, 'body_weight')
  const shown = massIn(kilos, unit)
  const run = useMemo(
    () => runAround(massIn(latest?.value ?? RESTING_KG, unit), 0.1, 25, 25, 550),
    [latest, unit],
  )
  const change = latest ? Math.round((kilos - latest.value) * 10) / 10 : null
  const recent = records
    .filter((one) => one.metric_code === 'body_weight')
    .sort((a, b) => a.measured_on.localeCompare(b.measured_on))
    .slice(-8)

  const save = async () => {
    setSaving(true)
    setFailure(undefined)
    try {
      await recordBodyMeasure({
        metric_code: 'body_weight',
        value: shown,
        unit,
        measured_on: days[day] ?? days[0] ?? '',
      })
      router.back()
    } catch {
      setFailure(SAVE_FAILED)
      setSaving(false)
    }
  }

  return (
    <Screen edges={['top', 'bottom']} padded={false}>
      <View style={styles.header}>
        <IconButton
          icon="close"
          accessibilityLabel="Cerrar sin guardar"
          onPress={() => router.back()}
        />
        <Text role="control" size="xl" accessibilityRole="header" style={styles.title}>
          Peso
        </Text>
        <View style={styles.headerSpace} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.day}>
          <Chip
            label={dayLabel(days[day] ?? '', day)}
            icon="calendar"
            selected={false}
            onPress={() => setChoosingDay(true)}
            accessibilityLabel={`Día: ${dayLabel(days[day] ?? '', day)}. Cambiar`}
          />
        </View>

        <View style={styles.reading}>
          <CardGlow size={300} right={20} top={-40} />
          <View style={styles.figure}>
            <Text role="display" tracking={FIGURE_TRACKING} size="7xl">
              {tenths(shown)}
            </Text>
            <Text role="control" size="xl" color="secondary" style={styles.unit}>
              {unit}
            </Text>
          </View>
          {latest && change !== null && change !== 0 ? (
            <View style={styles.change}>
              <FoundationIcon
                name="progress"
                size="sm"
                color={theme.color.icon.accent}
                decorative
              />
              <Text role="control" size="xs" color="accent">
                {`${change > 0 ? '+' : '−'}${decimal(Math.abs(change))} kg desde el ${shortDay(latest.measured_on)}`}
              </Text>
            </View>
          ) : latest ? (
            <Text role="body" size="xs" color="muted">
              {`Igual que el ${shortDay(latest.measured_on)}`}
            </Text>
          ) : null}
        </View>

        <WheelPicker
          orientation="horizontal"
          values={run}
          value={shown}
          onChange={(value) => {
            setKilos(toCanonical(value, unit))
            selectionTick()
          }}
          formatValue={(value) => tenths(value)}
          suffix={unit}
          accessibilityLabel="Peso"
          accessibilityText={`${tenths(shown)} ${unit === 'kg' ? 'kilos' : 'libras'}`}
        />
        <SegmentedControl
          items={[
            { value: 'kg', label: 'KG', accessibilityLabel: 'Kilos' },
            { value: 'lb', label: 'LB', accessibilityLabel: 'Libras' },
          ]}
          value={unit}
          onChange={setUnit}
          accessibilityLabel="Unidad"
          size="sm"
          style={styles.units}
        />

        {recent.length > 1 ? (
          <View
            style={[
              styles.recent,
              {
                backgroundColor: theme.color.background.surface,
                borderColor: theme.color.border.subtle,
              },
            ]}
          >
            <Text role="control" size="2xs" color="muted" uppercase tracking={0.12}>
              Tus últimos registros
            </Text>
            <View
              style={styles.bars}
              accessible
              accessibilityLabel={`Últimos registros: ${recent.map((one) => decimal(one.value)).join(', ')} kilos`}
            >
              {recent.map((one, index) => {
                const values = recent.map((each) => each.value)
                const low = Math.min(...values)
                const span = Math.max(...values) - low || 1
                const last = index === recent.length - 1
                return (
                  <View key={one.id} style={styles.barColumn}>
                    {last ? (
                      <Text role="control" size="2xs" color="accent">
                        {decimal(one.value)}
                      </Text>
                    ) : null}
                    <View
                      style={[
                        styles.bar,
                        {
                          height: 14 + ((one.value - low) / span) * 34,
                          backgroundColor: last
                            ? theme.color.icon.accent
                            : theme.color.background.surfaceMuted,
                        },
                      ]}
                    />
                  </View>
                )
              })}
            </View>
          </View>
        ) : null}

        <Text role="body" size="xs" color="muted" align="center">
          Pésate a la misma hora y en ayunas para comparar mejor.
        </Text>
        {failure ? <InlineAlert message={failure} /> : null}
      </ScrollView>
      <View style={styles.footer}>
        <Button label="Guardar peso" loading={saving} onPress={() => void save()} />
      </View>

      <Sheet
        visible={choosingDay}
        onDismiss={() => setChoosingDay(false)}
        title="¿Qué día te pesaste?"
      >
        <View style={styles.days}>
          {days.map((iso, index) => (
            <SelectableRow
              key={iso}
              name={dayLabel(iso, index)}
              selected={index === day}
              onPress={() => {
                setDay(index)
                setChoosingDay(false)
              }}
            />
          ))}
        </View>
      </Sheet>
    </Screen>
  )
}

function dayLabel(iso: string, back: number): string {
  if (back === 0) return `Hoy, ${shortDay(iso)}`
  if (back === 1) return `Ayer, ${shortDay(iso)}`
  return shortDay(iso).replace(/^./, (first) => first.toUpperCase())
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  title: { flex: 1, textAlign: 'center' },
  headerSpace: { width: 44 },
  content: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 24, gap: 18 },
  day: { alignItems: 'center' },
  change: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  units: { alignSelf: 'center' },
  reading: { alignItems: 'center', gap: 10, paddingVertical: 12 },
  figure: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  unit: { paddingBottom: 14 },
  recent: { borderRadius: 22, borderWidth: 1, padding: 16, gap: 12 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, height: 68 },
  barColumn: { flex: 1, alignItems: 'center', gap: 4 },
  bar: { width: '100%', borderRadius: 6 },
  footer: { paddingHorizontal: 20, paddingBottom: 12 },
  days: { gap: 8 },
})
