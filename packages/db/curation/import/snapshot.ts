/**
 * Takes a local snapshot of the ExerciseDB free tier, so curation reads a file and
 * never the network.
 *
 * **This is a candidate pool, not a mirror, and the difference is measured.** The free
 * tier cannot be enumerated exhaustively, which took three probes to establish rather
 * than assume:
 *
 * - `limit` is clamped to 25, and every cursor — `cursor`, `offset`, `page` — returns
 *   the same first page. The collection cannot be walked.
 * - `bodyParts` and `equipments` do filter, and they partition: the ten body parts sum
 *   to the whole, and within one body part the equipment totals sum to it exactly.
 * - **`muscles` is silently ignored when combined.** `bodyParts=shoulders` with
 *   `equipments=dumbbell` answers the same 62 rows for `muscles=shins` as for
 *   `muscles=obliques` — the same identifiers, in the same order. A filter that is
 *   dropped without saying so is the reason this file counts what it got.
 * - `name` is a substring match with a **three character minimum** (`pr` answers
 *   nothing, `pre` answers nineteen), so single letters cannot split anything.
 *
 * So a (body part, equipment) slice over 25 rows cannot be split any further, and what
 * comes back is its first 25. That is a real limit of the source, and the honest
 * response is to **record it rather than hide it**: every slice reports `total` against
 * `taken`, and the snapshot carries the shortfall. Curation picks a few hundred
 * movements by hand from this pool, so a smaller pool costs candidates — but a pool
 * that claimed to be the whole catalogue while missing rows would cost trust.
 *
 * **It is a snapshot, not a dependency.** The file it writes is committed and reviewed;
 * nothing at runtime ever calls this API. Re-run it to refresh, and the diff is the
 * change.
 *
 * **And it is resumable at the level of the question, because the walk is long.** Every
 * answer is cached on disk under the query that produced it, so a run that is killed —
 * this machine ran out of memory three times taking it — replays what it already knows
 * in seconds and only asks what is left. Completed body parts are written out too.
 *
 * Delete `.cache/` to take a genuinely fresh snapshot.
 *
 * The free tier is non-commercial and asks for attribution — see the NOTICE beside the
 * curated media. This script only reads metadata; it downloads no images.
 */

const API = 'https://oss.exercisedb.dev/api/v1'

/** What the API clamps a page to, whatever `limit` asks for. */
const PAGE = 25

/**
 * Measured, not guessed: it answers in about 300 ms, tolerates roughly five requests a
 * second, and refuses above that. One at a time the walk took hours and six at a time
 * it was refused outright, so three with a short pause is the shape that fits — about
 * four times faster than serial and still inside what the free tier allows.
 *
 * The retry ladder is long on purpose. A walk of a few thousand requests will meet a
 * refusal eventually, and aborting an hour of work over one is worse than waiting.
 */
const PAUSE_MS = 400
const RETRIES = 8
const AT_ONCE = 3

/** Bounded concurrency. Unbounded would open a thousand sockets on the deepest slice. */
async function pool<T>(items: readonly T[], work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const runners = Array.from({ length: Math.min(AT_ONCE, items.length) }, async () => {
    for (;;) {
      const mine = next
      next += 1
      const item = items[mine]
      if (item === undefined) return
      await work(item)
    }
  })
  await Promise.all(runners)
}

export interface SourceExercise {
  readonly exerciseId: string
  readonly name: string
  readonly gifUrl: string
  readonly bodyParts: readonly string[]
  readonly equipments: readonly string[]
  readonly targetMuscles: readonly string[]
  readonly secondaryMuscles: readonly string[]
  readonly instructions: readonly string[]
}

