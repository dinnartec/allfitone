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
import { FoundationIcon } from '@allfitone/react-native/icons'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Sheet } from '@allfitone/react-native/sheet'
import { Stepper } from '@allfitone/react-native/stepper'
import { Text } from '@allfitone/react-native/text'
import { TextField } from '@allfitone/react-native/text-field'
import { useTheme } from '@allfitone/react-native/theme'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { ApiError } from '../../src/client'
import { createSpaceContentFlow } from '../client/content-transport'
import { deviceTimezone } from '../client/timezone'
import {
  collapseBaseWeek,
  expandBaseWeek,
  summarizeBaseWeek,
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

const DEFAULT_WEEKS = 8
const MIN_WEEKS = 1
const MAX_WEEKS = 52
const SAVE_DELAY_MS = 700

const EXPIRED = 'Tu sesión venció. Vuelve a entrar para continuar.'
const SAVE_FAILED = 'No pudimos guardar el borrador. Revisa tu conexión.'
const READ_FAILED = 'No pudimos cargar tus rutinas. Inténtalo otra vez.'
const OPEN_FAILED = 'No pudimos abrir este programa. Inténtalo otra vez.'
const NOT_MINE = 'Este programa no se puede editar aquí.'
// What a programme is, rather than what publishing does to other people: nobody else
// can take a personal programme, so that warning explained a rule that never applied.
// It names Entrenar because that is a tab somebody can open. "Tu agenda" is the
// domain's word and "el calendario" is a screen this app does not have.
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
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const identity = useRef<string | undefined>(programId)

  useEffect(() => {
    let active = true

    flow
      .readMyRoutines()
      .then((found) => {
        if (active) setRoutines(found)
      })
      .catch((cause: unknown) => {
        if (!active) return
        setFailure(
          cause instanceof ApiError && cause.failure === 'unauthenticated' ? EXPIRED : READ_FAILED,
        )
      })

    return () => {
      active = false
    }
  }, [flow])

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
    if (!programId) return
    let active = true

    flow
      .openProgram(programId)
      .then((draft) => {
        if (!active) return
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
        setFailure(
          cause instanceof ApiError && cause.failure === 'unauthenticated' ? EXPIRED : SAVE_FAILED,
        )
        return false
      } finally {
        setSaving(false)
      }
    },
    [flow, notes, openable],
  )

  const schedule = useCallback(
    (nextTitle: string, nextWeek: readonly BaseWeekDay[], nextWeeks: number) => {
      if (pending.current) clearTimeout(pending.current)
      pending.current = setTimeout(
        () => void persist(nextTitle, nextWeek, nextWeeks),
        SAVE_DELAY_MS,
      )
    },
    [persist],
  )

  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current)
    },
    [],
  )

  const published = (routines ?? []).filter((routine) => routine.template_version_id !== null)
  const summary = summarizeBaseWeek(week, weeks)
  const publishable = openable && title.trim() !== '' && summary.daysPerWeek > 0

  const routineOn = (day: number) => {
    const filled = week.find((one) => one.day === day)
    if (!filled?.templateVersionId) return undefined
    return published.find((one) => one.template_version_id === filled.templateVersionId)
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
      // To Entrenar rather than back: this is now the programme being trained, and that
      // is the tab that says so.
      router.replace('/train')
    } catch (cause: unknown) {
      setFailure(
        cause instanceof ApiError && cause.failure === 'unauthenticated' ? EXPIRED : SAVE_FAILED,
      )
    }
  }

  const subtitle = () => {
    if (saving) return 'guardando…'
    if (failure) return 'sin guardar'
    if (saved) return 'programa propio · borrador'
    return 'aún sin guardar'
  }

  // How many weeks a routine is used counts once per week, because the base week is
  // what repeats: saying "8×" would be counting the repetition twice.
  const timesPerWeek = (templateVersionId: string) =>
    week.filter((one) => one.templateVersionId === templateVersionId).length

  const chosenDay = DAYS.find((one) => one.day === choosing)

  return (
    <Screen edges={['top', 'bottom']}>
      {/* The keyboard moves the scroll inset rather than resizing the container, the
          same as every other screen here that takes typing. */}
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        automaticallyAdjustKeyboardInsets
      >
        <ScreenHeader
          title={title.trim() === '' ? 'Programa nuevo' : title}
          subtitle={subtitle()}
          onClose={() => router.back()}
          onConfirm={publishable ? publish : undefined}
          confirmLabel="Listo"
        />

        {failure ? <InlineAlert message={failure} /> : null}

        <TextField
          label="Ponle un nombre"
          placeholder="Fuerza inicial, Mi plan…"
          value={title}
          onChangeText={rename}
          autoCapitalize="sentences"
        />

        <View style={[styles.load, { borderColor: theme.color.border.subtle }]}>
          <Figure value={String(weeks)} label="semanas" />
          <View style={[styles.divider, { backgroundColor: theme.color.border.subtle }]} />
          <Figure value={String(summary.sessions)} label="sesiones" accent />
          <View style={[styles.divider, { backgroundColor: theme.color.border.subtle }]} />
          <Figure value={String(summary.daysPerWeek)} label="por semana" />
        </View>

        <View style={styles.section}>
          <Text role="eyebrow" size="2xs" color="muted">
            LA SEMANA BASE
          </Text>
          <Text role="body" size="sm" color="muted">
            Defínela una vez. Se repite en todas las semanas.
          </Text>

          <View style={styles.days}>
            {DAYS.map((day) => {
              const routine = routineOn(day.day)
              const filled = routine !== undefined
              return (
                <View key={day.day} style={styles.dayColumn}>
                  <Text role="label" size="2xs" color="muted">
                    {day.letter}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      filled
                        ? `${day.name}: ${routine.title}. Cambiar`
                        : `${day.name}: sin rutina. Poner una`
                    }
                    onPress={() => setChoosing(day.day)}
                    style={({ pressed }) => [
                      styles.dayCell,
                      {
                        backgroundColor: filled
                          ? theme.color.accent.tonal
                          : theme.color.background.surface,
                        borderColor: filled ? theme.color.border.accent : theme.color.border.subtle,
                        borderWidth: filled ? 1.5 : 1,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    {filled ? (
                      <Text role="label" size="2xs" color="accent" align="center" numberOfLines={2}>
                        {routine.title}
                      </Text>
                    ) : (
                      <FoundationIcon
                        name="add"
                        size="sm"
                        color={theme.color.icon.secondary}
                        decorative
                      />
                    )}
                  </Pressable>
                </View>
              )
            })}
          </View>

          <View
            style={[
              styles.repeat,
              {
                borderColor: theme.color.border.subtle,
                backgroundColor: theme.color.background.surface,
              },
            ]}
          >
            <FoundationIcon name="frequency" size="sm" color={theme.color.icon.accent} decorative />
            <View style={styles.rowText}>
              <Text role="body" size="xs" color="muted">
                Se repite durante
              </Text>
              <Text role="control" size="md">
                {weeks === 1 ? '1 semana' : `${weeks} semanas`}
              </Text>
            </View>
            <Stepper
              accessibilityLabel="Semanas que se repite"
              value={weeks}
              onChange={repeat}
              min={MIN_WEEKS}
              max={MAX_WEEKS}
            />
          </View>

          <Text role="body" size="sm" color="muted" style={styles.centered}>
            Toca un día para poner o cambiar su rutina.
          </Text>
        </View>

        <View style={styles.section}>
          <Text role="eyebrow" size="2xs" color="muted">
            RUTINAS QUE INCLUYE
          </Text>
          {summary.daysPerWeek === 0 ? (
            <Text role="body" size="sm" color="muted">
              Todavía no hay ninguna rutina en la semana.
            </Text>
          ) : (
            <View>
              {published
                .filter((routine) => timesPerWeek(routine.template_version_id ?? '') > 0)
                .map((routine) => (
                  <View
                    key={routine.template_id}
                    style={[styles.included, { borderColor: theme.color.border.subtle }]}
                  >
                    <View style={styles.rowText}>
                      <Text role="control" size="sm">
                        {routine.title}
                      </Text>
                      <Text role="body" size="xs" color="muted">
                        {`${routine.exercise_count} ejercicios · ${routine.set_count} series`}
                      </Text>
                    </View>
                    <Text role="label" size="2xs" color="secondary">
                      {`${timesPerWeek(routine.template_version_id ?? '')}×/sem`}
                    </Text>
                  </View>
                ))}
            </View>
          )}
        </View>

        <View style={[styles.notice, { backgroundColor: theme.color.background.surfaceSubtle }]}>
          <FoundationIcon name="info" size="sm" color={theme.color.icon.secondary} decorative />
          <Text role="body" size="sm" color="secondary" style={styles.noticeText}>
            {WHAT_A_PROGRAM_IS}
          </Text>
        </View>
      </ScrollView>

      <Sheet
        visible={choosing !== undefined}
        onDismiss={() => setChoosing(undefined)}
        title={chosenDay ? `Qué toca el ${chosenDay.name}` : 'Qué toca ese día'}
      >
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
                label="CREAR UNA RUTINA"
                icon="add"
                onPress={() => {
                  setChoosing(undefined)
                  router.push('/routines/new')
                }}
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
                        borderColor: chosen ? theme.color.border.accent : theme.color.border.subtle,
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
                onPress={() => {
                  setChoosing(undefined)
                  router.push('/routines/new')
                }}
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
      </Sheet>
    </Screen>
  )
}

function Figure({
  value,
  label,
  accent,
}: {
  readonly value: string
  readonly label: string
  readonly accent?: boolean
}) {
  return (
    <View style={styles.figure}>
      {accent ? (
        <Text role="display" size="lg" color="accent">
          {value}
        </Text>
      ) : (
        <Text role="display" size="lg">
          {value}
        </Text>
      )}
      <Text role="label" size="2xs" color="muted">
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  content: { gap: 18, paddingBottom: 48 },
  section: { gap: 10 },
  centered: { textAlign: 'center' },
  load: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, paddingBottom: 14 },
  figure: { flex: 1, alignItems: 'center', gap: 2 },
  divider: { width: 1, height: 32 },
  days: { flexDirection: 'row', gap: 5 },
  dayColumn: { flex: 1, alignItems: 'center', gap: 5 },
  dayCell: {
    width: '100%',
    height: 54,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  repeat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
  },
  rowText: { flex: 1, gap: 2 },
  included: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    paddingVertical: 12,
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
