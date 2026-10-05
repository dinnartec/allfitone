/**
 * Detalle de una comida (N-4, N-4c, HU-SP-068, HU-SP-070, ADR-040).
 *
 * What the meal was, against the day: its kcal as a share of the energy goal and each
 * macro against its own, the items with what each one recorded, and the note. «Cambiar
 * foto» attaches or replaces the photo as a correction; «Corregir» opens the form.
 *
 * **Deleting says what the day becomes** before it is confirmed — the kcal and protein
 * before and after — on the same sheet as the menu, as the session detail does. It is a
 * real delete (OP-NUT-004): the meal, its items, its nutrients and its photo go.
 */

import { Button } from '@allfitone/react-native/button'
import { IconButton } from '@allfitone/react-native/icon-button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Sheet } from '@allfitone/react-native/sheet'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import * as Haptics from 'expo-haptics'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  FadeIn,
  FadeInLeft,
  FadeInRight,
  LinearTransition,
  ReduceMotion,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { clockLabel } from '../../src/client/finished'
import {
  dayAfterDeleting,
  dayTitle,
  goalFigure,
  mealTotals,
  MEAL_NAMES,
  mealWithArticle,
  NUTRIENT_NAMES,
  type DailySummary,
  type GoalTarget,
  type NutrientCode,
  type NutritionMeal,
  mealGrams,
} from '../../src/client/nutrition'
import { createSpaceNutritionFlow } from '../../src/client/nutrition-transport'
import { deviceTimezone } from '../../src/client/timezone'
import { ActionRow } from '../../src/components/action-row'
import { NutritionFacts } from '../../src/components/nutrition-facts'
import {
  FIGURE_TRACKING,
  macroColor,
  MEAL_ICON,
  MealThumb,
  Ring,
} from '../../src/components/nutrition-ui'

const READ_FAILED = 'No pudimos abrir esta comida. Inténtalo otra vez.'
const PHOTO_FAILED = 'No pudimos guardar la foto. Inténtalo otra vez.'
const DELETE_FAILED = 'No pudimos eliminarla. Inténtalo otra vez.'
const HERO = 340

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1)
const FORWARD = FadeInRight.duration(240).easing(EASE_OUT).reduceMotion(ReduceMotion.System)
const BACKWARD = FadeInLeft.duration(240).easing(EASE_OUT).reduceMotion(ReduceMotion.System)
const RESIZE = LinearTransition.duration(240).easing(EASE_OUT).reduceMotion(ReduceMotion.System)
const DELETED_MS = 900

const localDay = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())

