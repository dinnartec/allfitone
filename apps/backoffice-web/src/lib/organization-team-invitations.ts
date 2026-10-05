/**
 * `HU-BO-011` — presentation rules for resending a gym's team invitations.
 *
 * What can be resent is the database's answer (`resendable`), never recomputed here:
 * a screen that guessed would offer a button the command then refuses. This module
 * only says, in words, what each state means and what a resend actually did — the
 * operator has to know whether the first email still works or a new one replaced it.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

import { formatInstant } from './platform-access'

export type BackofficeTeamInvitation = AllfitV1Schemas['BackofficeTeamInvitation']
export type BackofficeTeamInvitationResend = AllfitV1Schemas['BackofficeTeamInvitationResend']
export type TeamInvitationState = BackofficeTeamInvitation['state']

const STATE_LABELS: Record<TeamInvitationState, string> = {
  pending: 'Pendiente',
  expired: 'Vencida',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
  revoked: 'Revocada por el gimnasio',
}

export function teamInvitationStateLabel(state: TeamInvitationState): string {
  return STATE_LABELS[state]
}

export type StateTone = 'success' | 'warning' | 'secondary' | 'destructive'

export function teamInvitationStateTone(state: TeamInvitationState): StateTone {
  if (state === 'accepted') return 'success'
  if (state === 'pending') return 'warning'
  if (state === 'expired') return 'destructive'
  return 'secondary'
}

export function issuedByLabel(invitation: BackofficeTeamInvitation): string {
  return invitation.issued_by === 'allfit' ? 'Allfit, al reenviar una vencida' : 'El gimnasio'
}

/** Why a row offers no resend, so a missing button is never a mystery. */
export function notResendableReason(invitation: BackofficeTeamInvitation): string | undefined {
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

export function resendOutcomeMessage(result: BackofficeTeamInvitationResend): string {
  if (result.outcome === 'redelivered') {
    return `Se reenvió la misma invitación a ${result.contact_hint}. El primer correo sigue sirviendo, y la invitación vale hasta el ${formatInstant(result.expires_at)}.`
  }
  return `La invitación había vencido: se envió una nueva, igual, a ${result.contact_hint}, firmada por Allfit. La anterior sigue vencida y no vuelve a funcionar.`
}

export function teamInvitationsMessage(code: string): string {
  const messages: Record<string, string> = {
    forbidden:
      'Ver y reenviar las invitaciones de equipo exige el deber de soporte vigente. Los deberes vencen por diseño: pide que te lo asignen de nuevo.',
    'not-found': 'Ese gimnasio no existe.',
    unauthenticated: 'Tu sesión terminó. Vuelve a iniciar sesión.',
    'upstream-unavailable': 'El servicio no respondió. Reintenta en un momento.',
    'network-unavailable': 'No hay conexión con el API.',
  }
  return messages[code] ?? 'No se pudieron leer las invitaciones de equipo.'
}

export function resendFailureMessage(code: string): string {
  const messages: Record<string, string> = {
    conflict:
      'Esta invitación ya no se puede reenviar: cambió mientras la mirabas. La lista se actualizó.',
    'rate-limited':
      'Ya se enviaron tres invitaciones a esta dirección hoy, contando las del gimnasio. Intenta mañana.',
    forbidden: teamInvitationsMessage('forbidden'),
    'not-found': 'Esa invitación ya no pertenece a este gimnasio.',
    'idempotency-in-progress': 'El reenvío anterior todavía se está procesando. Espera un momento.',
    unauthenticated: teamInvitationsMessage('unauthenticated'),
    'network-unavailable': teamInvitationsMessage('network-unavailable'),
  }
  return messages[code] ?? 'No se pudo reenviar la invitación.'
}
