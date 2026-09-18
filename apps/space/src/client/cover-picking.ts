/**
 * Getting a photograph off the phone and into a shape the API will take.
 *
 * **The picker is loaded when somebody presses, not when the screen opens.** It is a
 * native module, and a native module that is not in the installed binary throws the
 * moment it is required. Imported at the top of this file that meant the whole routine
 * editor died on open — a missing picker taking down naming, exercises, sets and rest
 * with it.
 *
 * **And it is asked for before it is loaded.** Deferring the import was not enough: a
 * module factory that throws while the bundler is evaluating it surfaces as a global
 * error, and never reaches the `await`'s rejection — so the press still produced a red
 * screen saying «cannot find native module» instead of a sentence. Asking
 * `requireOptionalNativeModule` first is a question rather than an attempt: it answers
 * `null` and nothing is ever evaluated.
 *
 * This is not only a development concern. Anybody on a build older than the one that
 * added the module sees exactly the same thing, and losing the editor over a cover is
 * out of all proportion.
 *
 * **Only the picker is native here, deliberately.** An earlier version also resized with
 * `expo-image-manipulator`, which bought very little: the picker already crops square
 * and compresses, and the server re-encodes and caps whatever arrives anyway. What it
 * cost was a second native module, and every native module is another install before
 * anybody can use the screen.
 *
 * **Square, because the tile is square.** Cropping on the phone lets somebody choose
 * which part of the photograph is the cover; cropping on the server would be us choosing
 * for them.
 *
 * **What is sent is not what is stored.** `ADR-031` has the server decode and re-encode
 * every image, which is what actually removes the metadata. The compression here is
 * about the bytes crossing a gym's wifi, not about privacy.
 */

import { requireOptionalNativeModule } from 'expo-modules-core'

/** What `expo-image-picker` requires under the hood, and what it is registered as. */
const PICKER_MODULE = 'ExponentImagePicker'

export class PickerUnavailable extends Error {
  constructor() {
    super('picker-unavailable')
    this.name = 'PickerUnavailable'
  }
}

/** Whether this build can open the library at all. A screen may want to ask first. */
export function canPickPhotos(): boolean {
  return requireOptionalNativeModule(PICKER_MODULE) !== null
}

/** Enough for the tile at any density, and about a megabyte of JPEG rather than four. */
export const PICKED_QUALITY = 0.7

export interface PickedPhoto {
  readonly contentType: string
  readonly content: string
}

/**
 * The library, cropped square and base64 encoded — or nothing.
 *
 * Nothing covers both «cancelled» and «refused permission», which are the same outcome
 * for the screen: no photograph, and no reason to say anything. A picker that is not
 * there is a different outcome and throws, so the screen can say so.
 */
export async function pickCoverPhoto(): Promise<PickedPhoto | undefined> {
  if (!canPickPhotos()) throw new PickerUnavailable()

  const ImagePicker = await import('expo-image-picker')

  const granted = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!granted.granted) return undefined

  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: PICKED_QUALITY,
    base64: true,
  })
  if (picked.canceled) return undefined

  // `base64` is typed nullable as well as optional: the picker leaves it null when it
  // could not read the file, which is the same outcome as not having been asked.
  const encoded = picked.assets[0]?.base64
  return encoded ? { contentType: 'image/jpeg', content: encoded } : undefined
}
