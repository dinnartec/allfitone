/**
 * La escala de esfuerzo, y qué significa cada número.
 *
 * **Nadie tiene por qué saberse el RPE.** Un campo numérico del 1 al 10 sin nada más es
 * una pregunta en un idioma que la mitad de la gente no habla, y la mitad que lo habla no
 * está de acuerdo en dónde empieza. Por eso la escala se abre explicada: qué se está
 * midiendo arriba, y qué significa el número que se acaba de marcar debajo.
 *
 * **De seis para arriba se mide en repeticiones que sobran**, que es como se prescribe de
 * verdad: un 8 es «podías hacer dos más». Por debajo de seis nadie cuenta repeticiones
 * —quedan demasiadas para que el número signifique algo—, así que esos peldaños se
 * describen por lo que se siente. Las dos mitades son la misma escala leída con la
 * herramienta que sirve en cada tramo.
 *
 * **Se marca al entrenar, no al planificar** (`ADR-033`): es lo que costó la serie, y
 * sólo se sabe después de hacerla. Por eso la escala habla en pasado.
 */

export const RPE_MIN = 1
export const RPE_MAX = 10

export interface RpeLevel {
  readonly value: number
  /** Dos palabras: es lo que se lee de un vistazo al marcar. */
  readonly name: string
  /** Qué se está pidiendo, en la unidad que sirve en ese tramo. */
  readonly detail: string
}

/** Qué se mide, dicho antes de pedir el número. */
export const RPE_EXPLAINER =
  'Cuánto te costó esa serie, del 1 al 10. Se mide por lo que te quedaba: un 8 es que ' +
  'podías hacer dos repeticiones más.'

/** Lo que dice la escala mientras nadie ha marcado nada. */
export const RPE_UNSET = 'Sin esfuerzo marcado. Es opcional.'

export const RPE_LEVELS: readonly RpeLevel[] = [
  { value: 1, name: 'Nada', detail: 'Apenas se sintió. No cuenta como trabajo.' },
  { value: 2, name: 'Muy ligero', detail: 'Moverse por moverse: calentar, soltar.' },
  { value: 3, name: 'Ligero', detail: 'Podías seguir mucho rato sin cansarte.' },
  { value: 4, name: 'Cómodo', detail: 'Se notó, pero te quedaban muchísimas repeticiones.' },
  { value: 5, name: 'Moderado', detail: 'Te quedaban cinco repeticiones o más.' },
  { value: 6, name: 'Exigente', detail: 'Te quedaban cuatro repeticiones.' },
  { value: 7, name: 'Duro', detail: 'Te quedaban tres repeticiones.' },
  { value: 8, name: 'Muy duro', detail: 'Te quedaban dos repeticiones.' },
  { value: 9, name: 'Casi al límite', detail: 'Te quedaba una repetición.' },
  {
    value: 10,
    name: 'Al límite',
    detail: 'No te quedaba ninguna repetición. No podías hacer una más.',
  },
]

/** El peldaño que corresponde a un número, o nada para uno que la escala no tiene. */
export function rpeLevel(value: number | undefined): RpeLevel | undefined {
  if (value === undefined) return undefined
  return RPE_LEVELS.find((level) => level.value === value)
}

/**
 * Lo que la fila escribe en su columna. Una raya y no un cero: no haber marcado esfuerzo
 * y marcar el mínimo son cosas distintas, y el cero diría la segunda.
 */
export function rpeShown(value: number | undefined): string {
  return value === undefined ? '—' : String(value)
}

/**
 * El copy que la escala enseña, que cambia con lo marcado.
 *
 * Sin nada marcado dice que es opcional, en vez de quedarse en blanco: el hueco se lee
 * como que falta cargar algo.
 */
export function rpeCopy(value: number | undefined): string {
  const level = rpeLevel(value)
  return level === undefined ? RPE_UNSET : `${level.name}. ${level.detail}`
}
