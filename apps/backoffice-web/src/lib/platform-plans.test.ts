import { describe, expect, test } from 'bun:test'

import {
  changeLines,
  featureLimits,
  formatPrice,
  hasFreePlan,
  initialFeatureDrafts,
  isValidPlanCode,
  limitPhrase,
  parsePriceToMinor,
  planCommandMessage,
  planOutcomeMessage,
  reviewNote,
  versionStatus,
  type PlatformPlan,
  type PlatformPlanCatalogue,
  type PlatformPlanVersion,
} from './platform-plans'

function version(overrides: Partial<PlatformPlanVersion> = {}): PlatformPlanVersion {
  return {
    id: '019b4000-0000-7000-8000-000000000601',
    version_number: 1,
    status: 'published',
    amount_minor: 3990000,
    currency_code: 'COP',
    billing_period: 'month',
    features: [
      { feature_code: 'history_weeks', enabled: true, limit_value: 12 },
      { feature_code: 'meal_logs_per_day', enabled: true, limit_value: null },
    ],
    supersedes_version_id: null,
    changes: null,
    proposed_by_person_id: '019b4000-0000-7000-8000-000000000003',
    proposed_by_self: false,
    proposed_at: '2026-09-18T12:00:00.000Z',
    published_by_person_id: '019b4000-0000-7000-8000-000000000004',
    published_at: '2026-09-18T12:05:00.000Z',
    deprecated_at: null,
    withdrawn_by_person_id: null,
    withdrawn_at: null,
    ...overrides,
  }
}

function plan(overrides: Partial<PlatformPlan> = {}): PlatformPlan {
  return {
    id: '019b4000-0000-7000-8000-000000000501',
    code: 'premium',
    name: 'Premium',
    plan_kind: 'paid',
    status: 'published',
    created_by_person_id: '019b4000-0000-7000-8000-000000000003',
    created_at: '2026-09-18T11:00:00.000Z',
    current_version: version(),
    proposal: null,
    history: [version()],
    ...overrides,
  }
}

const catalogue: PlatformPlanCatalogue = {
  generated_at: '2026-09-18T12:10:00.000Z',
  feature_catalog: [
    { code: 'history_weeks', name: 'Semanas de historial', unit: 'weeks' },
    { code: 'meal_logs_per_day', name: 'Comidas por día', unit: 'items' },
  ],
  plans: [plan()],
}

