import { describe, expect, test } from 'bun:test'
import sharp from 'sharp'

import { PhotoRejected } from '../domain/index.js'
import { createSharpSanitizer } from './photo.js'

// A real JPEG with an author and a GPS position written into its EXIF.
async function photographWithLocation(width: number): Promise<Uint8Array> {
  return sharp({
    create: { width, height: Math.round(width * 0.75), channels: 3, background: '#7aa35a' },
  })
    .withExif({
      IFD0: { Artist: 'Quien Come' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '4/1 36/1 0/1' },
    })
    .jpeg()
    .toBuffer()
}

describe('a meal photo is made safe to keep (ADR-039)', () => {
  test('T-NUT-API-UNIT-09 leaves without EXIF or location', async () => {
    const before = await sharp(await photographWithLocation(800)).metadata()
    expect(before.exif).toBeDefined()

    const after = await sharp(
      await createSharpSanitizer().sanitize(await photographWithLocation(800)),
    ).metadata()
    expect(after.exif).toBeUndefined()
    expect(after.format).toBe('jpeg')
  })

  test('T-NUT-API-UNIT-10 a large photo is brought down to 1600 on its longest side', async () => {
    const after = await sharp(
      await createSharpSanitizer().sanitize(await photographWithLocation(4000)),
    ).metadata()

    expect(Math.max(after.width ?? 0, after.height ?? 0)).toBe(1600)
  })

  test('T-NUT-API-UNIT-11 what is not an image is refused, never stored as is', async () => {
    await expect(
      createSharpSanitizer().sanitize(new TextEncoder().encode('not a photo')),
    ).rejects.toBeInstanceOf(PhotoRejected)
  })
})
