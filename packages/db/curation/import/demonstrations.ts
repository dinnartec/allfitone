/**
 * Which ExerciseDB exercise demonstrates which of our movements, decided by a person.
 *
 * **Nothing here is matched by name at run time.** An automatic match is right often
 * enough to be trusted and wrong often enough to ship a demonstration of a different
 * exercise, which is worse than shipping none: somebody who cannot deduce the movement
 * from its name is exactly who follows the picture. So the pairing is written down,
 * reviewed, and versioned, and the pipeline only resolves what this file already says.
 *
 * The `ordinal` is repeated from `001_global_training_catalogue.sql` rather than
 * derived, so that renaming or renumbering a slug over there fails a test here instead
 * of silently pairing a movement with somebody else's artwork. The identity of a row is
 * its ordinal; the slug is how this file and that one talk about it.
 *
 * **Seven movements are deliberately left without one**, because the free tier has no
 * honest match and a near-match would be a lie drawn at 180 pixels:
 *
 * - `hip_thrust` — only a band-on-knees variant, which is a different exercise.
 * - `plank` — the only front plank carries a plate on the back; ours is bodyweight.
 * - `full_body_circuit` — a circuit is a structure, not a movement. No single artwork
 *   can stand for it, and picking one of its exercises would misrepresent the whole.
 * - `hip_mobility` — every candidate needs a roller, a rope or a ball; ours needs none.
 *
 * A movement without a demonstration is a supported state end to end: the projection
 * answers `null`, and the detail screen draws the muscle group instead.
 */

export interface Demonstration {
  /** Its identity in `001_global_training_catalogue.sql`; the slug is the label. */
  readonly ordinal: number
  readonly slug: string
  readonly exerciseId: string
  /** Their name for it, kept so a reviewer can check the pairing without the network. */
  readonly source: string
}

export const DEMONSTRATIONS: readonly Demonstration[] = [
  { ordinal: 1, slug: 'back_squat', exerciseId: 'qXTaZnJ', source: 'barbell full squat' },
  { ordinal: 2, slug: 'goblet_squat', exerciseId: 'yn8yg1r', source: 'dumbbell goblet squat' },
  // Their string is mis-encoded at the source. Copied verbatim, because the check is
  // that the identifier still points at the same row, not that the row reads well.
  { ordinal: 3, slug: 'leg_press', exerciseId: '10Z2DXU', source: 'sled 45в° leg press' },
  { ordinal: 4, slug: 'lunge', exerciseId: 'RRWFUcw', source: 'dumbbell lunge' },
  { ordinal: 5, slug: 'deadlift', exerciseId: 'ila4NZS', source: 'barbell deadlift' },
  {
    ordinal: 6,
    slug: 'romanian_deadlift',
    exerciseId: 'wQ2c4XD',
    source: 'barbell romanian deadlift',
  },
  { ordinal: 8, slug: 'glute_bridge', exerciseId: 'u0cNiij', source: 'low glute bridge on floor' },
  { ordinal: 9, slug: 'leg_extension', exerciseId: 'my33uHU', source: 'lever leg extension' },
  { ordinal: 10, slug: 'leg_curl', exerciseId: '17lJ1kr', source: 'lever lying leg curl' },
  {
    ordinal: 11,
    slug: 'calf_raise',
    exerciseId: 'bJYHBIN',
    source: 'bodyweight standing calf raise',
  },
  { ordinal: 12, slug: 'bench_press', exerciseId: 'EIeI8Vf', source: 'barbell bench press' },
  { ordinal: 13, slug: 'db_bench_press', exerciseId: 'SpYC0Kp', source: 'dumbbell bench press' },
  {
    ordinal: 14,
    slug: 'incline_db_press',
    exerciseId: 'ns0SIbU',
    source: 'dumbbell incline bench press',
  },
  { ordinal: 15, slug: 'push_up', exerciseId: 'I4hDWkc', source: 'push-up' },
  { ordinal: 16, slug: 'db_fly', exerciseId: 'yz9nUhF', source: 'dumbbell fly' },
  { ordinal: 17, slug: 'dip', exerciseId: '9WTm7dq', source: 'chest dip' },
  { ordinal: 18, slug: 'pull_up', exerciseId: 'lBDjFxJ', source: 'pull-up' },
  { ordinal: 19, slug: 'lat_pulldown', exerciseId: 'RVwzP10', source: 'cable pulldown' },
  { ordinal: 20, slug: 'barbell_row', exerciseId: 'eZyBC3j', source: 'barbell bent over row' },
  { ordinal: 21, slug: 'db_row', exerciseId: 'BJ0Hz5L', source: 'dumbbell bent over row' },
  { ordinal: 22, slug: 'cable_row', exerciseId: 'fUBheHs', source: 'cable seated row' },
  // Standing and with a barbell, which is the movement. The grip is wider than ours.
  {
    ordinal: 23,
    slug: 'overhead_press',
    exerciseId: 'Kyd9Rz5',
    source: 'barbell standing wide military press',
  },
  {
    ordinal: 24,
    slug: 'db_shoulder_press',
    exerciseId: 'znQUdHY',
    source: 'dumbbell seated shoulder press',
  },
  { ordinal: 25, slug: 'lateral_raise', exerciseId: 'DsgkuIt', source: 'dumbbell lateral raise' },
  { ordinal: 26, slug: 'barbell_curl', exerciseId: '25GPyDY', source: 'barbell curl' },
  { ordinal: 27, slug: 'triceps_pushdown', exerciseId: '3ZflifB', source: 'cable pushdown' },
  { ordinal: 29, slug: 'side_plank', exerciseId: 'RKjH6Lt', source: 'side bridge v. 2' },
  { ordinal: 30, slug: 'hanging_leg_raise', exerciseId: 'I3tsCnC', source: 'hanging leg raise' },
  { ordinal: 31, slug: 'ab_wheel', exerciseId: 'NAgVB3t', source: 'wheel rollerout' },
  { ordinal: 32, slug: 'steady_run', exerciseId: 'oLrKqDH', source: 'run' },
  // The incline is what makes a walk brisk without turning it into a run.
  {
    ordinal: 33,
    slug: 'brisk_walk',
    exerciseId: 'rjiM4L3',
    source: 'walking on incline treadmill',
  },
  { ordinal: 34, slug: 'stationary_bike', exerciseId: 'H1PESYI', source: 'stationary bike run' },
  // Same artwork as the steady run: intervals differ in how it is prescribed, not done.
  { ordinal: 35, slug: 'run_intervals', exerciseId: 'oLrKqDH', source: 'run' },
  { ordinal: 38, slug: 'thoracic_mobility', exerciseId: 'GSDioYu', source: 'upper back stretch' },
]

/** The curated namespace: the ordinal is the identity, padded, never renumbered. */
export function movementId(ordinal: number): string {
  return `019f1000-0000-7000-8000-${String(ordinal).padStart(12, '0')}`
}
