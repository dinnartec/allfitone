/**
 * Registering a meal from the camera (R-F1…R-F5, R-M, R-A0…R-A5, ADR-041).
 *
 * Three ways in, one screen: **Foto** takes or picks a photo and Allfit recognises it;
 * **Alimentos** searches the catalogue; **Plato** is the hand-written form that already
 * exists. The pill above says which meal and when — guessed from the hour, changed from
 * its menu.
 *
 * - **Recognising needs consent**, asked once, before the first photo leaves the phone.
 *   Without it, or when the model does not answer, the person is offered the search with
 *   nothing lost: the photo stays with the meal either way.
 * - **Nothing recognised is saved unseen.** The review lists every item with its portion
 *   and kcal, marks what is unsure with «¿Es esto?», and each item opens to adjust its
 *   amount, its food or its values. Every number is the catalogue's for those grams.
 * - **Saving** records the meal, then attaches the photo, as the hand-written form does,
 *   and hands the diary what it needs to say «Cena guardada · Deshacer».
 */

import { Button } from '@allfitone/react-native/button'
import { Sheet } from '@allfitone/react-native/sheet'
import { GlassPanel } from '@allfitone/react-native/glass'
import { IconButton } from '@allfitone/react-native/icon-button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Text } from '@allfitone/react-native/text'
import { TextField } from '@allfitone/react-native/text-field'
import { useTheme } from '@allfitone/react-native/theme'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as Haptics from 'expo-haptics'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import {
  captureTotals,
  creditsOpenFoodFacts,
  fromFood,
  fromRecognition,
  withAmount,
  placeLabels,
  isEstimated,
  mealFromCapture,
  mealTypeForHour,
  portionText,
  shownValues,
  withFood,
  type CaptureItem,
  type Food,
  type FrequentFood,
} from '../../src/client/capture'
import { clockLabel, withClock } from '../../src/client/finished'
import { MEAL_NAMES, MEAL_TYPES, type GoalTarget, type MealType } from '../../src/client/nutrition'
import { createSpaceNutritionFlow } from '../../src/client/nutrition-transport'
import { openItem, takeItemOutcome } from '../../src/client/item-handover'
import { handOverSavedMeal } from '../../src/client/saved-meal'
import { deviceTimezone } from '../../src/client/timezone'
import { ConsentSheet, FoodTile, MealMenu } from '../../src/components/capture-sheets'
import { FIGURE_TRACKING, macroColor, MEAL_ICON } from '../../src/components/nutrition-ui'

type Tab = 'photo' | 'foods'
type Phase = 'camera' | 'recognizing' | 'review'
interface Photo {
  readonly uri: string
  readonly base64: string
}

const RECOGNITION_FAILED =
  'No pudimos reconocer la foto. Búscalos en «Alimentos»; la foto se queda con la comida.'
const SAVE_FAILED = 'No pudimos guardar la comida. Inténtalo otra vez.'
const PHOTO_FAILED = 'La comida quedó guardada, pero sin la foto.'
// A label is about this size (tile, name, kcal); the gap keeps two from touching.
const LABEL_SIZE = { width: 200, height: 52 }
const LABEL_GAP = 8
const MACROS = [
  { code: 'protein', name: 'proteína' },
  { code: 'carbohydrates', name: 'carbos' },
  { code: 'fat', name: 'grasa' },
] as const

const localDay = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())
const localHour = (timeZone: string) =>
  Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(
      new Date(),
    ),
  )
// Also called from the sweep's animated style, on the UI thread.
function percent(value: number): `${number}%` {
  'worklet'
  return `${value}%`
}
const kcalOf = (value: number | undefined) =>
  value === undefined ? '—' : String(Math.round(value))

