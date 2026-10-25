import { describe, expect, test } from 'bun:test'

import { comparisonRows, limitOf, opens, upgradeCopy, visibleFrom } from './plan'
import type { ProFeature } from './pro'

const feature = (code: string, enabled: boolean, limit_value: number | null): ProFeature => ({
  code,
  name: code,
  unit: null,
  enabled,
  limit_value,
})

const FREE: ProFeature[] = [
  feature('training_history_months', true, 1),
  feature('nutrition_history_months', true, 1),
  feature('active_personal_programs', true, 1),
  feature('own_routines', true, 3),
  feature('routine_duplication', false, null),
  feature('full_program_catalogue', false, null),
  feature('period_analysis', false, null),
  feature('body_measurements', false, null),
  feature('body_photos', false, null),
  feature('meal_photo_recognition', false, null),
]
const PRO: ProFeature[] = FREE.map((one) => feature(one.code, true, null))

describe('what a plan opens', () => {
  test('T-SPC-UNIT-PLAN-10 a function the plan declares closed is closed', () => {
    expect(opens(FREE, 'routine_duplication')).toBe(false)
    expect(opens(PRO, 'routine_duplication')).toBe(true)
  })

  test('T-SPC-UNIT-PLAN-11 a function the plan does not declare limits nothing', () => {
    expect(opens([], 'body_photos')).toBe(true)
    expect(limitOf([], 'own_routines')).toBeNull()
  })

  test('T-SPC-UNIT-PLAN-12 a limit is the number the plan declares, null when unlimited', () => {
    expect(limitOf(FREE, 'own_routines')).toBe(3)
    expect(limitOf(PRO, 'own_routines')).toBeNull()
  })

  test('T-SPC-UNIT-PLAN-13 the visible history starts a month back, at the start of the day', () => {
    expect(visibleFrom(FREE, 'training_history_months', new Date(2026, 9, 25, 15, 30))).toEqual(
      new Date(2026, 8, 25),
    )
    expect(visibleFrom(PRO, 'training_history_months', new Date(2026, 9, 25))).toBeNull()
  })
})

describe('the upgrade sheet', () => {
  test('T-SPC-UNIT-PLAN-14 says what Pro opens for the function that was refused', () => {
    expect(upgradeCopy('own_routines', FREE)).toEqual({
      title: 'Rutinas sin límite',
      body: 'Con Gratis guardas hasta 3 rutinas propias. Con Pro, las que quieras: las que ya tienes se quedan.',
    })
    expect(upgradeCopy('training_history_months', FREE).body).toContain('sigue guardado')
  })

  test('T-SPC-UNIT-PLAN-15 a function the app does not know yet still gets a sentence', () => {
    expect(upgradeCopy('partner_programs', FREE).title).toBe('Esto es parte de Pro')
  })
})

describe('the comparison', () => {
  test('T-SPC-UNIT-PLAN-16 every row says what each plan gives, from the catalogue', () => {
    const rows = comparisonRows(FREE, PRO)
    const history = rows.find((row) => row.key === 'training_history_months')
    const routines = rows.find((row) => row.key === 'own_routines')
    expect(history).toEqual({
      key: 'training_history_months',
      label: 'Historial',
      free: 'Último mes',
      pro: 'Completo',
    })
    expect(routines).toEqual({
      key: 'own_routines',
      label: 'Rutinas propias',
      free: 'Hasta 3',
      pro: 'Sin límite',
    })
  })

  test('T-SPC-UNIT-PLAN-17 what is always free reads as included in both', () => {
    const privacy = comparisonRows(FREE, PRO).find((row) => row.key === 'privacy')
    expect(privacy).toEqual({
      key: 'privacy',
      label: 'Privacidad y tus datos',
      free: true,
      pro: true,
    })
  })
})
