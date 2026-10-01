/**
 * Editing a finished session (FIN-18d, HU-SP-058, ADR-038).
 *
 * **Nothing is saved until «Guardar cambios».** A session in progress saves as it goes;
 * a past one is corrected deliberately, so the edits are held here and sent once, whole,
 * under the revision the screen opened with. The server keeps what was there before.
 *
 * **Each changed figure says what it was** («antes 65») and can go back by itself, and
 * the foot counts the changes, so a correction is never made by accident. Records, the
 * streak and the totals are recalculated by the server, which reads them, not stores them.
 *
 * **Same state as the session screen** (`session-form.ts`), so a corrected set is written
 * exactly as a logged one; only what was recorded opens, never the rows the routine
 * proposed. The header and the foot stay put, the exercises scroll.
 */

import { Button } from '@allfitone/react-native/button'
import { IconButton } from '@allfitone/react-native/icon-button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Sheet } from '@allfitone/react-native/sheet'
import { Text } from '@allfitone/react-native/text'
import { TextField } from '@allfitone/react-native/text-field'
import { getNativeFontFamily } from '@allfitone/react-native/fonts'
import { useTheme } from '@allfitone/react-native/theme'
import { typography } from '@allfitone/react-native/tokens'
import { Image } from 'expo-image'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'

import { ApiError } from '../../../src/client'
import { createSpaceContentFlow } from '../../../src/client/content-transport'
import {
  declareAlreadyIn,
  declareReplacing,
  takeExercisePick,
} from '../../../src/client/exercise-pick'
import { readExerciseLibrary } from '../../../src/client/exercise-library'
import type { FinishedExecution } from '../../../src/client/execution'
import { createSpaceExecutionFlow } from '../../../src/client/execution-transport'
import {
  changesBetween,
  clockOf,
  editResults,
  editStateFrom,
  menuTitle,
  originalOf,
  revertedSet,
  withAddedSet,
  withClock,
  withEditedSet,
} from '../../../src/client/finished'
import {
  movedExercise,
  totalVolumeKg,
  withAddedExercises,
  withoutExercise,
  withoutSet,
  type WorkingExercise,
} from '../../../src/client/session-form'
import { deviceTimezone } from '../../../src/client/timezone'
import { SheetChoice } from '../../../src/components/sheet-choice'

const READ_FAILED = 'No pudimos abrir este entreno para editarlo. Inténtalo otra vez.'
const SAVE_FAILED = 'No pudimos guardar los cambios. Inténtalo otra vez.'
const STALE = 'Este entreno cambió en otro lado. Vuelve a abrirlo para editarlo.'
const BAD_TIME = 'Escribe las horas como 18:02, y que el final sea después del inicio.'

type Times = { readonly start: string; readonly end: string }

