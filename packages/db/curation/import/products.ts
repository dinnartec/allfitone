/**
 * Turns Open Food Facts' Colombian products into the curation block that loads them (ADR-041
 * as amended).
 *
 * Open Food Facts is a crowd-sourced database under the ODbL, so its rows go to their own
 * tables (`nutrition.products` and children), apart from Allfit's catalogue, and the app
 * credits it wherever a product shows. Being crowd-sourced, **a row is believed only when
 * it could be true**: it needs a name, a barcode and energy per 100 g, and is left out when
 * its values cannot hold for 100 g of anything. The same product under several barcodes is
 * kept once, the most complete, and one the import no longer believes is retired.
 *
 * Values are per 100 g, or per 100 ml for drinks, which Open Food Facts mixes; a millilitre
 * is counted as a gram, close enough for milk, juice and soda.
 *
 * Run: `OFF_HITS_DIR=<pages of search hits> bun curation/import/products.ts`. It writes
 * `006_off_products.sql`, generated and committed like the food catalogue.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { normalize, UNIT, type NutrientCode, type Values } from './foods.js'

/** The fields read from an Open Food Facts product, as its search answers them. */
export interface OffProduct {
  readonly code?: string
  readonly product_name?: string
  readonly product_name_es?: string
  readonly brands?: string | readonly string[]
  readonly quantity?: string
  readonly serving_size?: string | undefined
  readonly serving_quantity?: number | string
  readonly categories_tags?: readonly string[]
  readonly nutriments?: Readonly<Record<string, number | string | undefined>>
}

export interface Portion {
  readonly label: string
  readonly grams: number
  readonly isDefault: boolean
}

export interface Product {
  readonly barcode: string
  readonly name: string
  readonly brand: string | null
  readonly quantityLabel: string | null
  readonly icon: string
  /** 1 for drinks, whose values Open Food Facts gives per 100 ml; null for what is not poured. */
  readonly gramsPerMl: number | null
  readonly values: Values
  readonly portions: readonly Portion[]
}

// Most specific first: a cheese is a dairy, a soda a beverage.
const ICONS: readonly (readonly [string, string])[] = [
  ['en:cheeses', 'cheese'],
  ['en:yogurts', 'dairy'],
  ['en:milks', 'dairy'],
  ['en:breakfast-cereals', 'grain'],
  ['en:biscuits', 'cookie'],
  ['en:cookies', 'cookie'],
  ['en:chocolates', 'sweet'],
  ['en:candies', 'sweet'],
  ['en:confectioneries', 'sweet'],
  ['en:ice-creams', 'dessert'],
  ['en:desserts', 'dessert'],
  ['en:cakes', 'cake'],
  ['en:breads', 'bread'],
  ['en:crisps', 'snack'],
  ['en:chips', 'snack'],
  ['en:salty-snacks', 'snack'],
  ['en:popcorn', 'snack'],
  ['en:waters', 'water'],
  ['en:coffees', 'coffee'],
  ['en:teas', 'coffee'],
  ['en:beers', 'wine'],
  ['en:wines', 'wine'],
  ['en:alcoholic-beverages', 'wine'],
  ['en:sodas', 'drink'],
  ['en:juices', 'drink'],
  ['en:beverages', 'drink'],
  ['en:sausages', 'ham'],
  ['en:hams', 'ham'],
  ['en:poultries', 'poultry'],
  ['en:meats', 'meat'],
  ['en:fishes', 'fish'],
  ['en:seafood', 'fish'],
  ['en:eggs', 'egg'],
  ['en:nuts', 'nut'],
  ['en:legumes', 'legume'],
  ['en:soups', 'soup'],
  ['en:pizzas', 'pizza'],
  ['en:sandwiches', 'sandwich'],
  ['en:fats', 'oil'],
  ['en:vegetable-oils', 'oil'],
  ['en:fruits', 'fruit'],
  ['en:vegetables', 'vegetable'],
  ['en:rices', 'grain'],
  ['en:pastas', 'grain'],
  ['en:cereals-and-their-products', 'grain'],
  ['en:dairies', 'dairy'],
  ['en:snacks', 'snack'],
]

