/**
 * Hoy — HU-SP-100 y HU-SP-089.
 *
 * One route, two screens, because it is one question: what am I doing today.
 *
 * **Without a program it is `H-D · primer día`**: three cards, one per frequency, and
 * choosing is the only thing on offer. Same goal and same level, and the only thing
 * that changes is how many days a week somebody can commit — the one thing the
 * onboarding never asked.
 *
 * **With a program it is `H-D · oscuro con imagen`**: the session, the week behind it,
 * and one way in. The photograph is not decoration; it is what makes the session read
 * as today rather than as a row in a list, and the veil under it is the contrast the
 * type depends on.
 *
 * **Nothing on this screen is invented.** The canvas carries a time and a venue, a
 * calorie count and a per-session duration, and none of those exist: there are no
 * bookings, no nutrition tables, and no stored session length. They are left out
 * rather than filled with plausible numbers, which is the one thing a screen somebody
 * trusts must never do. The week is seven days ending today, in the person's zone —
 * not a calendar week, which would reset the count on a Monday nobody trained
 * differently.
 *
 * **Two blurred panels, against the Design System's budget of one.** The dock and the
 * bell both ask for glass on the canvas, and the bell is 42 points across; the cost is
 * a fraction of the dock's and the alternative — a solid chip on a photograph — reads
 * as a sticker. Worth knowing before a third one is added.
 */

import { Button } from '@allfitone/react-native/button'
import { GlassPanel } from '@allfitone/react-native/glass'
import { Scrim } from '@allfitone/react-native/gradient'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Image, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FoundationIcon, type IconName } from '@allfitone/react-native/icons'
import { semanticSpacing } from '@allfitone/react-native/tokens'

import { ApiError } from '../../src/client'
import { createSpaceExecutionFlow } from '../../src/client/execution-transport'
import type { Today as TodayPayload } from '../../src/client/execution'
import { createSpaceProgramFlow } from '../../src/client/programs-transport'
import type { ProgramCatalogue } from '../../src/client/programs'
import {
  cardsFor,
  type ProgramSummary,
  type TrainingProfile,
} from '../../src/client/program-catalogue'
import { longDateLabel, shortDayLabel, trainedLabel } from '../../src/client/week'
import { deviceTimezone } from '../../src/client/timezone'
import todayHero from '../../assets/images/today/today-hero.webp'
import { ProgramCard } from '../../src/components/program-card'
import { DOCK_HEIGHT } from '../../src/components/tab-bar'

const EXPIRED = 'Tu sesión venció. Vuelve a entrar para continuar.'
const READ_FAILED = 'No pudimos cargar tu día. Inténtalo otra vez.'
const START_FAILED = 'No pudimos empezar la sesión. Inténtalo otra vez.'

/** What a destination that does not exist yet answers, instead of a blank screen. */
const PENDING: Record<string, string> = {
  free: 'Entrenar libre llega con tu contenido personal.',
  own: 'Crear tu propio programa llega con tu contenido personal.',
  routines: 'Tus rutinas llegan con tu contenido personal.',
  food: 'Comida llega con el registro de nutrición.',
  progress: 'Tu progreso llega con el historial.',
  notices: 'Tus avisos llegan con las notificaciones.',
  history: 'El historial completo llega con su propia pantalla.',
}

const HERO_ASPECT = 390 / 468

