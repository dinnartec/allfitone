import { describe, expect, test } from 'bun:test'

import { appleState, googleState, minorUnits, sha256Hex } from './translate.js'

const NOW = Date.parse('2026-10-12T12:00:00Z')
const DAY = 86_400_000
const PERSON = '019b5000-0000-7000-8000-000000000031'

const transaction = {
  originalTransactionId: '2000000000000001',
  transactionId: '2000000000000009',
  productId: 'allfit.pro.monthly.v1',
  expiresDate: NOW + 30 * DAY,
  appAccountToken: PERSON.toUpperCase(),
  signedDate: NOW,
  environment: 'Sandbox',
  price: 19_900_000,
  currency: 'COP',
}

describe('Apple', () => {
  test('T-PAY-PRO-UNIT-01 a transaction not yet expired is an active subscription', () => {
    const state = appleState(transaction, null, null)
    expect(state.status).toBe('active')
    expect(state.subscriptionRef).toBe('2000000000000001')
    expect(state.environment).toBe('sandbox')
    expect(state.accountToken).toBe(PERSON)
  })

  test('T-PAY-PRO-UNIT-02 prices arrive in milliunits and are kept in minor units', () => {
    expect(appleState(transaction, null, null).amountMinor).toBe(1_990_000)
    expect(
      appleState({ ...transaction, price: 9_990, currency: 'USD' }, null, null).amountMinor,
    ).toBe(999)
  })

  test('T-PAY-PRO-UNIT-03 renewal info decides whether it renews', () => {
    expect(appleState(transaction, { autoRenewStatus: 0 }, null).autoRenews).toBe(false)
    expect(appleState(transaction, { autoRenewStatus: 1 }, null).autoRenews).toBe(true)
  })

  test('T-PAY-PRO-UNIT-04 an expired transaction in its grace period keeps Pro until grace ends', () => {
    const state = appleState(
      { ...transaction, expiresDate: NOW - DAY },
      { autoRenewStatus: 1, gracePeriodExpiresDate: NOW + 5 * DAY, isInBillingRetryPeriod: true },
      { notificationType: 'DID_FAIL_TO_RENEW', signedDate: NOW },
    )
    expect(state.status).toBe('grace')
    expect(state.graceUntil?.getTime()).toBe(NOW + 5 * DAY)
  })

  test('T-PAY-PRO-UNIT-05 past grace and still retrying billing is suspended', () => {
    const state = appleState(
      { ...transaction, expiresDate: NOW - 10 * DAY },
      { autoRenewStatus: 1, gracePeriodExpiresDate: NOW - DAY, isInBillingRetryPeriod: true },
      { notificationType: 'GRACE_PERIOD_EXPIRED', signedDate: NOW },
    )
    expect(state.status).toBe('suspended')
  })

  test('T-PAY-PRO-UNIT-06 an expiry notification ends it even while billing was retrying', () => {
    const state = appleState(
      { ...transaction, expiresDate: NOW - 60 * DAY },
      { autoRenewStatus: 0, isInBillingRetryPeriod: true },
      { notificationType: 'EXPIRED', signedDate: NOW },
    )
    expect(state.status).toBe('ended')
    expect(state.endedReason).toBe('expired')
  })

  test('T-PAY-PRO-UNIT-07 a refunded or revoked transaction ends, saying which', () => {
    const revoked = { ...transaction, revocationDate: NOW }
    expect(
      appleState(revoked, null, { notificationType: 'REFUND', signedDate: NOW }).endedReason,
    ).toBe('refunded')
    expect(
      appleState(revoked, null, { notificationType: 'REVOKE', signedDate: NOW }).endedReason,
    ).toBe('revoked')
  })

  test('T-PAY-PRO-UNIT-08 a transaction signed by Xcode is the xcode environment', () => {
    expect(appleState({ ...transaction, environment: 'Xcode' }, null, null).environment).toBe(
      'xcode',
    )
  })

  test('T-PAY-PRO-UNIT-09 a transaction without its identity is refused', () => {
    expect(() =>
      appleState({ ...transaction, originalTransactionId: undefined }, null, null),
    ).toThrow()
  })
})

describe('Google', () => {
  const subscription = {
    subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
    lineItems: [
      {
        productId: 'allfit.pro.monthly.v1',
        expiryTime: new Date(NOW + 30 * DAY).toISOString(),
        latestSuccessfulOrderId: 'GPA.1234-5678-9012-34567',
        autoRenewingPlan: {
          autoRenewEnabled: true,
          recurringPrice: { currencyCode: 'COP', units: '19900', nanos: 0 },
        },
      },
    ],
    externalAccountIdentifiers: { obfuscatedExternalAccountId: PERSON },
  }
  const observed = new Date(NOW)

  test('T-PAY-PRO-UNIT-10 the purchase token is never kept, only its hash', () => {
    const state = googleState(subscription, 'secret-token', observed, false)
    expect(state?.subscriptionRef).toBe(sha256Hex('secret-token'))
    expect(JSON.stringify(state)).not.toContain('secret-token')
  })

  test('T-PAY-PRO-UNIT-11 an active subscription carries its account, order and price', () => {
    const state = googleState(subscription, 'token', observed, false)
    expect(state?.status).toBe('active')
    expect(state?.accountToken).toBe(PERSON)
    expect(state?.transactionId).toBe('GPA.1234-5678-9012-34567')
    expect(state?.amountMinor).toBe(1_990_000)
    expect(state?.environment).toBe('production')
  })

  test('T-PAY-PRO-UNIT-12 a cancelled subscription keeps Pro until it expires', () => {
    const cancelled = { ...subscription, subscriptionState: 'SUBSCRIPTION_STATE_CANCELED' }
    expect(googleState(cancelled, 'token', observed, false)?.status).toBe('active')
    expect(googleState(cancelled, 'token', new Date(NOW + 31 * DAY), false)?.status).toBe('ended')
  })

  test('T-PAY-PRO-UNIT-13 grace, hold and pause map to grace and suspended', () => {
    const at = (state: string) =>
      googleState({ ...subscription, subscriptionState: state }, 'token', observed, false)?.status
    expect(at('SUBSCRIPTION_STATE_IN_GRACE_PERIOD')).toBe('grace')
    expect(at('SUBSCRIPTION_STATE_ON_HOLD')).toBe('suspended')
    expect(at('SUBSCRIPTION_STATE_PAUSED')).toBe('suspended')
  })

  test('T-PAY-PRO-UNIT-14 an expired subscription ends, revoked when Google said so', () => {
    const expired = { ...subscription, subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED' }
    expect(googleState(expired, 'token', observed, false)?.endedReason).toBe('expired')
    expect(googleState(expired, 'token', observed, true)?.endedReason).toBe('revoked')
  })

  test('T-PAY-PRO-UNIT-15 a pending purchase grants nothing yet', () => {
    const pending = { ...subscription, subscriptionState: 'SUBSCRIPTION_STATE_PENDING' }
    expect(googleState(pending, 'token', observed, false)).toBeNull()
  })

  test('T-PAY-PRO-UNIT-16 a test purchase is the sandbox environment', () => {
    expect(
      googleState({ ...subscription, testPurchase: {} }, 'token', observed, false)?.environment,
    ).toBe('sandbox')
  })
})

test('T-PAY-PRO-UNIT-17 minor units follow the currency', () => {
  expect(minorUnits(19.99, 'USD')).toBe(1999)
  expect(minorUnits(500, 'JPY')).toBe(500)
})
