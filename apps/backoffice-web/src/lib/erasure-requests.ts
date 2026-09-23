/**
 * Presentation rules for the erasure tracking panel.
 *
 * The screen answers one question — *is anything still owed to a person who asked
 * us to erase their data* — so the copy is built around the thirty days rather
 * than around the rows.
 *
 * The server sends a target date, never a countdown: days computed on the server
 * are days in the server's zone. The remaining days are worked out here, in the
 * reader's own zone, and a request inside the last five days is marked before it
 * is late rather than after.
 *
 * A suspended category is not pending work. It is held by a legal obligation, and
 * counting it as something the team forgot would push an officer to "finish" a
 * disposition the law says to keep.
 *
 * Nothing that was erased travels here, and neither does the person's name. The
 * subject is an identifier, on purpose: this panel tracks the request, it does not
 * open the file.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type ErasureRequest = AllfitV1Schemas['ErasureRequest']
export type ErasureRequestPage = AllfitV1Schemas['ErasureRequestPage']
export type ErasureRequestState = AllfitV1Schemas['ErasureRequestState']
export type ErasureRequestCategory = AllfitV1Schemas['ErasureRequestCategory']
type DataClassificationCode = AllfitV1Schemas['DataClassificationCode']
type DispositionAction = AllfitV1Schemas['DispositionAction']

/** How close to the limit a request has to be before the panel marks it. */
export const DUE_SOON_DAYS = 5

const DAY = 24 * 60 * 60 * 1000

export type Urgency = 'overdue' | 'due_soon' | 'on_time' | 'resolved'

export function urgencyOf(request: ErasureRequest, now = Date.now()): Urgency {
  if (request.status === 'closed') return 'resolved'
  const remaining = Date.parse(request.due_at) - now
  if (Number.isNaN(remaining)) return 'on_time'
  if (remaining < 0) return 'overdue'
  return remaining <= DUE_SOON_DAYS * DAY ? 'due_soon' : 'on_time'
}

export type UrgencyTone = 'destructive' | 'warning' | 'secondary' | 'success'

export function urgencyTone(urgency: Urgency): UrgencyTone {
  if (urgency === 'overdue') return 'destructive'
  if (urgency === 'due_soon') return 'warning'
  return urgency === 'resolved' ? 'success' : 'secondary'
}

export interface ErasureRow {
  id: string
  subject: string
  opened: string
  due: string
  urgency: Urgency
  urgencyLabel: string
  missing: string
  resolution: string[]
}

export function requestRows(page: ErasureRequestPage, now = Date.now()): ErasureRow[] {
  return page.items.map((request) => {
    const urgency = urgencyOf(request, now)
    return {
      id: request.id,
      subject: request.subject_person_id,
      opened: formatDay(request.opened_at),
      due: formatDay(request.due_at),
      urgency,
      urgencyLabel: urgencyLabel(request, urgency, now),
      missing: missingSentence(request),
      resolution: request.categories.map(categoryLine),
    }
  })
}

function urgencyLabel(request: ErasureRequest, urgency: Urgency, now: number): string {
  if (urgency === 'resolved') return 'Resuelta'
  const days = Math.ceil((Date.parse(request.due_at) - now) / DAY)
  if (Number.isNaN(days)) return 'Sin fecha objetivo'
  if (days < 0) return `${plural(Math.abs(days), 'día', 'días')} de retraso`
  if (days === 0) return 'Vence hoy'
  return `Faltan ${plural(days, 'día', 'días')}`
}

function missingSentence(request: ErasureRequest): string {
  const parts: string[] = []
  if (request.pending_items > 0) {
    parts.push(`Falta ${plural(request.pending_items, 'categoría', 'categorías')}`)
  }
  if (request.suspended_items > 0) {
    parts.push(
      `${plural(request.suspended_items, 'categoría', 'categorías')} en espera por una obligación legal`,
    )
  }
  return parts.length > 0 ? parts.join(' · ') : 'Nada pendiente'
}

const CLASSIFICATION_LABELS: Record<DataClassificationCode, string> = {
  operational: 'Operación',
  audit: 'Auditoría',
  identity_pii: 'Identidad',
  training: 'Entrenamiento',
  body: 'Cuerpo',
  nutrition: 'Nutrición',
  health: 'Salud',
}

const PENDING_LABELS: Record<DispositionAction, string> = {
  delete: 'pendiente de eliminar',
  anonymize: 'pendiente de anonimizar',
  retain_restricted: 'pendiente de conservar con acceso restringido',
}

const DONE_LABELS: Record<DispositionAction, string> = {
  delete: 'eliminado',
  anonymize: 'anonimizado',
  retain_restricted: 'conservado',
}

/** One line per category: what it held, what happened to it, and how much. */
export function categoryLine(category: ErasureRequestCategory): string {
  const name = CLASSIFICATION_LABELS[category.data_classification_code]
  const count = ` (${category.items})`
  if (category.status === 'suspended') {
    return `${name} · en espera por una obligación legal${count}`
  }
  if (category.status === 'pending') {
    return `${name} · ${PENDING_LABELS[category.action]}${count}`
  }
  if (category.retained_until !== null) {
    return `${name} · conservado hasta ${formatDay(category.retained_until)}${count}`
  }
  if (category.result === 'failed') return `${name} · falló${count}`
  return `${name} · ${DONE_LABELS[category.action]}${count}`
}

export function panelSummary(
  page: ErasureRequestPage,
  status: ErasureRequestState,
  now = Date.now(),
): string {
  const total = page.items.length
  if (total === 0) {
    return status === 'open' ? 'Ninguna solicitud abierta.' : 'Ninguna solicitud resuelta.'
  }
  const late = page.items.filter((request) => urgencyOf(request, now) === 'overdue').length
  const sentences = [
    status === 'open'
      ? plural(total, 'solicitud abierta', 'solicitudes abiertas')
      : plural(total, 'solicitud resuelta', 'solicitudes resueltas'),
  ]
  if (late > 0) sentences.push(`${late} pasada${late === 1 ? '' : 's'} de los 30 días`)
  const summary = `${sentences.join(', ')}.`
  return page.has_more ? `${summary} Hay más de las que caben en esta página.` : summary
}

export function emptyMessage(status: ErasureRequestState): string {
  return status === 'open'
    ? 'No hay solicitudes de eliminación pendientes.'
    : 'Todavía no se ha resuelto ninguna solicitud.'
}

export function erasureMessage(code: string): string {
  const messages: Record<string, string> = {
    forbidden:
      'Tu sesión no tiene vigente el deber manage_privacy_requests. Los deberes vencen por diseño: pide que te lo asignen de nuevo.',
    'invalid-request': 'La consulta no es válida. Vuelve a abrir la página.',
    unauthenticated: 'Tu sesión terminó. Vuelve a iniciar sesión.',
    'upstream-unavailable': 'El servicio no respondió. Reintenta en un momento.',
    'network-unavailable': 'No hay conexión con el API.',
  }
  return messages[code] ?? 'No se pudo leer el seguimiento.'
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function formatDay(value: string): string {
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return '—'
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(parsed)
}
