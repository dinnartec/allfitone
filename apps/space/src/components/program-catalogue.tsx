/**
 * El catálogo de Allfit — `HU-SP-100`.
 *
 * Reached from "Ver los de Allfit", and it is where the Entrenar tab sends somebody
 * who has nothing of their own yet. It asks the one thing
 * the onboarding never asked — how many days a week you can actually train — and
 * answers with the three programs for that frequency.
 *
 * **The question is the filter.** A row of chips would have been the same control
 * with none of the meaning; asking it out loud is what makes the answer feel like a
 * choice rather than a facet. The frequency starts on what the person's declared
 * experience suggests, so the screen opens already answered and moving it is a
 * correction rather than a first decision.
 *
 * `Rutinas` is the person's own content, which `HU-SP-042`..`050` build. It is shown
 * because the segmented control is a promise about what this tab holds, and pressing
 * it says which screen it is waiting on rather than opening an empty list.
 *
 * `Ver todos ›` **expands the list in place**. It was a second screen with the same
 * cards, the same filters and a different header — a shelf beside a shortcut that
 * held the same books. One list that grows is one thing to keep right.
 *
 * **It is a component, not only a route, because Entrenar becomes it.** Somebody with
 * no programme has nothing to show on that tab, and the tab used to answer by replacing
 * itself with `/programs` — which replaced the whole tab navigator on the root stack,
 * so the dock vanished and going back had nowhere to go. Drawing the catalogue inside
 * the tab keeps that promise without a tab ever navigating out of its own navigator.
 */

import { IconButton } from '@allfitone/react-native/icon-button'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { FoundationIcon, type IconName } from '@allfitone/react-native/icons'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { ApiError } from '../client'
import { createSpaceProgramFlow } from '../client/programs-transport'
import type { ProgramCatalogue as Catalogue } from '../client/programs'
import {
  applyFilter,
  cardsFor,
  FREQUENCIES,
  suggestedFrequency,
  type ProgramSummary,
  type TrainingProfile,
} from '../client/program-catalogue'
import { ProgramCard } from './program-card'
import { DOCK_HEIGHT } from './tab-bar'

const EXPIRED = 'Tu sesión venció. Vuelve a entrar para continuar.'
const READ_FAILED = 'No pudimos cargar los programas. Inténtalo otra vez.'

/** As many as the canvas shows: this screen is the shortcut, not the shelf. */
const SHOWN = 3

const EMPTY_PROFILE: TrainingProfile = {
  given_name: '',
  primary_training_goal: null,
  training_experience: null,
  biological_sex: null,
  focus_areas: [],
}

