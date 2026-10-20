import { describe, expect, test } from 'bun:test'

import {
  LOWERING_NOTE,
  UNLIMITED_NOTE,
  draftWarning,
  lastChangeSentence,
  occupancySentence,
  parseSeats,
  placesLeftSentence,
  quotaMessage,
  quotaOutcomeMessage,
  quotaSentence,
  type OrganizationGuestQuota,
} from './organization-guest-quota'

const ORGANIZATION = '019ab000-0000-7000-8000-000000000301'
const PERSON = '019ab000-0000-7000-8000-000000000003'
const ASSIGNMENT = '019ab000-0000-7000-8000-000000000701'

function quota(overrides: Partial<OrganizationGuestQuota> = {}): OrganizationGuestQuota {
  return {
    organization_id: ORGANIZATION,
    seats: 50,
    occupied: 3,
    relationships_active: 2,
    invitations_pending: 1,
    places_left: 47,
    over_quota: false,
    last_change: {
      at: '2026-10-15T15:00:00.000Z',
      by_person_id: PERSON,
      by_duty_assignment_id: ASSIGNMENT,
      previous_seats: null,
    },
    ...overrides,
  }
}

describe('what a gym may fill, as the panel says it', () => {
  test('a gym with a number is told what it is', () => {
    expect(quotaSentence(quota())).toBe('Puede tener 50 personas a la vez.')
    expect(quotaSentence(quota({ seats: 1 }))).toBe('Puede tener 1 persona a la vez.')
  })

  test('never having a quota is told apart from a deal with no cap', () => {
    expect(quotaSentence(quota({ seats: null, last_change: null }))).toContain(
      'No tiene cupo fijado',
    )
    expect(quotaSentence(quota({ seats: null }))).toContain('acuerdo sin tope')
  })

  test('the occupancy keeps relationships and unanswered invitations apart', () => {
    expect(occupancySentence(quota())).toBe(
      'Ocupa 3: 2 relaciones vigentes y 1 invitación sin responder.',
    )
    expect(occupancySentence(quota({ occupied: 2, invitations_pending: 0 }))).toContain(
      'ninguna invitación sin responder',
    )
  })

  test('what is left is counted, and no limit leaves nothing to count', () => {
    expect(placesLeftSentence(quota())).toBe('Le quedan 47 lugares.')
    expect(placesLeftSentence(quota({ places_left: 1 }))).toBe('Le queda 1 lugar.')
    expect(placesLeftSentence(quota({ places_left: 0 }))).toBe('No le queda ningún lugar.')
    expect(placesLeftSentence(quota({ seats: null, places_left: null }))).toContain(
      'no tiene límite',
    )
  })

  test('over its quota says by how much, and that nobody is thrown out', () => {
    const line = placesLeftSentence(
      quota({ seats: 1, occupied: 3, places_left: 0, over_quota: true }),
    )
    expect(line).toContain('por encima de su cupo en 2 personas')
    expect(line).toContain('invitaciones nuevas')
  })

  test('the last change says what the number replaced, including no limit', () => {
    expect(lastChangeSentence(quota())).toBe('Último cambio: antes no tenía límite.')
    expect(
      lastChangeSentence(
        quota({
          last_change: {
            at: '2026-10-15T15:00:00.000Z',
            by_person_id: PERSON,
            by_duty_assignment_id: ASSIGNMENT,
            previous_seats: 20,
          },
        }),
      ),
    ).toBe('Último cambio: antes eran 20 personas.')
    expect(lastChangeSentence(quota({ last_change: null }))).toContain('Nadie ha fijado el cupo')
  })

  test('no limit is a decision, and an empty box is not one', () => {
    expect(parseSeats('', true)).toEqual({ seats: null })
    expect(parseSeats('50', false)).toEqual({ seats: 50 })
    expect(parseSeats('  50 ', false)).toEqual({ seats: 50 })
    expect(parseSeats('', false)).toBeUndefined()
    expect(parseSeats('0', false)).toBeUndefined()
    expect(parseSeats('-1', false)).toBeUndefined()
    expect(parseSeats('1.5', false)).toBeUndefined()
    expect(parseSeats('1000001', false)).toBeUndefined()
    expect(parseSeats('cincuenta', false)).toBeUndefined()
  })

  test('a number below the occupancy is warned about before it is sent', () => {
    expect(draftWarning({ seats: 1 }, quota())).toContain('por debajo de lo que ya ocupa, por 2')
    expect(draftWarning({ seats: 2 }, quota())).toContain('1 persona')
    expect(draftWarning({ seats: 3 }, quota())).toBeUndefined()
    expect(draftWarning({ seats: null }, quota())).toBeUndefined()
    expect(draftWarning(undefined, quota())).toBeUndefined()
  })

  test('the notes say what nobody can read off the number', () => {
    expect(UNLIMITED_NOTE).toContain('Sin cupo fijado')
    expect(LOWERING_NOTE).toContain('no termina ninguna relación')
  })

  test('a refusal names the duty that is missing, which creates no gym', () => {
    expect(quotaMessage('forbidden')).toContain('manage_platform_commercial')
    expect(quotaMessage('conflict')).toContain('ya no opera')
    expect(quotaMessage('network-unavailable')).toContain('El cupo no cambió')
    expect(quotaMessage('unknown')).toBe('No se pudo fijar el cupo.')
  })

  test('and the outcome repeats the number that was written', () => {
    expect(quotaOutcomeMessage(quota({ seats: 50 }))).toContain('50 personas')
    expect(quotaOutcomeMessage(quota({ seats: null }))).toContain('sin límite')
  })
})
