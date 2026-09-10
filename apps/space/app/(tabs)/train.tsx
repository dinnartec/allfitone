/**
 * E-2 · Entrenar · rutinas del programa — `HU-SP-040` y `HU-SP-089`.
 *
 * Two taps from opening the app to training: Entrenar, then Empezar. That is the
 * whole point of this screen. Everything else on it exists to make those two taps
 * land on the right routine.
 *
 * **The week is the unit and the day is a suggestion.** The list is this calendar
 * week's routines, all of them startable today, in the order the programme wrote
 * them. One is marked as the one to follow; marking is all it does.
 *
 * **A routine already done keeps its place and offers to be done again.** Hiding it
 * would be telling somebody they cannot do what they are about to do anyway, and
 * the repeat is another attempt that leaves the first one's credit alone.
 *
 * **Somebody with no programme lands on the catalogue instead.** This screen has
 * nothing honest to show them, and an empty state with a button to somewhere else
 * is a worse version of just going there.
 */

import { Button } from '@allfitone/react-native/button'
import { Screen } from '@allfitone/react-native/screen'
import { Sheet } from '@allfitone/react-native/sheet'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { FoundationIcon, type IconName } from '@allfitone/react-native/icons'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { ApiError } from '../../src/client'
import { createSpaceExecutionFlow } from '../../src/client/execution-transport'
import { createSpaceProgramFlow } from '../../src/client/programs-transport'
import type { MyProgram, WeekPlan } from '../../src/client/programs'
import {
  actionLabel,
  cardsFor,
  routineCaption,
  weekProgress,
  type RoutineCard,
} from '../../src/client/week-plan'
import { deviceTimezone } from '../../src/client/timezone'
import { DOCK_HEIGHT } from '../../src/components/tab-bar'

const EXPIRED = 'Tu sesión venció. Vuelve a entrar para continuar.'
const READ_FAILED = 'No pudimos cargar tu semana. Inténtalo otra vez.'
const START_FAILED = 'No pudimos empezar la sesión. Inténtalo otra vez.'
const ORDER_FAILED = 'No pudimos guardar el orden. Inténtalo otra vez.'

/** Tall enough for the name and the line under it, and the same for every row. */
const PROGRAM_ROW = 62

