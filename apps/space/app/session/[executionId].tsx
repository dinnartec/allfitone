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

import { badgeToneColor, identityTone, type BadgeTone } from '@allfitone/react-native/badge'
import { Button } from '@allfitone/react-native/button'
import { IconButton } from '@allfitone/react-native/icon-button'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Sheet } from '@allfitone/react-native/sheet'
import { Text } from '@allfitone/react-native/text'
import { useTheme } from '@allfitone/react-native/theme'
import { transparent, withAlpha } from '@allfitone/react-native/tokens'
import { FoundationIcon } from '@allfitone/react-native/icons'
import * as Haptics from 'expo-haptics'
import { Image } from 'expo-image'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  Easing,
  FadeInUp,
  interpolateColor,
  LayoutAnimationConfig,
  LinearTransition,
  ReduceMotion,
  SlideOutLeft,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { ApiError } from '../../src/client'
import { createSpaceContentFlow } from '../../src/client/content-transport'
import {
  declareAlreadyIn,
  declareReplacing,
  FROM_SESSION,
  takeExercisePick,
} from '../../src/client/exercise-pick'
import { readExerciseLibrary } from '../../src/client/exercise-library'
import { createSpaceExecutionFlow } from '../../src/client/execution-transport'
import { SPRING } from '../../src/client/motion'
import {
  canFinish,
  musclesLine,
  resultsFrom,
  setsProgress,
  totalVolumeKg,
  withExtraSet,
  withoutSet,
  workingStateFrom,
  withAddedExercises,
  withoutExercise,
  movedExercise,
  chainedExercise,
  unchainedExercise,
  restAfter,
  resumesWith,
  withRest,
  setMark,
  withSetKind,
  withTick,
  withSetRpe,
  type WorkingExercise,
  type WorkingSet,
} from '../../src/client/session-form'
import { rpeCopy, rpeShown } from '../../src/client/rpe-scale'
import {
  SET_KIND_DETAILS,
  SET_KIND_NAMES,
  SET_KIND_TONES,
  REST_OPENING_SECONDS,
  restPresetLabel,
  type SetKind,
} from '../../src/client/set-scheme'
import { announceRestEnd, cancelRestEnd } from '../../src/client/rest-alert'
import { adjusted, rememberRest, restFor, started, type Rest } from '../../src/client/rest-timer'
import { chainLetters } from '../../src/client/chain-order'
import { DraggableRow } from '../../src/components/draggable-row'
import { RestBar } from '../../src/components/rest-bar'
import { SessionScoreboard } from '../../src/components/session-scoreboard'
import { RestSheetBody } from '../../src/components/rest-sheet'
import { RpeSheetBody } from '../../src/components/rpe-sheet'
import { SheetChoice } from '../../src/components/sheet-choice'

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
/** How far a row slides to uncover «Eliminar»: the width of the red behind it. */
const DELETE_WIDTH = 96

/** Past this much of the throw, letting go deletes rather than settling open. */
const DELETE_COMMIT = 200

/** Where a deleted row slides out to before it goes, clear of any screen's edge. */
const ROW_EXIT = 480

/** A new row arrives from just above its place, the way a card is dealt onto a pile. */
const ROW_ENTER = FadeInUp.duration(260).easing(Easing.bezier(0.23, 1, 0.32, 1))

/** Room left under the add button when the list scrolls to show it. */
const REVEAL_MARGIN = 24
/** Long enough for the new row to lay out, short enough to feel like one motion. */
const REVEAL_DELAY_MS = 80

/**
 * Every exercise is a card of its own (prototipo 49, «A»).
 *
 * Bare rows floating around one open card read as a jumble: nothing said where one
 * exercise ended and the next began. Cards with a small gap between them do, and the
 * open one lifts — its edge fades into a soft shadow, the fill unchanged — on the drawer's spring.
 */
const EXERCISE_GAP = 12

/** Above and below a shut card's 44-point header. */
const CARD_PAD = 6

/** A shut card, its hairline edges and the gap: one place in the list, for the drag. */
const EXERCISE_SPAN = 44 + CARD_PAD * 2 + 2 + EXERCISE_GAP

/** Out the way its sets go, so removing an exercise reads as the same gesture, larger. */
const EXERCISE_EXIT = SlideOutLeft.duration(200).reduceMotion(ReduceMotion.System)

/**
 * The cards below closing the gap a deleted exercise leaves.
 *
 * Only then. Left on, it also chased every drawer opening a beat late, and the cards
 * below slid over the one opening; without it they follow the drawer frame by frame.
 */
const REFLOW = LinearTransition.duration(220)
  .easing(Easing.bezier(0.23, 1, 0.32, 1))
  .reduceMotion(ReduceMotion.System)

/** How long the reflow stays on after a delete: the exit plus the gap closing. */
const REFLOW_MS = 480

/** How long «¡A darle!», or a superset's next, stays on the bar before it goes. */
const RESTED_MS = 2_400

