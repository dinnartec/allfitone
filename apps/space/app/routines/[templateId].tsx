/**
 * `V-H`, `V-E1` and `V-G` — one screen in three states.
 *
 * The canvases draw them apart and they are the same screen: an empty routine, a
 * routine with exercises, and a routine that cannot be published yet. Three files
 * would put the same name field, the same list and the same confirm in three places,
 * and the disabled state would drift between them within a week.
 *
 * `templateId` is the literal `new` before anything exists. **Nothing is created until
 * the routine has a name**, which is what "aún sin guardar" says out loud: a routine
 * with no name is not a draft anybody would recognise in a list.
 *
 * **The draft saves as it is edited and the etag is not this screen's business.**
 * `createSpaceContentFlow` carries it from one save to the next; a screen holding it
 * would eventually save a stale one and answer `409` for no reason a person could act
 * on.
 *
 * **`S-1` is the separate route the canvas draws, after all.** It was built as a sheet
 * to avoid "a second copy of that draft with a way to disagree with this one", and the
 * worry was right — each screen builds its own flow, so each holds its own etag map,
 * and two writers would be two etags and a `409`. But a sheet is anchored to the
 * bottom edge, which is where the keyboard appears: searching left about three results
 * visible, and every pick wrote the draft, so five exercises were five saves.
 *
 * The route avoids the duplication by carrying a **selection** and never a draft.
 * `exercise-pick` is the mailbox; this screen stays the only thing that writes, and it
 * appends the whole batch in one save.
 *
 * **It loads before it writes, and that order is the whole safety of the screen.**
 * A draft is saved on the server and, until `OP-PLN-023`, could never be read back —
 * so this opened empty every time and every routine anybody started was orphaned. Now
 * it opens the most recent unpublished draft; the autosave is held until that read
 * lands, because an editor that saves what it has not loaded replaces the work with
 * nothing.
 *
 * **Leaving asks.** A named routine is already on the server, so closing it silently
 * would leave something nobody asked to keep. The X offers keeping it as a draft or
 * discarding it, and discarding is `OP-PLN-028` — a state, never a deletion.
 *
 * **An exercise opens.** Sets are rows now, each with its own kind, because nobody
 * does four identical ones: the first warms up, the last goes to failure and has no
 * rep count. `ADR-030` carries why the model works that way; the sheets here are the
 * four the canvases draw — set kind, rest, superset and the exercise's own menu.
 */

import { Button } from '@allfitone/react-native/button'
import { Badge, type BadgeTone } from '@allfitone/react-native/badge'
import { Chip } from '@allfitone/react-native/chip'
import { Sheet } from '@allfitone/react-native/sheet'
import { Stepper } from '@allfitone/react-native/stepper'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { IconButton } from '@allfitone/react-native/icon-button'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { NumberField } from '@allfitone/react-native/number-field'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { TextField } from '@allfitone/react-native/text-field'
import { useTheme } from '@allfitone/react-native/theme'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'

import { scheduleOnRN } from 'react-native-worklets'

import { ApiError } from '../../src/client'
import { createSpaceContentFlow } from '../../src/client/content-transport'
import { aside, placeOf } from '../../src/client/drag-order'
import { readExerciseLibrary } from '../../src/client/exercise-library'
import {
  declareAlreadyIn,
  declareReplacing,
  replacingPosition,
  takeExercisePick,
} from '../../src/client/exercise-pick'
import {
  DISCIPLINE,
  countSets,
  reasonsNotToPublish,
  movedTo,
  replacedStep,
  stepsFromContent,
  stepsToContent,
  withPicked,
  withoutStep,
  type WorkingStep,
} from '../../src/client/routine-draft'
import {
  OPENING_UNIT,
  REST_MAX_SECONDS,
  REST_OPENING_SECONDS,
  REST_PRESETS,
  REST_STEP_SECONDS,
  SET_KIND_DETAILS,
  SET_KIND_NAMES,
  SET_KIND_TONES,
  otherUnit,
  restLabel,
  restPresetLabel,
  setsLabel,
  withKind,
  withLoad,
  withReps,
  type MassUnit,
  type WorkingSet,
} from '../../src/client/set-scheme'
import { ScreenHeader } from '../../src/components/screen-header'

const SUGGESTIONS = ['Empuje', 'Tirón', 'Pierna', 'Full body']

/** Long enough that a name is not a save per keystroke, short enough to feel saved. */
const SAVE_DELAY_MS = 700

/** DT-010 measures the target, not the glyph, and the glyph here is 16. */
const PRESS_SLOP = { top: 14, bottom: 14, left: 14, right: 14 }

/** Keeps the button off the very bottom edge, the same amount as every other footer. */
const FOOTER_LIFT = 16

/** Under the threshold where a press reads as an animation instead of as a response. */
const PRESS_MS = 120

/** `ease-out`, never `ease-in`: a slow start delays the moment the finger asks about. */
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1)

/** Quick enough that a row reads as answering the finger rather than following it. */
const STEP_ASIDE = { duration: 160, easing: EASE_OUT }

/** Gone rather than vanished. Opacity only, which is what survives reduced motion. */
const EXIT = FadeOut.duration(140).reduceMotion(ReduceMotion.System)

/** What the rows below do about the hole, and what opens and closes an exercise. */
const REFLOW = LinearTransition.duration(220).easing(EASE_OUT).reduceMotion(ReduceMotion.System)

