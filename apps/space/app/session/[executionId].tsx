/**
 * X-1 · Sesión en curso — HU-SP-100.
 *
 * The screen somebody has open while they train, which makes it the one screen where
 * losing what was typed is unforgivable.
 *
 * **The working state lives here and is sent whole.** `OP-EXE-005` is a replace, not a
 * patch: editing the set logged four sets ago sends the session as it now stands, so
 * there is never a half-applied session and never a merge to reason about. The
 * revision the server last answered is the optimistic lock the next write carries.
 *
 * **A set counts when it is ticked, not when it is typed.** Somebody who does three
 * sets instead of four has done three; the target only decides how many empty rows
 * open. What is saved is what was ticked.
 *
 * **One exercise is open at a time.** The canvas expands the exercise in play and
 * collapses the rest to a row with its own progress, which is what makes a
 * twelve-exercise session readable on a phone between sets.
 *
 * **Accent marks where you are, not where you could be.** Every empty field outlined in
 * cyan made the card read as an alarm, and Ink & Signal reserves the colour for action,
 * focus and selection — an untouched field is none of those. The field lights up when
 * it has focus, and the open card is set apart by its fill alone, with no edge.
 *
 * **Opening an exercise is animated because the list moves under it.** Swapping a
 * 44-point row for a 300-point card with no transition reads as a glitch, and somebody
 * mid-set loses their place. Durations and easings come from `theme.motion`, so this
 * screen cannot drift from the rest of the system, and Reanimated drops the animation
 * on its own when the system asks for reduced motion.
 *
 * **The pain report is not here.** The canvas carries a "registrar una molestia" row;
 * `execution.pain_reports` does not exist, and a row that silently discards what
 * somebody typed about their body would be worse than its absence.
 */

import { Button } from '@allfitone/react-native/button'
import { IconButton } from '@allfitone/react-native/icon-button'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Sheet } from '@allfitone/react-native/sheet'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { transparent } from '@allfitone/react-native/tokens'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { Image } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'

import { ApiError } from '../../src/client'
import { createSpaceContentFlow } from '../../src/client/content-transport'
import { FROM_SESSION } from '../../src/client/exercise-pick'
import { readExerciseLibrary } from '../../src/client/exercise-library'
import { createSpaceExecutionFlow } from '../../src/client/execution-transport'
import { SPRING } from '../../src/client/motion'
import {
  canFinish,
  elapsedLabel,
  resultsFrom,
  setsProgress,
  totalVolumeKg,
  withExtraSet,
  withoutSet,
  workingStateFrom,
  type WorkingExercise,
  type WorkingSet,
} from '../../src/client/session-form'

const READ_FAILED = 'No pudimos abrir la sesión. Inténtalo otra vez.'
const SAVE_FAILED = 'No pudimos guardar. Lo intentamos otra vez en un momento.'
const STALE = 'Otra pantalla cambió esta sesión. Vuelve a abrirla para seguir.'
const CLOSE_FAILED = 'No pudimos cerrar la sesión. Inténtalo otra vez.'
const LEAVE_FAILED = 'No pudimos dejar la sesión. Inténtalo otra vez.'

/** Long enough to stop writing on every keystroke, short enough to never lose a set. */
const SAVE_DELAY_MS = 1_200

/**
 * The accordion.
 *
 * One spring drives everything: the drawer's height, the shell going from a bare row
 * to a card, the chevron turning. Opening one exercise sets its progress to 1 and the
 * previous one's to 0 in the same render, so they move together — the open one folds
 * away exactly as the new one unfolds, which is what makes it read as one accordion
 * rather than two independent things happening near each other.
 *
 * The drawer's height is measured, not guessed. An absolutely positioned copy of the
 * content reports its natural height through `onLayout`; the clipping view above it
 * then animates between zero and that number. Nothing else can animate a height that
 * depends on how many sets an exercise has.
 */
/**
 * How far a row travels to offer its delete.
 *
 * Short on purpose: the gesture reveals an action, it does not open a drawer, and a
 * long throw would fight the vertical scroll it shares the surface with.
 */
