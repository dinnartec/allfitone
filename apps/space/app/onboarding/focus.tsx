/**
 * What do you want to focus on — HU-SP-097.
 *
 * Front and back at once, no toggle. A muscle map with a side switch makes the
 * person hunt for the face their zone lives on before they can even see it, and
 * half the zones here span both — arms light the biceps in front and the triceps
 * behind. Two instances of the map cost one screen of width and remove the hunt.
 *
 * No frame around them. A bordered panel put the bodies in a box and left them
 * swimming in it; the figures sit straight on the canvas instead.
 *
 * Tapping a muscle on the figure and tapping its chip are the same control, which
 * is criterion 1: the list is a real alternative to the figure, not decoration.
 * Someone who cannot or will not aim at a small shape gets the same answer from a
 * 44 pt chip.
 *
 * Both bodies draw their outline. An earlier version turned it off on the grounds
 * that the library ships one for the man and none for the woman; that was wrong —
 * `SvgFemaleWrapper` ships both faces — and without it the silhouette was open and
 * the muscles read as loose pieces. Why the figure is composed rather than
 * configured, and what each part of the painting is for, is in `body-figure.tsx`.
 *
 * Nothing arrives selected, and continuing requires an answer — "whole body" is
 * how someone says "no emphasis" without leaving the question open. Criterion 3 of
 * the story was amended to match. Every rule about what a selection means lives in
 * `focus-form.ts`.
 *
 * It saves through `OP-IDN-046`, which exists because the emphasis is the first
 * profile attribute that holds several values at once: `OP-IDN-004` seals the live
 * claim of the same attribute before inserting, so three zones through that route
 * would have kept one and lost two in silence. The command carries the whole set,
 * so deselecting a zone is expressed by its absence.
 */

import { AmbientBackdrop } from '@allfitone/react-native/backdrop'
import { Button } from '@allfitone/react-native/button'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native'

import { BodyFigure } from '../../src/components/body-figure'
import { OnboardingHeader } from '../../src/components/onboarding-header'
import { ApiError } from '../../src/client'
import { createSpaceOnboardingFlow } from '../../src/client/onboarding-transport'
import { guardStep, nextRouteAfter } from '../../src/client/onboarding-steps'
import {
  areasFor,
  bodyGender,
  bodyScale,
  canSubmitFocus,
  FOCUS_ZONES,
  focusHint,
  focusSummary,
  INERT_SLUGS,
  litSlugs,
  NOTHING_CHOSEN,
  selectionFromAreas,
  toggleFocus,
  WHOLE_BODY,
  zoneForSlug,
  type BodySide,
  type BodySlug,
  type FocusSelection,
} from '../../src/client/focus-form'

const EXPIRED = 'Tu sesión venció. Vuelve a entrar para guardar tu respuesta.'
// Two failures, two sentences: one happens before the person has done anything,
// the other loses work they just did.
const READ_FAILED = 'No pudimos leer tus respuestas. Inténtalo otra vez.'
const SAVE_FAILED = 'No pudimos guardar tu respuesta. Inténtalo otra vez.'

/** Keeps the button off the very bottom edge, the same amount on every step. */
const FOOTER_LIFT = 16

/** Everything above the map: header, title, lede, chips, hint and button. */
const CHROME_HEIGHT = 600

