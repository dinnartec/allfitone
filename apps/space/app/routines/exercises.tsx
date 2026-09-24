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
 * **The list is already there when it opens.** An empty query is the whole library
 * rather than an empty state waiting to be typed at, so searching narrows something
 * already useful.
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
 *
 * **The row leads with the picture.** Four hundred names, many of which differ by one
 * word, are not something anybody reads their way through; the thumbnail is what makes
 * the list scannable, so it takes the leading edge and the checkbox that used to sit
 * there becomes a badge on its corner.
 *
 * **And the list is a list, not a stack of cards.** Each row bordered and filled on its
 * own read as four hundred boxes; the frames took the attention the pictures were put
 * there to get. A hairline between rows is all that separates them now, which is also
 * why this list passes no separator — the row draws its own.
 *
 * **Only the list scrolls.** Everything above it — the count of what is chosen, the
 * confirm, the search field, the two filters, the pills and how many are left — is
 * what somebody uses *while* going through four hundred rows, and all of it used to
 * scroll away with the first flick. It costs height, which is the trade: fewer rows
 * on screen, but the way to narrow them is always to hand.
 */

import { DisclosureButton } from '@allfitone/react-native/disclosure-button'
import { FoundationIcon } from '@allfitone/react-native/icons'
import { InlineAlert } from '@allfitone/react-native/inline-alert'
import { Screen } from '@allfitone/react-native/screen'
import { SelectableRow } from '@allfitone/react-native/selectable-row'
import { Text } from '@allfitone/react-native/text'
import { TextField } from '@allfitone/react-native/text-field'
import { useTheme } from '@allfitone/react-native/theme'
import { Image } from 'expo-image'
import { useFocusEffect, useRouter } from 'expo-router'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { FlatList, Pressable, StyleSheet, View } from 'react-native'

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
import { readExerciseLibrary } from '../../src/client/exercise-library'
import {
  alreadyIn,
  exerciseFilter,
  isPicked,
  offerExercisePick,
  offerable,
  pickButton,
  pickLabel,
  rememberExerciseFilter,
  replacingPosition,
  togglePick,
  type PickedMovement,
} from '../../src/client/exercise-pick'
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

  // The whole library, once for the flow rather than once per screen. Filtering it
  // here is what makes the counts instant and what lets a filter screen say how many
  // are left before it is applied.
  useEffect(() => {
    let active = true

    readExerciseLibrary(flow)
      .then((library) => {
        if (!active) return
        setMovements(library.movements)
        setMuscles(library.muscles)
        setEquipment(library.equipment)
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

  // Memoized because the list is virtualized against it: a new array on every
  // keystroke would tell the list every row changed.
  const shown = useMemo(
    () => offerable(applyFilter(movements ?? [], filter, query), already),
    [movements, filter, query, already],
  )
  const pills = useMemo(() => pillsFor(filter, muscles, equipment), [filter, muscles, equipment])

  // Declared by the editor before it pushed. Substituting is one exercise for one
  // exercise, so there is nothing to accumulate and nothing to confirm.
  const substituting = replacingPosition() !== undefined

  // Stable so a row's props do not change when another row is picked.
  const toggle = useCallback(
    (movement: Movement) => {
      const one = { id: movement.id, name: movement.name }
      if (substituting) {
        offerExercisePick([one])
        router.back()
        return
      }
      setPicked((current) => togglePick(current, one))
    },
    [substituting, router],
  )
  const open = useCallback(
    (movement: Movement) => router.push(`/routines/exercises/${movement.id}`),
    [router],
  )
  const filtering = anyFilter(filter) || query.trim() !== ''

  const confirm = () => {
    offerExercisePick(picked)
    router.back()
  }

  return (
    <Screen edges={['top', 'bottom']}>
      {/* Everything but the list is fixed. Searching, filtering and reading how many
          are left are what somebody does *while* scrolling four hundred rows, and all
          of it used to scroll away with the first flick. */}
      <View style={styles.head}>
        <ScreenHeader
          title={substituting ? 'Reemplazar ejercicio' : 'Añadir ejercicio'}
          subtitle={
            substituting
              ? 'Toca el que lo sustituye'
              : picked.length === 0
                ? 'Toca los que quieras'
                : `${picked.length} ${picked.length === 1 ? 'elegido' : 'elegidos'}`
          }
          onClose={() => router.back()}
          // No confirm while substituting: the tap on the row is the whole decision,
          // and a button that says «Añadir 1» would be lying about what happens.
          onConfirm={substituting || picked.length === 0 ? undefined : confirm}
          {...(substituting
            ? {}
            : { confirmLabel: pickLabel(picked.length), confirmText: pickButton(picked.length) })}
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
                <Text role="control" size="sm" color="accent">
                  {pill.name}
                </Text>
                <FoundationIcon
                  name="close"
                  customSize={14}
                  color={theme.color.text.accent}
                  decorative
                />
              </Pressable>
            ))}
            {/* Only past one: beside a single pill it would say the same thing twice. */}
            {pills.length > 1 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Quitar todos los filtros"
                onPress={() => change({ muscles: [], equipment: [] })}
                style={styles.clear}
              >
                <Text role="control" size="sm" color="secondary" style={styles.clearText}>
                  Quitar todos
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <Text role="eyebrow" size="xs" color="muted">
          {listSummary(shown.length, filtering).toUpperCase()}
        </Text>
      </View>

      {/* The keyboard moves the scroll inset rather than resizing the container, the
          same as every other screen here that takes typing. */}
      {/* Virtualized: four hundred rows each carrying a network image mounted at once
          made picking one take a visible moment and started four hundred downloads. */}
      <FlatList
        data={shown}
        keyExtractor={(movement) => movement.id}
        renderItem={({ item }) => (
          <MovementRow
            movement={item}
            caption={movementCaption(item, muscles, equipment)}
            selected={isPicked(picked, item.id)}
            onToggle={toggle}
            onOpen={open}
          />
        )}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        automaticallyAdjustKeyboardInsets
        // An element and never an inline component: a new component type each render
        // would remount the search field and drop the keyboard on every keystroke.
        ListFooterComponent={
          <View style={styles.foot}>
            {movements !== undefined && shown.length === 0 ? (
              <Text role="body" size="md" color="muted" align="center">
                {filtering
                  ? 'Nada con esos filtros. Quita alguno para ver más.'
                  : 'Tu rutina ya tiene todos los ejercicios del catálogo.'}
              </Text>
            ) : null}

            {movements === undefined && !failure ? (
              <Text role="body" size="md" color="muted">
                Cargando el catálogo…
              </Text>
            ) : null}

            <Text role="body" size="sm" color="muted">
              Solo el catálogo global de Allfit.
            </Text>
          </View>
        }
      />
    </Screen>
  )
}

/**
 * One row of the picker, kept apart and memoized.
 *
 * The list re-renders whenever anything on the screen changes — a keystroke, a filter,
 * another row being picked. Inline, that meant four hundred rows and four hundred
 * network images rebuilding for a tap that concerned one of them.
 */
const MovementRow = memo(function MovementRow({
  movement,
  caption,
  selected,
  onToggle,
  onOpen,
}: {
  readonly movement: Movement
  readonly caption: string
  readonly selected: boolean
  readonly onToggle: (movement: Movement) => void
  readonly onOpen: (movement: Movement) => void
}) {
  return (
    <SelectableRow
      name={movement.name}
      caption={caption}
      // Still, not playing: four hundred animations at once would cost more than the
      // recognition they buy, and one frame is enough to place the exercise.
      preview={
        <Image
          source={movement.demo_url}
          style={styles.preview}
          contentFit="contain"
          autoplay={false}
          // Names the picture for the row a recycled view is showing now, so a fast
          // scroll never leaves the previous exercise's frame behind.
          recyclingKey={movement.id}
          accessible={false}
        />
      }
      selected={selected}
      onPress={() => onToggle(movement)}
      // Choosing and reading about it are different intents, so they are different
      // targets.
      action={{
        icon: 'info',
        accessibilityLabel: `Ver el detalle de ${movement.name}`,
        onPress: () => onOpen(movement),
      }}
    />
  )
})

const styles = StyleSheet.create({
  // No gap: the rows separate themselves with a hairline, and a gap between them
  // would turn the list back into the stack of cards this stopped being.
  content: { paddingBottom: 48 },
  filters: { flexDirection: 'row', gap: 10 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  pill: {
    minHeight: 36,
    borderRadius: 999,
    borderWidth: 1,
    paddingLeft: 12,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  // A height on the text alone leaves its ink at the top of the box, which is why
  // it sat above the pills it belongs beside.
  clear: { minHeight: 36, paddingHorizontal: 4, justifyContent: 'center' },
  clearText: { textDecorationLine: 'underline' },
  preview: { width: '100%', height: '100%' },
  head: { gap: 14, paddingBottom: 14 },
  foot: { gap: 14, paddingTop: 24, alignItems: 'center' },
})
