/**
 * What a person eats, and the goal they keep (N-1e to N-6, ADR-027, ADR-040).
 *
 * Same split as the rest of the client: this holds what must be true and stays loadable
 * by the test runner; `nutrition-transport.ts` holds the fetch.
 *
 * **Nothing here turns a missing nutrient into zero.** A total is the sum of what was
 * written, and a nutrient nobody wrote is absent; the day's «restante» is computed
 * against the goal only where both exist.
 *
 * **A record keeps its key until it lands**, held per draft, so a retry over a dropped
 * connection answers the meal already recorded instead of logging it twice. A correction
 * is a new command every time, and names the revision it read in `If-Match`.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'
import type { CommandHeaders } from '@allfitone/contracts/commands'

export type NutritionMeal = AllfitV1Schemas['NutritionMeal']
export type MealItem = NutritionMeal['items'][number]
export type MealType = AllfitV1Schemas['MealType']
export type NutrientCode = AllfitV1Schemas['NutrientCode']
export type MealCreate = AllfitV1Schemas['NutritionMealCreate']
/** `remove_photo` defaults to false in the contract, so leaving it out is allowed. */
export type MealPatch = Omit<AllfitV1Schemas['NutritionMealPatch'], 'remove_photo'> & {
  readonly remove_photo?: boolean
}
export type MealPage = AllfitV1Schemas['NutritionMealPage']
export type DailySummary = AllfitV1Schemas['NutritionDailySummary']
export type DailySummaryPage = AllfitV1Schemas['NutritionDailySummaryPage']
export type GoalTarget = AllfitV1Schemas['NutritionGoalTarget']
export type GoalVersion = AllfitV1Schemas['NutritionGoalVersion']
export type Goals = AllfitV1Schemas['NutritionGoals']
export type GoalDecision = AllfitV1Schemas['NutritionGoalDecision']
export type FoodPage = AllfitV1Schemas['NutritionFoodPage']
export type FrequentFoodPage = AllfitV1Schemas['NutritionFrequentFoodPage']
export type RecognitionResult = AllfitV1Schemas['NutritionRecognition']
export type RecognitionConsentState = AllfitV1Schemas['NutritionRecognitionConsent']
export type PhotoUpload = AllfitV1Schemas['NutritionPhotoUpload']

/** The nutrients a goal can set; the rest are read, never aimed at. */
export const NUTRIENTS = ['energy', 'protein', 'carbohydrates', 'fat', 'fiber', 'water'] as const
export type GoalNutrient = (typeof NUTRIENTS)[number]
export type NutrientUnit = AllfitV1Schemas['NutrientValue']['unit']
export type NutrientGroup = 'macro' | 'detail' | 'vitamin' | 'mineral'