interface Page {
  readonly success?: boolean
  readonly meta?: { readonly total?: number }
  readonly data?: readonly SourceExercise[]
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const CACHE = new URL('./.cache/', import.meta.url).pathname

/** The query is the identity of the answer, so it is also the name of the file. */
function cached(query: string): string {
  return `${CACHE}${query.replace(/[^a-z0-9]+/gi, '_')}.json`
}

async function ask(params: Record<string, string>): Promise<Page> {
  const query = new URLSearchParams({ limit: String(PAGE), ...params })
  const file = Bun.file(cached(query.toString()))
  if (await file.exists()) return (await file.json()) as Page

  for (let attempt = 0; attempt < RETRIES; attempt += 1) {
    try {
      await sleep(PAUSE_MS)
      const response = await fetch(`${API}/exercises?${query}`)
      if (response.ok) {
        const body = (await response.json()) as Page
        if (body.success) {
          await Bun.write(cached(query.toString()), JSON.stringify(body))
          return body
        }
      }
    } catch {
      // A refused connection is the same as a 429 here: wait and ask again.
    }
    await sleep(PAUSE_MS * 2 ** attempt)
  }
  throw new Error(`ExerciseDB did not answer for ${query}`)
}

async function facet(name: string): Promise<readonly string[]> {
  const response = await fetch(`${API}/${name}`)
  if (!response.ok) throw new Error(`Could not read the ${name} vocabulary`)
  const body = (await response.json()) as { data?: readonly { name: string }[] }
  return (body.data ?? []).map((term) => term.name)
}

export interface Coverage {
  /** What the source says the slice holds. */
  readonly total: number
  /** What a page could actually carry out of it. */
  readonly taken: number
}

/**
 * Everything one slice will give up, splitting it while splitting still helps.
 *
 * A slice past the last axis and still over a page is **not** a failure: it is the
 * source refusing to be walked. It contributes its first page and says how much it
 * kept back, which is the number the caller reports.
 */
async function collect(
  slice: Record<string, string>,
  deeper: readonly (readonly [string, readonly string[]])[],
  found: Map<string, SourceExercise>,
  short: Coverage[],
): Promise<void> {
  const head = await ask(slice)
  const total = head.meta?.total ?? 0
  if (total === 0) return

  const page = head.data ?? []
  if (total <= PAGE) {
    for (const one of page) found.set(one.exerciseId, one)
    return
  }

  const [axis, ...rest] = deeper
  if (!axis) {
    for (const one of page) found.set(one.exerciseId, one)
    short.push({ total, taken: page.length })
    return
  }

  const [key, values] = axis
  await pool(values, (value) => collect({ ...slice, [key]: value }, rest, found, short))
}

const here = (name: string) => new URL(`./${name}`, import.meta.url).pathname

/** One file per body part, so a killed run resumes instead of starting over. */
const partial = (bodyPart: string) => here(`.partial-${bodyPart.replace(/\s+/g, '-')}.json`)

async function main(): Promise<void> {
  const [bodyParts, equipments] = await Promise.all([facet('bodyparts'), facet('equipments')])

  // Equipment is the only axis that both narrows and partitions. `muscles` is ignored
  // when combined and single letters are below the name filter's minimum, so neither
  // can split anything: see the header.
  const axes = [['equipments', equipments]] as const

  for (const bodyPart of bodyParts) {
    const file = Bun.file(partial(bodyPart))
    if (await file.exists()) {
      console.log(`${bodyPart.padEnd(12)} already taken`)
      continue
    }

    const head = await ask({ bodyParts: bodyPart })
    const total = head.meta?.total ?? 0

    const slice = new Map<string, SourceExercise>()
    const short: Coverage[] = []
    await collect({ bodyParts: bodyPart }, axes, slice, short)
    const missed = short.reduce((sum, one) => sum + (one.total - one.taken), 0)
    if (slice.size + missed !== total) {
      throw new Error(
        `${bodyPart}: ${slice.size} taken plus ${missed} left behind is not the ${total} promised`,
      )
    }
    await Bun.write(partial(bodyPart), JSON.stringify([...slice.values()]))
    console.log(
      `${bodyPart.padEnd(12)} ${String(slice.size).padStart(4)} of ${String(total).padStart(4)}` +
        (missed === 0 ? '' : `  (${missed} the source would not page)`),
    )
  }

  const found = new Map<string, SourceExercise>()
  for (const bodyPart of bodyParts) {
    const rows = (await Bun.file(partial(bodyPart)).json()) as SourceExercise[]
    for (const one of rows) found.set(one.exerciseId, one)
  }

  const exercises = [...found.values()].sort((left, right) =>
    left.exerciseId.localeCompare(right.exerciseId),
  )
  await Bun.write(
    here('exercisedb-snapshot.json'),
    `${JSON.stringify({ source: 'oss.exercisedb.dev', taken: exercises.length, exercises }, null, 1)}\n`,
  )
  console.log(`\n${exercises.length} exercises written`)
}

await main()
