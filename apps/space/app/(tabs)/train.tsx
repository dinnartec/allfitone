/**
 * FIN-6 · Entrenar — la biblioteca de lo que puedes entrenar.
 *
 * **Esta pestaña dejó de ser la semana y pasó a ser la biblioteca.** Antes mostraba las
 * rutinas de esta semana con un botón «Empezar» en cada fila; ahora muestra lo que la
 * persona tiene —sus programas y sus rutinas— con el programa en curso abierto encima.
 * El arranque no desapareció: lo hace el chevron de la fila, que es la misma distancia
 * con una palabra menos.
 *
 * **La etiqueta «Sigue esta» se queda.** Es lo único que dice cuál toca de las tres que
 * hay esta semana, y el botón que se fue no la llevaba: la llevaba la fila.
 *
 * **Un segmentado de verdad.** «Rutinas» era un enlace que llevaba a crear una rutina
 * nueva —un control que prometía una vista y abría otra cosa—; ahora es la otra mitad de
 * esta pantalla, con sus filtros y su dato: en qué programas está cada rutina, que
 * `OP-PLN-025` responde porque el cliente no podía deducirlo.
 *
 * **Sin programa no se dibuja un vacío.** La primera mitad se queda con las dos maneras
 * de llenarla —tomar uno de Allfit o crear el tuyo—, que es lo que un estante vacío
 * tiene que ofrecer. El catálogo entero sigue en su ruta y no se incrusta aquí.
 */

import { Badge } from '@allfitone/react-native/badge'
import { Button } from '@allfitone/react-native/button'
import { Chip } from '@allfitone/react-native/chip'
import { ContentRow } from '@allfitone/react-native/content-row'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { SegmentedControl } from '@allfitone/react-native/segmented-control'
import { Sheet } from '@allfitone/react-native/sheet'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { Image } from 'expo-image'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { ApiError } from '../../src/client'
import { discardFailure } from '../../src/client/save-failure'
import { createSpaceContentFlow } from '../../src/client/content-transport'
import { createSpaceExecutionFlow } from '../../src/client/execution-transport'
import { createSpaceProgramFlow } from '../../src/client/programs-transport'
import { readExerciseLibrary, type ExerciseLibrary } from '../../src/client/exercise-library'
import type { MyRoutine } from '../../src/client/content'
import type { MyProgram, WeekPlan } from '../../src/client/programs'
import {
  dayName,
  discardWarning,
  emptyReason,
  filteredRoutines,
  programCaption,
  routineCounts,
  routineFigures,
  whereUsed,
  type RoutineFilter,
} from '../../src/client/library'
import { cardsFor, weekPlanFailure, type RoutineCard } from '../../src/client/week-plan'
import { deviceTimezone } from '../../src/client/timezone'
import { RoutineMark } from '../../src/components/routine-mark'
import { DOCK_HEIGHT } from '../../src/components/tab-bar'

const EXPIRED = 'Tu sesión venció. Vuelve a entrar para continuar.'
const READ_FAILED = 'No pudimos cargar tu biblioteca. Inténtalo otra vez.'
const START_FAILED = 'No pudimos empezar la sesión. Inténtalo otra vez.'
const ORDER_FAILED = 'No pudimos cambiar de programa. Inténtalo otra vez.'

type Segment = 'programas' | 'rutinas'

/** Lo que ocupa la fotografía de un programa. Alta para que la imagen se vea, no se intuya. */
const HERO = 190

const SEGMENTS = [
  { value: 'programas' as const, label: 'Programas' },
  { value: 'rutinas' as const, label: 'Rutinas' },
]

const FILTERS: readonly { value: RoutineFilter; label: string }[] = [
  { value: 'todas', label: 'Todas' },
  { value: 'en-programa', label: 'En programa' },
  { value: 'sueltas', label: 'Sueltas' },
]

