/**
 * `HU-BO-010` — presentation rules for the recovery support can start.
 *
 * What can be started, resent or cancelled is the database's answer (`can_start`,
 * `resendable`, `cancellable`), never recomputed here: a screen that guessed would offer
 * a button the command then refuses. This module only says in words what each state
 * means — above all the difference between an email that has not left yet and one
 * waiting for the person, and what a cancellation can and cannot undo.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

import { formatInstant } from './platform-access'

export type BackofficeAccountRecovery = AllfitV1Schemas['BackofficeAccountRecovery']
export type BackofficeAccountRecoveryRequest = AllfitV1Schemas['BackofficeAccountRecoveryRequest']
export type AccountRecoveryState = BackofficeAccountRecoveryRequest['state']
export type RecoveryUnavailableReason = NonNullable<BackofficeAccountRecovery['unavailable_reason']>
export type RecoveryAction = 'start' | 'resend' | 'cancel'

const STATE_LABELS: Record<AccountRecoveryState, string> = {
  initiated: 'Iniciada',
  awaiting_verification: 'Esperando verificación',
  confirmed: 'Confirmada',
  expired: 'Vencida',
  cancelled: 'Cancelada',
  failed: 'Fallida',
}

export function recoveryStateLabel(state: AccountRecoveryState): string {
  return STATE_LABELS[state]
}

export type StateTone = 'success' | 'warning' | 'secondary' | 'destructive'

export function recoveryStateTone(state: AccountRecoveryState): StateTone {
  if (state === 'confirmed') return 'success'
  if (state === 'initiated' || state === 'awaiting_verification') return 'warning'
  if (state === 'cancelled') return 'secondary'
  return 'destructive'
}

/** What happened to one recovery, in the words an operator repeats to the person. */
export function recoveryStateExplanation(request: BackofficeAccountRecoveryRequest): string {
  switch (request.state) {
    case 'initiated':
      return `Todavía no sale: el correo se envía en los próximos minutos a ${request.contact_hint}.`
    case 'awaiting_verification':
      return `Enviada a ${request.contact_hint}. El enlace vale hasta el ${formatInstant(request.expires_at)} y solo la persona puede usarlo.`
    case 'confirmed':
      return request.confirmed_at
        ? `La persona cambió su contraseña el ${formatInstant(request.confirmed_at)}.`
        : 'La persona cambió su contraseña.'
    case 'expired':
      return `El enlace venció el ${formatInstant(request.expires_at)} y no vuelve a funcionar. Si la persona sigue sin poder entrar, envía una nueva.`
    case 'cancelled':
      return 'No se envía nada más. Si un correo ya había salido, no se puede retirar, pero usarlo ya no confirma esta recuperación.'
    case 'failed':
      return request.failure_code === 'contact_changed'
        ? 'No salió: el correo verificado de la persona cambió después de iniciarla.'
        : 'No salió: el proveedor de identidad no la aceptó.'
  }
}

const UNAVAILABLE_REASONS: Record<RecoveryUnavailableReason, string> = {
  no_verified_email: 'Esta persona no tiene un correo verificado al que enviar la recuperación.',
  no_access_account: 'Esta persona no tiene una cuenta de acceso que recuperar.',
  person_not_active:
    'La cuenta de esta persona no está activa, así que no hay acceso que recuperar.',
}

/** Criterion 4: fail closed and say what that means, without offering a way around it. */
export function recoveryUnavailableMessage(reason: RecoveryUnavailableReason | null): string {
  const cause = reason ? UNAVAILABLE_REASONS[reason] : 'La recuperación no está disponible.'
  return `${cause} En V1 no se cambian datos, no se aceptan fotos de documentos ni se vincula otra cuenta a su Fitness ID: cierra o escala la atención como recuperación no disponible.`
}

export function recoveryOutcomeMessage(
  action: RecoveryAction,
  request: BackofficeAccountRecoveryRequest,
): string {
  if (action === 'start') {
    return `Se pidió la recuperación para ${request.contact_hint}. El correo sale en los próximos minutos y solo la persona puede usar el enlace.`
  }
  if (action === 'resend') {
    return `Se pidió reenviarla a ${request.contact_hint}, la misma dirección. El correo sale en los próximos minutos.`
  }
  return 'Recuperación cancelada. No se envía nada más; si un correo ya había salido, no se puede retirar, pero usarlo ya no la confirma.'
}

export function accountRecoveryMessage(code: string): string {
  const messages: Record<string, string> = {
    forbidden:
      'Ayudar con una recuperación exige el deber de soporte vigente. Los deberes vencen por diseño: pide que te lo asignen de nuevo.',
    'not-found': 'No hay ninguna persona con ese identificador.',
    'invalid-request': 'Falta la referencia del caso o no tiene la forma esperada.',
    unauthenticated: 'Tu sesión terminó. Vuelve a iniciar sesión.',
    'upstream-unavailable': 'El servicio no respondió. Reintenta en un momento.',
    'network-unavailable': 'No hay conexión con el API.',
  }
  return messages[code] ?? 'No se pudo leer el estado de la recuperación.'
}

export function recoveryCommandMessage(code: string): string {
  const messages: Record<string, string> = {
    conflict:
      'La recuperación cambió mientras la mirabas: ya no está vigente, ya hay otra en curso o el correo verificado cambió. El estado se actualizó.',
    'rate-limited':
      'Ya se pidieron tres correos de recuperación para esta persona en las últimas 24 horas. Intenta más tarde.',
    forbidden: accountRecoveryMessage('forbidden'),
    'not-found': 'Esa recuperación ya no pertenece a esta persona.',
    'idempotency-in-progress': 'La acción anterior todavía se está procesando. Espera un momento.',
    'validation-failed': 'El servidor rechazó la referencia del caso. Revisa su formato.',
    unauthenticated: accountRecoveryMessage('unauthenticated'),
    'network-unavailable': accountRecoveryMessage('network-unavailable'),
  }
  return messages[code] ?? 'No se pudo completar la acción.'
}
