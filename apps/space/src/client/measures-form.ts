/**
 * Weight and height, minus the rendering.
 *
 * **The value lives in canonical units and is converted only to paint it.** That is
 * the whole reason this module exists, and getting it wrong is not a rounding
 * nicety: storing what is displayed makes 74 kg → 163 lb → 73.9 kg, and somebody's
 * weight moves on its own for changing unit and coming back. So the ruler's state is
 * kilograms and centimetres, `displayIn` is a pure read, and the canonical figure
 * changes only when a finger moves the ruler.
 *
 * **Feet and inches are measured as total inches.** They are the only real problem
 * on this screen: kilos, pounds and centimetres are one number and feet-and-inches
 * are two, which breaks any control assuming a single value. Measured as total
 * inches it is an integer like any other and only the label renders `5′ 10″`, so no
 * control holds two fields that can disagree and the conversion stays a
 * multiplication.
 *
 * The factors here are for **display only**. What gets stored is computed by the
 * database from `catalog.units.to_canonical_factor`, because a factor with two homes
 * is a factor with two answers. These exist so the ruler can be drawn without a round
 * trip, and the test pins them to the same values the catalogue holds.
 *
 * Nothing is preselected in the sense that matters: the rulers are parked at 70 and
 * 170 because a ruler has to be somewhere, but continuing requires having moved both.
 * A number nobody chose cannot be the baseline every future measurement is compared
 * against — and whoever does not want to give it has Skip, which this screen offers
 * because criterion 3 asks for it.
 */

export type MassUnit = 'kg' | 'lb'
export type LengthUnit = 'cm' | 'in'
export type MeasureUnit = MassUnit | LengthUnit

export interface Scale {
  readonly min: number
  readonly max: number
  /** Every how many units a tick is labelled. */
  readonly major: number
}

/** The ranges the rulers span, in the units a person reads. */
export const SCALES: Readonly<Record<MeasureUnit, Scale>> = {
  kg: { min: 35, max: 180, major: 5 },
  lb: { min: 77, max: 397, major: 10 },
  cm: { min: 130, max: 215, major: 5 },
  in: { min: 51, max: 85, major: 12 },
}

/** What the database stores. One canonical unit per dimension, as the catalogue says. */
export const CANONICAL_MASS: MassUnit = 'kg'
export const CANONICAL_LENGTH: LengthUnit = 'cm'

/** Where the rulers are parked before anyone touches them. */
export const RESTING_WEIGHT_KG = 70
export const RESTING_HEIGHT_CM = 170

/**
 * To the canonical unit. The same numbers `catalog.units.to_canonical_factor` holds,
 * and the test asserts they agree — two homes for a factor is two answers.
 */
const TO_CANONICAL: Readonly<Record<MeasureUnit, number>> = {
  kg: 1,
  lb: 0.45359237,
  cm: 1,
  in: 2.54,
}

export function toCanonical(value: number, unit: MeasureUnit): number {
  return value * TO_CANONICAL[unit]
}

/**
 * What the ruler shows, as the integer it snaps to. A pure read of the canonical
 * figure: calling this never changes what will be stored.
 */
export function displayIn(canonical: number, unit: MeasureUnit): number {
  const scale = SCALES[unit]
  const raw = Math.round(canonical / TO_CANONICAL[unit])
  return Math.min(scale.max, Math.max(scale.min, raw))
}

/** Total inches as feet and inches, which is the only place the pair appears. */
export function formatInches(totalInches: number): string {
  const feet = Math.floor(totalInches / 12)
  const inches = totalInches % 12
  return `${feet}′ ${inches}″`
}

/** The reading and its suffix, so the screen never formats a number itself. */
export function readingFor(canonical: number, unit: MeasureUnit): { text: string; suffix: string } {
  const shown = displayIn(canonical, unit)
  if (unit === 'in') return { text: formatInches(shown), suffix: '' }
  return { text: `${shown}`, suffix: unit }
}

/** The other unit of the same dimension, which is all the toggle has to know. */
export function otherUnit(unit: MassUnit): MassUnit
export function otherUnit(unit: LengthUnit): LengthUnit
export function otherUnit(unit: MeasureUnit): MeasureUnit {
  if (unit === 'kg') return 'lb'
  if (unit === 'lb') return 'kg'
  if (unit === 'cm') return 'in'
  return 'cm'
}

export interface MeasureSubmission {
  /** Whether the rail has been moved at all. */
  touched: boolean
  submitting: boolean
  sessionExpired: boolean
}

/**
 * One measurement per screen, so one flag. It used to take both because both lived on
 * the same screen, and after the split each half was passing `true` for the other —
 * a gate that reads as if it checks something it does not.
 */
export function canSubmitMeasure({
  touched,
  submitting,
  sessionExpired,
}: MeasureSubmission): boolean {
  if (submitting || sessionExpired) return false
  return touched
}

/** What the screen sends: what she read, in the unit she read it in. */
export interface MeasureDeclaration {
  readonly value: number
  readonly unit: MeasureUnit
}

export function declarationFor(canonical: number, unit: MeasureUnit): MeasureDeclaration {
  return { value: displayIn(canonical, unit), unit }
}

/** Reopening on what was saved. An unknown unit falls back to the canonical one. */
export function unitFromSaved(
  originalUnit: string | null | undefined,
  canonicalUnit: MeasureUnit,
): MeasureUnit {
  if (originalUnit === 'kg' || originalUnit === 'lb') return originalUnit
  if (originalUnit === 'cm' || originalUnit === 'in') return originalUnit
  return canonicalUnit
}

/**
 * Every value the wheel can land on, in the unit shown.
 *
 * Built rather than stored because the run is the scale: two homes for "which numbers
 * exist" is two answers, and the one people scroll past would be the wrong one.
 */
export function runFor(unit: MeasureUnit): readonly number[] {
  const { min, max } = SCALES[unit]
  return Array.from({ length: max - min + 1 }, (_, step) => min + step)
}
