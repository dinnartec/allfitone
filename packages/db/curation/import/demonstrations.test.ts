/**
 * `T-CAT-MEDIA-07..14` — that the pairings still point at the movements they were
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
import * as wave from './wave-1.js'
import type { Authored } from './wave-1.js'

const CURATION = join(import.meta.dir, '..', '001_global_training_catalogue.sql')
const MANIFEST = join(import.meta.dir, 'movement-media.json')

/**
 * The ordinal and slug of every curated movement, read from the file that defines them.
 *
 * Scoped to the `curated_movement` block and not the whole file: the equipment
 * vocabulary is written in the same shape, and reading both made the movement slug
 * `ab_wheel` collide with the equipment code of the same name at a different ordinal.
 */
function curated(): Map<string, number> {
  const file = readFileSync(CURATION, 'utf8')
  const from = file.indexOf('insert into curated_movement (ordinal, slug, discipline, name) values')
  const block = file.slice(from, file.indexOf(';', from))
  const rows = block.matchAll(/^\s*\((\d+),\s*'([a-z0-9_]+)',\s*'/gm)
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
  test('T-CAT-MEDIA-10 carries nothing that was never paired', () => {
    // Two sources of pairing: the reviewed table, for Spanish movements that predate
    // the source, and wave one, where the identifier that chose a movement is also the
    // identifier of its artwork. A row from neither would be artwork nobody picked.
    const paired = new Set([
      ...DEMONSTRATIONS.map((one) => one.slug),
      ...(Object.values(wave).filter(Array.isArray).flat() as Authored[]).map((one) => one.slug),
    ])

    const stray = manifest.media.map((one) => one.slug).filter((slug) => !paired.has(slug))
    expect(stray).toEqual([])
  })

  test('T-CAT-MEDIA-14 a pairing the source will not serve is simply absent', () => {
    // The source lists exercises whose GIF answers 404. Those movements have no row
    // here and none in the table, which the projection answers as null and the screen
    // draws as the muscle group. What must never happen is a row without bytes.
    const manifested = new Set(manifest.media.map((one) => one.slug))
    const missing = DEMONSTRATIONS.filter((one) => !manifested.has(one.slug))

    expect(missing.map((one) => one.slug)).toEqual([])
    expect(manifest.media.every((one) => one.byte_size > 0 && one.checksum.length === 64)).toBe(
      true,
    )
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
