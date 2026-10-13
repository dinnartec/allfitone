/**
 * Pure translation from each store's verified data to the port's state. No I/O and no
 * vendor SDK: the adapters verify, this decides what the verified data means, and that
 * meaning is what the tests pin down.
 *
 * **Apple** reports a subscription through a transaction (what was bought, until when)
 * and, in notifications, renewal info (whether it renews, grace, billing retry). The state
 * is read from those facts, not from the notification's name, so a purchase presented by
 * the app and a notification describing it agree.
 *
 * **Google** reports one resource, `SubscriptionPurchaseV2`, whose `subscriptionState`
 * maps almost one to one. A cancelled subscription keeps Pro until it expires.
 */

import { createHash } from 'node:crypto'

import type {
  StoreEndedReason,
  StoreEnvironment,
  StoreSubscriptionState,
  StoreSubscriptionStatus,
} from './port.js'

/** A price in a currency's minor units, from a decimal amount. */
export function minorUnits(amount: number, currency: string): number {
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits
  return Math.round(amount * 10 ** (digits ?? 2))
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

// ---------------------------------------------------------------------------
// Apple
// ---------------------------------------------------------------------------

export interface AppleTransaction {
  readonly originalTransactionId?: string | undefined
  readonly transactionId?: string | undefined
  readonly productId?: string | undefined
  readonly expiresDate?: number | undefined
  readonly appAccountToken?: string | undefined
  readonly signedDate?: number | undefined
  readonly revocationDate?: number | undefined
  readonly environment?: string | undefined
  readonly price?: number | undefined
  readonly currency?: string | undefined
}

export interface AppleRenewal {
  readonly autoRenewStatus?: number | undefined
  readonly isInBillingRetryPeriod?: boolean | undefined
  readonly gracePeriodExpiresDate?: number | undefined
}

export interface AppleNotificationFacts {
  readonly notificationType?: string | undefined
  readonly signedDate?: number | undefined
}

function appleEnvironment(environment: string | undefined): StoreEnvironment {
  if (environment === 'Production') return 'production'
  if (environment === 'Xcode' || environment === 'LocalTesting') return 'xcode'
  return 'sandbox'
}

export function appleState(
  transaction: AppleTransaction,
  renewal: AppleRenewal | null,
  notification: AppleNotificationFacts | null,
): StoreSubscriptionState {
  const { originalTransactionId, productId, expiresDate } = transaction
  if (!originalTransactionId || !productId || expiresDate === undefined) {
    throw new TypeError('an Apple subscription names its original transaction, product and expiry')
  }
  const observedAt = new Date(notification?.signedDate ?? transaction.signedDate ?? Date.now())
  const expires = new Date(expiresDate)
  const graceUntil =
    renewal?.gracePeriodExpiresDate === undefined ? null : new Date(renewal.gracePeriodExpiresDate)

  let status: StoreSubscriptionStatus
  let endedReason: StoreEndedReason | null = null
  if (transaction.revocationDate !== undefined) {
    status = 'ended'
    endedReason = notification?.notificationType === 'REVOKE' ? 'revoked' : 'refunded'
  } else if (expires > observedAt) {
    status = 'active'
  } else if (graceUntil && graceUntil > observedAt) {
    status = 'grace'
  } else if (renewal?.isInBillingRetryPeriod && notification?.notificationType !== 'EXPIRED') {
    status = 'suspended'
  } else {
    status = 'ended'
    endedReason = 'expired'
  }

  return {
    store: 'app_store',
    environment: appleEnvironment(transaction.environment),
    productId,
    subscriptionRef: originalTransactionId,
    transactionId: transaction.transactionId ?? null,
    accountToken: transaction.appAccountToken?.toLowerCase() ?? null,
    status,
    endedReason,
    autoRenews: renewal ? renewal.autoRenewStatus === 1 : status === 'active',
    currentPeriodEnd: expires,
    graceUntil: status === 'grace' ? graceUntil : null,
    observedAt,
    // Apple reports prices in milliunits of the currency.
    amountMinor:
      transaction.price !== undefined && transaction.currency
        ? minorUnits(transaction.price / 1000, transaction.currency)
        : null,
    currencyCode: transaction.currency ?? null,
  }
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

export interface GoogleMoney {
  readonly currencyCode?: string | undefined
  readonly units?: string | undefined
  readonly nanos?: number | undefined
}

export interface GoogleLineItem {
  readonly productId?: string | undefined
  readonly expiryTime?: string | undefined
  readonly latestSuccessfulOrderId?: string | undefined
  readonly autoRenewingPlan?:
    | {
        readonly autoRenewEnabled?: boolean | undefined
        readonly recurringPrice?: GoogleMoney | undefined
      }
    | undefined
    | undefined
}

export interface GoogleSubscription {
  readonly subscriptionState?: string | undefined
  readonly lineItems?: readonly GoogleLineItem[] | undefined
  readonly testPurchase?: object | undefined
  readonly externalAccountIdentifiers?:
    { readonly obfuscatedExternalAccountId?: string | undefined } | undefined | undefined
}

/** The state of a Google subscription, or null for one that grants nothing yet. */
export function googleState(
  subscription: GoogleSubscription,
  purchaseToken: string,
  observedAt: Date,
  revoked: boolean,
): StoreSubscriptionState | null {
  const item = subscription.lineItems?.[0]
  if (!item?.productId || !item.expiryTime) return null
  const expires = new Date(item.expiryTime)
  const renewing = item.autoRenewingPlan?.autoRenewEnabled === true

  let status: StoreSubscriptionStatus
  let endedReason: StoreEndedReason | null = null
  switch (subscription.subscriptionState) {
    case 'SUBSCRIPTION_STATE_ACTIVE':
      status = 'active'
      break
    case 'SUBSCRIPTION_STATE_CANCELED':
      status = expires > observedAt ? 'active' : 'ended'
      if (status === 'ended') endedReason = 'expired'
      break
    case 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD':
      status = 'grace'
      break
    case 'SUBSCRIPTION_STATE_ON_HOLD':
    case 'SUBSCRIPTION_STATE_PAUSED':
      status = 'suspended'
      break
    case 'SUBSCRIPTION_STATE_EXPIRED':
      status = 'ended'
      endedReason = revoked ? 'revoked' : 'expired'
      break
    default:
      return null
  }

  const price = item.autoRenewingPlan?.recurringPrice
  const amount =
    price?.currencyCode && price.units !== undefined
      ? minorUnits(Number(price.units) + (price.nanos ?? 0) / 1e9, price.currencyCode)
      : null

  return {
    store: 'google_play',
    environment: subscription.testPurchase ? 'sandbox' : 'production',
    productId: item.productId,
    subscriptionRef: sha256Hex(purchaseToken),
    transactionId: item.latestSuccessfulOrderId ?? null,
    accountToken:
      subscription.externalAccountIdentifiers?.obfuscatedExternalAccountId?.toLowerCase() ?? null,
    status,
    endedReason,
    autoRenews: renewing && status !== 'ended',
    currentPeriodEnd: expires,
    graceUntil: status === 'grace' ? expires : null,
    observedAt,
    amountMinor: amount,
    currencyCode: price?.currencyCode ?? null,
  }
}

export interface GoogleDeveloperNotification {
  readonly packageName?: string | undefined
  readonly eventTimeMillis?: string | number | undefined
  readonly subscriptionNotification?:
    | {
        readonly notificationType?: number | undefined
        readonly purchaseToken?: string | undefined
      }
    | undefined
}

/** Google's `SUBSCRIPTION_REVOKED`: the only type whose meaning the state alone loses. */
export const GOOGLE_SUBSCRIPTION_REVOKED = 12
