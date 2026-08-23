/**
 * Onboarding biological sex — HU-SP-096.
 *
 * The datum is written straight onto `identity.people`, not into the profile
 * claims catalogue. That catalogue exists for data that changes and that several
 * sources observe — weight, measurements, health context, each carrying its own
 * provenance and validity window. Biological sex is a single stable fact with one
 * possible source, so all of that machinery would sit unused.
 *
 * Three answers, and the third is not a value. Declining records nothing on the
 * person: an `unknown` label would force every later reader to tell "declined"
 * apart from "never asked", and no profile reader needs that. What it does record
 * is that the question was answered, on the attempt rather than on the person —
 * the person holds facts, the attempt holds how far the person got. Without that
 * mark a screen which skips itself once answered would ask a decliner again on
 * every cold start, and the onboarding could never advance past it.
 *
 * Nothing is preselected. The reference designs arrive with one card already
 * marked, which would write a declaration nobody made.
 *
 * `Screen` already applies `panelInset` on each side, so this screen adds no
 * horizontal padding of its own — adding it once cut the second card off at the
 * edge. The card width is measured from the row that holds them rather than
 * derived from the window, which is the only version that cannot disagree with
 * whatever the design system pads. See `sex-form.ts`.
 *
 * The portraits are composed here rather than in the design system because no
 * choice-card component exists yet. It is the component the remaining onboarding
 * screens will share, so it belongs there — as a published piece with its own
 * changeset, not as a copy in each app.
 *
 * Selection never depends on colour alone: the chosen card carries a border, a
 * tonal ground, a check and `accessibilityState.selected`, because WCAG 2.2 AA
 * does not accept colour as the only carrier of state.
 */

import { AmbientBackdrop } from '@allfitone/react-native/backdrop'
import { Button } from '@allfitone/react-native/button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Image, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native'

import femalePortrait from '../../assets/images/sex-female.webp'
import malePortrait from '../../assets/images/sex-male.webp'
import { OnboardingHeader } from '../../src/components/onboarding-header'
import { ApiError } from '../../src/client'
import { createSpaceOnboardingFlow } from '../../src/client/onboarding-transport'
import { guardStep } from '../../src/client/onboarding-steps'
import { canSubmitSex, cardGeometry, CARD_GAP, type SexAnswer } from '../../src/client/sex-form'

const EXPIRED = 'Tu sesión venció. Vuelve a entrar para guardar tu respuesta.'
const UNREACHABLE = 'No pudimos guardar tu respuesta. Inténtalo otra vez.'
const TAKEN_CONFLICT = 'No pudimos guardar tu respuesta. Inténtalo otra vez.'

const CHOICES: Array<{ value: Exclude<SexAnswer, null>; label: string; portrait: number }> = [
  { value: 'male', label: 'Masculino', portrait: malePortrait },
  { value: 'female', label: 'Femenino', portrait: femalePortrait },
]

/** Widths of the three bars on the decline card, as the prototype drew them. */
const STRATA = [13, 19, 16]

