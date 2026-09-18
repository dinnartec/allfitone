/**
 * Why a save did not land, said in a way somebody can act on.
 *
 * Every failure used to read «revisa tu conexión», which is true of exactly one of
 * them. A stale draft is not a connection problem — something else saved first and the
 * screen is holding a version of the truth that no longer exists — and no amount of
 * checking the wifi fixes it. Saying so is the difference between a message somebody
 * can act on and one they learn to ignore.
 *
 * A malformed request is a defect of ours and says so plainly. Somebody staring at
 * «revisa tu conexión» on a perfectly good connection is being told to go and look for
 * a problem that is not theirs.
 */

import { ApiError } from './api-error'

export const SESSION_EXPIRED = 'Tu sesión venció. Vuelve a entrar para continuar.'
export const SAVE_OFFLINE = 'No pudimos guardar. Revisa tu conexión.'
export const SAVE_STALE = 'Se guardó desde otro sitio. Ciérralo y vuelve a abrirlo.'
export const SAVE_REFUSED = 'El servidor rechazó el guardado. Es un fallo nuestro, no tuyo.'
export const SAVE_GONE = 'Esto ya no existe. Puede que se haya descartado desde otro sitio.'

export function saveFailure(cause: unknown): string {
  if (!(cause instanceof ApiError)) return SAVE_OFFLINE
  if (cause.failure === 'unauthenticated') return SESSION_EXPIRED
  if (cause.failure === 'conflict') return SAVE_STALE
  if (cause.failure === 'not-found') return SAVE_GONE
  if (cause.failure === 'invalid-request') return SAVE_REFUSED
  return SAVE_OFFLINE
}
