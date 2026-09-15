import { describe, expect, test } from 'bun:test'

import {
  accountRecoveryMessage,
  recoveryCommandMessage,
  recoveryOutcomeMessage,
  recoveryStateExplanation,
  recoveryStateLabel,
  recoveryStateTone,
  recoveryUnavailableMessage,
  type BackofficeAccountRecoveryRequest,
} from './account-recovery'

function recovery(
  overrides: Partial<BackofficeAccountRecoveryRequest> = {},
): BackofficeAccountRecoveryRequest {
  return {
    request_id: '019b1000-0000-7000-8000-000000000601',
    person_id: '019b1000-0000-7000-8000-000000000005',
    state: 'awaiting_verification',
    contact_hint: '••••••••ct@example.test',
    case_reference: 'CASE-2026-010',
    created_at: '2026-09-15T05:00:00.000Z',
    delivered_at: '2026-09-15T05:00:05.000Z',
    expires_at: '2026-09-15T05:15:05.000Z',
    confirmed_at: null,
    cancelled_at: null,
    failed_at: null,
    failure_code: null,
    send_count: 1,
    resendable: true,
    cancellable: true,
    ...overrides,
  }
}

describe('account recovery presentation', () => {
  test('the six states of criterion 5 each read differently', () => {
    const states = [
      'initiated',
      'awaiting_verification',
      'confirmed',
      'expired',
      'cancelled',
      'failed',
    ] as const
    const labels = states.map(recoveryStateLabel)
    expect(new Set(labels).size).toBe(states.length)
    expect(recoveryStateLabel('awaiting_verification')).toBe('Esperando verificación')
    expect(recoveryStateTone('expired')).not.toBe(recoveryStateTone('awaiting_verification'))
  })

  test('an email that has not left never reads like one waiting for the person', () => {
    expect(recoveryStateExplanation(recovery({ state: 'initiated' }))).toContain('Todavía no sale')
    expect(recoveryStateExplanation(recovery())).toContain('solo la persona puede usarlo')
  })

  test('a failure says why, and an expired link says it never works again', () => {
    expect(
      recoveryStateExplanation(recovery({ state: 'failed', failure_code: 'contact_changed' })),
    ).toContain('correo verificado de la persona cambió')
    expect(
      recoveryStateExplanation(recovery({ state: 'failed', failure_code: 'delivery_failed' })),
    ).toContain('proveedor de identidad')
    expect(recoveryStateExplanation(recovery({ state: 'expired' }))).toContain(
      'no vuelve a funcionar',
    )
  })

  test('failing closed says so and offers no way around it', () => {
    const message = recoveryUnavailableMessage('no_verified_email')
    expect(message).toContain('no tiene un correo verificado')
    expect(message).toContain('no se aceptan fotos de documentos')
    expect(message).toContain('recuperación no disponible')
    expect(recoveryUnavailableMessage('no_access_account')).toContain('cuenta de acceso')
  })

  test('a cancellation is honest about an email that already left', () => {
    expect(recoveryOutcomeMessage('cancel', recovery({ state: 'cancelled' }))).toContain(
      'no se puede retirar',
    )
    expect(recoveryOutcomeMessage('resend', recovery())).toContain('la misma dirección')
    expect(recoveryOutcomeMessage('start', recovery({ state: 'initiated' }))).toContain(
      '••••••••ct@example.test',
    )
  })

  test('refusals explain themselves', () => {
    expect(accountRecoveryMessage('forbidden')).toContain('deber de soporte')
    expect(recoveryCommandMessage('rate-limited')).toContain('24 horas')
    expect(recoveryCommandMessage('conflict')).toContain('El estado se actualizó')
    expect(recoveryCommandMessage('something-new')).toBe('No se pudo completar la acción.')
  })
})
