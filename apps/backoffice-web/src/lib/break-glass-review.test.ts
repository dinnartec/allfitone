import { describe, expect, test } from 'bun:test'

import {
  EMPTY_QUEUE,
  LATE_IS_STILL_REQUIRED,
  backlogSentence,
  debtSentence,
  dueSentence,
  outcomeMeaning,
  overdueCount,
  queueOrder,
  reviewBadge,
  reviewMessage,
  reviewOutcomeMessage,
  type BreakGlassReview,
} from './break-glass-review'

const NOW = new Date('2026-10-17T18:00:00.000Z')

function review(overrides: Partial<BreakGlassReview> = {}): BreakGlassReview {
  return {
    request_id: '019c1000-0000-7000-8000-000000000001',
    case_reference: 'CASE-2026-001',
    purpose: 'customer_support_request',
    categories: ['prior_training_history'],
    sensitivity_tier: 'standard',
    requester_person_id: '019c1000-0000-7000-8000-000000000003',
    subject_person_id: '019c1000-0000-7000-8000-000000000006',
    exercise_count: 2,
    first_exercised_at: '2026-10-17T16:00:00.000Z',
    review_due_at: '2026-10-18T16:00:00.000Z',
    overdue: false,
    reviewed_at: null,
    reviewed_by_person_id: null,
    review_outcome: null,
    reviewed_late: null,
    ...overrides,
  }
}

const overdueCase = () =>
  review({
    case_reference: 'CASE-2026-OLD',
    first_exercised_at: '2026-10-16T06:00:00.000Z',
    review_due_at: '2026-10-17T06:00:00.000Z',
    overdue: true,
  })

describe('break-glass review queue presentation', () => {
  test('a row says what it is: a case that was used, and how many times', () => {
    expect(debtSentence(review(), NOW)).toBe('Se usó hace 2 horas, 2 lecturas en total.')
    expect(debtSentence(review({ exercise_count: 1 }), NOW)).toContain('1 lectura en total')
  })

  test('a case still inside its day says how much is left, not that it is fine', () => {
    expect(dueSentence(review(), NOW)).toBe('Quedan 22 horas de plazo.')
    expect(reviewBadge(review()).label).toBe('Pendiente')
  })

  test('an overdue case says the deadline passed and that it is still pending', () => {
    expect(dueSentence(overdueCase(), NOW)).toBe('Venció el plazo hace 12 horas. Sigue pendiente.')
    expect(reviewBadge(overdueCase())).toEqual({ label: 'Vencido', variant: 'destructive' })
  })

  // The one thing the screen must never imply: the deadline makes the delay visible,
  // it does not void the obligation.
  test('the overdue copy never says the review can no longer be done', () => {
    expect(LATE_IS_STILL_REQUIRED).toContain('sigue siendo obligatoria')
    expect(dueSentence(overdueCase(), NOW)).not.toContain('no se puede')
    expect(reviewMessage('conflict')).not.toContain('plazo')
  })

  test('overdue and late are different facts, and a review settles only the first', () => {
    const late = review({
      reviewed_at: '2026-10-17T17:00:00.000Z',
      reviewed_by_person_id: '019c1000-0000-7000-8000-000000000005',
      review_outcome: 'justified',
      reviewed_late: true,
      overdue: false,
    })

    expect(dueSentence(late, NOW)).toBe('Se revisó fuera de plazo. Queda registrado así.')
    expect(reviewBadge(late)).toEqual({ label: 'Revisado tarde', variant: 'warning' })
    expect(overdueCount([late])).toBe(0)
  })

  test('an incident is a handoff, not a worse verdict', () => {
    const incident = review({
      reviewed_at: '2026-10-17T17:00:00.000Z',
      review_outcome: 'incident_opened',
      reviewed_late: false,
    })

    expect(reviewBadge(incident)).toEqual({ label: 'Incidente', variant: 'destructive' })
    expect(outcomeMeaning('incident_opened')).toContain('pide que alguien haga algo')
    expect(reviewOutcomeMessage(incident)).toBe('Incidente abierto sobre este caso.')
  })

  test('the oldest unreviewed case is first, and what was just reviewed drops below', () => {
    const done = review({
      case_reference: 'CASE-2026-DONE',
      first_exercised_at: '2026-10-15T06:00:00.000Z',
      reviewed_at: '2026-10-17T17:30:00.000Z',
      review_outcome: 'justified',
      reviewed_late: true,
    })

    const ordered = queueOrder([review(), done, overdueCase()])

    expect(ordered.map((entry) => entry.case_reference)).toEqual([
      'CASE-2026-OLD',
      'CASE-2026-001',
      'CASE-2026-DONE',
    ])
  })

  test('the backlog is counted out loud, because one is not nine', () => {
    expect(backlogSentence([])).toBe(EMPTY_QUEUE)
    expect(backlogSentence([review()])).toBe('1 caso espera revisión, ninguno vencido.')
    expect(backlogSentence([review(), overdueCase()])).toBe(
      '2 casos esperan revisión, y 1 ya pasó de las 24 horas.',
    )
  })

  test('a window that was approved and never used is not a debt', () => {
    const unused = review({ first_exercised_at: null, review_due_at: null, exercise_count: 0 })

    expect(debtSentence(unused, NOW)).toContain('nunca se usó')
    expect(dueSentence(unused, NOW)).toBe('Sin plazo: la ventana no se usó.')
  })

  test('a refusal names the duty and the independence, which are two different reasons', () => {
    expect(reviewMessage('forbidden')).toContain('audit_break_glass')
    expect(reviewMessage('forbidden')).toContain('quien lo aprobó')
    expect(reviewMessage('conflict')).toContain('definitiva')
    expect(reviewMessage('anything-else')).toBe('No se pudo registrar la revisión.')
  })

  test('a late verdict says so when it is confirmed, not only in the queue', () => {
    const late = review({
      reviewed_at: '2026-10-17T17:00:00.000Z',
      review_outcome: 'unjustified',
      reviewed_late: true,
    })

    expect(reviewOutcomeMessage(late)).toBe(
      'Caso registrado como no justificado. Queda registrada como tardía.',
    )
  })
})