// Names, units and groups as `nutrition.nutrient_definitions` has them; exhaustive by type,
// so a nutrient added to the contract cannot be left without one.
export const NUTRIENT_NAMES: Readonly<Record<NutrientCode, string>> = {
  energy: 'Energía',
  protein: 'Proteína',
  carbohydrates: 'Carbohidratos',
  fat: 'Grasa',
  fiber: 'Fibra',
  water: 'Agua',
  saturated_fat: 'Grasas saturadas',
  trans_fat: 'Grasas trans',
  cholesterol: 'Colesterol',
  sodium: 'Sodio',
  sugars: 'Azúcares',
  vitamin_a: 'Vitamina A',
  vitamin_c: 'Vitamina C',
  vitamin_d: 'Vitamina D',
  vitamin_e: 'Vitamina E',
  vitamin_k: 'Vitamina K',
  thiamin: 'Vitamina B1',
  riboflavin: 'Vitamina B2',
  niacin: 'Vitamina B3',
  pantothenic_acid: 'Vitamina B5',
  vitamin_b6: 'Vitamina B6',
  vitamin_b12: 'Vitamina B12',
  folate: 'Folato',
  calcium: 'Calcio',
  iron: 'Hierro',
  magnesium: 'Magnesio',
  phosphorus: 'Fósforo',
  potassium: 'Potasio',
  zinc: 'Zinc',
  selenium: 'Selenio',
  copper: 'Cobre',
}
export const UNIT_OF: Readonly<Record<NutrientCode, NutrientUnit>> = {
  energy: 'kcal',
  protein: 'g',
  carbohydrates: 'g',
  fat: 'g',
  fiber: 'g',
  water: 'ml',
  saturated_fat: 'g',
  trans_fat: 'g',
  cholesterol: 'mg',
  sodium: 'mg',
  sugars: 'g',
  vitamin_a: 'mcg',
  vitamin_c: 'mg',
  vitamin_d: 'mcg',
  vitamin_e: 'mg',
  vitamin_k: 'mcg',
  thiamin: 'mg',
  riboflavin: 'mg',
  niacin: 'mg',
  pantothenic_acid: 'mg',
  vitamin_b6: 'mg',
  vitamin_b12: 'mcg',
  folate: 'mcg',
  calcium: 'mg',
  iron: 'mg',
  magnesium: 'mg',
  phosphorus: 'mg',
  potassium: 'mg',
  zinc: 'mg',
  selenium: 'mcg',
  copper: 'mg',
}
export const NUTRIENT_GROUP: Readonly<Record<NutrientCode, NutrientGroup>> = {
  energy: 'macro',
  protein: 'macro',
  carbohydrates: 'macro',
  fat: 'macro',
  fiber: 'macro',
  water: 'macro',
  saturated_fat: 'detail',
  trans_fat: 'detail',
  cholesterol: 'detail',
  sodium: 'detail',
  sugars: 'detail',
  vitamin_a: 'vitamin',
  vitamin_c: 'vitamin',
  vitamin_d: 'vitamin',
  vitamin_e: 'vitamin',
  vitamin_k: 'vitamin',
  thiamin: 'vitamin',
  riboflavin: 'vitamin',
  niacin: 'vitamin',
  pantothenic_acid: 'vitamin',
  vitamin_b6: 'vitamin',
  vitamin_b12: 'vitamin',
  folate: 'vitamin',
  calcium: 'mineral',
  iron: 'mineral',
  magnesium: 'mineral',
  phosphorus: 'mineral',
  potassium: 'mineral',
  zinc: 'mineral',
  selenium: 'mineral',
  copper: 'mineral',
}
/**
 * Daily values for adults, Resolución 810 de 2021 art. 15 (table 9, needs; table 10,
 * maximums for saturated and trans fat, cholesterol and sodium). Sugars and water have none.
 */
const DAILY_VALUES: Readonly<Partial<Record<NutrientCode, number>>> = {
  energy: 2000,
  protein: 50,
  carbohydrates: 300,
  fat: 66,
  fiber: 28,
  saturated_fat: 20,
  trans_fat: 2.2,
  cholesterol: 300,
  sodium: 2000,
  vitamin_a: 800,
  vitamin_c: 83,
  vitamin_d: 15,
  vitamin_e: 9,
  vitamin_k: 65,
  thiamin: 1.15,
  riboflavin: 1.2,
  niacin: 15,
  pantothenic_acid: 5,
  vitamin_b6: 1.3,
  vitamin_b12: 2.4,
  folate: 400,
  calcium: 1000,
  iron: 20,
  magnesium: 310,
  phosphorus: 700,
  potassium: 4700,
  zinc: 11,
  selenium: 70,
  copper: 0.9,
}

const isGoalNutrient = (code: NutrientCode): code is GoalNutrient =>
  NUTRIENTS.some((one) => one === code)

const UNIT_TEXT: Readonly<Record<NutrientUnit, string>> = {
  kcal: 'kcal',
  g: 'g',
  mg: 'mg',
  mcg: 'µg',
  ml: 'ml',
}

/** «4,1 g», «0,32 mg», «2.456 kcal»: two decimals under one, one under ten, none above. */
export function nutrientFigure(value: number | undefined, unit: NutrientUnit): string {
  if (value === undefined) return '—'
  const digits = value < 1 ? 2 : value < 10 ? 1 : 0
  const text = value.toLocaleString('es-CO', { maximumFractionDigits: digits })
  return `${text} ${UNIT_TEXT[unit]}`
}

