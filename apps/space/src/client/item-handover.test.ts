import { describe, expect, test } from 'bun:test'

import { fromFood, type Food } from './capture'
import { keepItem, openItem, openedItem, settleItem, takeItemOutcome } from './item-handover'

const rice: Food = {
  id: '019f1300-0000-7000-8000-000000000301',
  name: 'Arroz blanco',
  kind: 'ingredient',
  brand: null,
  icon: 'grain',
  grams_per_ml: null,
  nutrients: [{ nutrient_code: 'energy', value_per_100g: 130, unit: 'kcal' }],
  portions: [{ label: '1 taza', grams: 160, is_default: true }],
}

describe('an item handed between the capture and its own screen (R-F4, R-A3)', () => {
  test('T-SPC-UNIT-245 an edited item comes back however the screen was left, once', () => {
    const item = fromFood(rice)
    openItem({ item, targets: [], mode: 'edit', mealType: 'dinner' })
    expect(openedItem()?.item).toBe(item)
    const more = { ...item, grams: 320 }
    keepItem(more)
    expect(takeItemOutcome()).toEqual({ kind: 'kept', item: more })
    expect(takeItemOutcome()).toBeNull()
  })

  test('T-SPC-UNIT-246 a food from the search is added only when the person says so', () => {
    const item = fromFood(rice)
    openItem({ item, targets: [], mode: 'add', mealType: 'dinner' })
    keepItem({ ...item, grams: 80 })
    expect(takeItemOutcome()).toBeNull()
    settleItem({ kind: 'added', item })
    expect(takeItemOutcome()).toEqual({ kind: 'added', item })
  })

  test('T-SPC-UNIT-247 removing or changing the food says which item, and replaces what was kept', () => {
    const item = fromFood(rice)
    openItem({ item, targets: [], mode: 'edit', mealType: 'dinner' })
    keepItem({ ...item, grams: 10 })
    settleItem({ kind: 'removed', key: item.key })
    expect(takeItemOutcome()).toEqual({ kind: 'removed', key: item.key })
  })
})
