/**
 * Turns the reviewed pairings in `demonstrations.ts` into the objects an origin serves
 * and the rows `catalog.movement_media` holds, and does it the same way every run.
 *
 * **This exists because the first cut of these thirty files was not reproducible.** The
 * conversion lived as a script outside the repository, so the only evidence of how the
 * shipped artwork had been produced was the artwork. Nobody could re-derive it, which
 * means nobody could review a change to it either.
 *
 * What it does, in order:
 *
 * 1. Resolves each pairing by identifier, out of `exercisedb-snapshot.json` when it is
 *    there and by asking the source for that one row when it is not — the snapshot is a
 *    candidate pool with measured gaps, and a pairing a person chose may sit in one.
 *    **The resolved name has to match the one written down**, so an identifier reused
 *    for different content fails the run instead of quietly swapping the artwork.
 * 2. Downloads each GIF once and keeps it, so a second run converts and nothing else.
 * 3. Converts with `gif2webp`, whose default is already lossless, at the native 180
 *    pixels the free tier serves. **The artwork is not touched**: not resized, not
 *    recoloured, not recompressed. Every attempt to improve it — a dark plate, a
 *    luminance-to-alpha pass, an upscale — destroyed the definition that makes a
 *    demonstration readable, which is how that rule was learned.
 * 4. Pins the declared animation background to white (see `webp.ts`), hashes the
 *    result, and writes it under a content addressed key.
 *
 * **The key is the checksum**, which is what makes a year long `immutable` cache
 * honest: different artwork is a different address, so nothing ever has to be purged.
 *
 * It writes two things, both ignored by git. `.media/work/` holds what the run needed —
 * the source rows, the GIFs, the encoder's output — and `.media/site/` holds **only what
 * an origin serves**, because a deploy uploads a directory and nothing in it should be
 * there by accident.
 *
 * `movement-media.json` is the manifest, and **that** is the reviewed artefact: its
 * checksums are what say which bytes somebody saw. Beside it, `002_movement_demonstrations.sql`
 * is emitted from the manifest and committed — generated, never hand-edited, so the rows
 * and the objects cannot disagree.
 *
 * Needs `gif2webp` (`brew install webp`). Non-commercial source, attribution required —
 * see `MEDIA_NOTICE.md` beside this file.
 *
 *     bun run packages/db/curation/import/media.ts
 */

import { mkdir } from 'node:fs/promises'

import { DEMONSTRATIONS, movementId, type Demonstration } from './demonstrations.js'
import { canvasOf, declareWhiteBackground } from './webp.js'
import type { SourceExercise } from './snapshot.js'

const here = (name: string) => new URL(`./${name}`, import.meta.url).pathname

const SNAPSHOT = here('exercisedb-snapshot.json')
const MANIFEST = here('movement-media.json')
const CURATION = new URL('../002_movement_demonstrations.sql', import.meta.url).pathname
/** Everything the run needs, split so the deploy is only ever what gets served. */
const WORK = here('.media/work')
const SITE = here('.media/site')

/** Mirrors `CATALOG_MEDIA_BASE_URL`, which ends at the prefix and never at the key. */
const PREFIX = 'catalog'

const CONTENT_TYPE = 'image/webp'

/**
 * What the origin promises about these objects. One rule, because the key is the
 * checksum: an object at a given address is the same object forever.
 */
const HEADERS = `# Written by media.ts. Content addressed keys are what make this honest.
/${PREFIX}/*
  Cache-Control: public, max-age=31536000, immutable
  Access-Control-Allow-Origin: *
`

export interface MediaRow {
  readonly ordinal: number
  readonly slug: string
  readonly movement_id: string
  readonly source: { readonly exercise_id: string; readonly name: string }
  readonly object_key: string
  readonly content_type: string
  readonly width: number
  readonly height: number
  readonly byte_size: number
  readonly checksum: string
}

const API = 'https://oss.exercisedb.dev/api/v1'

async function snapshot(): Promise<Map<string, SourceExercise>> {
  const file = Bun.file(SNAPSHOT)
  if (!(await file.exists())) throw new Error(`Take the snapshot first: ${SNAPSHOT}`)
  const body = (await file.json()) as { exercises: readonly SourceExercise[] }
  return new Map(body.exercises.map((one) => [one.exerciseId, one]))
}

/** One row by identifier, kept on disk. The pool has gaps; a chosen pairing may be in one. */
async function fetchOne(exerciseId: string): Promise<SourceExercise> {
  const path = `${WORK}/source/${exerciseId}.json`
  const cached = Bun.file(path)
  if (await cached.exists()) return (await cached.json()) as SourceExercise

  const response = await fetch(`${API}/exercises/${exerciseId}`)
  if (!response.ok) throw new Error(`${exerciseId}: the source answered ${response.status}`)
  const body = (await response.json()) as { success?: boolean; data?: SourceExercise }
  if (!body.success || !body.data) throw new Error(`${exerciseId}: the source has no such exercise`)
  await Bun.write(path, JSON.stringify(body.data))
  return body.data
}

/** The pairing names what it chose, so a reused identifier is caught rather than shipped. */
async function resolve(
  pairing: Demonstration,
  pool: Map<string, SourceExercise>,
): Promise<SourceExercise> {
  const exercise = pool.get(pairing.exerciseId) ?? (await fetchOne(pairing.exerciseId))
  if (exercise.name !== pairing.source) {
    throw new Error(
      `${pairing.slug}: ${pairing.exerciseId} is now "${exercise.name}", not "${pairing.source}"`,
    )
  }
  return exercise
}