export default function Today() {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const programs = useMemo(() => createSpaceProgramFlow(), [])
  const training = useMemo(() => createSpaceExecutionFlow(), [])
  const timezone = useMemo(() => deviceTimezone(), [])

  const [today, setToday] = useState<TodayPayload | undefined>(undefined)
  const [catalogue, setCatalogue] = useState<ProgramCatalogue | undefined>(undefined)
  const [pending, setPending] = useState<string | undefined>(undefined)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [starting, setStarting] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useEffect(() => {
    let active = true

    training
      .readToday(timezone)
      .then((current) => {
        if (!active) return
        setToday(current)
        // The catalogue is only read when there is a choice to make: somebody with a
        // program does not need twenty-four of them fetched behind their session.
        if (current.current_assignment === null) return programs.readCatalogue()
        return undefined
      })
      .then((available) => {
        if (active && available) setCatalogue(available)
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
  }, [programs, training, timezone])

  const profile: TrainingProfile = today?.profile ??
    catalogue?.profile ?? {
      given_name: '',
      primary_training_goal: null,
      training_experience: null,
      biological_sex: null,
      focus_areas: [],
    }
  const cards = useMemo(
    () => cardsFor(catalogue?.programs ?? [], profile),
    [catalogue?.programs, profile],
  )
  const date = useMemo(() => longDateLabel(new Date()), [])
  const assigned = today?.current_assignment ?? null
  const session = today?.session ?? null
  // The week is done when the plan says so, not when today happens to be empty: a
  // person who is simply ahead has finished something, and the screen should say it
  // rather than pull next week forward.
  const weekDone =
    assigned !== null &&
    session === null &&
    (today?.week.sessions_planned ?? 0) > 0 &&
    today?.week.sessions_completed === today?.week.sessions_planned

  const train = () => {
    if (!session) return
    if (session.executed_session_id) {
      router.push(`/session/${session.executed_session_id}`)
      return
    }
    setStarting(true)
    training
      .start(session.planned_session_id, timezone)
      .then((id) => router.push(`/session/${id}`))
      .catch(() => setFailure(START_FAILED))
      .finally(() => setStarting(false))
  }

  return (
    <Screen edges={assigned ? [] : ['top', 'bottom']} style={assigned ? styles.bare : undefined}>
      {assigned ? (
        <Image
          source={todayHero}
          style={[styles.hero, { width, height: width / HERO_ASPECT }]}
          resizeMode="cover"
          accessible={false}
        />
      ) : null}
      {/* The fade must complete above the photograph's bottom edge, or the last few
          percent still shows image and leaves a seam across the screen. */}
      {assigned ? (
        <Scrim
          height={(width / HERO_ASPECT) * 0.82}
          coverage={0.58}
          onset={0.24}
          style={styles.veil}
        />
      ) : null}

      <ScrollView
        contentContainerStyle={[
          styles.content,
          // The photograph runs under the status bar, so this screen pays for the safe
          // area itself. Measured, rather than a guess at where a notch ends.
          assigned
            ? { paddingHorizontal: 24, paddingTop: insets.top + semanticSpacing.screenTop }
            : null,
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.greeting}>
            <Text role="display" size="2xl" uppercase accessibilityRole="header">
              {profile.given_name ? `Hola, ${profile.given_name}` : 'Hola'}
            </Text>
            <Text role="eyebrow" size="xs" color="muted">
              {date.toUpperCase()}
            </Text>
          </View>
          <Bell onPress={() => setPending(PENDING.notices)} />
        </View>

        {assigned && session ? (
          <View style={styles.session}>
            <Text role="eyebrow" size="xs" color="accent">
              {`HOY · ${assigned.title.toUpperCase()}`}
            </Text>
            <Text
              role="display"
              size="5xl"
              uppercase
              style={styles.sessionTitle}
              accessibilityRole="header"
            >
              {session.session_title}
            </Text>
            <Text role="body" size="sm" color="secondary">
              {`${session.exercise_count} ${session.exercise_count === 1 ? 'ejercicio' : 'ejercicios'}`}
            </Text>
            <Button
              label={
                session.executed_session_id ? 'Continuar entrenamiento' : 'Empezar entrenamiento'
              }
              icon="start"
              onPress={train}
              loading={starting}
              style={styles.start}
            />
          </View>
        ) : null}

        {assigned && !session ? (
          <View style={styles.session}>
            <Text role="eyebrow" size="xs" color={weekDone ? 'success' : 'accent'}>
              {`ESTA SEMANA · ${assigned.title.toUpperCase()}`}
            </Text>
            <Text
              role="display"
              size="5xl"
              uppercase
              style={styles.sessionTitle}
              accessibilityRole="header"
            >
              {weekDone ? 'Semana cumplida' : 'Día de descanso'}
            </Text>
            <Text role="body" size="sm" color="secondary">
              {weekDone
                ? `${today?.week.sessions_completed} de ${today?.week.sessions_planned} sesiones · ${trainedLabel(today?.week.trained_seconds ?? 0)}`
                : 'Tu programa no pide nada hoy. Descansar también es entrenar.'}
            </Text>
            {/* Free training rather than next week's session: finishing early is
                finishing, and pulling the next week forward would quietly turn a
                good week into a longer one. */}
            <Button
              label="Entrenar libre"
              variant="secondary"
              icon="freestyle"
              onPress={() => setPending(PENDING.free)}
              style={styles.start}
            />
            <Text role="body" size="sm" color="muted">
              {weekDone
                ? 'La semana que viene empieza limpia. Lo de esta no se arrastra.'
                : 'Puedes adelantar cualquier rutina de la semana desde Entrenar.'}
            </Text>
          </View>
        ) : null}

        {!assigned ? (
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
        ) : null}

        {failure ? <InlineAlert message={failure} /> : null}

        {!assigned && cards.length > 0 ? (
          <View style={styles.cards}>
            {cards.map((card) => (
              <ProgramCard
                key={card.program.program_version_id}
                program={card.program}
                suggested={card.suggested}
                busy={false}
                disabled={sessionExpired}
                onPress={() => open(router, card.program)}
              />
            ))}
          </View>
        ) : null}

        {sessionExpired ? (
          <Button label="Iniciar sesión" onPress={() => router.replace('/sign-in')} />
        ) : null}

        {today === undefined && !failure ? (
          <Text role="body" size="sm" color="muted">
            Cargando tu día…
          </Text>
        ) : null}

        {assigned && today ? <Week week={today.week} /> : null}

        {!assigned ? (
          <View style={styles.section}>
            <Text role="eyebrow" size="xs" color="muted">
              O SI PREFIERES
            </Text>
            <View style={styles.alternatives}>
              <Alternative
                icon="checklist"
                label="Ver catálogo completo"
                onPress={() => router.push('/train')}
              />
              <Alternative
                icon="create"
                label="Crear el mío"
                onPress={() => setPending(PENDING.own)}
              />
            </View>
          </View>
        ) : null}

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

        {assigned && today ? (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text role="eyebrow" size="xs" color="muted">
                HISTORIAL DE ENTRENAMIENTO
              </Text>
              {today.week.history.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Ver todo el historial"
                  onPress={() => setPending(PENDING.history)}
                >
                  <Text role="control" size="xs" color="accent">
                    Ver todos ›
                  </Text>
                </Pressable>
              ) : null}
            </View>
            {today.week.history.length > 0 ? (
              today.week.history.map((trained) => (
                <TrainedRow
                  key={trained.executed_session_id}
                  day={shortDayLabel(trained.trained_on)}
                  title={trained.title ?? 'Sesión'}
                  detail={`${trained.sets_recorded} ${trained.sets_recorded === 1 ? 'serie' : 'series'}`}
                />
              ))
            ) : (
              // The section stays rather than disappearing: an absent section reads as
              // a screen that is still loading, and "nothing yet" is an answer.
              <Text role="body" size="sm" color="muted">
                Todavía no has terminado ninguna sesión. La primera aparece aquí.
              </Text>
            )}
          </View>
        ) : null}

        {pending ? (
          <Text role="body" size="sm" color="muted">
            {pending}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  )
}

function open(router: ReturnType<typeof useRouter>, program: ProgramSummary) {
  router.push(`/programs/${program.program_version_id}`)
}

/**
 * The week, counted in the sessions it asks for.
 *
 * One bar per planned session, not per day: the week is the unit and the day is a
 * suggestion, so seven bars would be counting something nobody is trying to fill.
 */
function Week({ week }: { readonly week: TodayPayload['week'] }) {
  const theme = useTheme()
  const planned = Math.max(week.sessions_planned, 1)
  const done = Math.min(week.sessions_completed, planned)

  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text role="eyebrow" size="xs" color="muted">
          ESTA SEMANA
        </Text>
        <Text
          role="display"
          size="md"
          color={week.sessions_planned > 0 && done === planned ? 'success' : 'primary'}
        >
          {`${week.sessions_completed} de ${week.sessions_planned}`}
        </Text>
      </View>
      <View style={styles.bars}>
        {Array.from({ length: planned }, (_unused, index) => (
          <View
            key={index}
            style={[
              styles.bar,
              {
                backgroundColor:
                  index < done ? theme.color.action.primary : theme.color.background.surfaceMuted,
              },
            ]}
          />
        ))}
      </View>
      <View style={styles.figures}>
        <Figure
          icon="time"
          tint={theme.color.status.success}
          value={trainedLabel(week.trained_seconds)}
        />
        {/* Zero, and honestly zero: nutrition has no tables, so nothing has been
            logged and nothing is being estimated. */}
        <Figure icon="nutrition" tint={theme.color.status.warning} value="0 kcal" />
        <Figure
          icon="weight"
          tint={theme.color.status.info}
          value={week.latest_weight ? weightLabel(week.latest_weight) : '—'}
        />
      </View>
    </View>
  )
}

/** "70,2 kg", with the comma this market writes and no locale to trust. */
function weightLabel(measure: NonNullable<TodayPayload['week']['latest_weight']>): string {
  return `${String(measure.value).replace('.', ',')} ${measure.unit}`
}

function Figure({
  icon,
  tint,
  value,
}: {
  readonly icon: IconName
  readonly tint: string
  readonly value: string
}) {
  return (
    <View style={styles.figure}>
      <FoundationIcon name={icon} size="xs" color={tint} decorative />
      <Text role="control" size="xs" color="secondary">
        {value}
      </Text>
    </View>
  )
}

function TrainedRow({
  day,
  title,
  detail,
}: {
  readonly day: string
  readonly title: string
  readonly detail: string
}) {
  const theme = useTheme()

  return (
    <View style={[styles.trained, { borderColor: theme.color.border.subtle }]}>
      <Text role="eyebrow" size="2xs" color="muted" style={styles.trainedDay}>
        {day}
      </Text>
      <View style={styles.trainedBody}>
        <Text role="control" size="sm">
          {title}
        </Text>
        <Text role="body" size="xs" color="muted">
          {detail}
        </Text>
      </View>
      <FoundationIcon name="success" size="xs" color={theme.color.status.success} decorative />
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
      {/* Two lines rather than an ellipsis: "Ver catálogo completo" does not fit a
          half-width pill on one, and a truncated label is a label nobody can read. */}
      <Text role="control" size="xs" numberOfLines={2} style={styles.alternativeLabel}>
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
      <Text role="control" size="xs">
        {label}
      </Text>
    </Pressable>
  )
}

/** Glass, not a solid chip: it sits on a photograph, where a solid one reads as a sticker. */
function Bell({ onPress }: { readonly onPress: () => void }) {
  const theme = useTheme()

  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Tus avisos" onPress={onPress}>
      {/* The chip material, not the chrome one: this sits on a photograph, and at
          the dock's opacity it would read as a sticker stuck over it. */}
      <GlassPanel material="chip" style={styles.bell}>
        <FoundationIcon name="notification" size="sm" color={theme.color.icon.primary} decorative />
      </GlassPanel>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  // The photograph runs to the top edge, so the screen keeps no inset of its own and
  // the scroll pays for the status bar instead.
  bare: { paddingHorizontal: 0 },
  hero: { position: 'absolute', top: 0, left: 0 },
  veil: { top: 100 },
  // The dock floats over the scroll, so the last section has to clear it.
  content: { gap: 20, paddingBottom: DOCK_HEIGHT + 40 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  greeting: { flex: 1, gap: 4 },
  bell: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  heading: { gap: 8 },
  // The photograph carries the space above it, so the session sits well down the frame.
  session: { gap: 8, paddingTop: 124 },
  sessionTitle: { lineHeight: 44 },
  start: { marginTop: 12, height: 50 },
  cards: { gap: 12 },
  section: { gap: 10 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bars: { flexDirection: 'row', gap: 6 },
  bar: { flex: 1, height: 7, borderRadius: 3.5 },
  figures: { flexDirection: 'row', gap: 18, flexWrap: 'wrap' },
  figure: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  trained: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
    borderTopWidth: 1,
  },
  trainedDay: { width: 52 },
  trainedBody: { flex: 1, gap: 1 },
  alternatives: { flexDirection: 'row', gap: 8 },
  alternativeLabel: { flexShrink: 1 },
  alternative: {
    flex: 1,
    minHeight: 48,
    paddingVertical: 8,
    paddingHorizontal: 14,
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
