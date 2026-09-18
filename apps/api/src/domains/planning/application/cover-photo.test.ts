/**
 * `T-PLN-API-130..136` — what the server is willing to keep.
 *
 * The test that matters is the first one. A photograph taken on a phone carries where it
 * was taken, and `ADR-031` says the server strips it by re-encoding rather than by
 * trimming. Asserting the output has no EXIF is asserting the doctrine, not the library.
 */

import { describe, expect, test } from 'bun:test'
import sharp from 'sharp'

import {
  COVER_MAX_BYTES,
  COVER_MAX_SIDE,
  decodedUpload,
  ImageRefused,
  sanitisedCover,
} from './cover-photo'

const picture = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } })

describe('sanitising a cover', () => {
  test('T-PLN-API-130 a photograph keeps its pixels and loses everything written on it', async () => {
    const withExif = await picture(64, 64)
      .withExif({ IFD0: { Copyright: 'Alguien', Software: 'Cámara' } })
      .jpeg()
      .toBuffer()
    expect((await sharp(withExif).metadata()).exif).toBeDefined()

    const clean = await sanitisedCover(withExif)
    const read = await sharp(clean).metadata()

    expect(read.format).toBe('webp')
    expect(read.exif).toBeUndefined()
    expect(read.width).toBe(64)
  })

  test('T-PLN-API-131 an image larger than the tile needs is brought down to it', async () => {
    const huge = await picture(3000, 2000).jpeg().toBuffer()
    const read = await sharp(await sanitisedCover(huge)).metadata()

    expect(read.width).toBe(COVER_MAX_SIDE)
    expect(read.height).toBe(COVER_MAX_SIDE)
  })

  test('T-PLN-API-132 and a small one is not stretched to fill it', async () => {
    const small = await picture(80, 80).png().toBuffer()
    expect((await sharp(await sanitisedCover(small)).metadata()).width).toBe(80)
  })

  test('T-PLN-API-133 what comes out fits in the column', async () => {
    const detailed = await picture(2400, 2400).jpeg({ quality: 100 }).toBuffer()
    expect((await sanitisedCover(detailed)).length).toBeLessThanOrEqual(COVER_MAX_BYTES)
  })

  test('T-PLN-API-134 something that is not an image is refused, not stored', async () => {
    expect(sanitisedCover(Buffer.from('esto no es una foto'))).rejects.toThrow(ImageRefused)
    expect(sanitisedCover(Buffer.alloc(0))).rejects.toThrow(ImageRefused)
  })
})

describe('reading the upload', () => {
  test('T-PLN-API-135 base64 comes back as the bytes it stood for', () => {
    const bytes = Buffer.from([0x52, 0x49, 0x46, 0x46])
    expect(decodedUpload(bytes.toString('base64'))).toEqual(bytes)
  })

  test('T-PLN-API-136 and prose is refused rather than silently truncated', () => {
    // `Buffer.from(…, "base64")` drops what it cannot read, so without the round trip a
    // sentence would arrive as a few stray bytes and be refused for the wrong reason.
    expect(() => decodedUpload('esto no es base64 !!!')).toThrow(ImageRefused)
    expect(() => decodedUpload('')).toThrow(ImageRefused)
  })
})
