import { describe, expect, test } from 'bun:test'

import {
  GYM_CHARGES_NOTE,
  NO_CARD_NOTE,
  bondLine,
  chargeLine,
  paymentsMessage,
  paysNobody,
  proSentence,
  storeLabel,
  subscriptionPrice,
  subscriptionState,
  type SupportPersonPayments,
  type SupportPersonProSubscription,
} from './support-payments'

const PERSON = '019c8000-0000-7000-8000-000000000011'

// Built with the same formatter the screen uses, so what is asserted is the amount and
// not which space character `Intl` puts after a currency code.
const money = (currency: string, fraction: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    minimumFractionDigits: fraction,
    maximumFractionDigits: fraction,
  })

function subscription(
  overrides: Partial<SupportPersonProSubscription> = {},
): SupportPersonProSubscription {
  return {
    plan_name: 'Pro',
    version_number: 1,
    amount_minor: 1990000,
    currency_code: 'COP',
    billing_period: 'month',
    store: 'app_store',
    status: 'active',
    auto_renews: true,
    started_at: '2026-09-14T12:00:00.000Z',
    current_period_end: '2026-11-01T12:00:00.000Z',
    grace_until: null,
    suspended_at: null,
    ended_at: null,
    ended_reason: null,
    ...overrides,
  }
}

function payments(overrides: Partial<SupportPersonPayments> = {}): SupportPersonPayments {
  return {
    person_id: PERSON,
    generated_at: '2026-10-14T12:00:00.000Z',
    pro: { source: 'subscription', subscription: subscription(), organizations: [] },
    payments: [],
    payments_truncated: false,
    organization_subscriptions: [],
    organization_charges_availability: 'not_modelled',
    ...overrides,
  }
}

describe('what a person pays, as the panel says it', () => {
  test('whoever pays Allfit is told through which store', () => {
    expect(proSentence(payments())).toBe('Tiene Pro porque se lo paga a Allfit por Apple.')
  })

  test('whoever has Pro through a gym is told which gym, and that Allfit charges nothing', () => {
    const line = proSentence(
      payments({
        pro: {
          source: 'organization',
          subscription: null,
          organizations: [{ organization_id: PERSON, organization_name: 'Gimnasio Pagos' }],
        },
      }),
    )
    expect(line).toContain('Gimnasio Pagos')
    expect(line).toContain('No le paga nada a Allfit')
  })

  test('and whoever pays nobody is on the free plan, which is a fact and not a gap', () => {
    expect(
      proSentence(payments({ pro: { source: 'free', subscription: null, organizations: [] } })),
    ).toBe('No tiene Pro: está en el plan gratuito.')
    expect(
      paysNobody(payments({ pro: { source: 'free', subscription: null, organizations: [] } })),
    ).toBe(true)
  })

  test('the price is divided by the ISO exponent, not by what a locale would show', () => {
    // COP resolves to zero decimals in es-CO, so dividing by that would show
    // 1.990.000 centavos as $1.990.000 instead of $19.900.
    expect(subscriptionPrice(subscription())).toBe(`${money('COP', 0).format(19900)} al mes`)
    expect(
      subscriptionPrice(subscription({ billing_period: 'year', amount_minor: 19900000 })),
    ).toBe(`${money('COP', 0).format(199000)} al año`)
  })

  test('a suspension says since when, because a date is what a complaint needs', () => {
    expect(
      subscriptionState(
        subscription({ status: 'suspended', suspended_at: '2026-10-10T12:00:00.000Z' }),
      ),
    ).toContain('En pausa por falta de cobro desde el')
  })

  test('a renewal the store could not collect says until when Pro lasts', () => {
    expect(
      subscriptionState(subscription({ status: 'grace', grace_until: '2026-10-20T12:00:00.000Z' })),
    ).toContain('conserva Pro hasta el')
  })

  test('one that will not renew is told apart from one that will', () => {
    expect(subscriptionState(subscription())).toContain('Se renueva el')
    expect(subscriptionState(subscription({ auto_renews: false }))).toContain('no se renueva')
  })

  test('an ended subscription says why in words, never with the store code', () => {
    expect(
      subscriptionState(
        subscription({
          status: 'ended',
          ended_at: '2026-10-01T12:00:00.000Z',
          ended_reason: 'refunded',
        }),
      ),
    ).toContain('la tienda devolvió el dinero')
  })

  test('a charge that went through and one that did not never read alike', () => {
    expect(
      chargeLine({
        occurred_at: '2026-10-01T12:00:00.000Z',
        store: 'app_store',
        result: 'succeeded',
        failure_code: null,
        amount_minor: 1990000,
        currency_code: 'COP',
      }),
    ).toBe(`${money('COP', 0).format(19900)} · cobrado por Apple`)

    expect(
      chargeLine({
        occurred_at: '2026-09-30T12:00:00.000Z',
        store: 'google_play',
        result: 'failed',
        failure_code: 'billing_retry',
        amount_minor: 1990000,
        currency_code: 'COP',
      }),
    ).toBe(
      `${money('COP', 0).format(19900)} · Google Play no pudo cobrarlo · motivo: billing_retry`,
    )
  })

  test('a failure the store did not explain says so rather than leaving it blank', () => {
    expect(
      chargeLine({
        occurred_at: '2026-09-30T12:00:00.000Z',
        store: 'app_store',
        result: 'failed',
        failure_code: null,
        amount_minor: null,
        currency_code: null,
      }),
    ).toBe('Sin monto reportado · Apple no pudo cobrarlo · sin motivo reportado')
  })

  test('the bond with a gym carries its state and its date', () => {
    expect(
      bondLine({
        subscription_id: PERSON,
        organization_id: PERSON,
        organization_name: 'Gimnasio Pagos',
        status: 'suspended',
        started_at: '2026-08-01T12:00:00.000Z',
        suspended_at: '2026-10-05T12:00:00.000Z',
        ended_at: null,
      }),
    ).toContain('En pausa desde el')
  })

  test('and the panel says what it does not know, instead of showing no charges', () => {
    expect(GYM_CHARGES_NOTE).toContain('no guardamos los cobros')
    expect(NO_CARD_NOTE).toContain('no guarda datos de tarjeta')
  })

  test('the store is named for a person, never by its code', () => {
    expect(storeLabel('app_store')).toBe('Apple')
    expect(storeLabel('google_play')).toBe('Google Play')
  })

  test('a refusal names the duty that is missing, which is not the card’s one', () => {
    expect(paymentsMessage('forbidden')).toContain('view_billing_metadata')
    expect(paymentsMessage('forbidden')).toContain('distinto del que abre su ficha')
    expect(paymentsMessage('unknown')).toBe('No se pudo leer lo que paga esta persona.')
  })
})
