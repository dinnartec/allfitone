/**
 * Meal photos on their way to the store, after the meal itself is saved (HU-SP-113).
 *
 * Saving used to wait for the photo before the capture closed: megabytes over the
 * network, cleaned and stored by the API, and with the store unreachable, four minutes.
 * The meal is saved first; the photo follows from this queue, which outlives the screen
 * that started it.
 *
 * While a photo goes up, the diary draws it from the phone, so the meal never shows up
 * bare and then changes. It is tried three times, a moment apart; one that still fails
 * is kept, said to have failed, and can be sent again. Kept for the process only: a
 * photo whose app was closed before it went up is lost, and the meal stays without one.
 *
 * Nothing here talks to the network or to timers itself, so it is tested without the app.
 */

export interface PendingPhoto {
  readonly uri: string
  readonly base64: string
}

export type PhotoState =
  | { readonly kind: 'uploading'; readonly uri: string }
  | { readonly kind: 'failed'; readonly uri: string }

const ATTEMPTS = 3
/** The pause before each retry, longer each time. */
const PAUSES_MS = [1_000, 3_000]

export function createPhotoUploads(dependencies: {
  readonly upload: (mealId: string, photo: PendingPhoto) => Promise<void>
  readonly wait: (ms: number) => Promise<void>
}) {
  const photos = new Map<string, { readonly photo: PendingPhoto; state: PhotoState }>()
  const listeners = new Set<() => void>()
  const announce = () => {
    for (const listener of listeners) listener()
  }

  async function send(mealId: string, photo: PendingPhoto): Promise<void> {
    photos.set(mealId, { photo, state: { kind: 'uploading', uri: photo.uri } })
    announce()
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      try {
        await dependencies.upload(mealId, photo)
        photos.delete(mealId)
        announce()
        return
      } catch {
        const pause = PAUSES_MS[attempt]
        if (pause !== undefined && attempt < ATTEMPTS - 1) await dependencies.wait(pause)
      }
    }
    photos.set(mealId, { photo, state: { kind: 'failed', uri: photo.uri } })
    announce()
  }

  return {
    /** Starts sending a meal's photo; resolves once it is stored or has given up. */
    enqueue: (mealId: string, photo: PendingPhoto): Promise<void> => send(mealId, photo),

    /** Sends a failed photo again; anything else is left alone. */
    retry(mealId: string): Promise<void> {
      const kept = photos.get(mealId)
      if (kept?.state.kind !== 'failed') return Promise.resolve()
      return send(mealId, kept.photo)
    },

    /** What the diary shows for a meal's photo while it is not stored yet. */
    stateOf: (mealId: string): PhotoState | null => photos.get(mealId)?.state ?? null,

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export type PhotoUploads = ReturnType<typeof createPhotoUploads>
