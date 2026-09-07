/**
 * Presentation rules for the platform access inventory.
 *
 * Everything here is derived from what the API already returned. Nothing in this
 * file decides access: the inventory is evidence of who reaches the data, never
 * a cache of authorization, so a screen must not infer from it what the operator
 * may do. Every action is attempted and the API answers.
 */

import type { PlatformDutyAssignment, PlatformDutyCode } from './backoffice-api'

export type PlatformDutyStatus = PlatformDutyAssignment['status']
export type PlatformRoleStatus = 'active' | 'revoked'

/** The closed catalogue of ADR-028, in the order an operator reads it. */
export const PLATFORM_DUTY_CODES: readonly PlatformDutyCode[] = [
  'view_platform_metrics',
  'diagnose_support_metadata',
  'view_billing_metadata',
  'manage_organization_lifecycle',
  'request_break_glass',
  'verify_professional_credentials',
  'curate_global_catalog',
  'manage_platform_commercial',
  'manage_platform_access',
  'audit_platform_access',
  'approve_break_glass',
  'audit_break_glass',
  'manage_privacy_requests',
]

const DUTY_LABELS: Record<PlatformDutyCode, string> = {
  view_platform_metrics: 'Ver métricas de plataforma',
  diagnose_support_metadata: 'Diagnosticar metadatos de soporte',
  view_billing_metadata: 'Ver metadatos de cobro',
  manage_organization_lifecycle: 'Administrar el ciclo de vida de gimnasios',
  request_break_glass: 'Solicitar acceso excepcional',
  verify_professional_credentials: 'Verificar credenciales profesionales',
  curate_global_catalog: 'Curar el catálogo global',
  manage_platform_commercial: 'Administrar lo comercial de la plataforma',
  manage_platform_access: 'Administrar accesos de plataforma',
  audit_platform_access: 'Auditar accesos de plataforma',
  approve_break_glass: 'Aprobar acceso excepcional',
  audit_break_glass: 'Auditar acceso excepcional',
  manage_privacy_requests: 'Gestionar solicitudes de privacidad',
}

const DUTY_STATUS_LABELS: Record<PlatformDutyStatus, string> = {
  scheduled: 'Programado',
  active: 'Vigente',
  suspended: 'Suspendido',
  expired: 'Vencido',
  revoked: 'Revocado',
}

const ROLE_STATUS_LABELS: Record<PlatformRoleStatus, string> = {
  active: 'Vigente',
  revoked: 'Retirado',
}

export type StatusTone = 'success' | 'warning' | 'secondary' | 'destructive'

const DUTY_STATUS_TONES: Record<PlatformDutyStatus, StatusTone> = {
  scheduled: 'secondary',
  active: 'success',
  suspended: 'warning',
  expired: 'secondary',
  revoked: 'destructive',
}

export function dutyLabel(code: PlatformDutyCode): string {
  return DUTY_LABELS[code]
}

export function dutyStatusLabel(status: PlatformDutyStatus): string {
  return DUTY_STATUS_LABELS[status]
}

export function dutyStatusTone(status: PlatformDutyStatus): StatusTone {
  return DUTY_STATUS_TONES[status]
}

export function roleStatusLabel(status: PlatformRoleStatus): string {
  return ROLE_STATUS_LABELS[status]
}

export function roleStatusTone(status: PlatformRoleStatus): StatusTone {
  return status === 'active' ? 'success' : 'destructive'
}

/**
 * A duty that is neither effective nor scheduled cannot be suspended or revoked
 * again. This is presentation only — the command refuses it regardless.
 */
export function isDutyClosed(status: PlatformDutyStatus): boolean {
  return status === 'expired' || status === 'revoked'
}

/**
 * The identifier is what an operator quotes in a case, and a full UUID is
 * unreadable in a table. The short form is for reading, never for matching: the
 * full value stays available for copying.
 */
export function shortIdentifier(id: string): string {
  return id.length <= 13 ? id : `${id.slice(0, 8)}…${id.slice(-4)}`
}

/** Unknown is shown as absent, never as a zero or a false. */
export function formatInstant(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return '—'
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(parsed))
}

/**
 * The ninety-day bound belongs to the database. The form offers a default well
 * inside it rather than the maximum, so a routine grant is not automatically the
 * longest one the rules allow.
 */
export const DEFAULT_DUTY_DAYS = 30
export const MAX_DUTY_DAYS = 90

export function dutyExpiryFromDays(days: number, now: Date = new Date()): string {
  const bounded = Math.min(Math.max(Math.trunc(days), 1), MAX_DUTY_DAYS)
  return new Date(now.getTime() + bounded * 24 * 60 * 60 * 1000).toISOString()
}

export function isValidDutyDays(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_DUTY_DAYS
}

const REASON_CODE = /^[A-Za-z0-9][A-Za-z0-9 ._:-]*$/

/** The reason is an operational reference, never a name or free narrative. */
export function isValidReasonCode(value: string): boolean {
  return value.length > 0 && value.length <= 120 && REASON_CODE.test(value)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidPersonId(value: string): boolean {
  return UUID.test(value)
}

/**
 * What the operator is told when a command is refused.
 *
 * `forbidden` is the interesting one: it means the duty was not effective in the
 * transaction that just ran, which can happen mid-session because a duty expired
 * or was revoked. The message says so instead of blaming the request.
 */
export function platformAccessMessage(code: string): string {
  const messages: Record<string, string> = {
    forbidden:
      'Tu sesión no tiene un deber vigente para esta operación. Puede haber vencido o haber sido revocado.',
    'not-found': 'La asignación ya no existe.',
    conflict:
      'La base de datos rechazó el cambio: puede ser el último administrador base, o una asignación ya cerrada.',
    'validation-failed': 'Revisa los datos: alguno no cumple el catálogo cerrado o la vigencia.',
    'invalid-request': 'Falta un identificador de comando. Vuelve a intentarlo.',
    'idempotency-in-progress': 'El comando anterior sigue procesándose. Reintenta en un momento.',
    unauthenticated: 'Tu sesión terminó. Vuelve a iniciar sesión.',
    'upstream-unavailable': 'El servicio no respondió. Reintenta en un momento.',
    'network-unavailable': 'No hay conexión con el API.',
  }
  return messages[code] ?? 'No se pudo completar la operación.'
}