/**
 * Opening an exercise, and closing it, which are not mirror images on purpose.
 *
 * **Opening is two beats.** The row grows by two hundred points and the table appears
 * inside it; done at once the content lands before there is room for it and the eye
 * reads a flicker rather than a drawer. So the height goes first — `REFLOW`, a layout
 * animation on the UI thread that never touches a `height` style — and the table
 * fades in behind it after a beat.
 *
 * **Closing is one.** It used to fade the table out and only then collapse the row,
 * and that is what read as unharmonious: Reanimated holds an exiting child in the
 * tree until its animation ends, so the first ninety milliseconds were a full-height
 * row with nothing in it, standing still, before anything moved. Now the table simply
 * goes and the collapse is the whole motion — one continuous movement with no pause
 * in front of it. Reveal gently, dismiss briskly.
 *
 */
const OPEN = FadeIn.duration(150).delay(60).easing(EASE_OUT).reduceMotion(ReduceMotion.System)

/** The rest the sheet is editing. An exercise with none opens on a habitual one. */
function restAt(steps: readonly WorkingStep[], sheet: Sheeted | undefined) {
  if (sheet?.kind !== 'rest') return REST_OPENING_SECONDS
  const step = steps.find((one) => one.position === sheet.position)
  return step?.restSeconds ?? REST_OPENING_SECONDS
}

/** The kind the set-kind sheet is being opened on, so its row can be marked. */
function kindAt(steps: readonly WorkingStep[], sheet: Sheeted | undefined) {
  if (sheet?.kind !== 'set-kind') return undefined
  return steps.find((one) => one.position === sheet.position)?.sets[sheet.order]?.kind
}

/** Which sheet is up, and about what. One at a time, which is what a sheet is. */
type Sheeted =
  | { readonly kind: 'leaving' }
  | { readonly kind: 'menu'; readonly position: number }
  | { readonly kind: 'rest'; readonly position: number }
  | { readonly kind: 'superset'; readonly position: number }
  | { readonly kind: 'set-kind'; readonly position: number; readonly order: number }

const LOAD_FAILED = 'No pudimos abrir el borrador. Revisa tu conexión.'

const EXPIRED = 'Tu sesión venció. Vuelve a entrar para continuar.'
const SAVE_FAILED = 'No pudimos guardar el borrador. Revisa tu conexión.'

