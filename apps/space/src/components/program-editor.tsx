/**
 * `PR-1`, `PR-3` and `PR-4` — the base week, and what goes on a day.
 *
 * **The week is the unit and the day is a suggestion**, which is the decision the whole
 * planning slice turned on. So a programme is authored as *one week* plus how many
 * times it repeats, not as a calendar somebody fills in week by week. `PR-1` draws
 * exactly that, and `expandBaseWeek` is what turns it into the sessions a version
 * stores.
 *
 * A programme is composed of **published** routines only. A draft has no version to
 * point at, so `PR-4`'s empty state is not "you have no routines" but "none of yours
 * is publishable yet" — the footnote says which.
 *
 * The notice at the bottom is the promise `PR-1` makes in its own words: editing this
 * does not touch anybody who already started it. That is not a hope about the code —
 * `self_assign_program` forks the version, so a later version is a different object.
 */

import { Button } from '@allfitone/react-native/button'
import { IconButton } from '@allfitone/react-native/icon-button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Sheet } from '@allfitone/react-native/sheet'
import { Text } from '@allfitone/react-native/text'
import { TextField } from '@allfitone/react-native/text-field'
import { Monogram } from '@allfitone/react-native/monogram'
import { useTheme } from '@allfitone/react-native/theme'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { ApiError } from '../../src/client'
import { createSpaceContentFlow } from '../client/content-transport'
import { forgetPublishedRoutine, takePublishedRoutine } from '../client/routine-handoff'
import { createQueue } from '../client/queue'
import { saveFailure } from '../client/save-failure'
import { deviceTimezone } from '../client/timezone'
import {
  collapseBaseWeek,
  expandBaseWeek,
  programLoad,
  summarizeBaseWeek,
  weeksLabel,
  type BaseWeekDay,
  type MyRoutine,
} from '../client/content'
import { ScreenHeader } from './screen-header'

/** Monday first, because the week the plan lands on is the calendar week. */
const DAYS = [
  { day: 1, letter: 'L', name: 'lunes' },
  { day: 2, letter: 'M', name: 'martes' },
  { day: 3, letter: 'X', name: 'miércoles' },
  { day: 4, letter: 'J', name: 'jueves' },
  { day: 5, letter: 'V', name: 'viernes' },
  { day: 6, letter: 'S', name: 'sábado' },
  { day: 7, letter: 'D', name: 'domingo' },
] as const

/** Keeps the button off the very bottom edge, the same amount as every other footer. */
const FOOTER_LIFT = 16

const DEFAULT_WEEKS = 8
const MIN_WEEKS = 1
const MAX_WEEKS = 52
const SAVE_DELAY_MS = 700

const EXPIRED = 'Tu sesión venció. Vuelve a entrar para continuar.'
const READ_FAILED = 'No pudimos cargar tus rutinas. Inténtalo otra vez.'
const OPEN_FAILED = 'No pudimos abrir este programa. Inténtalo otra vez.'
const NOT_MINE = 'Este programa no se puede editar aquí.'
// What a programme is, rather than what publishing does to other people: nobody else
// can take a personal programme, so that warning explained a rule that never applied.
// It names Entrenar because that is a tab somebody can open. "Tu agenda" is the
// domain's word and "el calendario" is a screen this app does not have.
/** Days are stored in lower case, because a sentence needs them that way. */
function named(day: string): string {
  return day === '' ? '' : `${day[0]?.toUpperCase() ?? ''}${day.slice(1)}`
}

const WHAT_A_PROGRAM_IS =
  'Un programa es tu semana de entrenamiento, repetida. Eliges qué rutina toca cada día y cuántas semanas dura; al publicarlo, esas rutinas te aparecen en Entrenar, semana a semana.'

/**
 * The base-week editor, for a programme being written and for one being reopened.
 *
 * One component and not two: the screens would be the same screen with a different
 * first render, and the second copy is where they drift. Given a `programId` it opens
 * what is there; given none it starts empty and creates on the first save.
 */
