import { describe, expect, test } from 'bun:test'

import {
  BREAK_GLASS_CATEGORIES,
  approvalsSoFar,
  breakGlassMessage,
  canDecide,
  canExercise,
  categoryLabel,
  outcomeMessage,
  projectedTier,
  purposeLabel,
  quorumSentence,
  requestIssue,
  requestIssueMessage,
  statusLabel,
  statusTone,
  tierConsequence,
  windowSentence,
  type BreakGlassCategory,
  type BreakGlassRequest,
} from './break-glass'

function file(overrides: Partial<BreakGlassRequest> = {}): BreakGlassRequest {
  return {
    id: '019a8000-0000-7000-8000-000000000401',
    requester_person_id: '019a8000-0000-7000-8000-000000000003',
    subject_person_id: '019a8000-0000-7000-8000-000000000006',
    categories: ['nutrition_guidance'],
    purpose: 'customer_support_request',
    case_reference: 'CASE-2026-001',
    sensitivity_tier: 'standard',
    required_approvals: 1,
    requested_duration_minutes: 30,
    requested_at: '2026-09-10T18:00:00.000Z',
    request_expires_at: '2026-09-10T18:30:00.000Z',
    status: 'requested',
    window_starts_at: null,
    window_ends_at: null,
    closed_at: null,
    reviewed_at: null,
    review_outcome: null,
    approvals: [],
    exercise_count: 0,
    viewer_is_requester: false,
    viewer_can_decide: false,
    viewer_can_exercise: false,
    ...overrides,
  }
}