export default function EditFinishedSessionScreen() {
  const { executionId } = useLocalSearchParams<{ executionId: string }>()
  const router = useRouter()
  const theme = useTheme()
  const timeZone = deviceTimezone()
  const flow = useMemo(() => createSpaceExecutionFlow(), [])

  const [detail, setDetail] = useState<FinishedExecution | undefined>(undefined)
  const [revision, setRevision] = useState(0)
  const [before, setBefore] = useState<readonly WorkingExercise[]>([])
  const [exercises, setExercises] = useState<readonly WorkingExercise[]>([])
  const [pictures, setPictures] = useState<ReadonlyMap<string, string | null>>(new Map())
  const [open, setOpen] = useState<string | undefined>(undefined)
  const [times, setTimes] = useState<Times | undefined>(undefined)
  const [editingTimes, setEditingTimes] = useState<Times | undefined>(undefined)
  const [exerciseMenu, setExerciseMenu] = useState<WorkingExercise | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    Promise.all([
      flow.readFinished(executionId, timeZone),
      flow.readExecution(executionId),
      readExerciseLibrary(createSpaceContentFlow()).catch(() => undefined),
    ])
      .then(([read, recorded, library]) => {
        if (!active) return
        const movements = library?.movements ?? []
        const opened = editStateFrom(recorded, new Map(movements.map((one) => [one.id, one.name])))
        setDetail(read)
        setRevision(read.revision_number)
        setBefore(opened)
        setExercises(opened)
        setOpen(opened[0]?.key)
        setPictures(new Map(movements.map((one) => [one.id, one.demo_url])))
        setTimes({ start: read.started_at, end: read.ended_at })
      })
      .catch(() => active && setFailure(READ_FAILED))
    return () => {
      active = false
    }
  }, [flow, executionId, timeZone])

  // The routine editor's picker, through the same mailbox the session screen reads.
  useFocusEffect(
    useCallback(() => {
      const picked = takeExercisePick()
      if (picked.length === 0) return
      setExercises((current) => {
        const next = withAddedExercises(current, picked).map((exercise, index) =>
          index < current.length
            ? exercise
            : { ...exercise, sets: exercise.sets.map((one) => ({ ...one, done: true })) },
        )
        setOpen(next[current.length]?.key)
        return next
      })
    }, []),
  )

  const timeChanged =
    detail !== undefined &&
    times !== undefined &&
    (times.start !== detail.started_at || times.end !== detail.ended_at)
  const changes = detail ? changesBetween(before, exercises, timeChanged) : 0
  const results = editResults(exercises)
  const minutes = times ? Math.round((Date.parse(times.end) - Date.parse(times.start)) / 60000) : 0
  const volume = totalVolumeKg(
    exercises.map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((one) => ({ ...one, loadKg: one.loadKg.replace(',', '.') })),
    })),
  )

  const save = () => {
    if (!times || results.strength_sets.length === 0) return
    setSaving(true)
    setFailure(undefined)
    flow
      .revise(executionId, revision, {
        started_at: times.start,
        ended_at: times.end,
        strength_sets: results.strength_sets,
        ...(results.exercises ? { exercises: results.exercises } : {}),
      })
      .then(() => router.back())
      .catch((cause: unknown) =>
        setFailure(cause instanceof ApiError && cause.failure === 'conflict' ? STALE : SAVE_FAILED),
      )
      .finally(() => setSaving(false))
  }

  const addExercise = () => {
    declareAlreadyIn(exercises.flatMap((exercise) => exercise.movementId ?? []))
    declareReplacing(undefined)
    router.push('/routines/exercises')
  }

  const applyTimes = () => {
    if (!editingTimes || !detail) return
    const start = withClock(detail.started_at, editingTimes.start, timeZone)
    const end = withClock(detail.started_at, editingTimes.end, timeZone)
    if (!start || !end || Date.parse(end) <= Date.parse(start)) {
      setFailure(BAD_TIME)
      return
    }
    setFailure(undefined)
    setTimes({ start, end })
    setEditingTimes(undefined)
  }

  return (
    <Screen edges={['top', 'bottom']} padded={false}>
      <View style={styles.header}>
        <IconButton
          icon="close"
          accessibilityLabel="Cerrar sin guardar"
          onPress={() => router.back()}
        />
        <View style={styles.grow}>
          <Text role="control" size="xl" accessibilityRole="header">
            Editar entreno
          </Text>
          {detail ? (
            <Text role="body" size="sm" color="secondary">
              {menuTitle(detail.title ?? 'Entreno libre', detail.started_at, timeZone)}
            </Text>
          ) : null}
        </View>
      </View>

      {detail && times ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={[styles.notice, { backgroundColor: theme.color.background.surfaceMuted }]}>
            <FoundationIcon name="info" size="sm" color={theme.color.icon.secondary} decorative />
            <Text role="body" size="sm" color="secondary" style={styles.grow}>
              Es un entreno pasado. Al guardar se recalculan tus récords, tu racha y tus totales.
            </Text>
          </View>

          <View
            style={[
              styles.summary,
              {
                backgroundColor: theme.color.background.surface,
                borderColor: theme.color.border.subtle,
              },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cambiar el horario"
              style={styles.summaryCell}
              onPress={() =>
                setEditingTimes({
                  start: clockOf(times.start, timeZone),
                  end: clockOf(times.end, timeZone),
                })
              }
            >
              <Text role="eyebrow" size="2xs" color="muted" uppercase>
                Horario
              </Text>
              <View style={styles.inline}>
                <Text role="poster" size="xl">
                  {`${clockOf(times.start, timeZone)}–${clockOf(times.end, timeZone)}`}
                </Text>
                <FoundationIcon name="edit" size="xs" color={theme.color.icon.accent} decorative />
              </View>
            </Pressable>
            <View
              style={[
                styles.summaryCell,
                styles.divided,
                { borderLeftColor: theme.color.border.subtle },
              ]}
            >
              <Text role="eyebrow" size="2xs" color="muted" uppercase>
                Duración
              </Text>
              <Text role="poster" size="xl">{`${String(minutes)} min`}</Text>
            </View>
            <View
              style={[
                styles.summaryCell,
                styles.divided,
                { borderLeftColor: theme.color.border.subtle },
              ]}
            >
              <Text role="eyebrow" size="2xs" color="muted" uppercase>
                Volumen
              </Text>
              <Text role="poster" size="xl">
                {`${volume.toLocaleString('es-CO', { maximumFractionDigits: 0 })} kg`}
              </Text>
            </View>
          </View>

          {failure ? <InlineAlert message={failure} /> : null}

          {exercises.map((exercise) => (
            <ExerciseEditor
              key={exercise.key ?? String(exercise.position)}
              exercise={exercise}
              before={before}
              picture={exercise.movementId ? (pictures.get(exercise.movementId) ?? null) : null}
              open={open === exercise.key}
              onToggle={() => setOpen(open === exercise.key ? undefined : exercise.key)}
              onMenu={() => setExerciseMenu(exercise)}
              onEdit={(order, patch) =>
                setExercises(withEditedSet(exercises, exercise.position, order, patch))
              }
              onRevert={(order) =>
                setExercises(revertedSet(before, exercises, exercise.position, order))
              }
              onRemoveSet={(order) => setExercises(withoutSet(exercises, exercise.position, order))}
              onAddSet={() => setExercises(withAddedSet(exercises, exercise.position))}
            />
          ))}

          <Button label="Añadir ejercicio" icon="add" variant="secondary" onPress={addExercise} />
        </ScrollView>
      ) : (
        <View style={styles.waiting}>
          {failure ? (
            <InlineAlert message={failure} />
          ) : (
            <ActivityIndicator color={theme.color.icon.accent} />
          )}
        </View>
      )}

      {detail ? (
        <View
          style={[
            styles.foot,
            {
              borderTopColor: theme.color.border.subtle,
              backgroundColor: theme.color.background.canvas,
            },
          ]}
        >
          <View style={styles.changes}>
            {changes > 0 ? (
              <View style={[styles.dot, { backgroundColor: theme.color.icon.accent }]} />
            ) : null}
            <Text role="body" size="sm" color={changes > 0 ? 'secondary' : 'muted'}>
              {changes === 0
                ? 'Sin cambios todavía'
                : `${String(changes)} ${changes === 1 ? 'cambio' : 'cambios'} · tus récords se recalculan al guardar`}
            </Text>
          </View>
          <View style={styles.footRow}>
            <View style={styles.discard}>
              <Button
                label="Descartar"
                variant="secondary"
                onPress={() => router.back()}
                disabled={saving}
              />
            </View>
            <View style={styles.grow}>
              <Button
                label="Guardar cambios"
                loading={saving}
                disabled={changes === 0 || results.strength_sets.length === 0}
                onPress={save}
              />
            </View>
          </View>
        </View>
      ) : null}

      <Sheet
        visible={editingTimes !== undefined}
        onDismiss={() => setEditingTimes(undefined)}
        title="Horario del entreno"
      >
        {editingTimes ? (
          <View style={styles.sheet}>
            <View style={styles.footRow}>
              <View style={styles.grow}>
                <TextField
                  label="Empezó"
                  value={editingTimes.start}
                  onChangeText={(start) => setEditingTimes({ ...editingTimes, start })}
                  keyboardType="numbers-and-punctuation"
                  placeholder="18:02"
                />
              </View>
              <View style={styles.grow}>
                <TextField
                  label="Terminó"
                  value={editingTimes.end}
                  onChangeText={(end) => setEditingTimes({ ...editingTimes, end })}
                  keyboardType="numbers-and-punctuation"
                  placeholder="18:50"
                />
              </View>
            </View>
            <Button label="Listo" onPress={applyTimes} />
          </View>
        ) : null}
      </Sheet>

      <Sheet
        visible={exerciseMenu !== undefined}
        onDismiss={() => setExerciseMenu(undefined)}
        title={exerciseMenu?.movement ?? 'Ejercicio'}
      >
        {exerciseMenu ? (
          <View style={styles.sheet}>
            <SheetChoice
              name="Subir"
              disabled={exerciseMenu.position === 1}
              onPress={() => {
                setExercises(
                  movedExercise(exercises, exerciseMenu.position, exerciseMenu.position - 1),
                )
                setExerciseMenu(undefined)
              }}
            />
            <SheetChoice
              name="Bajar"
              disabled={exerciseMenu.position === exercises.length}
              onPress={() => {
                setExercises(
                  movedExercise(exercises, exerciseMenu.position, exerciseMenu.position + 1),
                )
                setExerciseMenu(undefined)
              }}
            />
            <SheetChoice
              name="Quitar ejercicio"
              detail="Sus series dejan de contar en este entreno"
              destructive
              disabled={exercises.length === 1}
              onPress={() => {
                setExercises(withoutExercise(exercises, exerciseMenu.position))
                setExerciseMenu(undefined)
              }}
            />
          </View>
        ) : null}
      </Sheet>
    </Screen>
  )
}

