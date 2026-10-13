/**
 * The store billing the environment describes. Each store is configured on its own: an
 * environment without Google credentials still verifies Apple, and a purchase for the
 * store it lacks fails as `not-configured`, never as a pass.
 */

import { createAppStoreBilling, type AppStoreBilling } from './adapters/app-store.js'
import { createGooglePlayBilling, type GooglePlayBilling } from './adapters/google-play.js'
import { StoreBillingError, type StoreBilling, type StoreEnvironment } from './port.js'

type Env = Record<string, string | undefined>

const value = (env: Env, name: string) => env[name]?.trim() || undefined

function environment(raw: string | undefined): StoreEnvironment {
  if (raw === 'production' || raw === 'sandbox' || raw === 'xcode') return raw
  throw new Error('APPLE_ENVIRONMENT must be production, sandbox or xcode')
}

function appStoreFrom(env: Env): AppStoreBilling | undefined {
  const bundleId = value(env, 'APPLE_BUNDLE_ID')
  if (!bundleId) return undefined
  const appAppleId = value(env, 'APPLE_APP_APPLE_ID')
  const chosen = environment(value(env, 'APPLE_ENVIRONMENT'))
  if (chosen === 'production' && !appAppleId) throw new Error('APPLE_APP_APPLE_ID is not set')
  return createAppStoreBilling({
    bundleId,
    appAppleId: appAppleId ? Number(appAppleId) : undefined,
    environment: chosen,
  })
}

function googlePlayFrom(env: Env): GooglePlayBilling | undefined {
  const packageName = value(env, 'GOOGLE_PLAY_PACKAGE_NAME')
  if (!packageName) return undefined
  const required = (name: string) => {
    const found = value(env, name)
    if (!found) throw new Error(`${name} is not set`)
    return found
  }
  return createGooglePlayBilling({
    packageName,
    serviceAccountJson: required('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON'),
    pubsubAudience: required('GOOGLE_PUBSUB_AUDIENCE'),
    pubsubServiceAccount: required('GOOGLE_PUBSUB_SERVICE_ACCOUNT'),
  })
}

export function createStoreBillingFromEnv(env: Env): StoreBilling {
  const appStore = appStoreFrom(env)
  const googlePlay = googlePlayFrom(env)
  const apple = () => appStore ?? Promise.reject(new StoreBillingError('not-configured'))
  const google = () => googlePlay ?? Promise.reject(new StoreBillingError('not-configured'))

  return {
    async verifyPurchase(purchase) {
      if (purchase.store === 'app_store')
        return (await apple()).verifyTransaction(purchase.signedTransaction)
      return (await google()).verifyPurchase(purchase.productId, purchase.purchaseToken)
    },
    async verifyAppStoreNotification(signedPayload) {
      return (await apple()).verifyNotification(signedPayload)
    },
    async verifyGooglePlayNotification(authorization, body) {
      return (await google()).verifyNotification(authorization, body)
    },
  }
}
