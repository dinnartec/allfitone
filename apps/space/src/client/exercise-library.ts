/**
 * The global catalogue, read once for the whole picking flow.
 *
 * Three screens need the same two things — every movement and the vocabularies that
 * name them — and each was asking for them on mount. `OP-CAT-009` pages by cursor, so
 * the catalogue is four round trips of a hundred; opening the picker, stepping into
 * equipment and stepping back was twelve, for bytes that had not changed in between.
 * The tiles sat empty the whole time and it read as the pictures being slow, which
 * they are not: they are bundled.
 *
 * **It is a cache for the life of the process, not storage.** The global catalogue
 * changes when we publish one, never while somebody is choosing exercises, and
 * `HU-SP-064` already wants the subset resident on the device. Nothing personal is in
 * it — movements, muscles and equipment are the same for everybody — so there is no
 * consent question and nothing to erase on sign-out beyond good manners.
 *
 * **A failure is not remembered.** Caching a rejection would turn one bad moment of
 * signal into a screen that stays broken until the app is killed, so the entry is
 * dropped the moment it rejects and the next screen tries again.
 */

import type { CatalogueTerm, ContentFlow, Movement, MuscleTerm } from './content'
import { DISCIPLINE } from './routine-draft'

export interface ExerciseLibrary {
  readonly movements: readonly Movement[]
  readonly muscles: readonly MuscleTerm[]
  readonly equipment: readonly CatalogueTerm[]
}

let pending: Promise<ExerciseLibrary> | undefined

export function readExerciseLibrary(flow: ContentFlow): Promise<ExerciseLibrary> {
  if (pending !== undefined) return pending

  const reading = Promise.all([
    flow.searchMovements(DISCIPLINE, '', [], []),
    flow.readMuscles(),
    flow.readEquipment(),
  ]).then(([movements, muscles, equipment]) => ({ movements, muscles, equipment }))

  // Attached before the caller sees it, so the entry is already gone by the time
  // anybody handles the rejection and asks again.
  pending = reading
  reading.catch(() => {
    if (pending === reading) pending = undefined
  })

  return reading
}

/** For sign-out, and for a test that needs the next read to go out again. */
export function forgetExerciseLibrary(): void {
  pending = undefined
}
