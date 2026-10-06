/**
 * Mi meta de nutrición (N-6d, HU-SP-073, ADR-040).
 *
 * Energy leads, exact or as a range; each macro, fibre and water then takes a minimum,
 * an exact figure, a range, a maximum or no goal at all — «sin meta» is a choice, and it
 * leaves the nutrient out of the goal rather than setting it to zero. Publishing makes a
 * new version: the current one is superseded and stays in the history, as the foot says.
 *
 * **What a macro is worth is drawn, not left to arithmetic.** Each macro card rings its
 * share of the day's energy and the energy card splits its bar by the same shares, so
 * somebody setting 150 g of protein sees that it is a quarter of the day.
 *
 * **The value is typed.** The editor sits on the screen, under the macro it is editing,
 * instead of in a sheet with steppers: reaching 150 g in steps of five was six presses,
 * and a sheet lifted by the keyboard floated on device. − and + stay for small moves.
 */

import { Button } from '@allfitone/react-native/button'
import { IconButton } from '@allfitone/react-native/icon-button'
import { FoundationIcon, type IconName } from '@allfitone/react-native/icons'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Tabs } from '@allfitone/react-native/tabs'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import * as Haptics from 'expo-haptics'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import {
  energyOf,
  macroKcal,
  macroShares,
  MACROS,
  modeCaption,
  orderedRange,
  START,
  withMode,
} from '../../src/client/goal-energy'
import {
  formFromGoal,
  NUTRIENT_NAMES,
  NUTRIENT_SHORT_NAMES,
  targetsFromForm,
  type FormMode,
  type FormTarget,
  type GoalForm,
  type GoalNutrient,
} from '../../src/client/nutrition'
import { createSpaceNutritionFlow } from '../../src/client/nutrition-transport'
import { GoalValueField } from '../../src/components/goal-value-field'
import {
  CardGlow,
  FIGURE_TRACKING,
  foodIcon,
  macroColor,
  Ring,
} from '../../src/components/nutrition-ui'

const PUBLISH_FAILED = 'No pudimos publicar tu meta. Inténtalo otra vez.'
const MODE_NAMES: Readonly<Record<FormMode, string>> = {
  exact: 'Exacta',
  minimum: 'Mínimo',
  maximum: 'Máximo',
  range: 'Rango',
  none: 'Sin meta',
}
const MODES: readonly FormMode[] = ['minimum', 'exact', 'range', 'maximum', 'none']
const EXTRAS: readonly { readonly code: GoalNutrient; readonly icon: IconName }[] = [
  { code: 'fiber', icon: foodIcon('grain') },
  { code: 'water', icon: foodIcon('water') },
]
const DEFAULT_FORM: GoalForm = {
  energy: { mode: 'exact', low: START.energy.value, high: null },
  protein: { mode: 'none', low: null, high: null },
  carbohydrates: { mode: 'none', low: null, high: null },
  fat: { mode: 'none', low: null, high: null },
  fiber: { mode: 'none', low: null, high: null },
  water: { mode: 'none', low: null, high: null },
}

const unitOf = (code: GoalNutrient) => (code === 'energy' ? 'kcal' : code === 'water' ? 'ml' : 'g')
const number = (value: number | null) => Math.round(value ?? 0).toLocaleString('es-CO')

function valueText(target: FormTarget): string {
  if (target.mode === 'none') return '—'
  if (target.mode === 'range') return `${number(target.low)}–${number(target.high)}`
  return number(target.mode === 'maximum' ? target.high : target.low)
}

