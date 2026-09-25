/**
 * Weight and height — HU-SP-011.
 *
 * One screen for both, which is a reversal worth explaining. They were split apart
 * because the first attempt at combining them put a card with its own rail on top and
 * a different rail underneath: two objects competing, and a title that asked two
 * questions the layout answered in two unrelated halves.
 *
 * What changed is that both halves are now the **same object** — a label, a unit pair,
 * a reading and a tape — so they read as one system instead of two. Split across two
 * screens each half then had a whole phone to itself and filled about a third of it,
 * which is how the dead space below the tape appeared.
 *
 * The value lives in canonical kilograms and centimetres and is converted only to
 * paint it. That is not a rounding nicety: storing what is displayed makes
 * 74 kg → 163 lb → 73.9 kg, and somebody's weight moves on its own for changing unit
 * and coming back. The arithmetic is in `measures-form.ts`, where it is tested.
 *
 * Feet and inches are measured as **total inches**, an integer like any other, and
 * only the label renders `5′ 10″` — so no control holds two fields that can disagree.
 *
 * **There is no Skip.** Criterion 3 used to allow one and the story was amended:
 * weight is the baseline of the progress series, so without it nothing measured later
 * has anything to be compared against.
 *
 * Continuing requires having moved **both** tapes. They rest at 70 and 170 because a
 * tape has to be somewhere, and a number nobody chose cannot be the first record of a
 * series. They are still two commands — `OP-IDN-006` makes the record's id the
 * command's own — so a failure on the second leaves the first saved and the retry
 * replays it.
 */

import { Button } from '@allfitone/react-native/button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { WheelPicker } from '@allfitone/react-native/wheel-picker'
import { useTheme } from '@allfitone/react-native/theme'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { OnboardingHeader } from '../../src/components/onboarding-header'
import { ApiError } from '../../src/client'
import { createSpaceOnboardingFlow } from '../../src/client/onboarding-transport'
import { guardStep, nextRouteAfter } from '../../src/client/onboarding-steps'
import { selectionTick } from '../../src/client/selection-tick'
import {
  CANONICAL_LENGTH,
  CANONICAL_MASS,
  canSubmitMeasure,
  displayIn,
  readingFor,
  RESTING_HEIGHT_CM,
  RESTING_WEIGHT_KG,
  runFor,
  toCanonical,
  unitFromSaved,
  type LengthUnit,
  type MassUnit,
  type MeasureUnit,
} from '../../src/client/measures-form'

const FOOTER_LIFT = 16
const EXPIRED = 'Tu sesión venció. Vuelve a entrar para guardar tu respuesta.'
const READ_FAILED = 'No pudimos leer tus respuestas. Inténtalo otra vez.'
const SAVE_FAILED = 'No pudimos guardar tus medidas. Inténtalo otra vez.'

/** Drawn on the pill. Short because the pill sits beside the caption, not under it. */
const UNIT_LABEL: Record<MeasureUnit, string> = { kg: 'KG', lb: 'LB', cm: 'CM', in: 'FT' }

/** Said out loud. `FT` is two letters a screen reader spells rather than reads. */
const UNIT_SPOKEN: Record<MeasureUnit, string> = {
  kg: 'Kilos',
  lb: 'Libras',
  cm: 'Centímetros',
  in: 'Pies',
}

/** What hangs off the reading inside the wheel. */
const UNIT_SUFFIX: Record<MeasureUnit, string> = { kg: 'kg', lb: 'lb', cm: 'cm', in: '' }

