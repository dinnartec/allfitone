/**
 * `HU-BO-034` — presentation rules for what a gym may fill.
 *
 * **Three states, and none of them is zero.** A gym can have a number, can have been
 * sold a deal with no cap, or can never have been sold anything. The last two look the
 * same on the row — no limit — and are told apart only by whether anybody ever decided
 * it, so the screen says which one it is reading.
 *
 * **A number alone cannot be judged.** The occupancy travels with the quota, and the
 * form shows it while somebody is typing: 20 is a reasonable quota for a gym with 12
 * people and a mistake for one with 300.
 *
 * **Over its quota is not an error.** It is what lowering the number does, and it ends
 * nothing. The screen says what it means — no new invitations until there is room —
 * rather than drawing it as a failure of the gym.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type OrganizationGuestQuota = AllfitV1Schemas['OrganizationGuestQuota']

export const MAX_SEATS = 1_000_000

export const UNLIMITED_NOTE =
  'Sin cupo fijado el gimnasio no tiene límite. Es lo que tienen todos los gimnasios hasta que alguien escribe el número que se les vendió.'

export const LOWERING_NOTE =
  'Bajar el cupo no termina ninguna relación ni retira ninguna invitación ya enviada. Solo impide enviar invitaciones nuevas hasta que haya lugar.'

/** What the gym was sold, which is a different question from what it is using. */
export function quotaSentence(quota: OrganizationGuestQuota): string {
  if (quota.seats === null) {
    return quota.last_change === null
      ? 'No tiene cupo fijado: sin límite.'
      : 'Tiene un acuerdo sin tope: sin límite, y alguien lo decidió así.'
  }
  const people = quota.seats === 1 ? '1 persona' : `${quota.seats} personas`
  return `Puede tener ${people} a la vez.`
}

/**
 * What stands against the quota. The two figures are kept apart because an unanswered
 * invitation is a place taken by nobody yet, and that reads differently.
 */
export function occupancySentence(quota: OrganizationGuestQuota): string {
  const relationships =
    quota.relationships_active === 1
      ? '1 relación vigente'
      : `${quota.relationships_active} relaciones vigentes`
  const invitations =
    quota.invitations_pending === 0
      ? 'ninguna invitación sin responder'
      : quota.invitations_pending === 1
        ? '1 invitación sin responder'
        : `${quota.invitations_pending} invitaciones sin responder`
  return `Ocupa ${quota.occupied}: ${relationships} y ${invitations}.`
}

export function placesLeftSentence(quota: OrganizationGuestQuota): string {
  if (quota.seats === null) return 'No hay lugares que contar: no tiene límite.'
  if (quota.over_quota) {
    const excess = quota.occupied - quota.seats
    const people = excess === 1 ? '1 persona' : `${excess} personas`
    return `Está por encima de su cupo en ${people}. No puede enviar invitaciones nuevas hasta que haya lugar.`
  }
  if (quota.places_left === 0) return 'No le queda ningún lugar.'
  return quota.places_left === 1 ? 'Le queda 1 lugar.' : `Le quedan ${quota.places_left} lugares.`
}

/** Criterion 3, read back: who decided it, when, and what it replaced. */
export function lastChangeSentence(quota: OrganizationGuestQuota): string {
  const change = quota.last_change
  if (change === null) return 'Nadie ha fijado el cupo de este gimnasio todavía.'
  const previous =
    change.previous_seats === null
      ? 'antes no tenía límite'
      : change.previous_seats === 1
        ? 'antes era 1 persona'
        : `antes eran ${change.previous_seats} personas`
  return `Último cambio: ${previous}.`
}

export type SeatsDraft = { seats: number | null } | undefined

/**
 * What the form will send. `null` is a deal with no cap and is a decision; an empty
 * box is not one, so it is refused rather than read as no limit.
 */
export function parseSeats(value: string, unlimited: boolean): SeatsDraft {
  if (unlimited) return { seats: null }
  const trimmed = value.trim()
  if (!/^[0-9]{1,7}$/.test(trimmed)) return undefined
  const seats = Number(trimmed)
  if (seats < 1 || seats > MAX_SEATS) return undefined
  return { seats }
}

/** Said before the command, because the number is right or wrong against this gym. */
export function draftWarning(draft: SeatsDraft, quota: OrganizationGuestQuota): string | undefined {
  if (!draft || draft.seats === null) return undefined
  if (draft.seats >= quota.occupied) return undefined
  const excess = quota.occupied - draft.seats
  const people = excess === 1 ? '1 persona' : `${excess} personas`
  return `Este número queda por debajo de lo que ya ocupa, por ${people}. Nadie sale del gimnasio: solo deja de poder invitar hasta que haya lugar.`
}

export function quotaMessage(code: string): string {
  const messages: Record<string, string> = {
    forbidden:
      'Fijar el cupo pide el deber «manage_platform_commercial», que no es el mismo con el que se crea un gimnasio ni el que abre su ficha. Los deberes vencen por diseño.',
    conflict: 'Ese gimnasio ya no opera, así que no se le vende cupo.',
    'not-found': 'Ese gimnasio no existe.',
    'validation-failed': 'El cupo es un número de personas, o ningún límite.',
    'invalid-request': 'La petición no llevaba lo necesario para identificar la orden.',
    unauthenticated: 'Tu sesión terminó. Vuelve a iniciar sesión.',
    'upstream-unavailable': 'El servicio no respondió. El cupo no cambió.',
    'network-unavailable': 'No hay conexión con el API. El cupo no cambió.',
  }
  return messages[code] ?? 'No se pudo fijar el cupo.'
}

export function quotaOutcomeMessage(quota: OrganizationGuestQuota): string {
  if (quota.seats === null) return 'Listo: este gimnasio queda sin límite de personas.'
  const people = quota.seats === 1 ? '1 persona' : `${quota.seats} personas`
  return `Listo: su cupo queda en ${people}.`
}
