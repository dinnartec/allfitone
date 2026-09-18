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
export const PHOTO_UNUSABLE = 'No pudimos usar esa foto. Prueba con otra.'
export const PHOTO_UNREACHABLE = 'No pudimos abrir tus fotos. Vuelve a intentarlo.'
export const PHOTO_NO_PICKER = 'Esta versión de la app todavía no puede abrir tus fotos.'

/**
 * Why a photograph did not become a cover.
 *
 * Two cases of its own. The server refuses an image it cannot decode, and telling
 * somebody to check their connection over a corrupt file sends them looking for a
 * problem that is not there.
 *
 * And **anything that is not an `ApiError` never reached the network at all**: every
 * request failure arrives wrapped as one, so what is left is the phone — the picker
 * refusing to open, or a build without it in. That used to read «revisa tu conexión»,
 * which is the one thing it is certainly not.
 */
export function coverFailure(cause: unknown): string {
  // Named rather than sniffed from a message: an older build without the picker is a
  // different problem from a picker that opened and failed, and only one of the two is
  // fixed by installing the app again.
  if (cause instanceof Error && cause.name === 'PickerUnavailable') return PHOTO_NO_PICKER
  if (!(cause instanceof ApiError)) return PHOTO_UNREACHABLE
  if (cause.failure === 'validation-failed') return PHOTO_UNUSABLE
  return saveFailure(cause)
}

export function saveFailure(cause: unknown): string {
  if (!(cause instanceof ApiError)) return SAVE_OFFLINE
  if (cause.failure === 'unauthenticated') return SESSION_EXPIRED
  if (cause.failure === 'conflict') return SAVE_STALE
  if (cause.failure === 'not-found') return SAVE_GONE
  if (cause.failure === 'invalid-request') return SAVE_REFUSED
  if (cause.failure === 'validation-failed') return SAVE_REFUSED
  return SAVE_OFFLINE
}
