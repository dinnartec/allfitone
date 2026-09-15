import { describe, expect, test } from 'bun:test'

import {
  issuedByLabel,
  notResendableReason,
  resendFailureMessage,
  resendOutcomeMessage,
  teamInvitationStateLabel,
  teamInvitationStateTone,
  teamInvitationsMessage,
  type BackofficeTeamInvitation,
} from './organization-team-invitations'

function invitation(overrides: Partial<BackofficeTeamInvitation> = {}): BackofficeTeamInvitation {
  return {
    invitation_id: '019af000-0000-7000-8000-000000000502',
    state: 'expired',
    proposed_role_code: 'staff',
    contact_hint: 'e***@example.test',
    created_at: '2026-09-06T12:00:00.000Z',
    expires_at: '2026-09-13T12:00:00.000Z',
    issued_by: 'member',
    reissues_invitation_id: null,
    resendable: true,
    last_resent_at: null,
    ...overrides,
  }
}

describe('team invitation resend presentation', () => {
  test('every state has a label and an expired one never reads like a pending one', () => {
    for (const state of ['pending', 'expired', 'accepted', 'rejected', 'revoked'] as const) {
      expect(teamInvitationStateLabel(state)).not.toBe('')
    }
    expect(teamInvitationStateTone('expired')).not.toBe(teamInvitationStateTone('pending'))
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

  test('the outcome says whether the first email still works or a new one replaced it', () => {
    expect(
      resendOutcomeMessage({ ...invitation({ state: 'pending' }), outcome: 'redelivered' }),
    ).toContain('El primer correo sigue sirviendo')
    const reissued = resendOutcomeMessage({
      ...invitation({ state: 'pending', issued_by: 'allfit' }),
      outcome: 'reissued',
    })
    expect(reissued).toContain('firmada por Allfit')
    expect(reissued).toContain('no vuelve a funcionar')
    expect(reissued).toContain('e***@example.test')
  })

  test('refusals explain themselves', () => {
    expect(teamInvitationsMessage('forbidden')).toContain('deber de soporte')
    expect(resendFailureMessage('rate-limited')).toContain('contando las del gimnasio')
    expect(resendFailureMessage('conflict')).toContain('ya no se puede reenviar')
    expect(resendFailureMessage('something-new')).toBe('No se pudo reenviar la invitación.')
  })
})
