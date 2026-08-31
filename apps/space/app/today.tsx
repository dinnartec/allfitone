/**
 * Hoy · el primer día — HU-SP-100.
 *
 * The first screen after the onboarding, and until now there was none: activation
 * left `Empezar hoy` with nowhere to go. This is where it goes.
 *
 * **The three cards are three frequencies**, not the three highest scores. Same goal
 * and same level, and the only thing that changes is how many days a week somebody
 * can commit — which is the one thing the onboarding never asked. A first cut of the
 * catalogue hung the frequency off each program instead, and somebody starting who
 * could train five days was offered content written for somebody advanced.
 *
 * Choosing is not an intention. `POST /space/v1/assignments` materialises the
 * calendar in the same transaction, so the person leaves with sessions rather than
 * with a preference — criterion 6 — and the count comes back as the evidence.
 *
 * **The shell is painted, and none of it leads anywhere yet.** The tab bar, the quick
 * accesses and the two alternatives are on the canvas and belong to screens that do
 * not exist — `HU-SP-090`, free training, building your own. They are rendered rather
 * than omitted, and pressing one says which screen it is waiting on instead of
 * navigating into nothing. A dead end that explains itself is not the empty screen
 * `HU-SP-090` criterion 3 forbids; a blank one would be.
 *
 * **Every icon comes from the Design System.** A first pass borrowed near misses —
 * `heart` for food, `add` for a camera, `forward` for a chevron — and the screen did
 * not look like the design it was built from. The ten that were missing were added to
 * `@allfitone/icons` instead, which is what DT-008 asks for: a product never decides
 * what an icon means, so what is absent gets created there and consumed from there.
 */

import { Button } from '@allfitone/react-native/button'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { FoundationIcon, type IconName } from '@allfitone/react-native/icons'

import { ApiError } from '../src/client'
import { createSpaceProgramFlow } from '../src/client/programs-transport'
import type { ProgramAssignment, ProgramCatalogue } from '../src/client/programs'
import {
  cardsFor,
  type ProgramSummary,
  type TrainingProfile,
} from '../src/client/program-catalogue'
import { longDateLabel } from '../src/client/week'
import { ProgramCard } from '../src/components/program-card'
import { DOCK_HEIGHT, TabBar, type TabKey } from '../src/components/tab-bar'

const EXPIRED = 'Tu sesión venció. Vuelve a entrar para continuar.'
const READ_FAILED = 'No pudimos cargar los programas. Inténtalo otra vez.'
const CHOOSE_FAILED = 'No pudimos guardar tu programa. Inténtalo otra vez.'

/** What a destination that does not exist yet answers, instead of a blank screen. */
const PENDING: Record<string, string> = {
  free: 'Entrenar libre llega con el registro de ejecución.',
  own: 'Crear tu propio programa llega con tu contenido personal.',
  routines: 'Tus rutinas llegan con tu contenido personal.',
  food: 'Comida llega con el registro de nutrición.',
  progress: 'Tu progreso llega con el historial.',
  notices: 'Tus avisos llegan con las notificaciones.',
}