// Word starts in the name, for products with no known category; specific before generic,
// so «atún en aceite» is a fish and «galleta de chocolate» a cookie.
const NAME_ICONS: readonly (readonly [string, string])[] = [
  ['atun', 'fish'],
  ['sardina', 'fish'],
  ['salmon', 'fish'],
  ['pescado', 'fish'],
  ['salchich', 'ham'],
  ['jamon', 'ham'],
  ['chorizo', 'ham'],
  ['mortadela', 'ham'],
  ['pollo', 'poultry'],
  ['carne', 'meat'],
  ['huevo', 'egg'],
  ['galleta', 'cookie'],
  ['wafer', 'cookie'],
  ['ponque', 'cake'],
  ['torta', 'cake'],
  ['helado', 'dessert'],
  ['gelatina', 'dessert'],
  ['postre', 'dessert'],
  ['arequipe', 'sweet'],
  ['chocolat', 'sweet'],
  ['bombon', 'sweet'],
  ['caramelo', 'sweet'],
  ['dulce', 'sweet'],
  ['gomita', 'sweet'],
  ['papas', 'snack'],
  ['papita', 'snack'],
  ['chips', 'snack'],
  ['platanito', 'snack'],
  ['tostacos', 'snack'],
  ['queso', 'cheese'],
  ['yogur', 'dairy'],
  ['kumis', 'dairy'],
  ['kefir', 'dairy'],
  ['leche', 'dairy'],
  ['cafe', 'coffee'],
  ['te ', 'coffee'],
  ['aromatica', 'coffee'],
  ['cerveza', 'wine'],
  ['vino', 'wine'],
  ['aguardiente', 'wine'],
  ['ron ', 'wine'],
  ['agua', 'water'],
  ['jugo', 'drink'],
  ['gaseosa', 'drink'],
  ['bebida', 'drink'],
  ['refresco', 'drink'],
  ['pan', 'bread'],
  ['tostada', 'bread'],
  ['arepa', 'bread'],
  ['cereal', 'grain'],
  ['avena', 'grain'],
  ['arroz', 'grain'],
  ['pasta', 'grain'],
  ['spaghetti', 'grain'],
  ['harina', 'grain'],
  ['granola', 'grain'],
  ['frijol', 'legume'],
  ['lenteja', 'legume'],
  ['garbanzo', 'legume'],
  ['mani', 'nut'],
  ['almendra', 'nut'],
  ['nuez', 'nut'],
  ['nueces', 'nut'],
  ['sopa', 'soup'],
  ['caldo', 'soup'],
  ['crema de', 'soup'],
  ['aceite', 'oil'],
  ['mantequilla', 'oil'],
  ['margarina', 'oil'],
  ['mayonesa', 'oil'],
  ['salsa', 'vegetable'],
  ['fruta', 'fruit'],
  ['mermelada', 'fruit'],
]

/** A DS food icon from the categories, else from the name; the generic one when neither tells. */
export function iconFor(categories: readonly string[] | undefined, name: string): string {
  const tags = new Set(categories ?? [])
  const byCategory = ICONS.find(([tag]) => tags.has(tag))?.[1]
  if (byCategory) return byCategory
  const words = ` ${normalize(name)} `
  return NAME_ICONS.find(([stem]) => words.includes(` ${stem}`))?.[1] ?? 'nutrition'
}