const REVEAL = 12

/** Past this much of the throw the row commits rather than springing back. */
const REVEAL_THRESHOLD = 24

/** The open card's bottom padding, which grows with the drawer rather than snapping. */
const OPEN_PADDING = 16

/**
 * The inset every row keeps, open or shut.
 *
 * It has to be constant. Growing it with the drawer moved the number sideways as its
 * row expanded, and a number that does not line up with the one above it reads as a
 * mistake rather than as a state.
 */
const CARD_INSET = 8

export default function Session() {
  const router = useRouter()
  const theme = useTheme()
  const { executionId } = useLocalSearchParams<{ executionId: string }>()
  const flow = useMemo(() => createSpaceExecutionFlow(), [])

  const [exercises, setExercises] = useState<readonly WorkingExercise[]>([])
  const [openPosition, setOpenPosition] = useState(1)
  const [title, setTitle] = useState('')
  const [caption, setCaption] = useState('')
  const [startedAt, setStartedAt] = useState<number | undefined>(undefined)
  const [seconds, setSeconds] = useState(0)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [closing, setClosing] = useState(false)
  const [deciding, setDeciding] = useState(false)

  /** Each movement's demonstration, by id: the catalogue's, not the session's. */
  const [previews, setPreviews] = useState<ReadonlyMap<string, string | null>>(new Map())

  // Behind the session, not in front of it: the sets are what somebody came to log.
  useEffect(() => {
    let active = true
    readExerciseLibrary(createSpaceContentFlow())
      .then((library) => {
        if (active) setPreviews(new Map(library.movements.map((one) => [one.id, one.demo_url])))
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  const revision = useRef(0)
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    let active = true

    flow
      .readExecution(executionId)
      .then((current) => {
        if (!active) return
        revision.current = current.revision_number
        setTitle(current.title ?? 'Sesión')
        // The program and the week, not the discipline code: a code is an identifier,
        // and putting one on screen is showing somebody the plumbing.
        setCaption(
          current.program_title
            ? `${current.program_title}${current.week ? ` · semana ${current.week}` : ''}`
            : '',
        )
        setStartedAt(Date.parse(current.started_at))
        setExercises(workingStateFrom(current))
      })
      .catch(() => {
        if (active) setFailure(READ_FAILED)
      })

    return () => {
      active = false
    }
  }, [flow, executionId])

  // Driven from the session's own start, not from a counter: a screen that slept for
  // ten minutes has to come back showing ten minutes, not the ticks it missed.
  useEffect(() => {
    if (startedAt === undefined) return
    const tick = () => setSeconds((Date.now() - startedAt) / 1000)
    tick()
    const timer = setInterval(tick, 1_000)
    return () => clearInterval(timer)
  }, [startedAt])

  const save = useCallback(
    (next: readonly WorkingExercise[]) => {
      if (pending.current) clearTimeout(pending.current)
      pending.current = setTimeout(() => {
        flow
          .save(executionId, revision.current, resultsFrom(next))
          .then((revised) => {
            revision.current = revised
            setFailure(undefined)
          })
          .catch((cause: unknown) => {
            setFailure(
              cause instanceof ApiError && cause.failure === 'conflict' ? STALE : SAVE_FAILED,
            )
          })
      }, SAVE_DELAY_MS)
    },
    [flow, executionId],
  )

  const edit = (
    position: number,
    order: number,
    change: Partial<{ loadKg: string; reps: string; done: boolean }>,
  ) => {
    setExercises((current) => {
      const next = current.map((exercise) =>
        exercise.position !== position
          ? exercise
          : {
              ...exercise,
              sets: exercise.sets.map((set) => (set.order === order ? { ...set, ...change } : set)),
            },
      )
      // Only a tick changes what is recorded; typing into a row nobody ticked yet
      // changes nothing the server would store.
      if (change.done !== undefined || next.some((e) => e.sets.some((s) => s.done))) save(next)
      return next
    })
  }

  const addSet = (position: number) => {
    setExercises((current) => withExtraSet(current, position))
  }

  const removeSet = (position: number, order: number) => {
    setExercises((current) => {
      const next = withoutSet(current, position, order)
      // Deleting is a change to the session, and the session is sent whole.
      save(next)
      return next
    })
  }

  const finish = () => {
    if (pending.current) clearTimeout(pending.current)
    setDeciding(false)
    setClosing(true)
    flow
      .save(executionId, revision.current, resultsFrom(exercises))
      .then((revised) => {
        revision.current = revised
        return flow.finish(executionId)
      })
      .then(() => router.replace('/today'))
      .catch(() => {
        setClosing(false)
        setFailure(CLOSE_FAILED)
      })
  }

  const leave = () => {
    if (pending.current) clearTimeout(pending.current)
    setDeciding(false)
    setClosing(true)
    flow
      .abandon(executionId)
      .then(() => router.replace('/today'))
      .catch(() => {
        setClosing(false)
        setFailure(LEAVE_FAILED)
      })
  }

  // A sheet over the session, so the timer and the sets are still there on the way back.
  const explainer = (movementId: string | null) =>
    movementId
      ? () =>
          router.push({
            pathname: '/how-to/[movementId]',
            params: { movementId, from: FROM_SESSION },
          })
      : undefined

  // Opened from a link there is nothing beneath it, and Hoy is where it waits.
  const minimize = () => (router.canGoBack() ? router.back() : router.replace('/today'))

  const progress = setsProgress(exercises)
  const volume = totalVolumeKg(exercises)
  const recorded = canFinish(exercises)

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.header}>
        {/* Down, not back: the session is set aside, still open, and Hoy carries it. */}
        <IconButton icon="expand" accessibilityLabel="Minimizar la sesión" onPress={minimize} />
        <View style={styles.heading}>
          <Text role="control" size="lg" numberOfLines={2} accessibilityRole="header">
            {title}
          </Text>
          {caption ? (
            <Text role="body" size="sm" color="muted">
              {caption}
            </Text>
          ) : null}
        </View>
        {/* Shorter than the canvas's 34pt pill: the DS floors every action at the
            platform touch target, and DT-010 makes that a launch requirement.
            Never disabled: leaving a session is a decision somebody has to be able to
            make, and a dead button gives them nowhere to go. With nothing recorded it
            drops the accent, because there is nothing to save yet. */}
        <Button
          label="Terminar"
          variant={recorded ? 'primary' : 'secondary'}
          onPress={() => setDeciding(true)}
          loading={closing}
          style={styles.finish}
        />
      </View>

      <View
        style={[
          styles.scoreboard,
          {
            backgroundColor: theme.color.background.surface,
            borderColor: theme.color.border.subtle,
          },
        ]}
      >
        <Score label="TIEMPO" value={elapsedLabel(seconds)} accent />
        <View style={[styles.divider, { backgroundColor: theme.color.border.subtle }]} />
        <Score label="VOLUMEN" value={`${Math.round(volume).toLocaleString('es-CO')} kg`} />
        <View style={[styles.divider, { backgroundColor: theme.color.border.subtle }]} />
        <Score label="SERIES" value={`${progress.done} / ${progress.planned}`} />
      </View>

      {failure ? <InlineAlert message={failure} /> : null}

      {/* `handled`: with the keyboard up, the tap on a tick used to only close it and
          had to be made twice. A tap on nothing still closes it. */}
      <ScrollView
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {exercises.map((exercise) => (
          <Exercise
            key={exercise.position}
            exercise={exercise}
            picture={exercise.movementId ? (previews.get(exercise.movementId) ?? null) : null}
            open={exercise.position === openPosition}
            onToggle={() =>
              setOpenPosition((current) => (current === exercise.position ? 0 : exercise.position))
            }
            onEdit={(order, change) => edit(exercise.position, order, change)}
            onAddSet={() => addSet(exercise.position)}
            onRemoveSet={(order) => removeSet(exercise.position, order)}
            onExplain={explainer(exercise.movementId)}
          />
        ))}

        {/* Its place in the layout, and nothing more. There is no operation for adding a
            movement to a session in flight — not in the contract, not in the database —
            so an enabled button would be a promise the app cannot keep. Disabled and
            said out loud is the same answer the discipline carousel gives for the five
            that are not built. */}
        <View style={styles.addExercise}>
          <Button label="Añadir ejercicio" variant="secondary" disabled onPress={() => undefined} />
          <Text role="body" size="sm" color="muted">
            Todavía no. Por ahora la sesión es la que trae tu rutina.
          </Text>
        </View>
      </ScrollView>

      <Sheet
        visible={deciding}
        onDismiss={() => setDeciding(false)}
        title="¿Qué hacemos con esta sesión?"
      >
        <View style={styles.decisions}>
          <Button label="Guardar entrenamiento" onPress={finish} disabled={!recorded} />
          {/* Said plainly, because the word promises more than it does: the attempt
              stays in the history with whatever it reached. */}
          <Text role="body" size="xs" color="muted">
            {recorded
              ? 'Se guarda como terminado y cuenta en tu semana.'
              : 'Todavía no has marcado ninguna serie, así que no hay nada que guardar.'}
          </Text>

          <Button label="Descartar entrenamiento" variant="secondary" onPress={leave} />
          <Text role="body" size="sm" color="muted">
            No se borra. Queda en tu historial como una sesión sin terminar.
          </Text>

          <Button label="Regresar" variant="ghost" onPress={() => setDeciding(false)} />
        </View>
      </Sheet>
    </Screen>
  )
}

