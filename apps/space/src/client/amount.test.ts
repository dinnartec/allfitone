import { describe, expect, test } from 'bun:test'

import {
  choiceFor,
  formatAmount,
  parseAmount,
  servingText,
  toGrams,
  switchUnit,
  unitName,
  unitChoices,
  type UnitChoice,
} from './amount'
import type { Food } from './capture'

const milk: Food = {
  id: '019f1500-0000-7000-8000-000000000101',
  name: 'Leche entera',
  kind: 'ingredient',
  brand: null,
  icon: 'dairy',
  grams_per_ml: 1.031,
  nutrients: [{ nutrient_code: 'energy', value_per_100g: 61, unit: 'kcal' }],
  portions: [
    { label: '1 vaso', grams: 240, is_default: true },
    { label: '1/2 vaso', grams: 120, is_default: false },
    { label: '1 taza', grams: 244, is_default: false },
  ],
}
const avocado: Food = {
  ...milk,
  name: 'Aguacate',
  grams_per_ml: null,
  portions: [{ label: '1/4 unidad', grams: 50, is_default: true }],
}
const unit = (choices: readonly UnitChoice[], label: string) =>
  choices.find((choice) => choice.label === label)

describe('an amount, typed as a number or a fraction, in a unit the food allows', () => {
  test('T-SPC-UNIT-233 an amount is read as a decimal, a fraction or a mixed number', () => {
    expect(parseAmount('1.5')).toBe(1.5)
    expect(parseAmount('1,5')).toBe(1.5)
    expect(parseAmount('1/2')).toBe(0.5)
    expect(parseAmount(' 1 1/2 ')).toBe(1.5)
    expect(parseAmount('1½')).toBe(1.5)
    expect(parseAmount('¾')).toBe(0.75)
    for (const wrong of ['', '0', 'mucho', '1/0', '-2', '1//2'])
      expect(parseAmount(wrong)).toBeNull()
  })

  test('T-SPC-UNIT-234 an amount is written as a number, or as the fraction it nearly is', () => {
    expect(formatAmount(1.5, 'number')).toBe('1,5')
    expect(formatAmount(2, 'number')).toBe('2')
    expect(formatAmount(1.5, 'fraction')).toBe('1 ½')
    expect(formatAmount(0.333, 'fraction')).toBe('⅓')
    expect(formatAmount(3, 'fraction')).toBe('3')
    expect(formatAmount(0.4, 'fraction')).toBe('0,4')
  })

  test('T-SPC-UNIT-235 the units are the food’s own measures, then mass, then volume when it is poured', () => {
    const choices = unitChoices(milk)
    expect(choices.map((choice) => choice.label)).toEqual([
      'vaso',
      'taza',
      'g',
      'kg',
      'lb',
      'oz',
      'ml',
      'l',
      'fl oz',
    ])
    expect(unit(choices, 'ml')?.grams).toBe(1.031)
    expect(unitChoices(avocado).map((choice) => choice.label)).toEqual([
      'unidad',
      'g',
      'kg',
      'lb',
      'oz',
    ])
    expect(unit(unitChoices(avocado), 'unidad')?.grams).toBe(200)
  })

  test('T-SPC-UNIT-236 an amount in a unit becomes grams, and reads as the person said it', () => {
    const cup = unit(unitChoices(milk), 'taza')
    const ml = unit(unitChoices(milk), 'ml')
    if (!cup || !ml) throw new Error('milk has cups and millilitres')
    expect(toGrams(1.5, cup)).toBe(366)
    expect(toGrams(210, ml)).toBe(216.5)
    expect(servingText(1.5, cup, 'fraction')).toBe('1 ½ tazas')
    expect(servingText(1, cup, 'number')).toBe('1 taza')
    expect(servingText(210, ml, 'number')).toBe('210 ml')
  })

  test('T-SPC-UNIT-243 a measure is named with a capital, a unit symbol never', () => {
    expect(unitChoices(milk).map(unitName)).toEqual([
      'Vaso',
      'Taza',
      'g',
      'kg',
      'lb',
      'oz',
      'ml',
      'l',
      'fl oz',
    ])
  })

  test('T-SPC-UNIT-244 choosing a measure means one of it; choosing a symbol keeps the amount', () => {
    const choices = unitChoices(milk)
    const cup = unit(choices, 'taza')
    const ml = unit(choices, 'ml')
    const grams = unit(choices, 'g')
    if (!cup || !ml || !grams) throw new Error('milk has cups, millilitres and grams')
    expect(switchUnit(240, cup)).toBe(1)
    expect(switchUnit(240, grams)).toBe(240)
    expect(switchUnit(240, ml)).toBe(232.78)
  })

  test('T-SPC-UNIT-237 grams already known are shown in the measure they fit, else in grams', () => {
    expect(choiceFor(milk, 480)).toMatchObject({ amount: 2, unit: { label: 'vaso' } })
    expect(choiceFor(milk, 100)).toMatchObject({ amount: 100, unit: { label: 'g' } })
    expect(choiceFor(avocado, 50)).toMatchObject({ amount: 0.25, unit: { label: 'unidad' } })
    expect(choiceFor(null, 30)).toMatchObject({ amount: 30, unit: { label: 'g' } })
  })
})
