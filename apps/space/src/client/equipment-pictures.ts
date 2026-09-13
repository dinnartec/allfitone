/**
 * A picture for each equipment code the catalogue publishes.
 *
 * **Imported one by one on purpose.** Metro resolves an asset when it bundles, so a
 * path built from a code at runtime is a path it never saw and never packed. A map of
 * static imports is the only shape that survives that, and the cost is that a code
 * added to the catalogue without a picture here draws none rather than crashing.
 *
 * Keyed by `catalog.equipment.code`, so the catalogue stays the source of which
 * equipment exists and this only answers what it looks like.
 */

import barbell from '../../assets/images/equipment/barbell.webp'
import bench from '../../assets/images/equipment/bench.webp'
import bodyweight from '../../assets/images/equipment/bodyweight.webp'
import cable from '../../assets/images/equipment/cable.webp'
import cardioMachine from '../../assets/images/equipment/cardio_machine.webp'
import dumbbell from '../../assets/images/equipment/dumbbell.webp'
import kettlebell from '../../assets/images/equipment/kettlebell.webp'
import machine from '../../assets/images/equipment/machine.webp'
import pullUpBar from '../../assets/images/equipment/pull_up_bar.webp'

export const EQUIPMENT_PICTURES: Readonly<Record<string, number>> = {
  barbell,
  bench,
  bodyweight,
  cable,
  cardio_machine: cardioMachine,
  dumbbell,
  kettlebell,
  machine,
  pull_up_bar: pullUpBar,
}
