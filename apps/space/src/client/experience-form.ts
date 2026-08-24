/**
 * The training experience screen, minus the rendering.
 *
 * Everything decidable lives here rather than in `app/`, because `bun test src` is
 * the only glob this workspace runs and no component renderer is installed: what
 * stays in a screen file cannot be checked at all. `sex-form.ts` and `goal-form.ts`
 * made the same split for the same reason.
 *
 * **Three levels, and never `beginner`, `intermediate`, `advanced`.** HU-SP-012 asks
 * for simple terms, and the reason is behavioural rather than stylistic: "advanced"
 * makes people underrate themselves, pick below their real level, and get a plan that
 * bores them until they leave. So the words carry no rank and the bars carry all of
 * it — one, two or three — which says there is a scale without hanging a gym label on
 * the person.
 *
 * **The chosen card says what changes.** A level that only highlights itself asks
 * someone to guess what they are choosing; naming the consequence is what lets them
 * choose honestly instead of modestly. That is also why the footer notice is fixed
 * rather than revealed: the loads move from the first week either way, and someone
 * who fears being mislabelled needs to read that before they answer, not after.
 *
 * **Re-tapping the chosen level does not clear it.** "No level" is not an answer this
 * screen offers — unlike the biological sex, where declining is a real answer with its
 * own meaning. Nothing arrives selected, though: a default would write a declaration
 * nobody made, which is the rule `sex-form.ts` states in full.
 *
 * The consequence copy and the time cuts are **not validated**. "Medium volume" and
 * "progressions from the first week" describe what the plan will do, and nothing in
 * `planning` consumes an experience level today, so they are an intention rather than
 * a description. Recorded as pending confirmation in `allfitone-docs`, where a product
 * claim belongs, rather than left to look settled because it is written in code.
 */

/** The three simple terms of HU-SP-012 criterion 2, least to most. */
export const TRAINING_EXPERIENCE = ['starting', 'some_practice', 'experienced'] as const

export type TrainingExperience = (typeof TRAINING_EXPERIENCE)[number]

/** How many bars the scale has, which is also the number of levels. */
export const BAR_COUNT = 3

/**
 * What the chosen card promises. Split into three parts so the screen can emphasise
 * the part that carries the information without parsing a string in the view.
 */
export interface LevelOutcome {
  readonly before: string
  readonly emphasis: string
  readonly after: string
}

export interface LevelDefinition {
  readonly level: TrainingExperience
  readonly name: string
  /** Filled bars, 1 to `BAR_COUNT`. The only indicator of order on the screen. */
  readonly bars: number
  readonly description: string
  readonly outcome: LevelOutcome
}

export const EXPERIENCE_LEVELS: readonly LevelDefinition[] = [
  {
    level: 'starting',
    name: 'Estoy empezando',
    bars: 1,
    description: 'Nunca he entrenado con constancia, o llevo menos de seis meses.',
    outcome: {
      before: 'Empezaremos con ',
      emphasis: 'poco volumen',
      after: ' y más explicación en cada ejercicio.',
    },
  },
  {
    level: 'some_practice',
    name: 'Tengo algo de práctica',
    bars: 2,
    description: 'Entreno hace más de seis meses y conozco los ejercicios básicos.',
    outcome: {
      before: 'Empezaremos con ',
      emphasis: 'volumen medio',
      after: ' y sin explicarte lo básico.',
    },
  },
  {
    level: 'experienced',
    name: 'Tengo experiencia',
    bars: 3,
    description: 'Años entrenando. Sé de series, cargas y progresiones.',
    outcome: {
      before: 'Empezaremos con ',
      emphasis: 'volumen alto',
      after: ' y progresiones desde la primera semana.',
    },
  },
]

/**
 * The notice under the cards, shown whether or not anything is chosen. Someone
 * afraid of being mislabelled has to read this before answering, so it cannot wait
 * for a selection to appear.
 */
export const NOT_A_LABEL_TITLE = 'No es una etiqueta fija.'
export const NOT_A_LABEL_BODY =
  ' Tus propias sesiones ajustan las cargas desde la primera semana. Esto solo define el punto de partida.'

/** The definition of a level, or undefined for a code this version cannot draw. */
export function levelDefinition(level: TrainingExperience): LevelDefinition | undefined {
  return EXPERIENCE_LEVELS.find((entry) => entry.level === level)
}

/**
 * Choosing a level. Exclusive in one direction only: tapping the one already chosen
 * leaves it chosen, because unchoosing would produce a state this screen has no
 * answer for.
 */
export function chooseLevel(
  current: TrainingExperience | undefined,
  level: TrainingExperience,
): TrainingExperience {
  return level === current ? current : level
}

/** Which bars are filled for a level, as booleans the screen can map over. */
export function barsFor(level: TrainingExperience | undefined): readonly boolean[] {
  const filled = level ? (levelDefinition(level)?.bars ?? 0) : 0
  return Array.from({ length: BAR_COUNT }, (_, index) => index < filled)
}

/** Whether the answer read back from the server is one this version can draw. */
export function readLevel(value: string | null | undefined): TrainingExperience | undefined {
  if (!value) return undefined
  return TRAINING_EXPERIENCE.find((level) => level === value)
}

export interface ExperienceSubmission {
  /** Undefined is nothing chosen yet, which is not an answer. */
  level: TrainingExperience | undefined
  submitting: boolean
  sessionExpired: boolean
}

export function canSubmitExperience({
  level,
  submitting,
  sessionExpired,
}: ExperienceSubmission): boolean {
  if (submitting || sessionExpired) return false
  return level !== undefined
}