export function ProgramCatalogue({ embedded = false }: { readonly embedded?: boolean }) {
  const router = useRouter()
  const theme = useTheme()
  const flow = useMemo(() => createSpaceProgramFlow(), [])

  const [catalogue, setCatalogue] = useState<Catalogue | undefined>(undefined)
  const [days, setDays] = useState<number | undefined>(undefined)
  const [expanded, setExpanded] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useEffect(() => {
    let active = true

    flow
      .readCatalogue()
      .then((current) => {
        if (!active) return
        setCatalogue(current)
        // Opens already answered: the level suggests a frequency, and moving it is a
        // correction rather than a first decision.
        setDays(suggestedFrequency(current.profile.training_experience))
      })
      .catch((cause: unknown) => {
        if (!active) return
        setFailure(
          cause instanceof ApiError && cause.failure === 'unauthenticated' ? EXPIRED : READ_FAILED,
        )
      })

    return () => {
      active = false
    }
  }, [flow])

  const profile = catalogue?.profile ?? EMPTY_PROFILE
  const programs = catalogue?.programs ?? []
  // The chip filters the whole catalogue, not the person's own band. Their band holds
  // exactly one program per frequency, so filtering inside it would answer a question
  // about how many days with a list of one.
  const suggested = useMemo(
    () => new Set(cardsFor(programs, profile).map((card) => card.program.program_version_id)),
    [programs, profile],
  )
  const matching = useMemo(
    () => (days === undefined ? programs : applyFilter(`days:${days}`, programs, profile)),
    [days, programs, profile],
  )
  const shown = useMemo(
    () =>
      (expanded ? matching : matching.slice(0, SHOWN)).map((program) => ({
        program,
        suggested: suggested.has(program.program_version_id),
      })),
    [expanded, matching, suggested],
  )

  const open = (program: ProgramSummary) => router.push(`/programs/${program.program_version_id}`)

  return (
    <Screen edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={[styles.content, embedded ? styles.embedded : styles.pushed]}
        showsVerticalScrollIndicator={false}
      >
        {/* No back arrow inside the tab: there is nothing behind it, and the dock is
            already the way out. */}
        <View style={styles.top}>
          {embedded ? null : (
            <IconButton icon="back" accessibilityLabel="Volver" onPress={() => router.back()} />
          )}
          <View style={styles.heading}>
            <Text role="display" size="2xl" uppercase accessibilityRole="header">
              Los de Allfit
            </Text>
            <Text role="body" size="sm" color="muted">
              Programas escritos para tu objetivo y tu nivel.
            </Text>
          </View>
        </View>

        <View
          style={[
            styles.segmented,
            {
              backgroundColor: theme.color.background.surfaceSubtle,
              borderColor: theme.color.border.subtle,
            },
          ]}
        >
          <Segment label="Programas" active />
          <Segment label="Rutinas" active={false} onPress={() => router.push('/routines/new')} />
        </View>

        <View style={styles.section}>
          <Text role="eyebrow" size="2xs" color="muted">
            PARA EMPEZAR
          </Text>
          <Text role="control" size="md">
            ¿Cuántos días por semana puedes entrenar?
          </Text>
          <View style={styles.days}>
            {FREQUENCIES.map((frequency) => {
              const on = frequency === days
              return (
                <Pressable
                  key={frequency}
                  accessibilityRole="button"
                  accessibilityLabel={`${frequency} días por semana`}
                  accessibilityState={{ selected: on }}
                  onPress={() => setDays(frequency)}
                  style={[
                    styles.day,
                    {
                      backgroundColor: on
                        ? theme.color.accent.tonal
                        : theme.color.background.surface,
                      borderColor: on ? theme.color.border.accent : theme.color.border.subtle,
                      borderWidth: on ? 1.5 : 1,
                    },
                  ]}
                >
                  <Text role="control" size="sm" color={on ? 'accent' : 'secondary'}>
                    {`${frequency} días`}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </View>

        {failure ? <InlineAlert message={failure} /> : null}

        <View style={styles.sectionHeader}>
          <Text role="eyebrow" size="2xs" color="muted">
            SUGERIDOS PARA TI
          </Text>
          {matching.length > SHOWN ? (
            <Text
              role="control"
              size="xs"
              color="accent"
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              onPress={() => setExpanded((open) => !open)}
            >
              {expanded ? 'Ver menos ‹' : 'Ver todos ›'}
            </Text>
          ) : null}
        </View>

        <View style={styles.cards}>
          {shown.map((card) => (
            <ProgramCard
              key={card.program.program_version_id}
              program={card.program}
              suggested={card.suggested}
              busy={false}
              disabled={false}
              onPress={() => open(card.program)}
            />
          ))}
        </View>

        {catalogue !== undefined && shown.length === 0 ? (
          <Text role="body" size="sm" color="muted">
            No hay programas de esa frecuencia para tu objetivo todavía.
          </Text>
        ) : null}

        {catalogue === undefined && !failure ? (
          <Text role="body" size="sm" color="muted">
            Cargando programas…
          </Text>
        ) : null}

        <View style={styles.section}>
          <Text role="eyebrow" size="2xs" color="muted">
            O SI PREFIERES
          </Text>
          <View style={styles.alternatives}>
            {embedded ? null : (
              <Alternative
                icon="checklist"
                label="Ver las mías"
                hint="tu biblioteca"
                onPress={() => router.push('/train')}
              />
            )}
            <Alternative
              icon="add"
              label="Crear el mío"
              hint="desde cero"
              onPress={() => router.push('/programs/new')}
            />
          </View>
          <Text role="body" size="sm" color="muted">
            Nunca estás obligado a elegir uno.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  )
}

function Segment({
  label,
  active,
  onPress,
}: {
  readonly label: string
  readonly active: boolean
  readonly onPress?: () => void
}) {
  const theme = useTheme()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      disabled={active}
      onPress={onPress}
      style={[styles.segment, active ? { backgroundColor: theme.color.action.primary } : null]}
    >
      <Text
        role="control"
        size="sm"
        color="secondary"
        style={active ? { color: theme.color.action.onPrimary } : null}
      >
        {label}
      </Text>
    </Pressable>
  )
}

function Alternative({
  icon,
  label,
  hint,
  onPress,
}: {
  readonly icon: IconName
  readonly label: string
  readonly hint: string
  readonly onPress: () => void
}) {
  const theme = useTheme()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${hint}`}
      onPress={onPress}
      style={[
        styles.alternative,
        {
          backgroundColor: theme.color.background.surface,
          borderColor: theme.color.border.subtle,
        },
      ]}
    >
      <FoundationIcon name={icon} size="sm" color={theme.color.icon.secondary} decorative />
      <Text role="control" size="sm">
        {label}
      </Text>
      <Text role="body" size="xs" color="muted">
        {hint}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  content: { gap: 18 },
  pushed: { paddingBottom: 40 },
  // The dock floats over the scroll, so the last section has to clear it.
  embedded: { paddingBottom: DOCK_HEIGHT + 40 },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  heading: { flex: 1, gap: 4 },
  segmented: { flexDirection: 'row', borderRadius: 22, borderWidth: 1, padding: 3, gap: 3 },
  segment: {
    flex: 1,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { gap: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  days: { flexDirection: 'row', gap: 9 },
  day: { flex: 1, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cards: { gap: 12 },
  alternatives: { flexDirection: 'row', gap: 10 },
  alternative: {
    flex: 1,
    minHeight: 70,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 4,
  },
})