export default function RoutineEditor() {
  const router = useRouter()
  const theme = useTheme()
  const flow = useMemo(() => createSpaceContentFlow(), [])
  const params = useLocalSearchParams<{ templateId: string }>()

  const [templateId, setTemplateId] = useState<string | undefined>(
    params.templateId === 'new' ? undefined : params.templateId,
  )
  const [title, setTitle] = useState('')
  const [steps, setSteps] = useState<readonly WorkingStep[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [showIssues, setShowIssues] = useState(false)
  // Nothing is written before this turns true. It is the guard that stops an editor
  // that opened empty from saving that emptiness over a draft it had not read.
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState<number | undefined>(undefined)
  const [sheet, setSheet] = useState<Sheeted | undefined>(undefined)
  // One `setState` per gesture, never per frame: all it does is stand the layout
  // animation down while the transforms are the ones placing the rows.
  const [dragging, setDragging] = useState(false)

  // Which row is in the air and how far it has gone. Shared so every row can read them
  // in its own worklet; held here because they are the list's state, not one row's.
  const liftedFrom = useSharedValue(0)
  const liftedBy = useSharedValue(0)

  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Held outside state as well: a save scheduled before the creation resolved must
  // see the identity the creation produced, and state would still be the old one.
  const identity = useRef<string | undefined>(templateId)
  // The activity type the creation put in the draft. Every save has to send it back:
  // sending null erases it, and without it every step is refused as `target-family`.
  const activityType = useRef<string | null>(null)

  /**
   * Saves, and says whether it did. It reports a failure through `failure` as well,
   * because the autosave has nobody waiting on it — but publishing does, and a caller
   * that cannot tell a save from a silent failure will navigate away from the message.
   */
  const persist = useCallback(
    async (nextTitle: string, nextSteps: readonly WorkingStep[]): Promise<boolean> => {
      const trimmed = nextTitle.trim()
      if (trimmed === '') return false
      // The guard, and the reason it is here rather than at the call sites: a save
      // scheduled before the draft arrived would write an empty routine over it.
      if (!loaded) return false

      setSaving(true)
      try {
        if (!identity.current) {
          const template = await flow.createTemplate(DISCIPLINE, trimmed)
          identity.current = template.id
          activityType.current = template.draft.content.activity_type_id
          setTemplateId(template.id)
        }
        await flow.saveTemplateDraft(
          identity.current,
          stepsToContent(trimmed, nextSteps, activityType.current),
        )
        setSaved(true)
        setFailure(undefined)
        return true
      } catch (cause: unknown) {
        setFailure(
          cause instanceof ApiError && cause.failure === 'unauthenticated' ? EXPIRED : SAVE_FAILED,
        )
        return false
      } finally {
        setSaving(false)
      }
    },
    [flow, loaded],
  )

  const schedule = useCallback(
    (nextTitle: string, nextSteps: readonly WorkingStep[]) => {
      if (pending.current) clearTimeout(pending.current)
      pending.current = setTimeout(() => void persist(nextTitle, nextSteps), SAVE_DELAY_MS)
    },
    [persist],
  )

  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current)
    },
    [],
  )

  /**
   * Opening: either the routine named in the route, or the most recent draft.
   *
   * `/routines/new` used to mean "start empty", which is what left every unfinished
   * routine unreachable. It now means "carry on", because a person who left a draft
   * and came back is not asking for a blank page.
   */
  useEffect(() => {
    let active = true

    const resume = async (): Promise<void> => {
      let id = params.templateId === 'new' ? undefined : params.templateId
      if (!id) {
        const mine = await flow.readMyRoutines()
        id = mine.find((routine) => routine.template_version_id === null)?.template_id
      }
      if (!id) return
      const [draft, library] = await Promise.all([flow.openTemplate(id), readExerciseLibrary(flow)])
      if (!active) return
      const names = new Map(library.movements.map((movement) => [movement.id, movement.name]))
      identity.current = id
      activityType.current = draft.content.activity_type_id
      setTemplateId(id)
      setTitle(draft.content.title)
      setSteps(stepsFromContent(draft.content, (movementId) => names.get(movementId)))
      setSaved(true)
    }

    resume()
      .catch((cause: unknown) => {
        if (!active) return
        setFailure(
          cause instanceof ApiError && cause.failure === 'unauthenticated' ? EXPIRED : LOAD_FAILED,
        )
      })
      // Whatever happened, the screen stops holding the pen. A failure that left it
      // locked would be a screen nobody can type in, which is worse than a message.
      .finally(() => {
        if (active) setLoaded(true)
      })

    return () => {
      active = false
    }
  }, [flow, params.templateId])

  // Read through a ref so the effect below does not depend on it: naming a routine is
  // typing, and a dependency on the name would resubscribe on every keystroke.
  const named = useRef(title)
  useEffect(() => {
    named.current = title
  }, [title])

  // On focus rather than on mount: this screen stays on the stack while the picker is
  // above it, so mounting happens once and would never see what was chosen. Taking
  // empties the batch, which is what stops a second look from appending it again.
  useFocusEffect(
    useCallback(() => {
      const picked = takeExercisePick()
      if (picked.length === 0) return
      const substituted = replacingPosition()
      setSteps((current) => {
        const first = picked[0]
        const next =
          substituted !== undefined && first !== undefined
            ? replacedStep(current, substituted, first)
            : withPicked(current, picked)
        // One save for the whole batch. The sheet wrote the draft once per exercise.
        schedule(named.current, next)
        return next
      })
    }, [schedule]),
  )

  const rename = (next: string) => {
    setTitle(next)
    setSaved(false)
    schedule(next, steps)
  }

  const change = (next: readonly WorkingStep[]) => {
    setSteps(next)
    setSaved(false)
    schedule(title, next)
  }

  const issues = reasonsNotToPublish(title, steps)
  const publishable = issues.length === 0 && templateId !== undefined

  /**
   * Throwing it away. `OP-PLN-028` archives rather than deletes, and the pending save
   * is cancelled first: a timer that fires afterwards would write to something the
   * person just discarded.
   */
  const discard = async () => {
    if (!templateId) return router.back()
    if (pending.current) clearTimeout(pending.current)
    try {
      await flow.discardTemplate(templateId)
      router.back()
    } catch (cause: unknown) {
      setFailure(
        cause instanceof ApiError && cause.failure === 'unauthenticated' ? EXPIRED : SAVE_FAILED,
      )
    }
  }

  const publish = async () => {
    if (!templateId) return
    if (!publishable) {
      setShowIssues(true)
      return
    }
    if (pending.current) clearTimeout(pending.current)
    try {
      // Stay put when the draft did not land. Publishing on top of a failed save would
      // publish whatever the server still holds, and leaving hides the message.
      const stored = await persist(title, steps)
      if (!stored) return
      await flow.publishTemplate(templateId)
      router.back()
    } catch (cause: unknown) {
      setFailure(
        cause instanceof ApiError && cause.failure === 'unauthenticated' ? EXPIRED : SAVE_FAILED,
      )
    }
  }

  /**
   * Putting a row down without it jumping.
   *
   * The order is committed while the layout animation is still stood down, so React
   * places the rows directly where the transforms already showed them. Only then do
   * the shared values go back to zero and the animation come back — a frame later,
   * which is what stops the row from snapping to its old slot and sliding forward
   * again.
   */
  const settle = (fromPosition: number, to: number) => {
    if (to !== fromPosition) change(movedTo(steps, fromPosition, to))
    liftedFrom.set(0)
    liftedBy.set(0)
    requestAnimationFrame(() => setDragging(false))
  }

  const subtitle = () => {
    if (saving) return 'Guardando…'
    if (failure) return 'Sin guardar'
    if (saved) return 'Borrador guardado'
    return 'Aún sin guardar'
  }

  return (
    <Screen edges={['top', 'bottom']}>
      {/* Everything down to the counts stays put: the name, what it says about itself
          and how much of it there is are the frame, and a frame that scrolls away
          leaves somebody editing a list with no idea what they are editing. */}
      <View style={styles.frame}>
        <ScreenHeader
          title={title.trim() === '' ? 'Nueva rutina' : title}
          subtitle={subtitle()}
          // A named routine is already on the server, so leaving silently would keep
          // something nobody asked to keep.
          onClose={() => (templateId ? setSheet({ kind: 'leaving' }) : router.back())}
          onConfirm={templateId ? publish : undefined}
          confirmLabel="Listo"
        />

        {failure ? <InlineAlert message={failure} /> : null}

        {showIssues && issues.length > 0 ? (
          <View
            style={[
              styles.issues,
              {
                borderColor: theme.color.status.danger,
                backgroundColor: theme.color.background.surface,
              },
            ]}
          >
            <View style={styles.issuesHead}>
              <FoundationIcon
                name="warning"
                size="sm"
                color={theme.color.status.danger}
                decorative
              />
              <Text role="control" size="xs" style={{ color: theme.color.status.danger }}>
                {issues.length === 1
                  ? 'Falta una cosa para guardar'
                  : `Faltan ${issues.length} cosas para guardar`}
              </Text>
            </View>
            {issues.map((issue) => (
              <View key={issue.title} style={styles.issueText}>
                <Text role="control" size="sm">
                  {issue.title}
                </Text>
                <Text role="body" size="sm" color="muted">
                  {issue.hint}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <TextField
            label="Ponle un nombre"
            placeholder="Empuje, Pierna, Día 1…"
            value={title}
            onChangeText={rename}
            autoCapitalize="sentences"
          />
          <View style={styles.chips}>
            {SUGGESTIONS.map((suggestion) => (
              <Chip
                key={suggestion}
                label={suggestion}
                selected={title.trim() === suggestion}
                onPress={() => rename(suggestion)}
              />
            ))}
          </View>
        </View>

        {steps.length === 0 ? null : (
          <View
            style={[
              styles.stats,
              {
                borderColor: theme.color.border.subtle,
                backgroundColor: theme.color.background.surface,
              },
            ]}
          >
            <Figure icon="training" value={String(steps.length)} label="Ejercicios" />
            <View style={[styles.divider, { backgroundColor: theme.color.border.subtle }]} />
            <Figure icon="frequency" value={String(countSets(steps))} label="Series" accent />
          </View>
        )}
      </View>

      {/* Takes what the frame and the anchor leave, and no more: without this it
          sizes to its content and pushes the button off the bottom of the screen. */}
      <ScrollView
        style={styles.scroller}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {steps.length === 0 ? (
          <View
            style={[
              styles.empty,
              {
                borderColor: theme.color.border.subtle,
                backgroundColor: theme.color.background.surface,
              },
            ]}
          >
            <FoundationIcon
              name="training"
              size="lg"
              color={theme.color.icon.secondary}
              decorative
            />
            <Text role="control" size="lg" align="center">
              Todavía no hay ejercicios
            </Text>
            <Text role="body" size="md" color="muted" style={styles.centered}>
              Busca en el catálogo y añade el primero. Luego le pones series, peso y descanso.
            </Text>
            <Text role="body" size="sm" color="muted" style={styles.centered}>
              Se guarda como borrador según escribes. Necesita conexión.
            </Text>
          </View>
        ) : (
          steps.map((step) => (
            <DraggableRow
              key={step.movementId}
              step={step}
              count={steps.length}
              open={open === step.position}
              dragging={dragging}
              from={liftedFrom}
              travel={liftedBy}
              onLift={() => {
                setOpen(undefined)
                setDragging(true)
              }}
              onDrop={(to) => settle(step.position, to)}
              style={[
                styles.row,
                {
                  borderColor:
                    open === step.position ? theme.color.border.accent : theme.color.border.subtle,
                },
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${open === step.position ? 'Cerrar' : 'Abrir'} ${step.name}`}
                onPress={() => setOpen(open === step.position ? undefined : step.position)}
                style={styles.rowHead}
              >
                <Handle
                  name={step.name}
                  position={step.position}
                  count={steps.length}
                  onMove={(to) => change(movedTo(steps, step.position, to))}
                />
                <View style={styles.rowText}>
                  <Text role="control" size="md" numberOfLines={1}>
                    {step.name}
                  </Text>
                  <Text role="body" size="sm" color="accent">
                    {`${setsLabel(step.sets)} · ${restLabel(step.restSeconds)}`}
                  </Text>
                  {step.supersetGroup === undefined ? null : (
                    <Text role="control" size="xs" color="muted">
                      {`Superserie con ${String(chainMate(steps, step)).padStart(2, '0')}`}
                    </Text>
                  )}
                </View>
                {/* One glyph that turns, not two that swap: a swap has no
                        in-between and reads as a blink at this size. */}
                <Animated.View
                  style={[
                    styles.chevron,
                    { transform: [{ rotate: open === step.position ? '180deg' : '0deg' }] },
                  ]}
                >
                  <FoundationIcon
                    name="expand"
                    size="sm"
                    color={theme.color.icon.secondary}
                    decorative
                  />
                </Animated.View>
                {/* Kept beside the chevron as well as in the menu: removing an
                        exercise is the one thing done often enough to deserve a
                        target of its own. */}
                <RemoveButton
                  name={step.name}
                  onPress={() => {
                    setOpen(undefined)
                    change(withoutStep(steps, step.position))
                  }}
                />
              </Pressable>

              {open === step.position ? (
                <Animated.View entering={OPEN}>
                  <SetTable
                    step={step}
                    onChangeSets={(sets) => change(withSets(steps, step.position, sets))}
                    onKind={(order) =>
                      setSheet({ kind: 'set-kind', position: step.position, order })
                    }
                    onUnit={() =>
                      change(
                        withUnit(steps, step.position, otherUnit(step.loadUnit ?? OPENING_UNIT)),
                      )
                    }
                    onRest={() => setSheet({ kind: 'rest', position: step.position })}
                    onMenu={() => setSheet({ kind: 'menu', position: step.position })}
                  />
                </Animated.View>
              ) : null}
            </DraggableRow>
          ))
        )}
      </ScrollView>

      {/* Anchored: adding the next exercise is the one thing somebody does over and
          over here, and scrolling to the bottom of their own list to reach it is a
          tax that grows with the routine. */}
      <View style={styles.anchor}>
        <Button
          label={steps.length === 0 ? 'Buscar y añadir ejercicio' : 'Añadir ejercicio'}
          variant={steps.length === 0 ? 'primary' : 'secondary'}
          icon={steps.length === 0 ? 'search' : 'add'}
          onPress={() => {
            declareAlreadyIn(steps.map((one) => one.movementId))
            declareReplacing(undefined)
            router.push('/routines/exercises')
          }}
        />
      </View>

      <Sheet
        visible={sheet?.kind === 'leaving'}
        onDismiss={() => setSheet(undefined)}
        title="¿Guardas esta rutina?"
      >
        <View style={styles.sheet}>
          <Text role="body" size="md" color="muted">
            Se está guardando como borrador según escribes. Puedes dejarla para después o tirarla.
          </Text>
          <Button
            label="Guardar borrador"
            onPress={() => {
              setSheet(undefined)
              router.back()
            }}
          />
          <Button
            label="Descartar rutina"
            variant="ghost"
            icon="remove"
            onPress={() => {
              setSheet(undefined)
              void discard()
            }}
          />
        </View>
      </Sheet>

      <Sheet
        visible={sheet?.kind === 'set-kind'}
        onDismiss={() => setSheet(undefined)}
        title="Tipo de serie"
      >
        <View style={styles.sheet}>
          {(['normal', 'warmup', 'to_failure', 'drop'] as const).map((kind) => (
            <SheetChoice
              key={kind}
              name={SET_KIND_NAMES[kind]}
              tone={SET_KIND_TONES[kind]}
              selected={kindAt(steps, sheet) === kind}
              detail={SET_KIND_DETAILS[kind]}
              onPress={() => {
                if (sheet?.kind !== 'set-kind') return
                const step = steps.find((one) => one.position === sheet.position)
                const current = step?.sets[sheet.order]
                if (!step || !current) return
                change(
                  withSets(
                    steps,
                    sheet.position,
                    step.sets.map((each, at) => (at === sheet.order ? withKind(each, kind) : each)),
                  ),
                )
                setSheet(undefined)
              }}
            />
          ))}
        </View>
      </Sheet>

      <Sheet
        visible={sheet?.kind === 'rest'}
        onDismiss={() => setSheet(undefined)}
        title="Descanso entre series"
      >
        <View style={styles.sheet}>
          <Text role="body" size="sm" color="muted">
            Cuánto esperas antes de la siguiente serie.
          </Text>

          {/* Any rest, not one of seven. The presets below are a shortcut to the
              common answers, never the whole set of them. */}
          <Stepper
            accessibilityLabel="Descanso entre series"
            value={restAt(steps, sheet)}
            min={0}
            max={REST_MAX_SECONDS}
            step={REST_STEP_SECONDS}
            format={restPresetLabel}
            caption={`de ${REST_STEP_SECONDS} en ${REST_STEP_SECONDS} segundos`}
            grow
            style={{ borderColor: theme.color.border.accent }}
            onChange={(seconds) => {
              if (sheet?.kind !== 'rest') return
              change(withRest(steps, sheet.position, seconds))
            }}
          />

          <Text role="control" size="sm" color="secondary">
            O elige uno habitual
          </Text>
          <View style={styles.chips}>
            {REST_PRESETS.map((preset) => (
              <Chip
                key={preset}
                label={restPresetLabel(preset)}
                selected={restAt(steps, sheet) === preset}
                onPress={() => {
                  if (sheet?.kind !== 'rest') return
                  change(withRest(steps, sheet.position, preset))
                }}
              />
            ))}
          </View>
        </View>
      </Sheet>

      <Sheet
        visible={sheet?.kind === 'superset'}
        onDismiss={() => setSheet(undefined)}
        title="Superserie"
      >
        <View style={styles.sheet}>
          <Text role="body" size="sm" color="muted">
            Se hacen seguidos, sin descanso entre medias. Solo puedes encadenar con un ejercicio
            contiguo; para encadenar otro, muévelo antes.
          </Text>
          {neighbours(steps, sheet?.kind === 'superset' ? sheet.position : 0).map((mate) => (
            <SheetChoice
              key={mate.position}
              name={mate.name}
              detail={`${String(mate.position).padStart(2, '0')} · ${
                mate.position < (sheet?.kind === 'superset' ? sheet.position : 0)
                  ? 'justo antes'
                  : 'justo después'
              }`}
              onPress={() => {
                if (sheet?.kind !== 'superset') return
                change(withChain(steps, sheet.position, mate.position))
                setSheet(undefined)
              }}
            />
          ))}
        </View>
      </Sheet>

      <Sheet
        visible={sheet?.kind === 'menu'}
        onDismiss={() => setSheet(undefined)}
        title="Ejercicio"
      >
        <View style={styles.sheet}>
          <SheetChoice
            name="Reemplazar ejercicio"
            detail="Buscar otro y conservar las series"
            onPress={() => {
              if (sheet?.kind !== 'menu') return
              // Everything but the one being swapped, so the picker does not offer
              // back an exercise the routine already trains.
              declareAlreadyIn(
                steps.filter((one) => one.position !== sheet.position).map((one) => one.movementId),
              )
              declareReplacing(sheet.position)
              setSheet(undefined)
              router.push('/routines/exercises')
            }}
          />
          {sheet?.kind === 'menu' &&
          steps.find((one) => one.position === sheet.position)?.supersetGroup !== undefined ? (
            <SheetChoice
              name="Quitar de la superserie"
              detail="Deja de encadenarse con su vecino"
              onPress={() => {
                if (sheet?.kind !== 'menu') return
                change(withChain(steps, sheet.position, undefined))
                setSheet(undefined)
              }}
            />
          ) : (
            <SheetChoice
              name="Hacer superserie"
              detail="Encadenarlo con el de al lado"
              onPress={() => {
                if (sheet?.kind !== 'menu') return
                setSheet({ kind: 'superset', position: sheet.position })
              }}
            />
          )}
        </View>
      </Sheet>
    </Screen>
  )
}

/** One line of a sheet: what it is, why, and what it will look like. */
function SheetChoice({
  name,
  detail,
  shape,
  tone,
  selected,
  onPress,
}: {
  readonly name: string
  readonly detail: string
  readonly shape?: string
  /** Draws the name as its badge instead of as a word, for a choice that has one. */
  readonly tone?: BadgeTone
  readonly selected?: boolean
  readonly onPress: () => void
}) {
  const theme = useTheme()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityHint={detail}
      accessibilityState={{ selected: selected ?? false }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        {
          borderColor: selected ? theme.color.border.accent : theme.color.border.subtle,
          backgroundColor: theme.color.background.surface,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={styles.choiceText}>
        {tone === undefined ? (
          <Text role="control" size="md">
            {name}
          </Text>
        ) : (
          <Badge label={name} tone={tone} />
        )}
        <Text role="body" size="sm" color="muted">
          {detail}
        </Text>
      </View>
      {shape === undefined ? null : (
        <Text role="body" size="sm" color="accent">
          {shape}
        </Text>
      )}
    </Pressable>
  )
}

/** Only the exercise before and the one after: `IX-46` refuses anything else. */
function neighbours(steps: readonly WorkingStep[], position: number): readonly WorkingStep[] {
  return steps.filter((step) => step.position === position - 1 || step.position === position + 1)
}

/** Who the chain's other end is, for the line that says so. */
function chainMate(steps: readonly WorkingStep[], step: WorkingStep): number {
  const mate = steps.find(
    (one) => one.supersetGroup === step.supersetGroup && one.position !== step.position,
  )
  return mate?.position ?? step.position
}

function withSets(
  steps: readonly WorkingStep[],
  position: number,
  sets: readonly WorkingSet[],
): readonly WorkingStep[] {
  return steps.map((step) => (step.position === position ? { ...step, sets } : step))
}

/** One bar, one unit: the exercise carries it and every set of it is said in it. */
function withUnit(
  steps: readonly WorkingStep[],
  position: number,
  loadUnit: MassUnit,
): readonly WorkingStep[] {
  return steps.map((step) => (step.position === position ? { ...step, loadUnit } : step))
}

function withRest(
  steps: readonly WorkingStep[],
  position: number,
  restSeconds: number | undefined,
): readonly WorkingStep[] {
  return steps.map((step) =>
    step.position === position
      ? { ...step, ...(restSeconds === undefined ? {} : { restSeconds }) }
      : step,
  )
}

/**
 * Chaining, and only with a neighbour.
 *
 * `IX-46` refuses a group whose positions are not consecutive, so offering to chain
 * with anything else would be offering something the server rejects. Unchaining frees
 * both ends: a chain of one is not a chain.
 */
function withChain(
  steps: readonly WorkingStep[],
  position: number,
  mate: number | undefined,
): readonly WorkingStep[] {
  if (mate === undefined) {
    const group = steps.find((step) => step.position === position)?.supersetGroup
    return steps.map((step) => {
      if (step.supersetGroup !== group) return step
      // Removed rather than set to undefined: the key's absence is what the contract
      // means by "not chained", and `exactOptionalPropertyTypes` agrees.
      const { supersetGroup: _chained, ...rest } = step
      return rest
    })
  }
  const group = Math.max(0, ...steps.map((step) => step.supersetGroup ?? 0)) + 1
  return steps.map((step) =>
    step.position === position || step.position === mate ? { ...step, supersetGroup: group } : step,
  )
}

/** Moving one up is the only reorder the canvases ask for, and it renumbers. */

/**
 * The sets of one exercise, and the three sheets it opens.
 *
 * Reps are edited in place with a stepper rather than a keyboard: a number pad over a
 * table is a keyboard covering the thing being edited, and the values are small.
 */
function SetTable({
  step,
  onChangeSets,
  onKind,
  onUnit,
  onRest,
  onMenu,
}: {
  readonly step: WorkingStep
  readonly onChangeSets: (sets: readonly WorkingSet[]) => void
  readonly onKind: (order: number) => void
  readonly onUnit: () => void
  readonly onRest: () => void
  readonly onMenu: () => void
}) {
  const theme = useTheme()

  const unit = step.loadUnit ?? OPENING_UNIT
  const edit = (order: number, set: WorkingSet) =>
    onChangeSets(step.sets.map((each, at) => (at === order ? set : each)))

  return (
    <View style={styles.table}>
      {/* Every column named, and the one heading that is itself a control says so in
          the accent. Ink & Signal keeps that colour for what can be acted on, so a
          blue heading means «press this» rather than «this column is important». */}
      <View style={styles.tableHead}>
        <Text role="eyebrow" size="xs" color="muted" style={styles.colOrder}>
          #
        </Text>
        <Text role="eyebrow" size="xs" color="muted" style={styles.colKind}>
          Tipo
        </Text>
        <View style={styles.colCell}>
          <Text role="eyebrow" size="xs" color="muted">
            Reps
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Peso en ${unit}. Cambiar a ${otherUnit(unit)}`}
          hitSlop={PRESS_SLOP}
          onPress={onUnit}
          style={styles.colCell}
        >
          <Text role="eyebrow" size="xs" color="accent">
            {unit}
          </Text>
        </Pressable>
        <View style={styles.colClose} />
      </View>

      {step.sets.map((one, order) => (
        <View key={order} style={[styles.tableRow, { borderTopColor: theme.color.border.subtle }]}>
          <Text role="body" size="sm" color="muted" style={styles.colOrder}>
            {order + 1}
          </Text>
          <View style={styles.colKind}>
            <Badge
              label={SET_KIND_NAMES[one.kind]}
              tone={SET_KIND_TONES[one.kind]}
              accessibilityLabel={`Tipo de la serie ${order + 1}: ${SET_KIND_NAMES[one.kind]}`}
              onPress={() => onKind(order)}
            />
          </View>
          <NumberField
            accessibilityLabel={`Repeticiones de la serie ${order + 1}`}
            value={one.reps}
            unit="reps"
            min={1}
            max={100}
            // A set to failure has no number by definition, and the database refuses
            // the pair rather than correcting it.
            {...(one.kind === 'to_failure' ? { fixedAs: 'máx' } : {})}
            onChange={(reps) => edit(order, withReps(one, reps))}
          />
          <NumberField
            accessibilityLabel={`Peso de la serie ${order + 1} en ${unit}`}
            value={one.load}
            unit={unit}
            max={500}
            onChange={(load) => edit(order, withLoad(one, load))}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Quitar la serie ${order + 1}`}
            hitSlop={PRESS_SLOP}
            disabled={step.sets.length === 1}
            onPress={() => onChangeSets(step.sets.filter((_, at) => at !== order))}
          >
            <FoundationIcon
              name="close"
              size="md"
              color={
                step.sets.length === 1 ? theme.color.text.disabled : theme.color.icon.secondary
              }
              decorative
            />
          </Pressable>
        </View>
      ))}

      {/* Part of the table, not of a toolbar: it belongs after the last set, which is
          where the finger already is when somebody wants another one. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Añadir una serie"
        hitSlop={PRESS_SLOP}
        onPress={() => onChangeSets([...step.sets, { kind: 'normal', reps: 8 }])}
        style={[styles.addSet, { borderTopColor: theme.color.border.subtle }]}
      >
        <FoundationIcon name="add" size="sm" color={theme.color.icon.accent} decorative />
        <Text role="control" size="sm" color="accent">
          Añadir serie
        </Text>
      </Pressable>

      {/* The rest carries a value; the menu opens something. Nothing else belongs in
          a row under the table. */}
      <View style={styles.tableActions}>
        <Button
          label={restLabel(step.restSeconds)}
          variant="secondary"
          size="sm"
          icon="time"
          onPress={onRest}
        />
        <IconButton icon="more" size="sm" accessibilityLabel="Más opciones" onPress={onMenu} />
      </View>
    </View>
  )
}

/**
 * A row that can be picked up, with every other row getting out of its way as it goes.
 *
 * **The whole list moves during the drag, not after it.** Two shared values say it:
 * which position is in the air and how far it has travelled. Every row reads both in
 * its own `useAnimatedStyle` and works out whether the one in the air has passed over
 * it — if it has, the row steps aside by exactly one place. That computation is a
 * worklet, so it runs per frame on the UI runtime and React renders nothing at all
 * between picking up and putting down.
 *
 * **Held, not pressed.** The pan activates after a quarter of a second of stillness,
 * which is what both platforms use for reorder and what keeps this gesture from
 * fighting the scroll view it lives in — a pan that won immediately would make the
 * list unscrollable wherever a finger happened to land on a grip.
 *
 * **The layout animation stands down while a drag is on.** `REFLOW` animates a row
 * from where it used to be to where it now is, which is exactly the wrong thing at the
 * moment of dropping: the transform has already put the row in its new place, so the
 * two would fight and the row would jump back a slot before sliding forward again. It
 * comes back a frame after the order is committed, which is one `setState` per gesture
 * rather than per frame.
 */
function DraggableRow({
  step,
  count,
  open,
  dragging,
  from,
  travel,
  onLift,
  onDrop,
  style,
  children,
}: {
  readonly step: WorkingStep
  readonly count: number
  /** An open row is not draggable: its own content takes the long press. */
  readonly open: boolean
  readonly dragging: boolean
  readonly from: SharedValue<number>
  readonly travel: SharedValue<number>
  readonly onLift: () => void
  readonly onDrop: (to: number) => void
  readonly style: StyleProp<ViewStyle>
  readonly children: ReactNode
}) {
  const position = step.position

  const drag = Gesture.Pan()
    // Shut only. Open, the row holds a table of number fields, and a long press on one
    // of them would lift the whole exercise instead of putting a caret in it.
    .enabled(!open)
    .activateAfterLongPress(250)
    .onStart(() => {
      from.set(position)
      travel.set(0)
      scheduleOnRN(onLift)
    })
    .onUpdate((event) => {
      travel.set(event.translationY)
    })
    .onEnd((event, success) => {
      const landed = success ? placeOf(position, event.translationY, count) : position
      scheduleOnRN(onDrop, landed)
    })

  const moving = useAnimatedStyle(() => {
    const lifted = from.get()
    if (lifted === 0) return { transform: [{ translateY: 0 }, { scale: 1 }], opacity: 1, zIndex: 0 }
    if (lifted === position) {
      return {
        transform: [{ translateY: travel.get() }, { scale: 1.02 }],
        opacity: 0.94,
        zIndex: 2,
      }
    }
    return {
      transform: [
        { translateY: withTiming(aside(position, lifted, travel.get(), count), STEP_ASIDE) },
        { scale: 1 },
      ],
      opacity: 1,
      zIndex: 0,
    }
  })

  return (
    <GestureDetector gesture={drag}>
      <Animated.View
        // The row it leaves behind closes the gap rather than snapping shut, and both
        // honour the system setting rather than deciding for it.
        exiting={EXIT}
        {...(dragging ? {} : { layout: REFLOW })}
        style={[style, moving]}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  )
}

/**
 * The grip. It is the drag's affordance and, for anyone who cannot drag, its equal.
 *
 * A pan is invisible to a screen reader and impossible with a switch or a keyboard, so
 * the same control is `adjustable`: the reader announces where the exercise is, and an
 * increment or decrement moves it one place. Dragging is the fast path, never the only
 * one — `ACCESSIBILITY.md` asks for the equivalent, not for the same gesture.
 */
function Handle({
  name,
  position,
  count,
  onMove,
}: {
  readonly name: string
  readonly position: number
  readonly count: number
  readonly onMove: (to: number) => void
}) {
  const theme = useTheme()

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`Orden de ${name}`}
      accessibilityValue={{ min: 1, max: count, now: position, text: `${position} de ${count}` }}
      accessibilityHint="Con el ejercicio cerrado, mantén pulsado y arrastra para moverlo"
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'increment') onMove(Math.min(count, position + 1))
        if (event.nativeEvent.actionName === 'decrement') onMove(Math.max(1, position - 1))
      }}
      accessibilityActions={ACCESSIBLE_MOVES}
      style={styles.handle}
    >
      <FoundationIcon name="reorder" size="sm" color={theme.color.icon.secondary} decorative />
      <Text role="body" size="sm" color="muted">
        {String(position).padStart(2, '0')}
      </Text>
    </View>
  )
}

const ACCESSIBLE_MOVES = [
  { name: 'increment' as const, label: 'Bajarlo un lugar' },
  { name: 'decrement' as const, label: 'Subirlo un lugar' },
]

/**
 * The trash can, which answers the finger before the row goes.
 *
 * Removing an exercise is occasional and its purpose is feedback: the press has to
 * register on press-in, because waiting for the tap to complete is the latency a
 * person actually perceives. It is a two-state change with no gesture behind it, so
 * it is a transition on a plain value and not a worklet — nothing here runs per frame.
 *
 * 44 pt of reach with `hitSlop` rather than a bigger glyph: `docs/ACCESSIBILITY.md`
 * measures what the finger can hit, not what the eye can see.
 */
function RemoveButton({ name, onPress }: { readonly name: string; readonly onPress: () => void }) {
  const theme = useTheme()
  const [held, setHeld] = useState(false)

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Quitar ${name}`}
      hitSlop={PRESS_SLOP}
      onPressIn={() => setHeld(true)}
      onPressOut={() => setHeld(false)}
      onPress={onPress}
    >
      <Animated.View style={[styles.remove, { transform: [{ scale: held ? 0.82 : 1 }] }]}>
        <FoundationIcon name="remove" size="sm" color={theme.color.icon.secondary} decorative />
      </Animated.View>
    </Pressable>
  )
}

/**
 * One count in the summary card: its glyph, the number, the word.
 *
 * The number is set in the `data` role — the library's own role for a metric — which
 * is condensed and uses tabular figures. Both matter here: proportional digits change
 * width, so the word beside them shifted every time an exercise was added, and the
 * condensed face is what lets the count and its label share one line instead of
 * stacking into a card twice as tall as it needs to be.
 */
function Figure({
  icon,
  value,
  label,
  accent,
}: {
  readonly icon: 'training' | 'frequency'
  readonly value: string
  readonly label: string
  readonly accent?: boolean
}) {
  const theme = useTheme()
  return (
    <View style={styles.figure}>
      <FoundationIcon
        name={icon}
        size="sm"
        color={accent ? theme.color.icon.accent : theme.color.icon.secondary}
        decorative
      />
      <Text role="data" size="2xl" color={accent ? 'accent' : 'primary'}>
        {value}
      </Text>
      <Text role="body" size="sm" color="muted">
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  // The frozen part and the moving part. The list owns the gap between its rows;
  // the frame owns the air around the things that do not move.
  frame: { gap: 18, paddingBottom: 16 },
  scroller: { flex: 1 },
  list: { gap: 10, paddingBottom: 16 },
  // The safe area only reserves the home indicator; it is not air. The same lift the
  // onboarding footers use, so a button at the bottom sits the same everywhere.
  anchor: { paddingTop: 12, paddingBottom: FOOTER_LIFT },
  section: { gap: 10 },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  centered: { textAlign: 'center' },
  empty: {
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 28,
    paddingHorizontal: 22,
    alignItems: 'center',
    gap: 10,
  },
  // A card, not a rule under the numbers: the two counts are one reading of the
  // routine, and the divider between them is what says so.
  stats: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 12,
  },
  // Glyph, number and word on one line. Stacked, the card was eighty points of
  // mostly nothing above a list that is what the screen is actually about.
  figure: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  divider: { width: 1, alignSelf: 'stretch' },
  // A column. It held only the head until the table went in beside it, and a row
  // laid the two side by side: `rowText` takes the free space with `flex: 1`, so
  // the table was squeezed to its minimum width and read as nothing opening.
  row: { borderWidth: 1, borderRadius: 16, padding: 14, overflow: 'hidden' },
  // The grip and the number read as one thing: what the row is and where it sits.
  handle: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowText: { flex: 1, gap: 3 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  table: { gap: 2, paddingTop: 12 },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
  },
  colOrder: { width: 18 },
  addSet: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderTopWidth: 1,
  },
  tableActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingTop: 10,
  },
  // Mirrors the set row below it, or the headings sit over the wrong columns.
  tableHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 4 },
  colKind: { flex: 1 },
  colCell: { minWidth: 62, alignItems: 'center' },
  colClose: { width: 20 },
  sheet: { gap: 10, paddingBottom: 8 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  choiceText: { flex: 1, gap: 2 },
  // A transition rather than a worklet: the value is a two-state flip, not a gesture.
  remove: { transitionProperty: 'transform', transitionDuration: PRESS_MS },
  chevron: { transitionProperty: 'transform', transitionDuration: 200 },
  issues: { borderWidth: 2, borderRadius: 18, padding: 16, gap: 12 },
  issuesHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  issueText: { gap: 2 },
})