export default function OnboardingMeasures() {
  const router = useRouter()
  const theme = useTheme()
  const flow = useMemo(() => createSpaceOnboardingFlow(), [])

  const [weightKg, setWeightKg] = useState(RESTING_WEIGHT_KG)
  const [heightCm, setHeightCm] = useState(RESTING_HEIGHT_CM)
  const [massUnit, setMassUnit] = useState<MassUnit>(CANONICAL_MASS)
  const [lengthUnit, setLengthUnit] = useState<LengthUnit>(CANONICAL_LENGTH)
  const [weightTouched, setWeightTouched] = useState(false)
  const [heightTouched, setHeightTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useEffect(() => {
    let active = true

    flow
      .resume()
      .then((current) => {
        if (!active) return
        const owed = guardStep('/onboarding/measures', current)
        if (owed) {
          router.replace(owed)
          return
        }
        const saved = current.answers.body_measures.value
        if (saved?.weight) {
          setWeightKg(saved.weight.value)
          setMassUnit(unitFromSaved(saved.weight.original_unit, CANONICAL_MASS) as MassUnit)
          setWeightTouched(true)
        }
        if (saved?.height) {
          setHeightCm(saved.height.value)
          setLengthUnit(unitFromSaved(saved.height.original_unit, CANONICAL_LENGTH) as LengthUnit)
          setHeightTouched(true)
        }
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof ApiError && cause.failure === 'unauthenticated') {
          setSessionExpired(true)
          setFailure(EXPIRED)
          return
        }
        setFailure(READ_FAILED)
      })

    return () => {
      active = false
    }
  }, [flow, router])

  const pressable = !submitting && !sessionExpired
  const submittable =
    canSubmitMeasure({ touched: weightTouched, submitting, sessionExpired }) &&
    canSubmitMeasure({ touched: heightTouched, submitting, sessionExpired })

  const submit = async () => {
    setSubmitting(true)
    setFailure(undefined)
    const measuredOn = new Date().toISOString().slice(0, 10)
    try {
      await flow.recordBodyProgress({
        metric_code: 'body_weight',
        value: displayIn(weightKg, massUnit),
        unit: massUnit,
        measured_on: measuredOn,
      })
      await flow.recordBodyProgress({
        metric_code: 'body_height',
        value: displayIn(heightCm, lengthUnit),
        unit: lengthUnit,
        measured_on: measuredOn,
      })
      router.replace(nextRouteAfter('/onboarding/measures'))
    } catch (cause: unknown) {
      if (cause instanceof ApiError && cause.failure === 'unauthenticated') {
        setSessionExpired(true)
        setFailure(EXPIRED)
      } else {
        setFailure(SAVE_FAILED)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const units = <U extends MeasureUnit>(
    options: readonly U[],
    chosen: U,
    choose: (u: U) => void,
  ) => (
    <View
      style={[
        styles.units,
        {
          backgroundColor: theme.color.background.surfaceSubtle,
          borderColor: theme.color.border.subtle,
        },
      ]}
    >
      {options.map((option) => {
        const on = chosen === option
        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled: !pressable }}
            accessibilityLabel={UNIT_SPOKEN[option]}
            disabled={!pressable}
            onPress={() => choose(option)}
            hitSlop={8}
            style={[
              styles.unit,
              on
                ? {
                    backgroundColor: theme.color.accent.tonal,
                    borderColor: theme.color.border.accent,
                  }
                : styles.unitOff,
            ]}
          >
            <Text role="body" size="xs" color={on ? 'accent' : 'muted'} style={styles.unitText}>
              {UNIT_LABEL[option]}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )

  const weightReading = readingFor(weightKg, massUnit)
  const heightReading = readingFor(heightCm, lengthUnit)
  // Memoised because the run is a hundred-odd rows: rebuilding it per render would
  // re-render every one of them on every scroll frame.
  const weightRun = useMemo(() => runFor(massUnit), [massUnit])
  const heightRun = useMemo(() => runFor(lengthUnit), [lengthUnit])

  return (
    <Screen edges={['top', 'bottom']} dots>
      <OnboardingHeader step="/onboarding/measures" />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text role="display" size="4xl" uppercase accessibilityRole="header">
          ¿Cuánto pesas{'\n'}y cuánto mides?
        </Text>

        <View style={styles.blocks}>
          {/* One control, two orientations. Weight runs across and height runs down —
              the pairing is the point, and it is why they are one component: as two
              they would drift apart the first time either was touched. */}
          <View style={styles.block}>
            <View style={styles.head}>
              <Text role="body" size="xs" color="muted" style={styles.caption}>
                PESO
              </Text>
              {units(['kg', 'lb'] as const, massUnit, setMassUnit)}
            </View>
            <WheelPicker
              orientation="horizontal"
              values={weightRun}
              value={displayIn(weightKg, massUnit)}
              onChange={(shown) => {
                setWeightKg(toCanonical(shown, massUnit))
                setWeightTouched(true)
                selectionTick()
              }}
              suffix={UNIT_SUFFIX[massUnit]}
              disabled={!pressable}
              accessibilityLabel="Peso"
              accessibilityText={`${weightReading.text} ${weightReading.suffix}`}
            />
          </View>

          <View style={styles.block}>
            <View style={styles.head}>
              <Text role="body" size="xs" color="muted" style={styles.caption}>
                ESTATURA
              </Text>
              {units(['cm', 'in'] as const, lengthUnit, setLengthUnit)}
            </View>
            <WheelPicker
              values={heightRun}
              value={displayIn(heightCm, lengthUnit)}
              onChange={(shown) => {
                setHeightCm(toCanonical(shown, lengthUnit))
                setHeightTouched(true)
                selectionTick()
              }}
              suffix={UNIT_SUFFIX[lengthUnit]}
              disabled={!pressable}
              accessibilityLabel="Estatura"
              accessibilityText={`${heightReading.text} ${heightReading.suffix}`}
              formatValue={(mark) =>
                lengthUnit === 'in' ? readingFor(toCanonical(mark, 'in'), 'in').text : String(mark)
              }
            />
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.note}>
          <FoundationIcon name="info" size="sm" color={theme.color.text.muted} decorative />
          <Text role="body" size="xs" color="muted" style={styles.noteText}>
            Es tu primer registro de progreso. Podrás actualizarlo cuando quieras.
          </Text>
        </View>

        {failure ? <InlineAlert message={failure} style={styles.alert} /> : null}

        <Button
          label="Continuar"
          disabled={!submittable}
          loading={submitting}
          onPress={submit}
          style={styles.cta}
        />

        {sessionExpired ? (
          <Button
            label="Iniciar sesión"
            variant="secondary"
            onPress={() => router.replace('/sign-in')}
            style={styles.signIn}
          />
        ) : null}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: 4 },
  // The leftover split three ways rather than gathered anywhere. This phone is taller
  // than the canvas, so several hundred points have to go somewhere: centring the pair
  // put it all in the margins and left the two blocks stuck against each other, and
  // anchoring them at both ends put it all between them, which stopped them reading as
  // a pair at all. Evenly is the only division that crowds nothing.
  blocks: { flex: 1, justifyContent: 'space-evenly' },
  block: { gap: 6 },
  caption: { letterSpacing: 1.6 },
  // Caption and pill share a line. Stacked, the pill read as a second control the
  // person had to deal with before reaching the wheel.
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  units: { flexDirection: 'row', padding: 3, borderWidth: 1, borderRadius: 999 },
  unit: {
    minWidth: 40,
    minHeight: 25,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 999,
  },
  unitOff: { borderColor: 'transparent' },
  unitText: { letterSpacing: 1.4 },
  note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 12 },
  noteText: { flex: 1 },
  footer: { paddingTop: 4, paddingBottom: FOOTER_LIFT },
  alert: { marginTop: 12 },
  cta: { minHeight: 44, marginTop: 10 },
  signIn: { minHeight: 44, marginTop: 10 },
})
