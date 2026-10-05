/**
 * Mi meta de nutrición (N-6, HU-SP-073, ADR-040).
 *
 * Energy leads, exact or as a range; each macro, fibre and water then takes a minimum,
 * a range, a maximum or no goal at all — «sin meta» is a choice, and it leaves the
 * nutrient out of the goal rather than setting it to zero. Publishing makes a new
 * version: the current one is superseded and stays in the history, as the foot says.
 */

import { Button } from '@allfitone/react-native/button'
import { IconButton } from '@allfitone/react-native/icon-button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { SegmentedControl } from '@allfitone/react-native/segmented-control'
import { Sheet } from '@allfitone/react-native/sheet'
import { Stepper } from '@allfitone/react-native/stepper'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import * as Haptics from 'expo-haptics'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import {
  formFromGoal,
  NUTRIENT_NAMES,
  targetsFromForm,
  type FormMode,
  type FormTarget,
  type GoalForm,
  type GoalNutrient,
} from '../../src/client/nutrition'
import { createSpaceNutritionFlow } from '../../src/client/nutrition-transport'
import { FIGURE_TRACKING, macroColor } from '../../src/components/nutrition-ui'
import { SheetChoice } from '../../src/components/sheet-choice'

const PUBLISH_FAILED = 'No pudimos publicar tu meta. Inténtalo otra vez.'
const OTHERS: readonly GoalNutrient[] = ['protein', 'carbohydrates', 'fat', 'fiber', 'water']
const MODE_NAMES: Readonly<Record<FormMode, string>> = {
  exact: 'Exacta',
  minimum: 'Mínimo',
  maximum: 'Máximo',
  range: 'Rango',
  none: 'Sin meta',
}
/** Where a nutrient starts when it first gets a goal, and how far one press moves it. */
const START: Readonly<
  Record<GoalNutrient, { readonly value: number; readonly step: number; readonly max: number }>
> = {
  energy: { value: 2000, step: 50, max: 8000 },
  protein: { value: 120, step: 5, max: 500 },
  carbohydrates: { value: 220, step: 5, max: 900 },
  fat: { value: 70, step: 5, max: 400 },
  fiber: { value: 30, step: 1, max: 100 },
  water: { value: 2500, step: 100, max: 8000 },
}
const DEFAULT_FORM: GoalForm = {
  energy: { mode: 'exact', low: START.energy.value, high: null },
  protein: { mode: 'none', low: null, high: null },
  carbohydrates: { mode: 'none', low: null, high: null },
  fat: { mode: 'none', low: null, high: null },
  fiber: { mode: 'none', low: null, high: null },
  water: { mode: 'none', low: null, high: null },
}

const percent = (share: number): `${number}%` => `${share * 100}%`
const unitOf = (code: GoalNutrient) => (code === 'energy' ? 'kcal' : code === 'water' ? 'ml' : 'g')
const number = (value: number | null) => (value ?? 0).toLocaleString('es-CO')

function valueText(code: GoalNutrient, target: FormTarget): string {
  if (target.mode === 'none') return ''
  if (target.mode === 'range') return `${number(target.low)}–${number(target.high)}`
  return number(target.mode === 'maximum' ? target.high : target.low)
}

/** Where a target sits on its bar, scaled to itself so a range reads as a band, not a dot. */
function trackOf(target: FormTarget): { readonly left: number; readonly right: number } | null {
  if (target.mode === 'none') return null
  const top = Math.max(1, target.low ?? 0, target.high ?? 0) * (5 / 3)
  if (target.mode === 'minimum') return { left: (target.low ?? 0) / top, right: 1 }
  if (target.mode === 'maximum') return { left: 0, right: (target.high ?? 0) / top }
  if (target.mode === 'exact')
    return { left: (target.low ?? 0) / top - 0.02, right: (target.low ?? 0) / top + 0.02 }
  return { left: (target.low ?? 0) / top, right: (target.high ?? 0) / top }
}

/** A target moved to another mode keeps what it can of its values. */
function withMode(code: GoalNutrient, target: FormTarget, mode: FormMode): FormTarget {
  const start = START[code].value
  const value = target.low ?? target.high ?? start
  if (mode === 'none') return { mode, low: null, high: null }
  if (mode === 'exact' || mode === 'minimum') return { mode, low: value, high: null }
  if (mode === 'maximum') return { mode, low: null, high: value }
  return {
    mode,
    low: target.low ?? Math.round(value * 0.9),
    high: target.high ?? Math.round(value * 1.1),
  }
}

