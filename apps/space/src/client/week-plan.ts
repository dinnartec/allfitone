/**
 * What the training tab decides on its own.
 *
 * The week is the unit and the day inside it is a suggestion, so the screen's job
 * is not to say what today is: it is to say **which routine to reach for next**,
 * and to make every other one just as reachable.
 *
 * **Suggested is today's, or the next day's that is still pending.** The same rule
 * Hoy opens its carousel on, so the two screens never point at different days. A
 * session left behind earlier in the week keeps its place but is not suggested
 * again. It orients; it never decides.
 *
 * **Done marks, it does not bar.** A routine already closed keeps its place and
 * offers to be done again: repeating is legitimate, the repeat is another attempt,
 * and the first one keeps what it earned. A screen that hid it would be telling
 * somebody they cannot do what they are about to do anyway.
 */

import type { PreviewFigure } from './home-preview'
import type { WeekPlan, WeekRoutine } from './programs'

export type { WeekPlan, WeekRoutine }

export type RoutineState = 'suggested' | 'pending' | 'done' | 'open'

export interface RoutineCard {
  readonly routine: WeekRoutine
  readonly state: RoutineState
}

/**
 * The week's routines, each with the one thing the screen renders differently.
 *
 * An open attempt outranks everything: coming back to something left half-done is
 * more urgent than starting the next thing, and offering the next thing would
 * strand it.
 */
export function cardsFor(plan: WeekPlan | undefined, today: number): readonly RoutineCard[] {
  if (!plan) return []
  const open = plan.sessions.find((session) => session.open_execution_id !== null)
  const pending = plan.sessions.filter((session) => !session.done)
  const suggested = pending[nearestFrom(pending, today)]

  return plan.sessions.map((routine) => ({
    routine,
    state:
      routine.open_execution_id !== null
        ? 'open'
        : open
          ? routine.done
            ? 'done'
            : 'pending'
          : routine === suggested
            ? 'suggested'
            : routine.done
              ? 'done'
              : 'pending',
  }))
}

export type WeekPlanFailure = 'expired' | 'unassigned' | 'failed'

/**
 * What a failed week read means to the tab.
 *
 * `unassigned` is not an error: somebody who follows no programme gets the catalogue,
 * **drawn in the tab**. It used to be answered by navigating there, and from inside a
 * tab that meant replacing the tab navigator's own entry on the root stack — the dock
 * disappeared and going back reported that no navigator would handle it.
 */
export function weekPlanFailure(failure: string | undefined): WeekPlanFailure {
  if (failure === 'unauthenticated') return 'expired'
  if (failure === 'not-found') return 'unassigned'
  return 'failed'
}

/** De lunes a domingo, como los cuenta el programa: 1 es lunes y 7 domingo. */
const DAY_NAMES = ['', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO', 'DOMINGO']

/**
 * Qué día es hoy en el mismo sistema que usa el programa.
 *
 * `Date.getDay()` cuenta desde el domingo y el programa desde el lunes, y esa diferencia
 * de un día es la que pondría «HOY» en la tarjeta equivocada.
 */
export function programDayOf(date: Date): number {
  const sundayFirst = date.getDay()
  return sundayFirst === 0 ? 7 : sundayFirst
}

/**
 * El rótulo del chip de una tarjeta: su día, o «HOY» cuando toca hoy.
 *
 * El día y no la fecha: el carrusel enseña la semana entera y lo que distingue una
 * tarjeta de otra es el día que el programa le puso, no cuándo cae en el calendario.
 */
export function dayChip(programDay: number, today: number): string {
  if (programDay === today) return 'HOY'
  return DAY_NAMES[programDay] ?? ''
}

/**
 * La tarjeta en la que abre el carrusel: la de hoy, o la del próximo día que pida algo.
 *
 * **Se desplaza, no se reordena.** La semana sigue en el orden del programa, porque es
 * la forma de la semana; lo que cambia es dónde se para al abrir. Pasada la última
 * sesión, la siguiente es la primera de la semana que viene.
 */
export function firstCardShown(cards: readonly RoutineCard[], today: number): number {
  return nearestFrom(
    cards.map((card) => card.routine),
    today,
  )
}

/** Which session comes first counting from today, wrapping past Sunday; ties keep order. */
function nearestFrom(sessions: readonly WeekRoutine[], today: number): number {
  let best = 0
  let nearest = Number.POSITIVE_INFINITY
  sessions.forEach((session, index) => {
    const ahead = (session.program_day - today + 7) % 7
    if (ahead < nearest) {
      nearest = ahead
      best = index
    }
  })
  return best
}

export interface WeekDay {
  readonly day: number
  /** El programa pide algo ese día. */
  readonly planned: boolean
  readonly done: boolean
  readonly today: boolean
}

/**
 * La semana como siete días y no como tres barras.
 *
 * **Siete tramos, uno por día**, que es lo que el diseño dibuja y lo que deja ver la
 * forma de la semana: dónde están los días de entrenar y dónde los libres. Una barra por
 * sesión decía cuántas van de cuántas —eso ya lo dice la marcha de al lado— pero no
 * cuándo.
 */
export function weekDays(cards: readonly RoutineCard[], today: number): readonly WeekDay[] {
  return [1, 2, 3, 4, 5, 6, 7].map((day) => {
    const planned = cards.filter((card) => card.routine.program_day === day)
    return {
      day,
      planned: planned.length > 0,
      done: planned.length > 0 && planned.every((card) => card.routine.done),
      today: day === today,
    }
  })
}

/**
 * Qué dice el botón de empezar, que no siempre empieza.
 *
 * Un intento abierto se continúa y una sesión cerrada se repite: prometer «empezar» sobre
 * algo a medias es lo que hace que alguien pierda lo que llevaba.
 */
export function startLabel(state: RoutineState): string {
  if (state === 'open') return 'Continuar'
  return state === 'done' ? 'Repetir' : 'Empezar'
}

/** Cómo fue la última vez que se hizo esta rutina, tal y como la responde la agenda. */
export type RoutineLastTime = NonNullable<WeekRoutine['last_time']>

export interface LastTimeShown {
  /** «LA ÚLTIMA VEZ, HACE 6 DÍAS», que es el rótulo sobre las cifras. */
  readonly when: string
  readonly figures: readonly PreviewFigure[]
}

/** Cuántos días de calendario separan dos fechas, sin que la hora del día opine. */
function daysBetween(trainedOn: string, today: Date): number {
  const [year, month, day] = trainedOn.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) return 0
  const then = Date.UTC(year, month - 1, day)
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((now - then) / 86_400_000)
}

