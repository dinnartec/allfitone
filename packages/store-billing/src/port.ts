/**
 * Store billing port: what the App Store or Google Play says about one subscription to
 * Allfit Pro, once its signature or its origin has been verified (ADR-043).
 *
 * It speaks our language, not a vendor's: a subscription has a reference, a product, a
 * state, a period and the moment the store observed it. Apple's signed transactions and
 * Google's subscription resources both fit behind it, which is the test AGENTS.md sets
 * for a port.
 *
 * **Nothing here is trusted until verified.** A purchase the app presents and a
 * notification a store pushes both come back as a state only after the vendor proved it;
 * anything else is a `StoreBillingError`, and the caller fails closed.
 */

export type Store = 'app_store' | 'google_play'
export type StoreEnvironment = 'production' | 'sandbox' | 'xcode'
export type StoreSubscriptionStatus = 'active' | 'grace' | 'suspended' | 'ended'
export type StoreEndedReason = 'expired' | 'refunded' | 'revoked'

/** One subscription as the store sees it, at `observedAt`. */
export interface StoreSubscriptionState {
  readonly store: Store
  readonly environment: StoreEnvironment
  readonly productId: string
  /** Apple's originalTransactionId, or the SHA-256 of Google's purchase token. */
  readonly subscriptionRef: string
  /** The charge this state reports, when it reports one. */
  readonly transactionId: string | null
  /** The id the app bought with: the person's own, or nobody's. */
  readonly accountToken: string | null
  readonly status: StoreSubscriptionStatus
  readonly endedReason: StoreEndedReason | null
  readonly autoRenews: boolean
  readonly currentPeriodEnd: Date
  readonly graceUntil: Date | null
  readonly observedAt: Date
  readonly amountMinor: number | null
  readonly currencyCode: string | null
}

/** A purchase as the app presents it. */
export type StorePurchase =
  | { readonly store: 'app_store'; readonly signedTransaction: string }
  | { readonly store: 'google_play'; readonly productId: string; readonly purchaseToken: string }

/** A verified notification; `state` is null when it carries nothing to apply. */
export interface StoreNotification {
  readonly store: Store
  readonly notificationId: string
  readonly payloadHash: Uint8Array
  readonly state: StoreSubscriptionState | null
}

export interface StoreBilling {
  /** Verifies a purchase with its store and returns the subscription it bought. */
  verifyPurchase(purchase: StorePurchase): Promise<StoreSubscriptionState>
  /** Verifies an App Store Server Notification V2 (`signedPayload`). */
  verifyAppStoreNotification(signedPayload: string): Promise<StoreNotification>
  /** Verifies a Google Play push from Pub/Sub: its OIDC bearer, then its body. */
  verifyGooglePlayNotification(
    authorization: string | undefined,
    body: string,
  ): Promise<StoreNotification>
}

/**
 * - `invalid`: the store did not vouch for it, or it is not a subscription Allfit sells.
 * - `unavailable`: the store could not be asked now; trying later may succeed.
 * - `not-configured`: this environment has no credentials for that store.
 */
export type StoreBillingFailure = 'invalid' | 'unavailable' | 'not-configured'

export class StoreBillingError extends Error {
  constructor(
    readonly failure: StoreBillingFailure,
    options?: { cause?: unknown },
  ) {
    super(`store billing: ${failure}`, options)
    this.name = 'StoreBillingError'
  }
}