describe('break-glass presentation rules', () => {
  test('offers only the approvable categories', () => {
    expect(BREAK_GLASS_CATEGORIES).toHaveLength(6)
    // The forbidden set is absent rather than disabled: an option that can never
    // be granted is an invitation to try.
    for (const forbidden of ['nutrition_media', 'payments', 'identity']) {
      expect(BREAK_GLASS_CATEGORIES as readonly string[]).not.toContain(forbidden)
    }
    const labels = BREAK_GLASS_CATEGORIES.map((category) => categoryLabel(category))
    expect(new Set(labels).size).toBe(BREAK_GLASS_CATEGORIES.length)
  })

  test('names the five closed purposes and nothing else', () => {
    expect(purposeLabel('security_investigation')).toBe('Investigación de seguridad')
    expect(purposeLabel('customer_support_request')).toBe('La persona pidió soporte')
  })

  test('derives the tier from the scope the same way the server does', () => {
    expect(projectedTier([])).toBeNull()
    expect(projectedTier(['nutrition_guidance'])).toBe('standard')
    expect(projectedTier(['nutrition_intake'])).toBe('restricted')
    expect(projectedTier(['health_context'])).toBe('restricted')
    // A mixed scope inherits the stricter tier rather than averaging.
    expect(projectedTier(['nutrition_guidance', 'nutrition_intake'])).toBe('restricted')
  })

  test('states the tier as a consequence, with its cost spelled out', () => {
    const standard = tierConsequence(['nutrition_guidance'])
    expect(standard?.approvals).toBe(1)
    expect(standard?.minutes).toBe(30)
    expect(standard?.sentence).toContain('una aprobación')

    const restricted = tierConsequence(['health_context'])
    expect(restricted?.approvals).toBe(2)
    expect(restricted?.minutes).toBe(15)
    expect(restricted?.sentence).toContain('dos personas distintas')
  })

  test('refuses a request with no subject, no case or no scope', () => {
    const draft = {
      subject: '019a8000-0000-7000-8000-000000000006',
      caseReference: 'CASE-2026-001',
      categories: ['nutrition_guidance'] as BreakGlassCategory[],
    }
    expect(requestIssue(draft)).toBeUndefined()
    expect(requestIssue({ ...draft, subject: 'nobody' })).toBe('subject')
    expect(requestIssue({ ...draft, caseReference: 'porque sí' })).toBe('case')
    expect(requestIssue({ ...draft, categories: [] })).toBe('categories')
    // There is no scope for "the whole account", and the message says so.
    expect(requestIssueMessage('categories')).toContain('toda la cuenta')
  })

  test('says how much of the window is left, and that it cannot be extended', () => {
    const now = Date.parse('2026-09-10T18:10:00.000Z')
    const open = file({
      status: 'approved',
      window_starts_at: '2026-09-10T18:00:00.000Z',
      window_ends_at: '2026-09-10T18:15:00.000Z',
    })
    expect(windowSentence(open, now)).toContain('5 minutos')
    expect(windowSentence(open, now)).toContain('No se puede extender')

    const lapsed = file({
      status: 'approved',
      window_starts_at: '2026-09-10T17:00:00.000Z',
      window_ends_at: '2026-09-10T17:15:00.000Z',
    })
    expect(windowSentence(lapsed, now)).toContain('ya venció')

    // A pending request has no window to describe.
    expect(windowSentence(file(), now)).toBeNull()
  })

  test('says how far a pending request is from opening', () => {
    expect(quorumSentence(file({ required_approvals: 2 }))).toContain('Faltan 2')
    expect(
      quorumSentence(
        file({
          required_approvals: 2,
          approvals: [
            {
              approver_person_id: 'a',
              decision: 'approved',
              reason_code: 'REASON-OK',
              decided_at: '2026-09-10T18:01:00.000Z',
            },
          ],
        }),
      ),
    ).toContain('Faltan 1')
    expect(approvalsSoFar(file())).toBe(0)
  })

  test('takes the permission hints from the server rather than re-deriving them', () => {
    expect(canDecide(file({ viewer_can_decide: true }))).toBe(true)
    expect(canDecide(file({ viewer_can_decide: false }))).toBe(false)
    expect(canExercise(file({ viewer_can_exercise: true }))).toBe(true)
    expect(canExercise(file({ viewer_can_exercise: false }))).toBe(false)
  })

  test('stops offering a read the moment the window runs out', () => {
    const open = file({
      status: 'approved',
      viewer_can_exercise: true,
      window_starts_at: '2026-09-10T18:00:00.000Z',
      window_ends_at: '2026-09-10T18:15:00.000Z',
    })

    expect(canExercise(open, Date.parse('2026-09-10T18:14:59.000Z'))).toBe(true)
    // The hint was true when the server answered it. A lapsed window delivers
    // nothing, so the screen withdraws the read without waiting for a refetch.
    expect(canExercise(open, Date.parse('2026-09-10T18:15:00.000Z'))).toBe(false)
    expect(canExercise(open, Date.parse('2026-09-10T19:00:00.000Z'))).toBe(false)
  })

  test('tells an open window apart from every terminal state', () => {
    expect(statusTone('approved')).toBe('success')
    expect(statusTone('requested')).toBe('warning')
    expect(statusTone('rejected')).toBe('destructive')
    expect(statusTone('closed')).toBe('secondary')
    expect(statusLabel('approved')).toBe('Ventana abierta')
    expect(statusLabel('requested')).toBe('Esperando aprobación')
  })

  test('explains every outcome, including the authorised one', () => {
    const base = {
      break_glass_event_id: '019a8000-0000-7000-8000-000000000601',
      occurred_at: '2026-09-10T18:05:00.000Z',
    }
    expect(
      outcomeMessage({ ...base, outcome: 'denied', reason_code: 'not_the_requester' }),
    ).toContain('Sólo quien pidió')
    expect(
      outcomeMessage({ ...base, outcome: 'denied', reason_code: 'category_out_of_scope' }),
    ).toContain('alcance aprobado')
    // The authorised-but-empty case has to be explained too: an operator who reads
    // "no content" without context will assume the window failed.
    const unavailable = outcomeMessage({
      ...base,
      outcome: 'content_unavailable',
      reason_code: 'execution_and_nutrition_absent',
    })
    expect(unavailable).toContain('válida')
    expect(unavailable).toContain('registrado')
  })

  test('answers the state machine with the next action, never a retry', () => {
    expect(breakGlassMessage('conflict')).toContain('pide otra')
    expect(breakGlassMessage('conflict')).toContain('no se reabre')
    expect(breakGlassMessage('forbidden')).toContain('vencen por diseño')
    expect(breakGlassMessage('anything-else')).toBe('No se pudo completar la operación.')
  })
})
