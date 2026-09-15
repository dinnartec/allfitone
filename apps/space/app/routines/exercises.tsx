/**
 * `S-1` — elegir ejercicios, varios a la vez.
 *
 * A whole screen and not a sheet. A sheet is anchored to the bottom edge, which is
 * exactly where the keyboard appears, so searching left about three results visible;
 * and picking wrote the draft on every tap, so five exercises were five saves.
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
 * **The filters left the screen they filter.** They were two rows of chips above the
 * list — eighteen muscles in three blocks, then nine equipment — and between them they
 * took half the usable height, which is the problem this screen was built to solve.
 * Now there are two buttons that say what they are set to and open their own screen.
 * What is on comes back as pills, each removable by itself, because "clear all" is a
 * blunt instrument when only one of three is wrong.
 *
 * Filtering happens in memory over the catalogue held here; `exercise-catalogue`
 * carries that decision and what it costs.
 *
 * Each row carries a second target that opens the movement's detail. Somebody who has
 * never done a hip thrust has to be able to find out what it is before putting it in
 * their routine, and the row alone cannot say.
 */

import { DisclosureButton } from '@allfitone/react-native/disclosure-button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { SelectableRow } from '@allfitone/react-native/selectable-row'
import { Text } from '@allfitone/react-native/text'
import { TextField } from '@allfitone/react-native/text-field'
import { useTheme } from '@allfitone/react-native/theme'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { ApiError } from '../../src/client'
import type { CatalogueTerm, Movement, MuscleTerm } from '../../src/client/content'
import { createSpaceContentFlow } from '../../src/client/content-transport'
import {
  anyFilter,
  applyFilter,
  facetSummary,
  listSummary,
  movementCaption,
  pillsFor,
  toggleFilter,
  type ExerciseFilter,
} from '../../src/client/exercise-catalogue'
import {
  alreadyIn,
  exerciseFilter,
  isPicked,
  offerExercisePick,
  offerable,
  pickLabel,
  rememberExerciseFilter,
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
  const [filter, setFilter] = useState<ExerciseFilter>(() => exerciseFilter())
  const [movements, setMovements] = useState<readonly Movement[] | undefined>(undefined)
  const [muscles, setMuscles] = useState<readonly MuscleTerm[]>([])
  const [equipment, setEquipment] = useState<readonly CatalogueTerm[]>([])
  const [picked, setPicked] = useState<readonly PickedMovement[]>([])
  const [failure, setFailure] = useState<string | undefined>(undefined)

  // The whole library, once. Filtering it here is what makes the counts instant and
  // what lets a filter screen say how many are left before it is applied.
  useEffect(() => {
    let active = true

    Promise.all([
      flow.searchMovements(DISCIPLINE, '', [], []),
      flow.readMuscles(),
      flow.readEquipment(),
    ])
      .then(([found, worked, needed]) => {
        if (!active) return
        setMovements(found)
        setMuscles(worked)
        setEquipment(needed)
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
  }, [flow])

  // The filter screens sit above this one, so what they chose arrives on the way back.
  useFocusEffect(
    useCallback(() => {
      setFilter(exerciseFilter())
    }, []),
  )

  const change = useCallback((next: ExerciseFilter) => {
    setFilter(next)
    rememberExerciseFilter(next)
  }, [])

  const shown = offerable(applyFilter(movements ?? [], filter, query), already)
  const pills = pillsFor(filter, muscles, equipment)
  const filtering = anyFilter(filter) || query.trim() !== ''

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
          subtitle={picked.length === 0 ? 'toca los que quieras' : `${picked.length} elegidos`}
          onClose={() => router.back()}
          onConfirm={picked.length === 0 ? undefined : confirm}
          confirmLabel={pickLabel(picked.length)}
          confirmText
        />

        {failure ? <InlineAlert message={failure} /> : null}

        <TextField
          label="Buscar ejercicio"
          placeholder="Busca por nombre"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
        />

        <View style={styles.filters}>
          <DisclosureButton
            label="Equipamiento"
            value={facetSummary(filter, 'equipment')}
            icon="settings"
            active={filter.equipment.length > 0}
            grow
            onPress={() => router.push('/routines/exercises/equipment')}
          />
          <DisclosureButton
            label="Musculatura"
            value={facetSummary(filter, 'muscle')}
            icon="target"
            active={filter.muscles.length > 0}
            grow
            onPress={() => router.push('/routines/exercises/muscles')}
          />
        </View>

        {pills.length > 0 ? (
          <View style={styles.pills}>
            {pills.map((pill) => (
              <Pressable
                key={`${pill.facet}-${pill.code}`}
                accessibilityRole="button"
                accessibilityLabel={`Quitar ${pill.name}`}
                onPress={() =>
                  change(
                    toggleFilter(
                      filter,
                      pill.facet,
                      pill.code,
                      pill.facet === 'muscle' ? muscles : equipment,
                    ),
                  )
                }
                style={[
                  styles.pill,
                  {
                    backgroundColor: theme.color.accent.tonal,
                    borderColor: theme.color.accent.tonalBorder,
                  },
                ]}
              >
                <Text role="display" size="xs" uppercase color="accent">
                  {pill.name}
                </Text>
                <FoundationIcon
                  name="close"
                  customSize={12}
                  color={theme.color.text.accent}
                  decorative
                />
              </Pressable>
            ))}
            {/* Only past one: beside a single pill it would say the same thing twice. */}
            {pills.length > 1 ? (
              <Text
                role="control"
                size="xs"
                color="secondary"
                accessibilityRole="button"
                style={styles.clear}
                onPress={() => change({ muscles: [], equipment: [] })}
              >
                Quitar todos
              </Text>
            ) : null}
          </View>
        ) : null}

        <Text role="eyebrow" size="2xs" color="muted">
          {listSummary(shown.length, filtering).toUpperCase()}
        </Text>

        <View style={styles.list}>
          {shown.map((movement) => (
            <SelectableRow
              key={movement.id}
              name={movement.name}
              caption={movementCaption(movement, muscles, equipment)}
              selected={isPicked(picked, movement.id)}
              onPress={() =>
                setPicked((current) =>
                  togglePick(current, { id: movement.id, name: movement.name }),
                )
              }
              // Choosing and reading about it are different intents, so they are
              // different targets.
              action={{
                icon: 'info',
                accessibilityLabel: `Ver el detalle de ${movement.name}`,
                onPress: () => router.push(`/routines/exercises/${movement.id}`),
              }}
            />
          ))}
        </View>

        {movements !== undefined && shown.length === 0 ? (
          <Text role="body" size="sm" color="muted">
            {filtering
              ? 'Nada con esos filtros. Quita alguno para ver más.'
              : 'Tu rutina ya tiene todos los ejercicios del catálogo.'}
          </Text>
        ) : null}

        {movements === undefined && !failure ? (
          <Text role="body" size="sm" color="muted">
            Cargando el catálogo…
          </Text>
        ) : null}

        <Text role="body" size="xs" color="muted" style={styles.foot}>
          Solo el catálogo global de Allfit.
        </Text>
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: 14, paddingBottom: 48 },
  filters: { flexDirection: 'row', gap: 10 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  pill: {
    minHeight: 32,
    borderRadius: 999,
    borderWidth: 1,
    paddingLeft: 12,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  clear: { minHeight: 32, paddingHorizontal: 4, textDecorationLine: 'underline' },
  list: { gap: 8 },
  foot: { textAlign: 'center' },
})
