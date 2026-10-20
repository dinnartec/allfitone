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
import { IconButton } from '@allfitone/react-native/icon-button'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Sheet } from '@allfitone/react-native/sheet'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { useFocusEffect, useRouter } from 'expo-router'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native'
import Animated, {
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FoundationIcon, type IconName } from '@allfitone/react-native/icons'
import { semanticSpacing } from '@allfitone/react-native/tokens'

import { ApiError } from '../../src/client'
import { createSpaceExecutionFlow } from '../../src/client/execution-transport'
import { keepIfSame } from '../../src/client/same-answer'
import { ENTRANCE_MS } from '../../src/components/tab-entrance'
import type { Today as TodayPayload } from '../../src/client/execution'
import { createSpaceProgramFlow } from '../../src/client/programs-transport'
import type { ProgramCatalogue } from '../../src/client/programs'
import {
  catalogueList,
  type ProgramSummary,
  type TrainingProfile,
} from '../../src/client/program-catalogue'
import { longDateLabel, trainedLabel } from '../../src/client/week'
import { weekGroups, type HistoryItem } from '../../src/client/history'
import { deviceTimezone } from '../../src/client/timezone'
import { freeOfferCaption, openSessionBar } from '../../src/client/free-training'
import { createSpaceContentFlow } from '../../src/client/content-transport'
import { readExerciseLibrary, type ExerciseLibrary } from '../../src/client/exercise-library'
import type { MyRoutine } from '../../src/client/content'
import type { WeekPlan } from '../../src/client/programs'
import { routineFigures, routineOfVersion } from '../../src/client/library'
import {
  cardsFor as weekCards,
  dayChip,
  firstCardShown,
  lastTimeShown,
  programDayOf,
  sessionInProgress,
  startLabel,
  weekDays,
  type RoutineCard,
  type WeekDay,
} from '../../src/client/week-plan'
import { elapsedLabel } from '../../src/client/session-form'
import { HistoryGroupHeader, HistoryPanel, HistoryRow } from '../../src/components/history-row'
import { HomeCard } from '../../src/components/home-card'
import { OfferRow } from '../../src/components/offer-row'
import { PHOTO_COVER } from '../../src/client/routine-cover'
import { PageDots } from '@allfitone/react-native/page-dots'
import { ProgramPoster } from '../../src/components/program-poster'
import { DOCK_HEIGHT } from '../../src/components/tab-bar'

const EXPIRED = 'Tu sesión venció. Vuelve a entrar para continuar.'
/** How many of the latest sessions Hoy shows before «Ver todo». */
const HOME_HISTORY = 4