export default function MealDetailScreen() {
  const { mealId } = useLocalSearchParams<{ mealId: string }>()
  const router = useRouter()
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const timeZone = useMemo(() => deviceTimezone(), [])
  const flow = useMemo(() => createSpaceNutritionFlow(), [])
  const today = localDay(timeZone)

  const [meal, setMeal] = useState<NutritionMeal | undefined>(undefined)
  const [day, setDay] = useState<DailySummary | undefined>(undefined)
  const [goal, setGoal] = useState<readonly GoalTarget[]>([])
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [sheet, setSheet] = useState<'menu' | 'delete' | 'deleted' | undefined>(undefined)
  const [back, setBack] = useState(false)
  const [busy, setBusy] = useState(false)

  useFocusEffect(
    useCallback(() => {
      let active = true
      flow
        .readMeal(mealId)
        .then(async (read) => {
          const [days, goals] = await Promise.all([
            flow.readDays(read.local_date, read.local_date, timeZone),
            flow.readGoals(),
          ])
          if (!active) return
          setMeal(read)
          setDay(days.data[0])
          setGoal(goals.active?.targets ?? [])
        })
        .catch(() => active && setFailure(READ_FAILED))
      return () => {
        active = false
      }
    }, [flow, mealId, timeZone]),
  )

  const totals = meal ? mealTotals(meal.items) : {}
  const targetOf = (code: NutrientCode) => goal.find((one) => one.nutrient_code === code)
  const shareOfDay = (code: NutrientCode) => {
    const target = targetOf(code)
    const value = totals[code]
    if (!target || value === undefined) return null
    const reference = goalFigure(target).value
    return reference > 0 ? value / reference : null
  }

  const changePhoto = async () => {
    if (!meal) return
    setSheet(undefined)
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.6,
      base64: true,
    })
    const asset = result.canceled ? undefined : result.assets[0]
    if (!asset?.base64) return
    const type =
      asset.mimeType === 'image/png' || asset.mimeType === 'image/webp'
        ? asset.mimeType
        : 'image/jpeg'
    setBusy(true)
    flow
      .reviseMeal(meal, { photo: { content_type: type, content: asset.base64 } })
      .then(setMeal)
      .catch(() => setFailure(PHOTO_FAILED))
      .finally(() => setBusy(false))
  }

  const remove = () => {
    if (!meal) return
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setBusy(true)
    setFailure(undefined)
    flow
      .deleteMeal(meal.id)
      .then(() => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        setSheet('deleted')
        setTimeout(() => {
          setSheet(undefined)
          router.back()
        }, DELETED_MS)
      })
      .catch(() => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
        setFailure(DELETE_FAILED)
      })
      .finally(() => setBusy(false))
  }

  if (!meal) {
    return (
      <Screen edges={['top']}>
        <View style={styles.waiting}>
          {failure ? (
            <InlineAlert message={failure} />
          ) : (
            <ActivityIndicator color={theme.color.icon.accent} />
          )}
        </View>
      </Screen>
    )
  }

  const name = MEAL_NAMES[meal.meal_type]
  const when = `${dayTitle(meal.local_date, today)} · ${clockLabel(meal.occurred_at, timeZone)}`
  const energyShare = shareOfDay('energy')
  const after = dayAfterDeleting(day, meal)

  return (
    <Screen edges={[]} padded={false}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View
          style={[
            styles.hero,
            { height: HERO + insets.top, backgroundColor: theme.color.background.surfaceMuted },
          ]}
        >
          {meal.photo ? (
            <Image source={meal.photo.url} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.center]}>
              <FoundationIcon
                name={MEAL_ICON[meal.meal_type]}
                customSize={80}
                color={theme.color.icon.secondary}
                decorative
              />
            </View>
          )}
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: `${theme.color.background.canvas}59` },
            ]}
          />
          <View style={[styles.heroTop, { paddingTop: insets.top + 8 }]}>
            <IconButton icon="back" accessibilityLabel="Volver" onPress={() => router.back()} />
            <IconButton
              icon="more"
              accessibilityLabel="Más opciones"
              onPress={() => {
                setBack(false)
                setSheet('menu')
              }}
            />
          </View>
          <View style={styles.heroBottom}>
            <View style={[styles.when, { backgroundColor: `${theme.color.background.canvas}CC` }]}>
              <FoundationIcon name="time" size="xs" color={theme.color.icon.primary} decorative />
              <Text role="control" size="xs">
                {when}
              </Text>
            </View>
            <View style={styles.titleRow}>
              <View style={styles.grow}>
                <Text role="heading" size="4xl">
                  {name}
                </Text>
                <Text role="body" size="sm" color="secondary">
                  {`${String(meal.items.length)} ${meal.items.length === 1 ? 'ítem' : 'ítems'}${meal.photo ? ' · con foto' : ''}`}
                </Text>
              </View>
              {totals.energy !== undefined ? (
                <View style={styles.kcal}>
                  <Text
                    role="display"
                    tracking={FIGURE_TRACKING}
                    size="5xl"
                    style={styles.kcalNumber}
                  >
                    {Math.round(totals.energy).toLocaleString('es-CO')}
                    <Text role="control" size="sm" color="secondary">
                      {' kcal'}
                    </Text>
                  </Text>
                  {energyShare !== null ? (
                    <Text role="control" size="sm" color="accent">
                      {`${String(Math.round(energyShare * 100))} % de tu día`}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          </View>
        </View>

        <View style={styles.body}>
          {failure ? <InlineAlert message={failure} /> : null}
          <View style={styles.macros}>
            {(['protein', 'carbohydrates', 'fat'] as const).map((code) => {
              const share = shareOfDay(code)
              return (
                <View
                  key={code}
                  style={[
                    styles.macro,
                    {
                      backgroundColor: theme.color.background.surface,
                      borderColor: theme.color.border.subtle,
                    },
                  ]}
                >
                  <View style={styles.macroTop}>
                    <Text role="eyebrow" size="2xs" color="muted" uppercase>
                      {code === 'carbohydrates' ? 'Carbos' : NUTRIENT_NAMES[code]}
                    </Text>
                    <Ring size={28} stroke={3} share={share ?? 0} color={macroColor(theme, code)} />
                  </View>
                  <Text role="poster" tracking={FIGURE_TRACKING} size="2xl">
                    {totals[code] === undefined
                      ? '—'
                      : `${String(Math.round(totals[code] ?? 0))} g`}
                  </Text>
                  <Text role="body" size="xs" style={{ color: macroColor(theme, code) }}>
                    {share === null ? 'Sin meta' : `${String(Math.round(share * 100))} % del día`}
                  </Text>
                </View>
              )
            })}
          </View>

          <Text role="control" size="lg">
            Qué comiste
          </Text>
          <View
            style={[
              styles.items,
              {
                backgroundColor: theme.color.background.surface,
                borderColor: theme.color.border.subtle,
              },
            ]}
          >
            {meal.items.map((item, index) => {
              const own = mealTotals([item])
              const parts = (['protein', 'carbohydrates', 'fat'] as const).map((code) =>
                own[code] === undefined
                  ? null
                  : `${String(Math.round(own[code] ?? 0))}${code === 'protein' ? 'P' : code === 'fat' ? 'G' : 'C'}`,
              )
              return (
                <View
                  key={item.position}
                  style={[
                    styles.itemRow,
                    index > 0
                      ? {
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderTopColor: theme.color.border.subtle,
                        }
                      : null,
                  ]}
                >
                  <View
                    style={[
                      styles.itemIcon,
                      { backgroundColor: theme.color.background.surfaceMuted },
                    ]}
                  >
                    <FoundationIcon
                      name="nutrition"
                      size="sm"
                      color={theme.color.icon.secondary}
                      decorative
                    />
                  </View>
                  <View style={styles.grow}>
                    <Text role="control" size="md">
                      {item.name}
                      {item.serving || item.quantity !== null ? (
                        <Text role="body" size="sm" color="muted">
                          {`  ${item.serving ?? `${String(item.quantity)} ${item.quantity_unit ?? ''}`}`}
                        </Text>
                      ) : null}
                    </Text>
                    <Text role="body" size="xs" color="muted">
                      {parts.filter(Boolean).join(' · ') || 'Sin macros registrados'}
                    </Text>
                  </View>
                  {own.energy !== undefined ? (
                    <Text role="poster" tracking={FIGURE_TRACKING} size="lg">
                      {String(Math.round(own.energy))}
                      <Text role="body" size="xs" color="muted">
                        {' kcal'}
                      </Text>
                    </Text>
                  ) : null}
                </View>
              )
            })}
          </View>

          <NutritionFacts
            values={totals}
            portion={`Toda la comida (${String(Math.round(mealGrams(meal.items)))} g)`}
            targets={goal}
            estimated={false}
          />

          {meal.note ? (
            <View style={styles.noteRow}>
              <FoundationIcon name="edit" size="sm" color={theme.color.icon.secondary} decorative />
              <Text role="body" size="sm" color="secondary" style={styles.grow}>
                {`«${meal.note}»`}
              </Text>
            </View>
          ) : null}
        </View>
      </ScrollView>

      <View
        style={[
          styles.foot,
          {
            paddingBottom: Math.max(insets.bottom, 12),
            backgroundColor: theme.color.background.canvas,
          },
        ]}
      >
        <View style={styles.grow}>
          <Button
            label="Cambiar foto"
            icon="camera"
            variant="secondary"
            loading={busy}
            onPress={() => void changePhoto()}
          />
        </View>
        <View style={styles.grow}>
          <Button
            label="Corregir"
            icon="edit"
            onPress={() => router.push({ pathname: '/nutrition/log', params: { mealId: meal.id } })}
          />
        </View>
      </View>

      <Sheet
        visible={sheet !== undefined}
        onDismiss={() => setSheet(undefined)}
        title={
          sheet === 'deleted'
            ? 'Comida eliminada'
            : sheet === 'delete'
              ? `¿Eliminar ${mealWithArticle(meal.meal_type)}?`
              : `${name} · ${when}`
        }
        hideTitle={sheet === 'delete'}
      >
        <Animated.View layout={RESIZE} style={styles.steps}>
          {sheet === 'deleted' ? (
            <Animated.View key="deleted" entering={FORWARD} style={styles.deleted}>
              <Animated.View
                entering={FadeIn.duration(260).delay(80).reduceMotion(ReduceMotion.System)}
                style={[styles.doneMark, { backgroundColor: `${theme.color.status.success}26` }]}
              >
                <FoundationIcon
                  name="check"
                  size="lg"
                  color={theme.color.status.success}
                  decorative
                />
              </Animated.View>
              <Text role="body" size="md" color="secondary" align="center">
                Tu día ya no la cuenta.
              </Text>
            </Animated.View>
          ) : sheet === 'delete' ? (
            <Animated.View key="delete" entering={FORWARD} style={styles.sheetBody}>
              <View style={styles.deleteHead}>
                <MealThumb meal={meal} size={64} />
                <View style={styles.grow}>
                  <Text role="control" size="xl" accessibilityRole="header">
                    {`¿Eliminar ${mealWithArticle(meal.meal_type)}?`}
                  </Text>
                  <Text role="body" size="sm" color="secondary">
                    {`${when} · ${String(meal.items.length)} ${meal.items.length === 1 ? 'ítem' : 'ítems'}${totals.energy !== undefined ? ` · ${String(Math.round(totals.energy))} kcal` : ''}`}
                  </Text>
                </View>
              </View>
              <Text role="body" size="md" color="secondary">
                Se borran la comida, sus ítems, sus nutrientes y la foto. No queda ninguna copia.
              </Text>
              {after.energy || after.protein ? (
                <View
                  style={[styles.after, { backgroundColor: theme.color.background.surfaceMuted }]}
                >
                  <Text role="eyebrow" size="xs" color="muted" uppercase>
                    Tu día queda así
                  </Text>
                  {after.energy ? (
                    <View style={styles.afterRow}>
                      <Text role="poster" tracking={FIGURE_TRACKING} size="2xl" color="muted">
                        {after.energy.before.toLocaleString('es-CO')}
                      </Text>
                      <FoundationIcon
                        name="forward"
                        size="sm"
                        color={theme.color.icon.secondary}
                        decorative
                      />
                      <Text role="poster" tracking={FIGURE_TRACKING} size="3xl">
                        {after.energy.after.toLocaleString('es-CO')}
                      </Text>
                      <Text role="control" size="sm" color="secondary">
                        kcal
                      </Text>
                    </View>
                  ) : null}
                  {after.protein ? (
                    <View style={styles.afterRow}>
                      <View
                        style={[styles.swatch, { backgroundColor: macroColor(theme, 'protein') }]}
                      />
                      <Text role="control" size="sm">
                        {`Proteína ${String(after.protein.before)} → ${String(after.protein.after)} g`}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
              <View style={styles.choices}>
                <View style={styles.grow}>
                  <Button
                    label="Cancelar"
                    variant="secondary"
                    disabled={busy}
                    onPress={() => {
                      void Haptics.selectionAsync()
                      setBack(true)
                      setSheet('menu')
                    }}
                  />
                </View>
                <View style={styles.grow}>
                  <Button
                    label="Eliminar"
                    icon="remove"
                    variant="danger"
                    loading={busy}
                    onPress={remove}
                  />
                </View>
              </View>
            </Animated.View>
          ) : (
            <Animated.View
              key="menu"
              {...(back ? { entering: BACKWARD } : {})}
              style={styles.sheetBody}
            >
              <ActionRow
                icon="edit"
                name="Corregir"
                detail="Cambia los alimentos, sus valores o la nota"
                onPress={() => {
                  setSheet(undefined)
                  router.push({ pathname: '/nutrition/log', params: { mealId: meal.id } })
                }}
              />
              <ActionRow
                icon="camera"
                name="Cambiar foto"
                detail="Elige otra de tu galería"
                onPress={() => void changePhoto()}
              />
              <ActionRow
                icon="remove"
                name="Eliminar comida"
                detail="Se borra de tu día y no se puede recuperar"
                danger
                onPress={() => {
                  void Haptics.selectionAsync()
                  setSheet('delete')
                }}
              />
            </Animated.View>
          )}
        </Animated.View>
      </Sheet>
    </Screen>
  )
}

const styles = StyleSheet.create({
  choices: { flexDirection: 'row', gap: 12 },
  grow: { flex: 1, gap: 2 },
  waiting: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingBottom: 24 },
  hero: { justifyContent: 'space-between' },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20 },
  heroBottom: { paddingHorizontal: 20, paddingBottom: 18, gap: 10 },
  when: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  kcal: { alignItems: 'flex-end' },
  kcalNumber: { paddingRight: 4 },
  body: { paddingHorizontal: 20, paddingTop: 16, gap: 12 },
  macros: { flexDirection: 'row', gap: 10 },
  macro: { flex: 1, borderRadius: 18, borderWidth: 1, padding: 12, gap: 4 },
  macroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  items: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 12 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  itemIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  foot: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingTop: 10 },
  steps: { overflow: 'hidden' },
  sheetBody: { gap: 12, paddingBottom: 8 },
  deleteHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  after: { borderRadius: 16, padding: 14, gap: 8 },
  afterRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: { width: 8, height: 8, borderRadius: 2 },
  deleted: { alignItems: 'center', gap: 14, paddingVertical: 18 },
  doneMark: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
