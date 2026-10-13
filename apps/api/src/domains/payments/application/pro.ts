/**
 * Use cases of Allfit Pro: read it, list the plans, record a purchase and apply what a
 * store notifies.
 *
 * **Verify first, record after.** A purchase or a notification reaches the database only
 * as a state the store vouched for; anything the store did not vouch for never gets that
 * far. Granting the purchase to the store (Apple's finish, Google's acknowledgement) is the
 * app's last step, once this answers: nothing here writes to a store.
 */

import type {
  StoreBilling,
  StoreNotification,
  StorePurchase,
  StoreSubscriptionState,
} from '@allfitone/store-billing'

import type { PaymentsCommandContext, PaymentsCommandResult } from '../domain/index.js'
import type {
  NotificationOutcome,
  ProDatabase,
  ProPlanCatalogue,
  ProPurchaseRequest,
  ProReader,
  ProStatus,
} from '../domain/pro.js'

export interface ProService {
  read(reader: ProReader): Promise<ProStatus>
  plans(reader: ProReader): Promise<ProPlanCatalogue>
  purchase(
    reader: ProReader,
    request: ProPurchaseRequest,
    command: Omit<PaymentsCommandContext, 'requestId'>,
  ): Promise<PaymentsCommandResult<ProStatus>>
  appStoreNotification(signedPayload: string, requestId: string): Promise<NotificationOutcome>
  googlePlayNotification(
    authorization: string | undefined,
    body: string,
    requestId: string,
  ): Promise<NotificationOutcome>
}

function storePurchase(request: ProPurchaseRequest): StorePurchase {
  return request.store === 'app_store'
    ? { store: 'app_store', signedTransaction: request.signed_transaction }
    : { store: 'google_play', productId: request.product_id, purchaseToken: request.purchase_token }
}

export function createProService(database: ProDatabase, billing: () => StoreBilling): ProService {
  async function apply(
    notification: StoreNotification,
    requestId: string,
  ): Promise<NotificationOutcome> {
    // A test or an unrelated notification carries no subscription to move.
    if (!notification.state) return 'ignored'
    const state: StoreSubscriptionState = notification.state
    return database.applyNotification({
      store: notification.store,
      notificationId: notification.notificationId,
      payloadHash: notification.payloadHash,
      state,
      requestId,
    })
  }

  return {
    read: (reader) => database.read(reader),
    plans: (reader) => database.plans(reader),

    async purchase(reader, request, command) {
      const state = await billing().verifyPurchase(storePurchase(request))
      return database.recordPurchase({ ...reader, ...command, state })
    },

    async appStoreNotification(signedPayload, requestId) {
      return apply(await billing().verifyAppStoreNotification(signedPayload), requestId)
    },

    async googlePlayNotification(authorization, body, requestId) {
      return apply(await billing().verifyGooglePlayNotification(authorization, body), requestId)
    },
  }
}
