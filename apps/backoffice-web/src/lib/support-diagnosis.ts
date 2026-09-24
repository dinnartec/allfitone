/**
 * Presentation rules for technical diagnosis.
 *
 * The vocabulary matters more than usual here. An operator scanning this list is
 * deciding whether to keep digging or to stop, and the difference between "not
 * sent yet" and "tried and failed" is exactly that decision. Flattening the
 * states into "error / ok" would turn a healthy queue into a wall of red.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type SupportOperation = AllfitV1Schemas['SupportOperation']
export type SupportOperationState = AllfitV1Schemas['SupportOperationState']
export type SupportOperationSourceKind = AllfitV1Schemas['SupportOperationSourceKind']
export type SupportDeliveryCircuit = AllfitV1Schemas['SupportDeliveryCircuit']

export const SUPPORT_OPERATION_SOURCES: readonly SupportOperationSourceKind[] = [
  'notification',
  'command',
]

export const SUPPORT_OPERATION_STATES: readonly SupportOperationState[] = [
  'pending',
  'retrying',
  'delivered',
  'dead_lettered',
  'processing',
  'stalled',
  'succeeded',
  'rejected_final',
]

const SOURCE_LABELS: Record<SupportOperationSourceKind, string> = {
  notification: 'Aviso',
  command: 'Comando',
}

const STATE_LABELS: Record<SupportOperationState, string> = {
  pending: 'Sin enviar todavía',
  retrying: 'Reintentando',
  delivered: 'Entregado',
  dead_lettered: 'Se rindió',
  processing: 'En curso',
  stalled: 'Atascado',
  succeeded: 'Terminado',
  rejected_final: 'Rechazado',
}

export function sourceLabel(source: SupportOperationSourceKind): string {
  return SOURCE_LABELS[source]
}

export function operationStateLabel(state: SupportOperationState): string {
  return STATE_LABELS[state]
}

export type StateTone = 'success' | 'destructive' | 'warning' | 'secondary'

/**
 * Only the three states that mean somebody has to act read as failures.
 * `retrying` is warned about rather than alarmed about — the platform is still
 * working on it — and `pending` is not a problem at all.
 */
export function operationStateTone(state: SupportOperationState): StateTone {
  if (state === 'dead_lettered' || state === 'stalled' || state === 'rejected_final')
    return 'destructive'
  if (state === 'retrying') return 'warning'
  if (state === 'delivered' || state === 'succeeded') return 'success'
  return 'secondary'
}

export function needsAttention(operation: SupportOperation): boolean {
  return operationStateTone(operation.state) === 'destructive'
}

export function circuitTone(state: string): StateTone {
  if (state === 'open') return 'destructive'
  if (state === 'half_open') return 'warning'
  return 'success'
}

/**
 * A tripped circuit is the answer to most "the notification never arrived"
 * cases, so it is said in one line before anyone reads the feed.
 */
export function circuitSummary(circuits: readonly SupportDeliveryCircuit[]): string | null {
  const tripped = circuits.filter((circuit) => circuit.state !== 'closed')
  if (tripped.length === 0) return null
  if (tripped.length === 1) {
    return `La entrega de ${tripped[0]?.event_type} está interrumpida. Antes de revisar avisos uno por uno, el canal es la causa más probable.`
  }
  return `Hay ${tripped.length} canales de entrega interrumpidos. Antes de revisar avisos uno por uno, esa es la causa más probable.`
}

export function supportDiagnosisMessage(code: string): string {
  const messages: Record<string, string> = {
    forbidden:
      'Tu sesión no tiene vigente el deber de diagnóstico de soporte. Los deberes vencen por diseño: pide que te lo asignen de nuevo.',
    'invalid-request': 'Uno de los filtros no es válido. Vuelve a cargar la página.',
    unauthenticated: 'Tu sesión terminó. Vuelve a iniciar sesión.',
    'upstream-unavailable': 'El servicio no respondió. Reintenta en un momento.',
    'network-unavailable': 'No hay conexión con el API.',
  }
  return messages[code] ?? 'No se pudo leer el estado técnico.'
}
