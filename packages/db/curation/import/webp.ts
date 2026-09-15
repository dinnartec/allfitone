/**
 * The two things curation needs to know about an encoded WebP, read from the bytes
 * themselves so no image library becomes a dependency of the repository.
 *
 * A WebP is RIFF: a twelve byte header, then chunks of a four character name, a
 * four byte little-endian length, the payload, and a pad byte when the length is odd.
 * Both functions here walk that list rather than assuming an offset, because a file
 * with an `ICCP` or `EXIF` chunk would shift everything after it.
 *
 * **Why the background colour is rewritten.** An animated WebP declares the colour a
 * player composites transparent regions against, and `gif2webp` copies whatever the
 * source GIF happened to carry — which varies file by file across a catalogue drawn
 * from one source but authored by many hands. Pinning it to opaque white makes every
 * demonstration declare the same thing, so a movement never renders on a slightly
 * different plate than the one beside it. It is four bytes, and it is the only byte
 * of the artwork this pipeline touches: the frames themselves ship exactly as the
 * encoder produced them.
 */

const HEADER = 12

export interface Canvas {
  readonly width: number
  readonly height: number
}

interface Chunk {
  readonly name: string
  readonly at: number
  readonly length: number
}

const ascii = (bytes: Uint8Array, at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))

/** Every chunk in order. A truncated file stops the walk rather than reading past its end. */
function chunks(bytes: Uint8Array): Chunk[] {
  if (bytes.length < HEADER || ascii(bytes, 0) !== 'RIFF' || ascii(bytes, 8) !== 'WEBP') {
    throw new Error('not a WebP file')
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const found: Chunk[] = []
  let at = HEADER
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at + 4, true)
    if (at + 8 + length > bytes.length) break
    found.push({ name: ascii(bytes, at), at: at + 8, length })
    at += 8 + length + (length % 2)
  }
  return found
}

function only(bytes: Uint8Array, name: string): Chunk {
  const chunk = chunks(bytes).find((one) => one.name === name)
  if (!chunk) throw new Error(`the WebP carries no ${name} chunk`)
  return chunk
}

/** VP8X stores each dimension as a 24-bit little-endian value, one less than the size. */
export function canvasOf(bytes: Uint8Array): Canvas {
  const { at } = only(bytes, 'VP8X')
  // Through a view so a truncated file raises instead of reading undefined as a zero.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const size = (from: number) =>
    view.getUint8(from) + (view.getUint8(from + 1) << 8) + (view.getUint8(from + 2) << 16) + 1
  return { width: size(at + 4), height: size(at + 7) }
}

/**
 * The ANIM payload opens with the background as blue, green, red, alpha.
 * Returns a copy: the argument is the encoder's output and stays the encoder's output.
 */
export function declareWhiteBackground(bytes: Uint8Array): Uint8Array {
  const { at } = only(bytes, 'ANIM')
  const pinned = new Uint8Array(bytes)
  pinned.set([0xff, 0xff, 0xff, 0xff], at)
  return pinned
}
