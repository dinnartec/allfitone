/**
 * How much of a food, as a person types and reads it (R-F4, R-A3): «1 ½ taza», «210 ml»,
 * «0,5 lb». The nutrients always follow the grams; this is only the way in and the way
 * back out.
 *
 * The units a food offers are its own measures first — the vaso and the taza a person
 * wrote, or USDA's — then mass, which anything has, then volume, which only what is poured
 * has (its `grams_per_ml`). A cup is never a universal unit: a cup of rice and a cup of
 * milk do not weigh the same.
 *
 * Kept free of React so the test runner can hold it to that.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

type Food = AllfitV1Schemas['NutritionFood']

export type AmountMode = 'number' | 'fraction'

export interface UnitChoice {
  readonly label: string
  /** What one of this unit weighs. */
  readonly grams: number
  /** A measure of the food («taza»), which reads in the plural; not a g or an ml. */
  readonly countable: boolean
}

const GLYPHS: Readonly<Record<string, string>> = {
  '¼': '1/4',
  '½': '1/2',
  '¾': '3/4',
  '⅓': '1/3',
  '⅔': '2/3',
}
const FRACTIONS: readonly (readonly [number, string])[] = [
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [1 / 2, '½'],
  [2 / 3, '⅔'],
  [3 / 4, '¾'],
]
const MAX_AMOUNT = 100_000

const roundTo = (value: number, places: number) => {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/** «1.5», «1,5», «1/2», «1 1/2» or «1½» as a number; null when it is none of them. */
export function parseAmount(text: string): number | null {
  const plain = [...text]
    .map((letter) => (GLYPHS[letter] ? ` ${GLYPHS[letter] ?? ''}` : letter))
    .join('')
    .trim()
    .replace(/\s+/g, ' ')
  let value: number | null = null
  const decimal = /^(\d+(?:[.,]\d+)?)$/.exec(plain)
  const fraction = /^(?:(\d+) )?(\d+)\/(\d+)$/.exec(plain)
  if (decimal?.[1]) {
    value = Number(decimal[1].replace(',', '.'))
  } else if (fraction?.[2] && fraction[3] && Number(fraction[3]) > 0) {
    value = Number(fraction[1] ?? 0) + Number(fraction[2]) / Number(fraction[3])
  }
  return value !== null && Number.isFinite(value) && value > 0 && value <= MAX_AMOUNT ? value : null
}

const asNumber = (value: number) => String(roundTo(value, 2)).replace('.', ',')

/** An amount as a decimal, or as the common fraction it nearly is («1 ½»). */
export function formatAmount(value: number, mode: AmountMode): string {
  if (mode === 'number' || Number.isInteger(value)) return asNumber(value)
  const whole = Math.floor(value)
  const part = FRACTIONS.find(([share]) => Math.abs(value - whole - share) < 0.02)
  if (!part) return asNumber(value)
  return whole > 0 ? `${String(whole)} ${part[1]}` : part[1]
}

const GRAM: UnitChoice = { label: 'g', grams: 1, countable: false }
const MASS: readonly UnitChoice[] = [
  GRAM,
  { label: 'kg', grams: 1000, countable: false },
  { label: 'lb', grams: 453.59237, countable: false },
  { label: 'oz', grams: 28.349523125, countable: false },
]
const VOLUME: readonly (readonly [string, number])[] = [
  ['ml', 1],
  ['l', 1000],
  ['fl oz', 29.5735],
]

/** The units a food offers: its measures, mass, and volume when it is poured. */
export function unitChoices(food: Food | null): UnitChoice[] {
  const measures: UnitChoice[] = []
  const taken = new Set(MASS.map((one) => one.label))
  for (const portion of food?.portions ?? []) {
    const [first = '', ...rest] = portion.label.split(' ')
    const amount = parseAmount(first)
    const label = rest.join(' ').trim()
    if (!amount || !label || taken.has(label.toLowerCase())) continue
    taken.add(label.toLowerCase())
    measures.push({ label, grams: roundTo(portion.grams / amount, 3), countable: true })
  }
  const perMl = food?.grams_per_ml ?? null
  const volume =
    perMl === null
      ? []
      : VOLUME.map(([label, ml]) => ({ label, grams: roundTo(ml * perMl, 3), countable: false }))
  return [...measures, ...MASS, ...volume]
}

/** How a unit is named on its own: a measure with a capital («Vaso»), a symbol as it is («g»). */
export const unitName = (unit: UnitChoice): string =>
  unit.countable
    ? unit.label.charAt(0).toLocaleUpperCase('es-CO') + unit.label.slice(1)
    : unit.label

/** The amount when the unit changes: one of a measure, or the same food said in a symbol. */
export const switchUnit = (grams: number, next: UnitChoice): number =>
  next.countable ? 1 : roundTo(grams / next.grams, 2)

/** The grams an amount of a unit weighs, to a tenth. */
export const toGrams = (amount: number, unit: UnitChoice) => roundTo(amount * unit.grams, 1)

// Spanish plurals of a measure, word by word up to «de»: «unidad mediana» → «unidades medianas».
function plural(label: string): string {
  const words = label.split(' ')
  const stop = words.indexOf('de')
  return words
    .map((word, at) => {
      if (stop !== -1 && at >= stop) return word
      if (/ón$/.test(word)) return `${word.slice(0, -2)}ones`
      if (/z$/.test(word)) return `${word.slice(0, -1)}ces`
      return /[aeiouáéíóú]$/.test(word) ? `${word}s` : `${word}es`
    })
    .join(' ')
}

/** How the person said it: «1 ½ tazas», «210 ml». */
export function servingText(amount: number, unit: UnitChoice, mode: AmountMode): string {
  const label = unit.countable && amount > 1 ? plural(unit.label) : unit.label
  return `${formatAmount(amount, mode)} ${label}`
}

/** Grams already known, in the food's measure when they make a quarter of one, else grams. */
export function choiceFor(
  food: Food | null,
  grams: number,
): { readonly amount: number; readonly unit: UnitChoice } {
  const choices = unitChoices(food)
  for (const unit of choices.filter((one) => one.countable)) {
    const quarters = (grams / unit.grams) * 4
    if (quarters >= 1 && Math.abs(quarters - Math.round(quarters)) < 0.04) {
      return { amount: Math.round(quarters) / 4, unit }
    }
  }
  return { amount: grams, unit: GRAM }
}
