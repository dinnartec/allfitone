import { describe, expect, test } from 'bun:test'

import {
  ATTENTION_DESTINATIONS,
  GYM_CHARGES_NOTE,
  WITHHELD_NOTE,
  attentionMessage,
  billingSummary,
  failureSummary,
  groupLine,
  needsAction,
  unclaimedSummary,
  verificationSummary,
  type SupportAttentionPanel,
} from './attention-panel'

function panel(overrides: Partial<SupportAttentionPanel> = {}): SupportAttentionPanel {
  return {
    generated_at: '2026-09-14T12:00:00.000Z',
    billing: {
      availability: 'available',
      window_hours: 24,
      failed_platform_charges: 0,
      platform_subscriptions_in_grace: 0,
      platform_subscriptions_suspended: 0,
      organization_subscriptions_suspended: 0,
      failed_organization_charges_availability: 'not_modelled',
    },
    credential_verifications: {
      availability: 'available',
      pending_count: 0,
      oldest_requested_at: null,
      renewals_due_count: 0,
    },
    unclaimed_organizations: {
      availability: 'available',
      count: 0,
      oldest_created_at: null,
      needs_follow_up_count: 0,
    },
    repeated_failures: {
      availability: 'available',
      window_hours: 24,
      groups: [],
      groups_truncated: false,
      open_circuits: [],
    },
    ...overrides,
  }
}

const withheldVerifications = {
  availability: 'withheld',
  pending_count: null,
  oldest_requested_at: null,
  renewals_due_count: null,
} as const

