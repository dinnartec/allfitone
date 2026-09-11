/**
 * `S-1` — elegir ejercicios, varios a la vez.
 *
 * A whole screen and not a sheet. A sheet is anchored to the bottom edge, which is
 * exactly where the keyboard appears, so searching left about three results visible;
 * and picking wrote the draft on every tap, so five exercises were five saves. This
 * is what the canvas drew before the implementation chose a sheet.
 *
 * **It never saves.** The routine editor stays the only writer of the draft; this
 * screen chooses and hands the selection over through `exercise-pick`. That is what
 * keeps the route from becoming the thing the editor's header warned about — a second
 * copy of the draft with a way to disagree with the first.
 *
 * It is not under `[templateId]` because it does not need to know which routine it
 * came from, and for a routine still being written there is no identifier to know.
 *
 * **The list is already there when it opens.** The catalogue is 38 movements and the
 * search answers 40 by default, so an empty query is the whole library rather than an
 * empty state waiting to be typed at. Searching narrows something already useful.
 *
 * **Two chip rows, and they do not mean the same thing.** Several chips of one row
 * are `or` — a second muscle widens — while combining muscle with equipment is `and`.
 * The database enforces it; `exercise-filter` is where the screen's half is tested.
 *
 * The two vocabularies are asked once and never again. A chip row that reshuffled as
 * somebody typed could not be used: you would reach for a chip that had moved.
 */

import { Checkbox } from '@allfitone/react-native/checkbox'
import { Chip } from '@allfitone/react-native/chip'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { TextField } from '@allfitone/react-native/text-field'
import { useTheme } from '@allfitone/react-native/theme'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { ApiError } from '../../src/client'
import type { CatalogueTerm, Movement, MuscleTerm } from '../../src/client/content'
import { createSpaceContentFlow } from '../../src/client/content-transport'
import {
  NOTHING_FILTERED,
  anyFilter,
  chosenNames,
  filterSummary,
  isFiltered,
  muscleBlocks,
  toggleFilter,
  type ExerciseFilter,
} from '../../src/client/exercise-filter'
import {
  alreadyIn,
  isPicked,
  offerExercisePick,
  offerable,
  pickLabel,
  togglePick,
  type PickedMovement,
} from '../../src/client/exercise-pick'
import { DISCIPLINE } from '../../src/client/routine-draft'
import { ScreenHeader } from '../../src/components/screen-header'

const EXPIRED = 'Tu sesión venció. Vuelve a entrar para continuar.'
const SEARCH_FAILED = 'No pudimos buscar en el catálogo. Inténtalo otra vez.'

