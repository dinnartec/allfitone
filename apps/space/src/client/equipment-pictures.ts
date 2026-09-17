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
 *
 * **They carry their own white ground and no transparency.** The set they replaced had
 * been cut off a dark background by luminance, which left the objects' own dark parts
 * transparent — 46% of a kettlebell, 41% of the cardio machine. On the dark canvas that
 * was invisible, because a dark hole on a dark ground is nothing; it only surfaced when
 * the tile's picture moved onto a light plate. Shipping the ground inside the file
 * means there is no cut-out left to get wrong.
 */

import abWheel from '../../assets/images/equipment/ab_wheel.webp'
import assisted from '../../assets/images/equipment/assisted.webp'
import band from '../../assets/images/equipment/band.webp'
import barbell from '../../assets/images/equipment/barbell.webp'
import bench from '../../assets/images/equipment/bench.webp'
import bodyweight from '../../assets/images/equipment/bodyweight.webp'
import cable from '../../assets/images/equipment/cable.webp'
import cardioMachine from '../../assets/images/equipment/cardio_machine.webp'
import dumbbell from '../../assets/images/equipment/dumbbell.webp'
import foamRoller from '../../assets/images/equipment/foam_roller.webp'
import kettlebell from '../../assets/images/equipment/kettlebell.webp'
import machine from '../../assets/images/equipment/machine.webp'
import medicineBall from '../../assets/images/equipment/medicine_ball.webp'
import pullUpBar from '../../assets/images/equipment/pull_up_bar.webp'
import rope from '../../assets/images/equipment/rope.webp'
import smithMachine from '../../assets/images/equipment/smith_machine.webp'
import stabilityBall from '../../assets/images/equipment/stability_ball.webp'
import weighted from '../../assets/images/equipment/weighted.webp'

export const EQUIPMENT_PICTURES: Readonly<Record<string, number>> = {
  ab_wheel: abWheel,
  assisted,
  band,
  barbell,
  bench,
  bodyweight,
  cable,
  cardio_machine: cardioMachine,
  dumbbell,
  foam_roller: foamRoller,
  kettlebell,
  machine,
  medicine_ball: medicineBall,
  pull_up_bar: pullUpBar,
  rope,
  smith_machine: smithMachine,
  stability_ball: stabilityBall,
  weighted,
}