export default function OnboardingBiologicalSex() {
  const router = useRouter()
  const theme = useTheme()
  const { height } = useWindowDimensions()
  const flow = useMemo(() => createSpaceOnboardingFlow(), [])

  const [rowWidth, setRowWidth] = useState(0)
  const [answer, setAnswer] = useState<SexAnswer | undefined>(undefined)
  const [submitting, setSubmitting] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  const { cardWidth, portraitHeight } = cardGeometry(rowWidth, height)

  useEffect(() => {
    let active = true

    flow
      .resume()
      .then((current) => {
        if (!active) return
        // Only backwards: a missing prerequisite cannot be skipped, but an answer
        // already given is editable — that is what the back arrow is for.
        const owed = guardStep('/onboarding/sex', current)
        if (owed) {
          router.replace(owed)
          return
        }
        // Prefilled so going back shows what was answered rather than an empty
        // screen. Declining left no value, and that is a real state: answered with
        // nothing, which is exactly `null`.
        if (current.biological_sex_answered) setAnswer(current.biological_sex ?? null)
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof ApiError && cause.failure === 'unauthenticated') {
          setSessionExpired(true)
          setFailure(EXPIRED)
          return
        }
        setFailure(UNREACHABLE)
      })

    return () => {
      active = false
    }
  }, [flow, router])

  const pressable = !submitting && !sessionExpired
  const submittable = canSubmitSex({ answer, submitting, sessionExpired })

  const submit = async () => {
    if (answer === undefined) return
    setSubmitting(true)
    setFailure(undefined)
    try {
      await flow.declareBiologicalSex(answer)
      router.replace('/welcome')
    } catch (cause) {
      if (cause instanceof ApiError && cause.failure === 'conflict') {
        setFailure(TAKEN_CONFLICT)
        return
      }
      if (cause instanceof ApiError && cause.failure === 'unauthenticated') {
        setSessionExpired(true)
        setFailure(EXPIRED)
        return
      }
      setFailure(UNREACHABLE)
    } finally {
      setSubmitting(false)
    }
  }

  const declined = answer === null

  return (
    <Screen edges={['top', 'bottom']}>
      <AmbientBackdrop />

      <OnboardingHeader step="/onboarding/sex" />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text role="display" size="4xl" uppercase accessibilityRole="header">
          {'Tu sexo\nbiológico'}
        </Text>
        <Text role="body" size="md" color="secondary" style={styles.lede}>
          Calibra tu gasto energético y tus rangos de referencia. Es lo único para lo que lo usamos.
        </Text>

        <View
          style={styles.cards}
          onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}
        >
          {CHOICES.map((choice) => {
            const selected = answer === choice.value
            return (
              <Pressable
                key={choice.value}
                onPress={() => pressable && setAnswer(choice.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled: !pressable }}
                accessibilityLabel={choice.label}
                style={[
                  styles.card,
                  {
                    width: cardWidth,
                    borderColor: selected ? theme.color.border.accent : theme.color.border.subtle,
                    backgroundColor: selected
                      ? theme.color.accent.tonal
                      : theme.color.background.surfaceSubtle,
                  },
                ]}
              >
                {/* Rendered only once the row has been measured: at width zero the
                    image would resolve against nothing, which is the failure this
                    screen already had twice. */}
                {cardWidth > 0 ? (
                  <Image
                    source={choice.portrait}
                    style={[
                      { width: cardWidth, height: portraitHeight },
                      selected ? undefined : styles.dimmed,
                    ]}
                    resizeMode="cover"
                    accessible={false}
                  />
                ) : null}

                {selected ? (
                  <View style={[styles.check, { backgroundColor: theme.color.border.accent }]}>
                    <FoundationIcon
                      name="check"
                      customSize={13}
                      strokeScale="compact"
                      color={theme.color.accent.onAccent}
                      decorative
                    />
                  </View>
                ) : null}

                <Text
                  role="display"
                  size="lg"
                  uppercase
                  color={selected ? 'accent' : 'secondary'}
                  style={styles.name}
                >
                  {choice.label}
                </Text>
              </Pressable>
            )
          })}
        </View>

        {/* Same family as the two cards, not a demoted pill: it is an answer. */}
        <Pressable
          onPress={() => pressable && setAnswer(null)}
          accessibilityRole="radio"
          accessibilityState={{ selected: declined, disabled: !pressable }}
          accessibilityLabel="Prefiero no decirlo"
          style={[
            styles.decline,
            {
              borderColor: declined ? theme.color.border.accent : theme.color.border.subtle,
              backgroundColor: declined
                ? theme.color.accent.tonal
                : theme.color.background.surfaceSubtle,
            },
          ]}
        >
          <View style={styles.strata}>
            {STRATA.map((width, index) => (
              <View
                key={index}
                style={{
                  width: declined ? 22 : width,
                  height: 2,
                  borderRadius: 2,
                  backgroundColor: declined
                    ? theme.color.border.accent
                    : theme.color.border.default,
                }}
              />
            ))}
          </View>
          <Text role="body" size="md" color={declined ? 'accent' : 'secondary'}>
            Prefiero no decirlo
          </Text>
        </Pressable>

        {declined ? (
          <View style={styles.consequence}>
            <FoundationIcon
              name="info"
              size="sm"
              color={theme.color.text.muted}
              decorative
              style={styles.consequenceIcon}
            />
            <Text role="body" size="sm" color="muted" style={styles.consequenceText}>
              Puedes añadirlo cuando quieras desde tu perfil. Nada más cambia.
            </Text>
          </View>
        ) : null}

        {failure ? (
          <View style={styles.alert}>
            <InlineAlert message={failure} />
          </View>
        ) : null}

        <Button
          label="Continuar"
          disabled={!submittable}
          loading={submitting}
          onPress={() => {
            void submit()
          }}
          style={styles.submit}
        />

        {/* Without this the screen says "sign in again" and offers no way to. */}
        {sessionExpired ? (
          <Button
            label="Iniciar sesión"
            variant="secondary"
            onPress={() => router.replace('/sign-in')}
          />
        ) : null}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingTop: 18, paddingBottom: 26 },
  lede: { marginTop: 11 },
  cards: { flexDirection: 'row', gap: CARD_GAP, marginTop: 20 },
  card: {
    borderWidth: 2,
    borderRadius: 22,
    paddingBottom: 10,
    overflow: 'hidden',
    alignItems: 'center',
  },
  dimmed: { opacity: 0.72 },
  check: {
    position: 'absolute',
    top: 11,
    right: 11,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { paddingTop: 9 },
  decline: {
    marginTop: 11,
    borderWidth: 2,
    borderRadius: 18,
    paddingVertical: 15,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  strata: { gap: 3 },
  consequence: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 11 },
  consequenceIcon: { marginTop: 2 },
  consequenceText: { flex: 1 },
  alert: { marginTop: 14 },
  submit: { marginTop: 20 },
})
