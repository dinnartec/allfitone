/**
 * The phone's store, for Allfit Pro: StoreKit on iPhone, Google Play Billing on Android,
 * through expo-iap (ADR-043).
 *
 * The store charges and returns a purchase; the app does three things with it, in this
 * order: present it to the API, which verifies it with the store; then finish it with the
 * store (Apple's finish, Google's acknowledgement), so it stops coming back on every
 * launch and Google does not refund it after three days; then read Pro again. A purchase
 * the API could not take is left unfinished on purpose: the store hands it back, and it
 * is presented again.
 *
 * Every purchase carries the person's id as its account token, so the API can tell a
 * purchase made for this person from a transaction copied from somebody else.
 */

import {
  deepLinkToSubscriptions,
  ErrorCode,
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  type Purchase,
} from 'expo-iap'
import { Platform } from 'react-native'

import type { ProPurchase, ProStore } from './pro'

const ANDROID_PACKAGE = 'com.dinnartec.allfitspace'

export const deviceStore: ProStore = Platform.OS === 'ios' ? 'app_store' : 'google_play'

export interface StoreOffer {
  readonly productId: string
  /** The price as the store localizes it: what the person is charged. */
  readonly displayPrice: string
  readonly offerToken: string | undefined
}

let connected: Promise<boolean> | undefined
const connect = () => (connected ??= initConnection())

/** The store's own description of the product, or undefined where it is not on sale. */
export async function loadOffer(productId: string): Promise<StoreOffer | undefined> {
  await connect()
  const products = (await fetchProducts({ skus: [productId], type: 'subs' })) ?? []
  const product = products.find((candidate) => candidate.id === productId)
  if (!product) return undefined
  const offers = 'subscriptionOffers' in product ? (product.subscriptionOffers ?? []) : []
  return {
    productId,
    displayPrice: product.displayPrice,
    offerToken: offers.find((offer) => offer.offerTokenAndroid)?.offerTokenAndroid ?? undefined,
  }
}

/** Opens the store's purchase sheet; the outcome arrives through `listenForPurchases`. */
export async function buy(offer: StoreOffer, accountToken: string): Promise<void> {
  await connect()
  await requestPurchase({
    type: 'subs',
    request: {
      apple: { sku: offer.productId, appAccountToken: accountToken },
      google: {
        skus: [offer.productId],
        obfuscatedAccountId: accountToken,
        ...(offer.offerToken
          ? { subscriptionOffers: [{ sku: offer.productId, offerToken: offer.offerToken }] }
          : {}),
      },
    },
  })
}

/** What the API needs to verify a purchase with its store. */
export function purchaseOf(purchase: Purchase): ProPurchase | undefined {
  const token = purchase.purchaseToken
  if (!token) return undefined
  return deviceStore === 'app_store'
    ? { store: 'app_store', signed_transaction: token }
    : { store: 'google_play', product_id: purchase.productId, purchase_token: token }
}

export async function finish(purchase: Purchase): Promise<void> {
  await finishTransaction({ purchase, isConsumable: false })
}

/** Every purchase the store still holds for this account, as a restore asks for. */
export async function heldPurchases(): Promise<Purchase[]> {
  await connect()
  return getAvailablePurchases()
}

export interface PurchaseListeners {
  readonly onPurchase: (purchase: Purchase) => void
  /** Called for every failure except the person closing the sheet. */
  readonly onFailure: (message: string) => void
}

export function listenForPurchases(listeners: PurchaseListeners): () => void {
  const updated = purchaseUpdatedListener(listeners.onPurchase)
  const failed = purchaseErrorListener((error) => {
    if (error.code !== ErrorCode.UserCancelled) listeners.onFailure(error.message)
  })
  return () => {
    updated.remove()
    failed.remove()
  }
}

/** The store's own subscription management: the only place a subscription is cancelled. */
export async function manageSubscription(productId: string | undefined): Promise<void> {
  await deepLinkToSubscriptions(
    Platform.OS === 'android'
      ? { packageNameAndroid: ANDROID_PACKAGE, skuAndroid: productId ?? null }
      : undefined,
  )
}
