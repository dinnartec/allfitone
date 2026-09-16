import { describe, expect, test } from 'bun:test'

import {
  NOT_MODELLED_NOTE,
  businessMessage,
  businessSections,
  metricBadge,
  metricHint,
  metricLabel,
  metricNote,
  metricValue,
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
  return { generated_at: '2026-09-17T18:00:00.000Z', minimum_aggregate: 5, metrics }
}

describe('business panel presentation', () => {
  test('a figure the platform cannot give is blank with a reason, never zero', () => {
    const space = metric({
      key: 'active_people_this_week',
      availability: 'not_modelled',
      value: null,
      reason: 'space_sessions_not_recorded',
      period: WEEK,
    })
    const payments = metric({
      key: 'active_subscriptions',
      availability: 'not_modelled',
      value: null,
      reason: 'payments_not_modelled',
    })

    expect(metricValue(space)).toBe('—')
    expect(metricNote(space, 5)).toContain('No es cero')
    expect(metricValue(payments)).toBe('—')
    expect(metricNote(payments, 5)).toContain('todavía no guarda pagos')
    expect(metricBadge(space).label).toBe('Sin datos aún')
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
        metric({ key: 'billed_this_month', availability: 'not_modelled', value: null }),
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

  test('the two activity figures are labelled apart, because they are not the same question', () => {
    expect(metricLabel('active_people_this_week')).toBe('Personas activas entrenando')
    expect(metricLabel('studio_active_professionals_this_week')).toBe(
      'Profesionales activos en Studio',
    )
    expect(metricHint('studio_active_professionals_this_week')).toContain('no sustituye')
    expect(metricLabel('a_key_nobody_wrote_a_label_for')).toBe('a_key_nobody_wrote_a_label_for')
    expect(metricHint('a_key_nobody_wrote_a_label_for')).toBeNull()
  })

  test('a refusal explains the duty rather than blaming the operator', () => {
    expect(businessMessage('forbidden')).toContain('view_platform_metrics')
    expect(businessMessage('forbidden')).toContain('vencen por diseño')
    expect(businessMessage('network-unavailable')).toBe('No hay conexión con el API.')
    expect(businessMessage('anything-else')).toBe('No se pudo leer cómo va el negocio.')
  })
})