export default function ExercisePicker() {
  const router = useRouter()
  const theme = useTheme()
  const flow = useMemo(() => createSpaceContentFlow(), [])
  // Read once: the editor left it before pushing, and it cannot change while this
  // screen is up, because this screen is the only thing that changes it.
  const already = useMemo(() => alreadyIn(), [])

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ExerciseFilter>(NOTHING_FILTERED)
  const [movements, setMovements] = useState<readonly Movement[] | undefined>(undefined)
  const [muscles, setMuscles] = useState<readonly MuscleTerm[]>([])
  const [equipment, setEquipment] = useState<readonly CatalogueTerm[]>([])
  const [picked, setPicked] = useState<readonly PickedMovement[]>([])
  const [failure, setFailure] = useState<string | undefined>(undefined)

  // Once, on mount. A chip row that changed with the search could not be used: you
  // would reach for a chip that had moved.
  useEffect(() => {
    let active = true

    Promise.all([flow.readMuscles(), flow.readEquipment()])
      .then(([worked, needed]) => {
        if (!active) return
        setMuscles(worked)
        setEquipment(needed)
      })
      .catch(() => {
        // The chips are an improvement on the search, not a precondition for it, so a
        // vocabulary that does not arrive leaves the list usable instead of empty.
        if (active) setMuscles([])
      })

    return () => {
      active = false
    }
  }, [flow])

  useEffect(() => {
    let active = true

    flow
      .searchMovements(DISCIPLINE, query, filter.muscles, filter.equipment)
      .then((found) => {
        if (!active) return
        setMovements(found)
        setFailure(undefined)
      })
      .catch((cause: unknown) => {
        if (!active) return
        setFailure(
          cause instanceof ApiError && cause.failure === 'unauthenticated'
            ? EXPIRED
            : SEARCH_FAILED,
        )
      })

    return () => {
      active = false
    }
  }, [flow, query, filter])

  const shown = offerable(movements ?? [], already)

  const confirm = () => {
    offerExercisePick(picked)
    router.back()
  }

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
          title="Añadir ejercicio"
          subtitle={picked.length === 0 ? 'toca los que quieras' : pickLabel(picked.length)}
          onClose={() => router.back()}
          onConfirm={picked.length === 0 ? undefined : confirm}
          confirmLabel={pickLabel(picked.length)}
        />

        {failure ? <InlineAlert message={failure} /> : null}

        <TextField
          label="Buscar ejercicio"
          placeholder="Busca por nombre"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
        />

        {muscles.length > 0 ? (
          <View style={styles.filters}>
            {muscleBlocks(muscles).map((block) => (
              <View key={block.region} style={styles.facet}>
                <Text role="eyebrow" size="2xs" color="muted">
                  {block.title}
                </Text>
                <View style={styles.chips}>
                  {block.muscles.map((muscle) => (
                    <Chip
                      key={muscle.code}
                      label={muscle.name}
                      selected={isFiltered(filter, 'muscle', muscle.code)}
                      onPress={() =>
                        setFilter((current) =>
                          toggleFilter(current, 'muscle', muscle.code, muscles),
                        )
                      }
                    />
                  ))}
                </View>
              </View>
            ))}

            {equipment.length > 0 ? (
              <View style={styles.facet}>
                <Text role="eyebrow" size="2xs" color="muted">
                  CON QUÉ
                </Text>
                <View style={styles.chips}>
                  {equipment.map((item) => (
                    <Chip
                      key={item.code}
                      label={item.name}
                      selected={isFiltered(filter, 'equipment', item.code)}
                      onPress={() =>
                        setFilter((current) =>
                          toggleFilter(current, 'equipment', item.code, equipment),
                        )
                      }
                    />
                  ))}
                </View>
              </View>
            ) : null}

            {anyFilter(filter) ? (
              <Text
                role="control"
                size="xs"
                color="accent"
                accessibilityRole="button"
                onPress={() => setFilter(NOTHING_FILTERED)}
              >
                Quitar filtros
              </Text>
            ) : null}
          </View>
        ) : null}

        <Text role="eyebrow" size="2xs" color="muted">
          {filterSummary(filter, shown.length)}
        </Text>

        {anyFilter(filter) ? (
          <Text role="body" size="xs" color="muted">
            {chosenNames(filter, muscles, equipment).join(' · ')}
          </Text>
        ) : null}

        <View style={styles.list}>
          {shown.map((movement) => (
            <View
              key={movement.id}
              style={[
                styles.row,
                {
                  backgroundColor: theme.color.background.surface,
                  borderColor: isPicked(picked, movement.id)
                    ? theme.color.border.accent
                    : theme.color.border.subtle,
                  borderWidth: isPicked(picked, movement.id) ? 1.5 : 1,
                },
              ]}
            >
              <Checkbox
                label={movement.name}
                checked={isPicked(picked, movement.id)}
                onChange={() =>
                  setPicked((current) =>
                    togglePick(current, { id: movement.id, name: movement.name }),
                  )
                }
              />
            </View>
          ))}
        </View>

        {movements !== undefined && shown.length === 0 ? (
          <Text role="body" size="sm" color="muted">
            {anyFilter(filter)
              ? 'Nada con esos filtros. Quita alguno para ver más.'
              : query.trim() === ''
                ? 'Tu rutina ya tiene todos los ejercicios del catálogo.'
                : 'No hay ejercicios con ese nombre en el catálogo.'}
          </Text>
        ) : null}

        {movements === undefined && !failure ? (
          <Text role="body" size="sm" color="muted">
            Cargando el catálogo…
          </Text>
        ) : null}

        <Text role="body" size="xs" color="muted">
          Solo el catálogo global de Allfit.
        </Text>
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: 18, paddingBottom: 48 },
  filters: { gap: 14 },
  facet: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  list: { gap: 8 },
  row: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
})
