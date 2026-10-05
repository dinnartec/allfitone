/**
 * The sheets of capturing a meal (R-F4, R-A3, R-M, ADR-041).
 *
 * - **Adjust an item** (R-F4): the amount in its portion, or in grams; the values the
 *   catalogue calculates, each one editable, with «Editado por ti» and what it would have
 *   been; «Volver a lo calculado» drops every edit. Changing the amount recalculates all
 *   but what the person typed.
 * - **Choose how much** (R-A3): a food from the search, its portions as chips, the kcal and
 *   macros of the one chosen.
 * - **Consent** before a photo first leaves Allfit: what is sent, to whom, and what is not
 *   kept. Searching never needs it.
 * - **The meal**, from the pill: what the hour suggested, and the others.
 */

import { Button } from '@allfitone/react-native/button'
import { FoundationIcon, iconCatalog, type IconName } from '@allfitone/react-native/icons'
import { Sheet } from '@allfitone/react-native/sheet'
import { Text } from '@allfitone/react-native/text'
import { useTheme, type Theme } from '@allfitone/react-native/theme'
import { Pressable, StyleSheet, View } from 'react-native'
import Animated, { FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated'

import {
  isEstimated,
  portionText,
  restoreCalculated,
  shownValues,
  withAmount,
  withEdit,
  type CaptureItem,
  type Food,
} from '../client/capture'
import {
  MEAL_NAMES,
  MEAL_TYPES,
  type GoalTarget,
  type MealType,
  type NutrientCode,
} from '../client/nutrition'
import { AmountField, NutrientCells, NutritionFacts } from './nutrition-facts'
import { macroColor, MEAL_ICON } from './nutrition-ui'

const isIconName = (name: string): name is IconName => Object.hasOwn(iconCatalog, name)

/** A food's tile: its DS food icon, on the tint of the macro it is mostly made of. */
export function FoodTile({
  icon,
  food,
  size = 40,
}: {
  readonly icon: string
  readonly food: Food | null
  readonly size?: number
}) {
  const theme = useTheme()
  const tint = tintFor(theme, food)
  return (
    <View
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: size * 0.3, backgroundColor: `${tint}26` },
      ]}
    >
      <FoundationIcon
        name={isIconName(icon) ? icon : 'nutrition'}
        customSize={size * 0.5}
        color={tint}
        decorative
      />
    </View>
  )
}

/** The macro a food is mostly made of colours its tile, as the day's cards do. */
function tintFor(theme: Theme, food: Food | null): string {
  if (!food) return theme.color.icon.secondary
  const grams = (code: NutrientCode) =>
    food.nutrients.find((nutrient) => nutrient.nutrient_code === code)?.value_per_100g ?? 0
  const protein = grams('protein') * 4
  const carbs = grams('carbohydrates') * 4
  const fat = grams('fat') * 9
  if (protein >= carbs && protein >= fat) return macroColor(theme, 'protein')
  return carbs >= fat ? macroColor(theme, 'carbohydrates') : macroColor(theme, 'fat')
}

// ———————————————————————————————————————— R-F4, R-A3

