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
import { DISCIPLINE } from '../../../src/client/routine-draft'
import { ScreenHeader } from '../../../src/components/screen-header'

const PICTURE = 74

export default function EquipmentFilter() {
  const router = useRouter()
  const flow = useMemo(() => createSpaceContentFlow(), [])

  const [filter, setFilter] = useState<ExerciseFilter>(() => exerciseFilter())
  const [equipment, setEquipment] = useState<readonly CatalogueTerm[]>([])
  const [movements, setMovements] = useState<readonly Movement[]>([])

  useEffect(() => {
    let active = true

    Promise.all([flow.readEquipment(), flow.searchMovements(DISCIPLINE, '', [], [])])
      .then(([needed, found]) => {
        if (!active) return
        setEquipment(needed)
        setMovements(found)
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
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          title="Equipamiento"
          subtitle={
            filter.equipment.length === 0
              ? 'con qué vas a entrenar'
              : `${filter.equipment.length} ${filter.equipment.length === 1 ? 'tipo' : 'tipos'}`
          }
          onClose={() => router.back()}
          onConfirm={
            filter.equipment.length === 0
              ? undefined
              : () => change(clearFacet(filter, 'equipment'))
          }
          confirmLabel="Quitar"
          confirmText
        />

        <Text role="eyebrow" size="2xs" color="muted">
          CON QUÉ
        </Text>

        <View style={styles.grid}>
          {equipment.map((item) => {
            const picture = EQUIPMENT_PICTURES[item.code]
            return (
              <View key={item.code} style={styles.cell}>
                <SelectableTile
                  name={item.name}
                  count={countFor(movements, 'equipment', item.code)}
                  selected={isFiltered(filter, 'equipment', item.code)}
                  onPress={() => change(toggleFilter(filter, 'equipment', item.code, equipment))}
                >
                  {picture === undefined ? null : (
                    <Image source={picture} style={styles.picture} resizeMode="contain" />
                  )}
                </SelectableTile>
              </View>
            )
          })}
        </View>

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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  // Three to a row, with the two gaps taken out of the width.
  cell: { width: '31.5%' },
  picture: { width: PICTURE, height: PICTURE },
})
