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
import { Badge, badgeToneColor, identityTone, type BadgeTone } from '@allfitone/react-native/badge'
import { Chip } from '@allfitone/react-native/chip'
import { Sheet } from '@allfitone/react-native/sheet'
import { Stepper } from '@allfitone/react-native/stepper'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { IconButton } from '@allfitone/react-native/icon-button'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { NumberField } from '@allfitone/react-native/number-field'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { CoverTile } from '@allfitone/react-native/cover-tile'
import { SegmentedControl } from '@allfitone/react-native/segmented-control'
import { TextField } from '@allfitone/react-native/text-field'
import { useTheme } from '@allfitone/react-native/theme'
import { Image } from 'expo-image'
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
  measure,
  scrollTo,
  useAnimatedRef,
  useAnimatedStyle,
  useFrameCallback,
  useScrollOffset,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'

import { scheduleOnRN } from 'react-native-worklets'

import { ApiError } from '../../src/client'
import { createSpaceContentFlow } from '../../src/client/content-transport'
import { aside, edgeScroll, nextOffset, placeOf } from '../../src/client/drag-order'
import { createQueue } from '../../src/client/queue'
import { coverFailure, saveFailure } from '../../src/client/save-failure'
import { offerPublishedRoutine } from '../../src/client/routine-handoff'
import { revealOffset, type Frame } from '../../src/client/reveal'
import { readExerciseLibrary, type ExerciseLibrary } from '../../src/client/exercise-library'
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
  chainLetters,
  chainedWith,
  movedTo,
  replacedStep,
  stepsFromContent,
  stepsToContent,
  unchained,
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
import { coverArt } from '../../src/components/routine-cover-art'
import {
  COVER_ICONS,
  coverFromContent,
  iconCover,
  MUSCLE_COVER,
  musclesWorked,
  photoCover,
  sameCover,
  withCover,
  type RoutineCover,
} from '../../src/client/routine-cover'
import { canPickPhotos, pickCoverPhoto } from '../../src/client/cover-picking'
import { readSession } from '../../src/client/session'

const SUGGESTIONS = ['Empuje', 'Tirón', 'Pierna', 'Full body']

/** Long enough that a name is not a save per keystroke, short enough to feel saved. */
const SAVE_DELAY_MS = 700

/** DT-010 measures the target, not the glyph, and the glyph here is 16. */
const PRESS_SLOP = { top: 14, bottom: 14, left: 14, right: 14 }

/** Keeps the button off the very bottom edge, the same amount as every other footer. */
const FOOTER_LIFT = 16

/** `CoverTile`'s own `md`. The art has to be told, because it draws inside it. */
const COVER_MD = 72

/**
 * What every cover panel occupies, whichever one is showing.
 *
 * Three rows of the grid. Without it the sheet was a different height on each tab and
 * grew and shrank under the thumb as somebody compared them, which is the one moment
 * they are meant to be comparable. The grid scrolls past it; the other two centre in it.
 */
const COVER_PANEL = 3 * COVER_MD + 2 * 10

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
  | { readonly kind: 'discarding' }
  | { readonly kind: 'menu'; readonly position: number }
  | { readonly kind: 'rest'; readonly position: number }
  | { readonly kind: 'superset'; readonly position: number }
  | { readonly kind: 'set-kind'; readonly position: number; readonly order: number }
  | { readonly kind: 'cover' }

const LOAD_FAILED = 'No pudimos abrir el borrador. Revisa tu conexión.'

const EXPIRED = 'Tu sesión venció. Vuelve a entrar para continuar.'

