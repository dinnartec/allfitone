import { describe, expect, test } from 'bun:test'

import { FOODS, POURED, type AuthoredFood } from './foods-authored.js'
import { checkAuthored, density, normalize, per100g, recipePer100g, usdaPortions } from './foods.js'

describe('the food catalogue curation (ADR-041)', () => {
  test('T-NUT-CUR-01 names fold case, accents and spaces the way the database does', () => {
    expect(normalize('  Fríjol   Rojo ')).toBe('frijol rojo')
    expect(normalize('Ñame')).toBe('name')
  })

  test('T-NUT-CUR-02 energy comes from 1008, then 2048, then 2047; nothing missing becomes zero', () => {
    expect(
      per100g(
        new Map([
          ['1008', 130],
          ['2047', 128],
          ['1003', 2.7],
        ]),
      ),
    ).toEqual({ energy: 130, protein: 2.7 })
    expect(
      per100g(
        new Map([
          ['2048', 52],
          ['2047', 50],
        ]),
      ),
    ).toEqual({ energy: 52 })
    expect(
      per100g(
        new Map([
          ['2047', 50],
          ['1079', 0],
        ]),
      ),
    ).toEqual({ energy: 50, fiber: 0 })
    expect(per100g(new Map([['1004', 3]]))).toEqual({ fat: 3 })
  })

  test('T-NUT-CUR-03 a recipe is the sum of its parts, per 100 g of the whole, and only what every part has', () => {
    const broth = { energy: 10, protein: 1 }
    const potato = { energy: 80, protein: 2, fiber: 2 }
    // 300 g of broth and 100 g of potato: 30+80 kcal and 3+2 g of protein in 400 g.
    expect(
      recipePer100g([
        { values: broth, grams: 300 },
        { values: potato, grams: 100 },
      ]),
    ).toEqual({
      energy: 27.5,
      protein: 1.25,
    })
  })

  test('T-NUT-CUR-04 the authored list is consistent: unique names, one default portion, parts that exist', () => {
    expect(checkAuthored(FOODS, POURED)).toEqual([])
    const broken: AuthoredFood[] = [
      { name: 'Arroz', icon: 'grain', usda: 'x', portions: [{ label: '1 taza', grams: 160 }] },
      {
        name: 'arróz',
        icon: 'grain',
        usda: 'y',
        portions: [{ label: '1 taza', grams: 160, isDefault: true }],
      },
      {
        name: 'Sopa',
        icon: 'soup',
        recipe: [{ part: 'Nada', grams: 10 }],
        portions: [{ label: '1 plato', grams: 10, isDefault: true }],
      },
    ]
    expect(checkAuthored([], new Set(['Nada líquida']))).toEqual([
      'Nada líquida is poured but is not an authored food',
    ])
    expect(checkAuthored(broken)).toEqual([
      'Arroz has 0 default portions',
      'arróz repeats a name or synonym: arroz',
      'Sopa uses Nada, which is not an authored food',
    ])
  })

  test('T-NUT-CUR-12 the detail, vitamins and minerals come from their USDA ids, in their own units', () => {
    const amounts = new Map([
      ['1008', 61],
      ['1093', 43],
      ['1258', 1.86],
      ['2000', 5.05],
      ['1106', 46],
      ['1087', 113],
      ['1098', 0.025],
    ])
    expect(per100g(amounts)).toEqual({
      energy: 61,
      sodium: 43,
      saturated_fat: 1.86,
      sugars: 5.05,
      vitamin_a: 46,
      calcium: 113,
      copper: 0.025,
    })
  })

  test('T-NUT-CUR-13 household measures come from USDA in Spanish, after what a person wrote', () => {
    const rows = [
      { amount: 1, modifier: 'cup', grams: 244 },
      { amount: 1, modifier: 'fl oz', grams: 30.5 },
      { amount: 1, modifier: 'tbsp', grams: 15 },
      { amount: 0.5, modifier: 'cup, chopped', grams: 70 },
      { amount: 1, modifier: 'oz', grams: 28.35 },
      { amount: 1, modifier: 'slice', grams: 28 },
    ]
    expect(usdaPortions(rows, ['1 vaso', '1 taza'])).toEqual([
      { label: '1 cucharada', grams: 15 },
      { label: '1 tajada', grams: 28 },
    ])
  })

  test('T-NUT-CUR-14 only what is poured has a density: its cup, else water', () => {
    expect(density(true, [{ amount: 1, modifier: 'cup', grams: 244 }])).toBe(1.031)
    expect(density(true, [])).toBe(1)
    expect(density(false, [{ amount: 1, modifier: 'cup', grams: 158 }])).toBeNull()
  })
})