describe('platform plan presentation', () => {
  test('reads a price as pesos and sends minor units, refusing an ambiguous separator', () => {
    expect(parsePriceToMinor('39900', 'COP')).toBe(3990000)
    expect(parsePriceToMinor(' 9,99 ', 'USD')).toBe(999)
    expect(parsePriceToMinor('9,9', 'USD')).toBe(990)
    // "39.900" is thirty-nine thousand to one reader and thirty-nine to another.
    expect(parsePriceToMinor('39.900', 'COP')).toBeUndefined()
    expect(parsePriceToMinor('9,999', 'USD')).toBeUndefined()
    expect(parsePriceToMinor('0', 'COP')).toBeUndefined()
    expect(parsePriceToMinor('-5', 'COP')).toBeUndefined()
    expect(parsePriceToMinor('diez', 'COP')).toBeUndefined()
    expect(parsePriceToMinor('1000000000000', 'COP')).toBeUndefined()
  })

  test('shows a price with its currency and period, and the free plan as free', () => {
    const format = new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      currencyDisplay: 'code',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })

    expect(formatPrice(version())).toBe(`${format.format(39900)} al mes`)
    expect(formatPrice(version({ billing_period: 'year' }))).toContain('al año')
    expect(
      formatPrice(version({ amount_minor: 0, currency_code: null, billing_period: null })),
    ).toBe('Gratis')
  })

  test('says what a function does in a plan, never as a bare number', () => {
    expect(limitPhrase({ enabled: false, limit_value: null }, 'weeks')).toBe('No incluida')
    expect(limitPhrase(null, 'weeks')).toBe('No incluida')
    expect(limitPhrase({ enabled: true, limit_value: null }, 'weeks')).toBe('Sin límite')
    expect(limitPhrase({ enabled: true, limit_value: 1 }, 'weeks')).toBe('Hasta 1 semana')
    expect(limitPhrase({ enabled: true, limit_value: 12 }, 'weeks')).toBe('Hasta 12 semanas')
    expect(limitPhrase({ enabled: true, limit_value: 3 }, null)).toBe('Hasta 3')
    expect(limitPhrase({ enabled: true, limit_value: 3 }, 'sessions')).toBe('Hasta 3 sessions')
  })

  test('writes each difference against the version in force', () => {
    const inForce = version()
    const proposal = version({
      id: '019b4000-0000-7000-8000-000000000602',
      version_number: 2,
      status: 'draft',
      amount_minor: 4490000,
      billing_period: 'year',
      supersedes_version_id: inForce.id,
      changes: [
        { field: 'amount_minor', feature_code: null, before: 3990000, after: 4490000 },
        { field: 'billing_period', feature_code: null, before: 'month', after: 'year' },
        {
          field: 'feature',
          feature_code: 'history_weeks',
          before: { enabled: true, limit_value: 12 },
          after: { enabled: false, limit_value: null },
        },
      ],
    })

    const lines = changeLines(catalogue, proposal, inForce)

    expect(lines).toHaveLength(3)
    expect(lines[0]).toStartWith('Precio: ')
    expect(lines[0]).toContain(' → ')
    expect(lines[1]).toBe('Cobro: mensual → anual')
    expect(lines[2]).toBe('Semanas de historial: Hasta 12 semanas → No incluida')
  })

  test('a first version says there is nothing to compare it with', () => {
    expect(changeLines(catalogue, version({ status: 'draft' }), null)).toEqual([
      'Primera versión del plan: todavía no hay nada en vigor con qué compararla.',
    ])
  })

  test('tells the proposer, before they try, that somebody else publishes', () => {
    expect(reviewNote(version({ status: 'draft', proposed_by_self: true }))).toContain(
      'la publica otra persona',
    )
    expect(reviewNote(version({ status: 'draft', proposed_by_self: false }))).toContain('publícala')
    expect(versionStatus('draft')).toEqual({ label: 'En revisión', tone: 'warning' })
    expect(versionStatus('deprecated').label).toBe('Reemplazada')
  })

  test('starts a proposal from the version in force and declares every function', () => {
    const drafts = initialFeatureDrafts(catalogue, version())

    expect(drafts).toEqual([
      { code: 'history_weeks', enabled: true, limit: '12' },
      { code: 'meal_logs_per_day', enabled: true, limit: '' },
    ])
    expect(featureLimits(drafts)).toEqual({
      limits: [
        { feature_code: 'history_weeks', enabled: true, limit_value: 12 },
        { feature_code: 'meal_logs_per_day', enabled: true, limit_value: null },
      ],
    })
    expect(initialFeatureDrafts(catalogue, null).every((draft) => !draft.enabled)).toBe(true)
    expect(initialFeatureDrafts({ ...catalogue, feature_catalog: [] }, version())).toEqual([])
  })

  test('a function left out carries no limit, and a limit is a whole number', () => {
    expect(featureLimits([{ code: 'history_weeks', enabled: false, limit: '12' }])).toEqual({
      limits: [{ feature_code: 'history_weeks', enabled: false, limit_value: null }],
    })
    expect(featureLimits([{ code: 'history_weeks', enabled: true, limit: '1.5' }])).toEqual({
      invalid: 'history_weeks',
    })
    expect(featureLimits([{ code: 'history_weeks', enabled: true, limit: '-1' }])).toEqual({
      invalid: 'history_weeks',
    })
  })

  test('knows whether the one free plan already exists, and what a code looks like', () => {
    expect(hasFreePlan(catalogue)).toBe(false)
    expect(hasFreePlan({ ...catalogue, plans: [plan({ plan_kind: 'free', code: 'free' })] })).toBe(
      true,
    )
    expect(isValidPlanCode('premium_anual')).toBe(true)
    expect(isValidPlanCode('Premium')).toBe(false)
    expect(isValidPlanCode('p')).toBe(false)
  })

  test('explains each refusal for the action that met it', () => {
    expect(planCommandMessage('create', 'conflict')).toContain('ya hay un plan gratuito')
    expect(planCommandMessage('propose', 'conflict')).toContain('no cambia nada')
    expect(planCommandMessage('publish', 'conflict')).toContain('ya no está abierta')
    expect(planCommandMessage('publish', 'forbidden')).toContain('una propuesta tuya')
    expect(planCommandMessage('propose', 'forbidden')).toContain('manage_platform_commercial')
    expect(planCommandMessage('propose', 'validation-failed')).toContain('cada función')
    expect(planCommandMessage('withdraw', 'teapot')).toBe('No se pudo completar la acción.')
    expect(planOutcomeMessage('publish', plan())).toContain('conserva la suya')
  })
})
