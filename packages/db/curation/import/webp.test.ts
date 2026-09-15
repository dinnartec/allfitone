/**
 * `T-CAT-MEDIA-01..06` — reading a WebP without an image library, and the one field
 * the pipeline insists on.
 *
 * These are built from bytes rather than from a produced file on purpose: the encoder's
 * output lives under `.media/`, which is derived and not committed, so a test that read
 * one would pass on this machine and find nothing in CI.
 *
 * The chunk with an odd length is the case that matters. RIFF pads it to an even
 * boundary, and a walker that forgets the pad byte reads the next chunk one byte off —
 * which produces a plausible wrong answer rather than an error.
 */

import { describe, expect, test } from 'bun:test'

import { canvasOf, declareWhiteBackground } from './webp.js'

function chunk(name: string, payload: readonly number[]): number[] {
  const size = [payload.length & 0xff, (payload.length >> 8) & 0xff, 0, 0]
  const pad = payload.length % 2 === 1 ? [0] : []
  return [...[...name].map((one) => one.charCodeAt(0)), ...size, ...payload, ...pad]
}

function vp8x(width: number, height: number): number[] {
  const three = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff]
  return chunk('VP8X', [0x12, 0, 0, 0, ...three(width - 1), ...three(height - 1)])
}

const ANIM = chunk('ANIM', [0xe9, 0xe9, 0xe8, 0xff, 0, 0])

/** An odd chunk between the two, so the pad byte is exercised rather than assumed. */
function animated(width = 180, height = 180): Uint8Array {
  const body = [...vp8x(width, height), ...chunk('ICCP', [1, 2, 3]), ...ANIM]
  const size = [(body.length + 4) & 0xff, ((body.length + 4) >> 8) & 0xff, 0, 0]
  return new Uint8Array([
    ...[...'RIFF'].map((one) => one.charCodeAt(0)),
    ...size,
    ...[...'WEBP'].map((one) => one.charCodeAt(0)),
    ...body,
  ])
}

describe('reading an encoded WebP', () => {
  test('T-CAT-MEDIA-01 reads the canvas past a chunk whose length is odd', () => {
    // Each dimension is stored one less than the size, so 180 is written as 179.
    expect(canvasOf(animated())).toEqual({ width: 180, height: 180 })
  })

  test('T-CAT-MEDIA-02 reads a canvas wider than one byte', () => {
    expect(canvasOf(animated(1080, 720))).toEqual({ width: 1080, height: 720 })
  })

  test('T-CAT-MEDIA-03 refuses bytes that are not a WebP at all', () => {
    expect(() => canvasOf(new Uint8Array([1, 2, 3, 4]))).toThrow('not a WebP file')
  })

  test('T-CAT-MEDIA-04 says so when the chunk it needs is absent', () => {
    const still = new Uint8Array([
      ...[...'RIFF'].map((one) => one.charCodeAt(0)),
      16,
      0,
      0,
      0,
      ...[...'WEBP'].map((one) => one.charCodeAt(0)),
      ...vp8x(180, 180),
    ])

    expect(() => declareWhiteBackground(still)).toThrow('no ANIM chunk')
  })
})

describe('pinning the declared background', () => {
  test('T-CAT-MEDIA-05 writes opaque white and touches nothing else', () => {
    const before = animated()
    const after = declareWhiteBackground(before)

    expect(after.byteLength).toBe(before.byteLength)
    expect([...after.subarray(0, after.length - 6)]).toEqual([
      ...before.subarray(0, before.length - 6),
    ])
    // The four bytes of the ANIM payload, and the loop count after them, untouched.
    const anim = after.length - 6
    expect([...after.subarray(anim, anim + 6)]).toEqual([0xff, 0xff, 0xff, 0xff, 0, 0])
  })

  test('T-CAT-MEDIA-06 leaves the encoder output alone and answers a copy', () => {
    // The argument is what the encoder produced, and it stays that way.
    const before = animated()
    const anim = before.length - 6

    declareWhiteBackground(before)

    expect([...before.subarray(anim, anim + 4)]).toEqual([0xe9, 0xe9, 0xe8, 0xff])
  })
})
