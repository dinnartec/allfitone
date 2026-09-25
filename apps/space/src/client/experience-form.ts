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
 * bores them until they leave. So the words carry no rank and **el recorrido** carries
 * all of it: una escala vertical de tres paradas, de menos a más. Dice que hay una
 * escala sin colgarle a nadie una etiqueta de gimnasio.
 *
 * **El recorrido no se llena hasta la parada marcada.** Se probó —un nivel contiene a
 * los de abajo, así que encender el tramo recorrido parecía decir algo verdadero— y en
 * pantalla se leía como si la línea se moviera al elegir, que es exactamente lo que una
 * lista de opciones no debe hacer. Lo único que cambia al marcar es su círculo. El orden
 * vertical sigue siendo la escala, y eso no necesita que nada se pinte.
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
 * **La consecuencia dice el volumen y nada más.** Decía también cuánta explicación
 * llevaría cada ejercicio y que habría progresiones desde la primera semana, y ninguna
 * de las dos cosas está automatizada: eran promesas que el producto todavía no cumple,
 * escritas donde alguien las lee para decidir. Se quitaron el 22 de septiembre de 2026.
 *
 * El volumen que queda —poco, medio, alto— y los cortes de tiempo **tampoco están
 * validados** por nadie que programe entrenamiento, y ninguna pieza de `planning`
 * consume todavía el nivel. Están anotados como pendientes de confirmar en
 * `allfitone-docs`, que es donde vive una afirmación de producto.
 */

/** The three simple terms of HU-SP-012 criterion 2, least to most. */
export const TRAINING_EXPERIENCE = ['starting', 'some_practice', 'experienced'] as const

export type TrainingExperience = (typeof TRAINING_EXPERIENCE)[number]

/**
 * What the chosen card promises. Split into three parts so the screen can emphasise
 * the part that carries the information without parsing a string in the view.
 *
 * **En infinitivo y no en primera persona del plural.** «Empezaremos» es una promesa
 * que hace alguien, y aquí no hay nadie prometiendo: es la etiqueta de lo que esa
 * parada significa, leída mientras se compara con las otras dos. «Empezar con volumen
 * medio» se lee como lo que es —una opción— y no como una frase que ya te incluye.
 */
export interface LevelOutcome {
  readonly before: string
  readonly emphasis: string
  readonly after: string
}

export interface LevelDefinition {
  readonly level: TrainingExperience
  readonly name: string
  readonly description: string
  readonly outcome: LevelOutcome
}

export const EXPERIENCE_LEVELS: readonly LevelDefinition[] = [
  {
    level: 'starting',
    name: 'Estoy empezando',
    description: 'Nunca he entrenado con constancia, o llevo menos de seis meses.',
    outcome: {
      before: 'Empezar con ',
      emphasis: 'poco volumen',
      after: '.',
    },
  },
  {
    level: 'some_practice',
    name: 'Tengo algo de práctica',
    description: 'Entreno hace más de seis meses y conozco los ejercicios básicos.',
    outcome: {
      before: 'Empezar con ',
      emphasis: 'volumen medio',
      after: '.',
    },
  },
  {
    level: 'experienced',
    name: 'Tengo experiencia',
    description: 'Años entrenando. Sé de series, cargas y progresiones.',
    outcome: {
      before: 'Empezar con ',
      emphasis: 'volumen alto',
      after: '.',
    },
  },
]

/**
 * The notice under the cards, shown whether or not anything is chosen. Someone
 * afraid of being mislabelled has to read this before answering, so it cannot wait
 * for a selection to appear.
 */
/**
 * La bajada de la pantalla. **Dice qué hacer antes de decir por qué**: sin el «marca»
 * delante, tres paradas con un círculo hueco se leen como una explicación y no como una
 * pregunta, y nadie sabe que tiene que tocar algo.
 */
export const PICK_A_LEVEL =
  'Marca tu punto de partida, para no tratarte como principiante si no lo eres, ni al revés.'

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

/** Una parada del recorrido, con todo lo que la pantalla necesita para dibujarla. */
export interface LevelStop {
  readonly entry: LevelDefinition
  readonly chosen: boolean
  /** La última no tiene tramo: un hilo que sale de ella no llevaría a ninguna parte. */
  readonly last: boolean
}

export function experienceStops(chosen: TrainingExperience | undefined): readonly LevelStop[] {
  return EXPERIENCE_LEVELS.map((entry, index) => ({
    entry,
    chosen: entry.level === chosen,
    last: index === EXPERIENCE_LEVELS.length - 1,
  }))
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
