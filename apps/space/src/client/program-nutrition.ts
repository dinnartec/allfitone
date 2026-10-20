/**
 * The nutrition goal an Allfit programme brings (PN-1), as its detail says it.
 *
 * The figures come already sized to the person from the API; this only words them: the
 * energy as a range, what the goal is for, and the three macros with the share of the
 * energy each carries, which is what their rings draw.
 */

import type { ProgramDetail } from './programs'

export type ProgramNutrition = NonNullable<ProgramDetail['nutrition']>
type MacroCode = 'protein' | 'carbohydrates' | 'fat'

const PURPOSE: Record<ProgramNutrition['goal_code'], string> = {
  build_muscle: 'ganar músculo',
  lose_weight: 'perder grasa',
  get_fit: 'ponerte en forma',
  maintain: 'mantenerte',
  run_a_race: 'preparar una carrera',
}

const MACROS: readonly (readonly [MacroCode, string, number])[] = [
  ['protein', 'Proteína', 4],
  ['carbohydrates', 'Carbos', 4],
  ['fat', 'Grasa', 9],
]

const figure = (value: number) => Math.round(value).toLocaleString('es-CO')

export interface ProgramNutritionCopy {
  readonly energy: string
  readonly purpose: string
  readonly macros: readonly {
    readonly code: MacroCode
    readonly label: string
    readonly value: string
    /** Of the energy's midpoint, 0 to 1. */
    readonly share: number
  }[]
}

export function programNutritionCopy(
  nutrition: ProgramNutrition,
  daysPerWeek: number,
): ProgramNutritionCopy {
  const target = (code: string) => nutrition.targets.find((one) => one.nutrient_code === code)
  const energy = target('energy')
  const low = energy?.minimum ?? energy?.exact ?? 0
  const high = energy?.maximum ?? energy?.exact ?? 0
  const middle = (low + high) / 2
  const days = daysPerWeek === 1 ? '1 día' : `${String(daysPerWeek)} días`
  return {
    energy: low === high ? figure(low) : `${figure(low)}–${figure(high)}`,
    purpose: `Para ${PURPOSE[nutrition.goal_code]} con ${days} por semana`,
    macros: MACROS.flatMap(([code, label, kcalPerGram]) => {
      const grams = target(code)?.exact ?? target(code)?.minimum ?? null
      if (grams === null) return []
      return [
        {
          code,
          label,
          value: `${figure(grams)} g`,
          share: middle > 0 ? Math.min(1, (grams * kcalPerGram) / middle) : 0,
        },
      ]
    }),
  }
}