/** Today's calendar date in the person's zone, which is how history rows are dated. */
const localToday = (timezone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
const READ_FAILED = 'No pudimos cargar tu día. Inténtalo otra vez.'
const START_FAILED = 'No pudimos empezar la sesión. Inténtalo otra vez.'
const DISCARD_FAILED = 'No pudimos descartar el entrenamiento. Inténtalo otra vez.'

/** What a destination that does not exist yet answers, instead of a blank screen. */
const PENDING: Record<string, string> = {
  routines: 'Tus rutinas llegan con tu contenido personal.',
  food: 'Comida llega con el registro de nutrición.',
  progress: 'Tu progreso llega con el historial.',
  notices: 'Tus avisos llegan con las notificaciones.',
}

/** El margen de la pantalla cuando hay programa. El carrusel lo sangra para asomar. */
const GUTTER = 24

/**
 * El margen del propio carrusel y lo que deja ver de la siguiente.
 *
 * Más estrecho que el de la pantalla: la tarjeta es lo que hay que mirar, y ganarle
 * ocho puntos a cada lado se nota. Los treinta de la derecha son lo que dice que hay
 * más semana; con menos, la tarjeta parece una sola y el carrusel se pierde.
 */
const DECK_GUTTER = 16
const PEEK = 30

/** Lo que separa una tarjeta de la siguiente. */
const CARD_GAP = 12

/** Y lo más ancha que se deja, para que en una tableta no se estire sin fin. */
const CARD_MAX = 420

export default function Today() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const programs = useMemo(() => createSpaceProgramFlow(), [])
  const content = useMemo(() => createSpaceContentFlow(), [])
  const training = useMemo(() => createSpaceExecutionFlow(), [])
  const timezone = useMemo(() => deviceTimezone(), [])

  const [today, setToday] = useState<TodayPayload | undefined>(undefined)
  /** The latest finished sessions for the history section; undefined until read. */
  const [recent, setRecent] = useState<readonly HistoryItem[] | undefined>(undefined)
  const [catalogue, setCatalogue] = useState<ProgramCatalogue | undefined>(undefined)
  // La semana y la biblioteca, que es de donde sale el carrusel: la agenda dice qué
  // sesiones hay y la biblioteca con qué portada se dibuja cada una.
  const [plan, setPlan] = useState<WeekPlan | undefined>(undefined)
  const [routines, setRoutines] = useState<readonly MyRoutine[]>([])
  const [library, setLibrary] = useState<ExerciseLibrary | undefined>(undefined)
  const [pending, setPending] = useState<string | undefined>(undefined)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [starting, setStarting] = useState<string | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  /**
   * Si el catálogo está plegado o extendido, que es lo único que «Ver todos» cambia.
   *
   * Vive aquí y no en otra ruta: llevarse la elección a otra pantalla era hacer empezar
   * de nuevo a quien sólo quería ver dos más.
   */
  const [expanded, setExpanded] = useState(false)
  const readOnce = useRef(false)

  /**
   * Re-read every time this tab is looked at, and **never clear what is on screen
   * first**.
   *
   * The tabs stay mounted now, which is what stopped the content jumping — and it
   * also stopped them noticing that anything changed elsewhere: choosing a different
   * programme in Entrenar left Hoy showing the old one. Reloading on focus fixes that
   * without giving the jump back, because the previous answer stays drawn until the
   * new one lands. An empty state in between would be a lie: the data is not gone,
   * it is one request old.
   */
  useFocusEffect(
    useCallback(() => {
      let active = true

      // Coming back, the screen already shows the last answer: ask once it has finished
      // arriving, so the redraw does not land on top of the transition.
      const timer = setTimeout(read, readOnce.current ? ENTRANCE_MS : 0)
      readOnce.current = true

      function read() {
        // Asked alongside today and not after it: most people have a programme, and
        // waiting for today to say so cost a round trip. Without one, they go unused.
        const withProgramme = Promise.all([
          programs.readWeekPlan(timezone),
          content.readMyRoutines(),
          readExerciseLibrary(content),
        ])
        const history = training.listHistory({ timezone, limit: HOME_HISTORY })
        withProgramme.catch(() => undefined)
        history.catch(() => undefined)

        training
          .readToday(timezone)
          .then((current) => {
            if (!active) return
            setToday((held) => keepIfSame(held, current))
            // The catalogue is only read when there is a choice to make: somebody with a
            // program does not need twenty-four of them fetched behind their session.
            if (current.current_assignment === null) return programs.readCatalogue()
            void withProgramme
              .then(([week, mine, read]) => {
                if (!active) return
                setPlan((held) => keepIfSame(held, week))
                setRoutines((held) => keepIfSame(held, mine))
                setLibrary(read)
              })
              .catch(() => undefined)
            // Apart from the rest: a history that fails to load must not take the week with it.
            void history
              .then((page) => active && setRecent((held) => keepIfSame(held, page.data)))
              .catch(() => active && setRecent([]))
            return undefined
          })
          .then((available) => {
            if (active && available) setCatalogue((held) => keepIfSame(held, available))
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
      }

      return () => {
        active = false
        clearTimeout(timer)
      }
    }, [content, programs, training, timezone]),
  )

  const profile: TrainingProfile = today?.profile ??
    catalogue?.profile ?? {
      given_name: '',
      primary_training_goal: null,
      training_experience: null,
      biological_sex: null,
      focus_areas: [],
    }
  const offered = useMemo(
    () => catalogueList(catalogue?.programs ?? [], profile, expanded),
    [catalogue?.programs, profile, expanded],
  )
  // Con mayúscula inicial: `longDateLabel` la escribe en minúscula porque en una frase
  // va así, y aquí es una línea suelta debajo del saludo.
  const date = useMemo(() => {
    const written = longDateLabel(new Date())
    return `${written.slice(0, 1).toUpperCase()}${written.slice(1)}`
  }, [])
  const assigned = today?.current_assignment ?? null
  /**
   * Las tarjetas del carrusel: la semana, cada una con la rutina que es.
   *
   * **Se emparejan por la versión y no por el nombre.** La agenda dice qué sesión hay y
   * la biblioteca sabe con qué portada se dibuja; dos rutinas pueden llamarse igual, y
   * emparejarlas por el rótulo dibujaría la portada de la otra.
   */
  const todayIs = useMemo(() => programDayOf(new Date()), [])
  const week = useMemo(() => weekCards(plan, todayIs), [plan, todayIs])
  const days = useMemo(() => weekDays(week, todayIs), [week, todayIs])
  const inProgress = sessionInProgress(week)
  const openFree = today?.open_free_session_id ?? null
  const bar = openSessionBar(
    inProgress?.routine.open_execution_id
      ? { executionId: inProgress.routine.open_execution_id, title: inProgress.routine.title }
      : undefined,
    openFree,
  )
  const [startingFree, setStartingFree] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [leaving, setLeaving] = useState(false)

  /**
   * Descartar desde aquí es lo mismo que descartar dentro de la sesión: `abandon`, y lo
   * registrado se queda. Después se relee la semana, que es la que dice si sigue abierta.
   */
  const discard = (executionId: string) => {
    setLeaving(true)
    training
      .abandon(executionId)
      .then(() => Promise.all([training.readToday(timezone), programs.readWeekPlan(timezone)]))
      .then(([current, week]) => {
        setToday(current)
        setPlan(week)
        setDiscarding(false)
      })
      .catch(() => setFailure(DISCARD_FAILED))
      .finally(() => setLeaving(false))
  }

  /** Empezar la rutina de una tarjeta, o volver a la que quedó abierta. */
  const start = useCallback(
    (card: RoutineCard) => {
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
    },
    [router, training, timezone],
  )
  /** Training off the plan: back to the free session left open, or a new empty one. */
  const trainFree = useCallback(() => {
    if (openFree) {
      router.push(`/session/${openFree}`)
      return
    }
    if (startingFree) return
    setStartingFree(true)
    training
      .startFree(timezone)
      .then((id) => router.push(`/session/${id}`))
      .catch(() => setFailure(START_FAILED))
      .finally(() => setStartingFree(false))
  }, [openFree, router, startingFree, training, timezone])
  const openRoutine = useCallback(
    (templateId: string) => router.push(`/routines/${templateId}`),
    [router],
  )

  return (
    <Screen edges={assigned ? [] : ['top', 'bottom']} style={assigned ? styles.bare : undefined}>
      {/* Sin la fotografía de fondo que llevaba antes. `FIN-2b` no la tiene, y con el
          carrusel ya no hace falta: la imagen de esta pantalla es la portada de cada
          rutina, que sí dice cuál es. Una encima de otra eran dos fotografías peleando
          por el mismo texto. */}

      {/* **El saludo no se va con el scroll.** Es quién eres y qué día es: lo único de
          la pantalla que sigue siendo verdad mientras miras cualquier otra cosa, y lo
          que dice de quién es la aplicación cuando la abres. Vive fuera del `ScrollView`
          y por eso paga él mismo el área segura. */}
      <View
        style={[
          styles.header,
          assigned
            ? { paddingHorizontal: 24, paddingTop: insets.top + semanticSpacing.screenTop }
            : null,
        ]}
      >
        <View style={styles.greeting}>
          {/* En caja baja y en la cara de texto, no en la condensada en versalitas:
              es un saludo, y `FIN-2b` lo escribe como se escribe un saludo. */}
          <Text role="control" size="xl" accessibilityRole="header">
            {profile.given_name ? `Hola, ${profile.given_name}` : 'Hola'}
          </Text>
          {/* La fecha cuando hay algo que hacer hoy, y qué toca hacer cuando no lo hay:
              el primer día la fecha no dice nada y la frase sí. Y a un cuerpo mayor,
              porque una fecha se comprueba de reojo y una instrucción se lee. */}
          {assigned ? (
            <Text role="body" size="sm" color="muted">
              {date}
            </Text>
          ) : (
            <Text role="body" size="md" color="secondary">
              Empecemos por elegir tu plan
            </Text>
          )}
        </View>
        <Bell onPress={() => setPending(PENDING.notices)} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          assigned ? { paddingHorizontal: 24, paddingTop: 20 } : null,
          bar ? styles.underInProgress : null,
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* `FIN-2b`. El carrusel es la semana: una tarjeta por sesión, con la portada
            que su programa le puso, y la de hoy marcada. Sustituye al titular único de
            la sesión de hoy, que dejaba el resto de la semana sin enseñar. */}
        {assigned && week.length > 0 ? (
          <Carousel
            week={week}
            routines={routines}
            library={library}
            today={todayIs}
            starting={starting}
            onOpen={openRoutine}
            onStart={start}
          />
        ) : null}

        {assigned && plan !== undefined && week.length === 0 ? (
          <View style={styles.heading}>
            <Text role="display" size="2xl" uppercase accessibilityRole="header">
              Semana libre
            </Text>
            <Text role="body" size="sm" color="secondary">
              Tu programa no pide nada esta semana.
            </Text>
          </View>
        ) : null}

        {/* El rótulo y «Ver todos» en la misma línea, que es lo que dice que la lista
            de abajo es lo que se extiende: no hay otra pantalla detrás del enlace. */}
        {!assigned && catalogue ? (
          <View style={styles.heading}>
            <View style={styles.sectionHead}>
              <Text role="display" size="3xl" uppercase accessibilityRole="header">
                Elige tu programa
              </Text>
              {expanded || offered.hidden > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    expanded ? 'Ver solo los sugeridos' : 'Ver todos los programas de Allfit'
                  }
                  hitSlop={8}
                  onPress={() => setExpanded(!expanded)}
                >
                  <Text role="control" size="sm" color="accent">
                    {expanded ? 'Ver menos' : 'Ver todos'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            <Text role="body" size="sm" color="secondary">
              {expanded
                ? 'El catálogo completo, los que mejor encajan contigo primero.'
                : 'Todavía no tienes ninguno. Estos encajan con lo que nos contaste.'}
            </Text>
          </View>
        ) : null}

        {failure ? <InlineAlert message={failure} /> : null}

        {!assigned && offered.cards.length > 0 ? (
          <View style={styles.posters}>
            {offered.cards.map((card) => (
              <ProgramPoster
                key={card.program.program_version_id}
                program={card.program}
                suggested={card.suggested}
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

        {assigned && today ? <Week week={today.week} days={days} /> : null}

        {/* Sin «Ver catálogo completo»: el catálogo ya está aquí y lo abre «Ver todos».
            Queda la otra salida, que es la que no cabe en ninguna lista de Allfit, y
            lleva la misma forma que «Entrenamiento libre» en la pantalla con programa:
            las dos son lo mismo —algo que se puede hacer ahora, con sitio para decir
            qué pasa si se hace— y dos formas distintas serían dos promesas distintas. */}
        {!assigned ? (
          <OfferRow
            icon="create"
            label="Crear el mío"
            caption="Arma tu propio programa, día por día"
            tone="quiet"
            onPress={() => router.push('/programs/new')}
          />
        ) : null}

        {/* En lugar de los cuatro accesos rápidos, de los que ninguno llevaba a
            ninguna parte. Entrenar libre es lo único de aquellos cuatro que es un acto
            y no una pestaña, así que se queda, con su sitio propio encima del
            historial. Sin programa también: no tener plan no impide entrenar
            (`HU-SP-089` criterio 4). */}
        <OfferRow
          icon="freestyle"
          label="Entrenamiento libre"
          caption={freeOfferCaption(openFree)}
          captionColor={openFree ? 'accent' : 'muted'}
          tone="quiet"
          onPress={trainFree}
        />

        {assigned && today && recent ? (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text role="control" size="md">
                Historial
              </Text>
              {recent.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Ver todo el historial"
                  onPress={() => router.push('/history')}
                >
                  <Text role="control" size="xs" color="accent">
                    Ver todo
                  </Text>
                </Pressable>
              ) : null}
            </View>
            {recent.length > 0 ? (
              // Grouped by week, each week its own panel: H-2 draws the break between
              // them, so «semana pasada» reads as a heading and not as another row.
              weekGroups(recent, localToday(timezone)).map((group) => (
                <View key={group.weekStartsOn} style={styles.historyGroup}>
                  <HistoryGroupHeader label={group.label} />
                  <HistoryPanel>
                    {group.items.map((item, index) => (
                      <HistoryRow
                        key={item.executed_session_id}
                        item={item}
                        first={index === 0}
                        size="home"
                        onPress={() =>
                          router.push({
                            pathname: '/history/[executionId]',
                            params: { executionId: item.executed_session_id },
                          })
                        }
                      />
                    ))}
                  </HistoryPanel>
                </View>
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

      {bar ? (
        <InProgress
          executionId={bar.executionId}
          title={bar.title}
          bottom={Math.max(insets.bottom, 12) + DOCK_HEIGHT + 10}
          read={training.readExecution}
          onResume={() =>
            inProgress ? start(inProgress) : router.push(`/session/${bar.executionId}`)
          }
          onDiscard={() => setDiscarding(true)}
        />
      ) : null}

      <Sheet
        visible={discarding}
        onDismiss={() => setDiscarding(false)}
        title="¿Descartar este entrenamiento?"
      >
        <View style={styles.decisions}>
          <Button
            label="Descartar entrenamiento"
            variant="secondary"
            loading={leaving}
            onPress={() => {
              if (bar) discard(bar.executionId)
            }}
          />
          <Button label="Seguir entrenando" variant="ghost" onPress={() => setDiscarding(false)} />
        </View>
      </Sheet>
    </Screen>
  )
}

/**
 * La sesión minimizada: sigue abierta, y esta barra es el camino de vuelta.
 *
 * **Encima del menú y fuera del desplazamiento**, como se deja algo a mano: la pantalla
 * de la sesión baja al minimizarse, y lo que la trae de vuelta sube desde el mismo borde.
 */
function InProgress({
  executionId,
  title,
  bottom,
  read,
  onResume,
  onDiscard,
}: {
  readonly executionId: string
  readonly title: string
  readonly bottom: number
  readonly read: (id: string) => Promise<{ started_at: string }>
  readonly onResume: () => void
  readonly onDiscard: () => void
}) {
  const theme = useTheme()
  const [startedAt, setStartedAt] = useState<number | undefined>(undefined)
  const [seconds, setSeconds] = useState(0)

  // The agenda says a session is open but not since when; the session itself does.
  useEffect(() => {
    let active = true
    read(executionId)
      .then((current) => {
        if (active) setStartedAt(Date.parse(current.started_at))
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [executionId, read])

  // From the start and not a counter, like the session screen: both show the same time.
  useEffect(() => {
    if (startedAt === undefined) return
    const tick = () => setSeconds((Date.now() - startedAt) / 1000)
    tick()
    const timer = setInterval(tick, 1_000)
    return () => clearInterval(timer)
  }, [startedAt])

  return (
    <View
      style={[
        styles.inProgress,
        {
          bottom,
          backgroundColor: theme.color.background.surface,
          borderColor: theme.color.border.accent,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Volver a ${title}, en curso`}
        onPress={onResume}
        style={styles.inProgressResume}
      >
        <View style={[styles.live, { backgroundColor: theme.color.icon.accent }]} />
        <View style={styles.inProgressText}>
          <Text role="eyebrow" size="2xs" color="accent">
            EN CURSO
          </Text>
          <Text role="control" size="sm" numberOfLines={1}>
            {title}
          </Text>
        </View>
        {startedAt === undefined ? null : (
          <Text role="data" size="md" accessibilityLabel={`Llevas ${elapsedLabel(seconds)}`}>
            {elapsedLabel(seconds)}
          </Text>
        )}
        <FoundationIcon name="collapse" size="sm" color={theme.color.icon.primary} decorative />
      </Pressable>
      <IconButton
        icon="close"
        size="sm"
        accessibilityLabel="Descartar entrenamiento"
        onPress={onDiscard}
      />
    </View>
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
/**
 * La semana: cuántas van, en qué días, y lo que se llevan medido.
 *
 * **Siete tramos y no uno por sesión.** Una barra por sesión decía cuántas van de
 * cuántas, que es justo lo que la cifra de al lado ya dice; siete dicen además **cuándo**,
 * que es lo que deja ver la forma de la semana — dónde entrena y dónde descansa.
 */
/**
 * El carrusel de la semana: una tarjeta por sesión, la de hoy marcada.
 *
 * **Se desliza por posiciones y no por páginas.** La tarjeta mide menos que la pantalla
 * porque la siguiente tiene que asomar —es lo que dice que hay más semana a la derecha—,
 * y `pagingEnabled` pagina por el ancho de la vista: con una tarjeta más estrecha se
 * desalinea un poco más en cada deslizamiento. `snapToInterval` engancha donde toca.
 *
 * **Y sangra hasta el borde.** La pantalla tiene su margen, pero un carrusel que se
 * detuviera en él escondería la tarjeta siguiente justo cuando hace falta verla.
 */
// Memoised: the costliest part of Hoy, and its props only change when the week does.
const Carousel = memo(function Carousel({
  week,
  routines,
  library,
  today,
  starting,
  onOpen,
  onStart,
}: {
  readonly week: readonly RoutineCard[]
  readonly routines: readonly MyRoutine[]
  readonly library: ExerciseLibrary | undefined
  readonly today: number
  readonly starting: string | undefined
  readonly onOpen: (templateId: string) => void
  readonly onStart: (card: RoutineCard) => void
}) {
  const theme = useTheme()
  const { width } = useWindowDimensions()
  const card = Math.min(CARD_MAX, width - DECK_GUTTER - PEEK)
  const step = card + CARD_GAP

  /**
   * Dónde va el carrusel, en tarjetas y con decimales.
   *
   * **Vive en el hilo de la interfaz y no en el estado de React.** Los puntos siguen al
   * dedo, así que el valor cambia en cada fotograma; guardarlo con `useState` sería un
   * render por cuadro justo mientras se arrastra, que es de donde venía la latencia.
   */
  // Opens on today's card, or the next day's: moved to, never reordered.
  const opening = useMemo(() => firstCardShown(week, today), [week, today])
  const at = useSharedValue(opening)
  const follow = useAnimatedScrollHandler((event) => {
    at.set(event.contentOffset.x / step)
  })

  /**
   * Cuál va delante: el punto que se enciende y lo que se lee en voz alta.
   *
   * **Cambia al cruzar la mitad, no cuando el carrusel se para.** Estaba atado a
   * `onMomentumScrollEnd`, que no dispara hasta que la inercia termina del todo, así
   * que la marca llegaba segundos después de que la tarjeta ya estuviera en su sitio.
   *
   * Y sigue sin ser un render por fotograma: la reacción vive en el hilo de la
   * interfaz y sólo cruza al de React cuando el número redondeado cambia, que son dos
   * o tres veces por gesto.
   */
  const [leadingIndex, setLeadingIndex] = useState(opening)
  useAnimatedReaction(
    () => Math.round(at.get()),
    (now, before) => {
      if (now !== before) scheduleOnRN(setLeadingIndex, now)
    },
  )

  return (
    <View style={styles.carousel}>
      <Animated.ScrollView
        style={styles.bleed}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: DECK_GUTTER, gap: CARD_GAP }}
        contentOffset={{ x: opening * step, y: 0 }}
        onScroll={follow}
        scrollEventThrottle={16}
      >
        {week.map((one) => {
          const routine = routineOfVersion(routines, one.routine.template_version_id)
          return (
            <HomeCard
              key={one.routine.planned_session_id}
              width={card}
              title={one.routine.title}
              figures={routineFigures({
                exercise_count: one.routine.exercise_count,
                set_count: one.routine.set_count,
              })}
              chip={dayChip(one.routine.program_day, today)}
              load={routine?.muscle_sets}
              // Sin estilo elegido, la fotografía: es la que llena la tarjeta y la que
              // hace que una rutina se reconozca antes de leer su nombre. El servidor
              // responde su dirección para toda rutina que diga qué trabaja; si no la
              // hay, la tarjeta cae sola en la letra. Elegir otra es del programa.
              cover={routine?.cover ?? PHOTO_COVER}
              coverUrl={routine?.cover_url}
              worked={routine?.muscles ?? []}
              library={library}
              // El reverso. Lo que no se respondió no viaja, y la tarjeta que se queda
              // sin las dos cosas tampoco ofrece el botón de girar.
              lastTime={lastTimeShown(one.routine.last_time, new Date())}
              actions={{
                onOpen: () => routine && onOpen(routine.template_id),
                onStart: () => onStart(one),
                startLabel: startLabel(one.state),
                starting: starting === one.routine.planned_session_id,
              }}
            />
          )
        })}
      </Animated.ScrollView>

      {week.length > 1 ? (
        <PageDots
          count={week.length}
          active={leadingIndex}
          at={at}
          color={theme.color.icon.accent}
          accessibilityLabel={`Rutina ${String(leadingIndex + 1)} de ${String(week.length)}`}
        />
      ) : null}
    </View>
  )
})

function Week({
  week,
  days,
}: {
  readonly week: TodayPayload['week']
  readonly days: readonly WeekDay[]
}) {
  const theme = useTheme()
  const planned = Math.max(week.sessions_planned, 1)
  const done = Math.min(week.sessions_completed, planned)
  // The week's own work sets. Adding up `history` counted the latest sessions of any
  // week, so a quiet week could show last month's sets.
  const sets = week.work_sets

  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text role="control" size="md">
          Esta semana
        </Text>
        <Text
          role="control"
          size="xs"
          color={week.sessions_planned > 0 && done === planned ? 'success' : 'muted'}
        >
          {`${week.sessions_completed} de ${week.sessions_planned}`}
        </Text>
      </View>
      <View style={styles.bars}>
        {days.map((day) => (
          <View
            key={day.day}
            style={[
              styles.bar,
              {
                backgroundColor: day.done
                  ? theme.color.icon.accent
                  : theme.color.background.surfaceMuted,
              },
              // El de hoy se reconoce por su filo, no por su color: el color ya está
              // diciendo si se cumplió, y un tercer tono haría de la barra un acertijo.
              day.today ? { borderWidth: 1, borderColor: theme.color.border.accent } : null,
            ]}
          />
        ))}
      </View>
      {/* Tres tarjetas y no tres renglones: el lienzo las dibuja como cifras que se
          miran de un vistazo, y en una fila de texto la unidad se lee como parte del
          número de al lado. */}
      <View style={styles.figures}>
        <Figure icon="time" value={trainedLabel(week.trained_seconds)} unit="Entrenando" />
        {/* Las series de verdad en lugar de las calorías que el lienzo dibuja: no hay
            tablas de nutrición, así que aquello sólo podía ser un cero o una
            estimación, y esto es lo que la semana registró. */}
        <Figure icon="checklist" value={String(sets)} unit={sets === 1 ? 'Serie' : 'Series'} />
        {/* El peso que levantaste, no el que pesas. Lo segundo es una medida del
            cuerpo y vive en tu progreso; esta fila resume lo que hiciste. */}
        <Figure icon="weight" value={liftedLabel(week.tonnage_kg)} unit="Levantado" />
      </View>
    </View>
  )
}

/**
 * Lo levantado en la semana, en la unidad que no obligue a contar ceros.
 *
 * Por encima de la tonelada se cuenta en toneladas con un decimal: «5.120 kg» son cinco
 * cifras que hay que leer despacio para saber si fue mucho. Nulo es que no se registró
 * carga, y eso es una raya y no un cero: cero diría que se entrenó sin mover nada.
 */
function liftedLabel(kilos: number | null): string {
  if (kilos === null || kilos <= 0) return '—'
  if (kilos >= 1000) return `${(kilos / 1000).toFixed(1).replace('.', ',')} t`
  return `${String(Math.round(kilos))} kg`
}

/** Una cifra de la semana: el glifo arriba, el número, y de qué es. */
function Figure({
  icon,
  value,
  unit,
}: {
  readonly icon: IconName
  readonly value: string
  readonly unit: string
}) {
  const theme = useTheme()

  return (
    <View
      style={[
        styles.figure,
        {
          backgroundColor: theme.color.background.surface,
          borderColor: theme.color.border.subtle,
        },
      ]}
    >
      <FoundationIcon name={icon} size="sm" color={theme.color.icon.accent} decorative />
      {/* En la cara de texto y no en la condensada: «0m» y «67 kg» en condensada salen
          con las letras encima unas de otras, y una cifra que hay que descifrar no es
          una cifra de un vistazo. */}
      <Text role="control" size="xl" numberOfLines={1}>
        {value}
      </Text>
      <Text role="body" size="xs" color="muted" numberOfLines={1}>
        {unit}
      </Text>
    </View>
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
  carousel: { gap: 14, alignItems: 'center' },
  // Sangra el margen de la pantalla: el carrusel empieza en el suyo, más estrecho.
  bleed: { marginHorizontal: -GUTTER, alignSelf: 'stretch' },
  // Sangra el margen de la pantalla y lo devuelve por dentro: así la primera tarjeta
  // queda alineada con el texto y la última no se pega al borde.
  // The dock floats over the scroll, so the last section has to clear it.
  content: { gap: 20, paddingBottom: DOCK_HEIGHT + 40 },
  // The bar's own height and gap, so the history's last row is not left beneath it.
  underInProgress: { paddingBottom: DOCK_HEIGHT + 40 + 72 },
  inProgress: {
    position: 'absolute',
    left: 16,
    right: 16,
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    borderRadius: 18,
    borderWidth: 1,
  },
  live: { width: 8, height: 8, borderRadius: 4 },
  inProgressText: { flex: 1, gap: 2 },
  inProgressResume: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  decisions: { gap: 12 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  greeting: { flex: 1, gap: 4 },
  bell: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  heading: { gap: 8 },
  // The photograph carries the space above it, so the session sits well down the frame.
  session: { gap: 8, paddingTop: 124 },
  sessionTitle: { lineHeight: 44 },
  start: { marginTop: 12, height: 50 },
  // Lo mismo que separa una tarjeta de otra en el carrusel, sólo que en vertical.
  posters: { gap: CARD_GAP },
  section: { gap: 10 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bars: { flexDirection: 'row', gap: 6 },
  bar: { flex: 1, height: 7, borderRadius: 3.5 },
  figures: { flexDirection: 'row', gap: 10 },
  figure: { flex: 1, gap: 6, borderWidth: 1, borderRadius: 20, padding: 12 },
  historyGroup: { gap: 10 },
})