/** How far a done set steps back: still legible, no longer leading. */
const DIMMED = 0.5

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
  /** By key, not place: a move renumbers every place, and the open one has to stay open. */
  const [openKey, setOpenKey] = useState<string | undefined>(undefined)
  const [title, setTitle] = useState('')
  const [startedAt, setStartedAt] = useState<number | undefined>(undefined)
  const [seconds, setSeconds] = useState(0)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [closing, setClosing] = useState(false)
  const [deciding, setDeciding] = useState(false)
  /** What the one sheet on screen is about: a set's kind or effort, or an exercise. */
  const [asking, setAsking] = useState<
    | { readonly about: 'kind' | 'effort'; readonly position: number; readonly order: number }
    | { readonly about: 'menu' | 'chain' | 'rest'; readonly position: number }
    | undefined
  >(undefined)

  /** The rest counting down, kept outside the screen so setting the session aside keeps it. */
  const [rest, setRest] = useState<Rest | undefined>(() => restFor(executionId, Date.now()))
  /** What the bar says for a moment when nothing counts: a rest over, or a chain's next. */
  const [aside, setAside] = useState<
    { readonly kind: 'done' | 'chain'; readonly next: string } | undefined
  >(undefined)

  const [dragging, setDragging] = useState(false)
  /** Set for the moment a deleted exercise's gap closes; see `REFLOW`. */
  const [reflowing, setReflowing] = useState(false)
  const [settling, setSettling] = useState(false)
  const liftedFrom = useSharedValue(0)
  const liftedBy = useSharedValue(0)

  /** Each movement's demonstration, by id: the catalogue's, not the session's. */
  const [previews, setPreviews] = useState<ReadonlyMap<string, string | null>>(new Map())
  /** The catalogue's muscles, for the line under the name; empty if it did not load. */
  const [catalogue, setCatalogue] = useState<{
    readonly movements: readonly { readonly id: string; readonly muscles: readonly string[] }[]
    readonly muscles: readonly { readonly code: string; readonly name: string }[]
  }>({ movements: [], muscles: [] })

  const revision = useRef(0)
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    let active = true

    // With the library, because an exercise added mid-session comes back as a bare id
    // and the library is what names it. It is a process cache, and a failure only
    // costs the pictures and those names.
    Promise.all([
      flow.readExecution(executionId),
      readExerciseLibrary(createSpaceContentFlow()).catch(() => undefined),
    ])
      .then(([current, library]) => {
        if (!active) return
        const movements = library?.movements ?? []
        setPreviews(new Map(movements.map((one) => [one.id, one.demo_url])))
        setCatalogue({ movements, muscles: library?.muscles ?? [] })
        revision.current = current.revision_number
        setTitle(current.title ?? 'Sesión')
        setStartedAt(Date.parse(current.started_at))
        const opened = workingStateFrom(current, {
          names: new Map(movements.map((one) => [one.id, one.name])),
        })
        setExercises(opened)
        setOpenKey(opened[0] ? keyOf(opened[0]) : undefined)
      })
      .catch(() => {
        if (active) setFailure(READ_FAILED)
      })

    return () => {
      active = false
    }
  }, [flow, executionId])

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

  // The picker hands its selection back through the same mailbox the routine editor
  // reads, and this screen collects it when it is looked at again.
  useFocusEffect(
    useCallback(() => {
      const picked = takeExercisePick()
      if (picked.length === 0) return
      const next = withAddedExercises(exercises, picked)
      // Saved now, not at the first tick: the list is the session's, and it survives.
      setExercises(next)
      save(next)
      // Open the first one added: it is the one somebody is about to do.
      const first = next[exercises.length]
      if (first) setOpenKey(keyOf(first))
    }, [exercises, save]),
  )

  const addExercise = () => {
    declareAlreadyIn(exercises.flatMap((exercise) => exercise.movementId ?? []))
    declareReplacing(undefined)
    router.push('/routines/exercises')
  }

  // Driven from the session's own start, not from a counter: a screen that slept for
  // ten minutes has to come back showing ten minutes, not the ticks it missed.
  useEffect(() => {
    if (startedAt === undefined) return
    const tick = () => setSeconds((Date.now() - startedAt) / 1000)
    tick()
    const timer = setInterval(tick, 1_000)
    return () => clearInterval(timer)
  }, [startedAt])

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

  // A ticked set is already recorded, so changing it is a write; an unticked one waits
  // for its tick like everything else typed into it.
  const reshape = (next: readonly WorkingExercise[], position: number, order: number) => {
    setExercises(next)
    const changed = next
      .find((exercise) => exercise.position === position)
      ?.sets.find((set) => set.order === order)
    if (changed?.done) save(next)
  }

  // Removing, moving and chaining change the list, and the list is saved like a tick.
  const restructure = (next: readonly WorkingExercise[]) => {
    setExercises(next)
    save(next)
  }

  const removeExercise = (position: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setAsking(undefined)
    setReflowing(true)
    restructure(withoutExercise(exercises, position))
  }

  useEffect(() => {
    if (!reflowing) return
    const off = setTimeout(() => setReflowing(false), REFLOW_MS)
    return () => clearTimeout(off)
  }, [reflowing])

  // Committed while the reflow is stood down, so React places the rows where the
  // transforms already showed them; the shared values go back a frame later.
  const drop = (from: number, to: number) => {
    if (to !== from) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      restructure(movedExercise(exercises, from, to))
    }
    setSettling(true)
  }

  useEffect(() => {
    if (!settling) return
    liftedFrom.set(0)
    liftedBy.set(0)
    setSettling(false)
    setDragging(false)
  }, [settling, liftedFrom, liftedBy])

  // Recomputed from the list rather than stored, like the editor's.
  const letters = chainLetters(exercises)
  const chainMark = (group: number | undefined) => {
    if (group === undefined) return undefined
    const letter = letters.get(group)
    if (letter === undefined) return undefined
    const tone = identityTone([...letters.keys()].indexOf(group))
    return { letter, tone, color: badgeToneColor(theme, tone) }
  }

  const asked =
    asking?.about === 'menu' || asking?.about === 'chain' || asking?.about === 'rest'
      ? exercises.find((exercise) => exercise.position === asking.position)
      : undefined

  const askedSet =
    asking?.about === 'kind' || asking?.about === 'effort'
      ? exercises
          .find((exercise) => exercise.position === asking.position)
          ?.sets.find((set) => set.order === asking.order)
      : undefined

  // One place decides what is counting, so the notice and the bar never disagree.
  /** What the rest leads to, kept so a nudge or the end still says it. */
  const upNext = useRef({ movement: '', chained: false })
  const restWith = (next: Rest | undefined, after = upNext.current) => {
    upNext.current = after
    setRest(next)
    setAside(undefined)
    rememberRest(executionId, next)
    if (next) void announceRestEnd(next.endsAt, after.movement)
    else void cancelRestEnd()
  }

  // A tick is always a write, and it fills an empty weight from last time or the set above.
  // Ticking one done starts the rest that follows it; unticking leaves the rest alone.
  const tick = (position: number, order: number) => {
    const next = withTick(exercises, position, order)
    setExercises(next)
    save(next)
    const ticked = next
      .find((one) => one.position === position)
      ?.sets.find((set) => set.order === order)?.done
    const seconds = restAfter(next, position)
    if (!ticked) return
    const after = resumesWith(next, position)
    if (seconds !== undefined) {
      restWith(started(Date.now(), seconds), after)
      return
    }
    // «Ninguno» inside a superset: nothing counts, but the bar still says where to go.
    if (after.chained) {
      restWith(undefined, after)
      setAside({ kind: 'chain', next: after.movement })
    }
  }

  // The screen already renders once a second for its clock; the rest ends on that beat.
  useEffect(() => {
    if (!rest || rest.endsAt > Date.now()) return
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    rememberRest(executionId, undefined)
    void cancelRestEnd()
    setRest(undefined)
    setAside({ kind: 'done', next: upNext.current.movement })
  }, [rest, seconds, executionId])

  // Its own effect: on the clock's, the next second's render cancelled the goodbye.
  useEffect(() => {
    if (!aside) return
    const gone = setTimeout(() => setAside(undefined), RESTED_MS)
    return () => clearTimeout(gone)
  }, [aside])

  const scroll = useRef<ScrollView>(null)
  const scrolled = useRef(0)
  const viewport = useRef(0)

  // After the row lands, bring the add button into view if it went below the fold.
  const reveal = (node: View | null) => {
    const list = scroll.current
    if (!node || !list) return
    node.measureInWindow((_x, y, _width, height) => {
      const hidden = y + height + REVEAL_MARGIN - viewport.current
      if (hidden > 0) list.scrollTo({ y: scrolled.current + hidden, animated: true })
    })
  }

  const addSet = (position: number, button: View | null) => {
    Keyboard.dismiss()
    void Haptics.selectionAsync()
    setExercises((current) => withExtraSet(current, position))
    setTimeout(() => reveal(button), REVEAL_DELAY_MS)
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
    restWith(undefined)
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
    restWith(undefined)
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
  const trains = musclesLine(exercises, catalogue.movements, catalogue.muscles)
  const volume = totalVolumeKg(exercises)
  const recorded = canFinish(exercises)

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.header}>
        {/* Down, not back: the session is set aside, still open, and Hoy carries it. */}
        <IconButton icon="expand" accessibilityLabel="Minimizar la sesión" onPress={minimize} />
        <View style={styles.heading}>
          <Text role="control" size="lg" numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
          {/* Recomputed from the list, so it follows an exercise added, moved or taken out. */}
          {trains ? (
            <Text role="body" size="sm" color="muted" numberOfLines={1}>
              {trains}
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

      <SessionScoreboard
        seconds={seconds}
        volumeKg={volume}
        done={progress.done}
        planned={progress.planned}
      />

      {failure ? <InlineAlert message={failure} /> : null}

      {/* `handled`: with the keyboard up, the tap on a tick used to only close it and
          had to be made twice. A tap on nothing still closes it. */}
      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={32}
        onScroll={(event) => {
          scrolled.current = event.nativeEvent.contentOffset.y
        }}
        onLayout={(event) => {
          const { y, height } = event.nativeEvent.layout
          viewport.current = y + height
        }}
      >
        {exercises.map((exercise) => (
          <DraggableRow
            key={keyOf(exercise)}
            position={exercise.position}
            count={exercises.length}
            open={keyOf(exercise) === openKey}
            span={EXERCISE_SPAN}
            exiting={EXERCISE_EXIT}
            {...(reflowing && !dragging ? { layout: REFLOW } : {})}
            from={liftedFrom}
            travel={liftedBy}
            onLift={() => {
              // Everything shut while it moves: a place in the list is one shut row.
              Keyboard.dismiss()
              void Haptics.selectionAsync()
              setOpenKey(undefined)
              setDragging(true)
            }}
            onDrop={(to) => drop(exercise.position, to)}
          >
            <Exercise
              exercise={exercise}
              picture={exercise.movementId ? (previews.get(exercise.movementId) ?? null) : null}
              open={keyOf(exercise) === openKey}
              chain={chainMark(exercise.supersetGroup)}
              onToggle={() =>
                setOpenKey((current) => (current === keyOf(exercise) ? undefined : keyOf(exercise)))
              }
              onMenu={() => setAsking({ about: 'menu', position: exercise.position })}
              onEdit={(order, change) => edit(exercise.position, order, change)}
              onTick={(order) => tick(exercise.position, order)}
              onAddSet={(button) => addSet(exercise.position, button)}
              onRemoveSet={(order) => removeSet(exercise.position, order)}
              onKind={(order) => setAsking({ about: 'kind', position: exercise.position, order })}
              onEffort={(order) =>
                setAsking({ about: 'effort', position: exercise.position, order })
              }
              onExplain={explainer(exercise.movementId)}
              onRest={() => setAsking({ about: 'rest', position: exercise.position })}
            />
          </DraggableRow>
        ))}

        {/* The routine editor's own picker. What it adds is not written to the plan:
            a set recorded against a movement the plan never had is simply unplanned. */}
        <View style={styles.addExercise}>
          <Button label="Añadir ejercicio" icon="add" variant="secondary" onPress={addExercise} />
        </View>
      </ScrollView>

      {rest || aside ? (
        <RestBar
          moment={
            rest ? { kind: 'rest', rest, ...upNext.current } : (aside ?? { kind: 'done', next: '' })
          }
          now={startedAt === undefined ? Date.now() : startedAt + seconds * 1000}
          onAdjust={(by) => {
            if (rest) restWith(adjusted(rest, by, Date.now()))
          }}
          onSkip={() => restWith(undefined)}
        />
      ) : null}

      <Sheet
        visible={deciding}
        onDismiss={() => setDeciding(false)}
        title="¿Qué hacemos con esta sesión?"
      >
        <View style={styles.decisions}>
          <Button label="Guardar entrenamiento" onPress={finish} disabled={!recorded} />
          <Text role="body" size="xs" color="muted">
            {recorded
              ? 'Se guarda como terminado y cuenta en tu semana.'
              : 'Todavía no has marcado ninguna serie, así que no hay nada que guardar.'}
          </Text>

          <Button label="Descartar entrenamiento" variant="secondary" onPress={leave} />

          <Button label="Regresar" variant="ghost" onPress={() => setDeciding(false)} />
        </View>
      </Sheet>

      <Sheet
        visible={asking?.about === 'kind'}
        onDismiss={() => setAsking(undefined)}
        title="Tipo de serie"
      >
        <View style={styles.decisions}>
          {(['normal', 'warmup', 'to_failure', 'drop'] as const).map((kind: SetKind) => (
            <SheetChoice
              key={kind}
              name={SET_KIND_NAMES[kind]}
              tone={SET_KIND_TONES[kind]}
              detail={SET_KIND_DETAILS[kind]}
              selected={askedSet?.kind === kind}
              onPress={() => {
                if (asking?.about === 'kind') {
                  reshape(
                    withSetKind(exercises, asking.position, asking.order, kind),
                    asking.position,
                    asking.order,
                  )
                }
                setAsking(undefined)
              }}
            />
          ))}
        </View>
      </Sheet>

      <Sheet
        visible={asking?.about === 'effort'}
        onDismiss={() => setAsking(undefined)}
        title="Esfuerzo de la serie"
      >
        <RpeSheetBody
          value={askedSet?.rpe}
          onChoose={(rpe) => {
            if (asking?.about === 'effort') {
              reshape(
                withSetRpe(exercises, asking.position, asking.order, rpe),
                asking.position,
                asking.order,
              )
            }
            // One tap is the answer; the sheet has nothing else to say.
            setAsking(undefined)
          }}
        />
      </Sheet>

      <Sheet
        visible={asking?.about === 'rest'}
        onDismiss={() => setAsking(undefined)}
        title="Descanso entre series"
      >
        <RestSheetBody
          value={asked?.restSeconds ?? REST_OPENING_SECONDS}
          onChange={(value) => {
            if (asked) restructure(withRest(exercises, asked.position, value))
          }}
        />
      </Sheet>

      {/* One sheet for both steps: iOS will not present a second while the first leaves. */}
      <Sheet
        visible={asking?.about === 'menu' || asking?.about === 'chain'}
        onDismiss={() => setAsking(undefined)}
        title={asking?.about === 'chain' ? 'Superserie' : (asked?.movement ?? 'Ejercicio')}
      >
        {asking?.about === 'menu' ? (
          <View style={styles.decisions}>
            {asked?.supersetGroup !== undefined ? (
              <SheetChoice
                name="Quitar de la superserie"
                detail="Deja de encadenarse con su vecino"
                onPress={() => {
                  if (asked) restructure(unchainedExercise(exercises, asked.position))
                  setAsking(undefined)
                }}
              />
            ) : (
              <SheetChoice
                name="Hacer superserie"
                detail={
                  exercises.length < 2
                    ? 'Necesitas otro ejercicio en la sesión'
                    : 'Encadenarlo con otro ejercicio'
                }
                disabled={exercises.length < 2}
                onPress={() => {
                  if (asked) setAsking({ about: 'chain', position: asked.position })
                }}
              />
            )}
            {/* No confirmation: it is one exercise, and the add button brings it back. */}
            <SheetChoice
              destructive
              name="Eliminar ejercicio"
              detail="Se quita de esta sesión con sus series"
              onPress={() => {
                if (asked) removeExercise(asked.position)
              }}
            />
          </View>
        ) : (
          <View style={styles.decisions}>
            <Text role="body" size="sm" color="muted">
              Se hacen seguidos, sin descanso entre medias. El que elijas queda al lado de este.
            </Text>
            {exercises
              .filter((mate) => mate.position !== asked?.position)
              .map((mate) => (
                <SheetChoice
                  key={keyOf(mate)}
                  name={mate.movement}
                  {...(chainMark(mate.supersetGroup) === undefined
                    ? {}
                    : { edge: chainMark(mate.supersetGroup)?.color })}
                  onPress={() => {
                    if (asked)
                      restructure(chainedExercise(exercises, asked.position, mate.position))
                    setAsking(undefined)
                  }}
                />
              ))}
          </View>
        )}
      </Sheet>
    </Screen>
  )
}