export default function Train() {
  const router = useRouter()
  const theme = useTheme()
  const programs = useMemo(() => createSpaceProgramFlow(), [])
  const training = useMemo(() => createSpaceExecutionFlow(), [])
  const timezone = useMemo(() => deviceTimezone(), [])

  const [plan, setPlan] = useState<WeekPlan | undefined>(undefined)
  const [mine, setMine] = useState<readonly MyProgram[]>([])
  const [choosing, setChoosing] = useState(false)
  const [starting, setStarting] = useState<string | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  const load = useCallback(() => {
    programs
      .readWeekPlan(timezone)
      .then((week) => {
        setPlan(week)
        return programs.readMyPrograms()
      })
      .then(setMine)
      .catch((cause: unknown) => {
        if (cause instanceof ApiError && cause.failure === 'unauthenticated') {
          setFailure(EXPIRED)
          return
        }
        // No programme is not an error state: it is the catalogue.
        if (cause instanceof ApiError && cause.failure === 'not-found') {
          router.replace('/programs')
          return
        }
        setFailure(READ_FAILED)
      })
  }, [programs, timezone, router])

  useEffect(load, [load])

  const cards = cardsFor(plan)
  const progress = weekProgress(plan)

  const start = (card: RoutineCard) => {
    const open = card.routine.open_execution_id
    if (open) {
      router.push(`/session/${open}`)
      return
    }
    setStarting(card.routine.planned_session_id)
    training
      .start(card.routine.planned_session_id, timezone)
      .then((id) => router.push(`/session/${id}`))
      .catch(() => setFailure(START_FAILED))
      .finally(() => setStarting(undefined))
  }

  /**
   * Choosing a programme, expressed as the order command that already exists.
   *
   * `OP-PLN-024` says the first assignment is the one this tab opens on, so selecting
   * one is putting it in front and leaving the rest as they were. There is no separate
   * "current programme" to write, and inventing one would be a second source of truth
   * for a question the order already answers.
   */
  const select = (assignmentId: string) => {
    const chosen = mine.find((program) => program.assignment_id === assignmentId)
    if (!chosen || chosen.assignment_id === mine[0]?.assignment_id) {
      setChoosing(false)
      return
    }
    reorder([
      assignmentId,
      ...mine.filter((one) => one.assignment_id !== assignmentId).map((one) => one.assignment_id),
    ])
    setChoosing(false)
  }

  const reorder = (assignmentIds: readonly string[]) => {
    // Shown in the new order at once, then written. Waiting for the round trip would
    // make the row snap back under the finger that just chose it.
    setMine((current) =>
      assignmentIds
        .map((id) => current.find((program) => program.assignment_id === id))
        .filter((program): program is MyProgram => program !== undefined),
    )
    programs
      .reorder(assignmentIds)
      .then((ordered) => {
        setMine(ordered)
        // The tab opens on the first one, so the week has to follow the order.
        return programs.readWeekPlan(timezone)
      })
      .then(setPlan)
      .catch(() => setFailure(ORDER_FAILED))
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heading}>
          <Text role="display" size="2xl" uppercase accessibilityRole="header">
            Entrenar
          </Text>
          <Text role="body" size="sm" color="muted">
            Elige la rutina de hoy. El orden es sugerencia.
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cambiar de programa"
          onPress={() => setChoosing(true)}
          style={[
            styles.selector,
            {
              backgroundColor: theme.color.background.surface,
              borderColor: theme.color.border.subtle,
            },
          ]}
        >
          <View style={styles.selectorText}>
            <Text role="eyebrow" size="2xs" color="muted">
              PROGRAMA
            </Text>
            <Text role="display" size="lg" uppercase numberOfLines={1}>
              {plan?.program_title ?? '—'}
            </Text>
          </View>
          {plan ? (
            <Text role="body" size="xs" color="muted">
              {`semana ${plan.program_week}`}
            </Text>
          ) : null}
          <FoundationIcon name="expand" size="xs" color={theme.color.icon.secondary} decorative />
        </Pressable>

        {progress.planned > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text role="eyebrow" size="xs" color="muted">
                ESTA SEMANA
              </Text>
              <Text role="display" size="md">
                {`${progress.done} de ${progress.planned}`}
              </Text>
            </View>
            <View style={styles.bars}>
              {cards.map((card) => (
                <View
                  key={card.routine.planned_session_id}
                  style={[
                    styles.bar,
                    {
                      backgroundColor: card.routine.done
                        ? theme.color.action.primary
                        : theme.color.background.surfaceMuted,
                    },
                  ]}
                />
              ))}
            </View>
          </View>
        ) : null}

        {failure ? <InlineAlert message={failure} /> : null}

        <View style={styles.section}>
          <Text role="eyebrow" size="xs" color="muted">
            RUTINAS DE ESTE PROGRAMA
          </Text>
          {cards.map((card) => (
            <Routine
              key={card.routine.planned_session_id}
              card={card}
              busy={starting === card.routine.planned_session_id}
              onStart={() => start(card)}
            />
          ))}
        </View>

        <View style={styles.section}>
          <Text role="eyebrow" size="xs" color="muted">
            O SI PREFIERES
          </Text>
          <Alternative
            icon="checklist"
            label="Ver los de Allfit"
            caption="para tomar otro programa"
            onPress={() => router.push('/programs')}
          />
        </View>
      </ScrollView>

      <Sheet visible={choosing} onDismiss={() => setChoosing(false)} title="Tus programas">
        <View style={styles.programs}>
          <Text role="body" size="sm" color="muted">
            Toca el que quieras entrenar. Esta pestaña se abre en el que elijas.
          </Text>
          {mine.map((program) => (
            <MyProgramRow
              key={program.assignment_id}
              program={program}
              active={program.program_version_id === plan?.program_version_id}
              onPress={() => select(program.assignment_id)}
            />
          ))}
          <Button
            label="Crear un programa"
            variant="secondary"
            icon="create"
            onPress={() => {
              setChoosing(false)
              router.push('/programs/new')
            }}
          />
          <Button
            label="Ver los de Allfit"
            variant="ghost"
            onPress={() => {
              setChoosing(false)
              router.push('/programs')
            }}
          />
        </View>
      </Sheet>
    </Screen>
  )
}

