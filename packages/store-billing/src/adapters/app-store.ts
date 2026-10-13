/**
 * App Store adapter: verifies what Apple signed with Apple's own library, then hands the
 * decoded facts to `appleState`.
 *
 * **Which environment.** A production server must also accept the sandbox: App Review and
 * TestFlight buy there. So `production` tries both, `sandbox` only the sandbox, and
 * `xcode` only data signed by Xcode's StoreKit testing — which the library does not verify
 * at all, so that environment must never be configured outside a developer's machine.
 */

import {
  Environment,
  SignedDataVerifier,
  VerificationException,
  VerificationStatus,
} from '@apple/app-store-server-library'

import {
  StoreBillingError,
  type StoreEnvironment,
  type StoreNotification,
  type StoreSubscriptionState,
} from '../port.js'
import { appleState, sha256Hex } from '../translate.js'
import { APPLE_ROOT_CA_G3 } from './apple-root-certificates.js'

export interface AppStoreConfiguration {
  readonly bundleId: string
  /** Required by Apple to verify production data; unused elsewhere. */
  readonly appAppleId: number | undefined
  readonly environment: StoreEnvironment
}

const ENVIRONMENTS: Record<StoreEnvironment, readonly Environment[]> = {
  production: [Environment.PRODUCTION, Environment.SANDBOX],
  sandbox: [Environment.SANDBOX],
  xcode: [Environment.XCODE],
}

export interface AppStoreBilling {
  verifyTransaction(signedTransaction: string): Promise<StoreSubscriptionState>
  verifyNotification(signedPayload: string): Promise<StoreNotification>
}

export function createAppStoreBilling(configuration: AppStoreConfiguration): AppStoreBilling {
  const roots = [Buffer.from(APPLE_ROOT_CA_G3, 'base64')]
  const verifiers = ENVIRONMENTS[configuration.environment].map(
    (environment) =>
      new SignedDataVerifier(
        roots,
        true,
        environment,
        configuration.bundleId,
        environment === Environment.PRODUCTION ? configuration.appAppleId : undefined,
      ),
  )

  async function withVerifier<T>(use: (verifier: SignedDataVerifier) => Promise<T>): Promise<T> {
    for (const verifier of verifiers) {
      try {
        return await use(verifier)
      } catch (cause) {
        // Signed for the other environment: the next verifier may be the right one.
        if (
          cause instanceof VerificationException &&
          cause.status === VerificationStatus.INVALID_ENVIRONMENT
        ) {
          continue
        }
        if (cause instanceof StoreBillingError) throw cause
        const retryable =
          cause instanceof VerificationException &&
          cause.status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE
        throw new StoreBillingError(retryable ? 'unavailable' : 'invalid', { cause })
      }
    }
    throw new StoreBillingError('invalid')
  }

  return {
    verifyTransaction(signedTransaction) {
      return withVerifier(async (verifier) =>
        appleState(await verifier.verifyAndDecodeTransaction(signedTransaction), null, null),
      )
    },

    verifyNotification(signedPayload) {
      return withVerifier(async (verifier) => {
        const notification = await verifier.verifyAndDecodeNotification(signedPayload)
        if (!notification.notificationUUID) throw new StoreBillingError('invalid')
        const facts = {
          notificationType: notification.notificationType,
          signedDate: notification.signedDate,
        }
        const signedTransaction = notification.data?.signedTransactionInfo
        const signedRenewal = notification.data?.signedRenewalInfo
        const state = signedTransaction
          ? appleState(
              await verifier.verifyAndDecodeTransaction(signedTransaction),
              signedRenewal ? await verifier.verifyAndDecodeRenewalInfo(signedRenewal) : null,
              facts,
            )
          : null
        return {
          store: 'app_store',
          notificationId: notification.notificationUUID,
          payloadHash: Buffer.from(sha256Hex(signedPayload), 'hex'),
          state,
        }
      })
    },
  }
}
