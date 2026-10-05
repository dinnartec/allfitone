/**
 * Turns the authored foods into the curation block that loads the catalogue (ADR-041).
 *
 * Two sources meet here: `foods-authored.ts`, where a person wrote the Spanish, the
 * synonyms, the portions and which USDA food each one is; and USDA FoodData Central's SR
 * Legacy CSV files (CC0), where every nutrient comes from. **The join is checked rather
 * than assumed**: a description USDA does not have, a repeated name or a recipe part that
 * is not authored stops the run, so no food reaches the catalogue with someone else's
 * values.
 *
 * Energy is read from 1008, then 2048, then 2047, the order USDA's own documentation
 * gives. A nutrient USDA does not report is left out, never written as zero; a recipe only
 * carries the nutrients every one of its parts has.
 *
 * Run: `USDA_SR_DIR=<unzipped SR Legacy> bun curation/import/foods.ts`. It writes
 * `005_food_catalogue.sql`, generated and committed, so what runs against a real database
 * is reviewable as a diff.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  FOODS,
  POURED,
  type AuthoredFood,
  type RecipeFood,
  type UsdaFood,
} from './foods-authored.js'

// Each nutrient's canonical unit, as `nutrition.nutrient_definitions` has it; USDA reports
// every one of these in that same unit, so nothing is converted.
export const UNIT = {
  energy: 'kcal',
  protein: 'g',
  carbohydrates: 'g',
  fat: 'g',
  fiber: 'g',
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
} as const satisfies Record<string, string>
export type NutrientCode = keyof typeof UNIT
export type Values = Partial<Record<NutrientCode, number>>

const CODES = Object.keys(UNIT) as NutrientCode[]
const USDA_ID: Readonly<Record<Exclude<NutrientCode, 'energy'>, string>> = {
  protein: '1003',
  carbohydrates: '1005',
  fat: '1004',
  fiber: '1079',
  saturated_fat: '1258',
  trans_fat: '1257',
  cholesterol: '1253',
  sodium: '1093',
  sugars: '2000',
  vitamin_a: '1106',
  vitamin_c: '1162',
  vitamin_d: '1114',
  vitamin_e: '1109',
  vitamin_k: '1185',
  thiamin: '1165',
  riboflavin: '1166',
  niacin: '1167',
  pantothenic_acid: '1170',
  vitamin_b6: '1175',
  vitamin_b12: '1178',
  folate: '1177',
  calcium: '1087',
  iron: '1089',
  magnesium: '1090',
  phosphorus: '1091',
  potassium: '1092',
  zinc: '1095',
  selenium: '1103',
  copper: '1098',
}

/** The same fold as `nutrition.normalize_food_name`. */
export function normalize(name: string): string {
  const from = 'áàäâéèëêíìïîóòöôúùüûñç'
  const to = 'aaaaeeeeiiiioooouuuunc'
  return [...name.trim().toLowerCase()]
    .map((letter) => {
      const at = from.indexOf(letter)
      return at === -1 ? letter : (to[at] ?? letter)
    })
    .join('')
    .replace(/\s+/g, ' ')
}

// Three decimals: a micronutrient such as copper lives in hundredths of a milligram.
const round = (value: number) => Math.round(value * 1000) / 1000

/** A USDA food's values per 100 g, from its nutrient amounts keyed by USDA nutrient id. */
export function per100g(amounts: ReadonlyMap<string, number>): Values {
  const values: Values = {}
  const energy = amounts.get('1008') ?? amounts.get('2048') ?? amounts.get('2047')
  if (energy !== undefined) values.energy = round(energy)
  for (const [code, id] of Object.entries(USDA_ID) as [Exclude<NutrientCode, 'energy'>, string][]) {
    const amount = amounts.get(id)
    if (amount !== undefined) values[code] = round(amount)
  }
  return values
}

/** A recipe per 100 g of the whole: the sum of its parts, for what every part reports. */
export function recipePer100g(
  parts: readonly { readonly values: Values; readonly grams: number }[],
): Values {
  const total = parts.reduce((sum, part) => sum + part.grams, 0)
  const values: Values = {}
  for (const code of CODES) {
    if (!parts.every((part) => part.values[code] !== undefined)) continue
    const sum = parts.reduce((acc, part) => acc + ((part.values[code] ?? 0) * part.grams) / 100, 0)
    values[code] = round((sum / total) * 100)
  }
  return values
}

/** One household measure of a USDA food, from `food_portion.csv`. */
export interface UsdaPortion {
  readonly amount: number
  readonly modifier: string
  readonly grams: number
}

// Only measures that read plainly in Spanish; ounces, pounds and fluid ounces are units
// the app offers anyway, and «cup, chopped» is a cup of something cut, not of the food.
const MEASURE: Readonly<Record<string, string>> = {
  cup: 'taza',
  'cup (8 fl oz)': 'taza',
  'cup (1 NLEA serving)': 'taza',
  tbsp: 'cucharada',
  tablespoon: 'cucharada',
  tsp: 'cucharadita',
  slice: 'tajada',
  piece: 'pieza',
  small: 'unidad pequeña',
  medium: 'unidad mediana',
  large: 'unidad grande',
}