/** One routine of the week, and the one button that is the point of this screen. */
function Routine({
  card,
  busy,
  onStart,
}: {
  readonly card: RoutineCard
  readonly busy: boolean
  readonly onStart: () => void
}) {
  const theme = useTheme()
  const highlighted = card.state === 'suggested' || card.state === 'open'

  return (
    <View
      style={[
        styles.routine,
        {
          backgroundColor: theme.color.background.surface,
          borderColor: highlighted ? theme.color.accent.tonalBorder : theme.color.border.subtle,
          borderWidth: highlighted ? 1.5 : 1,
        },
      ]}
    >
      <View style={styles.routineText}>
        <View style={styles.routineHead}>
          <Text role="control" size="sm" numberOfLines={1} style={styles.routineTitle}>
            {card.routine.title}
          </Text>
          {card.state === 'suggested' ? <Badge label="SIGUE ESTA" tone="accent" /> : null}
          {card.state === 'open' ? <Badge label="A MEDIAS" tone="accent" /> : null}
          {card.state === 'done' ? <Badge label="HECHA" tone="success" /> : null}
        </View>
        <Text role="body" size="xs" color="muted">
          {routineCaption(card.routine)}
        </Text>
      </View>
      <Button
        label={actionLabel(card.state)}
        variant={highlighted ? 'primary' : 'secondary'}
        icon={card.state === 'done' ? 'history' : 'start'}
        onPress={onStart}
        loading={busy}
        style={styles.routineAction}
      />
    </View>
  )
}

function Badge({ label, tone }: { readonly label: string; readonly tone: 'accent' | 'success' }) {
  const theme = useTheme()
  const paint = tone === 'accent' ? theme.color.accent.tonal : theme.color.background.surfaceSubtle

  return (
    <View style={[styles.badge, { backgroundColor: paint }]}>
      <Text role="eyebrow" size="2xs" color={tone === 'accent' ? 'accent' : 'success'}>
        {label}
      </Text>
    </View>
  )
}

function MyProgramRow({
  program,
  active,
  onPress,
}: {
  readonly program: MyProgram
  readonly active: boolean
  readonly onPress: () => void
}) {
  const theme = useTheme()

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${program.title}, ${program.sessions_done} de ${program.sessions_planned} sesiones`}
      onPress={onPress}
      hitSlop={4}
      style={[
        styles.program,
        {
          backgroundColor: active ? theme.color.accent.tonal : theme.color.background.surfaceSubtle,
          borderColor: active ? theme.color.accent.tonalBorder : theme.color.border.subtle,
        },
      ]}
    >
      <View style={styles.routineText}>
        <Text role="display" size="md" uppercase numberOfLines={1}>
          {program.title}
        </Text>
        <Text role="body" size="xs" color="muted">
          {`${program.weeks} semanas · ${program.days_per_week} días · ${program.sessions_done} de ${program.sessions_planned}`}
        </Text>
      </View>
      {active ? (
        <FoundationIcon name="success" size="sm" color={theme.color.icon.accent} decorative />
      ) : null}
    </Pressable>
  )
}

function Alternative({
  icon,
  label,
  caption,
  onPress,
}: {
  readonly icon: IconName
  readonly label: string
  readonly caption: string
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
        { backgroundColor: theme.color.background.surface, borderColor: theme.color.border.subtle },
      ]}
    >
      <FoundationIcon name={icon} size="sm" color={theme.color.icon.secondary} decorative />
      <Text role="control" size="xs" numberOfLines={1}>
        {label}
      </Text>
      <Text role="body" size="xs" color="muted">
        {caption}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  // The dock floats over the scroll, so the last section has to clear it.
  content: { gap: 18, paddingBottom: DOCK_HEIGHT + 40 },
  heading: { gap: 4 },
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 58,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
  },
  selectorText: { flex: 1, gap: 2 },
  section: { gap: 10 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bars: { flexDirection: 'row', gap: 6 },
  bar: { flex: 1, height: 6, borderRadius: 3 },
  routine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 72,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  routineText: { flex: 1, gap: 3 },
  routineHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  routineTitle: { flexShrink: 1 },
  routineAction: { paddingHorizontal: 0, minWidth: 106 },
  badge: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  programs: { gap: 10, paddingBottom: 8 },
  program: {
    minHeight: PROGRAM_ROW,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 13,
  },
  alternative: { gap: 3, minHeight: 70, borderRadius: 16, borderWidth: 1, padding: 14 },
})