export default function CaptureScreen() {
  const { day: dayParam, type } = useLocalSearchParams<{ day?: string; type?: string }>()
  const router = useRouter()
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const flow = useMemo(() => createSpaceNutritionFlow(), [])
  const timeZone = useMemo(() => deviceTimezone(), [])
  const today = localDay(timeZone)
  const day = dayParam ?? today
  const suggested = useMemo(() => mealTypeForHour(localHour(timeZone)), [timeZone])

  const [occurredAt] = useState(() =>
    day === today
      ? new Date().toISOString()
      : (withClock(`${day}T17:00:00Z`, '12:00', timeZone) ?? new Date().toISOString()),
  )
  const [mealType, setMealType] = useState<MealType>(
    MEAL_TYPES.find((one) => one === type) ?? suggested,
  )
  const [tab, setTab] = useState<Tab>('photo')
  const [phase, setPhase] = useState<Phase>('camera')
  const [photo, setPhoto] = useState<Photo | null>(null)
  const [items, setItems] = useState<CaptureItem[]>([])
  const [recognizedBy, setRecognizedBy] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [consentAsked, setConsentAsked] = useState(false)
  const [consentBusy, setConsentBusy] = useState(false)
  const [targets, setTargets] = useState<readonly GoalTarget[]>([])
  const [leaving, setLeaving] = useState(false)
  const [replacing, setReplacing] = useState<string | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Food[]>([])
  const [frequent, setFrequent] = useState<FrequentFood[]>([])
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const camera = useRef<CameraView>(null)
  const [permission, requestPermission] = useCameraPermissions()
  // A recognition the person cancelled may still answer; this tells it to be ignored.
  const attempt = useRef(0)
  const draft = useRef(`capture-${String(Date.now())}`)

  const mealName = MEAL_NAMES[mealType].toLowerCase()
  const totals = captureTotals(items)

  // The label measures against the person's goal; without one, against the norm.
  useEffect(() => {
    let active = true
    flow
      .readGoals()
      .then((goals) => active && setTargets(goals.active?.targets ?? []))
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [flow])

  useEffect(() => {
    flow
      .frequentFoods()
      .then((page) => setFrequent([...page.data]))
      .catch(() => undefined)
  }, [flow])

  useEffect(() => {
    const needle = query.trim()
    if (needle.length === 0) {
      setResults([])
      return
    }
    let live = true
    const timer = setTimeout(() => {
      flow
        .searchFoods(needle)
        .then((page) => live && setResults([...page.data]))
        .catch(() => live && setResults([]))
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [flow, query])

  // ———————————————————————————————— photo

  const recognise = async (taken: Photo) => {
    setFailure(undefined)
    setPhase('recognizing')
    const mine = (attempt.current += 1)
    try {
      const consent = await flow.readConsent()
      if (consent.accepted_version !== consent.current_version) {
        if (mine === attempt.current) setConsentAsked(true)
        return
      }
      const recognition = await flow.recognize({
        content_type: 'image/jpeg',
        content: taken.base64,
      })
      if (mine !== attempt.current) return
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setRecognizedBy(recognition.model)
      setItems((current) => [
        ...current.filter((item) => item.origin === 'catalog'),
        ...fromRecognition(recognition),
      ])
      setPhase('review')
    } catch {
      if (mine !== attempt.current) return
      setFailure(RECOGNITION_FAILED)
      setPhase('camera')
      setTab('foods')
    }
  }

  const shoot = async () => {
    try {
      const picture = await camera.current?.takePictureAsync({ base64: true, quality: 0.6 })
      if (!picture?.base64) return
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      const taken = { uri: picture.uri, base64: picture.base64 }
      setPhoto(taken)
      await recognise(taken)
    } catch {
      setFailure(RECOGNITION_FAILED)
    }
  }

  const pickFromGallery = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.6,
    })
    const asset = picked.canceled ? undefined : picked.assets[0]
    if (!asset?.base64) return
    const taken = { uri: asset.uri, base64: asset.base64 }
    setPhoto(taken)
    await recognise(taken)
  }

  const cancelRecognition = () => {
    attempt.current += 1
    setPhase(items.length > 0 ? 'review' : 'camera')
  }

  const acceptConsent = async () => {
    setConsentBusy(true)
    try {
      const consent = await flow.readConsent()
      await flow.acceptConsent(consent.current_version)
      setConsentAsked(false)
      if (photo) await recognise(photo)
    } catch {
      setFailure(RECOGNITION_FAILED)
      setConsentAsked(false)
      setPhase('camera')
      setTab('foods')
    } finally {
      setConsentBusy(false)
    }
  }

  // ———————————————————————————————— items

  const backToCamera = () => {
    setLeaving(false)
    setPhoto(null)
    setItems((current) => current.filter((item) => item.origin === 'catalog'))
    setPhase('camera')
  }

  const change = (next: CaptureItem) =>
    setItems((current) => current.map((item) => (item.key === next.key ? next : item)))
  const remove = (key: string) => setItems((current) => current.filter((item) => item.key !== key))
  const addFood = (draft: CaptureItem) => {
    void Haptics.selectionAsync()
    setQuery('')
    const food = draft.food
    if (replacing && food) {
      // The item keeps its place on the photo; the food and the amount are the new ones.
      const replaced = (item: CaptureItem) => ({
        ...withAmount(withFood(item, food), draft.amount, draft.unit, draft.mode),
        edited: draft.edited,
      })
      setItems((current) => current.map((item) => (item.key === replacing ? replaced(item) : item)))
      setReplacing(undefined)
      setTab('photo')
      return
    }
    setItems((current) => [...current, draft])
  }

  // An item is edited on its own screen; this opens it, and the focus effect takes it back.
  const openEditing = (item: CaptureItem) => {
    openItem({ item, targets, mode: 'edit', mealName })
    router.push('/nutrition/item')
  }
  const openAdding = (food: Food) => {
    openItem({ item: fromFood(food), targets, mode: 'add', mealName })
    router.push('/nutrition/item')
  }
  useFocusEffect(
    useCallback(() => {
      const outcome = takeItemOutcome()
      if (!outcome) return
      if (outcome.kind === 'kept') change(outcome.item)
      if (outcome.kind === 'added') addFood(outcome.item)
      if (outcome.kind === 'removed') remove(outcome.key)
      if (outcome.kind === 'change-food') {
        setReplacing(outcome.item.key)
        setQuery(outcome.item.food ? '' : outcome.item.name)
        setTab('foods')
      }
      // Taken once on return: running again finds nothing and does nothing.
    }, [addFood, change, remove]),
  )

  const save = async () => {
    if (items.length === 0) return
    setSaving(true)
    setFailure(undefined)
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    try {
      const recorded = await flow.recordMeal(
        draft.current,
        mealFromCapture({
          items,
          mealType,
          occurredAt,
          timezone: timeZone,
          recognizedBy: photo ? recognizedBy : null,
        }),
      )
      handOverSavedMeal({
        id: recorded.id,
        label: MEAL_NAMES[mealType],
        kcal: totals.energy ?? null,
      })
      if (photo) {
        try {
          await flow.reviseMeal(recorded, {
            photo: { content_type: 'image/jpeg', content: photo.base64 },
          })
        } catch {
          setFailure(PHOTO_FAILED)
        }
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      router.back()
    } catch {
      setSaving(false)
      setFailure(SAVE_FAILED)
    }
  }

  // ———————————————————————————————— layout

  const pillTop = insets.top + 8
  const reviewing = tab === 'photo' && phase === 'review'
  const backdrop = photo ? (
    <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
  ) : null

  return (
    <View style={[styles.root, { backgroundColor: theme.color.background.canvas }]}>
      {tab === 'photo' && phase === 'camera' && !photo ? (
        permission?.granted ? (
          <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.center, { padding: 32 }]}>
            <FoundationIcon
              name="camera"
              customSize={48}
              color={theme.color.icon.secondary}
              decorative
            />
            <Text role="body" size="md" color="secondary" align="center">
              Para fotografiar tu comida, Allfit necesita la cámara.
            </Text>
            <Button
              label="Permitir la cámara"
              variant="secondary"
              onPress={() => void requestPermission()}
            />
          </View>
        )
      ) : (
        backdrop
      )}
      {tab === 'foods' || reviewing ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: `${theme.color.background.canvas}${reviewing ? '33' : 'D9'}` },
          ]}
        />
      ) : null}

      {/* The fixed header: close, and the meal with its hour. */}
      <View style={[styles.header, { paddingTop: pillTop }]} pointerEvents="box-none">
        <IconButton
          icon={reviewing ? 'back' : 'close'}
          accessibilityLabel={reviewing ? 'Volver a la cámara' : 'Cerrar sin guardar'}
          onPress={() => {
            if (!reviewing) router.back()
            // What the photo found is work: it is never thrown away on a single touch.
            else if (items.some((item) => item.origin === 'photo')) setLeaving(true)
            else backToCamera()
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${MEAL_NAMES[mealType]}, ${clockLabel(occurredAt, timeZone)}. Cambiar la comida`}
          onPress={() => setMenu(true)}
        >
          <GlassPanel radius="action" material="chip" style={styles.pill}>
            <FoundationIcon
              name={MEAL_ICON[mealType]}
              size="xs"
              color={theme.color.icon.primary}
              decorative
            />
            <Text
              role="control"
              size="md"
            >{`${MEAL_NAMES[mealType]} · ${clockLabel(occurredAt, timeZone)}`}</Text>
            <FoundationIcon name="expand" size="xs" color={theme.color.icon.secondary} decorative />
          </GlassPanel>
        </Pressable>
        <View style={styles.headerSpace} />
      </View>

      {tab === 'photo' && phase === 'camera' && !photo && permission?.granted ? (
        <>
          <GlassPanel radius="action" material="chip" style={[styles.hint, { top: pillTop + 60 }]}>
            <Text role="control" size="sm">
              Encuadra todo el plato
            </Text>
          </GlassPanel>
          <Corners top={pillTop + 110} />
        </>
      ) : null}

      {tab === 'photo' && phase === 'recognizing' ? (
        <Recognising onCancel={cancelRecognition} bottom={insets.bottom} />
      ) : null}

      {reviewing ? (
        <Review
          items={items}
          totals={totals}
          mealName={mealName}
          saving={saving}
          failure={failure}
          bottom={insets.bottom}
          onOpen={openEditing}
          onAdd={() => setTab('foods')}
          onSave={() => void save()}
        />
      ) : null}

      {tab === 'foods' ? (
        <Foods
          top={pillTop + 64}
          bottom={insets.bottom + 72}
          query={query}
          onQuery={setQuery}
          results={results}
          frequent={frequent}
          items={items}
          totals={totals}
          mealName={mealName}
          replacing={replacing !== undefined}
          saving={saving}
          failure={failure}
          onChoose={openAdding}
          onOpen={openEditing}
          onSave={() => void save()}
        />
      ) : null}

      {!reviewing && phase !== 'recognizing' ? (
        <View
          style={[styles.bottom, { paddingBottom: insets.bottom + 10 }]}
          pointerEvents="box-none"
        >
          {tab === 'photo' && !photo ? (
            <View style={styles.shutterRow}>
              <IconButton
                icon="image"
                accessibilityLabel="Elegir una foto de la galería"
                onPress={() => void pickFromGallery()}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Tomar la foto"
                disabled={!permission?.granted}
                onPress={() => void shoot()}
                style={[
                  styles.shutter,
                  { borderColor: theme.color.text.primary, opacity: permission?.granted ? 1 : 0.4 },
                ]}
              >
                <View style={[styles.shutterCore, { backgroundColor: theme.color.text.primary }]} />
              </Pressable>
              <View style={styles.shutterSide} />
            </View>
          ) : null}
          <View style={styles.tabs}>
            {(
              [
                ['photo', 'Foto'],
                ['foods', 'Alimentos'],
                ['dish', 'Plato'],
              ] as const
            ).map(([key, label]) => {
              const active = key === tab
              return (
                <Pressable
                  key={key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    void Haptics.selectionAsync()
                    if (key === 'dish')
                      router.replace({
                        pathname: '/nutrition/log',
                        params: { day, type: mealType },
                      })
                    else setTab(key)
                  }}
                  style={styles.tab}
                >
                  <Text
                    role="control"
                    size="md"
                    style={{
                      color: active ? theme.color.status.warning : theme.color.text.secondary,
                    }}
                  >
                    {label}
                  </Text>
                  <View
                    style={[
                      styles.tabDot,
                      { backgroundColor: active ? theme.color.status.warning : 'transparent' },
                    ]}
                  />
                </Pressable>
              )
            })}
          </View>
        </View>
      ) : null}

      <MealMenu
        visible={menu}
        value={mealType}
        suggested={suggested}
        top={pillTop + 52}
        onChoose={(next) => {
          void Haptics.selectionAsync()
          setMealType(next)
          setMenu(false)
        }}
        onDismiss={() => setMenu(false)}
      />
      <Sheet visible={leaving} onDismiss={() => setLeaving(false)} title="¿Descartar lo escaneado?">
        <View style={styles.decisions}>
          <Button
            label="Descartar y volver a la cámara"
            variant="secondary"
            onPress={backToCamera}
          />
          <Button label="Seguir revisando" variant="ghost" onPress={() => setLeaving(false)} />
        </View>
      </Sheet>
      <ConsentSheet
        visible={consentAsked}
        busy={consentBusy}
        onAccept={() => void acceptConsent()}
        onDecline={() => {
          setConsentAsked(false)
          setPhase('camera')
          setTab('foods')
        }}
      />
    </View>
  )
}

/** The four corners of the frame the plate goes in. */
function Corners({ top }: { readonly top: number }) {
  const theme = useTheme()
  const corner = { borderColor: theme.color.icon.accent }
  return (
    <View pointerEvents="none" style={[styles.frame, { top }]}>
      <View style={[styles.corner, styles.topLeft, corner]} />
      <View style={[styles.corner, styles.topRight, corner]} />
      <View style={[styles.corner, styles.bottomLeft, corner]} />
      <View style={[styles.corner, styles.bottomRight, corner]} />
    </View>
  )
}

/** R-F2: a line sweeping the photo while the model looks; the person can still leave. */
function Recognising({
  onCancel,
  bottom,
}: {
  readonly onCancel: () => void
  readonly bottom: number
}) {
  const theme = useTheme()
  const reduced = useReducedMotion()
  const sweep = useSharedValue(0)
  useEffect(() => {
    if (reduced) return
    sweep.set(
      withRepeat(
        withTiming(1, { duration: 1600, easing: Easing.bezier(0.77, 0, 0.175, 1) }),
        -1,
        true,
      ),
    )
  }, [reduced, sweep])
  const line = useAnimatedStyle(() => ({ top: percent(18 + sweep.get() * 60) }))
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {reduced ? null : (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.sweep,
            { backgroundColor: theme.color.icon.accent, shadowColor: theme.color.icon.accent },
            line,
          ]}
        />
      )}
      <View style={[styles.recognisingFoot, { paddingBottom: bottom + 24 }]}>
        <GlassPanel radius="action" material="chip" style={styles.recognisingPill}>
          <ActivityIndicator color={theme.color.icon.accent} />
          <Text role="control" size="md">
            Reconociendo alimentos…
          </Text>
        </GlassPanel>
        <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={12}>
          <Text role="control" size="md" color="secondary">
            Cancelar
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

/** R-F3: the photo with each food where it sits, and the meal below it. */
function Review({
  items,
  totals,
  mealName,
  saving,
  failure,
  bottom,
  onOpen,
  onAdd,
  onSave,
}: {
  readonly items: readonly CaptureItem[]
  readonly totals: ReturnType<typeof captureTotals>
  readonly mealName: string
  readonly saving: boolean
  readonly failure: string | undefined
  readonly bottom: number
  readonly onOpen: (item: CaptureItem) => void
  readonly onAdd: () => void
  readonly onSave: () => void
}) {
  const theme = useTheme()
  const [area, setArea] = useState({ width: 0, height: 0 })
  const placed = items.filter((item) => item.at)
  const spots = placeLabels(
    placed.map((item) => item.at ?? { x: 0, y: 0 }),
    area,
    LABEL_SIZE,
    LABEL_GAP,
  )
  const grams = MACROS.map(({ code }) => totals[code] ?? 0)
  const sum = Math.max(
    1,
    grams.reduce((total, value) => total + value, 0),
  )
  return (
    <>
      {/* Labels over the photo, at the top 45 % of the screen the photo shows above the card. */}
      <View
        pointerEvents="box-none"
        style={styles.labels}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout
          setArea({ width, height })
        }}
      >
        {area.width > 0 &&
          placed.map((item, at) => (
            <Animated.View
              key={item.key}
              entering={FadeIn.duration(220)
                .delay(at * 60)
                .reduceMotion(ReduceMotion.System)}
              style={[styles.labelAnchor, spots[at]]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.name}. Ajustar`}
                onPress={() => onOpen(item)}
              >
                <GlassPanel radius="action" material="chip" style={styles.label}>
                  <FoodTile icon={item.icon} food={item.food} size={26} />
                  <View>
                    <Text role="control" size="sm" numberOfLines={1}>
                      {item.review ? `${item.name} ?` : item.name}
                    </Text>
                    <Text
                      role="body"
                      size="2xs"
                      color="secondary"
                    >{`${kcalOf(shownValues(item).energy)} kcal`}</Text>
                  </View>
                </GlassPanel>
              </Pressable>
            </Animated.View>
          ))}
      </View>
      <Animated.View
        entering={FadeInDown.duration(280).reduceMotion(ReduceMotion.System)}
        style={[
          styles.card,
          {
            backgroundColor: theme.color.background.canvas,
            borderColor: theme.color.border.subtle,
            paddingBottom: bottom + 12,
          },
        ]}
      >
        <View style={[styles.grabber, { backgroundColor: theme.color.border.default }]} />
        <View style={styles.total}>
          <Text role="display" tracking={FIGURE_TRACKING} size="5xl">
            {kcalOf(totals.energy)}
          </Text>
          <View style={styles.totalUnit}>
            <Text role="control" size="md" color="secondary">
              kcal
            </Text>
            <Text role="control" size="xs" color="accent">
              Calculado por Allfit con IA
            </Text>
          </View>
        </View>
        <View style={styles.bar}>
          {MACROS.map(({ code }, at) => (
            <View
              key={code}
              style={{
                flex: Math.max(0.02, (grams[at] ?? 0) / sum),
                height: 6,
                borderRadius: 3,
                backgroundColor: macroColor(theme, code),
              }}
            />
          ))}
        </View>
        <View style={styles.legend}>
          {MACROS.map(({ code, name }, at) => (
            <View key={code} style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: macroColor(theme, code) }]} />
              <Text role="control" size="sm">{`${String(Math.round(grams[at] ?? 0))} g`}</Text>
              <Text role="body" size="sm" color="muted">
                {name}
              </Text>
            </View>
          ))}
        </View>
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {items.map((item) => (
            <ItemRow key={item.key} item={item} onPress={() => onOpen(item)} />
          ))}
          <Pressable accessibilityRole="button" onPress={onAdd} style={styles.addMissing}>
            <FoundationIcon name="add" size="xs" color={theme.color.icon.accent} decorative />
            <Text role="control" size="md" color="accent">
              Agregar ingrediente
            </Text>
          </Pressable>
        </ScrollView>
        {failure ? <InlineAlert message={failure} /> : null}
        <Button
          label={`Guardar ${mealName}`}
          icon="check"
          loading={saving}
          disabled={items.length === 0}
          onPress={onSave}
        />
      </Animated.View>
    </>
  )
}

