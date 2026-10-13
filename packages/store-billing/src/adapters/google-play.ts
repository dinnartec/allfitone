/**
 * Google Play adapter: asks the Google Play Developer API for a subscription's current
 * state, with a service account, and verifies that a push really comes from Pub/Sub.
 *
 * Google's notifications carry no state, only a purchase token and a type, so every
 * notification is answered by reading the subscription again. That also makes the order
 * in which notifications arrive irrelevant: each one reads what is true now.
 *
 * The purchase token never leaves this adapter: the port carries only its SHA-256.
 */

import { GoogleAuth, OAuth2Client } from 'google-auth-library'

import { StoreBillingError, type StoreNotification, type StoreSubscriptionState } from '../port.js'
import {
  GOOGLE_SUBSCRIPTION_REVOKED,
  googleState,
  sha256Hex,
  type GoogleDeveloperNotification,
  type GoogleSubscription,
} from '../translate.js'

export interface GooglePlayConfiguration {
  readonly packageName: string
  readonly serviceAccountJson: string
  /** The audience Pub/Sub was told to put in its push token. */
  readonly pubsubAudience: string
  /** The service account Pub/Sub pushes as. */
  readonly pubsubServiceAccount: string
}

export interface GooglePlayBilling {
  verifyPurchase(productId: string, purchaseToken: string): Promise<StoreSubscriptionState>
  verifyNotification(authorization: string | undefined, body: string): Promise<StoreNotification>
}

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications'

function status(cause: unknown): number | undefined {
  if (typeof cause !== 'object' || cause === null || !('response' in cause)) return undefined
  const response = cause.response
  if (typeof response !== 'object' || response === null || !('status' in response)) return undefined
  return typeof response.status === 'number' ? response.status : undefined
}

// A token Google does not know is the purchase's fault; anything else may pass later.
function failure(cause: unknown): StoreBillingError {
  const code = status(cause)
  const invalid = code === 400 || code === 404 || code === 410
  return new StoreBillingError(invalid ? 'invalid' : 'unavailable', { cause })
}

export function createGooglePlayBilling(configuration: GooglePlayConfiguration): GooglePlayBilling {
  const auth = new GoogleAuth({
    credentials: JSON.parse(configuration.serviceAccountJson),
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  })
  const pushVerifier = new OAuth2Client()
  const base = `${API}/${encodeURIComponent(configuration.packageName)}/purchases`

  async function read(purchaseToken: string): Promise<GoogleSubscription> {
    try {
      const response = await auth.request<GoogleSubscription>({
        url: `${base}/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
      })
      return response.data
    } catch (cause) {
      throw failure(cause)
    }
  }

  return {
    async verifyPurchase(productId, purchaseToken) {
      const state = googleState(await read(purchaseToken), purchaseToken, new Date(), false)
      if (!state || state.productId !== productId) throw new StoreBillingError('invalid')
      return state
    },

    async verifyNotification(authorization, body) {
      const token = authorization?.match(/^Bearer (.+)$/)?.[1]
      if (!token) throw new StoreBillingError('invalid')
      try {
        const ticket = await pushVerifier.verifyIdToken({
          idToken: token,
          audience: configuration.pubsubAudience,
        })
        const payload = ticket.getPayload()
        if (
          payload?.email !== configuration.pubsubServiceAccount ||
          payload.email_verified !== true
        ) {
          throw new StoreBillingError('invalid')
        }
      } catch (cause) {
        throw cause instanceof StoreBillingError
          ? cause
          : new StoreBillingError('invalid', { cause })
      }

      let messageId: string
      let notification: GoogleDeveloperNotification
      try {
        const push: { message?: { messageId?: string; data?: string } } = JSON.parse(body)
        if (!push.message?.messageId || !push.message.data) throw new TypeError('no message')
        messageId = push.message.messageId
        notification = JSON.parse(Buffer.from(push.message.data, 'base64').toString('utf8'))
      } catch (cause) {
        throw new StoreBillingError('invalid', { cause })
      }
      if (notification.packageName !== configuration.packageName)
        throw new StoreBillingError('invalid')

      const subscription = notification.subscriptionNotification
      const purchaseToken = subscription?.purchaseToken
      const state = purchaseToken
        ? googleState(
            await read(purchaseToken),
            purchaseToken,
            new Date(Number(notification.eventTimeMillis ?? Date.now())),
            subscription?.notificationType === GOOGLE_SUBSCRIPTION_REVOKED,
          )
        : null
      return {
        store: 'google_play',
        notificationId: messageId,
        payloadHash: Buffer.from(sha256Hex(body), 'hex'),
        state,
      }
    },
  }
}