/** The amount, the four figures and the label of one item, on its screen. */
export function ItemEditor({
  item,
  targets,
  onChange,
}: {
  readonly item: CaptureItem
  readonly targets: readonly GoalTarget[]
  readonly onChange: (item: CaptureItem) => void
}) {
  const theme = useTheme()
  const shown = shownValues(item)
  const edited = Object.keys(item.edited).length > 0
  const estimated = isEstimated(item)
  return (
    <>
      <AmountField
        food={item.food}
        amount={item.amount}
        unit={item.unit}
        mode={item.mode}
        grams={item.grams}
        onChange={(amount, unit, mode) => onChange(withAmount(item, amount, unit, mode))}
      />
      <NutrientCells
        shown={shown}
        edited={item.edited}
        estimated={estimated}
        onEdit={(code, value) => onChange(withEdit(item, code, value))}
      />
      {edited ? (
        <Animated.View
          entering={FadeIn.duration(180).reduceMotion(ReduceMotion.System)}
          exiting={FadeOut.duration(120)}
        >
          <Pressable
            accessibilityRole="button"
            onPress={() => onChange(restoreCalculated(item))}
            style={styles.restore}
          >
            <FoundationIcon name="history" size="xs" color={theme.color.icon.accent} decorative />
            <Text role="control" size="sm" color="accent">
              Volver a lo calculado
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}
      <NutritionFacts
        values={shown}
        portion={
          item.unit.label === 'g'
            ? portionText(item)
            : `${portionText(item)} (${String(Math.round(item.grams))} g)`
        }
        targets={targets}
        estimated={estimated}
      />
    </>
  )
}

// ———————————————————————————————————————— consent

export const CONSENT_TEXT =
  'Para reconocer los alimentos, la foto se envía a Google (Gemini) a través de Vercel, sin su ubicación ni sus datos de cámara. No se guarda allá ni se usa para entrenar modelos. Las calorías salen del catálogo de Allfit, y tú revisas todo antes de guardar.'

export function ConsentSheet({
  visible,
  busy,
  onAccept,
  onDecline,
}: {
  readonly visible: boolean
  readonly busy: boolean
  readonly onAccept: () => void
  readonly onDecline: () => void
}) {
  const theme = useTheme()
  return (
    <Sheet visible={visible} onDismiss={onDecline} title="Reconocer tu comida" hideTitle>
      <View style={styles.sheet}>
        <View style={[styles.consentIcon, { backgroundColor: `${theme.color.icon.accent}1F` }]}>
          <FoundationIcon name="camera" size="md" color={theme.color.icon.accent} decorative />
        </View>
        <Text role="control" size="xl" align="center" accessibilityRole="header">
          Reconocer tu comida
        </Text>
        <Text role="body" size="md" color="secondary" align="center">
          {CONSENT_TEXT}
        </Text>
        <Button label="Aceptar y reconocer" loading={busy} onPress={onAccept} />
        <Button label="Ahora no" variant="ghost" disabled={busy} onPress={onDecline} />
      </View>
    </Sheet>
  )
}

// ———————————————————————————————————————— R-M

export function MealMenu({
  visible,
  value,
  suggested,
  top,
  onChoose,
  onDismiss,
}: {
  readonly visible: boolean
  readonly value: MealType
  readonly suggested: MealType
  readonly top: number
  readonly onChoose: (type: MealType) => void
  readonly onDismiss: () => void
}) {
  const theme = useTheme()
  if (!visible) return null
  return (
    <Animated.View
      entering={FadeIn.duration(160).reduceMotion(ReduceMotion.System)}
      exiting={FadeOut.duration(120)}
      style={[StyleSheet.absoluteFill, styles.menuLayer]}
    >
      <Pressable
        accessibilityLabel="Cerrar el menú"
        onPress={onDismiss}
        style={[StyleSheet.absoluteFill, { backgroundColor: `${theme.color.background.canvas}B3` }]}
      />
      <View
        style={[
          styles.menu,
          {
            top,
            backgroundColor: theme.color.background.surface,
            borderColor: theme.color.border.subtle,
          },
        ]}
      >
        {MEAL_TYPES.map((type) => (
          <Pressable
            key={type}
            accessibilityRole="button"
            accessibilityState={{ selected: type === value }}
            onPress={() => onChoose(type)}
            style={styles.menuRow}
          >
            <FoundationIcon
              name={MEAL_ICON[type]}
              size="sm"
              color={theme.color.icon.secondary}
              decorative
            />
            <Text
              role="control"
              size="md"
              color={type === value ? 'primary' : 'secondary'}
              style={styles.grow}
            >
              {MEAL_NAMES[type]}
            </Text>
            {type === value ? (
              <FoundationIcon name="check" size="sm" color={theme.color.icon.accent} decorative />
            ) : null}
          </Pressable>
        ))}
      </View>
      <Text
        role="body"
        size="sm"
        color="secondary"
        align="center"
        style={[styles.menuHint, { top: top + 260 }]}
      >
        {`Allfit eligió «${MEAL_NAMES[suggested]}» por la hora. Si no es, eliges otra aquí.`}
      </Text>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  grow: { flex: 1, gap: 2 },
  tile: { alignItems: 'center', justifyContent: 'center' },
  sheet: { gap: 14, paddingBottom: 8 },
  restore: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  consentIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  menuLayer: { zIndex: 20 },
  menu: {
    position: 'absolute',
    alignSelf: 'center',
    width: 200,
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 6,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuHint: { position: 'absolute', left: 40, right: 40 },
})