export default function OnboardingFocus() {
  const router = useRouter()
  const theme = useTheme()
  const { height } = useWindowDimensions()
  const flow = useMemo(() => createSpaceOnboardingFlow(), [])

  const [selection, setSelection] = useState<FocusSelection>(NOTHING_CHOSEN)
  const [declaredSex, setDeclaredSex] = useState<'male' | 'female' | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  const gender = bodyGender(declaredSex)
  const scale = bodyScale(Math.max(0, height - CHROME_HEIGHT))

  useEffect(() => {
    let active = true

    flow
      .resume()
      .then((current) => {
        if (!active) return
        // Only backwards: a missing prerequisite cannot be skipped, but an answer
        // already given is editable, which is what the back arrow is for.
        const owed = guardStep('/onboarding/focus', current)
        if (owed) {
          router.replace(owed)
          return
        }
        setDeclaredSex(current.answers.biological_sex.value ?? null)
        setSelection(selectionFromAreas(current.answers.focus_areas.value))
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
  const submittable = canSubmitFocus({ selection, submitting, sessionExpired })
  const hint = focusHint(selection)

  const submit = async () => {
    setSubmitting(true)
    setFailure(undefined)
    try {
      // The whole set, not the change: a zone the person turned off is withdrawn
      // by not being here.
      await flow.declareFocusAreas(areasFor(selection))
      router.replace(nextRouteAfter('/onboarding/focus'))
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

  const choose = useCallback(
    (choice: Parameters<typeof toggleFocus>[1]) => {
      if (!pressable) return
      setSelection((current) => toggleFocus(current, choice))
    },
    [pressable],
  )

  // Both faces are memoised, so their props have to keep their identity or the memo
  // never hits and every tap redraws the face nobody touched.
  const litFront = useMemo(() => litSlugs(selection, 'front'), [selection])
  const litBack = useMemo(() => litSlugs(selection, 'back'), [selection])
  const pressFront = useCallback(
    (slug: BodySlug) => {
      const zone = zoneForSlug(slug, 'front')
      if (zone) choose(zone)
    },
    [choose],
  )
  const pressBack = useCallback(
    (slug: BodySlug) => {
      const zone = zoneForSlug(slug, 'back')
      if (zone) choose(zone)
    },
    [choose],
  )

  const face = (side: BodySide) => (
    <View style={styles.face}>
      <BodyFigure
        side={side}
        gender={gender}
        scale={scale}
        lit={side === 'front' ? litFront : litBack}
        // Inert through the figure rather than the library's `disabledParts`, which
        // hardcodes a bone white with no prop to override it.
        inert={INERT_SLUGS}
        onPressSlug={side === 'front' ? pressFront : pressBack}
      />
      <Text role="body" size="xs" color="muted" style={styles.faceName}>
        {side === 'front' ? 'FRENTE' : 'ESPALDA'}
      </Text>
    </View>
  )

  return (
    <Screen edges={['top', 'bottom']}>
      <AmbientBackdrop />
      <OnboardingHeader step="/onboarding/focus" />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text role="display" size="4xl" uppercase accessibilityRole="header">
          ¿En qué te{'\n'}quieres centrar?
        </Text>
        <Text role="body" size="md" color="secondary" style={styles.lede}>
          Señala lo que más te importa. Es un énfasis: el resto del cuerpo sigue entrando.
        </Text>

        <View style={styles.summary}>
          <Text role="body" size="xs" color="muted">
            FRENTE Y ESPALDA
          </Text>
          <Text role="body" size="xs" color={selection.zones.length ? 'accent' : 'muted'}>
            {focusSummary(selection)}
          </Text>
        </View>

        {/* Aligned on the feet: the library renders both sexes and both faces into
            the same 400×200 box, so one scale is all it takes. */}
        <View style={styles.faces}>
          {face('front')}
          {face('back')}
        </View>

        <View style={styles.chips}>
          {FOCUS_ZONES.map((entry) => {
            const on = selection.zones.includes(entry.zone)
            return (
              <Pressable
                key={entry.zone}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: !pressable }}
                accessibilityLabel={entry.name}
                disabled={!pressable}
                onPress={() => choose(entry.zone)}
                hitSlop={8}
                style={[
                  styles.chip,
                  {
                    borderColor: on ? theme.color.border.accent : theme.color.border.subtle,
                    backgroundColor: on
                      ? theme.color.accent.tonal
                      : theme.color.background.surfaceSubtle,
                  },
                ]}
              >
                <View
                  style={[
                    styles.dot,
                    {
                      backgroundColor: on ? theme.color.border.accent : theme.color.border.default,
                    },
                  ]}
                />
                <Text role="body" size="sm" color={on ? 'accent' : 'secondary'}>
                  {entry.name}
                </Text>
              </Pressable>
            )
          })}
        </View>

        {/* Set apart from the zones on purpose: it is an answer of another kind,
            not the eighth zone of the body. */}
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selection.whole, disabled: !pressable }}
          accessibilityLabel="Todo el cuerpo"
          disabled={!pressable}
          onPress={() => choose(WHOLE_BODY)}
          style={[
            styles.whole,
            {
              borderColor: selection.whole ? theme.color.border.accent : theme.color.border.default,
              backgroundColor: selection.whole
                ? theme.color.accent.tonal
                : theme.color.background.surfaceSubtle,
            },
          ]}
        >
          <Text role="body" size="sm" color={selection.whole ? 'accent' : 'secondary'}>
            Todo el cuerpo
          </Text>
        </Pressable>

        {hint ? (
          <Text role="body" size="xs" color="muted" style={styles.hint}>
            {hint}
          </Text>
        ) : null}
      </ScrollView>

      {/* Outside the scroll so the button sits in the same place on every step of
          the onboarding, whatever the content above it does. */}
      <View style={styles.footer}>
        {failure ? <InlineAlert message={failure} /> : null}

        <Button
          label="Continuar"
          disabled={!submittable}
          loading={submitting}
          onPress={submit}
          style={styles.submit}
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
  content: { paddingBottom: 4 },
  footer: { paddingTop: 4, paddingBottom: FOOTER_LIFT },
  lede: { marginTop: 9 },
  summary: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  faces: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', gap: 4 },
  face: { alignItems: 'center' },
  faceName: { marginTop: 3, letterSpacing: 1.6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1.5,
    borderRadius: 999,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  whole: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderRadius: 999,
    marginTop: 8,
  },
  hint: { marginTop: 11 },
  submit: { marginTop: 10 },
  signIn: { marginTop: 10 },
})