// Open Food Facts keeps every nutrient in grams per 100 g; the canonical unit decides the factor.
const OFF_NUTRIENT: Readonly<Record<Exclude<NutrientCode, 'energy'>, string>> = {
  protein: 'proteins_100g',
  carbohydrates: 'carbohydrates_100g',
  fat: 'fat_100g',
  fiber: 'fiber_100g',
  saturated_fat: 'saturated-fat_100g',
  trans_fat: 'trans-fat_100g',
  cholesterol: 'cholesterol_100g',
  sodium: 'sodium_100g',
  sugars: 'sugars_100g',
  vitamin_a: 'vitamin-a_100g',
  vitamin_c: 'vitamin-c_100g',
  vitamin_d: 'vitamin-d_100g',
  vitamin_e: 'vitamin-e_100g',
  vitamin_k: 'vitamin-k_100g',
  thiamin: 'vitamin-b1_100g',
  riboflavin: 'vitamin-b2_100g',
  niacin: 'vitamin-pp_100g',
  pantothenic_acid: 'pantothenic-acid_100g',
  vitamin_b6: 'vitamin-b6_100g',
  vitamin_b12: 'vitamin-b12_100g',
  folate: 'vitamin-b9_100g',
  calcium: 'calcium_100g',
  iron: 'iron_100g',
  magnesium: 'magnesium_100g',
  phosphorus: 'phosphorus_100g',
  potassium: 'potassium_100g',
  zinc: 'zinc_100g',
  selenium: 'selenium_100g',
  copper: 'copper_100g',
}
const FROM_GRAMS: Readonly<Record<string, number>> = { kcal: 1, g: 1, mg: 1000, mcg: 1_000_000 }
const round = (value: number) => Math.round(value * 1000) / 1000