describe('attention panel presentation', () => {
  test('a withheld notice never reads as nothing pending', () => {
    expect(verificationSummary(withheldVerifications)).toBe(WITHHELD_NOTE)
    expect(WITHHELD_NOTE).toContain('No significa que no haya nada pendiente')
    expect(
      needsAction(panel({ credential_verifications: withheldVerifications })).verifications,
    ).toBeFalse()
  })

  test('counts credentials waiting and verifications about to lapse', () => {
    expect(
      verificationSummary({
        availability: 'available',
        pending_count: 2,
        oldest_requested_at: '2026-09-01T12:00:00.000Z',
        renewals_due_count: 1,
      }),
    ).toBe(
      '2 títulos esperan revisión, y 1 verificación vence en menos de 30 días sin renovación abierta.',
    )
    expect(verificationSummary(panel().credential_verifications)).toBe(
      'Ningún título espera revisión, y ninguna verificación vence pronto sin renovación abierta.',
    )
  })

  test('a gym waiting on a live invitation is not a follow-up', () => {
    expect(
      unclaimedSummary({
        availability: 'available',
        count: 3,
        oldest_created_at: '2026-09-01T12:00:00.000Z',
        needs_follow_up_count: 0,
      }),
    ).toBe('3 gimnasios sin reclamar, todos con la invitación a su dueño vigente.')
    expect(
      unclaimedSummary({
        availability: 'available',
        count: 3,
        oldest_created_at: '2026-09-01T12:00:00.000Z',
        needs_follow_up_count: 1,
      }),
    ).toContain('1 necesita seguimiento')
    expect(unclaimedSummary(panel().unclaimed_organizations)).toContain('ya tienen dueño')
  })

  test('says how long the window is, and when the list stops', () => {
    expect(failureSummary(panel().repeated_failures)).toBe(
      'Nada se está repitiendo en las últimas 24 horas.',
    )
    expect(
      failureSummary({
        availability: 'available',
        window_hours: 24,
        groups: [
          {
            source: 'notification',
            label: 'identity.invitation_issued.v1',
            affected: 2,
            failures: 5,
            latest_occurred_at: '2026-09-14T11:00:00.000Z',
            last_error_code: 'smtp_timeout',
          },
        ],
        groups_truncated: true,
        open_circuits: [
          {
            event_type: 'identity.invitation_issued.v1',
            state: 'open',
            failure_count: 12,
            opened_until: '2026-09-14T13:00:00.000Z',
          },
        ],
      }),
    ).toBe(
      '1 aviso o comando falla una y otra vez, y 1 canal de entrega está interrumpido en las últimas 24 horas. Se muestran los 20 que más fallan.',
    )
  })

  test('a failure group says how often and how widely, never who', () => {
    expect(
      groupLine({
        source: 'notification',
        label: 'identity.invitation_issued.v1',
        affected: 2,
        failures: 5,
        latest_occurred_at: '2026-09-14T11:00:00.000Z',
        last_error_code: null,
      }),
    ).toBe('5 fallas en 2 avisos')
    expect(
      groupLine({
        source: 'command',
        label: 'OP-ORG-018',
        affected: 2,
        failures: 2,
        latest_occurred_at: '2026-09-14T11:00:00.000Z',
        last_error_code: null,
      }),
    ).toBe('2 atascos en 2 comandos')
  })

  test('each notice leads to the screen that resolves it', () => {
    expect(ATTENTION_DESTINATIONS).toEqual({
      verifications: '/verifications',
      unclaimedOrganizations: '/organizations?status=unclaimed',
      failures: '/diagnosis',
    })
  })

  test('the billing notice counts the charges that failed, the grace and the suspensions', () => {
    expect(
      billingSummary({
        availability: 'available',
        window_hours: 24,
        failed_platform_charges: 2,
        platform_subscriptions_in_grace: 1,
        platform_subscriptions_suspended: 3,
        organization_subscriptions_suspended: 4,
        failed_organization_charges_availability: 'not_modelled',
      }),
    ).toBe(
      '2 cobros de Pro fallaron en las últimas 24 horas, 1 renovación está en gracia y 7 suscripciones están suspendidas.',
    )
  })

  test('nothing pending says so, because zero is an answer', () => {
    expect(
      billingSummary({
        availability: 'available',
        window_hours: 24,
        failed_platform_charges: 0,
        platform_subscriptions_in_grace: 0,
        platform_subscriptions_suspended: 0,
        organization_subscriptions_suspended: 0,
        failed_organization_charges_availability: 'not_modelled',
      }),
    ).toBe(
      'ningún cobro de Pro falló en las últimas 24 horas, ninguna renovación está en periodo de gracia y ninguna suscripción está suspendida.',
    )
  })

  test('and whoever cannot read it is told why, never zero', () => {
    expect(
      billingSummary({
        availability: 'withheld',
        window_hours: 24,
        failed_platform_charges: null,
        platform_subscriptions_in_grace: null,
        platform_subscriptions_suspended: null,
        organization_subscriptions_suspended: null,
        failed_organization_charges_availability: null,
      }),
    ).toBe(WITHHELD_NOTE)
  })

  test('a charge with a clock on it earns the warning tone; a suspension does not', () => {
    expect(
      needsAction(
        panel({
          billing: {
            availability: 'available',
            window_hours: 24,
            failed_platform_charges: 1,
            platform_subscriptions_in_grace: 0,
            platform_subscriptions_suspended: 0,
            organization_subscriptions_suspended: 0,
            failed_organization_charges_availability: 'not_modelled',
          },
        }),
      ).billing,
    ).toBe(true)
    expect(
      needsAction(
        panel({
          billing: {
            availability: 'available',
            window_hours: 24,
            failed_platform_charges: 0,
            platform_subscriptions_in_grace: 0,
            platform_subscriptions_suspended: 9,
            organization_subscriptions_suspended: 9,
            failed_organization_charges_availability: 'not_modelled',
          },
        }),
      ).billing,
    ).toBe(false)
  })

  test("a gym's failed charge is said to be unknown, so nobody reads it as none", () => {
    expect(GYM_CHARGES_NOTE).toContain('no sabemos todavía si fallan')
  })

  test('a refusal explains that the base role grants nothing', () => {
    expect(attentionMessage('forbidden')).toContain('no basta por sí solo')
    expect(attentionMessage('unknown-code')).toBe('No se pudo leer lo que necesita atención.')
  })
})