async function encoder(): Promise<void> {
  const found = Bun.which('gif2webp')
  if (!found) throw new Error('gif2webp is not installed — brew install webp')
}

/** Kept on disk so a rerun is a conversion, not a download of the whole catalogue. */
async function gif(pairing: Demonstration, from: string): Promise<string> {
  const path = `${WORK}/gif/${pairing.exerciseId}.gif`
  if (await Bun.file(path).exists()) return path

  const response = await fetch(from)
  if (!response.ok) throw new Error(`${pairing.slug}: ${from} answered ${response.status}`)
  await Bun.write(path, await response.arrayBuffer())
  return path
}

async function convert(gifPath: string, slug: string): Promise<Uint8Array> {
  const out = `${WORK}/webp/${slug}.webp`
  // `Bun.write` makes its own directories; an external encoder does not.
  await mkdir(`${WORK}/webp`, { recursive: true })
  // Lossless is gif2webp's default; `-q` is the alpha quality and 100 keeps it exact.
  const run = Bun.spawn(['gif2webp', '-q', '100', '-m', '6', '-mt', gifPath, '-o', out], {
    stdout: 'ignore',
    stderr: 'pipe',
  })
  if ((await run.exited) !== 0) {
    throw new Error(`${slug}: gif2webp failed — ${await new Response(run.stderr).text()}`)
  }
  return new Uint8Array(await Bun.file(out).arrayBuffer())
}

/** Single quotes cannot appear in a key, a type or a hex digest, but assert it rather than trust it. */
function literal(value: string): string {
  if (value.includes("'"))
    throw new Error(`a quote in ${value} would not survive being written as SQL`)
  return `'${value}'`
}

function curationSql(rows: readonly MediaRow[]): string {
  const values = rows
    .map(
      (row) =>
        `  (${literal(row.movement_id)}::uuid, ${literal(row.object_key)}, ${literal(row.content_type)},` +
        ` ${row.width}, ${row.height}, ${row.byte_size}, ${literal(row.checksum)})`,
    )
    .join(',\n')

  return `-- The demonstration of each curated movement, as a key into the media origin.
--
-- **Generated by \`curation/import/media.ts\` from \`movement-media.json\`. Do not edit.**
-- The checksums here are the bytes somebody reviewed; writing one by hand would break the
-- only link between what was approved and what is served.
--
-- Run after \`001_global_training_catalogue.sql\`: every row references a movement it creates.
--
-- **This one updates on conflict**, unlike the rest of the curation, which is deliberate.
-- The key is content addressed, so new artwork is a new key, and a row left pointing at
-- the old one would address an object the next deploy no longer carries. Elsewhere a
-- rerun must not disturb shipped content; here it must follow it.

\\set ON_ERROR_STOP on

begin;

create temporary table curated_demonstration (
  movement_id uuid,
  object_key text,
  content_type text,
  width integer,
  height integer,
  byte_size integer,
  checksum text
) on commit drop;

insert into curated_demonstration
  (movement_id, object_key, content_type, width, height, byte_size, checksum)
values
${values};

insert into catalog.movement_media
  (movement_id, kind, object_key, content_type, width, height, byte_size, checksum)
select
  demonstration.movement_id,
  'demo',
  demonstration.object_key,
  demonstration.content_type,
  demonstration.width,
  demonstration.height,
  demonstration.byte_size,
  demonstration.checksum
from curated_demonstration as demonstration
-- A movement that is not there yet is not an error: waves land in order.
where exists (
  select 1 from catalog.movements as movement where movement.id = demonstration.movement_id
)
on conflict (movement_id, kind) do update set
  object_key = excluded.object_key,
  content_type = excluded.content_type,
  width = excluded.width,
  height = excluded.height,
  byte_size = excluded.byte_size,
  checksum = excluded.checksum;

commit;
`
}

async function main(): Promise<void> {
  await encoder()
  const pool = await snapshot()

  const rows: MediaRow[] = []
  for (const pairing of DEMONSTRATIONS) {
    const exercise = await resolve(pairing, pool)
    const encoded = declareWhiteBackground(
      await convert(await gif(pairing, exercise.gifUrl), pairing.slug),
    )
    const { width, height } = canvasOf(encoded)
    const checksum = new Bun.CryptoHasher('sha256').update(encoded).digest('hex')

    const id = movementId(pairing.ordinal)
    const object_key = `movements/${id}/${checksum}.webp`
    await Bun.write(`${SITE}/${PREFIX}/${object_key}`, encoded)

    rows.push({
      ordinal: pairing.ordinal,
      slug: pairing.slug,
      movement_id: id,
      source: { exercise_id: pairing.exerciseId, name: exercise.name },
      object_key,
      content_type: CONTENT_TYPE,
      width,
      height,
      byte_size: encoded.byteLength,
      checksum,
    })
    console.log(
      `${pairing.slug.padEnd(20)} ${String(encoded.byteLength).padStart(7)} B  ${width}×${height}`,
    )
  }

  await Bun.write(`${SITE}/_headers`, HEADERS)
  const ordered = [...rows].sort((left, right) => left.ordinal - right.ordinal)
  await Bun.write(MANIFEST, `${JSON.stringify({ prefix: PREFIX, media: ordered }, null, 1)}\n`)

  await Bun.write(CURATION, curationSql(ordered))

  const weight = rows.reduce((sum, one) => sum + one.byte_size, 0)
  console.log(`\n${rows.length} demonstrations, ${(weight / 1024 / 1024).toFixed(1)} MB in ${SITE}`)
}

await main()
