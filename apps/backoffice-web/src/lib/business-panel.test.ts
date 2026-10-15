import { describe, expect, test } from 'bun:test'

import {
  NOTHING_BILLED,
  NOT_MODELLED_NOTE,
  businessMessage,
  businessSections,
  metricBadge,
  metricHint,
  metricLabel,
  metricNote,
  metricValue,
  moneyLines,
  moneyNote,
  periodPhrase,
  type SupportBusinessMetric,
  type SupportBusinessPanel,
} from './business-panel'

const WEEK = {
  kind: 'week',
  from: '2026-09-10T18:00:00.000Z',
  to: '2026-09-17T18:00:00.000Z',
} as const
const TOTAL = { kind: 'total', from: null, to: '2026-09-17T18:00:00.000Z' } as const
const MONTH = {
  kind: 'month',
  from: '2026-09-01T05:00:00.000Z',
  to: '2026-09-17T18:00:00.000Z',
} as const

function metric(overrides: Partial<SupportBusinessMetric> = {}): SupportBusinessMetric {
  return {
    key: 'registered_people',
    availability: 'available',
    value: 1284,
    reason: null,
    period: TOTAL,
    ...overrides,
  }
}

function panel(metrics: SupportBusinessMetric[]): SupportBusinessPanel {
  return {
    generated_at: '2026-09-17T18:00:00.000Z',
    minimum_aggregate: 5,
    metrics,
    money: [],
  }
}

