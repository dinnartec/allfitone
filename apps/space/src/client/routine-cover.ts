/**
 * How a routine says it wants to be seen.
 *
 * A routine had a name and nothing else, and the list drew the first letter of it. The
 * cover is the answer to «which one is this» before anybody reads: the muscles it works,
 * one of twelve icons, or a photograph the person took.
 *
 * **Nothing is the third answer and it is a real one.** No cover is not an unfinished
 * routine, so the absence is the `undefined` this module returns and the key the draft
 * simply does not carry. Sending `cover: null` would say the same thing to the server,
 * and omitting it says it without changing the hash of every routine written before the
 * key existed.
 *
 * **The muscle cover stores only the decision.** What it draws comes from the exercises
 * the routine already holds, so it is computed here rather than saved — a copy of the
 * muscles would be a second truth that ages the moment somebody swaps an exercise.
 */

import type { AllfitV1Schemas } from '@allfitone/contracts'
import type { IconName } from '@allfitone/react-native/icons'

import type { Movement } from './content'

export type RoutineCover = AllfitV1Schemas['RoutineCover']
export type CoverKind = RoutineCover['kind']
export type CoverIcon = AllfitV1Schemas['RoutineCoverIcon']['icon']

/** Drawn from the exercises, so there is one of these and it carries nothing. */
export const MUSCLE_COVER: RoutineCover = { kind: 'muscles' }

export function iconCover(icon: CoverIcon): RoutineCover {
  return { kind: 'icon', icon }
}

/** Como la de músculos: la pide la persona y la elige el contenido. */
export const PHOTO_COVER: RoutineCover = { kind: 'photo' }

/** Which icon a cover names, and nothing for any other kind. */
export function coverIcon(cover: RoutineCover | undefined): CoverIcon | undefined {
  return cover?.kind === 'icon' ? cover.icon : undefined
}

/**
 * The covers, in the order the grid draws them.
 *
 * **They say what the routine is about, not what it is done with.** Equipment was the
 * wrong reading of the same drawing: a barbell in this grid stands for «fuerza», and a
 * routine of bodyweight push-ups is entitled to it.
 *
 * The glyph is named separately from the token because the two belong to different
 * owners. The database owns the twelve words; the Design System owns what each one looks
 * like, and four of them reuse glyphs that were already there.
 */
export const COVER_ICONS: readonly {
  readonly icon: CoverIcon
  readonly name: string
  readonly glyph: IconName
}[] = [
  { icon: 'strength', name: 'Fuerza', glyph: 'training' },
  { icon: 'run', name: 'Correr', glyph: 'run' },
  { icon: 'cycling', name: 'Bici', glyph: 'cycling' },
  { icon: 'interval', name: 'Intervalos', glyph: 'interval' },
  { icon: 'cardio', name: 'Cardio', glyph: 'cardio' },
  { icon: 'burn', name: 'Quemar', glyph: 'burn' },
  { icon: 'power', name: 'Explosivo', glyph: 'freestyle' },
  { icon: 'challenge', name: 'Reto', glyph: 'level' },
  { icon: 'mountain', name: 'Montaña', glyph: 'mountain' },
  { icon: 'time', name: 'Tiempo', glyph: 'time' },
  { icon: 'mobility', name: 'Movilidad', glyph: 'mobility' },
  { icon: 'swim', name: 'Nadar', glyph: 'swim' },
  { icon: 'arms', name: 'Brazos', glyph: 'arms' },
  { icon: 'weights', name: 'Peso', glyph: 'weight' },
  { icon: 'technique', name: 'Técnica', glyph: 'target' },
  { icon: 'endurance', name: 'Resistencia', glyph: 'endurance' },
  { icon: 'pace', name: 'Ritmo', glyph: 'pace' },
  { icon: 'energy', name: 'Energía', glyph: 'energy' },
  { icon: 'focus', name: 'Concentración', glyph: 'focus' },
  { icon: 'recovery', name: 'Recuperación', glyph: 'recovery' },
  { icon: 'morning', name: 'Mañana', glyph: 'morning' },
  { icon: 'evening', name: 'Tarde', glyph: 'evening' },
  { icon: 'night', name: 'Noche', glyph: 'rest' },
  { icon: 'cold', name: 'Frío', glyph: 'cold' },
  { icon: 'outdoor', name: 'Aire libre', glyph: 'outdoor' },
  { icon: 'route', name: 'Ruta', glyph: 'route' },
  { icon: 'pool', name: 'Piscina', glyph: 'pool' },
  { icon: 'team', name: 'Equipo', glyph: 'team' },
  { icon: 'record', name: 'Récord', glyph: 'record' },
  { icon: 'favourite', name: 'Favorita', glyph: 'favourite' },
  { icon: 'light', name: 'Suave', glyph: 'light' },
  { icon: 'countdown', name: 'Cuenta atrás', glyph: 'countdown' },
]

