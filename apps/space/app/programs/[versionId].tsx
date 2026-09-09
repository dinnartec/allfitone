/**
 * P-2 · Programa · detalle y asignación — `HU-SP-100`.
 *
 * Choosing used to happen on the card. It shouldn't: somebody about to hand eight
 * weeks of their life to a program deserves to see every session in it first, and
 * "8 semanas · 3 días" is a summary, not the content. The card now opens this, and
 * this is where the commitment is made.
 *
 * **The split, not the calendar.** A twelve-week program composes sixty sessions out
 * of five templates; what is being chosen is the five, so the days shown are the
 * distinct days of the first week.
 *
 * The estimate carries a `~` because it is one. Nothing in the catalogue records
 * rest between sets or the pace somebody runs at, so `estimatedMinutes` assumes two
 * coefficients and names them where they are. A number without the tilde would be a
 * number somebody trusts.
 *
 * The footer says where the program goes, because "tomar" is otherwise ambiguous: it
 * lands on the agenda and starts from Hoy.
 *
 * The button is the Design System's, icon and all. A hand-rolled one was tried and
 * came with Barlow Condensed at the display role, whose negative tracking made the
 * label read cramped beside every other button in the app — the component decides
 * how an action looks, and going around it is how two buttons stop matching.
 */

import { Button } from '@allfitone/react-native/button'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { FoundationIcon, type IconName } from '@allfitone/react-native/icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { ApiError } from '../../src/client'
import { createSpaceProgramFlow } from '../../src/client/programs-transport'
import { deviceTimezone } from '../../src/client/timezone'
import type { ProgramDetail } from '../../src/client/programs'
import {
  estimatedMinutes,
  LEVEL_LABEL,
  targetLabel,
  type ProgramDay,
} from '../../src/client/program-catalogue'
import { ZONE_LABEL } from '../../src/components/program-card'

const EXPIRED = 'Tu sesión venció. Vuelve a entrar para continuar.'
const READ_FAILED = 'No pudimos cargar este programa. Inténtalo otra vez.'
const NOT_FOUND = 'Este programa ya no está disponible.'
const CHOOSE_FAILED = 'No pudimos guardar tu programa. Inténtalo otra vez.'

