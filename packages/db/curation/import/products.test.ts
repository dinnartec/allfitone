import { describe, expect, test } from 'bun:test'

import { iconFor, pickProducts, productFromOff, type OffProduct } from './products.js'

const milk: OffProduct = {
  code: '7702001042015',
  product_name: 'Whole milk',
  product_name_es: '  Leche entera ',
  brands: ['Alquería', 'Alqueria S.A.'],
  quantity: '1 L',
  serving_size: '250 ml',
  serving_quantity: 250,
  categories_tags: ['en:dairies', 'en:milks'],
  nutriments: { 'energy-kcal_100g': 62, proteins_100g: 3, carbohydrates_100g: 4.7, fat_100g: 3.4 },
}

describe('Open Food Facts products (ADR-041 as amended)', () => {
  test('T-NUT-CUR-05 a product keeps its Spanish name, first brand, pack size and serving', () => {
    expect(productFromOff(milk)).toEqual({
      barcode: '7702001042015',
      name: 'Leche entera',
      brand: 'Alquería',
      quantityLabel: '1 L',
      icon: 'dairy',
      gramsPerMl: 1,
      values: { energy: 62, protein: 3, carbohydrates: 4.7, fat: 3.4 },
      portions: [
        { label: '1 porción', grams: 250, isDefault: true },
        { label: '100 g', grams: 100, isDefault: false },
      ],
    })
  })

  test('T-NUT-CUR-06 energy in kJ is turned to kcal; with no energy at all the product is left out', () => {
    const inKj = { ...milk, nutriments: { energy_100g: 418.4, proteins_100g: 3 } }
    expect(productFromOff(inKj)?.values).toEqual({ energy: 100, protein: 3 })
    expect(productFromOff({ ...milk, nutriments: { proteins_100g: 3 } })).toBeNull()
  })

  test('T-NUT-CUR-07 what cannot be true per 100 g, a bad barcode or no name leaves it out', () => {
    expect(productFromOff({ ...milk, nutriments: { 'energy-kcal_100g': 950 } })).toBeNull()
    expect(
      productFromOff({ ...milk, nutriments: { 'energy-kcal_100g': 300, fat_100g: 120 } }),
    ).toBeNull()
    expect(
      productFromOff({
        ...milk,
        nutriments: { 'energy-kcal_100g': 300, proteins_100g: 60, carbohydrates_100g: 60 },
      }),
    ).toBeNull()
    expect(productFromOff({ ...milk, code: '12AB' })).toBeNull()
    expect(productFromOff({ ...milk, product_name: '', product_name_es: ' ' })).toBeNull()
  })

  test('T-NUT-CUR-08 a serving not in grams or millilitres is ignored, and 100 g is then the default', () => {
    const cups = { ...milk, serving_size: '1 taza', serving_quantity: 1 }
    expect(productFromOff(cups)?.portions).toEqual([
      { label: '100 g', grams: 100, isDefault: true },
    ])
  })

  test('T-NUT-CUR-09 the icon comes from the most specific category known', () => {
    expect(iconFor(['en:beverages', 'en:sodas'], 'Leche')).toBe('drink')
    expect(iconFor(['en:dairies', 'en:cheeses'], '')).toBe('cheese')
    expect(iconFor(['en:breakfast-cereals', 'en:chocolate-cereals'], '')).toBe('grain')
    expect(iconFor(['en:snacks', 'en:sweet-snacks', 'en:biscuits'], '')).toBe('cookie')
    expect(iconFor(['en:something-else'], 'Producto raro')).toBe('nutrition')
    expect(iconFor(undefined, '')).toBe('nutrition')
  })

  test('T-NUT-CUR-11 with no known category, a word of the name tells the icon', () => {
    expect(iconFor([], 'Galletas Festival fresa')).toBe('cookie')
    expect(iconFor(undefined, 'Kumis Alpina')).toBe('dairy')
    expect(iconFor([], 'Atún en aceite')).toBe('fish')
    expect(iconFor([], 'Chocolatina Jet')).toBe('sweet')
  })

  test('T-NUT-CUR-10 the same product under two barcodes is kept once, the most complete', () => {
    const bare = productFromOff({ ...milk, code: '7702001042022', serving_size: undefined })
    const full = productFromOff(milk)
    if (!bare || !full) throw new Error('both are valid products')
    expect(pickProducts([bare, full]).map((one) => one.barcode)).toEqual(['7702001042015'])
  })

  test('T-NUT-CUR-15 detail, vitamins and minerals come in grams and are kept in their own units', () => {
    const detailed = {
      ...milk,
      nutriments: {
        'energy-kcal_100g': 62,
        'saturated-fat_100g': 2.1,
        sugars_100g: 4.7,
        sodium_100g: 0.044,
        cholesterol_100g: 0.012,
        'vitamin-a_100g': 0.000046,
        calcium_100g: 0.12,
      },
    }
    expect(productFromOff(detailed)?.values).toEqual({
      energy: 62,
      saturated_fat: 2.1,
      sugars: 4.7,
      sodium: 44,
      cholesterol: 12,
      vitamin_a: 46,
      calcium: 120,
    })
  })

  test('T-NUT-CUR-16 a drink is poured: its values are per 100 ml and a millilitre weighs a gram', () => {
    expect(productFromOff(milk)?.gramsPerMl).toBe(1)
    expect(productFromOff({ ...milk, categories_tags: ['en:biscuits'] })?.gramsPerMl).toBeNull()
  })
})
