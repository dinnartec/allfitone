import { describe, expect, test } from 'bun:test'

import {
  clientInvitationStateLabel,
  clientInvitationStateTone,
  clientInvitationsMessage,
  issuedByLabel,
  notResendableReason,
  offerLabel,
  resendFailureMessage,
  resendOutcomeMessage,
  type BackofficeClientInvitation,
} from './organization-client-invitations'

function invitation(
  overrides: Partial<BackofficeClientInvitation> = {},
): BackofficeClientInvitation {
  return {
    invitation_id: '019b3000-0000-7000-8000-000000000502',
    state: 'expired',
    scope_codes: ['health_context', 'relationship_training'],
    contact_hint: 'l***@example.test',
    created_at: '2026-09-24T12:00:00.000Z',
    expires_at: '2026-10-01T12:00:00.000Z',
    issued_by: 'member',
    reissues_invitation_id: null,
    resendable: true,
    last_resent_at: null,
    ...overrides,
  }
}

describe('client invitation resend presentation', () => {
  test('every state has a label and an expired one never reads like a pending one', () => {
    for (const state of ['pending', 'expired', 'accepted', 'rejected', 'revoked'] as const) {
      expect(clientInvitationStateLabel(state)).not.toBe('')
    }
    expect(clientInvitationStateTone('expired')).not.toBe(clientInvitationStateTone('pending'))
  })

  test('the offer is named, never shown as codes', () => {
    const named = offerLabel(invitation())
    expect(named).toContain('Contexto de salud')
    expect(named).toContain('Entrenamiento de la relación')
    expect(named).not.toContain('health_context')
  })

  test('an invitation that asked for nothing says so instead of showing an empty cell', () => {
    expect(offerLabel(invitation({ scope_codes: [] }))).toBe('No pidió ningún permiso.')
  })

  test('says who signed the invitation', () => {
    expect(issuedByLabel(invitation())).toBe('El gimnasio')
    expect(issuedByLabel(invitation({ issued_by: 'allfit' }))).toContain('Allfit')
  })

  test('a row without a resend says why, and a resendable one says nothing', () => {
    expect(notResendableReason(invitation())).toBeUndefined()
    expect(notResendableReason(invitation({ state: 'accepted', resendable: false }))).toBe(
      'Ya fue aceptada.',
    )
    expect(notResendableReason(invitation({ state: 'revoked', resendable: false }))).toContain(
      'retiró',
    )
    expect(notResendableReason(invitation({ state: 'expired', resendable: false }))).toContain(
      'reemplazó',
    )
  })

  test('the outcome says whether the first email still works and that the offer did not change', () => {
    expect(
      resendOutcomeMessage({ ...invitation({ state: 'pending' }), outcome: 'redelivered' }),
    ).toContain('El primer correo sigue sirviendo')
    const reissued = resendOutcomeMessage({
      ...invitation({ state: 'pending', issued_by: 'allfit' }),
      outcome: 'reissued',
    })
    expect(reissued).toContain('firmada por Allfit')
    expect(reissued).toContain('los mismos permisos')
    expect(reissued).toContain('l***@example.test')
  })

  test('refusals explain themselves', () => {
    expect(clientInvitationsMessage('forbidden')).toContain('deber de soporte')
    expect(resendFailureMessage('rate-limited')).toContain('contando las del gimnasio')
    expect(resendFailureMessage('conflict')).toContain('no coincide')
    expect(resendFailureMessage('something-new')).toBe('No se pudo reenviar la invitación.')
  })
})
