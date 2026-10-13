/**
 * Allfit Pro on the phone: `HU-SP-084..088` (ADR-043), the pure half.
 *
 * The API resolves Pro and the store charges for it; what lives here is what the screens
 * say about that, and the one command the app sends. Keeping the wording out of the
 * screens is what lets it be tested: which source decides, when the paid period ends,
 * whether paying would only stop depending on a gym.
 *
 * **A purchase is presented once per purchase.** The command is held by the purchase's
 * own token, so the retry after a dropped connection — or the same purchase coming back
 * from a restore — reuses it, and the server answers the same subscription.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'
import type { CommandHeaders } from '@allfitone/contracts/commands'

export type ProStatus = AllfitV1Schemas['SpaceProStatus']
export type ProPlanCatalogue = AllfitV1Schemas['SpaceProPlanCatalogue']
export type ProPlan = AllfitV1Schemas['SpaceProPlan']
export type ProPayments = AllfitV1Schemas['SpaceProPayments']
export type ProPayment = AllfitV1Schemas['SpaceProPayment']
export type ProPurchase = AllfitV1Schemas['SpaceProPurchase']
export type ProSource = AllfitV1Schemas['SpaceProSource']
export type ProFeature = AllfitV1Schemas['SpaceProFeature']
export type ProStore = AllfitV1Schemas['SpaceProStore']

export type SubscriptionSource = Extract<ProSource, { kind: 'subscription' }>
export type OrganizationSource = Extract<ProSource, { kind: 'organization' }>

export interface ProTransport {
  read(): Promise<ProStatus>
  plans(): Promise<ProPlanCatalogue>
  payments(): Promise<ProPayments>
  purchase(command: CommandHeaders, purchase: ProPurchase): Promise<ProStatus>
}

export interface ProFlow {
  read(): Promise<ProStatus>
  plans(): Promise<ProPlanCatalogue>
  payments(): Promise<ProPayments>
  /** Presents a purchase the store finished; the same purchase reuses its command. */
  present(purchase: ProPurchase): Promise<ProStatus>
}

const purchaseKey = (purchase: ProPurchase) =>
  purchase.store === 'app_store' ? purchase.signed_transaction : purchase.purchase_token

export function createProFlow(dependencies: {
  readonly transport: ProTransport
  readonly newCommand: () => CommandHeaders
}): ProFlow {
  const { transport, newCommand } = dependencies
  const held = new Map<string, CommandHeaders>()

  return {
    read: () => transport.read(),
    plans: () => transport.plans(),
    payments: () => transport.payments(),
    async present(purchase) {
      const key = purchaseKey(purchase)
      const command = held.get(key) ?? newCommand()
      held.set(key, command)
      const answer = await transport.purchase(command, purchase)
      held.delete(key)
      return answer
    },
  }
}

// ———————————————————————————————————————— what the screens say

const STORE_NAME: Record<ProStore, string> = { app_store: 'Apple', google_play: 'Google Play' }
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

export const storeName = (store: ProStore) => STORE_NAME[store]

/** «3 oct», in the phone's own time zone. */
export function shortDate(instant: string): string {
  const date = new Date(instant)
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`
}

export const subscriptionOf = (status: ProStatus): SubscriptionSource | undefined =>
  status.sources.find((source): source is SubscriptionSource => source.kind === 'subscription')

export const gymsOf = (status: ProStatus): OrganizationSource[] =>
  status.sources.filter((source): source is OrganizationSource => source.kind === 'organization')

/** The line under the plan's name: who pays for it, or that nobody does. */
export function sourceLine(status: ProStatus): string {
  const subscription = subscriptionOf(status)
  const [gym] = gymsOf(status)
  if (status.effective_source === 'subscription' && subscription) {
    return `Lo pagas tú, con ${storeName(subscription.store)}`
  }
  if (status.effective_source === 'organization' && gym)
    return `Incluido por ${gym.organization_name}`
  return 'Sin costo, para siempre'
}

/** What happens at the end of the paid period, in one line. */
export function renewalLine(subscription: SubscriptionSource): string {
  if (subscription.status === 'grace' && subscription.grace_until) {
    return `No pudimos renovar: sigues con Pro hasta el ${shortDate(subscription.grace_until)}`
  }
  if (subscription.status === 'suspended') return 'Cobro pendiente: Pro está en pausa'
  const day = shortDate(subscription.current_period_end)
  return subscription.auto_renews ? `Renueva el ${day}` : `Termina el ${day}, no se renueva`
}

/** `HU-SP-085` criterion 6: said before charging, never after. */
export function gymWarning(status: ProStatus): string | undefined {
  if (status.effective_source !== 'organization') return undefined
  const [gym] = gymsOf(status)
  if (!gym) return undefined
  return `Ya tienes Pro por ${gym.organization_name}. Pagarlo solo te sirve para no depender de esa afiliación.`
}

export const WAITING_FOR_FEATURES = 'Pronto verás aquí qué incluye cada plan y sus límites.'

/** A limit as a person reads it: «Sin límite», «Incluido», «No incluido» or «3 al día». */
export function limitLabel(feature: ProFeature): string {
  if (!feature.enabled) return 'No incluido'
  if (feature.limit_value === null) return 'Sin límite'
  return feature.unit ? `${feature.limit_value} ${feature.unit}` : String(feature.limit_value)
}

const MINOR_DIGITS: Readonly<Record<string, number>> = { CLP: 0, JPY: 0, KRW: 0, PYG: 0 }

/** «$24.900» in pesos, «$9,99 USD» elsewhere: what a receipt says, not a ledger. */
export function money(amountMinor: number | null, currency: string | null): string | undefined {
  if (amountMinor === null || !currency) return undefined
  const digits = MINOR_DIGITS[currency] ?? 2
  const whole = Math.floor(amountMinor / 10 ** digits)
  const cents = amountMinor % 10 ** digits
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const amount = cents === 0 ? `$${grouped}` : `$${grouped},${String(cents).padStart(digits, '0')}`
  return currency === 'COP' ? amount : `${amount} ${currency}`
}

/** The latest charge that went through, to show what the person pays. */
export const lastPaid = (payments: readonly ProPayment[]): ProPayment | undefined =>
  payments.find((payment) => payment.result === 'succeeded')

export const proPlanOf = (catalogue: ProPlanCatalogue): ProPlan | undefined =>
  catalogue.plans.find((plan) => plan.code === 'pro')

export const freePlanOf = (catalogue: ProPlanCatalogue): ProPlan | undefined =>
  catalogue.plans.find((plan) => plan.kind === 'free')

/** The product that sells Pro in this phone's store, if Allfit sells it there. */
export function productFor(plan: ProPlan, store: ProStore): string | undefined {
  return plan.store_products.find((product) => product.store === store)?.product_id
}
