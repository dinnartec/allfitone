/**
 * The S3 adapter, for AWS S3 or anything that speaks its API (MinIO locally, R2).
 *
 * Objects are written with server-side encryption under the bucket's KMS key when one
 * is configured, and read only through presigned GETs. Vendor errors stop here and leave
 * as `ObjectStoreError`, so nothing above knows which store answered.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import { ObjectStoreError, type ObjectStore } from '../port.js'

export interface S3Settings {
  readonly bucket: string
  readonly region: string
  /** Set for a store that is not AWS itself: MinIO in development, R2. */
  readonly endpoint?: string | undefined
  readonly accessKeyId: string
  readonly secretAccessKey: string
  /** The KMS key objects are encrypted under; absent, the bucket's default applies. */
  readonly kmsKeyId?: string | undefined
  /** How long to wait for the store to accept a connection, and for an answer. */
  readonly connectTimeoutMs?: number | undefined
  readonly requestTimeoutMs?: number | undefined
}

/**
 * A store that does not answer fails in seconds. With the client's defaults an
 * unreachable endpoint kept a meal's save waiting 225 s before it gave up. The
 * deadline is an abort signal per operation, because the handler's own timeouts
 * do not fire under Bun, where the API runs locally.
 */
const CONNECT_TIMEOUT_MS = 3_000
const REQUEST_TIMEOUT_MS = 15_000
const ATTEMPTS = 2

export function createS3ObjectStore(settings: S3Settings): ObjectStore {
  const client = new S3Client({
    region: settings.region,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
    // A custom endpoint addresses buckets by path: MinIO and R2 do not route subdomains.
    ...(settings.endpoint ? { endpoint: settings.endpoint, forcePathStyle: true } : {}),
    maxAttempts: ATTEMPTS,
    requestHandler: {
      connectionTimeout: settings.connectTimeoutMs ?? CONNECT_TIMEOUT_MS,
      requestTimeout: settings.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
    },
  })
  // The whole operation, retries included, within one deadline.
  const deadline = () => ({
    abortSignal: AbortSignal.timeout(settings.requestTimeoutMs ?? REQUEST_TIMEOUT_MS),
  })

  const encryption = settings.kmsKeyId
    ? { ServerSideEncryption: 'aws:kms' as const, SSEKMSKeyId: settings.kmsKeyId }
    : {}

  return {
    async put(key, bytes, contentType) {
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: settings.bucket,
            Key: key,
            Body: bytes,
            ContentType: contentType,
            ...encryption,
          }),
          deadline(),
        )
      } catch (cause) {
        throw new ObjectStoreError('put', cause)
      }
    },

    async signedGet(key, seconds) {
      try {
        const url = await getSignedUrl(
          client,
          new GetObjectCommand({ Bucket: settings.bucket, Key: key }),
          { expiresIn: seconds },
        )
        return { url, expiresAt: new Date(Date.now() + seconds * 1000) }
      } catch (cause) {
        throw new ObjectStoreError('sign', cause)
      }
    },

    async remove(key) {
      try {
        await client.send(
          new DeleteObjectCommand({ Bucket: settings.bucket, Key: key }),
          deadline(),
        )
      } catch (cause) {
        throw new ObjectStoreError('remove', cause)
      }
    },
  }
}
