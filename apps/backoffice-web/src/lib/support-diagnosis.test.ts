import { describe, expect, test } from 'bun:test'

import {
  SUPPORT_OPERATION_STATES,
  circuitSummary,
  circuitTone,
  needsAttention,
  operationStateLabel,
  operationStateTone,
  sourceLabel,
  supportDiagnosisMessage,
  type SupportDeliveryCircuit,
  type SupportOperation,
} from './support-diagnosis'

function operation(overrides: Partial<SupportOperation> = {}): SupportOperation {
  return {
    source: 'notification',
    reference_id: '019a6000-0000-7000-8000-000000000301',
    subject_kind: 'invitation',
    subject_id: '019a6000-0000-7000-8000-000000000401',
    label: 'identity.invitation_issued.v1',
    state: 'retrying',
    occurred_at: '2026-09-10T18:00:00.000Z',
    attempt_count: 3,
    last_error_code: 'smtp_timeout',
    resolved_at: null,
    ...overrides,
  }
}

function circuit(overrides: Partial<SupportDeliveryCircuit> = {}): SupportDeliveryCircuit {
  return {
    event_type: 'identity.invitation_issued.v1',
    state: 'closed',
    window_started_at: '2026-09-10T17:00:00.000Z',
    success_count: 40,
    failure_count: 0,
    opened_until: null,
    ...overrides,
  }
}

describe('technical diagnosis vocabulary', () => {
  test('names every state the feed can answer', () => {
    const labels = SUPPORT_OPERATION_STATES.map((state) => operationStateLabel(state))
    expect(new Set(labels).size).toBe(SUPPORT_OPERATION_STATES.length)
    expect(sourceLabel('notification')).toBe('Aviso')
    expect(sourceLabel('command')).toBe('Comando')
  })

  test('a queue with nothing sent yet does not read as a wall of failures', () => {
    expect(operationStateTone('pending')).toBe('secondary')
    expect(operationStateTone('processing')).toBe('secondary')
    expect(operationStateLabel('pending')).toBe('Sin enviar todavía')
  })

  test('still trying is warned about, having given up is a failure', () => {
    expect(operationStateTone('retrying')).toBe('warning')
    expect(operationStateTone('dead_lettered')).toBe('destructive')
    expect(operationStateTone('stalled')).toBe('destructive')
    expect(operationStateTone('rejected_final')).toBe('destructive')
  })

  test('only what somebody has to act on needs attention', () => {
    expect(needsAttention(operation({ state: 'dead_lettered' }))).toBe(true)
    expect(needsAttention(operation({ state: 'stalled' }))).toBe(true)
    expect(needsAttention(operation({ state: 'retrying' }))).toBe(false)
    expect(needsAttention(operation({ state: 'pending' }))).toBe(false)
    expect(needsAttention(operation({ state: 'delivered' }))).toBe(false)
  })

  test('a healthy set of channels says nothing rather than reassuring', () => {
    expect(circuitSummary([])).toBeNull()
    expect(circuitSummary([circuit(), circuit({ event_type: 'other.v1' })])).toBeNull()
  })

  test('a tripped channel is named, because it is usually the whole answer', () => {
    const summary = circuitSummary([circuit({ state: 'open', failure_count: 12 })])
    expect(summary).toContain('identity.invitation_issued.v1')
    expect(summary).toContain('causa más probable')
  })

  test('several tripped channels are counted instead of listed', () => {
    const summary = circuitSummary([
      circuit({ state: 'open' }),
      circuit({ event_type: 'other.v1', state: 'half_open' }),
    ])
    expect(summary).toContain('2 canales')
  })

  test('a channel state maps to a tone an operator can scan', () => {
    expect(circuitTone('open')).toBe('destructive')
    expect(circuitTone('half_open')).toBe('warning')
    expect(circuitTone('closed')).toBe('success')
  })

  test('explains a refusal as an expired duty rather than a mistake', () => {
    expect(supportDiagnosisMessage('forbidden')).toContain('vencen por diseño')
    expect(supportDiagnosisMessage('anything-else')).toBe('No se pudo leer el estado técnico.')
  })
})