/** What a nutrient is measured against: the person's goal for it, else the norm, else none. */
export function dailyReference(code: NutrientCode, targets: readonly GoalTarget[]): number | null {
  const target = isGoalNutrient(code)
    ? targets.find((one) => one.nutrient_code === code)
    : undefined
  return target ? goalFigure(target).value : (DAILY_VALUES[code] ?? null)
}
/** Where a card is narrow, as the macro cards are: «Carbohidratos» would wrap. */
export const NUTRIENT_SHORT_NAMES: Readonly<Record<NutrientCode, string>> = {
  ...NUTRIENT_NAMES,
  carbohydrates: 'Carbos',
}
export const MEAL_TYPES: readonly MealType[] = ['breakfast', 'lunch', 'dinner', 'snack', 'other']
export const MEAL_NAMES: Readonly<Record<MealType, string>> = {
  breakfast: 'Desayuno',
  lunch: 'Almuerzo',
  dinner: 'Cena',
  snack: 'Snack',
  other: 'Otra',
}
const ARTICLED: Readonly<Record<MealType, string>> = {
  breakfast: 'el desayuno',
  lunch: 'el almuerzo',
  dinner: 'la cena',
  snack: 'el snack',
  other: 'esta comida',
}
/** «¿Eliminar la cena?»: Spanish gives each meal its own article, and «Otra» has none. */
export const mealWithArticle = (type: MealType): string => ARTICLED[type]

const FEMININE: ReadonlySet<MealType> = new Set(['dinner', 'other'])
/** «Snack guardado», «Cena guardada»: the notice agrees with the meal; «Otra» reads «Comida». */
export const mealSaved = (type: MealType): string =>
  `${type === 'other' ? 'Comida' : MEAL_NAMES[type]} ${FEMININE.has(type) ? 'guardada' : 'guardado'}`

/** «Añadir al snack», «Añadir a la cena»: «a» + «el» contracts to «al». */
export const addToMeal = (type: MealType): string =>
  `Añadir ${ARTICLED[type].replace(/^el /, 'al ').replace(/^(la|esta) /, 'a $1 ')}`

const figure = (value: number) => Math.round(value).toLocaleString('es-CO')

/** The strong validator a correction carries, rebuilt from the meal's own revision. */
export const etagOf = (meal: Pick<NutritionMeal, 'id' | 'revision_number'>) =>
  `"nutrition-meal:${meal.id}:r${String(meal.revision_number)}"`

export type Totals = Partial<Record<NutrientCode, number>>

/** Each nutrient summed over what was written; one nobody wrote is absent, not zero. */
/** What a meal weighed, from the items recorded in grams. */
export const mealGrams = (items: readonly MealItem[]): number =>
  items.reduce(
    (sum, item) => sum + (item.quantity_unit === 'g' && item.quantity !== null ? item.quantity : 0),
    0,
  )

export function mealTotals(items: readonly MealItem[]): Totals {
  const totals: Totals = {}
  for (const item of items) {
    for (const nutrient of item.nutrients) {
      totals[nutrient.nutrient_code] = (totals[nutrient.nutrient_code] ?? 0) + nutrient.value
    }
  }
  return totals
}

/** What the day recorded of one nutrient; a day with nothing of it ate none of it. */
export function eatenFor(summary: DailySummary | undefined, code: NutrientCode): number {
  return summary?.nutrient_totals.find((total) => total.nutrient_code === code)?.value ?? 0
}

/** The figure a goal is read against: its exact value, its bound, or a range's top. */
export function goalFigure(target: GoalTarget): { readonly value: number; readonly label: string } {
  switch (target.mode) {
    case 'exact':
      return { value: target.exact ?? 0, label: figure(target.exact ?? 0) }
    case 'minimum':
      return { value: target.minimum ?? 0, label: `mín. ${figure(target.minimum ?? 0)}` }
    case 'maximum':
      return { value: target.maximum ?? 0, label: `máx. ${figure(target.maximum ?? 0)}` }
    case 'range':
      return {
        value: target.maximum ?? 0,
        label: `${figure(target.minimum ?? 0)}–${figure(target.maximum ?? 0)}`,
      }
  }
}

