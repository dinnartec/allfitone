/**
 * What a food or a meal holds, and how much of it (R-F4, R-A3, N-2b; ADR-041 as amended).
 *
 * - **AmountField:** the amount typed, never stepped; read as a number or as a fraction,
 *   with ¼ to ¾ a tap away, in a unit the food allows (`unitChoices`). Changing the unit
 *   keeps the grams: the same food, said another way.
 * - **NutrientCells:** energy and the three macros side by side, each editable. A figure
 *   the person typed is marked as theirs; one the model guessed, «IA».
 * - **NutritionFacts:** the label, folding open: fats with saturated and trans, cholesterol,
 *   sodium, carbohydrates with fibre and sugars, protein; then vitamins and minerals. Each
 *   against the person's goal, else the Resolución 810 daily value, else alone.
 *
 * Built from DS primitives as the goal and log screens are; the facts panel and its bar
 * are candidates for the DS once a second product needs them.
 */

import { Chip } from '@allfitone/react-native/chip'
import { getNativeFontFamily } from '@allfitone/react-native/fonts'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { SegmentedControl } from '@allfitone/react-native/segmented-control'
import { Sheet } from '@allfitone/react-native/sheet'
import { Text } from '@allfitone/react-native/text'
import { TextField } from '@allfitone/react-native/text-field'
import { useTheme } from '@allfitone/react-native/theme'
import { typography } from '@allfitone/react-native/tokens'
import { useEffect, useState, type ReactNode } from 'react'
import { Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'

import {
  formatAmount,
  parseAmount,
  switchUnit,
  unitChoices,
  unitName,
  type AmountMode,
  type UnitChoice,
} from '../client/amount'
import type { Food, Values } from '../client/capture'
import {
  dailyReference,
  NUTRIENT_GROUP,
  NUTRIENT_NAMES,
  nutrientFigure,
  UNIT_OF,
  type GoalTarget,
  type NutrientCode,
} from '../client/nutrition'
import { macroColor } from './nutrition-ui'
import { SheetChoice } from './sheet-choice'

// ———————————————————————————————————————— amount

// Drawn as what they write, so the control fits beside the amount; read aloud as words.
const MODES = [
  { value: 'number', label: '1,5', accessibilityLabel: 'Número' },
  { value: 'fraction', label: '½', accessibilityLabel: 'Fracción' },
] as const
const SHARES: readonly (readonly [number, string])[] = [
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [1 / 2, '½'],
  [2 / 3, '⅔'],
  [3 / 4, '¾'],
]
const isMode = (value: string): value is AmountMode => value === 'number' || value === 'fraction'

export function AmountField({
  food,
  amount,
  unit,
  mode,
  grams,
  onChange,
}: {
  readonly food: Food | null
  readonly amount: number
  readonly unit: UnitChoice
  readonly mode: AmountMode
  readonly grams: number
  readonly onChange: (amount: number, unit: UnitChoice, mode: AmountMode) => void
}) {
  const theme = useTheme()
  const choices = unitChoices(food)
  const [text, setText] = useState(formatAmount(amount, mode))
  const [typing, setTyping] = useState(false)
  const [picking, setPicking] = useState(false)
  // What the person is typing is theirs until they leave the field.
  useEffect(() => {
    if (!typing) setText(formatAmount(amount, mode))
  }, [amount, mode, typing])

  const pickUnit = (next: UnitChoice) => {
    setPicking(false)
    onChange(switchUnit(grams, next), next, mode)
  }

  return (
    <View style={styles.amount}>
      <View style={styles.amountRow}>
        {/* Numbers only; a fraction comes from the shortcuts, as that keyboard has no slash. */}
        <TextField
          label="Cantidad"
          hideLabel
          value={text}
          onChangeText={(typed) => {
            setText(typed)
            const parsed = parseAmount(typed)
            if (parsed !== null) onChange(parsed, unit, mode)
          }}
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
          keyboardType="decimal-pad"
          placeholder="1"
          style={styles.amountInput}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Unidad: ${unitName(unit)}. Cambiar`}
          onPress={() => {
            Keyboard.dismiss()
            setPicking(true)
          }}
          style={[
            styles.unitPicker,
            {
              backgroundColor: theme.color.background.surfaceSubtle,
              borderColor: theme.color.border.subtle,
              borderRadius: theme.semanticRadius.control,
              minHeight: theme.touchTarget,
            },
          ]}
        >
          <Text role="control" size="md" numberOfLines={1} style={styles.grow}>
            {unitName(unit)}
          </Text>
          {unit.countable ? (
            <Text role="body" size="sm" color="muted">
              {`${String(Math.round(unit.grams))} g`}
            </Text>
          ) : null}
          <FoundationIcon name="expand" size="sm" color={theme.color.icon.secondary} decorative />
        </Pressable>
        <SegmentedControl
          accessibilityLabel="Escribir la cantidad como"
          items={MODES}
          value={mode}
          onChange={(next) => {
            if (isMode(next)) onChange(amount, unit, next)
          }}
          style={styles.modes}
        />
      </View>
      {/* A shortcut while typing, not a row that is always there. */}
      {mode === 'fraction' && typing ? (
        <View style={styles.chips}>
          {SHARES.map(([share, glyph]) => (
            <Chip
              key={glyph}
              label={glyph}
              accessibilityLabel={`Sumar ${glyph}`}
              selected={Math.abs(amount - Math.floor(amount) - share) < 0.02}
              onPress={() => {
                const next = Math.floor(amount) + share
                // The shortcut writes in the field too: what is typed is what is counted.
                setText(formatAmount(next, mode))
                onChange(next, unit, mode)
              }}
              grow
            />
          ))}
        </View>
      ) : null}
      <Sheet visible={picking} onDismiss={() => setPicking(false)} title="Unidad">
        <ScrollView style={styles.unitList} showsVerticalScrollIndicator={false}>
          {choices.map((choice) => (
            <SheetChoice
              key={choice.label}
              name={unitName(choice)}
              {...(choice.countable ? { detail: `${String(Math.round(choice.grams))} g` } : {})}
              selected={choice.label === unit.label}
              onPress={() => pickUnit(choice)}
            />
          ))}
        </ScrollView>
      </Sheet>
    </View>
  )
}

// ———————————————————————————————————————— cells

const CELLS: readonly { readonly code: NutrientCode; readonly label: string }[] = [
  { code: 'energy', label: 'Kcal' },
  { code: 'protein', label: 'Proteínas (g)' },
  { code: 'carbohydrates', label: 'Carbs (g)' },
  { code: 'fat', label: 'Grasas (g)' },
]

export function NutrientCells({
  shown,
  edited,
  estimated,
  onEdit,
}: {
  readonly shown: Values
  readonly edited: Values
  readonly estimated: boolean
  readonly onEdit: (code: NutrientCode, value: number) => void
}) {
  return (
    <View style={styles.cells}>
      {CELLS.map(({ code, label }) => (
        <Cell
          key={code}
          code={code}
          label={label}
          value={shown[code]}
          mine={edited[code] !== undefined}
          estimated={estimated}
          onEdit={(value) => onEdit(code, value)}
        />
      ))}
    </View>
  )
}

// Kilocalories in whole numbers; grams to a tenth.
const cellText = (code: NutrientCode, value: number | undefined) =>
  value === undefined
    ? ''
    : String(code === 'energy' ? Math.round(value) : Math.round(value * 10) / 10).replace('.', ',')

function Cell({
  code,
  label,
  value,
  mine,
  estimated,
  onEdit,
}: {
  readonly code: NutrientCode
  readonly label: string
  readonly value: number | undefined
  readonly mine: boolean
  readonly estimated: boolean
  readonly onEdit: (value: number) => void
}) {
  const theme = useTheme()
  const [text, setText] = useState(cellText(code, value))
  const [typing, setTyping] = useState(false)
  useEffect(() => {
    if (!typing) setText(cellText(code, value))
  }, [code, value, typing])

  return (
    <View
      style={[
        styles.cell,
        {
          backgroundColor: theme.color.background.surface,
          borderColor: mine ? theme.color.status.warning : theme.color.border.subtle,
        },
      ]}
    >
      <View
        style={[
          styles.cellRule,
          {
            backgroundColor: code === 'energy' ? theme.color.text.primary : macroColor(theme, code),
          },
        ]}
      />
      <View style={styles.cellValue}>
        <TextInput
          accessibilityLabel={`${NUTRIENT_NAMES[code]}${mine ? ', editado por ti' : estimated ? ', estimado con IA' : ''}`}
          value={text}
          onChangeText={(typed) => {
            setText(typed)
            const parsed = Number(typed.replace(',', '.'))
            if (typed.trim() !== '' && Number.isFinite(parsed) && parsed >= 0) onEdit(parsed)
          }}
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
          keyboardType="decimal-pad"
          maxLength={6}
          placeholder="—"
          placeholderTextColor={theme.color.text.muted}
          style={[styles.cellInput, { color: theme.color.text.primary }]}
        />
      </View>
      <Text
        role="body"
        size="xs"
        color="muted"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {label}
      </Text>
      {mine || estimated ? (
        <Text
          role="control"
          size="2xs"
          style={{ color: mine ? theme.color.status.warning : theme.color.text.accent }}
        >
          {mine ? 'Tuyo' : 'IA'}
        </Text>
      ) : null}
    </View>
  )
}

// ———————————————————————————————————————— facts

const LABEL: readonly { readonly code: NutrientCode; readonly nested: boolean }[] = [
  { code: 'energy', nested: false },
  { code: 'fat', nested: false },
  { code: 'saturated_fat', nested: true },
  { code: 'trans_fat', nested: true },
  { code: 'cholesterol', nested: false },
  { code: 'sodium', nested: false },
  { code: 'carbohydrates', nested: false },
  { code: 'fiber', nested: true },
  { code: 'sugars', nested: true },
  { code: 'protein', nested: false },
]
const FACT_NAMES: Partial<Record<NutrientCode, string>> = {
  energy: 'Calorías',
  fat: 'Grasas totales',
  carbohydrates: 'Carbohidratos totales',
  protein: 'Proteínas',
}
const MICROS = Object.keys(NUTRIENT_GROUP).filter(
  (code): code is NutrientCode => code in NUTRIENT_GROUP,
)

export function NutritionFacts({
  values,
  portion,
  targets,
  estimated,
}: {
  readonly values: Values
  readonly portion: string
  readonly targets: readonly GoalTarget[]
  readonly estimated: boolean
}) {
  const vitamins = MICROS.filter(
    (code) => NUTRIENT_GROUP[code] === 'vitamin' && values[code] !== undefined,
  )
  const minerals = MICROS.filter(
    (code) => NUTRIENT_GROUP[code] === 'mineral' && values[code] !== undefined,
  )
  const note = estimated ? (
    <Text role="body" size="xs" color="muted">
      Valores estimados con IA
    </Text>
  ) : null

  return (
    <View style={styles.facts}>
      <Fold title="Información nutricional">
        <View style={styles.factRow}>
          <Text role="body" size="sm" style={styles.grow}>
            Porción
          </Text>
          <Text role="control" size="sm">
            {portion}
          </Text>
        </View>
        {LABEL.map(({ code, nested }) => (
          <FactRow
            key={code}
            code={code}
            name={FACT_NAMES[code] ?? NUTRIENT_NAMES[code]}
            nested={nested}
            value={values[code]}
            reference={dailyReference(code, targets)}
          />
        ))}
        {note}
      </Fold>
      <Fold title="Micronutrientes">
        {vitamins.length === 0 && minerals.length === 0 ? (
          <Text role="body" size="sm" color="muted">
            Este alimento no trae vitaminas ni minerales.
          </Text>
        ) : null}
        {vitamins.length > 0 ? (
          <Text role="control" size="md">
            Vitaminas
          </Text>
        ) : null}
        {vitamins.map((code) => (
          <FactRow
            key={code}
            code={code}
            name={NUTRIENT_NAMES[code]}
            nested={false}
            value={values[code]}
            reference={dailyReference(code, targets)}
          />
        ))}
        {minerals.length > 0 ? (
          <Text role="control" size="md">
            Minerales
          </Text>
        ) : null}
        {minerals.map((code) => (
          <FactRow
            key={code}
            code={code}
            name={NUTRIENT_NAMES[code]}
            nested={false}
            value={values[code]}
            reference={dailyReference(code, targets)}
          />
        ))}
        {note}
      </Fold>
    </View>
  )
}

function Fold({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  return (
    <View
      style={[
        styles.fold,
        { backgroundColor: theme.color.background.surface, borderColor: theme.color.border.subtle },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((was) => !was)}
        style={styles.foldHead}
        hitSlop={6}
      >
        <Text role="control" size="md" style={styles.grow}>
          {title}
        </Text>
        <FoundationIcon
          name={open ? 'collapse' : 'expand'}
          size="sm"
          color={theme.color.icon.secondary}
          decorative
        />
      </Pressable>
      {open ? <View style={styles.foldBody}>{children}</View> : null}
    </View>
  )
}

const percent = (value: number): `${number}%` => `${value}%`

function FactRow({
  code,
  name,
  nested,
  value,
  reference,
}: {
  readonly code: NutrientCode
  readonly name: string
  readonly nested: boolean
  readonly value: number | undefined
  readonly reference: number | null
}) {
  const theme = useTheme()
  const unit = UNIT_OF[code]
  const share = value !== undefined && reference ? value / reference : null
  const figure =
    reference === null || value === undefined
      ? nutrientFigure(value, unit)
      : `${nutrientFigure(value, unit).replace(/ \S+$/, '')} / ${nutrientFigure(reference, unit)}`
  return (
    <View style={[styles.fact, nested && styles.nested]}>
      <View style={styles.factRow}>
        <Text role="body" size="sm" style={styles.grow}>
          {name}
        </Text>
        <Text role="control" size="sm">
          {figure}
        </Text>
      </View>
      {share !== null ? (
        <View style={styles.factRow}>
          <View style={[styles.track, { backgroundColor: theme.color.background.surfaceMuted }]}>
            <View
              style={[
                styles.fill,
                {
                  width: percent(Math.min(100, Math.round(share * 100))),
                  backgroundColor:
                    code === 'energy' ? theme.color.text.primary : macroColor(theme, code),
                },
              ]}
            />
          </View>
          <Text role="body" size="xs" color="muted" style={styles.percent}>
            {`${String(Math.round(share * 100))} %`}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  amount: { gap: 10 },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  amountInput: { width: 76 },
  modes: { width: 104 },
  unitPicker: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    paddingHorizontal: 14,
  },
  unitList: { maxHeight: 420 },
  chips: { flexDirection: 'row', gap: 8 },
  cells: { flexDirection: 'row', gap: 8 },
  cell: { flex: 1, borderRadius: 14, borderWidth: 1, padding: 10, gap: 4 },
  cellRule: { width: 18, height: 3, borderRadius: 2 },
  cellValue: { flexDirection: 'row', alignItems: 'baseline' },
  cellInput: {
    fontFamily: getNativeFontFamily('poster'),
    fontSize: typography.size.xl,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    paddingVertical: 0,
  },
  facts: { gap: 10 },
  fold: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 14 },
  foldHead: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  foldBody: { gap: 12, paddingBottom: 14 },
  fact: { gap: 6 },
  nested: { paddingLeft: 14 },
  factRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  track: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3 },
  percent: { minWidth: 40, textAlign: 'right' },
})
