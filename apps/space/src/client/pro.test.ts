import { describe, expect, test } from 'bun:test'
import type { CommandHeaders } from '@allfitone/contracts/commands'

import {
  billingOf,
  createProFlow,
  featureIcon,
  featureSentence,
  gymWarning,
  money,
  productFor,
  renewalLine,
  sourceLine,
  type ProPlan,
  type ProPlanCatalogue,
  type ProStatus,
  type SubscriptionSource,
} from './pro'

const PERSON = '019f1000-0000-7000-8000-000000000001'
const subscription: SubscriptionSource = {
  kind: 'subscription',
  store: 'app_store',
  status: 'active',
  auto_renews: true,
  current_period_end: '2026-10-03T15:00:00Z',
  grace_until: null,
  version_id: '019f1000-0000-7000-8000-000000000302',
}
const gym = {
  kind: 'organization' as const,
  organization_id: '019f1000-0000-7000-8000-000000000401',
  organization_name: 'Bodytech Chicó',
}
const status = (over: Partial<ProStatus>): ProStatus => ({
  generated_at: '2026-10-12T12:00:00Z',
  account_token: PERSON,
  effective_source: 'free',
  is_pro: false,
  plan: null,
  features: [],
  sources: [],
  ...over,
})

describe('what the screens say', () => {
  test('T-SPC-UNIT-288 the source line names who pays, or that nobody does', () => {
    expect(
      sourceLine(status({ effective_source: 'subscription', sources: [subscription, gym] })),
    ).toBe('Pagado con Apple')
    expect(sourceLine(status({ effective_source: 'organization', sources: [gym] }))).toBe(
      'Incluido por Bodytech Chicó',
    )
    expect(sourceLine(status({}))).toBe('Sin costo, para siempre')
  })

  test('T-SPC-UNIT-289 the end of the paid period says whether it renews, and grace says until when', () => {
    expect(renewalLine(subscription)).toMatch(/^Renueva el \d+ oct$/)
    expect(renewalLine({ ...subscription, auto_renews: false })).toMatch(
      /^Termina el \d+ oct, no se renueva$/,
    )
    expect(
      renewalLine({ ...subscription, status: 'grace', grace_until: '2026-10-09T15:00:00Z' }),
    ).toMatch(/^No pudimos renovar: sigues con Pro hasta el \d+ oct$/)
    expect(renewalLine({ ...subscription, status: 'suspended' })).toBe(
      'Cobro pendiente: Pro está en pausa',
    )
  })

  test('T-SPC-UNIT-290 whoever has Pro through a gym is told before paying', () => {
    expect(gymWarning(status({ effective_source: 'organization', sources: [gym] }))).toBe(
      'Ya tienes Pro por Bodytech Chicó. Pagarlo solo te sirve para no depender de esa afiliación.',
    )
    expect(
      gymWarning(status({ effective_source: 'subscription', sources: [subscription, gym] })),
    ).toBe(undefined)
    expect(gymWarning(status({}))).toBe(undefined)
  })

  test('T-SPC-UNIT-291 each function reads as one sentence, at its limit or without one', () => {
    const f = (code: string, limit: number | null, enabled = true) => ({
      code,
      name: 'Función',
      unit: null,
      enabled,
      limit_value: limit,
    })
    expect(featureSentence(f('active_programs', 1))).toBe('Máximo 1 programa activo')
    expect(featureSentence(f('active_programs', null))).toBe('Programas activos sin límite')
    expect(featureSentence(f('own_routines', 4))).toBe('Máximo 4 rutinas')
    expect(featureSentence(f('history_months', 3))).toBe('Historial de los últimos 3 meses')
    expect(featureSentence(f('history_months', 1))).toBe('Historial del último mes')
    expect(featureSentence(f('history_months', null))).toBe('Todo tu historial')
    expect(featureSentence(f('meal_photos', null, false))).toBe(
      'Comidas solo por búsqueda de alimentos',
    )
    expect(featureSentence(f('meal_photos', null))).toBe('Comidas por foto y por búsqueda')
    expect(featureSentence(f('something_new', 2))).toBe('Función: máximo 2')
    expect(featureIcon('own_routines')).toBe('checklist')
    expect(featureIcon('something_new')).toBe('check')
  })

  test('T-SPC-UNIT-295 the fee follows the period of the version paid, never assumed', () => {
    const catalogue = {
      generated_at: '',
      plans: [
        { version_id: 'monthly', billing_period: 'month' },
        { version_id: 'yearly', billing_period: 'year' },
      ],
    } as ProPlanCatalogue
    expect(billingOf(catalogue, 'monthly')).toEqual({ fee: 'Cuota mensual', per: '/mes' })
    expect(billingOf(catalogue, 'yearly')).toEqual({ fee: 'Cuota anual', per: '/año' })
    expect(billingOf(catalogue, 'unknown')).toEqual({ fee: 'Cuota', per: '' })
  })

  test('T-SPC-UNIT-292 money is shown as on a receipt', () => {
    expect(money(2_490_000, 'COP')).toBe('$24.900')
    expect(money(999, 'USD')).toBe('$9,99 USD')
    expect(money(null, 'COP')).toBe(undefined)
  })

  test('T-SPC-UNIT-293 Pro is sold only where Allfit has a product for it', () => {
    const plan = {
      store_products: [{ store: 'app_store', product_id: 'com.dinnartec.allfitspace.pro.monthly' }],
    } as ProPlan
    expect(productFor(plan, 'app_store')).toBe('com.dinnartec.allfitspace.pro.monthly')
    expect(productFor(plan, 'google_play')).toBe(undefined)
  })
})

describe('presenting a purchase', () => {
  test('T-SPC-UNIT-294 the same purchase, presented again after a failure, reuses its command', async () => {
    const used: string[] = []
    let fail = true
    let counter = 0
    const flow = createProFlow({
      newCommand: (): CommandHeaders => {
        counter += 1
        return { idempotencyKey: `key-${counter}`, commandId: `command-${counter}` }
      },
      transport: {
        read: async () => status({}),
        plans: async () => ({ generated_at: '', plans: [] }),
        payments: async () => ({ generated_at: '', payments: [] }),
        purchase: async (command) => {
          used.push(command.idempotencyKey)
          if (fail) {
            fail = false
            throw new Error('offline')
          }
          return status({ effective_source: 'subscription', is_pro: true })
        },
      },
    })
    const purchase = { store: 'app_store' as const, signed_transaction: 'jws' }
    await expect(flow.present(purchase)).rejects.toThrow('offline')
    await flow.present(purchase)
    await flow.present({ store: 'app_store', signed_transaction: 'another' })
    expect(used).toEqual(['key-1', 'key-1', 'key-2'])
  })
})