const amountLabel = (amount: number) =>
  amount === 0.5 ? '1/2' : amount === 0.25 ? '1/4' : String(amount)

/** The USDA measures a food gains, in Spanish, leaving out what the authored list names. */
export function usdaPortions(
  rows: readonly UsdaPortion[],
  authored: readonly string[],
): { label: string; grams: number }[] {
  const taken = new Set(authored.map(normalize))
  const portions: { label: string; grams: number }[] = []
  for (const row of rows) {
    const measure = MEASURE[row.modifier]
    if (!measure || row.grams <= 0 || ![0.25, 0.5, 1].includes(row.amount)) continue
    const label = `${amountLabel(row.amount)} ${measure}`
    if (taken.has(normalize(label))) continue
    taken.add(normalize(label))
    portions.push({ label, grams: round(row.grams) })
  }
  return portions
}

/** What a millilitre weighs, for what is poured: from its cup, else as water. */
export function density(poured: boolean, rows: readonly UsdaPortion[]): number | null {
  if (!poured) return null
  const cup = rows.find((row) => MEASURE[row.modifier] === 'taza' && row.amount > 0)
  if (!cup) return 1
  const perMl = cup.grams / cup.amount / 236.588
  return perMl >= 0.1 && perMl <= 3 ? round(perMl) : 1
}

const isRecipe = (food: AuthoredFood): food is RecipeFood => 'recipe' in food

/** Every inconsistency in the authored list; empty when it can be loaded. */
export function checkAuthored(
  foods: readonly AuthoredFood[],
  poured: ReadonlySet<string> = new Set(),
): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  const ingredients = new Set(foods.filter((food) => !isRecipe(food)).map((food) => food.name))
  for (const food of foods) {
    const defaults = food.portions.filter((portion) => portion.isDefault).length
    if (defaults !== 1) problems.push(`${food.name} has ${String(defaults)} default portions`)
    for (const term of [food.name, ...(food.aliases ?? [])]) {
      const key = normalize(term)
      if (seen.has(key)) problems.push(`${food.name} repeats a name or synonym: ${key}`)
      seen.add(key)
    }
    if (isRecipe(food)) {
      for (const part of food.recipe) {
        if (!ingredients.has(part.part))
          problems.push(`${food.name} uses ${part.part}, which is not an authored food`)
      }
    }
  }
  const names = new Set(foods.map((food) => food.name))
  for (const name of poured) {
    if (!names.has(name)) problems.push(`${name} is poured but is not an authored food`)
  }
  return problems
}

/** A minimal reader for USDA's CSV: quoted fields, commas, no embedded newlines. */
function rows(path: string): Record<string, string>[] {
  const [header = '', ...lines] = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
  const split = (line: string) =>
    [...line.matchAll(/"((?:[^"]|"")*)"|([^,]+)|(?<=,)(?=,|$)/g)].map((m) =>
      (m[1] ?? m[2] ?? '').replace(/""/g, '"'),
    )
  const names = split(header)
  return lines.map((line) =>
    Object.fromEntries(split(line).map((value, at) => [names[at] ?? '', value])),
  )
}

const sql = (value: string) => `'${value.replace(/'/g, "''")}'`

