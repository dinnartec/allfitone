/**
 * Lo que la biblioteca de Entrenar dice de cada cosa, sin dibujarla.
 *
 * Todo aquí es una frase o un filtro: la pantalla decide dónde va y con qué tipografía,
 * y estas funciones deciden qué dice. Separado porque cada caso raro —una rutina en dos
 * programas, una sin ninguno, un programa de Allfit que no se puede editar— es una línea
 * de texto que hay que poder afirmar en una prueba en vez de juzgarla en una captura.
 */

import type { MyProgram } from './programs'
import type { MyRoutine } from './content'

/** Las tres solapas de la biblioteca de rutinas. */
export type RoutineFilter = 'todas' | 'en-programa' | 'sueltas'

/** Indexado por `program_day`: 1 es lunes, 7 domingo, y el 0 no existe. */
const DAYS = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const

/**
 * El día que el programa le puso a una sesión, en tres letras.
 *
 * **Del programa y no del calendario.** La materialización adelanta las sesiones de la
 * primera semana que caerían antes del día de la asignación, así que una sesión de lunes
 * tomada un jueves está agendada el jueves; leer el día de su fecha diría «Jue» de la
 * sesión que la persona puso en lunes. `program_day` es la ranura, que es lo que la
 * pantalla nombra.
 */
export function dayName(programDay: number): string {
  return DAYS[programDay] ?? ''
}

/**
 * Qué es un programa, en una línea.
 *
 * `editable` es lo que distingue el propio del tomado de Allfit: uno bifurcado nunca
 * recibió borrador, así que no se puede abrir, y decir «Tuyo» de algo que no se puede
 * editar sería mentir sobre lo que se puede hacer con él.
 */
export function programCaption(program: MyProgram, week?: number): string {
  const origin = program.editable ? 'Tuyo' : 'De Allfit'
  const parts = [
    origin,
    program.weeks === null ? 'sin fecha de fin' : `${String(program.weeks)} semanas`,
    `${String(program.days_per_week)} días`,
  ]
  // Sin fin se dice en qué semana vas y se calla el «de»: un programa que no termina no
  // tiene una semana final contra la que medirse, y «semana 3 de null» es lo que salía.
  if (week !== undefined) {
    parts.push(
      program.weeks === null
        ? `semana ${String(week)}`
        : `semana ${String(week)} de ${String(program.weeks)}`,
    )
  }
  return parts.join(' · ')
}

/**
 * Dónde se usa una rutina.
 *
 * Dos programas se dicen con «y» y no con coma, porque son dos y no una lista. Con tres
 * o más la coma vuelve, que es como se enumera en castellano.
 *
 * **Sin programa no es un error.** Una rutina suelta es una rutina que existe para
 * entrenarla cuando toque, y callarlo dejaría la fila con un hueco donde las demás
 * tienen una frase.
 */
export function whereUsed(routine: MyRoutine): { text: string; loose: boolean } {
  const titles = routine.programs.map((program) => program.title)
  if (titles.length === 0) return { text: 'Sin programa', loose: true }
  if (titles.length === 1) return { text: `En ${titles[0] ?? ''}`, loose: false }
  const last = titles[titles.length - 1] ?? ''
  return { text: `En ${titles.slice(0, -1).join(', ')} y ${last}`, loose: false }
}

/**
 * Las cifras de una rutina, que es lo que dice cuánto pesa sin abrirla.
 *
 * **Cero series no se dice.** Una sesión de carrera no tiene ninguna, y «· 0 series»
 * sería ruido que además parece un error. Toma la forma mínima porque la semana y la
 * biblioteca cuentan lo mismo con dos tipos distintos.
 */
export function routineFigures(routine: {
  readonly exercise_count: number
  readonly set_count: number
}): string {
  const exercises =
    routine.exercise_count === 1 ? '1 ejercicio' : `${String(routine.exercise_count)} ejercicios`
  if (routine.set_count === 0) return exercises
  const sets = routine.set_count === 1 ? '1 serie' : `${String(routine.set_count)} series`
  return `${exercises} · ${sets}`
}

/** La solapa elegida, aplicada. `todas` no filtra: es la lista entera y no una vista. */
export function filteredRoutines(
  routines: readonly MyRoutine[],
  filter: RoutineFilter,
): readonly MyRoutine[] {
  if (filter === 'todas') return routines
  const wanted = filter === 'en-programa'
  return routines.filter((routine) => routine.programs.length > 0 === wanted)
}

/**
 * Cuántas hay detrás de cada solapa, para que el número esté antes de tocarla.
 *
 * Se cuentan siempre sobre la lista entera y nunca sobre la ya filtrada, o cada solapa
 * diría el total de la que está abierta.
 */
export function routineCounts(routines: readonly MyRoutine[]): Record<RoutineFilter, number> {
  const inProgram = routines.filter((routine) => routine.programs.length > 0).length
  return { todas: routines.length, 'en-programa': inProgram, sueltas: routines.length - inProgram }
}

