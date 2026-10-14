/**
 * `HU-BO-018` — presentation rules for what a person pays.
 *
 * Three statements must not look alike on this panel.
 *
 * **Lo que Allfit cobra** is a subscription to Allfit, through Apple or Google Play.
 * **Lo que le cobra su gimnasio** is a bond Allfit never charges: the gym collects
 * through its own gateway, so the panel shows the state and says plainly that the
 * charges are not recorded here. **Nada** is a person who pays nobody, which is a
 * fact and not a gap.
 *
 * A failed charge is never drawn like one that went through. Somebody opens this
 * screen because of a complaint, and the row that explains it is usually the failed
 * one — so it carries its reason, and «sin motivo» is said rather than left blank.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

import { formatAmount } from './platform-plans'

export type SupportPersonPayments = AllfitV1Schemas['SupportPersonPayments']
export type SupportPersonProSubscription = AllfitV1Schemas['SupportPersonProSubscription']
export type SupportPersonCharge = AllfitV1Schemas['SupportPersonCharge']
export type SupportPersonOrganizationBond = AllfitV1Schemas['SupportPersonOrganizationBond']

const STORES: Record<string, string> = { app_store: 'Apple', google_play: 'Google Play' }

export function storeLabel(store: string): string {
  return STORES[store] ?? store
}

export const GYM_CHARGES_NOTE =
  'De lo que le cobra su gimnasio no guardamos los cobros: cada gimnasio cobra en su propia pasarela. Aquí solo está el estado del plan.'

export const NO_CARD_NOTE =
  'Allfit no guarda datos de tarjeta de nadie, así que no hay ninguno que mostrar aquí.'

/** Where her Pro comes from, in one sentence that names the gym when there is one. */
export function proSentence(payments: SupportPersonPayments): string {
  const gyms = payments.pro.organizations
  if (payments.pro.source === 'subscription') {
    const store = payments.pro.subscription
      ? storeLabel(payments.pro.subscription.store)
      : 'la tienda'
    return `Tiene Pro porque se lo paga a Allfit por ${store}.`
  }
  if (payments.pro.source === 'organization') {
    const names = gyms.map((gym) => gym.organization_name)
    if (names.length === 0) return 'Tiene Pro por el gimnasio donde entrena.'
    if (names.length === 1)
      return `Tiene Pro por entrenar en ${names[0]}. No le paga nada a Allfit.`
    return `Tiene Pro por entrenar en ${names.join(' y ')}. No le paga nada a Allfit.`
  }
  return 'No tiene Pro: está en el plan gratuito.'
}

/** The price and the period, or nothing when the plan carries neither. */
export function subscriptionPrice(subscription: SupportPersonProSubscription): string {
  if (subscription.currency_code === null) return 'Sin costo'
  const amount = formatAmount(subscription.amount_minor, subscription.currency_code)
  return subscription.billing_period === 'year' ? `${amount} al año` : `${amount} al mes`
}

/**
 * What the subscription is doing, and since when where that matters. A suspension
 * without its date is a flag, and `HU-BO-018` criterion 3 asks for a date.
 */
export function subscriptionState(subscription: SupportPersonProSubscription): string {
  if (subscription.status === 'suspended') {
    return `En pausa por falta de cobro desde el ${formatDay(subscription.suspended_at)}`
  }
  if (subscription.status === 'grace') {
    return `No se pudo renovar: conserva Pro hasta el ${formatDay(subscription.grace_until)}`
  }
  if (subscription.status === 'ended') {
    return `Terminada el ${formatDay(subscription.ended_at)}${
      subscription.ended_reason ? ` (${endedReason(subscription.ended_reason)})` : ''
    }`
  }
  return subscription.auto_renews
    ? `Se renueva el ${formatDay(subscription.current_period_end)}`
    : `Termina el ${formatDay(subscription.current_period_end)} y no se renueva`
}

const ENDED_REASONS: Record<string, string> = {
  expired: 'venció',
  refunded: 'la tienda devolvió el dinero',
  revoked: 'la tienda la revocó',
  replaced: 'la reemplazó otra',
}

export function endedReason(reason: string): string {
  return ENDED_REASONS[reason] ?? reason
}

/** One charge, with its amount and —when it failed— the reason the store gave. */
export function chargeLine(charge: SupportPersonCharge): string {
  const amount =
    charge.amount_minor === null || charge.currency_code === null
      ? 'Sin monto reportado'
      : formatAmount(charge.amount_minor, charge.currency_code)
  if (charge.result === 'succeeded') return `${amount} · cobrado por ${storeLabel(charge.store)}`
  const reason = charge.failure_code ? `motivo: ${charge.failure_code}` : 'sin motivo reportado'
  return `${amount} · ${storeLabel(charge.store)} no pudo cobrarlo · ${reason}`
}

export function bondLine(bond: SupportPersonOrganizationBond): string {
  if (bond.status === 'suspended') {
    return `En pausa desde el ${formatDay(bond.suspended_at)}`
  }
  if (bond.status === 'ended') return `Terminado el ${formatDay(bond.ended_at)}`
  return `Activo desde el ${formatDay(bond.started_at)}`
}

/** Whether there is anything at all to say about this person's money. */
export function paysNobody(payments: SupportPersonPayments): boolean {
  return (
    payments.pro.subscription === null &&
    payments.payments.length === 0 &&
    payments.organization_subscriptions.length === 0
  )
}

function formatDay(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return '—'
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(parsed))
}

export function paymentsMessage(code: string): string {
  const messages: Record<string, string> = {
    forbidden:
      'Ver lo que paga una persona pide el deber «view_billing_metadata», que es distinto del que abre su ficha. Los deberes vencen por diseño, así que puede que el tuyo ya no esté vigente.',
    'invalid-request': 'Esta consulta necesita la referencia del caso que la justifica.',
    'not-found': 'No encontramos a esa persona.',
    unauthenticated: 'Tu sesión terminó. Vuelve a iniciar sesión.',
    'upstream-unavailable': 'El servicio no respondió. Reintenta en un momento.',
    'network-unavailable': 'No hay conexión con el API.',
  }
  return messages[code] ?? 'No se pudo leer lo que paga esta persona.'
}
