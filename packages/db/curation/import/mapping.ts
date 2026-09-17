/**
 * Their vocabulary against ours, written down rather than guessed.
 *
 * The source names 28 kinds of equipment and 48 muscles; we name 17 and 18. The gap is
 * not an accident on either side. Theirs is an index of gym objects — `ez barbell`,
 * `olympic barbell` and `trap bar` are three rows there — and ours is the vocabulary a
 * person filters by, where all three are a barbell. Theirs names anatomy at the level
 * of `levator scapulae`; ours names what the figure on the screen can actually draw.
 *
 * **So the mapping is lossy on purpose, and every loss is a decision.** A table like
 * this is the only place those decisions can be reviewed. Matching by name at import
 * time would make them invisible and unrepeatable.
 *
 * Two rules it follows:
 *
 * 1. **Nothing unmapped is imported.** A term absent from these tables stops the run
 *    rather than being dropped quietly — a source that adds a vocabulary term would
 *    otherwise silently lose every exercise that uses it.
 * 2. **What is deliberately not wanted is listed, with why.** `DISCARDED` is not the
 *    same as "we forgot"; it is the same review as everything else.
 *
 * `V1_DATA_DICTIONARY.md` §8.15 is why the muscle side does not simply adopt theirs:
 * our muscle vocabulary is product language tied to the body figure, and a term the
 * figure cannot light is a filter chip that looks broken when chosen.
 */

/** Ours, in the order `001_global_training_catalogue.sql` declares them. */
export const EQUIPMENT_CODES = [
  'bodyweight',
  'barbell',
  'dumbbell',
  'kettlebell',
  'machine',
  'cable',
  'bench',
  'pull_up_bar',
  'cardio_machine',
  'band',
  'smith_machine',
  'weighted',
  'stability_ball',
  'assisted',
  'medicine_ball',
  'rope',
  'ab_wheel',
  'foam_roller',
] as const

export type EquipmentCode = (typeof EQUIPMENT_CODES)[number]

/**
 * Theirs to ours.
 *
 * The three barbells collapse because the filter answers "do I need a barbell", not
 * "which barbell". `sled machine` and `leverage machine` are both a loaded machine to
 * somebody standing in a gym. The five cardio machines collapse for the same reason:
 * a treadmill and a stepmill are the same answer to "is there a machine for this".
 */
export const EQUIPMENT: Readonly<Record<string, EquipmentCode>> = {
  'body weight': 'bodyweight',
  barbell: 'barbell',
  'ez barbell': 'barbell',
  'olympic barbell': 'barbell',
  'trap bar': 'barbell',
  dumbbell: 'dumbbell',
  kettlebell: 'kettlebell',
  'leverage machine': 'machine',
  'sled machine': 'machine',
  cable: 'cable',
  'smith machine': 'smith_machine',
  band: 'band',
  'resistance band': 'band',
  weighted: 'weighted',
  'stability ball': 'stability_ball',
  'bosu ball': 'stability_ball',
  assisted: 'assisted',
  'medicine ball': 'medicine_ball',
  rope: 'rope',
  'wheel roller': 'ab_wheel',
  roller: 'foam_roller',
  'stationary bike': 'cardio_machine',
  'elliptical machine': 'cardio_machine',
  'stepmill machine': 'cardio_machine',
  'skierg machine': 'cardio_machine',
  'upper body ergometer': 'cardio_machine',
}

/**
 * Equipment we will not carry, and the reason.
 *
 * Both are strongman implements with one exercise each in the whole source. A filter
 * chip nobody can satisfy is worse than a missing exercise: it makes the catalogue
 * look like it has more than it does and then answers nothing.
 */
export const DISCARDED_EQUIPMENT: Readonly<Record<string, string>> = {
  tire: 'one exercise, and a tyre is not equipment anybody filters a catalogue by',
  hammer: 'one exercise, and it is the tyre one',
}

