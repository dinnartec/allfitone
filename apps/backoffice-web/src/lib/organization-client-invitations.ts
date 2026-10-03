/**
 * `HU-BO-011` — presentation rules for resending a gym's client invitations.
 *
 * What can be resent is the database's answer (`resendable`), never recomputed here:
 * a screen that guessed would offer a button the command then refuses.
 *
 * The one thing this screen says that the team one does not is **what the invitation
 * asked for**. An operator about to resend needs to see that, because a client
 * invitation is an offer over someone's health data and resending it offers the same
 * thing again. The codes come from the API in code order; they are named here.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

import { formatInstant } from './platform-access'
import { scopeLabel } from './scope-definitions'

export type BackofficeClientInvitation = AllfitV1Schemas['BackofficeClientInvitation']
export type BackofficeClientInvitationResend = AllfitV1Schemas['BackofficeClientInvitationResend']
export type ClientInvitationState = BackofficeClientInvitation['state']

const STATE_LABELS: Record<ClientInvitationState, string> = {
  pending: 'Pendiente',
  expired: 'Vencida',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
  revoked: 'Retirada por el gimnasio',
}

export function clientInvitationStateLabel(state: ClientInvitationState): string {
  return STATE_LABELS[state]
}

export type StateTone = 'success' | 'warning' | 'secondary' | 'destructive'

export function clientInvitationStateTone(state: ClientInvitationState): StateTone {
  if (state === 'accepted') return 'success'
  if (state === 'pending') return 'warning'
  if (state === 'expired') return 'destructive'
  return 'secondary'
}

export function issuedByLabel(invitation: BackofficeClientInvitation): string {
  return invitation.issued_by === 'allfit' ? 'Allfit, al reenviar una vencida' : 'El gimnasio'
}

/** What the gym asked for, named. An invitation that asked for nothing says so. */
export function offerLabel(invitation: BackofficeClientInvitation): string {
  if (invitation.scope_codes.length === 0) return 'No pidió ningún permiso.'
  return invitation.scope_codes.map((code) => scopeLabel(code)).join(' · ')
}

/** Why a row offers no resend, so a missing button is never a mystery. */
export function notResendableReason(invitation: BackofficeClientInvitation): string | undefined {
  if (invitation.resendable) return undefined
  switch (invitation.state) {
    case 'accepted':
      return 'Ya fue aceptada.'
    case 'rejected':
      return 'La persona la rechazó.'
    case 'revoked':
      return 'El gimnasio la retiró.'
    case 'expired':
      return 'Ya se reemplazó por otra, o hay una igual pendiente.'
    default:
      return 'No se puede reenviar.'
  }
}

export function resendOutcomeMessage(result: BackofficeClientInvitationResend): string {
  if (result.outcome === 'redelivered') {
    return `Se reenvió la misma invitación a ${result.contact_hint}. El primer correo sigue sirviendo, y la invitación vale hasta el ${formatInstant(result.expires_at)}.`
  }
  return `La invitación había vencido: se envió una nueva, igual, a ${result.contact_hint}, firmada por Allfit. Pide exactamente los mismos permisos, y la anterior sigue vencida.`
}

export function clientInvitationsMessage(code: string): string {
  const messages: Record<string, string> = {
    forbidden:
      'Ver y reenviar las invitaciones de cliente exige el deber de soporte vigente. Los deberes vencen por diseño: pide que te lo asignen de nuevo.',
    'not-found': 'Ese gimnasio no existe.',
    unauthenticated: 'Tu sesión terminó. Vuelve a iniciar sesión.',
    'upstream-unavailable': 'El servicio no respondió. Reintenta en un momento.',
    'network-unavailable': 'No hay conexión con el API.',
  }
  return messages[code] ?? 'No se pudieron leer las invitaciones de cliente.'
}

export function resendFailureMessage(code: string): string {
  const messages: Record<string, string> = {
    conflict:
      'Esta invitación ya no se puede reenviar: cambió mientras la mirabas, o lo que pedía no coincide con lo que se iba a enviar. La lista se actualizó.',
    'rate-limited':
      'Ya se enviaron tres invitaciones a esta dirección hoy, contando las del gimnasio. Intenta mañana.',
    forbidden: clientInvitationsMessage('forbidden'),
    'not-found': 'Esa invitación ya no pertenece a este gimnasio.',
    'idempotency-in-progress': 'El reenvío anterior todavía se está procesando. Espera un momento.',
    unauthenticated: clientInvitationsMessage('unauthenticated'),
    'network-unavailable': clientInvitationsMessage('network-unavailable'),
  }
  return messages[code] ?? 'No se pudo reenviar la invitación.'
}