/** What is left against the goal, never below zero, and how much of it was eaten. */
export function remainingFor(
  target: GoalTarget,
  eaten: number,
): { readonly left: number; readonly share: number } {
  const { value } = goalFigure(target)
  if (value <= 0) return { left: 0, share: 1 }
  return {
    left: Math.max(0, Math.round(value - eaten)),
    share: Math.min(1, Math.round((eaten / value) * 100) / 100),
  }
}

/**
 * The line under a macro card's eaten figure: what it is measured against.
 * «De mín. 120 g» reads with the figure above it — 100 g, de mín. 120 g — and stands
 * on its own line, so it starts with a capital.
 */
export function goalLine(goal: GoalTarget | undefined, unit: string): string {
  return goal ? `De ${goalFigure(goal).label} ${unit}` : 'Sin meta'
}

/** Where the day stands against an energy range, and the arc that draws it. */
export type RangeProgress = {
  /** Where the eaten, the minimum and the maximum fall on the arc, from 0 to 1. */
  readonly eatenAt: number
  readonly lowAt: number
  readonly highAt: number
} & (
  | { readonly state: 'below'; readonly fromLow: number; readonly fromHigh: number }
  | { readonly state: 'within'; readonly fromHigh: number }
  | { readonly state: 'above'; readonly over: number }
)

/**
 * A range goal against what was eaten; null for any other kind of goal.
 *
 * The arc puts the maximum at four fifths of its length, so a day that goes past the
 * range still has somewhere to be drawn instead of pinning at the end.
 */
export function rangeProgress(target: GoalTarget, eaten: number): RangeProgress | null {
  if (target.mode !== 'range' || target.minimum === null || target.maximum === null) return null
  const low = target.minimum
  const high = target.maximum
  const length = high / 0.8
  const at = (value: number) => (length <= 0 ? 0 : Math.min(1, Math.max(0, value / length)))
  const marks = { eatenAt: at(eaten), lowAt: at(low), highAt: at(high) }
  if (eaten < low) {
    return {
      ...marks,
      state: 'below',
      fromLow: Math.round(low - eaten),
      fromHigh: Math.round(high - eaten),
    }
  }
  if (eaten <= high) return { ...marks, state: 'within', fromHigh: Math.round(high - eaten) }
  return { ...marks, state: 'above', over: Math.round(eaten - high) }
}

const localHour = (iso: string, timeZone: string) =>
  Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(
      new Date(iso),
    ),
  )

/** The meal the hour is asking for, and what the day still has room for. */
export function mealPrompt(
  now: string,
  timeZone: string,
  left: Partial<Record<'energy' | 'protein', number | null>>,
  logged: readonly MealType[] = [],
): { readonly type: MealType; readonly title: string; readonly detail: string | null } {
  const hour = localHour(now, timeZone)
  const byHour: MealType =
    hour < 11 ? 'breakfast' : hour < 16 ? 'lunch' : hour < 19 ? 'snack' : 'dinner'
  const [type, title]: readonly [MealType, string] =
    byHour !== 'snack' && logged.includes(byHour)
      ? ['snack', '¿Comiste algo más?']
      : hour < 11
        ? ['breakfast', '¿Qué desayunaste?']
        : hour < 16
          ? ['lunch', '¿Qué almorzaste?']
          : hour < 19
            ? ['snack', '¿Qué comiste?']
            : ['dinner', '¿Qué cenaste?']
  const parts = [
    typeof left.energy === 'number' ? `${figure(left.energy)} kcal` : null,
    typeof left.protein === 'number' ? `${figure(left.protein)} g de proteína` : null,
  ].filter((part): part is string => part !== null)
  return { type, title, detail: parts.length > 0 ? `Restante: ${parts.join(' · ')}` : null }
}