/** The device's own zone. The server refuses to take a start date from a client. */
function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export default function Today() {
  const router = useRouter()
  const flow = useMemo(() => createSpaceProgramFlow(), [])

  const [catalogue, setCatalogue] = useState<ProgramCatalogue | undefined>(undefined)
  const [assignment, setAssignment] = useState<ProgramAssignment | null>(null)
  const [choosing, setChoosing] = useState<string | undefined>(undefined)
  const [pending, setPending] = useState<string | undefined>(undefined)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useEffect(() => {
    let active = true

    flow
      .readCatalogue()
      .then((current) => {
        if (!active) return
        setCatalogue(current)
        setAssignment(current.current_assignment)
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

  const profile: TrainingProfile = catalogue?.profile ?? {
    given_name: '',
    primary_training_goal: null,
    training_experience: null,
    biological_sex: null,
    focus_areas: [],
  }
  const programs = catalogue?.programs ?? []
  const cards = useMemo(() => cardsFor(programs, profile), [programs, profile])
  const today = useMemo(() => longDateLabel(new Date()), [])

  const navigate = (tab: TabKey) => {
    if (tab === 'train') router.push('/programs')
  }

  const choose = async (program: ProgramSummary) => {
    setChoosing(program.program_version_id)
    setFailure(undefined)
    try {
      setAssignment(
        await flow.choose({
          program_version_id: program.program_version_id,
          timezone: deviceTimezone(),
        }),
      )
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

  return (
    <Screen edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.greeting}>
            <Text role="display" size="2xl" uppercase accessibilityRole="header">
              {profile.given_name ? `Hola, ${profile.given_name}` : 'Hola'}
            </Text>
            <Text role="eyebrow" size="xs" color="muted">
              {today.toUpperCase()}
            </Text>
          </View>
          <Bell onPress={() => setPending(PENDING.notices ?? '')} />
        </View>

        {assignment ? (
          <Chosen assignment={assignment} />
        ) : (
          <View style={styles.heading}>
            <Text role="eyebrow" size="xs" color="accent">
              EMPIEZA POR AQUÍ
            </Text>
            <Text role="display" size="4xl" uppercase accessibilityRole="header">
              Elige tu programa
            </Text>
            <Text role="body" size="sm" color="secondary">
              Todavía no tienes ninguno. Estos tres encajan con lo que nos contaste.
            </Text>
          </View>
        )}

        {failure ? <InlineAlert message={failure} /> : null}

        {!assignment && cards.length > 0 ? (
          <View style={styles.cards}>
            {cards.map((card) => (
              <ProgramCard
                key={card.program.program_version_id}
                program={card.program}
                suggested={card.suggested}
                busy={choosing === card.program.program_version_id}
                disabled={choosing !== undefined || sessionExpired}
                onPress={() => void choose(card.program)}
              />
            ))}
          </View>
        ) : null}

        {!assignment && programs.length > cards.length ? (
          <Text
            role="body"
            size="sm"
            color="accent"
            accessibilityRole="button"
            onPress={() => router.push('/programs')}
          >
            Ver todos los programas ›
          </Text>
        ) : null}

        {sessionExpired ? (
          <Button label="Iniciar sesión" onPress={() => router.replace('/sign-in')} />
        ) : null}

        {catalogue === undefined && !failure ? (
          <Text role="body" size="sm" color="muted">
            Cargando programas…
          </Text>
        ) : null}

        <View style={styles.section}>
          <Text role="eyebrow" size="xs" color="muted">
            O SI PREFIERES
          </Text>
          <View style={styles.alternatives}>
            <Alternative
              icon="freestyle"
              label="Entrenar libre"
              onPress={() => setPending(PENDING.free)}
            />
            <Alternative
              icon="create"
              label="Crear el mío"
              onPress={() => setPending(PENDING.own)}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text role="eyebrow" size="xs" color="muted">
            ACCESOS RÁPIDOS
          </Text>
          <View style={styles.shortcuts}>
            <Shortcut icon="freestyle" label="Libre" onPress={() => setPending(PENDING.free)} />
            <Shortcut
              icon="checklist"
              label="Rutinas"
              onPress={() => setPending(PENDING.routines)}
            />
            <Shortcut icon="nutrition" label="Comida" onPress={() => setPending(PENDING.food)} />
            <Shortcut
              icon="progress"
              label="Progreso"
              onPress={() => setPending(PENDING.progress)}
            />
          </View>
        </View>

        {pending ? (
          <Text role="body" size="sm" color="muted">
            {pending}
          </Text>
        ) : null}
      </ScrollView>

      <TabBar active="today" onPending={setPending} onNavigate={navigate} />
    </Screen>
  )
}

function Chosen({ assignment }: { readonly assignment: ProgramAssignment }) {
  return (
    <View style={styles.heading}>
      <Text role="eyebrow" size="xs" color="accent">
        TU PROGRAMA
      </Text>
      <Text role="display" size="4xl" uppercase accessibilityRole="header">
        {assignment.title}
      </Text>
      {/* The count is the evidence that choosing produced a plan and not a preference. */}
      <Text role="body" size="sm" color="secondary">
        {`Empieza hoy, con ${assignment.sessions_planned} sesiones en tu agenda. Entrenar desde aquí llega en la siguiente pantalla.`}
      </Text>
    </View>
  )
}

/** One of the two ways out that are not a program. */
function Alternative({
  icon,
  label,
  onPress,
}: {
  readonly icon: IconName
  readonly label: string
  readonly onPress: () => void
}) {
  const theme = useTheme()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[
        styles.alternative,
        {
          backgroundColor: theme.color.background.surface,
          borderColor: theme.color.border.default,
        },
      ]}
    >
      <FoundationIcon name={icon} size="sm" color={theme.color.icon.accent} decorative />
      <Text role="label" size="xs" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  )
}

function Shortcut({
  icon,
  label,
  onPress,
}: {
  readonly icon: IconName
  readonly label: string
  readonly onPress: () => void
}) {
  const theme = useTheme()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[
        styles.shortcut,
        { backgroundColor: theme.color.background.surface, borderColor: theme.color.border.subtle },
      ]}
    >
      <FoundationIcon name={icon} size="md" color={theme.color.icon.accent} decorative />
      <Text role="label" size="xs">
        {label}
      </Text>
    </Pressable>
  )
}

function Bell({ onPress }: { readonly onPress: () => void }) {
  const theme = useTheme()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Tus avisos"
      onPress={onPress}
      style={[
        styles.bell,
        { backgroundColor: theme.color.background.surface, borderColor: theme.color.border.subtle },
      ]}
    >
      <FoundationIcon name="notification" size="sm" color={theme.color.icon.primary} decorative />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  // The dock floats over the scroll, so the last section has to clear it.
  content: { gap: 20, paddingBottom: DOCK_HEIGHT + 40 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  greeting: { flex: 1, gap: 4 },
  bell: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: { gap: 8 },
  cards: { gap: 12 },
  section: { gap: 10 },
  alternatives: { flexDirection: 'row', gap: 8 },
  alternative: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  shortcuts: { flexDirection: 'row', gap: 10 },
  shortcut: {
    flex: 1,
    height: 62,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
})
