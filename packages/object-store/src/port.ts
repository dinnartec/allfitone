/**
 * Object store port: private objects a person owns, like the photo of a meal (ADR-039).
 *
 * It speaks our language, not a vendor's: a key, its bytes and the type they are, and an
 * address that opens one object for a few minutes. Any store that keeps private objects
 * and signs a time-boxed read fits behind it — S3 today, R2 or another tomorrow — which
 * is the test AGENTS.md sets for a port.
 *
 * **The key never leaves the API.** It is the row's storage reference; what reaches a
 * phone is the signed address, which expires and names nothing a person could reuse.
 */

export interface SignedRead {
  readonly url: string
  readonly expiresAt: Date
}

export interface ObjectStore {
  /** Stores the bytes under the key, replacing nothing: every key is new. */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>
  /** An address that reads the object for `seconds`, and is worthless after. */
  signedGet(key: string, seconds: number): Promise<SignedRead>
  /** Removes the object; removing one that is already gone is not an error. */
  remove(key: string): Promise<void>
}

/** A store that could not do what it was asked: the caller fails closed. */
export class ObjectStoreError extends Error {
  constructor(
    readonly operation: 'put' | 'sign' | 'remove',
    cause: unknown,
  ) {
    super(`object store could not ${operation}`, { cause })
    this.name = 'ObjectStoreError'
  }
}