function Score({
  label,
  value,
  accent = false,
}: {
  readonly label: string
  readonly value: string
  readonly accent?: boolean
}) {
  return (
    <View style={styles.score}>
      <Text role="data" size="2xl" color={accent ? 'accent' : 'primary'}>
        {value}
      </Text>
      <Text role="eyebrow" size="xs" color="muted">
        {label}
      </Text>
    </View>
  )
}

/**
 * One exercise, open or shut, and every state in between.
 *
 * A single component rather than two, because two meant the header jumped from one
 * tree to another mid-animation and nothing could interpolate across the swap. Here the
 * header never unmounts: what changes is the drawer's height, the shell's fill,
 * and which way the chevron points — all off the same spring.
 */
function Exercise({
  exercise,
  picture,
  open,
  onToggle,
  onEdit,
  onAddSet,
  onRemoveSet,
  onExplain,
}: {
  readonly exercise: WorkingExercise
  readonly picture: string | null
  readonly open: boolean
  readonly onToggle: () => void
  readonly onEdit: (
    order: number,
    change: Partial<{ loadKg: string; reps: string; done: boolean }>,
  ) => void
  readonly onAddSet: () => void
  readonly onRemoveSet: (order: number) => void
  /** Absent when the step names no catalogue movement: there is nothing to explain. */
  readonly onExplain: (() => void) | undefined
}) {
  const theme = useTheme()
  const progress = useSharedValue(0)
  const drawerHeight = useSharedValue(0)
  const reduceMotion = useReducedMotion()

  const done = exercise.sets.filter((set) => set.done).length
  const complete = done === exercise.sets.length && done > 0

  useEffect(() => {
    // Reduced motion keeps the change and drops the travel: which exercise is open is
    // state the drawer exists to report, so it still opens — it just does not fly.
    const target = open ? 1 : 0
    progress.value = reduceMotion ? target : withSpring(target, SPRING)
  }, [open, progress, reduceMotion])

  // Each fade ramps the alpha of the token it lands on, so nothing in between is a
  // colour the Design System does not have. Fading from `transparent` instead would
  // run both of these through black.
  const surface = theme.color.background.surface
  const noSurface = transparent(surface)

  const shell = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [noSurface, surface]),
    paddingBottom: OPEN_PADDING * progress.value,
  }))

  const drawer = useAnimatedStyle(() => ({
    // Always a number. Falling back to `undefined` while the height was unknown let
    // a shut drawer take its natural height for a frame, which is the empty block
    // that appeared and vanished between rows.
    height: drawerHeight.value * progress.value,
  }))

  // The content slides out from under the header on the same spring that opens the
  // clip. Without it the rows are uncovered in place, which reads as a box being
  // resized rather than as a drawer being pulled.
  const contents = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (progress.value - 1) * drawerHeight.value }],
  }))

  const chevron = useAnimatedStyle(() => ({
    transform: [{ rotate: `${progress.value * 180}deg` }],
  }))

  const summary = useAnimatedStyle(() => ({ opacity: 1 - progress.value }))

  const thread = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    backgroundColor: complete ? theme.color.status.success : theme.color.border.default,
  }))

  const body = (
    <>
      <View style={styles.columns}>
        <Text role="eyebrow" size="xs" color="muted" align="center" style={styles.colSet}>
          SERIE
        </Text>
        <Text role="eyebrow" size="xs" color="muted" numberOfLines={1} style={styles.colPrevious}>
          ANTERIOR
        </Text>
        <Text role="eyebrow" size="xs" color="muted" align="center" style={styles.colInput}>
          KG
        </Text>
        <Text role="eyebrow" size="xs" color="muted" align="center" style={styles.colInput}>
          REPS
        </Text>
        <View style={styles.colTick} />
      </View>

      {exercise.sets.map((set, index) => (
        <SetRow
          key={set.order}
          set={set}
          index={index}
          onEdit={(change) => onEdit(set.order, change)}
          onRemove={() => onRemoveSet(set.order)}
        />
      ))}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Añadir una serie a ${exercise.movement}`}
        onPress={onAddSet}
        style={styles.addSet}
        hitSlop={8}
      >
        <FoundationIcon name="add" customSize={12} color={theme.color.icon.accent} decorative />
        <Text role="control" size="sm" color="accent">
          Añadir serie
        </Text>
      </Pressable>
    </>
  )

  return (
    <Animated.View style={[styles.shell, shell]}>
      {/* Two controls side by side, not one inside the other: nested, VoiceOver folds the
          picture into the row and the explanation cannot be reached. */}
      <View style={styles.exerciseHeader}>
        <Animated.View style={[styles.thread, thread]} />
        {/* Still, like the routine editor. The picture explains, open or shut, and the
            rest of the row opens and closes: the play mark promises what a tap does. */}
        <Pressable
          onPress={onExplain ?? onToggle}
          accessibilityRole={onExplain ? 'button' : undefined}
          accessibilityLabel={onExplain ? `Cómo se hace ${exercise.movement}` : undefined}
          accessible={onExplain !== undefined}
          hitSlop={4}
        >
          <Image
            source={picture}
            style={[styles.preview, { backgroundColor: theme.color.background.surfaceSubtle }]}
            contentFit="contain"
            autoplay={false}
            recyclingKey={exercise.movementId}
            accessible={false}
          />
          {onExplain ? (
            <View style={[styles.play, { backgroundColor: theme.color.background.canvas }]}>
              <FoundationIcon
                name="start"
                customSize={9}
                color={theme.color.icon.accent}
                decorative
              />
            </View>
          ) : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={exercise.movement}
          onPress={onToggle}
          style={styles.headerToggle}
        >
          <View style={[styles.headerTitle, styles.headerOpen]}>
            <Text role="control" size="md" numberOfLines={1} style={styles.headerFlex}>
              {exercise.movement}
            </Text>
          </View>
          <Animated.View style={[styles.summary, summary]}>
            {/* A tick as well as the colour. Green alone is a difference some people
                cannot see, and WCAG 1.4.1 does not accept colour as the only signal. */}
            {complete ? (
              <FoundationIcon
                name="success"
                size="xs"
                color={theme.color.status.success}
                decorative
              />
            ) : null}
            <Text role="control" size="xs" color={complete ? 'success' : 'muted'}>
              {`${done} de ${exercise.sets.length}`}
            </Text>
          </Animated.View>
          <Animated.View style={chevron}>
            <FoundationIcon name="expand" size="xs" color={theme.color.icon.secondary} decorative />
          </Animated.View>
        </Pressable>
      </View>

      <Animated.View style={[styles.drawer, drawer]}>
        {/* Out of flow, so it can never add its height to the row it is measuring.
            In flow it did, and a shut drawer briefly claimed the space it would take
            if it were open. */}
        <Animated.View
          style={[styles.measure, contents]}
          onLayout={(event) => {
            const height = event.nativeEvent.layout.height
            if (height > 0) drawerHeight.value = height
          }}
        >
          {body}
        </Animated.View>
      </Animated.View>
    </Animated.View>
  )
}

/**
 * One set, and the delete it hides.
 *
 * Sliding left turns the tick into a delete. It is the same cell and the same size —
 * what changes is what it means — so nothing reflows and the row still reads as a
 * row. The throw is short and the gesture only claims the horizontal axis, or it
 * would fight the vertical scroll it sits inside.
 */
function SetRow({
  set,
  index,
  onEdit,
  onRemove,
}: {
  readonly set: WorkingSet
  readonly index: number
  readonly onEdit: (change: Partial<{ loadKg: string; reps: string; done: boolean }>) => void
  readonly onRemove: () => void
}) {
  const theme = useTheme()
  const revealed = useSharedValue(0)
  const [armed, setArmed] = useState(false)

  const swipe = Gesture.Pan()
    // Only the horizontal axis: the vertical one belongs to the scroll.
    .activeOffsetX([-12, 12])
    .failOffsetY([-8, 8])
    .onUpdate((event) => {
      const pulled = Math.min(Math.max(-event.translationX, 0), REVEAL_THRESHOLD)
      revealed.value = pulled / REVEAL_THRESHOLD
    })
    .onEnd((event) => {
      const open = -event.translationX > REVEAL_THRESHOLD / 2 || event.velocityX < -400
      revealed.value = withSpring(open ? 1 : 0, SPRING)
      runOnJS(setArmed)(open)
    })

  const row = useAnimatedStyle(() => ({
    transform: [{ translateX: -REVEAL * revealed.value }],
  }))

  const tick = useAnimatedStyle(() => ({ opacity: 1 - revealed.value }))
  const bin = useAnimatedStyle(() => ({ opacity: revealed.value }))

  const close = () => {
    revealed.value = withSpring(0, SPRING)
    setArmed(false)
  }

  return (
    <GestureDetector gesture={swipe}>
      <Animated.View style={[styles.setRow, row]}>
        <Text role="control" size="md" align="center" style={styles.colSet}>
          {index + 1}
        </Text>
        {/* What it weighed last time, so nobody has to remember the number they hit a
            week ago. That is what a log is for. */}
        <Text role="body" size="xs" color="muted" numberOfLines={1} style={styles.colPrevious}>
          {set.previous}
        </Text>
        <Field
          value={set.loadKg}
          label={`Kilos de la serie ${index + 1}`}
          done={set.done}
          onChange={(loadKg) => onEdit({ loadKg })}
        />
        <Field
          value={set.reps}
          label={`Repeticiones de la serie ${index + 1}`}
          done={set.done}
          onChange={(reps) => onEdit({ reps })}
        />

        <View style={styles.colTick}>
          <Animated.View
            style={[StyleSheet.absoluteFill, tick]}
            pointerEvents={armed ? 'none' : 'auto'}
          >
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: set.done }}
              accessibilityLabel={`Marcar la serie ${index + 1}`}
              onPress={() => {
                // The set is over; the keyboard would sit over the ones still to come.
                Keyboard.dismiss()
                onEdit({ done: !set.done })
              }}
              style={[
                styles.cell,
                {
                  backgroundColor: set.done
                    ? theme.color.accent.tonal
                    : theme.color.background.canvas,
                  borderColor: set.done ? theme.color.border.accent : theme.color.border.default,
                  borderWidth: set.done ? 1.5 : 1,
                },
              ]}
            >
              {set.done ? (
                <FoundationIcon name="check" size="xs" color={theme.color.icon.accent} decorative />
              ) : null}
            </Pressable>
          </Animated.View>

          <Animated.View
            style={[StyleSheet.absoluteFill, bin]}
            pointerEvents={armed ? 'auto' : 'none'}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Eliminar la serie ${index + 1}`}
              onPress={onRemove}
              onLongPress={close}
              style={[
                styles.cell,
                {
                  backgroundColor: theme.color.background.canvas,
                  borderColor: theme.color.status.danger,
                  borderWidth: 1.5,
                },
              ]}
            >
              <FoundationIcon
                name="remove"
                size="xs"
                color={theme.color.status.danger}
                decorative
              />
            </Pressable>
          </Animated.View>
        </View>
      </Animated.View>
    </GestureDetector>
  )
}