export default function ProgramVersion() {
  const router = useRouter()
  const theme = useTheme()
  const { versionId } = useLocalSearchParams<{ versionId: string }>()
  const flow = useMemo(() => createSpaceProgramFlow(), [])

  const [detail, setDetail] = useState<ProgramDetail | undefined>(undefined)
  const [choosing, setChoosing] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!versionId) return
    let active = true

    flow
      .readDetail(versionId)
      .then((current) => {
        if (active) setDetail(current)
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof ApiError && cause.failure === 'unauthenticated') {
          setSessionExpired(true)
          setFailure(EXPIRED)
          return
        }
        setFailure(
          cause instanceof ApiError && cause.failure === 'not-found' ? NOT_FOUND : READ_FAILED,
        )
      })

    return () => {
      active = false
    }
  }, [flow, versionId])

  const take = async () => {
    if (!detail) return
    setChoosing(true)
    setFailure(undefined)
    try {
      await flow.choose({
        program_version_id: detail.program_version_id,
        timezone: deviceTimezone(),
      })
      router.replace('/today')
    } catch (cause: unknown) {
      if (cause instanceof ApiError && cause.failure === 'unauthenticated') {
        setSessionExpired(true)
        setFailure(EXPIRED)
      } else {
        setFailure(CHOOSE_FAILED)
      }
    } finally {
      setChoosing(false)
    }
  }

  const level = detail
    ? (['starting', 'some_practice', 'experienced'] as const).find((candidate) =>
        detail.levels.includes(candidate),
      )
    : undefined

  return (
    <Screen edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver"
          onPress={() => router.back()}
          style={[
            styles.back,
            {
              backgroundColor: theme.color.background.surface,
              borderColor: theme.color.border.subtle,
            },
          ]}
        >
          <FoundationIcon name="back" size="sm" color={theme.color.icon.primary} decorative />
        </Pressable>

        {failure ? <InlineAlert message={failure} /> : null}

        {detail ? (
          <>
            <View style={styles.heading}>
              <Text role="eyebrow" size="2xs" color="accent">
                PROGRAMA DE ALLFIT
              </Text>
              <Text role="display" size="4xl" uppercase accessibilityRole="header">
                {detail.title}
              </Text>
            </View>

            <View style={styles.meta}>
              <Meta icon="calendar" label={`${detail.weeks} semanas`} />
              <Meta icon="frequency" label={`${detail.days_per_week} días/semana`} />
              {level ? <Meta icon="level" label={LEVEL_LABEL[level]} /> : null}
            </View>

            <View style={styles.zones}>
              {detail.emphases.map((zone) => (
                <View
                  key={zone}
                  style={[
                    styles.zone,
                    {
                      backgroundColor: theme.color.accent.tonal,
                      borderColor: theme.color.accent.tonalBorder,
                    },
                  ]}
                >
                  <Text role="control" size="xs" color="accent">
                    {ZONE_LABEL[zone] ?? zone}
                  </Text>
                </View>
              ))}
            </View>

            {detail.notes ? (
              <Text role="body" size="sm" color="secondary">
                {detail.notes}
              </Text>
            ) : null}

            <Text role="eyebrow" size="2xs" color="muted">
              EL CONTENIDO COMPLETO
            </Text>

            {detail.days.map((day, index) => (
              <Day key={day.day} day={day} ordinal={index + 1} />
            ))}
          </>
        ) : null}

        {detail === undefined && !failure ? (
          <Text role="body" size="sm" color="muted">
            Cargando el programa…
          </Text>
        ) : null}
      </ScrollView>

      {detail ? (
        <View style={[styles.footer, { backgroundColor: theme.color.background.canvas }]}>
          <Button
            label="Tomar este programa"
            icon="check"
            loading={choosing}
            disabled={sessionExpired}
            onPress={() => void take()}
          />
          <Text role="body" size="sm" color="muted" align="center">
            Se añade a tu agenda y lo empiezas desde Hoy.
          </Text>
        </View>
      ) : null}
    </Screen>
  )
}

function Meta({ icon, label }: { readonly icon: IconName; readonly label: string }) {
  const theme = useTheme()

  return (
    <View style={styles.metaItem}>
      <FoundationIcon name={icon} size="xs" color={theme.color.icon.secondary} decorative />
      <Text role="control" size="xs" color="secondary">
        {label}
      </Text>
    </View>
  )
}

function Day({ day, ordinal }: { readonly day: ProgramDay; readonly ordinal: number }) {
  const theme = useTheme()
  const minutes = estimatedMinutes(day)

  return (
    <View style={styles.day}>
      <View style={styles.dayHeader}>
        <View
          style={[
            styles.dayBadge,
            {
              backgroundColor: theme.color.accent.tonal,
              borderColor: theme.color.accent.tonalBorder,
            },
          ]}
        >
          <Text role="display" size="sm" color="accent">
            {`D${ordinal}`}
          </Text>
        </View>
        <View style={styles.dayCopy}>
          <Text role="display" size="lg" uppercase>
            {day.title}
          </Text>
        </View>
        {minutes > 0 ? (
          <Text role="control" size="xs" color="secondary">
            {`~${minutes} min`}
          </Text>
        ) : null}
      </View>

      {day.steps.map((step) => (
        <View key={step.position} style={styles.step}>
          <Text role="control" size="2xs" color="muted" style={styles.stepNumber}>
            {step.position}
          </Text>
          <Text role="body" size="sm" style={styles.stepName}>
            {step.movement ?? '—'}
          </Text>
          <Text role="control" size="xs" color="accent">
            {targetLabel(step.target)}
          </Text>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  content: { gap: 14, paddingBottom: 130 },
  back: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: { gap: 4 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  zones: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  zone: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  day: { gap: 8 },
  dayHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dayBadge: {
    width: 34,
    height: 34,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCopy: { flex: 1 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepNumber: { width: 16 },
  stepName: { flex: 1 },
  // Anchored, because the decision must be reachable without scrolling to the end of
  // a twelve-week programme.
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 28,
    gap: 10,
  },
})