export default function Train() {
  const router = useRouter()
  const theme = useTheme()
  const programs = useMemo(() => createSpaceProgramFlow(), [])
  const content = useMemo(() => createSpaceContentFlow(), [])
  const training = useMemo(() => createSpaceExecutionFlow(), [])
  const timezone = useMemo(() => deviceTimezone(), [])

  const [segment, setSegment] = useState<Segment>('programas')
  const [filter, setFilter] = useState<RoutineFilter>('todas')
  const [plan, setPlan] = useState<WeekPlan | undefined>(undefined)
  const [mine, setMine] = useState<readonly MyProgram[]>([])
  const [routines, setRoutines] = useState<readonly MyRoutine[]>([])
  const [library, setLibrary] = useState<ExerciseLibrary | undefined>(undefined)
  // La rutina cuyo menú está abierto. Guardada entera y no por id: la hoja escribe su
  // nombre, y buscarla otra vez en una lista que acaba de cambiar es cómo se pregunta
  // «¿descartar undefined?».
  const [menu, setMenu] = useState<MyRoutine | undefined>(undefined)
  const [starting, setStarting] = useState<string | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  /**
   * Todo de una vez, porque las dos mitades del segmentado se dibujan de lo mismo y
   * cambiar de solapa no puede costar una espera.
   *
   * La semana falla con 404 cuando no hay programa, y eso no es un error: es el estante
   * vacío. Se recoge aparte para que no apague el resto de la pantalla.
   */
  const load = useCallback(() => {
    programs
      .readWeekPlan(timezone)
      .then(setPlan)
      .catch((cause: unknown) => {
        const meaning = weekPlanFailure(cause instanceof ApiError ? cause.failure : undefined)
        if (meaning === 'unassigned') setPlan(undefined)
        else setFailure(meaning === 'expired' ? EXPIRED : READ_FAILED)
      })
    Promise.all([programs.readMyPrograms(), content.readMyRoutines(), readExerciseLibrary(content)])
      .then(([programmes, mineRoutines, read]) => {
        setMine(programmes)
        setRoutines(mineRoutines)
        setLibrary(read)
      })
      .catch((cause: unknown) => {
        setFailure(
          cause instanceof ApiError && cause.failure === 'unauthenticated' ? EXPIRED : READ_FAILED,
        )
      })
  }, [content, programs, timezone])

  // En foco y no al montar: la pestaña se queda montada, así que montar ocurre una vez y
  // no vería una rutina escrita ni una sesión cerrada en otro sitio.
  useFocusEffect(load)

  const cards = cardsFor(plan)
  const current = mine.find((one) => one.program_version_id === plan?.program_version_id)
  const others = mine.filter((one) => one.program_version_id !== plan?.program_version_id)
  const counts = routineCounts(routines)
  const shown = filteredRoutines(routines, filter)

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
   * Cambiar de programa es ponerlo primero.
   *
   * `OP-PLN-024` dice que la pestaña abre en la primera asignación, así que elegir uno es
   * adelantarlo y dejar el resto como estaba. No hay un «programa actual» aparte que
   * escribir, e inventarlo sería una segunda fuente de verdad para algo que el orden ya
   * responde.
   */
  const select = (assignmentId: string) => {
    const order = [
      assignmentId,
      ...mine.filter((one) => one.assignment_id !== assignmentId).map((one) => one.assignment_id),
    ]
    setMine((held) =>
      order
        .map((id) => held.find((one) => one.assignment_id === id))
        .filter((one): one is MyProgram => one !== undefined),
    )
    programs
      .reorder(order)
      .then((ordered) => {
        setMine(ordered)
        return programs.readWeekPlan(timezone)
      })
      .then(setPlan)
      .catch(() => setFailure(ORDER_FAILED))
  }

  const discard = (routine: MyRoutine) => {
    setMenu(undefined)
    content
      .discardTemplate(routine.template_id)
      .then(() =>
        setRoutines((held) => held.filter((one) => one.template_id !== routine.template_id)),
      )
      .catch((cause: unknown) => setFailure(discardFailure(cause, routine.programs)))
  }

  return (
    <Screen edges={['top', 'bottom']}>
      {/* La cabecera no se va con el desplazamiento: es el sitio donde se cambia de
          mitad, y una que se escapa obliga a subir para volver. */}
      <View style={styles.frame}>
        <View style={styles.header}>
          <Text role="control" size="2xl" accessibilityRole="header">
            Entrenar
          </Text>
          {/* Sin preguntar qué: el segmentado ya lo dijo. Una hoja que vuelve a
              preguntar entre dos cosas, con una de ellas abierta delante, es un paso
              que sólo existe porque la pantalla no se fía de lo que muestra. */}
          <Button
            label="Crear"
            icon="create"
            size="sm"
            variant="secondary"
            accessibilityLabel={segment === 'programas' ? 'Crear un programa' : 'Crear una rutina'}
            onPress={() => router.push(segment === 'programas' ? '/programs/new' : '/routines/new')}
          />
        </View>
        <SegmentedControl
          items={SEGMENTS}
          value={segment}
          // Cambiar de mitad se lleva el aviso: hablaba de lo que estabas mirando, y
          // dejarlo colgando sobre la otra lista lo convierte en un cartel sin dueño.
          onChange={(next) => {
            setFailure(undefined)
            setSegment(next)
          }}
          accessibilityLabel="Qué parte de tu biblioteca ver"
        />
        {/* Los filtros son cabecera, no lista: filtran lo que hay debajo, y uno que se
            va con el desplazamiento obliga a subir para cambiar de filtro. */}
        {segment === 'rutinas' ? (
          <View style={styles.filters}>
            {FILTERS.map((one) => (
              <Chip
                key={one.value}
                label={one.label}
                count={counts[one.value]}
                selected={filter === one.value}
                onPress={() => setFilter(one.value)}
              />
            ))}
          </View>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: DOCK_HEIGHT + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {failure ? <InlineAlert message={failure} onDismiss={() => setFailure(undefined)} /> : null}

        {segment === 'programas' ? (
          <>
            {current && cards.length > 0 ? (
              <CurrentProgram
                program={current}
                coverUrl={current.cover_url}
                week={plan?.program_week}
                cards={cards}
                starting={starting}
                onStart={start}
                onOpen={() => {
                  if (current.editable) router.push(`/programs/edit/${current.program_id}`)
                }}
              />
            ) : null}

            {others.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.sectionHead}>
                  <Text role="control" size="lg">
                    Tus otros programas
                  </Text>
                  <Text role="control" size="sm" color="accent">
                    {String(others.length)}
                  </Text>
                </View>
                {others.map((program) => (
                  <ContentRow
                    key={program.assignment_id}
                    name={program.title}
                    caption={programCaption(program)}
                    preview={
                      program.cover_url === null ? (
                        <FoundationIcon
                          name="checklist"
                          size="sm"
                          color={theme.color.icon.secondary}
                          decorative
                        />
                      ) : (
                        <Image
                          source={program.cover_url}
                          style={styles.thumbnail}
                          contentFit="cover"
                          transition={200}
                        />
                      )
                    }
                    onPress={() => select(program.assignment_id)}
                    accessibilityLabel={`Entrenar ${program.title}`}
                    trailing={
                      program.editable
                        ? {
                            kind: 'action',
                            icon: 'edit',
                            accessibilityLabel: `Editar ${program.title}`,
                            onPress: () => router.push(`/programs/edit/${program.program_id}`),
                          }
                        : { kind: 'chevron' }
                    }
                  />
                ))}
              </View>
            ) : null}

            {/* Siempre, y no sólo cuando no hay nada: tomar otro programa es algo que se
                hace con seis ya tomados, y esconderlo entonces es esconderlo justo
                cuando alguien sabe lo que busca. */}
            <ContentRow
              name="Programas de Allfit"
              caption="Planes armados por el equipo"
              tone="plain"
              preview={
                <FoundationIcon
                  name="checklist"
                  size="sm"
                  color={theme.color.icon.accent}
                  decorative
                />
              }
              trailing={{ kind: 'chevron', tone: 'accent' }}
              onPress={() => router.push('/programs')}
            />
          </>
        ) : (
          <>
            {shown.map((routine) => {
              const used = whereUsed(routine)
              return (
                <ContentRow
                  key={routine.template_id}
                  name={routine.title}
                  caption={routineFigures(routine)}
                  note={used.text}
                  noteTone={used.loose ? 'quiet' : 'accent'}
                  preview={<RoutineMark routine={routine} library={library} />}
                  onPress={() => router.push(`/routines/${routine.template_id}`)}
                  trailing={{
                    kind: 'action',
                    icon: 'more',
                    accessibilityLabel: `Más opciones de ${routine.title}`,
                    onPress: () => setMenu(routine),
                  }}
                />
              )
            })}

            {shown.length === 0 ? (
              <Text role="body" size="sm" color="muted" style={styles.empty}>
                {emptyReason(filter)}
              </Text>
            ) : null}

            <ContentRow
              name="Crear rutina"
              caption="Elige ejercicios, series y repeticiones"
              tone="plain"
              preview={
                <FoundationIcon
                  name="create"
                  size="sm"
                  color={theme.color.icon.accent}
                  decorative
                />
              }
              trailing={{ kind: 'chevron', tone: 'accent' }}
              onPress={() => router.push('/routines/new')}
            />
          </>
        )}
      </ScrollView>

      <Sheet
        visible={menu !== undefined}
        onDismiss={() => setMenu(undefined)}
        title={menu?.title ?? ''}
      >
        <View style={styles.sheetActions}>
          <Button
            label="Editar"
            variant="secondary"
            icon="edit"
            onPress={() => {
              const chosen = menu
              setMenu(undefined)
              if (chosen) router.push(`/routines/${chosen.template_id}`)
            }}
          />
          {/* Lo que se pierde, dicho antes de perderlo. Una rutina que está en un
              programa se archiva igual, pero los programas que la usan se quedan con la
              versión que congelaron, y eso hay que decirlo en vez de dejar que se
              descubra. */}
          <Text role="body" size="xs" color="muted">
            {menu ? discardWarning(menu) : ''}
          </Text>
          <Button
            label="Descartar"
            variant="ghost"
            icon="remove"
            onPress={() => {
              if (menu) discard(menu)
            }}
          />
        </View>
      </Sheet>
    </Screen>
  )
}

