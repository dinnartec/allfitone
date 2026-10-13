import { expect, test } from 'bun:test'

import { createStoreBillingFromEnv } from './factory.js'
import { StoreBillingError } from './port.js'

test('T-PAY-PRO-UNIT-18 a store without credentials is not configured, never a pass', async () => {
  const billing = createStoreBillingFromEnv({})
  const purchase = billing.verifyPurchase({ store: 'app_store', signedTransaction: 'x.y.z' })
  await expect(purchase).rejects.toBeInstanceOf(StoreBillingError)
  await expect(purchase).rejects.toMatchObject({ failure: 'not-configured' })
  await expect(billing.verifyGooglePlayNotification('Bearer token', '{}')).rejects.toMatchObject({
    failure: 'not-configured',
  })
})

test('T-PAY-PRO-UNIT-19 Apple names its environment, and production needs the app id', () => {
  expect(() =>
    createStoreBillingFromEnv({
      APPLE_BUNDLE_ID: 'com.dinnartec.allfitspace',
      APPLE_ENVIRONMENT: 'local',
    }),
  ).toThrow('APPLE_ENVIRONMENT')
  expect(() =>
    createStoreBillingFromEnv({
      APPLE_BUNDLE_ID: 'com.dinnartec.allfitspace',
      APPLE_ENVIRONMENT: 'production',
    }),
  ).toThrow('APPLE_APP_APPLE_ID')
})

test('T-PAY-PRO-UNIT-20 Google needs every credential once its package is named', () => {
  expect(() =>
    createStoreBillingFromEnv({ GOOGLE_PLAY_PACKAGE_NAME: 'com.dinnartec.allfitspace' }),
  ).toThrow('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON')
})

test('T-PAY-PRO-UNIT-21 a transaction that is not signed by Apple is invalid', async () => {
  const billing = createStoreBillingFromEnv({
    APPLE_BUNDLE_ID: 'com.dinnartec.allfitspace',
    APPLE_ENVIRONMENT: 'sandbox',
  })
  await expect(
    billing.verifyPurchase({ store: 'app_store', signedTransaction: 'not.a.jws' }),
  ).rejects.toMatchObject({ failure: 'invalid' })
})