export default function GoalScreen() {
  const router = useRouter()
  const theme = useTheme()
  const flow = useMemo(() => createSpaceNutritionFlow(), [])
  const [form, setForm] = useState<GoalForm>(DEFAULT_FORM)
  const [hasGoal, setHasGoal] = useState(false)
  const [selected, setSelected] = useState<GoalNutrient>('protein')
  const [typingEnergy, setTypingEnergy] = useState(false)
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
        setSelected(MACROS.find((code) => read[code].mode !== 'none') ?? 'protein')
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
  const shares = macroShares(form)
  const assigned = MACROS.reduce((sum, code) => sum + (shares[code] ?? 0), 0)

  const nudgeEnergy = (by: number) => {
    const move = (value: number | null) =>
      Math.min(START.energy.max, Math.max(0, (value ?? START.energy.value) + by))
    set(
      'energy',
      energy.mode === 'range'
        ? { ...energy, low: move(energy.low), high: move(energy.high) }
        : { ...energy, low: move(energy.low) },
    )
  }

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

  const target = form[selected]
  const kcal = macroKcal(selected, target)
  const fieldFor = (end: 'low' | 'high', autoFocus = false) => {
    const caption = modeCaption(target.mode, end)
    return (
      <View style={styles.fieldBlock} key={end}>
        <Text role="control" size="sm" color="secondary">
          {caption}
        </Text>
        <GoalValueField
          value={target[end]}
          onChange={(value) => set(selected, { ...target, [end]: value })}
          unit={unitOf(selected)}
          step={START[selected].step}
          max={START[selected].max}
          accessibilityLabel={`${NUTRIENT_NAMES[selected]}, ${caption.toLowerCase()}`}
          keyboardTitle={`${NUTRIENT_SHORT_NAMES[selected]} · ${caption.toLowerCase()}`}
          autoFocus={autoFocus}
          onDone={() =>
            setForm((current) => ({ ...current, [selected]: orderedRange(current[selected]) }))
          }
        />
      </View>
    )
  }

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

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <View
          style={[
            styles.energy,
            {
              backgroundColor: theme.color.background.surface,
              borderColor: theme.color.border.subtle,
            },
          ]}
        >
          <CardGlow />
          <Text role="control" size="sm" color="secondary">
            Energía diaria
          </Text>
          <View style={styles.energyRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${valueText(energy)} kcal al día. Escribir`}
              onPress={() => energy.mode !== 'range' && setTypingEnergy(true)}
              style={[styles.energyFigure, styles.grow]}
            >
              <Text
                role="display"
                tracking={FIGURE_TRACKING}
                size={energy.mode === 'range' ? '4xl' : '5xl'}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {valueText(energy)}
              </Text>
              <Text role="control" size="md" color="secondary" style={styles.energyUnit}>
                kcal
              </Text>
            </Pressable>
            <IconButton
              icon="add"
              accessibilityLabel="Más energía"
              onPress={() => nudgeEnergy(START.energy.step)}
            />
            <IconButton
              icon="subtract"
              accessibilityLabel="Menos energía"
              onPress={() => nudgeEnergy(-START.energy.step)}
            />
          </View>
          {energy.mode !== 'range' && typingEnergy ? (
            <GoalValueField
              value={energy.low}
              onChange={(low) => set('energy', { ...energy, low })}
              unit="kcal"
              step={START.energy.step}
              max={START.energy.max}
              accessibilityLabel="Energía diaria"
              keyboardTitle="Energía · exacta"
              autoFocus
              onDone={() => setTypingEnergy(false)}
            />
          ) : null}
          {energy.mode === 'range' ? (
            <View style={styles.rangeFields}>
              {(['low', 'high'] as const).map((end) => (
                <View key={end} style={styles.fieldBlock}>
                  <Text role="control" size="sm" color="secondary">
                    {modeCaption('range', end)}
                  </Text>
                  <GoalValueField
                    value={energy[end]}
                    onChange={(value) => set('energy', { ...energy, [end]: value })}
                    unit="kcal"
                    step={START.energy.step}
                    max={START.energy.max}
                    accessibilityLabel={`Energía, ${modeCaption('range', end).toLowerCase()}`}
                    keyboardTitle={`Energía · ${modeCaption('range', end).toLowerCase()}`}
                    onDone={() =>
                      setForm((current) => ({ ...current, energy: orderedRange(current.energy) }))
                    }
                  />
                </View>
              ))}
            </View>
          ) : null}
          <Tabs
            accessibilityLabel="Energía exacta o en rango"
            items={[
              { value: 'exact', label: 'Exacta' },
              { value: 'range', label: 'Rango' },
            ]}
            value={energy.mode === 'range' ? 'range' : 'exact'}
            onChange={(mode) => {
              setTypingEnergy(false)
              set('energy', withMode('energy', energy, mode))
            }}
            style={styles.energyTabs}
          />
          {/* Each macro's share of the day, in its colour; what is left unassigned stays grey. */}
          <View
            style={styles.split}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {MACROS.map((code) =>
              shares[code] ? (
                <View
                  key={code}
                  style={[
                    styles.piece,
                    { flex: shares[code], backgroundColor: macroColor(theme, code) },
                  ]}
                />
              ) : null,
            )}
            {assigned < 1 ? (
              <View
                style={[
                  styles.piece,
                  { flex: 1 - assigned, backgroundColor: theme.color.background.surfaceMuted },
                ]}
              />
            ) : null}
          </View>
        </View>

        <Text role="control" size="lg">
          Macronutrientes
        </Text>
        <View style={styles.macros}>
          {MACROS.map((code) => {
            const share = shares[code]
            const on = form[code].mode !== 'none'
            const picked = selected === code
            return (
              <Pressable
                key={code}
                accessibilityRole="button"
                accessibilityState={{ selected: picked }}
                accessibilityLabel={`${NUTRIENT_NAMES[code]}: ${
                  on ? `${MODE_NAMES[form[code].mode]}, ${valueText(form[code])} g` : 'sin meta'
                }. Editar`}
                onPress={() => setSelected(code)}
                style={[
                  styles.macro,
                  {
                    backgroundColor: theme.color.background.surface,
                    borderColor: picked ? theme.color.border.accent : theme.color.border.subtle,
                    borderWidth: picked ? 1.5 : 1,
                  },
                ]}
              >
                <Ring size={76} stroke={7} share={share ?? 0} color={macroColor(theme, code)}>
                  <Text role="poster" tracking={FIGURE_TRACKING} size="lg">
                    {share === null ? '—' : `${String(Math.round(share * 100))}%`}
                  </Text>
                  <Text role="body" size="2xs" color="muted">
                    de kcal
                  </Text>
                </Ring>
                <Text
                  role="poster"
                  tracking={FIGURE_TRACKING}
                  size="xl"
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {valueText(form[code])}
                  {on ? (
                    <Text role="body" size="xs" color="muted">
                      {' g'}
                    </Text>
                  ) : null}
                </Text>
                <Text role="control" size="sm" style={{ color: macroColor(theme, code) }}>
                  {NUTRIENT_SHORT_NAMES[code]}
                </Text>
                <View
                  style={[styles.chip, { backgroundColor: theme.color.background.surfaceMuted }]}
                >
                  <Text role="body" size="2xs" color="secondary">
                    {MODE_NAMES[form[code].mode]}
                  </Text>
                </View>
              </Pressable>
            )
          })}
        </View>

        <View
          style={[
            styles.editor,
            {
              backgroundColor: theme.color.background.surface,
              borderColor: theme.color.border.subtle,
            },
          ]}
        >
          <View style={styles.editorHead}>
            <Text role="control" size="lg" style={styles.grow}>
              {NUTRIENT_NAMES[selected]}
            </Text>
            {kcal !== null ? (
              <Text role="control" size="sm" color="muted">
                {`${number(kcal)} kcal`}
              </Text>
            ) : null}
          </View>
          <Tabs
            accessibilityLabel={`Tipo de meta para ${NUTRIENT_NAMES[selected]}`}
            items={MODES.map((mode) => ({ value: mode, label: MODE_NAMES[mode] }))}
            value={target.mode}
            onChange={(mode) => set(selected, withMode(selected, target, mode))}
          />
          {target.mode === 'none' ? (
            <Text role="body" size="sm" color="muted">
              {`${NUTRIENT_NAMES[selected]} queda fuera de tu meta.`}
            </Text>
          ) : target.mode === 'range' ? (
            [fieldFor('low'), fieldFor('high')]
          ) : (
            fieldFor(target.mode === 'maximum' ? 'high' : 'low')
          )}
        </View>

        <View style={styles.extras}>
          {EXTRAS.map(({ code, icon }) => {
            const on = form[code].mode !== 'none'
            const picked = selected === code
            return (
              <Pressable
                key={code}
                accessibilityRole="button"
                accessibilityState={{ selected: picked }}
                accessibilityLabel={`${NUTRIENT_NAMES[code]}: ${
                  on ? `${valueText(form[code])} ${unitOf(code)}` : 'sin meta'
                }. Editar`}
                onPress={() => setSelected(code)}
                style={[
                  styles.extra,
                  {
                    backgroundColor: theme.color.background.surface,
                    borderColor: picked ? theme.color.border.accent : theme.color.border.subtle,
                    borderWidth: picked ? 1.5 : 1,
                  },
                ]}
              >
                <FoundationIcon name={icon} size="md" color={macroColor(theme, code)} decorative />
                <View style={styles.grow}>
                  <Text role="control" size="md">
                    {NUTRIENT_NAMES[code]}
                  </Text>
                  <Text role="body" size="sm" color="secondary">
                    {on ? `${valueText(form[code])} ${unitOf(code)}` : 'Sin meta'}
                  </Text>
                </View>
                {on ? null : (
                  <FoundationIcon
                    name="add"
                    size="md"
                    color={theme.color.icon.secondary}
                    decorative
                  />
                )}
              </Pressable>
            )
          })}
        </View>

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
          disabled={targetsFromForm(form).length === 0 || energyOf(energy) === null}
          onPress={publish}
        />
      </View>
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
  content: { paddingHorizontal: 20, paddingBottom: 24, gap: 14 },
  energy: { borderRadius: 24, borderWidth: 1, padding: 20, gap: 12, overflow: 'hidden' },
  energyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  energyFigure: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  energyUnit: { paddingBottom: 8 },
  energyTabs: { alignSelf: 'flex-start' },
  rangeFields: { gap: 10 },
  split: { flexDirection: 'row', gap: 4, height: 6 },
  piece: { borderRadius: 3 },
  macros: { flexDirection: 'row', gap: 10 },
  macro: { flex: 1, alignItems: 'center', borderRadius: 22, padding: 12, gap: 6 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  editor: { borderRadius: 24, borderWidth: 1, padding: 16, gap: 14 },
  editorHead: { flexDirection: 'row', alignItems: 'center' },
  fieldBlock: { gap: 8 },
  extras: { flexDirection: 'row', gap: 10 },
  extra: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 20,
    padding: 14,
  },
  foot: { paddingHorizontal: 20, paddingTop: 10, gap: 10 },
})
