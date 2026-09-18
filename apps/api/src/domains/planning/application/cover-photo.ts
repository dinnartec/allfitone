/**
 * Turning whatever somebody sent into bytes we are willing to keep.
 *
 * **The server never stores what it received.** `ADR-031` requires the sanitising to
 * fail closed, and the only way to be sure no metadata survives is not to trim it but to
 * decode the image and encode a new one. EXIF, GPS, XMP, colour profiles and anything
 * else hiding in a segment are gone because none of them is carried across.
 *
 * **The pixel limit is checked before the pixels are.** A decompression bomb is a few
 * kilobytes that expands into gigabytes, so the limit goes to the decoder rather than to
 * a measurement afterwards — by the time you can measure it, it has already happened.
 *
 * **A refusal is an answer, not an exception to log and swallow.** Everything that goes
 * wrong here is the same outcome: nothing is written and the person is told. The caller
 * cannot tell a corrupt file from a bomb from an unsupported format, and does not need
 * to: all three mean «that image cannot be used».
 */

import sharp from 'sharp'

/** Wide enough for the tile on any phone, small enough that nobody waits for it. */
export const COVER_MAX_SIDE = 1024

/** What the column will accept. Producing more than this is a bug, not an input. */
export const COVER_MAX_BYTES = 1_048_576

/** Roughly a 40 megapixel photograph: larger than any phone and far short of a bomb. */
export const COVER_MAX_PIXELS = 40_000_000

export class ImageRefused extends Error {
  constructor() {
    super('image-refused')
    this.name = 'ImageRefused'
  }
}

export async function sanitisedCover(input: Buffer): Promise<Buffer> {
  if (input.length === 0) throw new ImageRefused()

  try {
    const bytes = await sharp(input, { limitInputPixels: COVER_MAX_PIXELS })
      .rotate()
      .resize({
        width: COVER_MAX_SIDE,
        height: COVER_MAX_SIDE,
        fit: 'cover',
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer()

    // Belt and braces: the column refuses more than this too, and a rejection there
    // would be a 500 rather than a refusal somebody can act on.
    if (bytes.length === 0 || bytes.length > COVER_MAX_BYTES) throw new ImageRefused()
    return bytes
  } catch (cause: unknown) {
    if (cause instanceof ImageRefused) throw cause
    throw new ImageRefused()
  }
}

/**
 * The base64 the contract sends, as bytes.
 *
 * Decoded strictly: `Buffer.from(…, 'base64')` silently ignores anything that is not
 * base64, so a body of prose would arrive as a short buffer and be refused later for the
 * wrong reason. Round-tripping it is what makes «this is not base64» its own answer.
 */
export function decodedUpload(content: string): Buffer {
  const bytes = Buffer.from(content, 'base64')
  if (
    bytes.length === 0 ||
    bytes.toString('base64').replace(/=+$/, '') !== content.replace(/=+$/, '')
  ) {
    throw new ImageRefused()
  }
  return bytes
}