function ItemRow({ item, onPress }: { readonly item: CaptureItem; readonly onPress: () => void }) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${portionText(item)}${isEstimated(item) ? ', estimado con IA' : ''}. Ajustar`}
      onPress={onPress}
      style={[styles.row, { borderBottomColor: theme.color.border.subtle }]}
    >
      <FoodTile icon={item.icon} food={item.food} />
      <View style={styles.grow}>
        <Text role="control" size="md" numberOfLines={1}>
          {item.name}
        </Text>
        <View style={styles.rowChips}>
          <View style={[styles.portion, { backgroundColor: theme.color.background.surfaceMuted }]}>
            <Text role="body" size="xs" color="secondary">
              {portionText(item)}
            </Text>
            <FoundationIcon name="expand" size="xs" color={theme.color.icon.secondary} decorative />
          </View>
          {item.review ? (
            <View style={[styles.portion, { backgroundColor: `${theme.color.status.warning}26` }]}>
              <Text role="control" size="xs" style={{ color: theme.color.status.warning }}>
                {isEstimated(item) ? 'IA' : item.food ? '¿Es esto?' : 'Elige el alimento'}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      <Text role="poster" tracking={FIGURE_TRACKING} size="xl">
        {kcalOf(shownValues(item).energy)}
        <Text role="body" size="xs" color="muted">
          {' kcal'}
        </Text>
      </Text>
    </Pressable>
  )
}

/** R-A1…R-A4: search, what the person logs most, and the meal as it grows. */
function Foods({
  top,
  bottom,
  query,
  onQuery,
  results,
  frequent,
  items,
  totals,
  mealName,
  replacing,
  saving,
  failure,
  onChoose,
  onOpen,
  onSave,
}: {
  readonly top: number
  readonly bottom: number
  readonly query: string
  readonly onQuery: (query: string) => void
  readonly results: readonly Food[]
  readonly frequent: readonly FrequentFood[]
  readonly items: readonly CaptureItem[]
  readonly totals: ReturnType<typeof captureTotals>
  readonly mealName: string
  readonly replacing: boolean
  readonly saving: boolean
  readonly failure: string | undefined
  readonly onChoose: (food: Food) => void
  readonly onOpen: (item: CaptureItem) => void
  readonly onSave: () => void
}) {
  const searching = query.trim().length > 0
  return (
    <View style={[styles.foods, { top, bottom }]}>
      <TextField
        label="Buscar un alimento"
        hideLabel
        value={query}
        onChangeText={onQuery}
        placeholder={
          replacing
            ? 'Busca el alimento correcto'
            : items.length > 0
              ? 'Añade otro alimento'
              : 'Busca: arroz, huevo, banano…'
        }
        autoCorrect={false}
        returnKeyType="search"
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.foodsList}
        showsVerticalScrollIndicator={false}
      >
        {searching ? (
          results.length > 0 ? (
            results.map((food) => (
              <FoodRow
                key={food.id}
                icon={food.icon}
                food={food}
                detail={defaultLine(food)}
                onPress={() => onChoose(food)}
              />
            ))
          ) : (
            <Text role="body" size="sm" color="muted">
              No encontramos ese alimento.
            </Text>
          )
        ) : items.length > 0 && !replacing ? (
          <>
            <Text
              role="body"
              size="sm"
              color="secondary"
            >{`Tu ${mealName} · ${String(items.length)} ${items.length === 1 ? 'alimento' : 'alimentos'}`}</Text>
            {items.map((item) => (
              <FoodRow
                key={item.key}
                icon={item.icon}
                food={item.food}
                name={item.name}
                detail={portionText(item)}
                kcal={shownValues(item).energy}
                onPress={() => onOpen(item)}
              />
            ))}
          </>
        ) : frequent.length > 0 ? (
          <>
            <Text role="body" size="sm" color="secondary">
              Lo que más registras
            </Text>
            {frequent.map((one) => (
              <FoodRow
                key={one.food.id}
                icon={one.food.icon}
                food={one.food}
                detail={defaultLine(one.food)}
                onPress={() => onChoose(one.food)}
              />
            ))}
          </>
        ) : null}
        {creditsOpenFoodFacts(
          searching
            ? results
            : items.length > 0 && !replacing
              ? items.map((item) => item.food)
              : frequent.map((one) => one.food),
        ) ? (
          <Text role="body" size="xs" color="muted">
            Productos empacados con datos de Open Food Facts (ODbL)
          </Text>
        ) : null}
      </ScrollView>
      {!searching && !replacing ? (
        <View style={styles.foodsFoot}>
          <View style={styles.total}>
            <Text role="display" tracking={FIGURE_TRACKING} size="5xl">
              {items.length > 0 ? kcalOf(totals.energy) : '0'}
            </Text>
            {items.length > 0 ? (
              <Text role="control" size="md" color="secondary" style={styles.totalUnit}>
                kcal
              </Text>
            ) : null}
          </View>
          <Text role="control" size="xs" color={items.length > 0 ? 'accent' : 'muted'}>
            {items.length > 0
              ? `Calculado por Allfit · ${String(Math.round(totals.protein ?? 0))} g P · ${String(Math.round(totals.carbohydrates ?? 0))} g C · ${String(Math.round(totals.fat ?? 0))} g G`
              : 'Añade alimentos y calculamos todo'}
          </Text>
          {failure ? <InlineAlert message={failure} /> : null}
          {items.length > 0 ? (
            <Button label={`Guardar ${mealName}`} icon="check" loading={saving} onPress={onSave} />
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

const defaultLine = (food: Food) => {
  const portion = food.portions.find((one) => one.is_default) ?? food.portions[0]
  const energy = food.nutrients.find((nutrient) => nutrient.nutrient_code === 'energy')
  const grams = portion?.grams ?? 100
  const kcal = energy ? ` · ${String(Math.round((energy.value_per_100g * grams) / 100))} kcal` : ''
  const brand = food.brand ? `${food.brand} · ` : ''
  return `${brand}${portion ? portion.label : '100 g'}${kcal}`
}

function FoodRow({
  icon,
  food,
  name,
  detail,
  kcal,
  onPress,
}: {
  readonly icon: string
  readonly food: Food | null
  readonly name?: string
  readonly detail: string
  readonly kcal?: number | undefined
  readonly onPress: () => void
}) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name ?? food?.name ?? ''}, ${detail}`}
      onPress={onPress}
    >
      <GlassPanel radius="card" style={styles.foodRow}>
        <FoodTile icon={icon} food={food} />
        <View style={styles.grow}>
          <Text role="control" size="md" numberOfLines={1}>
            {name ?? food?.name ?? ''}
          </Text>
          <Text role="body" size="xs" color="secondary">
            {detail}
          </Text>
        </View>
        {kcal === undefined ? (
          <View style={[styles.plus, { backgroundColor: theme.color.background.surfaceMuted }]}>
            <FoundationIcon name="add" size="sm" color={theme.color.icon.primary} decorative />
          </View>
        ) : (
          <Text role="poster" tracking={FIGURE_TRACKING} size="xl">
            {kcalOf(kcal)}
            <Text role="body" size="xs" color="muted">
              {' kcal'}
            </Text>
          </Text>
        )}
      </GlassPanel>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  decisions: { gap: 10 },
  root: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 14 },
  grow: { flex: 1, gap: 4 },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    zIndex: 10,
  },
  headerSpace: { width: 44 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  hint: { position: 'absolute', alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 7 },
  frame: { position: 'absolute', left: 40, right: 40, height: 420 },
  corner: { position: 'absolute', width: 28, height: 28 },
  topLeft: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 10 },
  topRight: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 10 },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 10,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 10,
  },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: 18, paddingHorizontal: 24 },
  shutterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  shutter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterCore: { width: 62, height: 62, borderRadius: 31 },
  shutterSide: { width: 44 },
  tabs: { flexDirection: 'row', justifyContent: 'center', gap: 28 },
  tab: { alignItems: 'center', gap: 4, paddingHorizontal: 4 },
  tabDot: { width: 5, height: 5, borderRadius: 3 },
  sweep: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    shadowOpacity: 0.9,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  recognisingFoot: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    gap: 22,
  },
  recognisingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  labels: { position: 'absolute', top: 0, left: 16, right: 16, height: '45%' },
  labelAnchor: { position: 'absolute', maxWidth: LABEL_SIZE.width },
  label: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 6,
    paddingRight: 12,
    paddingVertical: 6,
    maxWidth: LABEL_SIZE.width,
  },
  card: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '58%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 10,
  },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center' },
  total: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  totalUnit: { paddingBottom: 8, gap: 2 },
  bar: { flexDirection: 'row', gap: 4 },
  legend: { flexDirection: 'row', gap: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  swatch: { width: 8, height: 8, borderRadius: 2 },
  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowChips: { flexDirection: 'row', gap: 6 },
  portion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  addMissing: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  foods: { position: 'absolute', left: 20, right: 20, gap: 12 },
  foodsList: { gap: 10, paddingBottom: 12 },
  foodsFoot: { gap: 8 },
  foodRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  plus: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
})
