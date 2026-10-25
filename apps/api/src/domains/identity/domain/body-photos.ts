/**
 * Body photos (HU-SP-025..027): the person's alone, kept in private storage.
 *
 * No consent scope covers them, so no gym or professional ever reads one. The key under
 * which a photo is stored never leaves the API: the person gets a URL signed for five
 * minutes. Pro opens keeping them (`body_photos`); reading and deleting one's own never
 * depends on a plan.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'

export type BodyPhoto = AllfitV1Schemas['BodyPhoto']
export type BodyPhotoPage = AllfitV1Schemas['BodyPhotoPage']
export type BodyPhotoUpload = AllfitV1Schemas['NutritionPhotoUpload']

/** A photo as PostgreSQL holds it: the storage key, not an address. */
export interface BodyPhotoRow {
  id: string
  taken_on: string
  created_at: string
  media_ref: string
}

export interface BodyPhotoCommand {
  idempotencyKey: string
  commandId: string
  requestHash: Uint8Array
}

export interface BodyPhotoDatabase {
  /** OP-IDN-056. AF402 when the plan does not keep photos. */
  record(
    input: BodyPhotoCommand & { personId: string; takenOn: string; mediaRef: string },
  ): Promise<BodyPhotoRow>
  /** OP-IDN-058, newest first. */
  list(input: { personId: string; requestId: string }): Promise<BodyPhotoRow[]>
  /** OP-IDN-057. Answers the key whose object is to be removed. */
  delete(input: BodyPhotoCommand & { personId: string; photoId: string }): Promise<string>
  seal(input: { personId: string; mediaRef: string }): Promise<void>
}