export function ProgramEditor({ programId }: { readonly programId?: string }) {
  const router = useRouter()
  const theme = useTheme()
  const flow = useMemo(() => createSpaceContentFlow(), [])
  const saves = useMemo(() => createQueue(), [])

  const [title, setTitle] = useState('')
  const [weeks, setWeeks] = useState(DEFAULT_WEEKS)
  // Carried but not drawn: it is not editable here, and hard-coding null on save
  // erased it on the way through and produced a version that changed only that.
  const [notes, setNotes] = useState<string | null>(null)
  // False once opening has failed: this is not a blank programme, it is one that
  // could not be read, and saving would create something nobody asked for.
  const [openable, setOpenable] = useState(true)
  const [week, setWeek] = useState<readonly BaseWeekDay[]>(
    DAYS.map((day) => ({ day: day.day, templateVersionId: null })),
  )
  const [routines, setRoutines] = useState<readonly MyRoutine[] | undefined>(undefined)
  const [choosing, setChoosing] = useState<number | undefined>(undefined)
  const [discarding, setDiscarding] = useState(false)
  const [leaving, setLeaving] = useState(false)

  /**
   * Whether this programme already exists as a published version.
   *
   * `/programs/new` writes one and `/programs/edit/[programId]` edits one, and the
   * list that route is reached from only carries programmes that have a version — so
   * the prop is the answer and nothing has to be asked for to know it.
   *
   * It changes what the screen is, the same way it does for a routine: writing saves
   * as it goes, editing holds the changes until the tick and lets the X throw them
   * away.
   */
  const editing = programId !== undefined
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const identity = useRef<string | undefined>(programId)

  // Read through refs so the deferred assignment does not depend on them: naming a
  // programme is typing, and a dependency on the name would re-read the routines on
  // every keystroke.
  const titled = useRef(title)
  const repeated = useRef(weeks)
  useEffect(() => {
    titled.current = title
    repeated.current = weeks
  }, [title, weeks])

  /**
   * Opening one that already exists.
   *
   * The etag comes back with it and the flow keeps it, because the first save after
   * opening is refused without one — and that refusal would land long after somebody
   * had typed the change they are about to lose.
   *
   * Only week one is read: the rest are its repeats. A programme whose weeks differ
   * cannot be said as a base week, and the list does not offer to open those.
   */
  useEffect(() => {
    let active = true

    const resume = async () => {
      // Either the programme named in the route, or the one somebody left unpublished.
      // «Programa nuevo» used to mean «start empty», which is what made every saved
      // draft unreachable: it existed, it counted, and nothing could open it.
      const id = programId ?? (await flow.readMyUnpublishedProgram())?.id
      if (!active || !id) return
      identity.current = id
      const draft = await flow.openProgram(id)
      if (!active) return
      return draft
    }

    resume()
      .then((draft) => {
        if (!active || !draft) return
        const { baseWeek, weeks: repeats } = collapseBaseWeek(draft.content.sessions)
        setTitle(draft.content.title)
        setNotes(draft.content.notes ?? null)
        setWeek(baseWeek)
        setWeeks(repeats)
        setSaved(true)
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof ApiError && cause.failure === 'unauthenticated') {
          setFailure(EXPIRED)
          return
        }
        // Not found means it is somebody else's, or one taken from Allfit and never
        // given a draft. Staying open would be a create screen wearing an edit
        // screen's URL, and typing into it would quietly make a second programme.
        setOpenable(false)
        setFailure(
          cause instanceof ApiError && cause.failure === 'not-found' ? NOT_MINE : OPEN_FAILED,
        )
      })

    return () => {
      active = false
    }
  }, [flow, programId])

  /**
   * Saves, and says whether it did. It reports a failure through `failure` as well,
   * because the autosave has nobody waiting on it — but publishing does, and a caller
   * that cannot tell a save from a silent failure will navigate away from the message.
   */
  const persist = useCallback(
    async (
      nextTitle: string,
      nextWeek: readonly BaseWeekDay[],
      nextWeeks: number,
    ): Promise<boolean> => {
      const trimmed = nextTitle.trim()
      if (trimmed === '' || !openable) return false

      // Queued, never raced. A save answers with the etag the next one has to send, so
      // two in flight means the second carries an etag the first is replacing — which
      // is exactly what pressing «guardar» inside the autosave's delay used to do.
      return saves(async () => {
        setSaving(true)
        try {
          if (!identity.current) {
            const program = await flow.createProgram(trimmed)
            identity.current = program.id
          }
          await flow.saveProgramDraft(identity.current, {
            title: trimmed,
            notes,
            sessions: expandBaseWeek(nextWeek, nextWeeks),
          })
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
    [flow, notes, openable, saves],
  )

  /**
   * The autosave, and it belongs to writing rather than to editing.
   *
   * A programme being written has nowhere else to live, so it goes to its draft as it
   * is built. One that is already published has somewhere else to live — the version
   * people are training from — and half an edit written into its draft as it is typed
   * means leaving the screen leaves the edit behind, which is not what cancel means.
   */
  const schedule = useCallback(
    (nextTitle: string, nextWeek: readonly BaseWeekDay[], nextWeeks: number) => {
      if (editing) return
      if (pending.current) clearTimeout(pending.current)
      pending.current = setTimeout(
        () => void persist(nextTitle, nextWeek, nextWeeks),
        SAVE_DELAY_MS,
      )
    },
    [persist, editing],
  )

  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current)
    },
    [],
  )

  // The day somebody left this screen to write a routine for. Held in a ref because
  // nothing renders from it.
  const awaiting = useRef<number | undefined>(undefined)

  /**
   * Puts a newly written routine on the day it was written for.
   *
   * The routine is the one the editor handed back, not one deduced from a list. The
   * deduction was the defect: two routines published in one trip, or an existing one
   * republished — which mints a new version and so looks new — and it either guessed
   * wrong or gave up silently.
   *
   * Taken whether or not a day is waiting, so a routine written from somewhere else
   * never sits in the mailbox waiting to land on an unrelated Monday.
   */
  const fill = useCallback(() => {
    const day = awaiting.current
    awaiting.current = undefined
    const written = takePublishedRoutine()
    if (day === undefined || !written) return

    setWeek((current) => {
      // Not over something already there: the trip took time, and a day filled in the
      // meantime was filled on purpose.
      if (current.find((one) => one.day === day)?.templateVersionId) return current
      const next = current.map((one) =>
        one.day === day ? { ...one, templateVersionId: written.versionId } : one,
      )
      setSaved(false)
      schedule(titled.current, next, repeated.current)
      return next
    })
    // `schedule` and not nothing: it is rebuilt when the programme finishes opening,
    // and the copy captured at mount would still be the one that refuses to save.
  }, [schedule])

  /**
   * The routines this programme can be built from, re-read every time the screen is
   * looked at again.
   *
   * **On focus and not on mount, which is the defect this replaces.** The screen stays
   * on the stack while the routine editor is pushed over it, so the list was read once
   * and never again: somebody who left to make a routine came back to a programme that
   * had never heard of it. Mounting happens once; returning happens every time.
   *
   * And a routine made *for* a day goes onto that day. Leaving to write one was not a
   * detour — it was the answer to «qué toca el lunes», and coming back to pick it out
   * of a list again is a step that exists only because the app forgot the question.
   */
  useFocusEffect(
    useCallback(() => {
      let active = true

      flow
        .readMyRoutines()
        .then((found) => {
          if (!active) return
          setRoutines(found)
          fill()
        })
        .catch((cause: unknown) => {
          if (!active) return
          setFailure(
            cause instanceof ApiError && cause.failure === 'unauthenticated'
              ? EXPIRED
              : READ_FAILED,
          )
        })

      return () => {
        active = false
      }
    }, [flow, fill]),
  )

  const published = (routines ?? []).filter((routine) => routine.template_version_id !== null)
  const summary = summarizeBaseWeek(week, weeks)
  const publishable = openable && title.trim() !== '' && summary.daysPerWeek > 0

  const routineOn = (day: number) => {
    const filled = week.find((one) => one.day === day)
    if (!filled?.templateVersionId) return undefined
    return published.find((one) => one.template_version_id === filled.templateVersionId)
  }

  /**
   * Off to write a routine, remembering what it is for.
   *
   * Only the day. Which routine was written is the editor's to say, and it says it
   * when it publishes.
   */
  const leaveToWrite = (day: number | undefined) => {
    awaiting.current = day
    // Nothing left over from an earlier trip: the mailbox is emptied on the way out as
    // well as on the way in, so what lands on this day is what was written for it.
    forgetPublishedRoutine()
    setChoosing(undefined)
    router.push('/routines/new')
  }

  const put = (day: number, templateVersionId: string | null) => {
    const next = week.map((one) => (one.day === day ? { ...one, templateVersionId } : one))
    setWeek(next)
    setSaved(false)
    setChoosing(undefined)
    schedule(title, next, weeks)
  }

  const rename = (next: string) => {
    setTitle(next)
    setSaved(false)
    schedule(next, week, weeks)
  }

  const repeat = (next: number) => {
    setWeeks(next)
    setSaved(false)
    schedule(title, week, next)
  }

  const publish = async () => {
    if (!publishable) return
    if (pending.current) clearTimeout(pending.current)
    try {
      // Stay put when the draft did not land. Leaving took the failure message with it,
      // so a save that never happened looked exactly like one that did.
      const stored = await persist(title, week, weeks)
      if (!stored || !identity.current) return
      // Publishing leaves this programme followed, and the server decides how: the
      // agenda already on it moves onto the new version, or it is taken from today.
      // Taking it from here as well is what left an edit with two assignments, the
      // empty one in front, and both tabs reading a progress that never moved.
      await flow.publishProgram(identity.current, deviceTimezone())
      // To Hoy, which is where every other act in the app lands and — the reason this
      // read as a jolt — the tab already selected underneath. Going to Entrenar changed
      // the screen *and* the tab in one frame, and a tab change does not animate by
      // design, so half the motion was missing and the other half looked broken.
      router.replace('/today')
    } catch (cause: unknown) {
      setFailure(saveFailure(cause))
    }
  }

  /**
   * The X, and the two screens this one is.
   *
   * Writing, the draft is already on the server and leaving keeps it — there is
   * nothing to decide. Editing, the visit is a set of changes nobody has applied:
   * untouched it is just a way out, touched it asks once.
   */
  const leave = () => {
    if (editing) return saved ? router.back() : setDiscarding(true)
    // Writing: the draft is already on the server, so the question is whether to keep
    // it. Unnamed there is nothing to keep — nothing was ever created.
    if (identity.current === undefined) return router.back()
    setLeaving(true)
  }

  const throwAway = async () => {
    setLeaving(false)
    if (!identity.current) return router.back()
    try {
      await flow.discardProgram(identity.current)
      router.back()
    } catch (cause: unknown) {
      setFailure(saveFailure(cause))
    }
  }

  const subtitle = () => {
    if (saving) return 'Guardando…'
    if (failure) return 'Sin guardar'
    // «Borrador» would be a lie on a programme that is published and deliberately
    // not being written to until the tick.
    if (editing) return saved ? 'Publicado' : 'Con cambios sin guardar'
    if (saved) return 'Programa propio · borrador'
    return 'Aún sin guardar'
  }

  // How many weeks a routine is used counts once per week, because the base week is
  // what repeats: saying "8×" would be counting the repetition twice.
  /** The days a routine falls on, named: «Lunes · Viernes». */
  const daysOf = (templateVersionId: string) =>
    week
      .filter((one) => one.templateVersionId === templateVersionId)
      .map((one) => named(DAYS.find((day) => day.day === one.day)?.name ?? ''))
      .join(' · ')

  const included = published.filter((routine) =>
    week.some((one) => one.templateVersionId === routine.template_version_id),
  )

  const chosenDay = DAYS.find((one) => one.day === choosing)

  return (
    <Screen edges={['top', 'bottom']}>
      {/* The keyboard moves the scroll inset rather than resizing the container, the
          same as every other screen here that takes typing. */}
      {/* The frame stays put: whose programme this is, what it is called and how much
          of it there is. A frame that scrolls away leaves somebody editing a week with
          no idea what they are editing. */}
      <View style={styles.frame}>
        <ScreenHeader
          title={title.trim() === '' ? 'Programa nuevo' : title}
          subtitle={subtitle()}
          onClose={leave}
        />

        {failure ? <InlineAlert message={failure} /> : null}

        <TextField
          label="Ponle un nombre"
          placeholder="Fuerza inicial, Mi plan…"
          value={title}
          onChangeText={rename}
          autoCapitalize="sentences"
        />

        {/* What the programme amounts to, as one sentence rather than three figures in
            a case. The numbers are a consequence of the week below, not a control, and
            a case of them read as something to act on. */}
        <Text role="body" size="sm" color="secondary">
          {programLoad(weeks, summary)}
        </Text>
      </View>

      <ScrollView
        style={styles.scroller}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.duration,
            {
              borderColor: theme.color.border.subtle,
              backgroundColor: theme.color.background.surface,
            },
          ]}
        >
          <FoundationIcon name="frequency" size="sm" color={theme.color.icon.accent} decorative />
          <View style={styles.rowText}>
            <Text role="body" size="xs" color="muted">
              Duración del programa
            </Text>
            <Text role="control" size="md">
              {weeksLabel(weeks)}
            </Text>
          </View>
          {/* Two buttons and no third number. A `Stepper` carries its own value, and
              the card has already said «8 semanas» right there — the same figure twice
              in one row is a row somebody has to read twice to be sure. */}
          <View style={styles.tune}>
            <IconButton
              icon="subtract"
              size="sm"
              accessibilityLabel={`Quitar una semana. Ahora ${weeksLabel(weeks)}`}
              disabled={weeks <= MIN_WEEKS}
              onPress={() => repeat(weeks - 1)}
            />
            <IconButton
              icon="add"
              size="sm"
              accessibilityLabel={`Añadir una semana. Ahora ${weeksLabel(weeks)}`}
              disabled={weeks >= MAX_WEEKS}
              onPress={() => repeat(weeks + 1)}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text role="control" size="sm" color="secondary">
            La semana base
          </Text>
          <Text role="body" size="sm" color="muted">
            {`Se repite igual las ${weeksLabel(weeks)}. Los días libres son descanso.`}
          </Text>

          <View style={styles.days}>
            {DAYS.map((day) => {
              const routine = routineOn(day.day)
              const filled = routine !== undefined
              return (
                <Pressable
                  key={day.day}
                  accessibilityRole="button"
                  accessibilityLabel={
                    filled
                      ? `${day.name}: ${routine.title}. Cambiar`
                      : `${day.name}: libre. Poner una rutina`
                  }
                  onPress={() => setChoosing(day.day)}
                  style={({ pressed }) => [
                    styles.dayCell,
                    {
                      backgroundColor: filled
                        ? theme.color.accent.tonal
                        : theme.color.background.surface,
                      borderColor: filled ? theme.color.border.accent : theme.color.border.subtle,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Text role="label" size="2xs" color={filled ? 'accent' : 'muted'}>
                    {day.letter}
                  </Text>
                  {filled ? (
                    <Monogram name={routine.title} size="sm" />
                  ) : (
                    <View style={styles.dayFree}>
                      <FoundationIcon
                        name="add"
                        size="sm"
                        color={theme.color.icon.secondary}
                        decorative
                      />
                    </View>
                  )}
                  {/* One word, and it is allowed to be cut: the mark above carries the
                      recognition, and seven names at a seventh of the width never fit. */}
                  <Text
                    role="body"
                    size="2xs"
                    color={filled ? 'primary' : 'muted'}
                    align="center"
                    numberOfLines={1}
                  >
                    {filled ? routine.title : 'Libre'}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text role="control" size="sm" color="secondary">
              Rutinas que incluye
            </Text>
            {included.length === 0 ? null : (
              <Text role="control" size="sm" color="accent">
                {String(included.length)}
              </Text>
            )}
          </View>
          {included.length === 0 ? (
            <Text role="body" size="sm" color="muted">
              Todavía no hay ninguna rutina en la semana.
            </Text>
          ) : (
            included.map((routine) => (
              <Pressable
                key={routine.template_id}
                accessibilityRole="button"
                accessibilityLabel={`Abrir ${routine.title}`}
                accessibilityHint={daysOf(routine.template_version_id ?? '')}
                onPress={() => router.push(`/routines/${routine.template_id}`)}
                style={({ pressed }) => [
                  styles.included,
                  {
                    borderColor: theme.color.border.subtle,
                    backgroundColor: theme.color.background.surface,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Monogram name={routine.title} />
                <View style={styles.rowText}>
                  <Text role="control" size="sm" numberOfLines={1}>
                    {routine.title}
                  </Text>
                  {/* Which days, not how many times: «Lunes · Viernes» is the answer to
                      what somebody is looking at the list for, and «2×/sem» is not. */}
                  <Text role="body" size="xs" color="muted" numberOfLines={1}>
                    {daysOf(routine.template_version_id ?? '')}
                  </Text>
                </View>
                <FoundationIcon
                  name="next"
                  size="sm"
                  color={theme.color.icon.secondary}
                  decorative
                />
              </Pressable>
            ))
          )}
        </View>

        {/* Only while the week is empty. It answers «what is this screen» and stops
            answering it the moment somebody has plainly worked it out. */}
        {summary.daysPerWeek > 0 ? null : (
          <View style={[styles.notice, { backgroundColor: theme.color.background.surfaceSubtle }]}>
            <FoundationIcon name="info" size="sm" color={theme.color.icon.secondary} decorative />
            <Text role="body" size="sm" color="secondary" style={styles.noticeText}>
              {WHAT_A_PROGRAM_IS}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Anchored, and it says what it does. The tick in the header is the same act,
          but «Listo» on a screen that has been saving a draft all along says nothing
          about the one press that turns it into weeks of training. */}
      <View style={styles.anchor}>
        <Button label="Guardar programa" icon="check" disabled={!publishable} onPress={publish} />
      </View>

      {/* One sheet, not two. A `Sheet` is a real `Modal` that stays mounted through its
          own exit animation, so two of them on one screen present while the other is
          still dismissing — which iOS refuses, leaving nothing on screen and an
          invisible layer eating every touch. */}
      <Sheet
        visible={choosing !== undefined || discarding || leaving}
        onDismiss={() => {
          setChoosing(undefined)
          setDiscarding(false)
          setLeaving(false)
        }}
        title={
          discarding
            ? '¿Descartar cambios?'
            : leaving
              ? '¿Guardas este programa?'
              : chosenDay
                ? `Qué toca el ${chosenDay.name}`
                : 'Qué toca ese día'
        }
      >
        {leaving ? (
          <View style={styles.sheetBody}>
            <Text role="body" size="md" color="muted">
              Se está guardando como borrador según lo armas. Puedes dejarlo para después o tirarlo.
            </Text>
            <Button
              label="Guardar borrador"
              onPress={() => {
                setLeaving(false)
                router.back()
              }}
            />
            <Button
              label="Descartar programa"
              variant="ghost"
              icon="remove"
              onPress={() => void throwAway()}
            />
          </View>
        ) : discarding ? (
          <View style={styles.sheetBody}>
            <Text role="body" size="md" color="muted">
              Lo que cambiaste aquí no se ha aplicado todavía. Si lo descartas, el programa se queda
              como estaba.
            </Text>
            <Button
              label="Descartar cambios"
              variant="ghost"
              icon="remove"
              onPress={() => {
                setDiscarding(false)
                router.back()
              }}
            />
            <Button
              label="Seguir editando"
              variant="secondary"
              onPress={() => setDiscarding(false)}
            />
          </View>
        ) : (
          <View style={styles.sheetBody}>
            <Text role="body" size="xs" color="muted">
              {published.length === 0
                ? 'Todavía no tienes ninguna rutina que poner aquí.'
                : chosenDay
                  ? `Se repetirá todos los ${chosenDay.name} del programa.`
                  : ''}
            </Text>

            {published.length === 0 ? (
              <View style={styles.emptySheet}>
                <View
                  style={[
                    styles.emptyIcon,
                    {
                      borderColor: theme.color.border.subtle,
                      backgroundColor: theme.color.background.surfaceSubtle,
                    },
                  ]}
                >
                  <FoundationIcon
                    name="training"
                    size="lg"
                    color={theme.color.icon.secondary}
                    decorative
                  />
                </View>
                <Text role="display" size="lg" align="center">
                  Crea tu primera rutina
                </Text>
                <Text role="body" size="sm" color="muted" style={styles.centered}>
                  Una rutina es la sesión que se repite: sus ejercicios, sus series y sus pesos.
                  Cuando tengas una, podrás ponerla en cualquier día del programa.
                </Text>
                <Button
                  label="Crear una rutina"
                  icon="add"
                  onPress={() => leaveToWrite(choosing)}
                />
                <Button
                  label="Ver los de Allfit"
                  variant="secondary"
                  icon="explore"
                  onPress={() => {
                    setChoosing(undefined)
                    router.push('/programs')
                  }}
                />
              </View>
            ) : (
              <ScrollView style={styles.sheetList} showsVerticalScrollIndicator={false}>
                {published.map((routine) => {
                  const chosen =
                    week.find((one) => one.day === choosing)?.templateVersionId ===
                    routine.template_version_id
                  return (
                    <Pressable
                      key={routine.template_id}
                      accessibilityRole="button"
                      accessibilityLabel={routine.title}
                      accessibilityState={{ selected: chosen }}
                      onPress={() => put(choosing ?? 1, routine.template_version_id)}
                      style={[
                        styles.option,
                        {
                          backgroundColor: chosen
                            ? theme.color.accent.tonal
                            : theme.color.background.surfaceSubtle,
                          borderColor: chosen
                            ? theme.color.border.accent
                            : theme.color.border.subtle,
                          borderWidth: chosen ? 1.5 : 1,
                        },
                      ]}
                    >
                      <View style={styles.rowText}>
                        <Text role="control" size="sm">
                          {routine.title}
                        </Text>
                        <Text role="body" size="xs" color="muted">
                          {`${routine.exercise_count} ejercicios · ${routine.set_count} series`}
                        </Text>
                      </View>
                      {chosen ? (
                        <FoundationIcon
                          name="check"
                          size="sm"
                          color={theme.color.icon.accent}
                          decorative
                        />
                      ) : null}
                    </Pressable>
                  )
                })}

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    chosenDay ? `Dejar el ${chosenDay.name} libre` : 'Dejar el día libre'
                  }
                  onPress={() => put(choosing ?? 1, null)}
                  style={[
                    styles.option,
                    {
                      backgroundColor: theme.color.background.surfaceSubtle,
                      borderColor: theme.color.border.subtle,
                      borderWidth: 1,
                    },
                  ]}
                >
                  <FoundationIcon
                    name="rest"
                    size="sm"
                    color={theme.color.icon.secondary}
                    decorative
                  />
                  <View style={styles.rowText}>
                    <Text role="control" size="sm">
                      Día de descanso
                    </Text>
                    <Text role="body" size="xs" color="muted">
                      {chosenDay ? `deja el ${chosenDay.name} libre` : 'deja el día libre'}
                    </Text>
                  </View>
                </Pressable>

                <Button
                  label="Crear una rutina nueva"
                  variant="secondary"
                  icon="add"
                  onPress={() => leaveToWrite(choosing)}
                />

                {(routines ?? []).some((routine) => routine.template_version_id === null) ? (
                  <View style={styles.footnote}>
                    <FoundationIcon
                      name="locked"
                      size="sm"
                      color={theme.color.icon.secondary}
                      decorative
                    />
                    <Text role="body" size="sm" color="muted" style={styles.noticeText}>
                      Tienes rutinas en borrador. Publícalas para poder ponerlas en un día.
                    </Text>
                  </View>
                ) : null}
              </ScrollView>
            )}
          </View>
        )}
      </Sheet>
    </Screen>
  )
}

const styles = StyleSheet.create({
  // The part that stays and the part that moves.
  frame: { gap: 18, paddingBottom: 16 },
  scroller: { flex: 1 },
  content: { gap: 18, paddingBottom: 16 },
  section: { gap: 10 },
  centered: { textAlign: 'center' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  days: { flexDirection: 'row', gap: 4 },
  // One pill per day holding its letter, its mark and its name. Three loose pieces
  // stacked read as three rows of seven things; one box reads as a day.
  dayCell: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 2,
  },
  // The same room the mark takes, so a free day is the same height as a full one.
  dayFree: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  tune: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  duration: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
  },
  anchor: { paddingTop: 12, paddingBottom: FOOTER_LIFT },
  rowText: { flex: 1, gap: 2 },
  included: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
  },
  notice: { flexDirection: 'row', gap: 10, borderRadius: 16, padding: 14 },
  noticeText: { flex: 1 },
  sheetBody: { gap: 12 },
  sheetList: { maxHeight: 340 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  emptySheet: { alignItems: 'center', gap: 12, paddingTop: 8 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footnote: { flexDirection: 'row', gap: 8, paddingTop: 6 },
})