/** What the Design System should draw for a token, and nothing for a name it lost. */
export function glyphFor(icon: CoverIcon): IconName | undefined {
  return COVER_ICONS.find((one) => one.icon === icon)?.glyph
}

/**
 * Whether two covers are the same choice, which is what a selected tile asks.
 *
 * Both absent is the same choice too: it is what «sin portada» being on looks like.
 */
export function sameCover(one: RoutineCover | undefined, other: RoutineCover | undefined): boolean {
  if (one === undefined || other === undefined) return one === other
  if (one.kind !== other.kind) return false
  return coverIcon(one) === coverIcon(other)
}

/**
 * The muscle codes a routine works, for the figure a muscle cover draws.
 *
 * **Everything it touches is lit, with no shading of what it merely uses.** The list
 * draws this at 56 points, where the difference between trained and used is a shade
 * nobody can see, and the catalogue's list projection drops the primary flag anyway.
 *
 * First appearance decides the order and repeats are dropped. Order does not reach the
 * figure — it filters by membership — but a stable answer is a testable one.
 */
export function musclesWorked(
  movementIds: readonly string[],
  movements: readonly Movement[],
): readonly string[] {
  const byId = new Map(movements.map((movement) => [movement.id, movement]))
  const worked: string[] = []
  for (const id of movementIds) {
    for (const code of byId.get(id)?.muscles ?? []) {
      if (!worked.includes(code)) worked.push(code)
    }
  }
  return worked
}

/**
 * La portada que el servidor manda, si esta versión de la app sabe dibujarla.
 *
 * Compatibilidad hacia adelante y no paranoia: el vocabulario de iconos vive en la base
 * y se amplía por el final, así que una app vieja puede recibir un nombre que no conoce.
 * Cuando pasa, la rutina se dibuja con su letra —que es un estado legítimo— en vez de
 * quedarse con un azulejo vacío o romperse.
 */
export function coverOrNothing(cover: RoutineCover | null | undefined): RoutineCover | undefined {
  if (cover === null || cover === undefined) return undefined
  if (cover.kind === 'muscles') return MUSCLE_COVER
  if (cover.kind === 'photo') return PHOTO_COVER
  return glyphFor(cover.icon) === undefined ? undefined : iconCover(cover.icon)
}

/**
 * Si una portada tiene algo que dibujar, preguntado **antes** de construir el elemento.
 *
 * Es la trampa que `routine-cover-art` documenta y en la que se cayó igualmente: un
 * componente que no pinta nada sigue siendo un objeto elemento, así que un `art ?? letra`
 * nunca elegía la letra. En la pantalla de portada eso dejaba la pestaña «Foto» con un
 * cuadrado vacío, que se lee como un control que no hizo nada.
 */
export function drawsSomething(
  cover: RoutineCover | undefined,
  coverUrl: string | number | null | undefined,
): boolean {
  if (cover === undefined) return false
  if (cover.kind === 'photo') return Boolean(coverUrl)
  if (cover.kind === 'icon') return glyphFor(cover.icon) !== undefined
  return true
}
