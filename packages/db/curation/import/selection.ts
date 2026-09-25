/**
 * Which of the thousand candidates become catalogue, and on what grounds.
 *
 * **The whole source is not the goal.** Hevy ships a little over four hundred
 * movements and is not considered thin; the rest of a thousand-entry dump is variants
 * nobody programmes — `dumbbell iron cross - improved variation` is a real row in
 * there. A catalogue is judged on whether the movement somebody is looking for is in
 * it, not on its size, and every row we publish is a row somebody has to review.
 *
 * So this picks, and it picks by a rule rather than by taste, so that a rerun makes the
 * same catalogue and a disagreement is an argument about the rule.
 *
 * 1. **Names that are already an apology are dropped.** `v. 2`, `- improved variation`,
 *    `(male)`: the source uses these for near-duplicates of a row it already has. They
 *    are the second copy, not the movement.
 * 2. **What we already curated is dropped**, by identifier, so the existing thirty-odd
 *    are never proposed twice under a different Spanish name.
 * 3. **Each body part gets a share of the wave proportional to what the source holds**,
 *    which keeps the catalogue shaped like a gym instead of like whatever sorted first.
 * 4. **A name is taken once.** The source carries the same name under two identifiers
 *    — `barbell seated calf raise` is in there twice — and two rows with one name
 *    would collide on `normalized_name` and read as a catalogue that cannot count.
 * 5. **Inside a body part, the plainest name wins.** Fewer words means closer to the
 *    movement everybody means: `barbell bench press` before
 *    `barbell reverse grip decline bench press`. Ties break on identifier so the order
 *    never depends on the file.
 *
 * It writes `wave.json`: the chosen exercises with their taxonomy already translated
 * through `mapping.ts`, which is the spine the Spanish authoring hangs off. Names,
 * aliases and steps are **not** here and are not derived from the source — they are
 * written by a person, which is the decision `V1_DATA_DICTIONARY.md` §8.17 requires.
 */

import { DEMONSTRATIONS } from './demonstrations.js'
import { EQUIPMENT, MUSCLE, unmapped, type EquipmentCode, type MuscleCode } from './mapping.js'
import type { SourceExercise } from './snapshot.js'

const here = (name: string) => new URL(`./${name}`, import.meta.url).pathname

/** 38 curated already; this is what the wave adds on top. */
const WAVE_SIZE = 362

/** The source's own marker for "this is another one of those". */
const SECOND_COPY = /\((male|female)\)|\bv\.? ?\d|\bversion\b|\bvariation\b|\bimproved\b/i

export interface Chosen {
  readonly exerciseId: string
  readonly source: string
  readonly bodyPart: string
  readonly equipment: readonly EquipmentCode[]
  /** Primary first, the way `curated_movement_muscle` expects it. */
  readonly muscles: readonly MuscleCode[]
}

/** Distinct, in order, because the same code can arrive from two of their terms. */
function unique<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)]
}

/** Looked up rather than asserted: an unmapped term must stop the run, not slip in. */
function equipmentFor(term: string): EquipmentCode {
  const code = EQUIPMENT[term]
  if (code === undefined) throw new Error(`equipment "${term}" is not mapped`)
  return code
}

function muscleFor(term: string): MuscleCode {
  const code = MUSCLE[term]
  if (code === undefined) throw new Error(`muscle "${term}" is not mapped`)
  return code
}

function translate(exercise: SourceExercise): Chosen {
  const missing = unmapped(exercise.equipments, [
    ...exercise.targetMuscles,
    ...exercise.secondaryMuscles,
  ])
  if (missing.length > 0) {
    throw new Error(
      `${exercise.name}: ${missing.map((one) => `${one.kind} "${one.term}"`).join(', ')} is not mapped`,
    )
  }

  return {
    exerciseId: exercise.exerciseId,
    source: exercise.name,
    bodyPart: exercise.bodyParts[0] ?? 'unknown',
    equipment: unique(exercise.equipments.map(equipmentFor)),
    muscles: unique([
      ...exercise.targetMuscles.map(muscleFor),
      ...exercise.secondaryMuscles.map(muscleFor),
    ]),
  }
}

/** Largest remainder, so the shares sum to the wave exactly rather than nearly. */
function shares(sizes: ReadonlyMap<string, number>, total: number): Map<string, number> {
  const whole = [...sizes.values()].reduce((sum, one) => sum + one, 0)
  const exact = [...sizes].map(([part, size]) => ({ part, want: (size / whole) * total }))
  const given = new Map(exact.map((one) => [one.part, Math.floor(one.want)]))
  let left = total - [...given.values()].reduce((sum, one) => sum + one, 0)
  for (const one of [...exact].sort((a, b) => (b.want % 1) - (a.want % 1))) {
    if (left <= 0) break
    given.set(one.part, (given.get(one.part) ?? 0) + 1)
    left -= 1
  }
  return given
}

export function choose(pool: readonly SourceExercise[]): readonly Chosen[] {
  const taken = new Set(DEMONSTRATIONS.map((one) => one.exerciseId))
  const eligible = pool.filter(
    (one) =>
      !taken.has(one.exerciseId) &&
      !SECOND_COPY.test(one.name) &&
      one.equipments.every((term) => term in EQUIPMENT),
  )

  // First identifier wins, in the order the snapshot was written, so a rerun keeps it.
  const seen = new Set<string>()
  const distinct = eligible.filter((one) => {
    const name = one.name.trim().toLowerCase()
    if (seen.has(name)) return false
    seen.add(name)
    return true
  })

  const byPart = new Map<string, SourceExercise[]>()
  for (const one of distinct) {
    const part = one.bodyParts[0] ?? 'unknown'
    byPart.set(part, [...(byPart.get(part) ?? []), one])
  }

  const quota = shares(
    new Map([...byPart].map(([part, rows]) => [part, rows.length])),
    Math.min(WAVE_SIZE, distinct.length),
  )

  const chosen: Chosen[] = []
  for (const [part, rows] of byPart) {
    const plainest = [...rows].sort(
      (a, b) =>
        a.name.split(' ').length - b.name.split(' ').length ||
        a.name.length - b.name.length ||
        a.exerciseId.localeCompare(b.exerciseId),
    )
    for (const one of plainest.slice(0, quota.get(part) ?? 0)) chosen.push(translate(one))
  }

  return chosen.sort(
    (a, b) => a.bodyPart.localeCompare(b.bodyPart) || a.source.localeCompare(b.source),
  )
}

async function main(): Promise<void> {
  const pool = (
    (await Bun.file(here('exercisedb-snapshot.json')).json()) as {
      exercises: readonly SourceExercise[]
    }
  ).exercises

  const chosen = choose(pool)
  await Bun.write(
    here('wave.json'),
    `${JSON.stringify({ taken: chosen.length, chosen }, null, 1)}\n`,
  )

  const byPart = new Map<string, number>()
  for (const one of chosen) byPart.set(one.bodyPart, (byPart.get(one.bodyPart) ?? 0) + 1)
  for (const [part, count] of [...byPart].sort((a, b) => b[1] - a[1])) {
    console.log(`${part.padEnd(12)} ${String(count).padStart(3)}`)
  }
  console.log(`\n${chosen.length} chosen, on top of the 38 already curated`)
}

if (import.meta.main) await main()
