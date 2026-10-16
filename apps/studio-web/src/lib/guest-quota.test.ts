import { describe, expect, test } from 'bun:test'

import {
  QUOTA_FULL_MESSAGE,
  guestQuotaOf,
  invitationBlockedReason,
  quotaSummary,
} from './guest-quota'
import type { ClientDirectoryPage, StudioGuestQuota } from './studio-api'

const OPEN: StudioGuestQuota = { seats: 5, occupied: 3, places_left: 2, over_quota: false }
const FULL: StudioGuestQuota = { seats: 5, occupied: 5, places_left: 0, over_quota: false }
const OVER: StudioGuestQuota = { seats: 2, occupied: 4, places_left: 0, over_quota: true }
const UNLIMITED: StudioGuestQuota = {
  seats: null,
  occupied: 40,
  places_left: null,
  over_quota: false,
}

describe('when the invitation form says why it cannot send', () => {
  test('a gym with places left is not stopped', () => {
    expect(invitationBlockedReason(OPEN)).toBeUndefined()
  })

  test('a full gym is stopped, with the figures that explain it', () => {
    const reason = invitationBlockedReason(FULL)
    expect(reason).toContain('5 de 5 lugares ocupados')
    expect(reason).toContain('no queda ningún lugar')
  })

  test('a gym over its quota is stopped and told nobody leaves because of it', () => {
    const reason = invitationBlockedReason(OVER)
    expect(reason).toContain('por encima de su cupo')
    expect(reason).toContain('Nadie sale')
  })

  test('a gym with no quota is never stopped, however many people it has', () => {
    expect(invitationBlockedReason(UNLIMITED)).toBeUndefined()
  })

  test('a figure that has not arrived stops nothing and claims nothing', () => {
    expect(invitationBlockedReason(undefined)).toBeUndefined()
    expect(quotaSummary(undefined)).toBeUndefined()
  })
})

describe('how full the gym is, in words', () => {
  test('a gym with places left says how many', () => {
    expect(quotaSummary(OPEN)).toBe('3 de 5 lugares ocupados. Quedan 2 lugares.')
  })

  test('one place left is singular', () => {
    expect(quotaSummary({ ...OPEN, occupied: 4, places_left: 1 })).toBe(
      '4 de 5 lugares ocupados. Queda 1 lugar.',
    )
  })

  test('a full gym says none is left rather than drawing a zero', () => {
    expect(quotaSummary(FULL)).toBe('5 de 5 lugares ocupados. No queda ningún lugar.')
  })

  test('a gym with no quota says it has none, and no places-left figure is invented', () => {
    const sentence = quotaSummary(UNLIMITED)
    expect(sentence).toBe('Este gimnasio no tiene un cupo de personas fijado.')
    expect(sentence).not.toMatch(/\b0\b/)
  })

  test('a gym over its quota says so', () => {
    expect(quotaSummary(OVER)).toContain('por encima de su cupo')
  })
})

describe('where the figure comes from', () => {
  test('it is read from the first page of the directory', () => {
    const page = (guest_quota: StudioGuestQuota) =>
      ({ data: [], page: { has_more: true, next_cursor: 'x' }, guest_quota }) as ClientDirectoryPage
    expect(guestQuotaOf({ pages: [page(FULL), page(OPEN)], pageParams: [null, 'x'] })).toEqual(FULL)
  })

  test('there is none before the directory has answered', () => {
    expect(guestQuotaOf(undefined)).toBeUndefined()
    expect(guestQuotaOf({ pages: [], pageParams: [] })).toBeUndefined()
  })

  test('the stale-form refusal promises nothing was sent', () => {
    expect(QUOTA_FULL_MESSAGE).toContain('No se envió nada')
  })
})
