/**
 * `HU-STUDIO-087` — what a gym is told about its guest quota.
 *
 * **Studio reads the number and never writes it.** Allfit fixes it; nothing in this
 * file or the screens that use it can change it, and the figure carries no trace of who
 * set it.
 *
 * **An absent figure is not zero.** A gym with no quota has `seats` and `places_left`
 * as `null`, and a figure that has not loaded yet is `undefined`. Neither is drawn as
 * "0 places left", which would read as a gym that cannot invite anybody.
 *
 * **The refusal is said before anything is sent.** When no place is left the form says
 * so, and why, instead of letting somebody fill it in and learn from an error. The
 * database still refuses in the same transaction that would write, so this is
 * the explanation and not the protection.
 */

import type { InfiniteData } from '@tanstack/react-query'

import type { ClientDirectoryPage, StudioGuestQuota } from './studio-api'

/**
 * Every page repeats the figure, and the newest fetch is the first page: the pages
 * after it were read at the time they were asked for.
 */
export function guestQuotaOf(
  data: InfiniteData<ClientDirectoryPage, unknown> | undefined,
): StudioGuestQuota | undefined {
  return data?.pages[0]?.guest_quota
}

function places(count: number): string {
  return count === 1 ? '1 lugar' : `${count} lugares`
}

/** How full the gym is, as one sentence. Nothing at all when the figure is unknown. */
export function quotaSummary(quota: StudioGuestQuota | undefined): string | undefined {
  if (!quota) return undefined
  if (quota.seats === null) return 'Este gimnasio no tiene un cupo de personas fijado.'
  const taken = `${quota.occupied} de ${places(quota.seats)} ocupados`
  if (quota.over_quota) {
    return `${taken}. Está por encima de su cupo: no puede invitar a nadie nuevo hasta que haya lugar.`
  }
  if (quota.places_left === 0) return `${taken}. No queda ningún lugar.`
  return quota.places_left === null
    ? `${taken}.`
    : `${taken}. ${quota.places_left === 1 ? 'Queda' : 'Quedan'} ${places(quota.places_left)}.`
}

export const QUOTA_RULE_NOTE =
  'Una relación vigente ocupa un lugar, y también una invitación que nadie ha respondido. Un lugar se libera cuando una invitación se rechaza, se revoca o vence, o cuando una relación termina. Allfit fija el cupo.'

/** Why an invitation cannot be sent, or `undefined` when nothing stands in the way. */
export function invitationBlockedReason(quota: StudioGuestQuota | undefined): string | undefined {
  if (!quota || quota.seats === null || quota.places_left !== 0) return undefined
  return quota.over_quota
    ? `${quota.occupied} de ${places(quota.seats)} ocupados: el gimnasio está por encima de su cupo y no puede enviar invitaciones nuevas. Nadie sale por eso.`
    : `${quota.occupied} de ${places(quota.seats)} ocupados: no queda ningún lugar para una invitación nueva.`
}

/** What the server's own refusal says, when the figure was stale and the form was open. */
export const QUOTA_FULL_MESSAGE =
  'El gimnasio se quedó sin lugares en su cupo mientras armabas la invitación. No se envió nada. Cuando se libere un lugar podrás volver a intentarlo.'