function ExerciseEditor({
  exercise,
  before,
  picture,
  open,
  onToggle,
  onMenu,
  onEdit,
  onRevert,
  onRemoveSet,
  onAddSet,
}: {
  readonly exercise: WorkingExercise
  readonly before: readonly WorkingExercise[]
  readonly picture: string | null
  readonly open: boolean
  readonly onToggle: () => void
  readonly onMenu: () => void
  readonly onEdit: (order: number, patch: { loadKg?: string; reps?: string }) => void
  readonly onRevert: (order: number) => void
  readonly onRemoveSet: (order: number) => void
  readonly onAddSet: () => void
}) {
  const theme = useTheme()
  const sets = exercise.sets.length
  return (
    <View
      style={[
        styles.exercise,
        {
          backgroundColor: theme.color.background.surface,
          borderColor: open ? theme.color.border.accent : theme.color.border.subtle,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${exercise.movement}, ${String(sets)} series`}
        onPress={onToggle}
        style={styles.exerciseHead}
      >
        <View style={[styles.picture, { backgroundColor: theme.color.background.surfaceSubtle }]}>
          {picture ? (
            <Image source={picture} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : null}
        </View>
        <View style={styles.grow}>
          <Text role="control" size="md" numberOfLines={2}>
            {exercise.movement}
          </Text>
          <Text role="body" size="sm" color="muted">
            {`${String(sets)} ${sets === 1 ? 'serie' : 'series'}`}
          </Text>
        </View>
        {open ? (
          <IconButton icon="more" accessibilityLabel="Opciones del ejercicio" onPress={onMenu} />
        ) : null}
        <FoundationIcon
          name={open ? 'collapse' : 'expand'}
          size="sm"
          color={theme.color.icon.secondary}
          decorative
        />
      </Pressable>

      {open ? (
        <View style={styles.sets}>
          <View style={styles.setRow}>
            <Text role="eyebrow" size="2xs" color="muted" uppercase style={styles.setNumber}>
              Serie
            </Text>
            <Text
              role="eyebrow"
              size="2xs"
              color="muted"
              uppercase
              align="center"
              style={styles.grow}
            >
              Kg
            </Text>
            <Text
              role="eyebrow"
              size="2xs"
              color="muted"
              uppercase
              align="center"
              style={styles.grow}
            >
              Reps
            </Text>
            <View style={styles.setAction} />
          </View>
          {exercise.sets.map((one, index) => {
            const original = originalOf(before, one)
            const changed = original
              ? original.loadKg !== one.loadKg || original.reps !== one.reps
              : false
            return (
              <View key={one.origin ?? `new-${String(one.order)}`} style={styles.setRow}>
                <Text role="poster" size="lg" color="secondary" style={styles.setNumber}>
                  {one.kind === 'warmup' ? 'C' : String(index + 1)}
                </Text>
                <Cell
                  label={`Kilos de la serie ${String(index + 1)}`}
                  value={one.loadKg}
                  was={original && original.loadKg !== one.loadKg ? original.loadKg : undefined}
                  onChange={(loadKg) => onEdit(one.order, { loadKg })}
                />
                <Cell
                  label={`Repeticiones de la serie ${String(index + 1)}`}
                  value={one.reps}
                  was={original && original.reps !== one.reps ? original.reps : undefined}
                  onChange={(reps) => onEdit(one.order, { reps })}
                />
                <View style={styles.setAction}>
                  {changed ? (
                    <IconButton
                      icon="back"
                      accessibilityLabel={`Deshacer la serie ${String(index + 1)}`}
                      onPress={() => onRevert(one.order)}
                    />
                  ) : (
                    <IconButton
                      icon="remove"
                      accessibilityLabel={`Quitar la serie ${String(index + 1)}`}
                      disabled={sets === 1}
                      onPress={() => onRemoveSet(one.order)}
                    />
                  )}
                </View>
              </View>
            )
          })}
          <Button label="Añadir serie" icon="add" variant="ghost" onPress={onAddSet} />
        </View>
      ) : null}
    </View>
  )
}

/** A figure to correct, with what it was beneath it once it changed. */
function Cell({
  label,
  value,
  was,
  onChange,
}: {
  readonly label: string
  readonly value: string
  readonly was: string | undefined
  readonly onChange: (value: string) => void
}) {
  const theme = useTheme()
  return (
    <View
      style={[
        styles.cell,
        {
          backgroundColor: theme.color.background.surfaceMuted,
          borderColor: was === undefined ? 'transparent' : theme.color.border.accent,
        },
      ]}
    >
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        selectTextOnFocus
        style={[styles.input, { color: theme.color.text.primary }]}
      />
      {was === undefined ? null : (
        <Text role="body" size="xs" color="accent">
          {`antes ${was === '' ? '—' : was}`}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  grow: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 24, gap: 12 },
  waiting: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, padding: 14 },
  summary: { flexDirection: 'row', borderRadius: 20, borderWidth: 1, paddingVertical: 14 },
  summaryCell: { flex: 1, gap: 4, paddingHorizontal: 14 },
  divided: { borderLeftWidth: 1 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  exercise: { borderRadius: 22, borderWidth: 1, padding: 12, gap: 8 },
  exerciseHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  picture: { width: 46, height: 46, borderRadius: 13, overflow: 'hidden' },
  sets: { gap: 8 },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  setNumber: { width: 40 },
  setAction: { width: 44, alignItems: 'center' },
  cell: {
    flex: 1,
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  // The figure being corrected reads at the poster role's 2xl, as the set lines do.
  input: {
    fontFamily: getNativeFontFamily('poster'),
    fontSize: typography.size['2xl'],
    textAlign: 'center',
    minWidth: 60,
    paddingVertical: 0,
  },
  foot: { borderTopWidth: 1, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 6, gap: 10 },
  changes: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  footRow: { flexDirection: 'row', gap: 12 },
  discard: { width: 130 },
  sheet: { gap: 12, paddingBottom: 8 },
})
