/**
 * Body photos for Space: sanitise, store, record; sign to show; delete and remove.
 *
 * The object is written before the record, because the record is what the person sees:
 * if the database refuses (the plan, the key, a replay), the object goes too. Deleting is
 * the reverse — the record goes in the transaction that queues its object, the object is
 * removed after the commit and the queue is sealed. A removal that fails stays queued.
 */

import type { ObjectStore } from '@allfitone/object-store'

import type { PhotoSanitizer } from '../../../platform/media/photo.js'
import type {
  BodyPhoto,
  BodyPhotoCommand,
  BodyPhotoDatabase,
  BodyPhotoPage,
  BodyPhotoRow,
  BodyPhotoUpload,
} from '../domain/body-photos.js'

const SIGNED_SECONDS = 300

export interface BodyPhotoService {
  record(
    input: BodyPhotoCommand & { personId: string; takenOn: string; photo: BodyPhotoUpload },
  ): Promise<BodyPhoto>
  list(input: { personId: string; requestId: string }): Promise<BodyPhotoPage>
  delete(input: BodyPhotoCommand & { personId: string; photoId: string }): Promise<void>
}

export function createBodyPhotoService(
  database: BodyPhotoDatabase,
  store: ObjectStore,
  sanitizer: PhotoSanitizer,
): BodyPhotoService {
  const shown = async (row: BodyPhotoRow): Promise<BodyPhoto> => {
    const signed = await store.signedGet(row.media_ref, SIGNED_SECONDS)
    return {
      id: row.id,
      taken_on: row.taken_on,
      created_at: row.created_at,
      photo: { url: signed.url, expires_at: signed.expiresAt.toISOString(), method: 'GET' },
    }
  }

  return {
    async record({ photo, takenOn, personId, ...command }) {
      const clean = await sanitizer.sanitize(Buffer.from(photo.content, 'base64'))
      const mediaRef = `body/${personId}/${command.commandId}.jpg`
      await store.put(mediaRef, clean, 'image/jpeg')
      try {
        return await shown(await database.record({ ...command, personId, takenOn, mediaRef }))
      } catch (cause) {
        await store.remove(mediaRef).catch(() => undefined)
        throw cause
      }
    },

    async list(input) {
      const rows = await database.list(input)
      return { data: await Promise.all(rows.map(shown)) }
    },

    async delete(input) {
      const mediaRef = await database.delete(input)
      await store.remove(mediaRef)
      await database.seal({ personId: input.personId, mediaRef })
    },
  }
}
