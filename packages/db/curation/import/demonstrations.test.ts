/**
 * `T-CAT-MEDIA-07..13` — that the pairings still point at the movements they were
 * written for, and that the manifest they produced is loadable as rows.
 *
 * **The first test is the one with teeth.** `demonstrations.ts` repeats the ordinal
 * from `001_global_training_catalogue.sql`, and the ordinal is the identity: it becomes
 * the movement's UUID. Renaming a slug or renumbering it over there, with this file
 * untouched, would pair a movement with somebody else's artwork and nothing at run time
 * would notice — the identifier resolves, the row inserts, and the screen shows a
 * confident picture of a different exercise. So the two files are compared here.
 *
 * The rest hold the shape `catalog.movement_media` requires, against the manifest that
 * actually gets inserted rather than against the type that describes it.
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEMONSTRATIONS, movementId } from './demonstrations.js'
import type { MediaRow } from './media.js'

const CURATION = join(import.meta.dir, '..', '001_global_training_catalogue.sql')
const MANIFEST = join(import.meta.dir, 'movement-media.json')

/** The ordinal and slug of every curated movement, read from the file that defines them. */
function curated(): Map<string, number> {
  const rows = readFileSync(CURATION, 'utf8').matchAll(/^\s*\((\d+),\s*'([a-z0-9_]+)',\s*'/gm)
  const found = new Map<string, number>()
  for (const [, ordinal, slug] of rows) {
    if (ordinal !== undefined && slug !== undefined) found.set(slug, Number(ordinal))
  }
  return found
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
  prefix: string
  media: MediaRow[]
}

describe('the pairings a person wrote down', () => {
  test('T-CAT-MEDIA-07 every slug is a curated movement, at the ordinal claimed', () => {
    const catalogue = curated()
    expect(catalogue.size).toBeGreaterThan(0)

    for (const pairing of DEMONSTRATIONS) {
      expect(`${pairing.slug}@${catalogue.get(pairing.slug)}`).toBe(
        `${pairing.slug}@${pairing.ordinal}`,
      )
    }
  })

  test('T-CAT-MEDIA-08 no movement is paired twice', () => {
    const ordinals = DEMONSTRATIONS.map((one) => one.ordinal)

    expect(new Set(ordinals).size).toBe(ordinals.length)
  })

  test('T-CAT-MEDIA-09 the identity is the ordinal, padded, in the curated namespace', () => {
    expect(movementId(12)).toBe('019f1000-0000-7000-8000-000000000012')
    expect(movementId(400)).toBe('019f1000-0000-7000-8000-000000000400')
  })
})

describe('the manifest the curation block inserts', () => {
  test('T-CAT-MEDIA-10 carries a row for every pairing and nothing else', () => {
    const paired = DEMONSTRATIONS.map((one) => one.slug).sort()

    expect(manifest.media.map((one) => one.slug).sort()).toEqual(paired)
  })

  test('T-CAT-MEDIA-11 each row addresses the movement its ordinal names', () => {
    for (const row of manifest.media) {
      expect(row.movement_id).toBe(movementId(row.ordinal))
    }
  })

  test('T-CAT-MEDIA-12 the key is content addressed and carries no origin', () => {
    // `ck_movement_media_object_key` refuses a scheme; the checksum is what makes a
    // year long `immutable` cache honest.
    for (const row of manifest.media) {
      expect(row.object_key).toBe(`movements/${row.movement_id}/${row.checksum}.webp`)
      expect(row.object_key).not.toMatch(/^[a-z][a-z0-9+.-]*:\/\//)
      expect(row.checksum).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  test('T-CAT-MEDIA-13 every row satisfies what the table will check', () => {
    for (const row of manifest.media) {
      expect(row.content_type).toBe('image/webp')
      expect(row.width).toBeGreaterThan(0)
      expect(row.height).toBeGreaterThan(0)
      expect(row.byte_size).toBeGreaterThan(0)
    }
  })
})