export default function GoalScreen() {
  const router = useRouter()
  const theme = useTheme()
  const flow = useMemo(() => createSpaceNutritionFlow(), [])
  const [form, setForm] = useState<GoalForm>(DEFAULT_FORM)
  const [hasGoal, setHasGoal] = useState(false)
  const [editing, setEditing] = useState<
    { readonly code: GoalNutrient; readonly about: 'mode' | 'value' } | undefined
  >(undefined)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useEffect(() => {
    let active = true
    flow
      .readGoals()
      .then((goals) => {
        if (!active || !goals.active) return
        const read = formFromGoal(goals.active.targets)
        setForm(read.energy.mode === 'none' ? { ...read, energy: DEFAULT_FORM.energy } : read)
        setHasGoal(true)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [flow])

  const set = (code: GoalNutrient, target: FormTarget) =>
    setForm((current) => ({ ...current, [code]: target }))
  const energy = form.energy
  const step = START.energy.step

  const publish = () => {
    setBusy(true)
    setFailure(undefined)
    flow
      .publishGoal(targetsFromForm(form))
      .then(() => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        router.back()
      })
      .catch(() => setFailure(PUBLISH_FAILED))
      .finally(() => setBusy(false))
  }

  const editingTarget = editing ? form[editing.code] : undefined

  return (
    <Screen edges={['top', 'bottom']} padded={false}>
      <View style={styles.header}>
        <IconButton
          icon="close"
          accessibilityLabel="Cerrar sin publicar"
          onPress={() => router.back()}
        />
        <Text role="control" size="xl" accessibilityRole="header" style={styles.grow}>
          Mi meta
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.energy}>
          <Text role="eyebrow" size="xs" color="muted" uppercase>
            Energía diaria
          </Text>
          {energy.mode === 'range' ? (
            <View style={styles.range}>
              {(['low', 'high'] as const).map((end) => (
                <Stepper
                  key={end}
                  accessibilityLabel={end === 'low' ? 'Energía mínima' : 'Energía máxima'}
                  value={energy[end] ?? START.energy.value}
                  onChange={(value) => set('energy', { ...energy, [end]: value })}
                  min={0}
                  max={START.energy.max}
                  step={step}
                  unit="kcal"
                  caption={end === 'low' ? 'desde' : 'hasta'}
                />
              ))}
            </View>
          ) : (
            <View style={styles.energyRow}>
              <IconButton
                icon="subtract"
                accessibilityLabel="Menos energía"
                onPress={() =>
                  set('energy', { ...energy, low: Math.max(0, (energy.low ?? 0) - step) })
                }
              />
              <Text
                role="display"
                tracking={FIGURE_TRACKING}
                size="6xl"
                style={styles.energyNumber}
                accessibilityLabel={`${number(energy.low)} kcal al día`}
              >
                {number(energy.low)}
              </Text>
              <IconButton
                icon="add"
                accessibilityLabel="Más energía"
                onPress={() =>
                  set('energy', {
                    ...energy,
                    low: Math.min(START.energy.max, (energy.low ?? 0) + step),
                  })
                }
              />
            </View>
          )}
          <Text role="body" size="md" color="secondary">
            kcal al día
          </Text>
          <View style={styles.energyMode}>
            <SegmentedControl
              accessibilityLabel="Energía exacta o en rango"
              items={[
                { value: 'exact', label: 'Exacta' },
                { value: 'range', label: 'Rango' },
              ]}
              value={energy.mode === 'range' ? 'range' : 'exact'}
              onChange={(mode) => set('energy', withMode('energy', energy, mode))}
            />
          </View>
        </View>

        <Text role="control" size="lg">
          Macros
        </Text>
        {OTHERS.map((code) => {
          const target = form[code]
          const on = target.mode !== 'none'
          const fill = trackOf(target)
          return (
            <View
              key={code}
              style={[
                styles.row,
                {
                  backgroundColor: theme.color.background.surface,
                  borderColor: theme.color.border.subtle,
                },
              ]}
            >
              <View style={styles.rowHead}>
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: on ? macroColor(theme, code) : theme.color.border.default },
                  ]}
                />
                <Text role="control" size="md" style={styles.grow}>
                  {NUTRIENT_NAMES[code]}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${NUTRIENT_NAMES[code]}: ${MODE_NAMES[target.mode]}. Cambiar`}
                  onPress={() => setEditing({ code, about: 'mode' })}
                  style={[styles.mode, { backgroundColor: theme.color.background.surfaceMuted }]}
                >
                  <Text role="control" size="sm" color="secondary">
                    {MODE_NAMES[target.mode]}
                  </Text>
                  <FoundationIcon
                    name="expand"
                    size="xs"
                    color={theme.color.icon.secondary}
                    decorative
                  />
                </Pressable>
                {on ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${valueText(code, target)} ${unitOf(code)}. Cambiar`}
                    onPress={() => setEditing({ code, about: 'value' })}
                    hitSlop={8}
                  >
                    <Text role="poster" tracking={FIGURE_TRACKING} size="xl">
                      {valueText(code, target)}
                      <Text role="body" size="xs" color="muted">{` ${unitOf(code)}`}</Text>
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              {fill ? (
                <View
                  style={[styles.track, { backgroundColor: theme.color.background.surfaceMuted }]}
                >
                  <View
                    style={[
                      styles.fill,
                      {
                        left: percent(Math.min(0.98, fill.left)),
                        width: percent(Math.max(0.02, Math.min(1, fill.right - fill.left))),
                        backgroundColor: macroColor(theme, code),
                      },
                    ]}
                  />
                </View>
              ) : null}
            </View>
          )
        })}

        {failure ? <InlineAlert message={failure} /> : null}
      </ScrollView>

      <View style={styles.foot}>
        {hasGoal ? (
          <Text role="body" size="xs" color="muted" align="center">
            Reemplaza tu meta actual, que queda en el historial.
          </Text>
        ) : null}
        <Button
          label="Publicar mi meta"
          loading={busy}
          disabled={targetsFromForm(form).length === 0}
          onPress={publish}
        />
      </View>

      <Sheet
        visible={editing !== undefined}
        onDismiss={() => setEditing(undefined)}
        title={editing ? NUTRIENT_NAMES[editing.code] : ''}
      >
        {editing && editingTarget ? (
          editing.about === 'mode' ? (
            <View style={styles.sheet}>
              {(['minimum', 'range', 'maximum', 'none'] as const).map((mode) => (
                <SheetChoice
                  key={mode}
                  name={MODE_NAMES[mode]}
                  selected={editingTarget.mode === mode}
                  onPress={() => {
                    set(editing.code, withMode(editing.code, editingTarget, mode))
                    setEditing(mode === 'none' ? undefined : { code: editing.code, about: 'value' })
                  }}
                />
              ))}
            </View>
          ) : (
            <View style={styles.sheet}>
              {editingTarget.mode !== 'maximum' ? (
                <Stepper
                  accessibilityLabel={editingTarget.mode === 'range' ? 'Desde' : 'Valor'}
                  value={editingTarget.low ?? START[editing.code].value}
                  onChange={(low) => set(editing.code, { ...editingTarget, low })}
                  min={0}
                  max={START[editing.code].max}
                  step={START[editing.code].step}
                  unit={unitOf(editing.code)}
                  grow
                  caption={
                    editingTarget.mode === 'range'
                      ? 'desde'
                      : MODE_NAMES[editingTarget.mode].toLowerCase()
                  }
                />
              ) : null}
              {editingTarget.mode === 'maximum' || editingTarget.mode === 'range' ? (
                <Stepper
                  accessibilityLabel={editingTarget.mode === 'range' ? 'Hasta' : 'Máximo'}
                  value={editingTarget.high ?? START[editing.code].value}
                  onChange={(high) => set(editing.code, { ...editingTarget, high })}
                  min={editingTarget.mode === 'range' ? (editingTarget.low ?? 0) : 0}
                  max={START[editing.code].max}
                  step={START[editing.code].step}
                  unit={unitOf(editing.code)}
                  grow
                  caption={editingTarget.mode === 'range' ? 'hasta' : 'máximo'}
                />
              ) : null}
              <Button label="Listo" onPress={() => setEditing(undefined)} />
            </View>
          )
        ) : null}
      </Sheet>
    </Screen>
  )
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 10,
  },
  content: { paddingHorizontal: 20, paddingBottom: 24, gap: 12 },
  energy: { alignItems: 'center', gap: 10, paddingVertical: 10 },
  energyRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  energyNumber: { paddingHorizontal: 4 },
  range: { flexDirection: 'row', gap: 12 },
  energyMode: { width: 260 },
  row: { borderRadius: 20, borderWidth: 1, padding: 14, gap: 12 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  mode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { position: 'absolute', top: 0, bottom: 0, borderRadius: 3 },
  foot: { paddingHorizontal: 20, paddingTop: 10, gap: 10 },
  sheet: { gap: 12, paddingBottom: 8 },
})