/**
 * El programa en curso, abierto.
 *
 * Es la única tarjeta de la pantalla que se despliega, y por eso no lleva chevron: lo
 * que hay dentro ya está a la vista. Las filas de dentro sí lo llevan, porque cada una
 * arranca su sesión.
 */
function CurrentProgram({
  program,
  coverUrl,
  week,
  cards,
  starting,
  onStart,
  onOpen,
}: {
  readonly program: MyProgram
  readonly coverUrl: string | null
  readonly week: number | undefined
  readonly cards: readonly RoutineCard[]
  readonly starting: string | undefined
  readonly onStart: (card: RoutineCard) => void
  readonly onOpen: () => void
}) {
  const theme = useTheme()

  return (
    <View style={[styles.current, { backgroundColor: theme.color.background.surface }]}>
      {/* La fotografía va debajo de todo y atenuada: es el fondo de un nombre, no una
          imagen que mirar. El velo del sistema de diseño la lleva hasta el color de la
          tarjeta, que es lo que deja el texto legible sin una caja detrás. */}
      {/* Una banda de verdad, con el contenido anclado arriba y abajo. Antes la
          fotografía iba detrás del texto y quedaba un filo asomando: se veía que había
          una imagen sin llegar a verse cuál.
          **Y sin velo propio**, que es lo que decía este comentario y llevaba uno igual:
          el tratamiento —desaturar, enfriar, realzar y la caída al pie— ya viene horneado
          en el archivo, así que un `Scrim` encima la ponía azul y la borraba. */}
      <View style={[styles.hero, coverUrl === null ? null : styles.heroTall]}>
        {coverUrl === null ? null : (
          <>
            <Image source={coverUrl} style={styles.heroPhoto} contentFit="cover" transition={200} />
          </>
        )}

        <View style={styles.currentHead}>
          <Badge label="En curso" tone="accent" variant="quiet" />
          {program.editable ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Editar ${program.title}`}
              onPress={onOpen}
              hitSlop={8}
              style={[styles.round, { backgroundColor: theme.color.background.surfaceMuted }]}
            >
              <FoundationIcon name="edit" size="xs" color={theme.color.icon.secondary} decorative />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.currentText}>
          <Text role="display" size="lg" uppercase numberOfLines={1}>
            {program.title}
          </Text>
          <Text role="body" size="xs" color="muted">
            {programCaption(program, week)}
          </Text>
        </View>
      </View>

      <View style={styles.week}>
        {cards.map((card, index) => (
          <View key={card.routine.planned_session_id}>
            {index === 0 ? null : (
              <View style={[styles.hairline, { backgroundColor: theme.color.border.subtle }]} />
            )}
            <WeekRow
              card={card}
              busy={starting === card.routine.planned_session_id}
              onPress={() => onStart(card)}
            />
          </View>
        ))}
      </View>
    </View>
  )
}

/** Una sesión de la semana. El chevron es el botón que se fue. */
function WeekRow({
  card,
  busy,
  onPress,
}: {
  readonly card: RoutineCard
  readonly busy: boolean
  readonly onPress: () => void
}) {
  const theme = useTheme()
  const day = dayName(card.routine.program_day)

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${card.state === 'done' ? 'Repetir' : 'Empezar'} ${card.routine.title}`}
      accessibilityHint={day}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.weekRow, { opacity: pressed || busy ? 0.7 : 1 }]}
    >
      <View style={[styles.letter, { backgroundColor: theme.color.background.surfaceMuted }]}>
        <Text role="control" size="xs" color="accent">
          {(card.routine.title.trim()[0] ?? '·').toUpperCase()}
        </Text>
      </View>

      <View style={styles.weekText}>
        <View style={styles.weekName}>
          <Text role="control" size="sm" numberOfLines={1}>
            {card.routine.title}
          </Text>
          {card.state === 'suggested' ? (
            <Badge label="Sigue esta" tone="accent" variant="quiet" />
          ) : null}
          {card.state === 'open' ? <Badge label="A medias" tone="accent" variant="quiet" /> : null}
        </View>
        <Text role="body" size="xs" color="muted">
          {routineFigures(card.routine)}
        </Text>
      </View>

      {card.state === 'done' ? (
        <FoundationIcon name="success" size="xs" color={theme.color.icon.accent} decorative />
      ) : (
        <Text role="control" size="xs" color="accent">
          {day}
        </Text>
      )}
      <FoundationIcon name="next" size="xs" color={theme.color.icon.secondary} decorative />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  frame: { gap: 14, paddingBottom: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  content: { gap: 14 },
  section: { gap: 10 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  filters: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  empty: { paddingVertical: 24, textAlign: 'center' },
  sheetActions: { gap: 12 },

  current: { borderRadius: 24, overflow: 'hidden' },
  currentHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    paddingBottom: 0,
  },
  currentText: { gap: 3, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14 },
  hero: { justifyContent: 'space-between' },
  heroTall: { height: HERO },
  heroPhoto: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  round: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },

  week: { paddingHorizontal: 16, paddingBottom: 14 },
  weekRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 8 },
  weekText: { flex: 1, gap: 1 },
  weekName: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  letter: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hairline: { height: 1 },
  thumbnail: { width: '100%', height: '100%' },
})
