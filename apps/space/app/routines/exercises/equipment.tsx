/**
 * Filtrar por equipamiento, en su propia pantalla.
 *
 * A grid of pictures rather than a row of words: a barbell is faster to find as a
 * barbell than as the word «barra», and nine of them in chips above the list took
 * room the list needed.
 *

 * The number on each tile is **how many exercises that equipment has**, not how many
 * would survive the rest of the filter. A tile that counted the intersection would
 * read zero across half the grid the moment anything else was on, and the number is
 * there to say what is behind the tile.
 *
 * Equipment describes **compatibility**, never inventory or availability — that is
 * `HU-SP-066`, criterion 1, and it is why nothing here asks what somebody owns.
 *
 * The button at the bottom says how many exercises are left before it is pressed,
 * which is only possible because the catalogue is filtered in memory.
 */

import { Button } from '@allfitone/react-native/button'
import { Screen } from '@allfitone/react-native/screen'
import { SelectableTile } from '@allfitone/react-native/selectable-tile'
import { Text } from '@allfitone/react-native/text'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Image, ScrollView, StyleSheet, View } from 'react-native'

import type { CatalogueTerm, Movement } from '../../../src/client/content'
import { createSpaceContentFlow } from '../../../src/client/content-transport'
import { EQUIPMENT_PICTURES } from '../../../src/client/equipment-pictures'
import { readExerciseLibrary } from '../../../src/client/exercise-library'
import {
  applyFilter,
  clearFacet,
  countFor,
  isFiltered,
  resultLabel,
  toggleFilter,
  type ExerciseFilter,
} from '../../../src/client/exercise-catalogue'
import { exerciseFilter, rememberExerciseFilter } from '../../../src/client/exercise-pick'
import { ScreenHeader } from '../../../src/components/screen-header'

const PER_ROW = 3

/**
 * Explicit rows, not a wrapped grid.
 *
 * In a `flexWrap` container Yoga sizes each item on its own, so `alignItems: stretch`
 * does not give a line one height: a tile whose name takes two lines grew and the two
 * beside it stayed short. A row that does not wrap does stretch its children.
 */
function rowsOf<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  const rows: T[][] = []
  for (let at = 0; at < items.length; at += size) rows.push(items.slice(at, at + size))
  return rows
}

export default function EquipmentFilter() {
  const router = useRouter()
  const flow = useMemo(() => createSpaceContentFlow(), [])

  const [filter, setFilter] = useState<ExerciseFilter>(() => exerciseFilter())
  const [equipment, setEquipment] = useState<readonly CatalogueTerm[]>([])
  const [movements, setMovements] = useState<readonly Movement[]>([])

  useEffect(() => {
    let active = true

    readExerciseLibrary(flow)
      .then((library) => {
        if (!active) return
        setEquipment(library.equipment)
        setMovements(library.movements)
      })
      .catch(() => undefined)

    return () => {
      active = false
    }
  }, [flow])

  const change = (next: ExerciseFilter) => {
    setFilter(next)
    rememberExerciseFilter(next)
  }

  const left = applyFilter(movements, { muscles: [], equipment: filter.equipment })

  return (
    <Screen edges={['top', 'bottom']}>
      {/* Outside the scroll: the way out and the way to undo must not be something
          somebody has to scroll back up to find. */}
      <View style={styles.head}>
        <ScreenHeader
          title="Equipamiento"
          subtitle={
            filter.equipment.length === 0
              ? 'Con qué vas a entrenar'
              : `${filter.equipment.length} ${filter.equipment.length === 1 ? 'tipo' : 'tipos'}`
          }
          onClose={() => router.back()}
          onConfirm={
            filter.equipment.length === 0
              ? undefined
              : () => change(clearFacet(filter, 'equipment'))
          }
          confirmLabel="Quitar"
          confirmText="Quitar"
        />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text role="eyebrow" size="2xs" color="muted">
          CON QUÉ
        </Text>

        {rowsOf(equipment, PER_ROW).map((row, index) => (
          <View key={row[0]?.code ?? index} style={styles.row}>
            {row.map((item) => {
              const picture = EQUIPMENT_PICTURES[item.code]
              return (
                <SelectableTile
                  key={item.code}
                  style={styles.tile}
                  name={item.name}
                  count={countFor(movements, 'equipment', item.code)}
                  selected={isFiltered(filter, 'equipment', item.code)}
                  onPress={() => change(toggleFilter(filter, 'equipment', item.code, equipment))}
                >
                  {picture === undefined ? null : (
                    <Image source={picture} style={styles.picture} resizeMode="cover" />
                  )}
                </SelectableTile>
              )
            })}
            {/* The last row keeps its columns rather than spreading two tiles across three. */}
            {Array.from({ length: PER_ROW - row.length }, (_, gap) => (
              <View key={`gap-${gap}`} style={styles.tile} />
            ))}
          </View>
        ))}

        <Text role="body" size="xs" color="muted">
          Dice con qué es compatible un ejercicio, no qué hay en tu gimnasio.
        </Text>
      </ScrollView>

      <Button
        label={resultLabel(left.length)}
        disabled={left.length === 0}
        onPress={() => router.back()}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  // Clear of the button, which floats over the scroll rather than scrolling with it.
  content: { gap: 12, paddingBottom: 72 },
  head: { paddingBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'stretch', gap: 9 },
  // Equal columns, and equal heights because the row does not wrap.
  tile: { flex: 1 },
  // The tile owns the box; this only fills it.
  picture: { width: '100%', height: '100%' },
})