/**
 * Qué decir cuando no hay nada que listar.
 *
 * Corto y llano. «Ninguna rutina en esta solapa» describía la pantalla —quien lo lee ya
 * ve que está vacía— y además sonaba a que algo había fallado. Lo que hace falta es
 * nombrar lo que falta, que en las tres solapas es lo mismo con un matiz distinto.
 */
export function emptyReason(filter: RoutineFilter): string {
  if (filter === 'en-programa') return 'No hay rutinas en programas aún'
  if (filter === 'sueltas') return 'No hay rutinas sueltas'
  return 'No hay rutinas aún'
}

/**
 * Qué pasa si descartas una rutina, dicho antes de que pase.
 *
 * Descartar una que está en un programa **lo republica sin ella** y muda la asignación
 * sola, así que quien la estuviera entrenando sigue con el programa y una sesión menos.
 * Eso hay que decirlo: es un cambio en algo que la persona no tiene delante.
 *
 * Lo que el cliente no puede saber es si dejaría algún programa vacío — eso depende de
 * lo que haya en cada uno —, así que esa la responde el servidor y la pantalla la
 * traduce. Ver `discardFailure`.
 */
export function discardWarning(routine: MyRoutine): string {
  if (routine.programs.length === 0) return 'Se va de tu biblioteca. Lo ya entrenado se conserva.'
  if (routine.programs.length === 1) {
    return `Se va de tu biblioteca y de ${routine.programs[0]?.title ?? ''}, que se republica sin ella.`
  }
  return `Se va de tu biblioteca y de ${String(routine.programs.length)} programas, que se republican sin ella.`
}

/**
 * Qué rutinas se lleva un programa al eliminarse, y cuáles se quedan.
 *
 * **Sólo las que ningún otro programa usa.** Llevarse una compartida rompería el otro
 * programa, y `OP-PLN-028` ya se niega a dejar uno sin una sola sesión: sería pedirle al
 * dominio justo lo que prohíbe. El cliente puede responderlo solo porque cada rutina ya
 * viene diciendo en qué programas está.
 */
export function routinesLostWith(
  program: MyProgram,
  routines: readonly MyRoutine[],
): { going: readonly MyRoutine[]; staying: readonly MyRoutine[] } {
  const inside = routines.filter((routine) =>
    routine.programs.some((one) => one.program_id === program.program_id),
  )
  return {
    going: inside.filter((routine) => routine.programs.length === 1),
    staying: inside.filter((routine) => routine.programs.length > 1),
  }
}

/**
 * Qué se pierde al eliminar un programa, dicho antes de perderlo.
 *
 * **Lo entrenado se conserva, y se dice siempre.** «Eliminar» es la palabra que la gente
 * espera, pero lo que ocurre es que el programa sale de la biblioteca y de la agenda: las
 * sesiones que ya hizo alguien son su historia y no se tocan. Prometer menos de lo que se
 * cumple asusta; prometer más miente.
 */
export function removalWarning(program: MyProgram, routines: readonly MyRoutine[]): string {
  const { going, staying } = routinesLostWith(program, routines)
  const kept = 'Lo que ya entrenaste se conserva.'
  const leaves = 'Se va de tu biblioteca y de tu agenda.'

  if (going.length === 0 && staying.length === 0) return `${leaves} ${kept}`

  const alsoGoing =
    going.length === 0
      ? ''
      : going.length === 1
        ? `Se elimina también «${going[0]?.title ?? ''}».`
        : `Se eliminan también sus ${String(going.length)} rutinas.`

  // Nombrar la que se queda, y por qué. Callarlo dejaría a alguien contando rutinas
  // después de borrar, que es cuando ya no se puede preguntar.
  const alsoStaying =
    staying.length === 0
      ? ''
      : staying.length === 1
        ? `«${staying[0]?.title ?? ''}» se queda, porque está en otro programa.`
        : `${String(staying.length)} se quedan, porque están en otros programas.`

  return [leaves, alsoGoing, alsoStaying, kept].filter((part) => part !== '').join(' ')
}

/**
 * La rutina que una semana puso en un día.
 *
 * **Por plantilla y no por versión.** La semana guarda la versión exacta que compuso, y
 * republicar la rutina acuña otra: buscar la que tenga esa versión *como última* la
 * perdía en cuanto alguien la editaba, y el día se veía vacío en un programa donde la
 * rutina está puesta. Se mira si la versión guardada es **alguna** de las suyas.
 *
 * Nada se reescribe: el programa sigue componiendo la versión que eligió, que es lo que
 * `ADR-009` congela.
 */
export function routineOfVersion(
  routines: readonly MyRoutine[],
  versionId: string | null,
): MyRoutine | undefined {
  if (versionId === null) return undefined
  return routines.find((routine) => routine.versions.includes(versionId))
}

/** Si el día tiene una versión que ya no es la última de su rutina. */
export function showsOlderVersion(routine: MyRoutine, versionId: string): boolean {
  return routine.template_version_id !== null && routine.template_version_id !== versionId
}
