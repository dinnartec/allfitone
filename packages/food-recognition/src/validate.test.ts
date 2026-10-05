import { describe, expect, test } from 'bun:test'

import { RecognitionError } from './port.js'
import { checkAnswer, keepItems, plainName } from './validate.js'

describe('what a model may put in a diary (ADR-041)', () => {
  test('T-REC-UNIT-01 a name is plain letters and single spaces, accents welcome', () => {
    expect(plainName('  Patacón ')).toBe('Patacón')
    expect(plainName('caldo   de ajiaco')).toBe('caldo de ajiaco')
    expect(plainName('patac<span style="color:red">ó</span>name')).toBeNull()
    expect(plainName('arroz 2')).toBeNull()
    expect(plainName('')).toBeNull()
    expect(plainName(42)).toBeNull()
    expect(plainName('a'.repeat(61))).toBeNull()
  })

  test('T-REC-UNIT-02 an item with a broken name, impossible grams or confidence is dropped, not repaired', () => {
    expect(
      keepItems([
        { name: 'arepa', units: 2, grams: 160, confidence: 0.9 },
        { name: 'patac<b>ó</b>n', units: 1, grams: 90, confidence: 0.8 },
        { name: 'sopa', units: 1, grams: 0, confidence: 0.8 },
        { name: 'caldo', units: 1, grams: 1800, confidence: 0.8 },
        { name: 'huevo', units: 1, grams: 50, confidence: 1.4 },
        'nada',
      ]),
    ).toEqual([
      {
        name: 'arepa',
        units: 2,
        grams: 160,
        confidence: 0.9,
        at: null,
        icon: null,
        estimate: null,
      },
    ])
  })

  test('T-REC-UNIT-03 units out of range count as one piece, and grams round', () => {
    expect(keepItems([{ name: 'arroz', units: 0, grams: 129.6, confidence: 0.7 }])).toEqual([
      {
        name: 'arroz',
        units: 1,
        grams: 130,
        confidence: 0.7,
        at: null,
        icon: null,
        estimate: null,
      },
    ])
  })

  test('T-REC-UNIT-08 a place inside the photo is kept; one outside it is no place', () => {
    const at = (value: unknown) =>
      keepItems([{ name: 'arroz', units: 1, grams: 100, confidence: 0.7, at: value }])[0]?.at
    expect(at({ x: 0.3, y: 0.62 })).toEqual({ x: 0.3, y: 0.62 })
    expect(at({ x: 1.4, y: 0.5 })).toBeNull()
    expect(at('centro')).toBeNull()
  })

  test('T-REC-UNIT-04 at most fifteen items survive', () => {
    const many = Array.from({ length: 20 }, () => ({
      name: 'arroz',
      units: 1,
      grams: 100,
      confidence: 0.5,
    }))
    expect(keepItems(many)).toHaveLength(15)
  })

  test('T-REC-UNIT-05 an answer with nothing trustworthy fails, and a bad dish name is just no dish', () => {
    expect(() =>
      checkAnswer({ dish: 'ajiaco', items: [{ name: '<x>', units: 1, grams: 9, confidence: 1 }] }),
    ).toThrow(new RecognitionError('nothing-recognised'))
    expect(() => checkAnswer('texto')).toThrow(new RecognitionError('invalid-answer'))
    expect(
      checkAnswer({
        dish: 'ajia<co>',
        items: [{ name: 'papa', units: 1, grams: 60, confidence: 0.8 }],
      }).dish,
    ).toBeNull()
  })

  test('T-REC-UNIT-09 the food group is one of the DS food icons, or nothing', () => {
    const icon = (value: unknown) =>
      keepItems([{ name: 'cereal', units: 1, grams: 30, confidence: 0.7, icon: value }])[0]?.icon
    expect(icon('grain')).toBe('grain')
    expect(icon('rocket')).toBeNull()
  })

  test('T-REC-UNIT-10 an estimate is kept only when every value is plausible', () => {
    const estimate = (value: unknown) =>
      keepItems([{ name: 'cereal', units: 1, grams: 30, confidence: 0.7, estimate: value }])[0]
        ?.estimate
    expect(estimate({ energy: 114, protein: 2, carbohydrates: 25, fat: 1 })).toEqual({
      energy: 114,
      protein: 2,
      carbohydrates: 25,
      fat: 1,
    })
    expect(estimate({ energy: 9000, protein: 2, carbohydrates: 25, fat: 1 })).toBeNull()
    expect(estimate({ energy: 114, protein: -1, carbohydrates: 25, fat: 1 })).toBeNull()
    expect(estimate('mucho')).toBeNull()
  })

  test('T-REC-UNIT-11 the detail of an estimate is kept nutrient by nutrient, each within its bound', () => {
    const [item] = keepItems([
      {
        name: 'cereal de chocolate',
        units: 1,
        grams: 30,
        confidence: 0.8,
        estimate: {
          energy: 117,
          protein: 2,
          carbohydrates: 25,
          fat: 1,
          sodium: 150,
          sugars: 11,
          iron: 4.5,
          vitamin_c: -3,
          potassium: 999_999,
          nonsense: 4,
        },
      },
    ])
    expect(item?.estimate).toEqual({
      energy: 117,
      protein: 2,
      carbohydrates: 25,
      fat: 1,
      sodium: 150,
      sugars: 11,
      iron: 4.5,
    })
  })
})
