/**
 * The photo of a meal, made safe to keep (ADR-039).
 *
 * Re-encoded rather than edited: decoding and writing a new JPEG leaves every byte of
 * metadata behind — EXIF, GPS, the camera, the time it was taken — because sharp writes
 * none unless asked. It is turned upright first, from its own orientation tag, since
 * that tag is about to be dropped. Anything sharp cannot decode is refused: storing it as
 * it came would keep exactly what this exists to remove.
 */

import sharp from 'sharp'

import { PhotoRejected, type PhotoSanitizer } from '../domain/index.js'

/** Enough for a phone at full width, and a fraction of what a camera writes. */
const LONGEST_SIDE = 1600
const QUALITY = 82

export function createSharpSanitizer(): PhotoSanitizer {
  return {
    async sanitize(bytes, longestSide = LONGEST_SIDE) {
      try {
        const clean = await sharp(bytes, { failOn: 'error' })
          .autoOrient()
          .resize({
            width: longestSide,
            height: longestSide,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .jpeg({ quality: QUALITY, mozjpeg: true })
          .toBuffer()
        return new Uint8Array(clean)
      } catch (cause) {
        throw new PhotoRejected(cause)
      }
    },
  }
}
