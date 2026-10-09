/**
 * A meal photo made ready to send: within the stored edge, as JPEG, with its base64.
 *
 * The camera and the gallery hand over the full picture, four thousand pixels and two to
 * three megabytes in base64, which the API reduced to 1600 px anyway. Shrinking here
 * first stores the same image and sends a fraction, both to the recognition and to the
 * meal. Native, so it lives apart from the tested `photo-size`.
 */

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'

import { shrinkTo } from '../client/photo-size'

export async function preparePhoto(picture: {
  readonly uri: string
  readonly width: number
  readonly height: number
}): Promise<{ readonly uri: string; readonly base64: string } | null> {
  const context = ImageManipulator.manipulate(picture.uri)
  const resize = shrinkTo(picture.width, picture.height)
  if (resize) context.resize(resize)
  const image = await context.renderAsync()
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true })
  return saved.base64 ? { uri: saved.uri, base64: saved.base64 } : null
}
