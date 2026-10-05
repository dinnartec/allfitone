/**
 * The store the environment describes. A missing setting names itself rather than
 * failing later with a vendor error nobody can trace back to the configuration.
 */

import { createS3ObjectStore } from './adapters/s3.js'
import type { ObjectStore } from './port.js'

export function createObjectStoreFromEnv(env: Record<string, string | undefined>): ObjectStore {
  const required = (name: string) => {
    const value = env[name]?.trim()
    if (!value) throw new Error(`${name} is not set`)
    return value
  }
  return createS3ObjectStore({
    bucket: required('OBJECT_STORE_BUCKET'),
    region: required('OBJECT_STORE_REGION'),
    endpoint: env.OBJECT_STORE_ENDPOINT?.trim() || undefined,
    accessKeyId: required('OBJECT_STORE_ACCESS_KEY_ID'),
    secretAccessKey: required('OBJECT_STORE_SECRET_ACCESS_KEY'),
    kmsKeyId: env.OBJECT_STORE_KMS_KEY_ID?.trim() || undefined,
  })
}
