/**
 * One food of the meal, on a screen of its own (R-F4, R-A3).
 *
 * How much and in what unit, the four figures, and the full label with its vitamins and
 * minerals. It was a sheet; a sheet lifted by the keyboard stayed afloat on device, and a
 * label that opens is long enough to want a whole screen anyway.
 *
 * - **Editing** an item of the meal keeps each change as it happens: the back gesture is
 *   as good as «Listo». «Quitar» and «Cambiar alimento» say so to the capture.
 * - **Adding** a food from the search adds nothing until «Añadir».
 *
 * The capture holds the meal; `item-handover` carries this one item across and back.
 */

import { Button } from '@allfitone/react-native/button'
import { IconButton } from '@allfitone/react-native/icon-button'
import { Screen } from '@allfitone/react-native/screen'
import { Text } from '@allfitone/react-native/text'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { keepItem, openedItem, settleItem } from '../../src/client/item-handover'
import type { CaptureItem } from '../../src/client/capture'
import { FoodTile, ItemEditor } from '../../src/components/capture-sheets'

export default function ItemScreen() {
  const router = useRouter()
  const [opened] = useState(openedItem)
  const [item, setItem] = useState<CaptureItem | undefined>(opened?.item)

  // Reached with nothing handed over (a reload, a stale link): there is nothing to show.
  useEffect(() => {
    if (!opened) router.back()
  }, [opened, router])
  if (!opened || !item) return null

  const editing = opened.mode === 'edit'
  const change = (next: CaptureItem) => {
    setItem(next)
    keepItem(next)
  }
  const leave = (outcome: Parameters<typeof settleItem>[0]) => {
    settleItem(outcome)
    router.back()
  }

  return (
    <Screen edges={['top', 'bottom']} padded={false}>
      <View style={styles.header}>
        <IconButton
          icon={editing ? 'back' : 'close'}
          accessibilityLabel={editing ? 'Volver a la comida' : 'Cerrar sin añadir'}
          onPress={() => router.back()}
        />
        <FoodTile icon={item.icon} food={item.food} size={40} />
        <View style={styles.grow}>
          <Text role="control" size="lg" accessibilityRole="header" numberOfLines={1}>
            {item.name}
          </Text>
          {editing ? (
            // Only the words answer: the space beside them is not a button.
            <Pressable
              accessibilityRole="button"
              onPress={() => leave({ kind: 'change-food', item })}
              hitSlop={6}
              style={styles.link}
            >
              <Text role="control" size="sm" color="accent">
                {item.food ? 'Cambiar alimento' : 'Elegir alimento'}
              </Text>
            </Pressable>
          ) : item.food?.brand ? (
            <Text role="body" size="sm" color="secondary" numberOfLines={1}>
              {item.food.brand}
            </Text>
          ) : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}
      >
        <ItemEditor item={item} targets={opened.targets} onChange={change} />
        {item.food?.kind === 'product' ? (
          <Text role="body" size="xs" color="muted">
            Datos de Open Food Facts (ODbL)
          </Text>
        ) : null}
      </ScrollView>

      <View style={styles.foot}>
        {editing ? (
          <>
            <Button label="Listo" onPress={() => router.back()} />
            <Button
              label="Quitar de la comida"
              variant="ghost"
              onPress={() => leave({ kind: 'removed', key: item.key })}
            />
          </>
        ) : (
          <Button
            label={`Añadir a la ${opened.mealName}`}
            disabled={item.grams <= 0}
            onPress={() => leave({ kind: 'added', item })}
          />
        )}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  grow: { flex: 1, gap: 2 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  link: { alignSelf: 'flex-start' },
  content: { paddingHorizontal: 20, paddingBottom: 24, gap: 14 },
  foot: { paddingHorizontal: 20, paddingTop: 10, gap: 6 },
})
