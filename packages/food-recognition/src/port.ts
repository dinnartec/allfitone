/**
 * What recognising a meal means to Allfit, in Allfit's words (ADR-041).
 *
 * A recogniser looks at a photo and says which foods it sees and how much: a name, how
 * many pieces, the grams and how sure it is. **Nothing else.** Nutrients never come from
 * here; the catalogue gives them. That keeps a model swappable — another vendor's adapter
 * answers the same three things — and keeps a model from inventing a number that ends up
 * in someone's diary.
 *
 * The port test from AGENTS.md: an adapter for any vision vendor could be written without
 * touching this file.
 */

/** The DS food icons (`@allfitone/icons`): the group a recognised food belongs to. */
export const FOOD_GROUPS = [
  'egg',
  'dairy',
  'grain',
  'bread',
  'sandwich',
  'meat',
  'poultry',
  'fish',
  'ham',
  'fruit',
  'banana',
  'citrus',
  'grape',
  'vegetable',
  'salad',
  'greens',
  'legume',
  'nut',
  'soup',
  'coffee',
  'drink',
  'water',
  'sweet',
  'cookie',
  'dessert',
  'cake',
  'pizza',
  'burger',
  'snack',
  'oil',
  'wine',
  'cheese',
] as const
export type FoodGroup = (typeof FOOD_GROUPS)[number]

/** The model's own guess for the portion it sees: used only when no catalogue food matches. */
/**
 * The detail an estimate may add, each nutrient in its canonical unit (g, mg or mcg) for
 * the portion, with the most a plate of up to 1.5 kg could hold.
 */
export const DETAIL_BOUNDS = {
  fiber: 100,
  saturated_fat: 150,
  trans_fat: 50,
  cholesterol: 3000,
  sodium: 10_000,
  sugars: 300,
  vitamin_a: 10_000,
  vitamin_c: 2000,
  vitamin_d: 250,
  vitamin_e: 1000,
  vitamin_k: 5000,
  thiamin: 100,
  riboflavin: 100,
  niacin: 500,
  pantothenic_acid: 200,
  vitamin_b6: 100,
  vitamin_b12: 1000,
  folate: 5000,
  calcium: 5000,
  iron: 100,
  magnesium: 2000,
  phosphorus: 5000,
  potassium: 15_000,
  zinc: 100,
  selenium: 1000,
  copper: 20,
} as const
export type DetailCode = keyof typeof DETAIL_BOUNDS
export const DETAIL_CODES = Object.keys(DETAIL_BOUNDS) as DetailCode[]

/** Energy and macros always, as a whole; the detail only where the model said it. */
export interface Estimate extends Partial<Readonly<Record<DetailCode, number>>> {
  readonly energy: number
  readonly protein: number
  readonly carbohydrates: number
  readonly fat: number
}

export interface RecognisedItem {
  readonly name: string
  readonly units: number
  readonly grams: number
  readonly confidence: number
  /** Roughly where it sits in the photo, 0 to 1 from the top left; null when not said. */
  readonly at: { readonly x: number; readonly y: number } | null
  readonly icon: FoodGroup | null
  /** For the grams seen. ADR-041 §1 as amended: only when the catalogue has no food. */
  readonly estimate: Estimate | null
}

export interface Recognition {
  /** The dish when it has a name of its own («ajiaco», «bandeja paisa»); null otherwise. */
  readonly dish: string | null
  /** Every visible component on its own, even when the dish was recognised. */
  readonly items: readonly RecognisedItem[]
  /** The exact model that answered, for the meal to record (ADR-041 §6). */
  readonly model: string
}

export interface FoodRecognizer {
  /** A sanitised JPEG in, what it shows out. Fails closed with `RecognitionError`. */
  recognize(jpeg: Uint8Array, signal?: AbortSignal): Promise<Recognition>
}

export type RecognitionFailure = 'unavailable' | 'invalid-answer' | 'nothing-recognised'

/** The vendor's own errors never cross this line: they are normalised into these three. */
export class RecognitionError extends Error {
  readonly failure: RecognitionFailure

  constructor(failure: RecognitionFailure, cause?: unknown) {
    super(`food recognition failed: ${failure}`, { cause })
    this.name = 'RecognitionError'
    this.failure = failure
  }
}
