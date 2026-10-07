import { describe, expect, test } from 'bun:test'

import {
  createMemoryObjectStore,
  createObjectStoreFromEnv,
  createS3ObjectStore,
  ObjectStoreError,
} from './index.js'

const env = {
  OBJECT_STORE_BUCKET: 'allfit-private',
  OBJECT_STORE_REGION: 'us-east-1',
  OBJECT_STORE_ACCESS_KEY_ID: 'AKIAEXAMPLE',
  OBJECT_STORE_SECRET_ACCESS_KEY: 'secret',
}

describe('the object store', () => {
  test('T-OBJ-UNIT-01 names the setting that is missing', () => {
    expect(() => createObjectStoreFromEnv({ ...env, OBJECT_STORE_BUCKET: '' })).toThrow(
      'OBJECT_STORE_BUCKET is not set',
    )
  })

  test('T-OBJ-UNIT-02 signs a read of one object for the seconds asked, offline', async () => {
    const store = createObjectStoreFromEnv(env)
    const read = await store.signedGet('nutrition/p/m/photo.jpg', 300)
    const url = new URL(read.url)

    expect(url.protocol).toBe('https:')
    expect(url.pathname).toBe('/nutrition/p/m/photo.jpg')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300')
    expect(read.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(300_000)
  })

  test('T-OBJ-UNIT-03 a custom endpoint addresses the bucket by path', async () => {
    const store = createObjectStoreFromEnv({
      ...env,
      OBJECT_STORE_ENDPOINT: 'http://127.0.0.1:9000',
    })
    const url = new URL((await store.signedGet('nutrition/k.jpg', 60)).url)

    expect(`${url.host}${url.pathname}`).toBe('127.0.0.1:9000/allfit-private/nutrition/k.jpg')
  })

  test('T-OBJ-UNIT-04 the memory store keeps, signs, removes and fails when told', async () => {
    const store = createMemoryObjectStore()
    await store.put('a', new Uint8Array([1]), 'image/jpeg')
    expect(store.objects.has('a')).toBe(true)
    await store.remove('a')
    expect(store.objects.has('a')).toBe(false)
    store.failNext('put')
    expect(store.put('b', new Uint8Array([1]), 'image/jpeg')).rejects.toBeInstanceOf(
      ObjectStoreError,
    )
  })

  test('T-OBJ-UNIT-05 a store that does not answer fails in seconds, not minutes', async () => {
    // A non-routable address never answers. Without limits of its own the client kept
    // retrying for 225 s while a meal waited to be saved.
    const store = createS3ObjectStore({
      bucket: 'allfit-private',
      region: 'us-east-1',
      endpoint: 'http://10.255.255.1:9000',
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'secret',
      connectTimeoutMs: 150,
      requestTimeoutMs: 300,
    })
    const started = Date.now()
    await expect(store.put('k.jpg', new Uint8Array([1]), 'image/jpeg')).rejects.toBeInstanceOf(
      ObjectStoreError,
    )
    expect(Date.now() - started).toBeLessThan(3000)
  })
})