function main(directory: string): void {
  const problems = checkAuthored(FOODS, POURED)
  if (problems.length > 0)
    throw new Error(`The authored foods are inconsistent:\n${problems.join('\n')}`)

  const byDescription = new Map(
    rows(join(directory, 'food.csv')).map((row) => [row.description ?? '', row.fdc_id ?? '']),
  )
  const wanted = new Set<string>()
  for (const food of FOODS) {
    if (isRecipe(food)) continue
    const id = byDescription.get(food.usda)
    if (!id) throw new Error(`USDA has no food described «${food.usda}» (for ${food.name})`)
    wanted.add(id)
  }
  const amounts = new Map<string, Map<string, number>>()
  for (const row of rows(join(directory, 'food_nutrient.csv'))) {
    const id = row.fdc_id ?? ''
    if (!wanted.has(id)) continue
    const map = amounts.get(id) ?? new Map<string, number>()
    map.set(row.nutrient_id ?? '', Number(row.amount))
    amounts.set(id, map)
  }

  const measures = new Map<string, UsdaPortion[]>()
  for (const row of rows(join(directory, 'food_portion.csv'))) {
    const id = row.fdc_id ?? ''
    if (!wanted.has(id)) continue
    const list = measures.get(id) ?? []
    list.push({
      amount: Number(row.amount),
      modifier: row.modifier ?? '',
      grams: Number(row.gram_weight),
    })
    measures.set(id, list)
  }

  const measuresOf = (food: AuthoredFood) =>
    isRecipe(food) ? [] : (measures.get(byDescription.get(food.usda) ?? '') ?? [])

  const values = new Map<string, Values>()
  const references = new Map<string, string>()
  for (const food of FOODS.filter((one): one is UsdaFood => !isRecipe(one))) {
    const id = byDescription.get(food.usda) ?? ''
    references.set(food.name, id)
    values.set(food.name, per100g(amounts.get(id) ?? new Map()))
  }
  for (const food of FOODS.filter(isRecipe)) {
    values.set(
      food.name,
      recipePer100g(
        food.recipe.map((part) => ({ values: values.get(part.part) ?? {}, grams: part.grams })),
      ),
    )
  }

  const lines: string[] = [
    '-- The food catalogue (ADR-041): the foods, their synonyms, nutrients per 100 g, portions',
    '-- and recipes.',
    '--',
    '-- **Generated by `curation/import/foods.ts`. Do not edit.** The Spanish and the portions',
    '-- live in `curation/import/foods-authored.ts`, where a person wrote them; every nutrient',
    '-- comes from USDA FoodData Central SR Legacy (CC0, «Data from USDA FoodData Central»).',
    '-- Recipes carry the sum of their parts. Foods marked approximate in the authored file are',
    '-- estimates for a nutritionist to review.',
    '--',
    '-- Idempotent: a food is matched by its normalised name and its rows are rewritten.',
    '',
    '\\set ON_ERROR_STOP on',
    '',
    'begin;',
    '',
  ]
  for (const food of FOODS) {
    const recipe = isRecipe(food)
    const perMl = density(POURED.has(food.name), measuresOf(food))
    lines.push(
      `insert into nutrition.foods (name, kind, source, source_ref, icon, grams_per_ml, status, published_at) values (${sql(food.name)}, ` +
        `${recipe ? "'dish', 'allfit_recipe', null" : `'ingredient', 'usda', ${sql(references.get(food.name) ?? '')}`}, ${sql(food.icon)}, ${perMl === null ? 'null' : String(perMl)}, 'published', clock_timestamp())` +
        " on conflict on constraint uq_foods_name do update set kind = excluded.kind, source = excluded.source, source_ref = excluded.source_ref, icon = excluded.icon, grams_per_ml = excluded.grams_per_ml, status = 'published';",
    )
  }
  lines.push('')
  const names = FOODS.map((food) => sql(normalize(food.name))).join(', ')
  lines.push(
    `create temporary table curated_food on commit drop as select id, name from nutrition.foods where name_normalized in (${names});`,
  )
  for (const table of ['food_aliases', 'food_nutrients', 'food_portions']) {
    lines.push(`delete from nutrition.${table} where food_id in (select id from curated_food);`)
  }
  lines.push(
    'delete from nutrition.food_recipe_parts where dish_id in (select id from curated_food);',
    '',
  )

  const id = (name: string) => `(select id from curated_food where name = ${sql(name)})`
  for (const food of FOODS) {
    for (const alias of food.aliases ?? []) {
      lines.push(
        `insert into nutrition.food_aliases (food_id, alias) values (${id(food.name)}, ${sql(alias)});`,
      )
    }
    const foodValues = values.get(food.name) ?? {}
    for (const code of CODES) {
      const value = foodValues[code]
      if (value === undefined) continue
      lines.push(
        `insert into nutrition.food_nutrients (food_id, nutrient_definition_id, value_per_100g, unit_code) ` +
          `select ${id(food.name)}, id, ${String(value)}, ${sql(UNIT[code])} from nutrition.nutrient_definitions where code = ${sql(code)};`,
      )
    }
    const extra = usdaPortions(
      measuresOf(food),
      food.portions.map((portion) => portion.label),
    )
    const portions = [
      ...food.portions,
      ...extra.map((one) => ({ ...one, isDefault: false })),
    ].slice(0, 20)
    portions.forEach((portion, at) => {
      lines.push(
        `insert into nutrition.food_portions (food_id, label, grams, position, is_default) values (` +
          `${id(food.name)}, ${sql(portion.label)}, ${String(portion.grams)}, ${String(at + 1)}, ${portion.isDefault ? 'true' : 'false'});`,
      )
    })
    if (isRecipe(food)) {
      food.recipe.forEach((part, at) => {
        lines.push(
          `insert into nutrition.food_recipe_parts (dish_id, part_food_id, grams, position) values (` +
            `${id(food.name)}, ${id(part.part)}, ${String(part.grams)}, ${String(at + 1)});`,
        )
      })
    }
  }
  lines.push('', 'commit;', '')
  writeFileSync(new URL('../005_food_catalogue.sql', import.meta.url).pathname, lines.join('\n'))
  console.log(`Wrote ${String(FOODS.length)} foods.`)
}

if (import.meta.main) {
  const directory = process.env.USDA_SR_DIR
  if (!directory)
    throw new Error('USDA_SR_DIR is not set: point it at the unzipped SR Legacy CSV directory')
  main(directory)
}
