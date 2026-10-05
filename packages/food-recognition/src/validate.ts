/**
 * The answer a model gives, held to what may reach a person's diary (ADR-041 invariant 3).
 *
 * A schema only proves the answer has the right shape. The bake-off showed a model
 * returning `patac<span style="color:red">ó</span>name` — a perfectly valid string — so
 * every field is checked again here: plain-text names, plausible grams, a bounded list.
 * An item that fails is dropped rather than repaired; when nothing survives, the whole
 * answer fails, and the person searches instead.
 */

import {
  DETAIL_BOUNDS,
  DETAIL_CODES,
  FOOD_GROUPS,
  RecognitionError,
  type DetailCode,
  type FoodGroup,
  type RecognisedItem,
} from './port.js'

const MAX_ITEMS = 15
const NAME = /^\p{L}+(?: \p{L}+)*$/u

/** A name in plain letters and single spaces, 1 to 60 of them; anything else is not a name. */
export function plainName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim().replace(/\s+/g, ' ')
  return name.length >= 1 && name.length <= 60 && NAME.test(name) ? name : null
}

const within = (value: unknown, low: number, high: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high

/** A point inside the photo, or nothing: a place outside it is not a place. */
function point(value: unknown): RecognisedItem['at'] {
  if (typeof value !== 'object' || value === null) return null
  const { x, y } = value as Record<string, unknown>
  return within(x, 0, 1) && within(y, 0, 1) ? { x, y } : null
}

function group(value: unknown): FoodGroup | null {
  return FOOD_GROUPS.find((one) => one === value) ?? null
}

/** A guess is kept whole or not at all: one impossible value discredits the rest. */
function estimate(value: unknown): RecognisedItem['estimate'] {
  if (typeof value !== 'object' || value === null) return null
  const { energy, protein, carbohydrates, fat } = value as Record<string, unknown>
  if (
    !within(energy, 0, 3000) ||
    !within(protein, 0, 300) ||
    !within(carbohydrates, 0, 300) ||
    !within(fat, 0, 300)
  ) {
    return null
  }
  const detail: Partial<Record<DetailCode, number>> = {}
  for (const code of DETAIL_CODES) {
    const amount = (value as Record<string, unknown>)[code]
    if (within(amount, 0, DETAIL_BOUNDS[code])) detail[code] = amount
  }
  return { energy, protein, carbohydrates, fat, ...detail }
}

/** The items worth keeping, in the order the model gave them. */
export function keepItems(raw: unknown): RecognisedItem[] {
  if (!Array.isArray(raw)) return []
  const kept: RecognisedItem[] = []
  for (const entry of raw as unknown[]) {
    if (kept.length === MAX_ITEMS) break
    if (typeof entry !== 'object' || entry === null) continue
    const item = entry as Record<string, unknown>
    const name = plainName(item.name)
    if (!name || !within(item.grams, 1, 1500) || !within(item.confidence, 0, 1)) continue
    const units = within(item.units, 1, 50) ? Math.round(item.units) : 1
    kept.push({
      name,
      units,
      grams: Math.round(item.grams),
      confidence: item.confidence,
      at: point(item.at),
      icon: group(item.icon),
      estimate: estimate(item.estimate),
    })
  }
  return kept
}

/** A whole answer, or `RecognitionError` when nothing in it can be trusted. */
export function checkAnswer(raw: unknown): {
  readonly dish: string | null
  readonly items: RecognisedItem[]
} {
  if (typeof raw !== 'object' || raw === null) throw new RecognitionError('invalid-answer')
  const answer = raw as Record<string, unknown>
  const items = keepItems(answer.items)
  if (items.length === 0) throw new RecognitionError('nothing-recognised')
  return { dish: plainName(answer.dish), items }
}