function Field({
  value,
  label,
  done,
  onChange,
}: {
  readonly value: string
  readonly label: string
  readonly done: boolean
  readonly onChange: (value: string) => void
}) {
  const theme = useTheme()
  const [focused, setFocused] = useState(false)

  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityLabel={label}
      keyboardType="decimal-pad"
      returnKeyType="done"
      selectTextOnFocus
      placeholderTextColor={theme.color.text.muted}
      style={[
        styles.field,
        styles.colInput,
        {
          backgroundColor: done
            ? theme.color.background.surfaceSubtle
            : theme.color.background.canvas,
          // Accent is for focus, not for emptiness. Every empty field outlined in cyan
          // turned the card into an alarm and left nothing to mark where the cursor is.
          borderColor: focused ? theme.color.border.accent : theme.color.border.subtle,
          borderWidth: focused ? 1.5 : 1,
          color: theme.color.text.primary,
        },
      ]}
    />
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heading: { flex: 1, gap: 1 },
  scoreboard: {
    flexDirection: 'row',
    alignItems: 'center',
    // The clock is what somebody reads from a metre away with a bar in their hands, so
    // 16px in a 44pt strip was too small — and 30 in 78 was too far the other way, most
    // of it padding. 24 leads to 26, the label to 15, so the content is 42 and the strip
    // gives it 8 either side.
    height: 58,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 14,
  },
  score: { flex: 1, alignItems: 'center', gap: 1 },
  divider: { width: 1, height: 30 },
  list: { gap: 6, paddingTop: 16, paddingBottom: 32 },
  shell: { borderRadius: 22, paddingHorizontal: CARD_INSET },
  exerciseHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 44 },
  headerTitle: { flex: 1 },
  headerToggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, height: 44 },
  // Below the row's 44, so the open card keeps a margin above it.
  preview: { width: 40, height: 40, borderRadius: 10 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  headerOpen: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  headerFlex: { flexShrink: 1 },
  // Over the picture's corner, where it reads as «this plays» without hiding it.
  play: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Clipped, so the animated height is what reveals the drawer.
  drawer: { overflow: 'hidden' },
  measure: { position: 'absolute', left: 0, right: 0, top: 0, gap: 10, paddingTop: 6 },
  columns: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // 'SERIE' at the eyebrow's 0.2em tracking needs the room, and the numbers ride the
  // same column centred, so the two never drift apart. Five characters want about 41pt
  // at 10 and 49 at 12, which is what wrapped the word when the header grew.
  colSet: { width: 54 },
  // Wide enough for `ANTERIOR` at the eyebrow's 0.2em tracking, which is what wrapped
  // it: eight characters need about 66pt at 10 and 79 at 12, so the column grew with
  // the type rather than clipping the one word that names it.
  colPrevious: { width: 88 },
  addSet: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 4 },
  colInput: { flex: 1, textAlign: 'center' },
  colTick: { width: 34, height: 34 },
  // 16 rather than the 13 that was typed here: it is the only size in this file that
  // never came from the scale, and it is the number somebody enters mid-set. The height
  // stays 34 so the row keeps aligning with the tick beside it.
  field: { height: 34, borderRadius: 10, fontSize: 16, paddingVertical: 0 },
  cell: { flex: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  thread: { width: 2.5, height: 28, borderRadius: 1.5 },
  finish: { paddingHorizontal: 0, minWidth: 104 },
  decisions: { gap: 10, paddingBottom: 8 },
  addExercise: { gap: 8, paddingTop: 10 },
})
