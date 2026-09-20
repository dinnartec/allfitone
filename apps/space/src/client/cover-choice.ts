/**
 * La máquina de estados de la hoja de portada, fuera de la hoja.
 *
 * **Está aquí porque se rompió dentro.** La hoja abría la pestaña «Músculos» con la
 * previa sin portada, así que el control decía una cosa y la tarjeta enseñaba otra —la
 * letra— hasta que alguien pulsaba la pestaña que ya estaba pulsada. Y la pestaña
 * «Foto» dejaba la tarjeta vacía cuando la fotografía no había llegado. Las dos son
 * fallos de transición, no de pintura, y una transición se prueba sin dibujar nada.
 *
 * La regla de la que cuelga todo: **la pestaña y la previa dicen siempre lo mismo.** Si
 * pueden discrepar, la previa deja de ser una previa.
 */

import { COVER_ICONS, coverIcon, iconCover, MUSCLE_COVER, PHOTO_COVER } from './routine-cover'
import type { CoverKind, RoutineCover } from './routine-cover'

/** El de la rejilla que está a la vista, para cuando nunca se eligió ninguno. */
const FIRST_ICON = COVER_ICONS[0]?.icon ?? 'strength'

/**
 * Qué portada enseña una pestaña.
 *
 * `held` es la que el programa lleva puesta, y sólo se usa para recuperar **cuál** icono
 * era: volver a «Icono» después de pasar por «Foto» tiene que devolver el que había, no
 * el primero de la fila.
 */
export function coverForTab(tab: CoverKind, held: RoutineCover | undefined): RoutineCover {
  if (tab === 'muscles') return MUSCLE_COVER
  if (tab === 'photo') return PHOTO_COVER
  return iconCover(coverIcon(held) ?? FIRST_ICON)
}

/**
 * Con qué pestaña abre la hoja: la clase que el programa ya lleva, o músculos.
 *
 * Músculos y no iconos cuando no hay nada: es la única que se dibuja sola y sin elegir
 * nada más, así que es la que enseña algo cierto en el primer fotograma.
 */
export function openingTab(held: RoutineCover | undefined): CoverKind {
  return held?.kind ?? 'muscles'
}

/**
 * Y qué enseña en ese primer fotograma.
 *
 * **Nunca `undefined`.** Una hoja que abre con la pestaña «Músculos» marcada y la tarjeta
 * dibujando la letra está enseñando dos respuestas a la vez, y la primera impresión es
 * que el control no hace nada. Que la previa proponga no es mentir: aplicarla sigue
 * costando pulsar el botón de abajo.
 */
export function openingCover(held: RoutineCover | undefined): RoutineCover {
  return held ?? coverForTab(openingTab(held), held)
}
