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
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native'
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated'
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
import { createSpaceContentFlow } from '../../src/client/content-transport'
import { readExerciseLibrary, type ExerciseLibrary } from '../../src/client/exercise-library'
import type { MyRoutine } from '../../src/client/content'
import type { WeekPlan } from '../../src/client/programs'
import { routineFigures, routineOfVersion } from '../../src/client/library'
import {
  cardsFor as weekCards,
  dayChip,
  programDayOf,
  startLabel,
  weekDays,
  type RoutineCard,
  type WeekDay,
} from '../../src/client/week-plan'
import { HomeCard } from '../../src/components/home-card'
import { OfferRow } from '../../src/components/offer-row'
import { PHOTO_COVER } from '../../src/client/routine-cover'
import { PageDots } from '@allfitone/react-native/page-dots'
import { ProgramCard } from '../../src/components/program-card'
import { DOCK_HEIGHT } from '../../src/components/tab-bar'

const EXPIRED = 'Tu sesión venció. Vuelve a entrar para continuar.'
const READ_FAILED = 'No pudimos cargar tu día. Inténtalo otra vez.'
const START_FAILED = 'No pudimos empezar la sesión. Inténtalo otra vez.'

/** What a destination that does not exist yet answers, instead of a blank screen. */
const PENDING: Record<string, string> = {
  free: 'Entrenar libre llega con tu contenido personal.',
  routines: 'Tus rutinas llegan con tu contenido personal.',
  food: 'Comida llega con el registro de nutrición.',
  progress: 'Tu progreso llega con el historial.',
  notices: 'Tus avisos llegan con las notificaciones.',
  history: 'El historial completo llega con su propia pantalla.',
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

      training
        .readToday(timezone)
        .then((current) => {
          if (!active) return
          setToday(current)
          // The catalogue is only read when there is a choice to make: somebody with a
          // program does not need twenty-four of them fetched behind their session.
          if (current.current_assignment === null) return programs.readCatalogue()
          // Con programa, lo que hace falta es la semana y la biblioteca. Van detrás y
          // no delante: la pantalla ya tiene qué dibujar arriba mientras llegan.
          void Promise.all([
            programs.readWeekPlan(timezone),
            content.readMyRoutines(),
            readExerciseLibrary(content),
          ])
            .then(([week, mine, read]) => {
              if (!active) return
              setPlan(week)
              setRoutines(mine)
              setLibrary(read)
            })
            .catch(() => undefined)
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
  const cards = useMemo(
    () => cardsFor(catalogue?.programs ?? [], profile),
    [catalogue?.programs, profile],
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
  const week = useMemo(() => weekCards(plan), [plan])
  const todayIs = useMemo(() => programDayOf(new Date()), [])
  const days = useMemo(() => weekDays(week, todayIs), [week, todayIs])

  /** Empezar la rutina de una tarjeta, o volver a la que quedó abierta. */
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

  return (
    <Screen edges={assigned ? [] : ['top', 'bottom']} style={assigned ? styles.bare : undefined}>
      {/* Sin la fotografía de fondo que llevaba antes. `FIN-2b` no la tiene, y con el
          carrusel ya no hace falta: la imagen de esta pantalla es la portada de cada
          rutina, que sí dice cuál es. Una encima de otra eran dos fotografías peleando
          por el mismo texto. */}

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
            {/* En caja baja y en la cara de texto, no en la condensada en versalitas:
                es un saludo, y `FIN-2b` lo escribe como se escribe un saludo. */}
            <Text role="control" size="xl" accessibilityRole="header">
              {profile.given_name ? `Hola, ${profile.given_name}` : 'Hola'}
            </Text>
            <Text role="body" size="sm" color="muted">
              {date}
            </Text>
          </View>
          <Bell onPress={() => setPending(PENDING.notices)} />
        </View>

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
            onOpen={(templateId) => router.push(`/routines/${templateId}`)}
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

        {assigned && today ? <Week week={today.week} days={days} /> : null}

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
                onPress={() => router.push('/programs/new')}
              />
            </View>
          </View>
        ) : null}

        {/* En lugar de los cuatro accesos rápidos, de los que ninguno llevaba a
            ninguna parte. Entrenar libre es lo único de aquellos cuatro que es un acto
            y no una pestaña, así que se queda, con su sitio propio encima del
            historial. */}
        {assigned ? (
          <OfferRow
            icon="freestyle"
            label="Entrenamiento libre"
            caption="Sin programa, registras sobre la marcha"
            tone="quiet"
            onPress={() => setPending(PENDING.free)}
          />
        ) : null}

        {assigned && today ? (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text role="control" size="md">
                Historial
              </Text>
              {today.week.history.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Ver todo el historial"
                  onPress={() => setPending(PENDING.history)}
                >
                  <Text role="control" size="xs" color="accent">
                    Ver todo
                  </Text>
                </Pressable>
              ) : null}
            </View>
            {today.week.history.length > 0 ? (
              // Un panel y no filas sueltas: lo que hay debajo del rótulo es una cosa
              // —lo entrenado— y el filete entre sesiones es lo que las separa.
              <Panel>
                {today.week.history.map((trained, index) => (
                  <TrainedRow
                    key={trained.executed_session_id}
                    first={index === 0}
                    day={shortDayLabel(trained.trained_on)}
                    title={trained.title ?? 'Sesión'}
                    detail={`${trained.sets_recorded} ${trained.sets_recorded === 1 ? 'serie' : 'series'}`}
                  />
                ))}
              </Panel>
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
function Carousel({
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
  const at = useSharedValue(0)
  const follow = useAnimatedScrollHandler((event) => {
    at.set(event.contentOffset.x / step)
  })

  // Cuál va delante, que sólo hace falta saber al parar: es lo que enciende su filo y
  // lo que se lee en voz alta. Un estado por fotograma para eso sería un render por
  // fotograma para algo que no cambia mientras el dedo se mueve.
  const [leadingIndex, setLeadingIndex] = useState(0)

  return (
    <View style={styles.carousel}>
      <Animated.ScrollView
        style={styles.bleed}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: DECK_GUTTER, gap: CARD_GAP }}
        onScroll={follow}
        onMomentumScrollEnd={(event) =>
          setLeadingIndex(
            Math.max(
              0,
              Math.min(week.length - 1, Math.round(event.nativeEvent.contentOffset.x / step)),
            ),
          )
        }
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
}

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
  // Las series de la semana salen del propio historial: es lo que se registró, no una
  // estimación de nada.
  const sets = week.history.reduce((total, trained) => total + trained.sets_recorded, 0)

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
        <Figure
          icon="weight"
          value={week.latest_weight ? weightLabel(week.latest_weight) : '—'}
          unit="Peso"
        />
      </View>
    </View>
  )
}

/** "70,2 kg", with the comma this market writes and no locale to trust. */
function weightLabel(measure: NonNullable<TodayPayload['week']['latest_weight']>): string {
  return `${String(measure.value).replace('.', ',')} ${measure.unit}`
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

/** La caja donde van las sesiones entrenadas, con su filo y su fondo. */
function Panel({ children }: { readonly children: React.ReactNode }) {
  const theme = useTheme()

  return (
    <View
      style={[
        styles.panel,
        {
          backgroundColor: theme.color.background.surface,
          borderColor: theme.color.border.subtle,
        },
      ]}
    >
      {children}
    </View>
  )
}

function TrainedRow({
  first,
  day,
  title,
  detail,
}: {
  /** La primera no lleva filete: un filete arriba del todo es el borde del panel. */
  readonly first: boolean
  readonly day: string
  readonly title: string
  readonly detail: string
}) {
  const theme = useTheme()

  return (
    <View
      style={[
        styles.trained,
        { borderColor: theme.color.border.subtle, borderTopWidth: first ? 0 : 1 },
      ]}
    >
      <Text role="control" size="xs" color="muted" style={styles.trainedDay}>
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

/** Glass, not a solid chip: it sits on a photograph, where a solid one reads as a sticker. */
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
  figures: { flexDirection: 'row', gap: 10 },
  figure: { flex: 1, gap: 6, borderWidth: 1, borderRadius: 20, padding: 12 },
  panel: { borderWidth: 1, borderRadius: 22, paddingHorizontal: 14 },
  trained: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
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
})