describe('business panel presentation', () => {
  test('a figure the platform cannot give is blank with a reason, never zero', () => {
    const premium = metric({
      key: 'premium_people',
      availability: 'not_modelled',
      value: null,
      reason: 'payments_not_modelled',
      period: WEEK,
    })
    const payments = metric({
      key: 'active_subscriptions',
      availability: 'not_modelled',
      value: null,
      reason: 'payments_not_modelled',
    })

    expect(metricValue(premium)).toBe('—')
    expect(metricValue(payments)).toBe('—')
    expect(metricNote(payments, 5)).toContain('todavía no guarda pagos')
    expect(metricBadge(premium).label).toBe('Sin datos aún')
  })

  test('people training this week is a figure like any other, and says of what week', () => {
    const training = metric({
      key: 'active_people_this_week',
      availability: 'available',
      value: 42,
      reason: null,
      period: WEEK,
    })

    expect(metricValue(training)).toBe('42')
    expect(metricNote(training, 5)).toBeNull()
    expect(metricHint('active_people_this_week')).toContain('entrenó')
    expect(periodPhrase(training.period)).toContain('Del ')
  })

  test('a reason the screen does not know still says the figure is missing, not zero', () => {
    const unknown = metric({ availability: 'not_modelled', value: null, reason: 'invented_reason' })

    expect(metricValue(unknown)).toBe('—')
    expect(metricNote(unknown, 5)).toBe(NOT_MODELLED_NOTE)
  })

  test('a group too small to publish says so, and names the minimum', () => {
    const small = metric({
      key: 'studio_active_professionals_this_week',
      availability: 'below_threshold',
      value: null,
      period: WEEK,
    })

    expect(metricValue(small)).toBe('—')
    expect(metricNote(small, 5)).toBe(
      'Menos de 5 personas. No se publica para que ninguna cifra pueda señalar a alguien.',
    )
    expect(metricBadge(small).label).toBe('Grupo muy pequeño')
  })

  test('a real zero is a figure and is shown as one', () => {
    const none = metric({ key: 'unclaimed_organizations', value: 0 })

    expect(metricValue(none)).toBe('0')
    expect(metricNote(none, 5)).toBeNull()
    expect(metricBadge(none)).toEqual({ label: 'Medido', variant: 'success' })
  })

  // The day itself is `Intl`'s to spell; what this pins down is that the phrase
  // always names one, and that a total is not dressed up as a range.
  test('every figure carries the period it was measured over', () => {
    const day = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' })
    const to = day.format(new Date(WEEK.to))
    const from = day.format(new Date(WEEK.from))

    expect(periodPhrase(TOTAL)).toBe(`Total hasta ${to}`)
    expect(periodPhrase(WEEK)).toBe(`Del ${from} al ${to}`)
    expect(periodPhrase({ kind: 'month', from: '2026-09-01T00:00:00.000Z', to: WEEK.to })).toBe(
      `Desde ${day.format(new Date('2026-09-01T00:00:00.000Z'))} hasta ${to}`,
    )
    expect(periodPhrase({ kind: 'week', from: null, to: WEEK.to })).toBe(`Del — al ${to}`)
  })

  test('a figure without a period is not shown at all', () => {
    const sections = businessSections(
      panel([
        metric(),
        metric({ key: 'organizations', period: { kind: 'total', from: null, to: '' } }),
      ]),
    )

    expect(sections).toHaveLength(1)
    expect(sections[0]?.metrics.map((entry) => entry.key)).toEqual(['registered_people'])
  })

  test('groups the figures by the question they answer, and drops nothing it does not know', () => {
    // The API ships separately from this screen, so a newer one can publish a key
    // this build has never heard of. It belongs at the end, not in the bin.
    const fromANewerApi = {
      ...metric(),
      key: 'people_who_left',
    } as unknown as SupportBusinessMetric
    const sections = businessSections(
      panel([
        metric(),
        metric({ key: 'organizations', value: 12 }),
        metric({ key: 'premium_people', value: 42 }),
        fromANewerApi,
      ]),
    )

    expect(sections.map((section) => section.key)).toEqual([
      'people',
      'organizations',
      'money',
      'other',
    ])
    expect(sections.at(-1)?.metrics.map((entry) => String(entry.key))).toEqual(['people_who_left'])
  })

  // Built with the same formatter the screen uses, so what is asserted is the amount
  // and not which space character `Intl` puts after a currency code.
  const money = (currency: string, fraction: number) =>
    new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
      minimumFractionDigits: fraction,
      maximumFractionDigits: fraction,
    })

  test('what Allfit billed is one line per currency, never a mixed total', () => {
    expect(
      moneyLines({
        key: 'billed_this_month',
        availability: 'available',
        amounts: [
          { currency_code: 'COP', amount_minor: 7960000 },
          { currency_code: 'USD', amount_minor: 1198 },
        ],
        reason: null,
        period: MONTH,
      }),
    ).toEqual([money('COP', 0).format(79600), money('USD', 2).format(11.98)])
  })

  test('and the minor unit belongs to the currency, not to what a locale shows', () => {
    // COP resolves to zero decimals in es-CO, so dividing by that would turn
    // 1.990.000 centavos into $1.990.000 instead of $19.900.
    expect(
      moneyLines({
        key: 'billed_this_month',
        availability: 'available',
        amounts: [{ currency_code: 'COP', amount_minor: 1990000 }],
        reason: null,
        period: MONTH,
      }),
    ).toEqual([money('COP', 0).format(19900)])
  })

  test('a month with nothing collected says so, because zero is an answer', () => {
    expect(
      moneyLines({
        key: 'billed_this_month',
        availability: 'available',
        amounts: [],
        reason: null,
        period: MONTH,
      }),
    ).toEqual([NOTHING_BILLED])
  })

  test('an amount behind too few payers is withheld, and the note says why', () => {
    const withheld = {
      key: 'billed_this_month',
      availability: 'below_threshold',
      amounts: null,
      reason: null,
      period: MONTH,
    } as const
    expect(moneyLines(withheld)).toEqual([])
    expect(moneyNote(withheld, 5)).toContain('deducir lo que paga cada una')
  })

  test('the two routes to Pro are labelled apart, because they are not the same number', () => {
    expect(metricLabel('pro_people_paying_allfit')).toBe('Con Pro, pagándole a Allfit')
    expect(metricLabel('pro_people_through_organization')).toBe('Con Pro, por su gimnasio')
    expect(metricHint('pro_people_through_organization')).toContain('se cuenta arriba y no aquí')
  })

  test("what a gym bills its clients is not Allfit's income, and the hint says it", () => {
    expect(metricLabel('active_organization_subscriptions')).toBe('Planes de gimnasio activos')
    expect(metricHint('active_organization_subscriptions')).toContain('no es ingreso de Allfit')
  })

  test('the two activity figures are labelled apart, because they are not the same question', () => {
    expect(metricLabel('active_people_this_week')).toBe('Personas activas entrenando')
    expect(metricLabel('studio_active_professionals_this_week')).toBe(
      'Profesionales activos en Studio',
    )
    expect(metricHint('studio_active_professionals_this_week')).toContain('no sustituye')
    expect(metricLabel('a_key_nobody_wrote_a_label_for')).toBe('a_key_nobody_wrote_a_label_for')
    expect(metricHint('a_key_nobody_wrote_a_label_for')).toBeNull()
  })

  test('the subscription states are labelled apart and say what the total is made of', () => {
    expect(metricLabel('active_subscriptions')).toBe('Suscripciones activas')
    expect(metricLabel('suspended_subscriptions')).toBe('Suscripciones suspendidas')
    expect(metricLabel('lapsed_subscriptions')).toBe('Suscripciones vencidas sin reportar')
    expect(metricLabel('open_subscriptions')).toBe('Suscripciones abiertas')
    expect(metricHint('lapsed_subscriptions')).toContain('Solo la tienda mueve ese estado')
    expect(metricHint('open_subscriptions')).toContain('suma exacta de las tres')
    // One word, one meaning: the figure here is the one the billing notice counts.
    expect(metricHint('suspended_subscriptions')).toContain('aviso de cobros')
  })

  test('the four subscription figures stay in the money section, in the order the API sent them', () => {
    const keys = [
      'active_subscriptions',
      'suspended_subscriptions',
      'lapsed_subscriptions',
      'open_subscriptions',
    ] as const
    const sections = businessSections(panel(keys.map((key) => metric({ key, value: 4 }))))

    expect(sections).toHaveLength(1)
    expect(sections[0]?.key).toBe('money')
    expect(sections[0]?.metrics.map((entry) => entry.key)).toEqual([...keys])
  })

  test('a state behind too few people is withheld, so the total stops adding up on screen', () => {
    const withheld = metric({
      key: 'suspended_subscriptions',
      availability: 'below_threshold',
      value: null,
    })

    expect(metricValue(withheld)).toBe('—')
    expect(metricNote(withheld, 5)).toContain('señalar a alguien')
    expect(metricBadge(withheld).label).toBe('Grupo muy pequeño')
  })

  test('a true zero is a figure: nobody suspended is not the same as nothing measured', () => {
    const none = metric({ key: 'suspended_subscriptions', value: 0 })

    expect(metricValue(none)).toBe('0')
    expect(metricNote(none, 5)).toBeNull()
    expect(metricBadge(none).label).toBe('Medido')
  })

  test('a refusal explains the duty rather than blaming the operator', () => {
    expect(businessMessage('forbidden')).toContain('view_platform_metrics')
    expect(businessMessage('forbidden')).toContain('vencen por diseño')
    expect(businessMessage('network-unavailable')).toBe('No hay conexión con el API.')
    expect(businessMessage('anything-else')).toBe('No se pudo leer cómo va el negocio.')
  })
})
