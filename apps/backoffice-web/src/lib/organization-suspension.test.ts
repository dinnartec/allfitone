import { describe, expect, test } from 'bun:test'

import {
  SUSPENSION_REASONS,
  WHAT_REACTIVATING_DOES,
  WHAT_SUSPENDING_DOES,
  WHAT_SUSPENDING_DOES_NOT_DO,
  blockedSentence,
  costWarning,
  periodSentence,
  reasonLabel,
  stateSentence,
  suspensionMessage,
  suspensionOutcomeMessage,
  type OrganizationSuspension,
} from './organization-suspension'

function suspension(overrides: Partial<OrganizationSuspension> = {}): OrganizationSuspension {
  return {
    organization_id: '019af000-0000-7000-8000-000000000301',
    status: 'active',
    suspended: false,
    suspended_at: null,
    current: null,
    history: [],
    ...overrides,
  }
}

const stopped = () =>
  suspension({
    status: 'suspended',
    suspended: true,
    suspended_at: '2026-10-18T15:00:00.000Z',
    current: {
      suspension_id: '019af000-0000-7000-8000-000000000801',
      reason_code: 'nonpayment',
      started_at: '2026-10-18T15:00:00.000Z',
      started_by_person_id: '019af000-0000-7000-8000-000000000003',
      people_blocked: 2,
    },
  })

describe('organization suspension presentation', () => {
  test('the panel says what is true right now before anything else', () => {
    expect(stateSentence(suspension())).toContain('nunca ha estado suspendido')
    expect(stateSentence(stopped())).toBe('Suspendido: no le está pagando a allfit.')
  })

  // The word invites the reader to imagine deletion. The copy has to refuse that
  // reading explicitly, or the operator will either not use it or expect the wrong
  // thing from it.
  test('the copy says what suspending does not do, not only what it does', () => {
    expect(WHAT_SUSPENDING_DOES).toContain('deja de operar')
    expect(WHAT_SUSPENDING_DOES).toContain('plan gratuito')
    expect(WHAT_SUSPENDING_DOES_NOT_DO).toContain('No termina ninguna relación')
    expect(WHAT_SUSPENDING_DOES_NOT_DO).toContain('no borra nada')
    expect(WHAT_SUSPENDING_DOES_NOT_DO).toContain('pausados')
  })

  test('reactivating is described as subtractive, never as a restore', () => {
    expect(WHAT_REACTIVATING_DOES).toContain('No restaura una copia anterior')
    expect(WHAT_REACTIVATING_DOES).toContain('no revive')
    expect(WHAT_REACTIVATING_DOES).toContain('sigue aplicando')
  })

  test('the cost is said before the decision, counted against this gym', () => {
    expect(costWarning(12)).toContain('12 personas')
    expect(costWarning(12)).toContain('Nadie sale del gimnasio')
    expect(costWarning(1)).toContain('1 persona')
    expect(costWarning(0)).toContain('no atiende a nadie')
  })

  test('and read back afterwards from the causes the decision opened', () => {
    expect(blockedSentence(stopped())).toBe(
      '2 personas dejaron de recibir servicio de este gimnasio. Ninguna perdió nada.',
    )
    expect(blockedSentence(suspension())).toBe('')
  })

  test('the record outlives the state: a gym operating still says it was stopped', () => {
    const recovered = suspension({
      history: [
        {
          suspension_id: '019af000-0000-7000-8000-000000000801',
          reason_code: 'nonpayment',
          started_at: '2026-10-18T15:00:00.000Z',
          started_by_person_id: '019af000-0000-7000-8000-000000000003',
          ended_at: '2026-10-18T18:00:00.000Z',
          ended_by_person_id: '019af000-0000-7000-8000-000000000003',
        },
      ],
    })

    expect(stateSentence(recovered)).toContain('Estuvo suspendido antes')
    const [period] = recovered.history
    expect(period && periodSentence(period)).toBe('no le está pagando a allfit, levantada')
  })

  test('every agreed reason has a label, because the stored code is not readable', () => {
    for (const reason of SUSPENSION_REASONS) {
      expect(reasonLabel(reason).length).toBeGreaterThan(0)
    }
    expect(reasonLabel('nonpayment')).toBe('No le está pagando a Allfit')
  })

  test('a refusal names the duty, and a conflict names the states that do not qualify', () => {
    expect(suspensionMessage('forbidden')).toContain('manage_organization_lifecycle')
    expect(suspensionMessage('conflict')).toContain('sin reclamar, cancelado o cerrado')
    expect(suspensionMessage('anything-else')).toBe('No se pudo cambiar el estado del gimnasio.')
  })

  test('the confirmation repeats that nothing was destroyed', () => {
    expect(suspensionOutcomeMessage(stopped())).toContain('2 personas')
    expect(suspensionOutcomeMessage(stopped())).toContain('No se terminó ninguna relación')
    expect(suspensionOutcomeMessage(suspension())).toContain(
      'el bloqueo de esta suspensión y nada más',
    )
  })
})
