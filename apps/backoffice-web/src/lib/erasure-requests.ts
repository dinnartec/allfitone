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
 *
 * A legal hold is offered on the categories that are still waiting, and only those:
 * what was already erased cannot be held, and what is already held is released
 * rather than held twice. The form refuses an open-ended hold before it travels,
 * because the database refuses one too and saying so late is worse.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type ErasureRequest = AllfitV1Schemas['ErasureRequest']
export type ErasureRequestPage = AllfitV1Schemas['ErasureRequestPage']
export type ErasureRequestState = AllfitV1Schemas['ErasureRequestState']
export type ErasureRequestCategory = AllfitV1Schemas['ErasureRequestCategory']
type DataClassificationCode = AllfitV1Schemas['DataClassificationCode']
type DispositionAction = AllfitV1Schemas['DispositionAction']
export type LegalHoldReason = AllfitV1Schemas['LegalHoldReason']
export type LegalHold = AllfitV1Schemas['LegalHold']

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

const HOLD_REASON_LABELS: Record<LegalHoldReason, string> = {
  judicial_order: 'orden judicial',
  regulatory_request: 'requerimiento de autoridad',
  service_dispute: 'disputa por el servicio',
  tax_or_accounting_obligation: 'obligación contable o tributaria',
}

export function holdReasonLabel(reason: LegalHoldReason): string {
  return HOLD_REASON_LABELS[reason]
}

export const HOLD_REASONS: readonly LegalHoldReason[] = [
  'judicial_order',
  'regulatory_request',
  'service_dispute',
  'tax_or_accounting_obligation',
]

/** What can still be suspended: not what was erased, and not what is already held. */
export function holdableCategories(request: ErasureRequest): ErasureRequestCategory[] {
  return request.categories.filter(
    (category) => category.status === 'pending' && category.hold === null,
  )
}

export interface HoldDraft {
  scopeDescription: string
  reasonCode: LegalHoldReason
  caseReference: string
  validTo: string
  itemIds: string[]
}

export const EMPTY_HOLD: HoldDraft = {
  scopeDescription: '',
  reasonCode: 'judicial_order',
  caseReference: '',
  validTo: '',
  itemIds: [],
}

export type HoldIssue = 'scope' | 'case' | 'vigency' | 'categories'

/** The first thing missing, in the order the form asks for it. */
export function holdIssue(draft: HoldDraft, now = Date.now()): HoldIssue | undefined {
  if (draft.scopeDescription.trim().length < 3) return 'scope'
  if (draft.caseReference.trim().length < 3) return 'case'
  const ends = Date.parse(`${draft.validTo}T23:59:59`)
  if (!draft.validTo || Number.isNaN(ends) || ends <= now) return 'vigency'
  if (draft.itemIds.length === 0) return 'categories'
  return undefined
}

export function holdIssueMessage(issue: HoldIssue): string {
  const messages: Record<HoldIssue, string> = {
    scope: 'Describe qué cubre la suspensión, con tus palabras.',
    case: 'Anota la referencia del requerimiento u orden que la sustenta.',
    vigency: 'Di hasta cuándo. No existen suspensiones indefinidas, y una fecha pasada no sirve.',
    categories: 'Marca al menos una categoría por suspender.',
  }
  return messages[issue]
}

/** One line per category: what it held, what happened to it, and how much. */
export function categoryLine(category: ErasureRequestCategory): string {
  const name = CLASSIFICATION_LABELS[category.data_classification_code]
  const count = ` (${category.items})`
  if (category.status === 'suspended') {
    const hold = category.hold
    if (!hold) return `${name} · en espera por una obligación legal${count}`
    return `${name} · en espera por una obligación legal · ${holdReasonLabel(hold.reason_code)} · hasta ${formatDay(hold.valid_to)}${count}`
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
    'separation-of-duties':
      'Pediste o aprobaste un acceso excepcional a los datos de esta persona, así que no puedes decidir qué se conserva de ella. Pídeselo a alguien del equipo que no haya participado.',
    conflict:
      'Alguna de esas categorías ya tiene otra suspensión vigente, o esta ya fue liberada. Vuelve a abrir la página para ver el estado actual.',
    'not-found': 'Esa suspensión ya no existe.',
    'validation-failed': 'La suspensión no cumple el contrato. Revisa alcance, motivo y vigencia.',
    'idempotency-in-progress': 'El comando anterior sigue procesándose. Reintenta en un momento.',
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
