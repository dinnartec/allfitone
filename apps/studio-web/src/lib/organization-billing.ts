/**
 * What the billing screen needs to know before it offers anything.
 *
 * Permission is read from the role catalogue the server publishes rather than from a list
 * of role codes written here. PostgreSQL opens this through `manage_billing`, and a copy
 * of that mapping in the client is a second source of truth that drifts silently the day
 * the grant changes.
 *
 * **Suspending is not revoking, and the screen has to say so.** The database opens a
 * reversible cause and touches no permission, no assignment and no relationship. A
 * confirmation that said "se le quitará el acceso" would describe a different operation
 * and scare somebody out of using the one that exists — so the wording here is part of
 * the behaviour, not decoration.
 */

import type { OrganizationRole, OrganizationSubscription, SubscriptionStatus } from './studio-api'

const MANAGE_BILLING = 'manage_billing'

export function canManageBilling(
  roles: readonly string[],
  catalog: readonly OrganizationRole[] | undefined,
): boolean {
  if (!catalog?.length) return false
  return roles.some((role) =>
    catalog
      .find((entry) => entry.code === role)
      ?.capabilities.some((capability) => capability.code === MANAGE_BILLING),
  )
}

export type SubscriptionAction = 'suspend' | 'reactivate' | 'end'

/**
 * Which actions the command would actually accept, given where the subscription stands.
 *
 * Offering one it would refuse spends a click to reach a 409. An ended subscription takes
 * nothing at all: it is a record of what was charged, and coming back is a new
 * subscription the person creates from the app.
 */
export function availableActions(status: SubscriptionStatus): readonly SubscriptionAction[] {
  if (status === 'active') return ['suspend', 'end']
  if (status === 'suspended') return ['reactivate', 'end']
  return []
}

export function statusLabel(status: SubscriptionStatus): string {
  if (status === 'active') return 'Al día'
  if (status === 'suspended') return 'En pausa'
  return 'Terminada'
}

export function actionLabel(action: SubscriptionAction): string {
  if (action === 'suspend') return 'Pausar'
  if (action === 'reactivate') return 'Reactivar'
  return 'Terminar'
}

export function confirmationTitle(action: SubscriptionAction, personName: string): string {
  if (action === 'suspend') return `¿Pausar el plan de ${personName}?`
  if (action === 'reactivate') return `¿Reactivar el plan de ${personName}?`
  return `¿Terminar el plan de ${personName}?`
}

/**
 * Each of these says what the action does **and** what it leaves alone, because what it
 * leaves alone is the part nobody would guess and the part that makes it safe to use.
 */
export function confirmationDescription(action: SubscriptionAction): string {
  if (action === 'suspend') {
    return 'Sus sesiones futuras quedan en pausa y su profesional no podrá registrar cambios mientras siga pausado. No se le quita ningún permiso, no se desasigna a su profesional y el vínculo con la organización sigue igual: cuando reactives, todo vuelve sin que la persona tenga que aceptar nada de nuevo. Le vamos a avisar por correo.'
  }
  if (action === 'reactivate') {
    return 'Vuelve a estar al día: sus sesiones se ven como siempre y su profesional puede registrar cambios otra vez. No hace falta que acepte nada, porque nunca se le quitó nada. Le vamos a avisar por correo.'
  }
  return 'Deja de cobrarse y no se puede volver atrás; si vuelve, será un plan nuevo. **Terminar el cobro no termina el vínculo** ni retira los permisos que la persona dio: para eso hay acciones aparte. Le vamos a avisar por correo.'
}

export type BillingRefusal = 'conflict' | 'not-allowed' | 'gone' | 'unavailable'

export function refusalFor(status: number | undefined): BillingRefusal {
  if (status === 409) return 'conflict'
  if (status === 403) return 'not-allowed'
  if (status === 404) return 'gone'
  return 'unavailable'
}

export function refusalTitle(action: SubscriptionAction, refusal: BillingRefusal): string {
  if (refusal === 'not-allowed') return 'No puedes administrar los cobros'
  if (refusal === 'gone') return 'Esta suscripción ya no está'
  if (refusal === 'conflict') {
    if (action === 'suspend') return 'Este plan ya no se puede pausar'
    if (action === 'reactivate') return 'Este plan no se puede reactivar'
    return 'Este plan ya terminó'
  }
  return `No pudimos ${actionLabel(action).toLowerCase()} el plan`
}

export function refusalDescription(action: SubscriptionAction, refusal: BillingRefusal): string {
  if (refusal === 'not-allowed') {
    return 'Tu rol en esta organización no incluye administrar cobros y suscripciones.'
  }
  if (refusal === 'gone') {
    return 'Puede que la hayan terminado mientras tenías esta pantalla abierta. Actualiza para ver cómo está la lista ahora.'
  }
  if (refusal === 'conflict') {
    if (action === 'reactivate') {
      // The one refusal that is not a race. It means the database cannot find the cause
      // this suspension opened, which is a state these operations cannot produce.
      return 'La pausa no tiene una causa abierta que cerrar, o el plan ya terminó. Actualiza para ver cómo está; si sigue así, es algo que hay que revisar y no un reintento.'
    }
    return 'Alguien lo cambió mientras tenías esta pantalla abierta. Actualiza para ver cómo está ahora.'
  }
  // Nothing was written and nobody was emailed, which is what makes offering a retry
  // honest here.
  return 'La conexión falló de forma temporal. No se cambió nada y no se avisó a la persona, así que puedes intentarlo otra vez.'
}

/**
 * Money as somebody reads it, from the minor unit the API returns.
 *
 * The divisor is the **ISO 4217 exponent** and not what `Intl` would choose: for COP it
 * resolves to 0 decimals because Colombians do not write centavos, while the standard
 * minor unit is still 1/100. Dividing by the display preference turns a $120.000 plan into
 * $12.000.000 on the screen where somebody decides whether to suspend it.
 */
const MINOR_UNIT_EXPONENT = 2

export function formatAmount(amountMinor: number, currencyCode: string): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: currencyCode,
  }).format(amountMinor / 10 ** MINOR_UNIT_EXPONENT)
}

export function formatPeriod(billingPeriod: OrganizationSubscription['billing_period']): string {
  return billingPeriod === 'month' ? 'al mes' : 'al año'
}

/**
 * The next cut-off, or the honest absence of one. It is null until the gateway reports a
 * charge, and showing a dash rather than today's date keeps somebody from reading a
 * guess as a fact.
 */
export function formatPeriodEnd(currentPeriodEnd: string | null): string {
  if (!currentPeriodEnd) return 'Sin cobro reportado'
  const parts = currentPeriodEnd.split('-')
  const instant = Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(instant))
}

export function personInitials(personName: string): string {
  return personName
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => Array.from(part)[0]?.toLocaleUpperCase('es-CO') ?? '')
    .join('')
}
