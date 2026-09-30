/**
 * What the rest bar says while it counts: what comes next, and in between, a nudge.
 *
 * **Next first and last, a phrase in the middle.** The opening seconds say what comes
 * next, because that is the question right after a set; the last ten say it again,
 * because that is when somebody gets up. The middle is the long stretch with nothing to
 * decide, and that is where a line with some personality earns its place.
 *
 * **One phrase per rest.** It is chosen from when the rest started, which a nudge of
 * ±15 does not move, so the line never changes under somebody's eyes mid-rest.
 *
 * The phrases talk about the moment — breathing, water, the next set — and never about
 * the body's health: this is a training log, not advice.
 */

import { remaining, type Rest } from './rest-timer'

export const REST_LINES: readonly string[] = [
  'Respira hondo. Lo estás haciendo bien.',
  'Suelta los hombros, afloja la mandíbula.',
  'Un sorbo de agua no sobra.',
  'La constancia gana a la intensidad.',
  'Cada serie cuenta. Esta también.',
  'Recupera, que la siguiente es tuya.',
  'Visualiza la próxima serie, limpia.',
  'Tu yo de mañana te lo agradece.',
  'Fuerte no es rápido: es constante.',
  'Un buen descanso también es entrenar.',
  'Inhala en cuatro, exhala en seis.',
  'Ya hiciste lo difícil: empezar.',
  'Piensa en la técnica, no en el peso.',
  'Una serie más cerca de tu meta.',
  'Sacude las manos y suelta tensión.',
  'El progreso se construye así.',
  'Tranquilo: el reloj trabaja por ti.',
  'Postura lista para la que viene.',
  'Hoy sumas, aunque no lo notes.',
  'Lo que repites es lo que te cambia.',
  'Respira por la nariz, sin prisa.',
  'Enfócate: solo existe la siguiente.',
  'Buen ritmo. Mantenlo.',
  'Esta pausa también cuenta.',
  'Calidad primero, cantidad después.',
  'Ajusta el agarre y prepárate.',
  'Nadie te ve, pero tú sí.',
  'Un día a la vez, una serie a la vez.',
  'Otra serie y lo tienes.',
  'La disciplina llega cuando no hay ganas.',
  'Recarga. Lo mejor está por venir.',
  'Controla la bajada en la siguiente.',
  'Pequeño paso, gran costumbre.',
  'Cuerpo quieto, mente lista.',
  'Lo estás logrando, serie a serie.',
  'Mira cuánto llevas hoy.',
  'Una respiración larga y a darle.',
  'El esfuerzo de hoy es la base de mañana.',
  'Afloja el cuello, relaja la cara.',
  'Aquí no se trata de ganar: de volver.',
  'Siente el músculo que acabas de usar.',
  'Lento y bien vale más que rápido.',
  'Lo difícil ya lo hiciste una vez.',
  'Tu única competencia eres tú.',
  'Un trago de agua y a lo tuyo.',
  'Mente en la serie, no en el móvil.',
  'Hoy también es un buen día para sumar.',
  'Recupera el aire, conserva las ganas.',
  'Cada repetición es un voto por ti.',
  'Casi. La siguiente, con todo.',
]

/** How long the bar says what comes next before the phrase takes over. */
const OPENING_SECONDS = 3
/** From here to the end it says what comes next again: time to get up. */
const CLOSING_SECONDS = 10
/** Shorter than this, there is no middle worth filling. */
const SHORTEST_FOR_A_PHRASE = 20

export type RestLine =
  | { readonly kind: 'next'; readonly text: string }
  | { readonly kind: 'phrase'; readonly text: string }

export function restLine(rest: Rest, now: number, next: string): RestLine {
  const started = rest.endsAt - rest.total * 1000
  const phrase = REST_LINES[Math.floor(started / 1000) % REST_LINES.length] ?? ''
  if (!next) return { kind: 'phrase', text: phrase }

  const left = remaining(rest, now)
  const elapsed = rest.total - left
  const middle =
    rest.total >= SHORTEST_FOR_A_PHRASE && elapsed >= OPENING_SECONDS && left > CLOSING_SECONDS
  return middle ? { kind: 'phrase', text: phrase } : { kind: 'next', text: next }
}
