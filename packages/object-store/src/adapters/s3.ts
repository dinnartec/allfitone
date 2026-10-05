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
}

export function createS3ObjectStore(settings: S3Settings): ObjectStore {
  const client = new S3Client({
    region: settings.region,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
    // A custom endpoint addresses buckets by path: MinIO and R2 do not route subdomains.
    ...(settings.endpoint ? { endpoint: settings.endpoint, forcePathStyle: true } : {}),
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
        await client.send(new DeleteObjectCommand({ Bucket: settings.bucket, Key: key }))
      } catch (cause) {
        throw new ObjectStoreError('remove', cause)
      }
    },
  }
}