/** The mean over the days with something recorded: an empty day is no evidence. */
export function averageOfLogged(
  days: readonly DailySummary[],
  code: NutrientCode,
): { readonly value: number | null; readonly days: number } {
  const logged = days.filter((one) => one.meal_count > 0)
  const values = logged
    .map((one) => one.nutrient_totals.find((total) => total.nutrient_code === code)?.value)
    .filter((value): value is number => value !== undefined)
  if (values.length === 0) return { value: null, days: logged.length }
  return {
    value: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
    days: logged.length,
  }
}

const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const dateOf = (iso: string) => {
  const [year = 1970, month = 1, day = 1] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

/** «Hoy», «Ayer», «Domingo 27». */
export function dayTitle(date: string, today: string): string {
  const days = Math.round((dateOf(today).getTime() - dateOf(date).getTime()) / 86_400_000)
  if (days === 0) return 'Hoy'
  if (days === 1) return 'Ayer'
  const at = dateOf(date)
  return `${WEEKDAYS[at.getUTCDay()] ?? ''} ${String(at.getUTCDate())}`
}

/** Days before today with nothing recorded: one is named, several are counted. */
export function emptyDaysNote(days: readonly DailySummary[], today: string): string | null {
  const empty = days.filter((one) => one.meal_count === 0 && one.local_date < today)
  const [only] = empty
  if (!only) return null
  if (empty.length > 1) return `${String(empty.length)} días sin registro: no cuentan como cero.`
  const weekday = WEEKDAYS[dateOf(only.local_date).getUTCDay()]?.toLowerCase() ?? ''
  return `El ${weekday} no registraste nada: no cuenta como cero.`
}

/** The day before and after taking one meal out of it, for what both recorded. */
export function dayAfterDeleting(
  summary: DailySummary | undefined,
  meal: NutritionMeal,
): Partial<Record<NutrientCode, { readonly before: number; readonly after: number }>> {
  const removed = mealTotals(meal.items)
  const outcome: Partial<Record<NutrientCode, { before: number; after: number }>> = {}
  for (const total of summary?.nutrient_totals ?? []) {
    const minus = removed[total.nutrient_code]
    if (minus === undefined) continue
    outcome[total.nutrient_code] = {
      before: Math.round(total.value),
      after: Math.max(0, Math.round(total.value - minus)),
    }
  }
  return outcome
}

// ———————————————————————————————————————— the goal form (N-6)

export type FormMode = 'exact' | 'minimum' | 'maximum' | 'range' | 'none'
export interface FormTarget {
  readonly mode: FormMode
  /** The exact value or the minimum. */
  readonly low: number | null
  /** The maximum. */
  readonly high: number | null
}
export type GoalForm = Readonly<Record<GoalNutrient, FormTarget>>

/** The form's targets as the contract takes them; «sin meta» leaves the nutrient out. */
export function targetsFromForm(form: GoalForm): GoalTarget[] {
  const targets: GoalTarget[] = []
  for (const code of NUTRIENTS) {
    const { mode, low, high } = form[code]
    const base = {
      nutrient_code: code,
      unit: UNIT_OF[code],
      minimum: null,
      maximum: null,
      exact: null,
    }
    if (mode === 'exact' && low !== null) targets.push({ ...base, mode, exact: low } as GoalTarget)
    if (mode === 'minimum' && low !== null)
      targets.push({ ...base, mode, minimum: low } as GoalTarget)
    if (mode === 'maximum' && high !== null)
      targets.push({ ...base, mode, maximum: high } as GoalTarget)
    if (mode === 'range' && low !== null && high !== null) {
      targets.push({ ...base, mode, minimum: low, maximum: high } as GoalTarget)
    }
  }
  return targets
}

/** A published goal opened in the form: what it has not, it has no goal for. */
export function formFromGoal(targets: readonly GoalTarget[]): GoalForm {
  const form = {} as Record<NutrientCode, FormTarget>
  for (const code of NUTRIENTS) {
    const target = targets.find((one) => one.nutrient_code === code)
    form[code] = !target
      ? { mode: 'none', low: null, high: null }
      : target.mode === 'exact'
        ? { mode: 'exact', low: target.exact, high: null }
        : target.mode === 'maximum'
          ? { mode: 'maximum', low: null, high: target.maximum }
          : { mode: target.mode, low: target.minimum, high: target.maximum }
  }
  return form
}

// ———————————————————————————————————————— the flow

export interface NutritionTransport {
  recordMeal(command: CommandHeaders, meal: MealCreate): Promise<NutritionMeal>
  readMeal(mealId: string): Promise<NutritionMeal>
  listMeals(from: string, to: string): Promise<MealPage>
  reviseMeal(
    command: CommandHeaders,
    mealId: string,
    ifMatch: string,
    patch: MealPatch,
  ): Promise<NutritionMeal>
  deleteMeal(command: CommandHeaders, mealId: string): Promise<void>
  readDays(from: string, to: string, timezone: string): Promise<DailySummaryPage>
  readGoals(): Promise<Goals>
  publishGoal(command: CommandHeaders, targets: readonly GoalTarget[]): Promise<GoalVersion>
  decideGoal(
    command: CommandHeaders,
    goalVersionId: string,
    decision: 'accepted' | 'rejected',
  ): Promise<GoalDecision>
  searchFoods(query: string): Promise<FoodPage>
  frequentFoods(): Promise<FrequentFoodPage>
  recognize(photo: PhotoUpload): Promise<RecognitionResult>
  readConsent(): Promise<RecognitionConsentState>
  acceptConsent(command: CommandHeaders, version: string): Promise<RecognitionConsentState>
}

export interface NutritionFlow {
  /** `draft` names what is being saved, so a retry reuses its key and records it once. */
  recordMeal(draft: string, meal: MealCreate): Promise<NutritionMeal>
  readMeal(mealId: string): Promise<NutritionMeal>
  listMeals(from: string, to: string): Promise<MealPage>
  /** Corrects the meal as it was read; a 409 means it changed somewhere else. */
  reviseMeal(read: NutritionMeal, patch: MealPatch): Promise<NutritionMeal>
  deleteMeal(mealId: string): Promise<void>
  readDays(from: string, to: string, timezone: string): Promise<DailySummaryPage>
  readGoals(): Promise<Goals>
  publishGoal(targets: readonly GoalTarget[]): Promise<GoalVersion>
  decideGoal(goalVersionId: string, decision: 'accepted' | 'rejected'): Promise<GoalDecision>
  searchFoods(query: string): Promise<FoodPage>
  frequentFoods(): Promise<FrequentFoodPage>
  /** Nothing is stored: the person reviews what comes back and saves a meal (ADR-041). */
  recognize(photo: PhotoUpload): Promise<RecognitionResult>
  readConsent(): Promise<RecognitionConsentState>
  acceptConsent(version: string): Promise<RecognitionConsentState>
}

export function createNutritionFlow(dependencies: {
  readonly transport: NutritionTransport
  readonly newCommand: () => CommandHeaders
}): NutritionFlow {
  const { transport, newCommand } = dependencies
  // Held until the command lands: creating twice, deleting twice or deciding twice is
  // never what a retry over a dropped connection means.
  const held = new Map<string, CommandHeaders>()
  const once = async <T>(id: string, send: (command: CommandHeaders) => Promise<T>): Promise<T> => {
    const command = held.get(id) ?? newCommand()
    held.set(id, command)
    const answer = await send(command)
    held.delete(id)
    return answer
  }

  return {
    recordMeal: (draft, meal) =>
      once(`record:${draft}`, (command) => transport.recordMeal(command, meal)),
    readMeal: (mealId) => transport.readMeal(mealId),
    listMeals: (from, to) => transport.listMeals(from, to),
    reviseMeal: (read, patch) => transport.reviseMeal(newCommand(), read.id, etagOf(read), patch),
    deleteMeal: (mealId) =>
      once(`delete:${mealId}`, (command) => transport.deleteMeal(command, mealId)),
    readDays: (from, to, timezone) => transport.readDays(from, to, timezone),
    readGoals: () => transport.readGoals(),
    publishGoal: (targets) => transport.publishGoal(newCommand(), targets),
    decideGoal: (goalVersionId, decision) =>
      once(`decide:${goalVersionId}`, (command) =>
        transport.decideGoal(command, goalVersionId, decision),
      ),
    searchFoods: (query) => transport.searchFoods(query),
    frequentFoods: () => transport.frequentFoods(),
    recognize: (photo) => transport.recognize(photo),
    readConsent: () => transport.readConsent(),
    acceptConsent: (version) =>
      once(`consent:${version}`, (command) => transport.acceptConsent(command, version)),
  }
}

// ———————————————————————————————————————— the meal form (N-2c, N-4d)

/** Fibre and water are offered on demand: most meals record neither. */
export type Extra = 'fiber' | 'water'
export interface FormItem {
  readonly key: string
  readonly name: string
  /** Grams, as typed. */
  readonly quantity: string
  readonly values: Partial<Record<NutrientCode, string>>
  readonly extras: readonly Extra[]
}

export const emptyItem = (key: string): FormItem => ({
  key,
  name: '',
  quantity: '',
  values: {},
  extras: [],
})

const typed = (value: number) => String(value).replace('.', ',')
const parsed = (text: string | undefined): number | null => {
  if (text === undefined || text.trim() === '') return null
  const value = Number(text.trim().replace(',', '.'))
  return Number.isFinite(value) && value >= 0 ? value : null
}

/** A meal in the form: each value as it was written, and nothing it did not have. */
export function formFromMeal(meal: NutritionMeal): { readonly items: readonly FormItem[] } {
  return {
    items: meal.items.map((item) => {
      const values: Partial<Record<NutrientCode, string>> = {}
      for (const nutrient of item.nutrients) values[nutrient.nutrient_code] = typed(nutrient.value)
      return {
        key: `item-${String(item.position)}`,
        name: item.name,
        quantity: item.quantity === null ? '' : typed(item.quantity),
        values,
        extras: (['fiber', 'water'] as const).filter((extra) => values[extra] !== undefined),
      }
    }),
  }
}

/** The form's items as the contract takes them; an item without a name is not one. */
export function itemsFromForm(items: readonly FormItem[]): MealItem[] {
  return items
    .filter((item) => item.name.trim() !== '')
    .map((item, index) => {
      const quantity = parsed(item.quantity)
      return {
        position: index + 1,
        name: item.name.trim(),
        quantity: quantity !== null && quantity > 0 ? quantity : null,
        quantity_unit: quantity !== null && quantity > 0 ? 'g' : null,
        nutrients: NUTRIENTS.flatMap((code) => {
          const value = parsed(item.values[code])
          return value === null ? [] : [{ nutrient_code: code, value, unit: UNIT_OF[code] }]
        }),
      } as MealItem
    })
}

/** What the meal adds up to while it is typed. */
export const formTotals = (items: readonly FormItem[]): Totals => mealTotals(itemsFromForm(items))

// ———————————————————————————————————————— a proposal (N-3b)

const UNIT_LABEL = { kcal: 'kcal', g: 'g', mg: 'mg', mcg: 'µg', ml: 'ml' } as const

/** «2.300 kcal», «mín. 150 g», «220–260 g». */
export function targetText(target: GoalTarget): string {
  return `${goalFigure(target).label} ${UNIT_LABEL[target.unit]}`
}

const sameTarget = (one: GoalTarget, other: GoalTarget) =>
  one.mode === other.mode &&
  one.minimum === other.minimum &&
  one.maximum === other.maximum &&
  one.exact === other.exact

/** What a nutrient is now against what the proposal would make it. */
export function compareTarget(
  now: GoalTarget | undefined,
  proposed: GoalTarget | undefined,
): string {
  if (!now && proposed) return `Nueva · ${targetText(proposed)}`
  if (now && !proposed) return `${targetText(now)} → Sin meta`
  if (!now || !proposed) return 'Sin meta'
  if (sameTarget(now, proposed)) return `${targetText(now)} · sin cambio`
  return `${goalFigure(now).label} → ${targetText(proposed)}`
}
