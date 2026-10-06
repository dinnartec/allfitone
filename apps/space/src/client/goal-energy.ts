/**
 * What a nutrition goal adds up to, as the goal screen draws it (N-6d).
 *
 * Each macro shows its share of the day's energy — a ring with «26 % de kcal», a bar
 * split by colour — and the editor heads each one with its kilocalories. A range counts
 * at its middle, which is what somebody aiming at 220–260 g is aiming at; a nutrient
 * without a goal counts as nothing; and without an energy goal there is no share to
 * draw, because a percentage of nothing would be a number somebody trusts.
 *
 * Also here: where a nutrient starts and how it moves between kinds of target, taken
 * out of the screen so they can be tested.
 */

import type { FormMode, FormTarget, GoalForm, GoalNutrient } from './nutrition'

/** Atwater's factors: what a gram of each macro gives. Fibre and water give none here. */
export const KCAL_PER_GRAM = { protein: 4, carbohydrates: 4, fat: 9 } as const
export type Macro = keyof typeof KCAL_PER_GRAM
export const MACROS: readonly Macro[] = ['protein', 'carbohydrates', 'fat']

const isMacro = (code: GoalNutrient): code is Macro => code in KCAL_PER_GRAM

/** Where a nutrient starts when it first gets a goal, how far one press moves it, and its top. */
export const START: Readonly<
  Record<GoalNutrient, { readonly value: number; readonly step: number; readonly max: number }>
> = {
  energy: { value: 2000, step: 50, max: 8000 },
  protein: { value: 120, step: 5, max: 500 },
  carbohydrates: { value: 220, step: 5, max: 900 },
  fat: { value: 70, step: 5, max: 400 },
  fiber: { value: 30, step: 1, max: 100 },
  water: { value: 2500, step: 100, max: 8000 },
}

/** The amount a target stands for: its value, a range's middle, nothing without a goal. */
export function gramsOf(target: FormTarget): number | null {
  if (target.mode === 'none') return null
  if (target.mode === 'maximum') return target.high
  if (target.mode === 'range') {
    if (target.low === null || target.high === null) return target.low ?? target.high
    return (target.low + target.high) / 2
  }
  return target.low
}

/** The day's energy the goal aims at, by the same rule. */
export const energyOf = gramsOf

/** A macro's kilocalories at its target; fibre, water and no goal have none. */
export function macroKcal(code: GoalNutrient, target: FormTarget): number | null {
  if (!isMacro(code)) return null
  const grams = gramsOf(target)
  return grams === null ? null : Math.round(grams * KCAL_PER_GRAM[code])
}

/** Each macro's share of the energy, from 0 to 1; null without a goal or without energy. */
export function macroShares(form: GoalForm): Readonly<Record<Macro, number | null>> {
  const energy = energyOf(form.energy)
  const share = (code: Macro): number | null => {
    const kcal = macroKcal(code, form[code])
    if (kcal === null || energy === null || energy <= 0) return null
    return Math.min(1, kcal / energy)
  }
  return { protein: share('protein'), carbohydrates: share('carbohydrates'), fat: share('fat') }
}

/** What the field holding one end of a target is called. */
export function modeCaption(mode: FormMode, end: 'low' | 'high'): string {
  if (mode === 'range') return end === 'low' ? 'Desde' : 'Hasta'
  if (mode === 'minimum') return 'Al menos'
  if (mode === 'maximum') return 'Como máximo'
  if (mode === 'exact') return 'Exactamente'
  return 'Sin meta'
}

/** A target moved to another kind keeps what it can of its value. */
export function withMode(code: GoalNutrient, target: FormTarget, mode: FormMode): FormTarget {
  const value = target.low ?? target.high ?? START[code].value
  if (mode === 'none') return { mode, low: null, high: null }
  if (mode === 'exact' || mode === 'minimum') return { mode, low: value, high: null }
  if (mode === 'maximum') return { mode, low: null, high: value }
  // A range opened around one value spans a tenth either side, on the nutrient's step.
  const step = START[code].step
  const onStep = (raw: number) => Math.round(raw / step) * step
  return {
    mode,
    low: target.low ?? onStep(value * 0.9),
    high: target.high ?? onStep(value * 1.1),
  }
}

/** A range typed the wrong way round, put right once typing ends; anything else as it is. */
export function orderedRange(target: FormTarget): FormTarget {
  if (target.mode !== 'range' || target.low === null || target.high === null) return target
  return target.low > target.high ? { ...target, low: target.high, high: target.low } : target
}
