/**
 * Programas · ver todos — `HU-SP-100` criterion 5.
 *
 * The whole catalogue, not just what was suggested. The first screen offers three
 * frequencies for one goal and one level; this is where somebody who wants something
 * else goes, and without it "puedo ver el catálogo completo" would be a promise the
 * app does not keep.
 *
 * **The filters are derived, never hardcoded.** A frequency nobody publishes must not
 * be offerable and one published later must appear without anybody remembering to add
 * it here. `Sugeridos` is the same set the first screen shows, computed by the same
 * function, so the two screens cannot disagree about what "for you" means.
 *
 * The lede states the two facts that make this catalogue what it is: Allfit published
 * it, and nobody administers it. `OP-PLN-011` says a personal assignment has no
 * manager, and somebody choosing here deserves to know that before they choose.
 */

import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { ApiError } from '../src/client'
import { createSpaceProgramFlow } from '../src/client/programs-transport'
import type { ProgramCatalogue } from '../src/client/programs'
import {
  applyFilter,
  cardsFor,
  filtersFor,
  type ProgramSummary,
  type TrainingProfile,
} from '../src/client/program-catalogue'
import { ProgramCard } from '../src/components/program-card'
import { DOCK_HEIGHT, TabBar, type TabKey } from '../src/components/tab-bar'

const EXPIRED = 'Tu sesión venció. Vuelve a entrar para continuar.'
const READ_FAILED = 'No pudimos cargar los programas. Inténtalo otra vez.'
const CHOOSE_FAILED = 'No pudimos guardar tu programa. Inténtalo otra vez.'

const EMPTY_PROFILE: TrainingProfile = {
  given_name: '',
  primary_training_goal: null,
  training_experience: null,
  biological_sex: null,
  focus_areas: [],
}

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export default function Programs() {
  const router = useRouter()
  const theme = useTheme()
  const flow = useMemo(() => createSpaceProgramFlow(), [])

  const [catalogue, setCatalogue] = useState<ProgramCatalogue | undefined>(undefined)
  const [filter, setFilter] = useState('suggested')
  const [choosing, setChoosing] = useState<string | undefined>(undefined)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [pending, setPending] = useState<string | undefined>(undefined)

  useEffect(() => {
    let active = true

    flow
      .readCatalogue()
      .then((current) => {
        if (active) setCatalogue(current)
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
  }, [flow])

  const profile = catalogue?.profile ?? EMPTY_PROFILE
  const programs = catalogue?.programs ?? []
  const filters = useMemo(() => filtersFor(programs), [programs])
  const shown = useMemo(() => applyFilter(filter, programs, profile), [filter, programs, profile])
  const suggested = useMemo(
    () => new Set(cardsFor(programs, profile).map((card) => card.program.program_version_id)),
    [programs, profile],
  )

  const choose = async (program: ProgramSummary) => {
    setChoosing(program.program_version_id)
    setFailure(undefined)
    try {
      await flow.choose({
        program_version_id: program.program_version_id,
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
      setChoosing(undefined)
    }
  }

  const navigate = (tab: TabKey) => {
    if (tab === 'today') router.replace('/today')
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver"
          onPress={() => router.replace('/today')}
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

        <View style={styles.heading}>
          <Text role="display" size="4xl" uppercase accessibilityRole="header">
            Programas
          </Text>
          <Text role="body" size="sm" color="muted">
            Publicados por Allfit. Ninguno tiene profesional a cargo: lo administras tú.
          </Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          {filters.map((candidate) => {
            const on = candidate.key === filter
            return (
              <Pressable
                key={candidate.key}
                accessibilityRole="button"
                accessibilityLabel={candidate.label}
                accessibilityState={{ selected: on }}
                onPress={() => setFilter(candidate.key)}
                style={[
                  styles.filter,
                  {
                    backgroundColor: on
                      ? theme.color.action.primary
                      : theme.color.background.surface,
                    borderColor: on ? theme.color.action.primary : theme.color.border.subtle,
                  },
                ]}
              >
                <Text
                  role="label"
                  size="xs"
                  color="secondary"
                  style={on ? { color: theme.color.action.onPrimary } : null}
                >
                  {candidate.label}
                </Text>
              </Pressable>
            )
          })}
        </ScrollView>

        {failure ? <InlineAlert message={failure} /> : null}

        <View style={styles.cards}>
          {shown.map((program) => (
            <ProgramCard
              key={program.program_version_id}
              program={program}
              suggested={suggested.has(program.program_version_id)}
              badge="SUGERIDO"
              busy={choosing === program.program_version_id}
              disabled={choosing !== undefined || sessionExpired}
              onPress={() => void choose(program)}
            />
          ))}
        </View>

        {catalogue !== undefined && shown.length === 0 ? (
          <Text role="body" size="sm" color="muted">
            No hay programas con ese filtro todavía.
          </Text>
        ) : null}

        {catalogue === undefined && !failure ? (
          <Text role="body" size="sm" color="muted">
            Cargando programas…
          </Text>
        ) : null}

        {pending ? (
          <Text role="body" size="sm" color="muted">
            {pending}
          </Text>
        ) : null}
      </ScrollView>

      <TabBar active="train" onPending={setPending} onNavigate={navigate} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: 18, paddingBottom: DOCK_HEIGHT + 40 },
  back: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: { gap: 8 },
  filters: { flexDirection: 'row', gap: 8, paddingRight: 24 },
  filter: { borderRadius: 999, borderWidth: 1.5, paddingHorizontal: 13, paddingVertical: 7 },
  cards: { gap: 12 },
})