/** Ours, from `curated_muscle`. Ordinal 16 is vacant and is never reused. */
export const MUSCLE_CODES = [
  'chest',
  'upper_back',
  'lats',
  'lower_back',
  'trapezius',
  'shoulders',
  'biceps',
  'triceps',
  'forearm',
  'neck',
  'abs',
  'glutes',
  'quadriceps',
  'hamstrings',
  'adductors',
  'calves',
  'cardio',
  'whole_body',
] as const

export type MuscleCode = (typeof MUSCLE_CODES)[number]

/**
 * Theirs to ours, covering both the muscle a movement targets and the ones it names
 * as secondary. The secondary list is the looser of the two and carries terms like
 * `grip muscles` and `ankle stabilizers`, which are real and are not parts of a
 * drawing.
 *
 * Three decisions worth naming, because they lose information:
 *
 * - **`abductors` becomes `glutes`.** Our vocabulary has no abductor and ordinal 16 is
 *   vacant for that reason: the figure has no part even approximately right for it,
 *   and the glute was tried and read as a different muscle.
 * - **`hip flexors` becomes `quadriceps`.** They are neighbours on the figure, and the
 *   rectus femoris genuinely is a hip flexor. It is the least wrong part that exists.
 * - **Everything below the ankle becomes `calves`.** Shins, feet and soleus are drawn
 *   as one region, and lighting the calf for a shin exercise is closer than lighting
 *   nothing.
 */
export const MUSCLE: Readonly<Record<string, MuscleCode>> = {
  // What the source calls the target.
  pectorals: 'chest',
  delts: 'shoulders',
  abs: 'abs',
  glutes: 'glutes',
  triceps: 'triceps',
  biceps: 'biceps',
  'upper back': 'upper_back',
  lats: 'lats',
  calves: 'calves',
  forearms: 'forearm',
  'cardiovascular system': 'cardio',
  quads: 'quadriceps',
  hamstrings: 'hamstrings',
  spine: 'lower_back',
  traps: 'trapezius',
  'serratus anterior': 'chest',
  adductors: 'adductors',
  abductors: 'glutes',
  'levator scapulae': 'neck',

  // What it only ever calls secondary.
  abdominals: 'abs',
  core: 'abs',
  obliques: 'abs',
  back: 'upper_back',
  rhomboids: 'upper_back',
  'latissimus dorsi': 'lats',
  'lower back': 'lower_back',
  chest: 'chest',
  'upper chest': 'chest',
  deltoids: 'shoulders',
  'rear deltoids': 'shoulders',
  shoulders: 'shoulders',
  'rotator cuff': 'shoulders',
  brachialis: 'biceps',
  quadriceps: 'quadriceps',
  'hip flexors': 'quadriceps',
  groin: 'adductors',
  trapezius: 'trapezius',
  sternocleidomastoid: 'neck',
  soleus: 'calves',
  shins: 'calves',
  ankles: 'calves',
  'ankle stabilizers': 'calves',
  feet: 'calves',
  'grip muscles': 'forearm',
  hands: 'forearm',
  wrists: 'forearm',
  'wrist extensors': 'forearm',
  'wrist flexors': 'forearm',
}

/**
 * Their body part to the discipline a movement belongs to.
 *
 * Only `cardio` decides anything: everything else the source lists is a region of the
 * body, and a region does not say whether a movement is strength or mobility. That is
 * a judgement the curation makes per movement, which is why this is not a table of ten.
 */
export const CARDIO_BODY_PART = 'cardio'

export interface Unmapped {
  readonly kind: 'equipment' | 'muscle'
  readonly term: string
}

/** Everything the source says that neither table nor the discard list accounts for. */
export function unmapped(
  equipments: readonly string[],
  muscles: readonly string[],
): readonly Unmapped[] {
  const missing: Unmapped[] = []
  for (const term of equipments) {
    if (!(term in EQUIPMENT) && !(term in DISCARDED_EQUIPMENT)) {
      missing.push({ kind: 'equipment', term })
    }
  }
  for (const term of muscles) {
    if (!(term in MUSCLE)) missing.push({ kind: 'muscle', term })
  }
  return missing
}