/** What a row is known by across moves; a list read before ADR-034 has only places. */
function keyOf(exercise: WorkingExercise): string {
  return exercise.key ?? `place-${exercise.position}`
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
  chain,
  onToggle,
  onMenu,
  onEdit,
  onAddSet,
  onRemoveSet,
  onKind,
  onEffort,
  onTick,
  onExplain,
  onRest,
}: {
  readonly exercise: WorkingExercise
  readonly picture: string | null
  readonly open: boolean
  /** The superset it belongs to, with the letter and colour the list gives it. */
  readonly chain:
    { readonly letter: string; readonly tone: BadgeTone; readonly color: string } | undefined
  readonly onToggle: () => void
  readonly onMenu: () => void
  readonly onEdit: (
    order: number,
    change: Partial<{ loadKg: string; reps: string; done: boolean }>,
  ) => void
  readonly onAddSet: (button: View | null) => void
  readonly onRemoveSet: (order: number) => void
  readonly onKind: (order: number) => void
  readonly onEffort: (order: number) => void
  readonly onTick: (order: number) => void
  /** Absent when the step names no catalogue movement: there is nothing to explain. */
  readonly onExplain: (() => void) | undefined
  readonly onRest: () => void
}) {
  const theme = useTheme()
  const progress = useSharedValue(0)
  const drawerHeight = useSharedValue(0)
  const addButton = useRef<View>(null)
  const reduceMotion = useReducedMotion()

  // A warmup is not work, so it is not what «3 de 3» counts.
  const working = exercise.sets.filter((set) => set.kind !== 'warmup')
  const done = working.filter((set) => set.done).length
  const complete = done === working.length && done > 0

  useEffect(() => {
    // Reduced motion keeps the change and drops the travel: which exercise is open is
    // state the drawer exists to report, so it still opens — it just does not fly.
    const target = open ? 1 : 0
    progress.value = reduceMotion ? target : withSpring(target, SPRING)
  }, [open, progress, reduceMotion])

  // Both ends are Design System tokens, so nothing in between is a colour it lacks.
  const surface = theme.color.background.surface
  // Half the subtle border's own 14 %: enough to tell one shut card from the next.
  // `withAlpha` sets the alpha, it does not scale it, so this is the absolute value.
  const edge = withAlpha(theme.color.border.subtle, 0.07)
  // Open, the edge fades out and the shadow alone sets the card apart; the width stays,
  // so nothing inside it shifts.
  const noEdge = transparent(edge)

  const shell = useAnimatedStyle(() => ({
    // One fill open or shut, the same as the set rows: a third tone read as a jumble.
    backgroundColor: surface,
    borderColor: interpolateColor(progress.value, [0, 1], [edge, noEdge]),
    shadowOpacity: 0.35 * progress.value,
    paddingBottom: CARD_PAD + (OPEN_PADDING - CARD_PAD) * progress.value,
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

  // What the timer will count: the routine's, or the opening rest when it said nothing.
  const effectiveRest = exercise.restSeconds ?? REST_OPENING_SECONDS

  const body = (
    <>
      {/* Today's rest, where the sets are: changing it here never touches the routine. */}
      {/* A quiet pill, not a cyan line: it is a setting, and the rows below are the work. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Descanso entre series: ${restPresetLabel(effectiveRest)}. Cambiar`}
        onPress={onRest}
        hitSlop={8}
        style={({ pressed }) => [
          styles.restPill,
          {
            // A step past the card it sits on, so it still reads as a control.
            backgroundColor: theme.color.background.surfaceSubtle,
            transform: [{ scale: pressed ? 0.96 : 1 }],
          },
        ]}
      >
        <FoundationIcon name="rest" customSize={14} color={theme.color.icon.secondary} decorative />
        <Text role="control" size="xs" color="muted">
          Descanso
        </Text>
        <Text role="control" size="xs">
          {restPresetLabel(effectiveRest)}
        </Text>
        <FoundationIcon
          name="expand"
          customSize={12}
          color={theme.color.icon.secondary}
          decorative
        />
      </Pressable>

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
        <Text role="eyebrow" size="xs" color="muted" align="center" style={styles.colRpe}>
          RPE
        </Text>
        <View style={styles.colTick} />
      </View>

      {/* Keyed by place, not by order: the ladder renumbers on every change, and a key
          that moved would replay the entrance on rows that never left. */}
      {/* The rows already there when the exercise mounts are the plan, not an addition. */}
      <LayoutAnimationConfig skipEntering>
        {exercise.sets.map((set, index) => (
          <SetRow
            key={index}
            set={set}
            index={index}
            mark={setMark(exercise.sets, index)}
            onKind={() => onKind(set.order)}
            onEffort={() => onEffort(set.order)}
            onTick={() => onTick(set.order)}
            onEdit={(change) => onEdit(set.order, change)}
            onRemove={() => onRemoveSet(set.order)}
          />
        ))}
      </LayoutAnimationConfig>

      {/* Drawn as the next row, dashed, so what it does is visible before the tap. */}
      <Pressable
        ref={addButton}
        accessibilityRole="button"
        accessibilityLabel={`Añadir una serie a ${exercise.movement}`}
        onPress={() => onAddSet(addButton.current)}
        style={({ pressed }) => [
          styles.addSet,
          { borderColor: theme.color.border.default, opacity: pressed ? 0.6 : 1 },
        ]}
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
          accessibilityLabel={
            chain ? `${exercise.movement}, superserie ${chain.letter}` : exercise.movement
          }
          onPress={onToggle}
          style={styles.headerToggle}
        >
          {/* The badge under the name, not beside it: beside, both were cut to nothing.
              Stacked, it still fits the 44 points, so every shut row stays one place. */}
          <View style={styles.headerTitle}>
            <Text role="control" size="md" numberOfLines={1}>
              {exercise.movement}
            </Text>
            {/* A dot and a quiet word, not a filled pill: the name is what the eye is for,
                and the chain's colour already runs down the row's edge. */}
            {chain ? (
              <View style={styles.chainMark}>
                <View style={[styles.chainDot, { backgroundColor: chain.color }]} />
                <Text role="body" size="xs" color="muted">
                  {`Superserie ${chain.letter}`}
                </Text>
              </View>
            ) : null}
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
              {`${done} de ${working.length}`}
            </Text>
          </Animated.View>
          <Animated.View style={chevron}>
            <FoundationIcon name="expand" size="sm" color={theme.color.icon.secondary} decorative />
          </Animated.View>
        </Pressable>
        {/* Beside the toggle, not inside it, so VoiceOver reaches both. */}
        <IconButton
          icon="more"
          size="sm"
          variant="plain"
          accessibilityLabel={`Opciones de ${exercise.movement}`}
          onPress={onMenu}
        />
      </View>

      <Animated.View style={[styles.drawer, drawer]}>
        {/* Out of flow, so it can never add its height to the row it is measuring.
            In flow it did, and a shut drawer briefly claimed the space it would take
            if it were open. */}
        <Animated.View
          style={[styles.measure, contents]}
          onLayout={(event) => {
            const height = event.nativeEvent.layout.height
            if (height <= 0) return
            // The first measure is where it starts; later ones are a set added or gone.
            drawerHeight.value = drawerHeight.value === 0 ? height : withSpring(height, SPRING)
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
 * **Sliding left uncovers a delete that says so.** The row travels far enough to show
 * «Eliminar» on red behind it, and a long throw deletes outright, the way a mail list
 * does. It follows the finger and settles on a spring that carries the throw's
 * velocity, so a flick opens it and a slow drag decides at the halfway mark. Only the
 * horizontal axis is claimed, or it would fight the scroll it sits inside.
 *
 * **Done is the whole row, not the box.** A ticked set tints its row, so a glance down
 * the table reads what is finished; the fields keep their look, because a finished set
 * can still be corrected.
 */
function SetRow({
  set,
  index,
  mark,
  onKind,
  onEffort,
  onTick,
  onEdit,
  onRemove,
}: {
  readonly set: WorkingSet
  readonly index: number
  /** Its number, or W, D or F: what kind of set it is, where the number was. */
  readonly mark: string
  readonly onKind: () => void
  readonly onEffort: () => void
  readonly onTick: () => void
  readonly onEdit: (change: Partial<{ loadKg: string; reps: string }>) => void
  readonly onRemove: () => void
}) {
  const theme = useTheme()
  const offset = useSharedValue(0)
  const [open, setOpen] = useState(false)

  const settle = (to: number, velocity = 0) => {
    'worklet'
    offset.value = withSpring(to, { ...SPRING, velocity })
  }

  const swipe = Gesture.Pan()
    // Only the horizontal axis: the vertical one belongs to the scroll.
    .activeOffsetX([-12, 12])
    .failOffsetY([-8, 8])
    .onUpdate((event) => {
      const from = open ? -DELETE_WIDTH : 0
      const pulled = Math.min(0, from + event.translationX)
      // Past the delete it keeps following, but slower: the edge is felt, not hit.
      offset.value = pulled < -DELETE_WIDTH ? -DELETE_WIDTH + (pulled + DELETE_WIDTH) * 0.6 : pulled
    })
    .onEnd((event) => {
      if (offset.value < -DELETE_COMMIT) {
        // Out first, then gone: removing it mid-slide would hide the slide.
        offset.value = withTiming(-ROW_EXIT, { duration: 180 }, (finished) => {
          if (finished) scheduleOnRN(commitDelete)
        })
        return
      }
      const reveal = offset.value < -DELETE_WIDTH / 2 || event.velocityX < -500
      settle(reveal ? -DELETE_WIDTH : 0, event.velocityX)
      scheduleOnRN(setOpen, reveal)
      if (reveal && !open) scheduleOnRN(opened)
    })

  function opened() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  }

  function commitDelete() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    onRemove()
    // Rows are keyed by place, so this one is about to show the set below it: it has
    // to be back in place, not slid out.
    offset.value = 0
    setOpen(false)
  }

  const close = () => {
    settle(0)
    setOpen(false)
  }

  const row = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }))
  // The red grows in with the throw, so the action is announced before it is reached.
  const action = useAnimatedStyle(() => ({
    opacity: Math.min(1, -offset.value / (DELETE_WIDTH * 0.6)),
  }))

  const tint = theme.color.accent.tonal

  return (
    <Animated.View entering={ROW_ENTER} style={styles.setWrap}>
      <Animated.View
        style={[styles.deleteAction, { backgroundColor: theme.color.status.danger }, action]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Eliminar la serie ${index + 1}`}
          onPress={() => {
            // The same exit as the long throw: the row leaves the way it was pushed.
            offset.value = withTiming(-ROW_EXIT, { duration: 220 }, (finished) => {
              if (finished) scheduleOnRN(commitDelete)
            })
          }}
          style={styles.deletePress}
        >
          <FoundationIcon name="remove" size="xs" color={theme.color.text.primary} decorative />
          <Text role="control" size="sm" style={{ color: theme.color.text.primary }}>
            Eliminar
          </Text>
        </Pressable>
      </Animated.View>

      <GestureDetector gesture={swipe}>
        <Animated.View
          style={[
            styles.setRow,
            // Opaque, so the red stays hidden until the row moves off it.
            { backgroundColor: theme.color.background.surface },
            row,
          ]}
        >
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              styles.doneTint,
              { backgroundColor: set.done ? tint : transparent(tint) },
            ]}
          />
          {/* A chip with a caret, so it reads as something to press: the bare number
              looked like a label, and nobody guessed it opened the kinds. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Serie ${index + 1}: ${SET_KIND_NAMES[set.kind]}. Cambiar el tipo`}
            onPress={open ? close : onKind}
            hitSlop={4}
            style={[
              styles.colSet,
              styles.kindChip,
              { backgroundColor: theme.color.background.canvas },
              set.done ? styles.dimmed : null,
            ]}
          >
            <Text
              role="control"
              size="md"
              style={
                set.kind === 'normal'
                  ? undefined
                  : { color: badgeToneColor(theme, SET_KIND_TONES[set.kind]) }
              }
            >
              {mark}
            </Text>
            <FoundationIcon
              name="expand"
              customSize={10}
              color={theme.color.icon.secondary}
              decorative
            />
          </Pressable>
          {/* What it weighed last time, so nobody has to remember the number they hit a
              week ago. That is what a log is for. */}
          <Text
            role="body"
            size="xs"
            color="muted"
            numberOfLines={1}
            style={[styles.colPrevious, set.done ? styles.dimmed : null]}
          >
            {set.previous}
          </Text>
          {/* A done set steps back so the ones still to do lead; it stays editable. */}
          <Field
            value={set.loadKg}
            label={`Kilos de la serie ${index + 1}`}
            dimmed={set.done}
            onChange={(loadKg) => onEdit({ loadKg })}
          />
          <Field
            value={set.reps}
            label={`Repeticiones de la serie ${index + 1}`}
            dimmed={set.done}
            onChange={(reps) => onEdit({ reps })}
          />
          {/* Optional, and a button rather than a field: the scale opens explained. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Esfuerzo de la serie ${index + 1}`}
            accessibilityHint={rpeCopy(set.rpe)}
            onPress={onEffort}
            hitSlop={4}
            style={[
              styles.colRpe,
              styles.effort,
              {
                backgroundColor: set.done
                  ? transparent(theme.color.background.canvas)
                  : theme.color.background.canvas,
              },
              set.done ? styles.dimmed : null,
            ]}
          >
            {/* A value like any other: accent is for action and focus, not for a number. */}
            <Text role="data" size="sm" color={set.rpe === undefined ? 'muted' : 'primary'}>
              {rpeShown(set.rpe)}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: set.done }}
            accessibilityLabel={`Marcar la serie ${index + 1}`}
            onPress={() => {
              if (open) return close()
              // The set is over; the keyboard would sit over the ones still to come.
              Keyboard.dismiss()
              onTick()
            }}
            style={[
              styles.colTick,
              styles.tick,
              {
                backgroundColor: set.done ? tint : theme.color.background.canvas,
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
      </GestureDetector>
    </Animated.View>
  )
}

function Field({
  value,
  label,
  dimmed,
  onChange,
}: {
  readonly value: string
  readonly label: string
  readonly dimmed: boolean
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
          // Ticked, the well goes and the number reads as a label; a tap still edits it.
          backgroundColor:
            dimmed && !focused
              ? transparent(theme.color.background.canvas)
              : theme.color.background.canvas,
          // Accent is for focus, not for emptiness. Every empty field outlined in cyan
          // turned the card into an alarm and left nothing to mark where the cursor is.
          // No border at rest; the one that appears marks where the cursor is.
          borderColor: focused ? theme.color.border.accent : transparent(theme.color.border.accent),
          borderWidth: 1.5,
          opacity: dimmed && !focused ? DIMMED : 1,
          color: theme.color.text.primary,
        },
      ]}
    />
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heading: { flex: 1, gap: 1 },
  list: { gap: EXERCISE_GAP, paddingTop: 16, paddingBottom: 32 },
  shell: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: CARD_INSET,
    paddingTop: CARD_PAD,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 14,
  },
  exerciseHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 44 },
  headerTitle: { flex: 1, gap: 2 },
  chainMark: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chainDot: { width: 6, height: 6, borderRadius: 3 },
  headerToggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, height: 44 },
  // Below the row's 44, so the open card keeps a margin above it.
  preview: { width: 40, height: 40, borderRadius: 10 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 5 },
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
  restPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    height: 30,
    borderRadius: 15,
    paddingHorizontal: 12,
    marginLeft: 4,
  },
  // The same inset as a row, or every title sits four points off its column.
  columns: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  setWrap: { borderRadius: 12, overflow: 'hidden' },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRadius: 12,
  },
  doneTint: { borderRadius: 12, transitionProperty: 'backgroundColor', transitionDuration: 200 },
  deleteAction: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
    borderRadius: 12,
  },
  deletePress: {
    width: DELETE_WIDTH,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  dimmed: { opacity: DIMMED },
  tick: { borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  kindChip: {
    height: 34,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  // Narrowed to make room for RPE: 'SERIE' wants about 41pt at the eyebrow's size and
  // tracking, and the number or letter under it rides the same column centred.
  colSet: { width: 46, alignItems: 'center' },
  // `ANTERIOR` at the eyebrow's tracking clipped at 76 once RPE took a column; the
  // inputs have room to spare, so they give it back.
  colPrevious: { width: 88 },
  addSet: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginTop: 2,
  },
  colInput: { flex: 1, textAlign: 'center' },
  colTick: { width: 34, height: 34 },
  colRpe: { width: 38, textAlign: 'center' },
  effort: {
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 16 rather than the 13 that was typed here: it is the only size in this file that
  // never came from the scale, and it is the number somebody enters mid-set. The height
  // stays 34 so the row keeps aligning with the tick beside it.
  field: { height: 34, borderRadius: 10, fontSize: 16, paddingVertical: 0 },
  finish: { paddingHorizontal: 0, minWidth: 104 },
  decisions: { gap: 10, paddingBottom: 8 },
  addExercise: { gap: 8, paddingTop: 10 },
})
