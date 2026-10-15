/**
 * `HU-BO-016` — presentation rules for stopping a gym.
 *
 * **The whole screen has one job: say what suspending does and what it does not.** The
 * word invites the reader to imagine deletion, and the command does the opposite — it
 * writes a reversible cause per person and touches nothing that granted anything. If
 * the operator believes they are destroying something, they will either refuse to use
 * it or use it expecting a destruction that never happens.
 *
 * **The cost is counted before the decision, not after.** How many people stop being
 * served is the figure that makes this decision real, and it is on screen while the
 * reason is being chosen rather than in the confirmation.
 *
 * **Reactivating is subtractive and says so.** It does not restore anything: it closes
 * this suspension's causes and recomputes. Anything revoked, ended or expired during
 * the period stays that way, and any other open cause keeps denying.
 *
 * **The record outlives the state.** A gym operating again still shows that it was
 * stopped, by whom and why, because that is the question an audit asks months later.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type OrganizationSuspension = AllfitV1Schemas['OrganizationSuspension']
export type OrganizationSuspensionReason = AllfitV1Schemas['OrganizationSuspensionReason']
export type OrganizationSuspensionPeriod = AllfitV1Schemas['OrganizationSuspensionPeriod']

export const SUSPENSION_REASONS: readonly OrganizationSuspensionReason[] = [
  'nonpayment',
  'terms_breach',
  'security_incident',
  'legal_requirement',
]

export const WHAT_SUSPENDING_DOES =
  'El gimnasio deja de operar: no invita, no asigna programas, no publica planes y no cobra suscripciones nuevas. Sus clientes con Pro por él bajan al plan gratuito mientras dure.'

export const WHAT_SUSPENDING_DOES_NOT_DO =
  'No termina ninguna relación, no quita ningún permiso, no saca a nadie del equipo y no borra nada. Sus clientes conservan su historial completo y pueden seguir entrenando por su cuenta; los programas que el gimnasio les asignó quedan pausados.'

export const WHAT_REACTIVATING_DOES =
  'Levantar la suspensión cierra solo el bloqueo de este gimnasio y vuelve a calcular con el estado de hoy. No restaura una copia anterior: lo que se revocó, terminó, venció o se canceló durante la suspensión no revive, y cualquier otro bloqueo vigente —una suscripción sin pagar, por ejemplo— sigue aplicando.'

const REASON_LABELS: Record<OrganizationSuspensionReason, string> = {
  nonpayment: 'No le está pagando a Allfit',
  terms_breach: 'Incumplió los términos',
  security_incident: 'Incidente de seguridad',
  legal_requirement: 'Obligación legal',
}

export function reasonLabel(reason: OrganizationSuspensionReason): string {
  return REASON_LABELS[reason]
}

/** What is true right now, in one sentence, before anything else on the panel. */
export function stateSentence(suspension: OrganizationSuspension): string {
  if (!suspension.suspended) {
    return suspension.history.length === 0
      ? 'Este gimnasio opera con normalidad y nunca ha estado suspendido.'
      : 'Este gimnasio opera con normalidad. Estuvo suspendido antes.'
  }
  const reason = suspension.current ? reasonLabel(suspension.current.reason_code) : 'Sin motivo'
  return `Suspendido: ${reason.toLowerCase()}.`
}

/** The cost of the decision, counted from the causes it opened. */
export function blockedSentence(suspension: OrganizationSuspension): string {
  const blocked = suspension.current?.people_blocked
  if (blocked === undefined) return ''
  if (blocked === 0) return 'Ninguna persona estaba siendo atendida, así que nadie quedó bloqueado.'
  return blocked === 1
    ? '1 persona dejó de recibir servicio de este gimnasio. No perdió nada.'
    : `${blocked} personas dejaron de recibir servicio de este gimnasio. Ninguna perdió nada.`
}

/**
 * Said before the command, because the number of people affected is what makes the
 * decision real and it is a different number for every gym.
 */
export function costWarning(peopleServed: number): string {
  if (peopleServed === 0) {
    return 'Este gimnasio no atiende a nadie ahora mismo, así que suspenderlo no bloquea a ninguna persona.'
  }
  const people = peopleServed === 1 ? '1 persona' : `${peopleServed} personas`
  return `Suspenderlo deja de atender a ${people}. Nadie sale del gimnasio y nadie pierde datos: dejan de recibir servicio hasta que se levante.`
}

export function periodSentence(period: OrganizationSuspensionPeriod): string {
  const reason = reasonLabel(period.reason_code).toLowerCase()
  return period.ended_at === null ? `${reason}, todavía abierta` : `${reason}, levantada`
}

export function suspensionMessage(code: string): string {
  const messages: Record<string, string> = {
    forbidden:
      'Suspender o reactivar un gimnasio pide el deber «manage_organization_lifecycle». Los deberes vencen por diseño.',
    conflict:
      'Solo se suspende un gimnasio que esté operando, y solo se reactiva uno suspendido. Un gimnasio sin reclamar, cancelado o cerrado no entra en este ciclo.',
    'not-found': 'Ese gimnasio no existe.',
    'validation-failed': 'El motivo tiene que ser uno de los acordados.',
    'invalid-request': 'La petición no llevaba lo necesario para identificar la orden.',
    unauthenticated: 'Tu sesión terminó. Vuelve a iniciar sesión.',
    'upstream-unavailable': 'El servicio no respondió. El gimnasio no cambió de estado.',
    'network-unavailable': 'No hay conexión con el API. El gimnasio no cambió de estado.',
  }
  return messages[code] ?? 'No se pudo cambiar el estado del gimnasio.'
}

export function suspensionOutcomeMessage(suspension: OrganizationSuspension): string {
  if (suspension.suspended) {
    const blocked = suspension.current?.people_blocked ?? 0
    const people = blocked === 1 ? '1 persona' : `${blocked} personas`
    return `Listo: el gimnasio queda suspendido y ${people} dejan de recibir su servicio. No se terminó ninguna relación.`
  }
  return 'Listo: el gimnasio vuelve a operar. Se cerró el bloqueo de esta suspensión y nada más.'
}