/**
 * Lo que el reverso de la tarjeta escribe de la última vez.
 *
 * **Se omite lo que no se respondió, y nunca se dibuja como cero.** Una rutina que no es
 * de fuerza no tiene tonelaje y una ejecución que nadie cerró no tiene duración; poner un
 * cero ahí afirmaría un entrenamiento sin trabajo, que es justo lo que no ocurrió.
 *
 * El tonelaje baja a kilos por debajo de la tonelada: «0,5 TONELADAS» es una cifra que
 * hay que traducir mentalmente para saber si fue mucho o poco.
 */
/** El rótulo del bloque, que está siempre aunque no haya nada debajo. */
export const LAST_TIME_LABEL = 'LA ÚLTIMA VEZ'

/**
 * Lo que va donde irían las cifras cuando nunca se entrenó.
 *
 * El bloque no desaparece: un hueco que a veces está y a veces no hace que la tarjeta
 * cambie de forma según la rutina, y quien la gira no sabe si le falta algo o si es que
 * no hay nada. Decirlo ocupa el mismo sitio y contesta la pregunta.
 */
export const LAST_TIME_NONE = 'Sin sesiones registradas'

export function lastTimeShown(
  last: RoutineLastTime | null | undefined,
  today: Date,
): LastTimeShown | undefined {
  if (!last) return undefined

  const days = daysBetween(last.trained_on, today)
  // Sin «HOY»: si fue hoy, no es «la última vez, hoy» — es hoy, y el rótulo solo ya lo
  // dice. Ayer y los días que hayan pasado sí añaden algo que el rótulo no tiene.
  const when =
    days <= 0
      ? LAST_TIME_LABEL
      : days === 1
        ? `${LAST_TIME_LABEL}, AYER`
        : `${LAST_TIME_LABEL}, HACE ${days} DÍAS`

  const figures: PreviewFigure[] = []

  if (last.tonnage_kg !== null && last.tonnage_kg > 0) {
    figures.push(
      last.tonnage_kg >= 1000
        ? { value: (last.tonnage_kg / 1000).toFixed(1).replace('.', ','), unit: 'TONELADAS' }
        : { value: String(Math.round(last.tonnage_kg)), unit: 'KILOS' },
    )
  }

  if (last.seconds !== null && last.seconds > 0) {
    // Un minuto es el suelo: una sesión de cuarenta segundos duró algo, y «0 MINUTOS»
    // dice que no duró nada.
    const minutes = Math.max(1, Math.round(last.seconds / 60))
    figures.push({ value: String(minutes), unit: minutes === 1 ? 'MINUTO' : 'MINUTOS' })
  }

  if (last.sets > 0) {
    figures.push({ value: String(last.sets), unit: last.sets === 1 ? 'SERIE' : 'SERIES' })
  }

  return { when, figures }
}