export default function RoutineEditor() {
  const router = useRouter()
  const theme = useTheme()
  const flow = useMemo(() => createSpaceContentFlow(), [])
  const saves = useMemo(() => createQueue(), [])
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
  const [settling, setSettling] = useState(false)
  /**
   * Whether this routine already exists as a published version.
   *
   * It changes what the screen *is*. A new routine is being written, so it saves as it
   * goes and leaving asks whether to keep the draft. One that is already out there is
   * being **edited**, and editing has a cancel: nothing is written until the tick, and
   * the X throws the visit away.
   *
   * The signal is a published version of this template, which is what `my-content`
   * reports. It is deliberately **not** the draft's `derived_from_version_id`: that
   * one records a draft forked *from somebody else's* version, and a template
   * publishing its own leaves it null — as the database plainly shows.
   */
  const [editing, setEditing] = useState(false)
  // Presentation, not prescription: the draft carries a movement's identifier and
  // nothing about how it looks, so the picture is looked up rather than stored.
  const [previews, setPreviews] = useState<ReadonlyMap<string, string | null>>(new Map())
  /**
   * How this routine wants to be seen, which is a choice and not a requirement.
   *
   * Kept in a ref as well as in state for the same reason the activity type is: a save
   * scheduled before the last press settled reads the ref, and state would still be
   * showing the cover somebody just replaced.
   */
  const [cover, setCover] = useState<RoutineCover | undefined>(undefined)
  const chosenCover = useRef<RoutineCover | undefined>(undefined)
  // The vocabularies the cover sheet chooses from. The library is cached for the life
  // of the process, so holding it here costs a reference and no round trip.
  const [library, setLibrary] = useState<ExerciseLibrary | undefined>(undefined)
  const [coverTab, setCoverTab] = useState<'muscles' | 'icon' | 'photo'>('icon')
  const [uploading, setUploading] = useState(false)
  // A photograph is fetched by `expo-image` and not by us, so the screen has to hand it
  // the bearer header: `ADR-031` serves the bytes through the API and there is no
  // public url to point at.
  const [token, setToken] = useState<string | undefined>(undefined)

  // Which row is in the air and how far it has gone. Shared so every row can read them
  // in its own worklet; held here because they are the list's state, not one row's.
  const liftedFrom = useSharedValue(0)
  const liftedBy = useSharedValue(0)

  // Measured rather than assumed: an open exercise is four times a shut one, and the
  // amount to scroll is the difference between the two.
  const scroller = useAnimatedRef<Animated.ScrollView>()
  const frames = useRef(new Map<number, Frame>())
  // Only the height. The offset comes from `scrolled`, which Reanimated keeps, and a
  // second copy of it is a second copy that falls behind.
  const viewport = useRef(0)

  // Where the finger is and how far the list has scrolled, both on the UI runtime:
  // the list has to follow a finger held against its edge, and doing that from JS
  // would mean a round trip per frame while a gesture is in flight.
  const fingerY = useSharedValue(0)
  // Reanimated's own view of where the list is. Not a number of ours: what the list
  // was *asked* to do and what it did are different at the end of the content, and
  // only the second one can be trusted.
  const scrolled = useScrollOffset(scroller)
  const chased = useSharedValue(0)
  const content = useSharedValue(0)

  /**
   * The list coming to the finger, once per frame and only while something is lifted.
   *
   * `travel` is bumped by whatever was scrolled, because the row being dragged lives
   * inside the list: without that it would ride away with the content instead of
   * staying under the finger — and the destination, which is read off `travel`, would
   * stop advancing exactly when the list started moving.
   */
  const chase = useFrameCallback(() => {
    if (liftedFrom.get() === 0) return
    const list = measure(scroller)
    if (list === null) return

    // What the list *did* since the last frame, never what it was asked to do. The
    // platform stops at the real end of its content, and adding the request instead
    // was the defect: held at the bottom edge, the drag ran away below the list for
    // as long as the finger stayed there.
    const now = scrolled.get()
    const moved = now - chased.get()
    if (moved !== 0) liftedBy.set(liftedBy.get() + moved)
    chased.set(now)

    const by = edgeScroll(fingerY.get(), list.pageY, list.height)
    if (by === 0) return

    const to = nextOffset(now, by, content.get() - list.height)
    if (to !== now) scrollTo(scroller, 0, to, false)
  }, false)

  /**
   * Letting go, in the one order that does not flash.
   *
   * **The defect this replaces:** the offsets were zeroed the instant the finger left,
   * and the reorder was a `setState` React commits a few frames later. In between,
   * every row was drawn in its old place with no offset at all — the whole list
   * snapped back to the order it had before the drag and then jumped to the new one,
   * which read as the rows scrambling.
   *
   * An effect runs after the commit that carries the new order, so by the time the
   * offsets go the rows are already where those offsets were pretending they were.
   * The layout animation comes back a render later still: turned on any sooner it
   * would animate rows from where they used to be, which is the same jump again.
   */
  useEffect(() => {
    if (!settling) return
    liftedFrom.set(0)
    liftedBy.set(0)
    setSettling(false)
    setDragging(false)
  }, [settling, liftedFrom, liftedBy])

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

      // Queued, never raced. A save answers with the etag the next one has to send, so
      // two in flight means the second carries an etag the first is replacing.
      return saves(async () => {
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
            withCover(
              stepsToContent(trimmed, nextSteps, activityType.current),
              chosenCover.current,
            ),
          )
          setSaved(true)
          setFailure(undefined)
          return true
        } catch (cause: unknown) {
          setFailure(saveFailure(cause))
          return false
        } finally {
          setSaving(false)
        }
      })
    },
    [flow, loaded, saves],
  )

  /**
   * The autosave, and it belongs to writing rather than to editing.
   *
   * A routine being written for the first time has nowhere else to live, so every
   * keystroke goes to its draft. A routine that is already published does have
   * somewhere else to live — the version somebody is training from — and writing half
   * an edit into its draft as it is typed means leaving the screen leaves the edit
   * behind, which is not what cancel means anywhere else.
   */
  const schedule = useCallback(
    (nextTitle: string, nextSteps: readonly WorkingStep[]) => {
      if (editing) return
      if (pending.current) clearTimeout(pending.current)
      pending.current = setTimeout(() => void persist(nextTitle, nextSteps), SAVE_DELAY_MS)
    },
    [persist, editing],
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
      // Read whether or not there is a draft: a routine started from nothing shows
      // pictures too, and the library is a process-lifetime cache, so asking twice in
      // one session costs nothing.
      const [library, mine] = await Promise.all([readExerciseLibrary(flow), flow.readMyRoutines()])
      if (!active) return
      setLibrary(library)
      void readSession().then((stored) => {
        if (active) setToken(stored?.accessToken)
      })
      setPreviews(new Map(library.movements.map((movement) => [movement.id, movement.demo_url])))

      let id = params.templateId === 'new' ? undefined : params.templateId
      if (!id) id = mine.find((routine) => routine.template_version_id === null)?.template_id
      if (!id) return

      // Asked for before the draft, because it decides what this screen is: writing
      // one that does not exist yet, or editing one somebody may already be training
      // from. Everything below reads differently depending on the answer.
      const known = mine.find((routine) => routine.template_id === id)
      const draft = await flow.openTemplate(id)
      if (!active) return
      const names = new Map(library.movements.map((movement) => [movement.id, movement.name]))
      identity.current = id
      activityType.current = draft.content.activity_type_id
      setTemplateId(id)
      setTitle(draft.content.title)
      setSteps(stepsFromContent(draft.content, (movementId) => names.get(movementId)))
      chosenCover.current = coverFromContent(draft.content)
      setCover(chosenCover.current)
      setEditing(known?.template_version_id != null)
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

  /**
   * Choosing a cover, or taking it off — which is the same act with no argument.
   *
   * The ref moves first because `schedule` runs the save from it, and a `setState` that
   * had not landed yet would save the cover this one replaces.
   */
  const chooseCover = (next: RoutineCover | undefined) => {
    chosenCover.current = next
    setCover(next)
    setSaved(false)
    setSheet(undefined)
    schedule(title, steps)
  }

  /**
   * Taking a photograph for the cover.
   *
   * **The routine has to exist first.** A photograph is stored against a template, so
   * there is nothing to attach it to until the name has created one; the tab says so
   * rather than opening a picker that cannot end anywhere.
   *
   * It goes through the same queue as the saves. An upload racing the autosave would
   * have the draft naming a photograph the server has not finished storing.
   */
  const takePhoto = async () => {
    if (!identity.current) return

    // Everything is inside, including the picker. Outside it, anything the picker threw
    // left the screen looking untouched and surfaced as an unhandled rejection with a
    // message nobody could act on — which is how a missing native module reported
    // itself, since Metro inlines requires and only loads it at the first press.
    setUploading(true)
    try {
      const picked = await pickCoverPhoto()
      if (picked === undefined) return

      const stored = await saves(() =>
        flow.uploadCoverPhoto(identity.current as string, picked.contentType, picked.content),
      )
      chooseCover(photoCover(stored.id))
    } catch (cause: unknown) {
      setFailure(coverFailure(cause))
    } finally {
      setUploading(false)
    }
  }

  // Asked once: whether this build carries the picker at all. A press that cannot end
  // anywhere is better not offered than offered and refused.
  const pickable = canPickPhotos()

  // What a muscle cover draws, recomputed from the exercises rather than stored: a
  // saved list of muscles would describe the routine that used to be here.
  const worked = musclesWorked(
    steps.map((step) => step.movementId),
    library?.movements ?? [],
  )

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
      setFailure(saveFailure(cause))
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
      const version = await flow.publishTemplate(templateId)
      // Said out loud rather than left to be deduced: whoever sent us here — a
      // programme waiting to put this on a Monday — cannot work out which routine was
      // just written by looking at a list, and does not have to.
      offerPublishedRoutine({ templateId, versionId: version.id })
      router.back()
    } catch (cause: unknown) {
      setFailure(saveFailure(cause))
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
    chase.setActive(false)
    if (to !== fromPosition) change(movedTo(steps, fromPosition, to))
    setSettling(true)
  }

  // Recomputed from the steps rather than stored: a stored letter is one more thing
  // that can disagree with the list it labels.
  const letters = chainLetters(steps)

  /** A letter and a colour per chain, so two of them one after the other are two. */
  const chainMark = (group: number | undefined) => {
    if (group === undefined) return undefined
    const letter = letters.get(group)
    if (letter === undefined) return undefined
    const tone = identityTone([...letters.keys()].indexOf(group))
    return { letter, tone, color: badgeToneColor(theme, tone) }
  }

  /**
   * Brings whatever is open wholly into view, on the measurement rather than on the
   * press: the row is still its shut height when the finger leaves it, and scrolling
   * then would aim at a box that is about to grow.
   */
  const remember = (position: number, frame: Frame) => {
    frames.current.set(position, frame)
    if (position !== open) return
    // Read at the moment it is needed rather than tracked: one reader, once, and no
    // second copy of the offset to fall behind the first.
    const to = revealOffset(frame, { offset: scrolled.get(), height: viewport.current })
    if (to !== undefined) scroller.current?.scrollTo({ y: to, animated: true })
  }

  const sheetTitle = () => {
    if (sheet?.kind === 'leaving') return '¿Guardas esta rutina?'
    if (sheet?.kind === 'discarding') return '¿Descartar cambios?'
    if (sheet?.kind === 'set-kind') return 'Tipo de serie'
    if (sheet?.kind === 'rest') return 'Descanso entre series'
    if (sheet?.kind === 'superset') return 'Superserie'
    if (sheet?.kind === 'menu') return 'Ejercicio'
    if (sheet?.kind === 'cover') return 'Portada de la rutina'
    return ''
  }

  /**
   * The X, and the two screens this one is.
   *
   * **Writing.** A new routine has nowhere to live but its draft, which is being
   * written as somebody types, so leaving has to ask what to do with it.
   *
   * **Editing.** A published routine is already somewhere, and this visit is a set of
   * changes that have not been applied. Untouched, the X is just a way out and asking
   * anything would be noise. Touched, it asks once — and «descartar» here throws the
   * changes away, never the routine.
   */
  const leave = () => {
    if (!templateId) return router.back()
    if (!editing) return setSheet({ kind: 'leaving' })
    if (saved) return router.back()
    setSheet({ kind: 'discarding' })
  }

  const subtitle = () => {
    if (saving) return 'Guardando…'
    if (failure) return 'Sin guardar'
    // «Borrador guardado» would be a lie on a routine that is already out there and is
    // deliberately not being written to until the tick.
    if (editing) return saved ? 'Publicada' : 'Con cambios sin guardar'
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
          onClose={leave}
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
          {/* The cover sits beside the name because the two are the same question
              asked twice: what is this routine, and how will I know it again. */}
          <View style={styles.naming}>
            <CoverTile
              size="md"
              onPress={() => setSheet({ kind: 'cover' })}
              accessibilityLabel={cover === undefined ? 'Elegir portada' : 'Cambiar portada'}
              hint={
                <View style={styles.coverHint}>
                  <FoundationIcon name="camera" size="sm" color={theme.color.icon.secondary} />
                  <Text role="eyebrow" size="2xs" color="muted">
                    PORTADA
                  </Text>
                </View>
              }
            >
              {coverArt({
                cover: cover,
                worked: worked,
                muscles: library?.muscles ?? [],
                side: COVER_MD,
                token: token,
              })}
            </CoverTile>

            <View style={styles.namingField}>
              <TextField
                label="Ponle un nombre"
                placeholder="Empuje, Pierna, Día 1…"
                value={title}
                onChangeText={rename}
                autoCapitalize="sentences"
              />
            </View>
          </View>
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
      <Animated.ScrollView
        ref={scroller}
        style={styles.scroller}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        onLayout={(event) => {
          viewport.current = event.nativeEvent.layout.height
        }}
        onContentSizeChange={(_width, height) => content.set(height)}
        scrollEventThrottle={16}
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
              {editing
                ? 'Los cambios se aplican al guardar. Necesita conexión.'
                : 'Se guarda como borrador según escribes. Necesita conexión.'}
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
              finger={fingerY}
              onLift={() => {
                setOpen(undefined)
                setDragging(true)
                // From where the list stands now, or the first frame would count every
                // point it had been scrolled before the drag as travel.
                chased.set(scrolled.get())
                chase.setActive(true)
              }}
              onDrop={(to) => settle(step.position, to)}
              onFrame={(frame) => remember(step.position, frame)}
              style={[
                styles.row,
                {
                  borderColor:
                    open === step.position ? theme.color.border.accent : theme.color.border.subtle,
                },
                // The indicator that needs no reading: both members of a chain are
                // struck down its leading edge in that chain's own colour, so two
                // supersets one after the other are visibly two.
                chainMark(step.supersetGroup) === undefined
                  ? null
                  : {
                      borderLeftWidth: 3,
                      borderLeftColor: chainMark(step.supersetGroup)?.color,
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
                {/* Still, not playing: a routine is a list to read, and six looping
                    clips at once cost more than the recognition they buy. One frame
                    is enough to tell a press from a fly. */}
                <Image
                  // `null` and not `undefined`: `exactOptionalPropertyTypes` refuses a
                  // key that is present and absent at once, and the image reads both
                  // as «nothing to show».
                  source={previews.get(step.movementId) ?? null}
                  style={[
                    styles.preview,
                    { backgroundColor: theme.color.background.surfaceSubtle },
                  ]}
                  contentFit="contain"
                  autoplay={false}
                  recyclingKey={step.movementId}
                  accessible={false}
                />
                <View style={styles.rowText}>
                  <Text role="control" size="md" numberOfLines={1}>
                    {step.name}
                  </Text>
                  <Text role="body" size="sm" color="accent">
                    {`${setsLabel(step.sets)} · ${restLabel(step.restSeconds)}`}
                  </Text>
                  {chainMark(step.supersetGroup) === undefined ? null : (
                    <Badge
                      label={`Superserie ${chainMark(step.supersetGroup)?.letter ?? ''}`}
                      tone={chainMark(step.supersetGroup)?.tone ?? 'accent'}
                    />
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
      </Animated.ScrollView>

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

      {/* One sheet, not five. `Sheeted` is a union — only one can ever be up — and a
          `Sheet` is a real `Modal` that stays mounted through its own exit animation.
          Five of them meant that moving from the exercise menu to the superset list
          presented a modal while another was still dismissing, which iOS refuses: the
          new sheet never appeared and the old one's invisible layer kept eating every
          touch. Everything froze, and nothing was on screen to say why. */}
      <Sheet
        visible={sheet !== undefined}
        onDismiss={() => setSheet(undefined)}
        title={sheetTitle()}
      >
        {sheet?.kind === 'cover' ? (
          <View style={styles.sheet}>
            <Text role="body" size="sm" color="muted">
              {`Elige cómo se ve «${title.trim() === '' ? 'esta rutina' : title.trim()}» en tu lista.`}
            </Text>

            <SegmentedControl
              items={[
                { value: 'muscles', label: 'Músculos' },
                { value: 'icon', label: 'Icono' },
                { value: 'photo', label: 'Foto' },
              ]}
              value={coverTab}
              onChange={setCoverTab}
              accessibilityLabel="Tipo de portada"
            />

            {coverTab === 'photo' ? (
              <View style={[styles.coverPanel, styles.coverFigure]}>
                <CoverTile
                  size="md"
                  selected={cover?.kind === 'photo'}
                  onPress={pickable ? () => void takePhoto() : undefined}
                  accessibilityLabel={
                    cover?.kind === 'photo' ? 'Cambiar la foto' : 'Elegir una foto'
                  }
                  hint={
                    <FoundationIcon
                      name="camera"
                      size="md"
                      color={theme.color.icon.secondary}
                      decorative
                    />
                  }
                >
                  {cover?.kind === 'photo'
                    ? coverArt({
                        cover: cover,
                        worked: worked,
                        muscles: library?.muscles ?? [],
                        side: COVER_MD,
                        token: token,
                      })
                    : null}
                </CoverTile>
                <Text role="body" size="xs" color="muted" align="center">
                  {!pickable
                    ? // An older build without the picker in it. Said plainly rather
                      // than left to fail on the press, which is how it used to read.
                      'Esta versión de la app todavía no puede abrir tus fotos. Actualízala.'
                    : templateId === undefined
                      ? // Nothing to attach it to yet: a photograph is stored against a
                        // routine, and the routine exists once it has a name.
                        'Ponle un nombre a la rutina y después elige la foto.'
                      : uploading
                        ? 'Subiendo la foto…'
                        : 'Se recorta cuadrada y se guarda sin los datos de dónde la tomaste.'}
                </Text>
              </View>
            ) : coverTab === 'muscles' ? (
              <View style={[styles.coverPanel, styles.coverFigure]}>
                <CoverTile
                  size="md"
                  selected={sameCover(cover, MUSCLE_COVER)}
                  onPress={() => chooseCover(MUSCLE_COVER)}
                  accessibilityLabel="Los músculos que entrena"
                >
                  {coverArt({
                    cover: MUSCLE_COVER,
                    worked: worked,
                    muscles: library?.muscles ?? [],
                    side: COVER_MD,
                    token: token,
                  })}
                </CoverTile>
                <Text role="body" size="xs" color="muted" align="center">
                  {worked.length === 0
                    ? 'Añade ejercicios y aquí se dibuja lo que trabajan.'
                    : 'Se dibuja sola con los ejercicios que tenga.'}
                </Text>
              </View>
            ) : (
              <ScrollView
                style={styles.coverPanel}
                contentContainerStyle={styles.coverGrid}
                showsVerticalScrollIndicator={false}
              >
                {COVER_ICONS.map((one) => (
                  <CoverTile
                    key={one.icon}
                    size="md"
                    selected={sameCover(cover, iconCover(one.icon))}
                    onPress={() => chooseCover(iconCover(one.icon))}
                    // The glyph carries no words, so the name has to be said here or
                    // the grid is twelve unlabelled squares to a screen reader.
                    accessibilityLabel={one.name}
                  >
                    {coverArt({
                      cover: iconCover(one.icon),
                      worked: worked,
                      muscles: library?.muscles ?? [],
                      side: COVER_MD,
                      token: token,
                    })}
                  </CoverTile>
                ))}
              </ScrollView>
            )}

            {cover === undefined ? null : (
              <Button
                label="Quitar portada"
                variant="ghost"
                icon="remove"
                onPress={() => chooseCover(undefined)}
              />
            )}
          </View>
        ) : null}

        {sheet?.kind === 'discarding' ? (
          <View style={styles.sheet}>
            <Text role="body" size="md" color="muted">
              Lo que cambiaste aquí no se ha aplicado todavía. Si lo descartas, la rutina se queda
              como estaba.
            </Text>
            <Button
              label="Descartar cambios"
              variant="ghost"
              icon="remove"
              onPress={() => {
                setSheet(undefined)
                router.back()
              }}
            />
            <Button
              label="Seguir editando"
              variant="secondary"
              onPress={() => setSheet(undefined)}
            />
          </View>
        ) : null}

        {sheet?.kind === 'leaving' ? (
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
        ) : null}

        {sheet?.kind === 'set-kind' ? (
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
                      step.sets.map((each, at) =>
                        at === sheet.order ? withKind(each, kind) : each,
                      ),
                    ),
                  )
                  setSheet(undefined)
                }}
              />
            ))}
          </View>
        ) : null}

        {sheet?.kind === 'rest' ? (
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
        ) : null}

        {sheet?.kind === 'superset' ? (
          <View style={styles.sheet}>
            <Text role="body" size="sm" color="muted">
              Se hacen seguidos, sin descanso entre medias. El que elijas queda al lado de este.
            </Text>
            {others(steps, sheet).map((mate) => (
              <SheetChoice
                key={mate.position}
                name={mate.name}
                // The same rule its row wears, so «already in a superset, and in that
                // one» is read rather than explained.
                {...(chainMark(mate.supersetGroup) === undefined
                  ? {}
                  : { edge: chainMark(mate.supersetGroup)?.color })}
                onPress={() => {
                  if (sheet?.kind !== 'superset') return
                  change(chainedWith(steps, sheet.position, mate.position))
                  setSheet(undefined)
                }}
              />
            ))}
          </View>
        ) : null}

        {sheet?.kind === 'menu' ? (
          <View style={styles.sheet}>
            <SheetChoice
              name="Reemplazar ejercicio"
              detail="Buscar otro y conservar las series"
              onPress={() => {
                if (sheet?.kind !== 'menu') return
                // Everything but the one being swapped, so the picker does not offer
                // back an exercise the routine already trains.
                declareAlreadyIn(
                  steps
                    .filter((one) => one.position !== sheet.position)
                    .map((one) => one.movementId),
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
                  change(unchained(steps, sheet.position))
                  setSheet(undefined)
                }}
              />
            ) : (
              <SheetChoice
                name="Hacer superserie"
                detail={
                  steps.length < 2
                    ? 'Necesitas otro ejercicio en la rutina'
                    : 'Encadenarlo con otro ejercicio'
                }
                // Nothing to chain with. Offered and then refused is worse than offered
                // as unavailable, because the second says why without being pressed.
                disabled={steps.length < 2}
                onPress={() => {
                  if (sheet?.kind !== 'menu') return
                  setSheet({ kind: 'superset', position: sheet.position })
                }}
              />
            )}
          </View>
        ) : null}
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
  disabled,
  edge,
  onPress,
}: {
  readonly name: string
  /** Absent leaves the name alone, for a list where the name is the whole answer. */
  readonly detail?: string
  readonly shape?: string
  /** Draws the name as its badge instead of as a word, for a choice that has one. */
  readonly tone?: BadgeTone
  readonly selected?: boolean
  readonly disabled?: boolean
  /** A rule down the leading edge, for a choice that already belongs to something. */
  readonly edge?: string | undefined
  readonly onPress: () => void
}) {
  const theme = useTheme()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      {...(detail === undefined ? {} : { accessibilityHint: detail })}
      accessibilityState={{ selected: selected ?? false, disabled: disabled ?? false }}
      disabled={disabled ?? false}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        {
          borderColor: selected ? theme.color.border.accent : theme.color.border.subtle,
          backgroundColor: theme.color.background.surface,
          opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
        },
        edge === undefined ? null : { borderLeftWidth: 3, borderLeftColor: edge },
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
        {detail === undefined ? null : (
          <Text role="body" size="sm" color="muted">
            {detail}
          </Text>
        )}
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
/** Everything the superset sheet can offer: the whole routine but this exercise. */
function others(steps: readonly WorkingStep[], sheet: Sheeted | undefined) {
  if (sheet?.kind !== 'superset') return []
  return steps.filter((step) => step.position !== sheet.position)
}

/** Who the chain's other end is, for the line that says so. */

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
  finger,
  onLift,
  onDrop,
  onFrame,
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
  /** Where the finger is on screen, which is what the edges are measured against. */
  readonly finger: SharedValue<number>
  readonly onLift: () => void
  readonly onDrop: (to: number) => void
  /** Where it sits in the list, so whatever opens can be scrolled into view. */
  readonly onFrame: (frame: Frame) => void
  readonly style: StyleProp<ViewStyle>
  readonly children: ReactNode
}) {
  const position = step.position

  const drag = Gesture.Pan()
    // Shut only. Open, the row holds a table of number fields, and a long press on one
    // of them would lift the whole exercise instead of putting a caret in it.
    .enabled(!open)
    .activateAfterLongPress(250)
    .onStart((event) => {
      from.set(position)
      travel.set(0)
      finger.set(event.absoluteY)
      // The frame loop is started from `onLift`, on the other side of `scheduleOnRN`.
      // `setActive` closes over the registry and a React ref, both of which exist only
      // on the RN runtime; called from here it writes to a copy, and the UI side then
      // times a callback it has no record of.
      scheduleOnRN(onLift)
    })
    // `onChange` rather than `onUpdate`: what is added is the movement since the last
    // frame. The frame loop puts what the list scrolled into the same number, and
    // assigning the whole translation would throw that away sixty times a second —
    // the row would sit still while the list ran underneath it.
    .onChange((event) => {
      finger.set(event.absoluteY)
      travel.set(travel.get() + event.changeY)
    })
    .onEnd((_event, success) => {
      const landed = success ? placeOf(position, travel.get(), count) : position
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
        // Fires again when the exercise opens, which is the measurement that matters:
        // the shut height says nothing about what has to be brought into view.
        onLayout={(event) =>
          onFrame({ y: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height })
        }
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
 *
 * **The number is announced and not drawn.** «01» spent a column saying what the row's
 * own place in the list already says, and the room it took came out of the name. What
 * it was genuinely for — telling a screen reader where the exercise sits — is what
 * `accessibilityValue` does, and it says it better: «3 de 6» rather than «cero tres».
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
  // The tile and the field share a line, and the field takes whatever is left: the
  // cover is a fixed square and the name is as wide as the screen allows.
  naming: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  namingField: { flex: 1 },
  coverHint: { alignItems: 'center', gap: 4 },
  coverPanel: { height: COVER_PANEL },
  coverGrid: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', justifyContent: 'center' },
  // Centred in the panel rather than sitting at its top: one tile floating against the
  // ceiling of a space three rows tall reads as something missing underneath.
  coverFigure: { alignItems: 'center', justifyContent: 'center', gap: 10 },
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
  handle: { alignItems: 'center', justifyContent: 'center' },
  // Smaller than the picker's sixty: there the picture is what somebody is choosing
  // from, and here it only has to confirm what they already chose.
  preview: { width: 44, height: 44, borderRadius: 10 },
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