function number(value: number | string | undefined): number | undefined {
  const parsed = typeof value === 'string' ? Number(value) : value
  return parsed !== undefined && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function valuesOf(nutriments: OffProduct['nutriments']): Values | null {
  const kcal = number(nutriments?.['energy-kcal_100g'])
  const kj = number(nutriments?.energy_100g)
  const energy = kcal ?? (kj === undefined ? undefined : kj / 4.184)
  if (energy === undefined || energy > 900) return null
  const values: Values = { energy: round(energy) }
  for (const [code, key] of Object.entries(OFF_NUTRIENT) as [
    Exclude<NutrientCode, 'energy'>,
    string,
  ][]) {
    const value = number(nutriments?.[key])
    if (value === undefined) continue
    if (value > 100) return null
    values[code] = round(value * (FROM_GRAMS[UNIT[code]] ?? 1))
  }
  const macros = (values.protein ?? 0) + (values.carbohydrates ?? 0) + (values.fat ?? 0)
  return macros > 105 ? null : values
}

function portionsOf(product: OffProduct): Portion[] {
  const serving = number(product.serving_quantity)
  const measured = /\b\d+(?:[.,]\d+)?\s*(g|gr|ml)\b/i.test(product.serving_size ?? '')
  if (serving !== undefined && serving > 0 && serving <= 1500 && measured && serving !== 100) {
    return [
      { label: '1 porción', grams: round(serving), isDefault: true },
      { label: '100 g', grams: 100, isDefault: false },
    ]
  }
  return [{ label: '100 g', grams: 100, isDefault: true }]
}

const trimmed = (value: string | undefined, max: number) => {
  const text = value?.replace(/\s+/g, ' ').trim() ?? ''
  return text.length > 0 && text.length <= max ? text : null
}

const POURED_TAGS = new Set([
  'en:beverages',
  'en:milks',
  'en:waters',
  'en:juices',
  'en:drinkable-yogurts',
])

/** One Open Food Facts product as Allfit keeps it, or null when it cannot be believed. */
export function productFromOff(product: OffProduct): Product | null {
  const barcode = product.code ?? ''
  if (!/^[0-9]{8,14}$/.test(barcode)) return null
  const name = trimmed(product.product_name_es, 120) ?? trimmed(product.product_name, 120)
  if (!name) return null
  const values = valuesOf(product.nutriments)
  if (!values) return null
  const brands =
    typeof product.brands === 'string' ? product.brands.split(',') : (product.brands ?? [])
  return {
    barcode,
    name,
    brand: trimmed(brands[0], 80),
    quantityLabel: trimmed(product.quantity, 40),
    icon: iconFor(product.categories_tags, name),
    gramsPerMl: (product.categories_tags ?? []).some((tag) => POURED_TAGS.has(tag)) ? 1 : null,
    values,
    portions: portionsOf(product),
  }
}

const completeness = (product: Product) =>
  Object.keys(product.values).length + product.portions.length + (product.brand ? 1 : 0)

/** One product per name and brand, the most complete; the first barcode on a tie. */
export function pickProducts(products: readonly Product[]): Product[] {
  const kept = new Map<string, Product>()
  for (const product of products) {
    const key = `${normalize(product.brand ?? '')}|${normalize(product.name)}`
    const current = kept.get(key)
    if (!current || completeness(product) > completeness(current)) kept.set(key, product)
  }
  return [...kept.values()].sort((left, right) => left.barcode.localeCompare(right.barcode))
}

const sql = (value: string | null) => (value === null ? 'null' : `'${value.replace(/'/g, "''")}'`)

function main(directory: string): void {
  const hits = readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .flatMap((file) => JSON.parse(readFileSync(join(directory, file), 'utf8')) as OffProduct[])
  const believed = hits.map(productFromOff).filter((one): one is Product => one !== null)
  const products = pickProducts(believed)

  const lines: string[] = [
    '-- Packaged products sold in Colombia, from Open Food Facts (ADR-041 as amended).',
    '--',
    '-- **Generated by `curation/import/products.ts`. Do not edit.** Data © Open Food Facts',
    '-- contributors, under the Open Database License (ODbL); each product is under the Database',
    "-- Contents License. Kept in its own tables, apart from Allfit's catalogue.",
    '--',
    '-- Idempotent: a product is matched by its barcode and its rows are rewritten.',
    '',
    '\\set ON_ERROR_STOP on',
    '',
    'begin;',
    '',
  ]
  for (const product of products) {
    lines.push(
      `insert into nutrition.products (barcode, name, brand, quantity_label, icon, grams_per_ml, status, published_at) values (` +
        `${sql(product.barcode)}, ${sql(product.name)}, ${sql(product.brand)}, ${sql(product.quantityLabel)}, ${sql(product.icon)}, ${product.gramsPerMl === null ? 'null' : String(product.gramsPerMl)}, 'published', clock_timestamp())` +
        ' on conflict on constraint uq_products_barcode do update set name = excluded.name, brand = excluded.brand,' +
        " quantity_label = excluded.quantity_label, icon = excluded.icon, grams_per_ml = excluded.grams_per_ml, status = 'published';",
    )
  }
  lines.push('')
  const barcodes = products.map((product) => sql(product.barcode)).join(', ')
  lines.push(
    `create temporary table curated_product on commit drop as select id, barcode from nutrition.products where barcode in (${barcodes});`,
    'delete from nutrition.product_nutrients where product_id in (select id from curated_product);',
    'delete from nutrition.product_portions where product_id in (select id from curated_product);',
    // A product the import no longer believes is retired, not deleted: a meal may name it.
    "update nutrition.products set status = 'deprecated' where id not in (select id from curated_product);",
    '',
  )
  const id = (barcode: string) => `(select id from curated_product where barcode = ${sql(barcode)})`
  for (const product of products) {
    for (const [code, value] of Object.entries(product.values) as [NutrientCode, number][]) {
      lines.push(
        `insert into nutrition.product_nutrients (product_id, nutrient_definition_id, value_per_100g, unit_code) ` +
          `select ${id(product.barcode)}, id, ${String(value)}, ${sql(UNIT[code])} from nutrition.nutrient_definitions where code = ${sql(code)};`,
      )
    }
    product.portions.forEach((portion, at) => {
      lines.push(
        `insert into nutrition.product_portions (product_id, label, grams, position, is_default) values (` +
          `${id(product.barcode)}, ${sql(portion.label)}, ${String(portion.grams)}, ${String(at + 1)}, ${portion.isDefault ? 'true' : 'false'});`,
      )
    })
  }
  lines.push('', 'commit;', '')
  writeFileSync(new URL('../006_off_products.sql', import.meta.url).pathname, lines.join('\n'))
  console.log(
    `Read ${String(hits.length)}, believed ${String(believed.length)}, wrote ${String(products.length)} products.`,
  )
}

if (import.meta.main) {
  const directory = process.env.OFF_HITS_DIR
  if (!directory)
    throw new Error('OFF_HITS_DIR is not set: point it at the pages of Open Food Facts search hits')
  main(directory)
}
