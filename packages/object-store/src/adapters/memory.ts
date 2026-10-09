/**
 * A store in memory, for tests and nothing else: it keeps what was put, signs an address
 * that only names the key, and can be told to fail so a caller's failure path is real.
 */

import { ObjectStoreError, type ObjectStore } from '../port.js'

export interface MemoryObjectStore extends ObjectStore {
  readonly objects: ReadonlyMap<
    string,
    { readonly bytes: Uint8Array; readonly contentType: string }
  >
  failNext(operation: 'put' | 'sign' | 'remove'): void
}

export function createMemoryObjectStore(): MemoryObjectStore {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>()
  const failing = new Set<'put' | 'sign' | 'remove'>()
  const check = (operation: 'put' | 'sign' | 'remove') => {
    if (!failing.delete(operation)) return
    throw new ObjectStoreError(operation, new Error('told to fail'))
  }
  return {
    objects,
    failNext: (operation) => failing.add(operation),
    async put(key, bytes, contentType) {
      check('put')
      objects.set(key, { bytes, contentType })
    },
    async signedGet(key, seconds) {
      check('sign')
      return {
        url: `https://objects.test/${encodeURIComponent(key)}?expires=${String(seconds)}`,
        expiresAt: new Date(Date.now() + seconds * 1000),
      }
    },
    async remove(key) {
      check('remove')
      objects.delete(key)
    },
  }
}
