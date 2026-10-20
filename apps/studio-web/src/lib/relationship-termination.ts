/**
 * The rules for ending a client's relationship with the gym.
 *
 * This is the heaviest thing Studio can do to a relationship, and the three
 * sentences worth getting right are not about the mechanics — they are about
 * what a reader will otherwise assume wrongly.
 *
 * **It is immediate.** No notice period, nothing scheduled. Somebody who
 * expects "from the end of the month" would cut access today.
 *
 * **The gym keeps what it was already shown.** Ending is not deleting. The
 * history up to that instant stays, and nothing created after it is ever
 * visible — and reading that frozen history is not an ordinary read: it needs a
 * justified case, not a role. Both halves matter, and a screen that says only
 * one of them misleads in a different direction each time.
 *
 * **Nobody is told yet.** The command records the notice inside its own
 * transaction, but no template exists to render it (`STUDIO-151`), so no email
 * leaves. A screen promising otherwise would be making a promise the product
 * does not keep.
 */

import type { RelationshipState } from './studio-api'

/**
 * Only somebody who may assign professionals, which is the administrator and
 * the owner and nobody else. `OP-REL-008` refuses a coach outright — even for a
 * client they attend — so offering it to them spends a click to reach a
 * refusal.
 *
 * And only while the relationship is live: ending one that is already over has
 * nothing to end.
 */
export function canTerminateRelationship({
  mayAssignProfessionals,
  relationshipActive,
}: {
  mayAssignProfessionals: boolean
  relationshipActive: boolean
}): boolean {
  return mayAssignProfessionals && relationshipActive
}

/**
 * What stops, counted from what the relationship holds right now.
 *
 * Read before the command rather than from its answer, because the dialog has
 * to say it *before* somebody decides. The command's own counts are the truth
 * afterwards; these are what the question is asked with.
 */
export function whatTerminationStops(relationship: RelationshipState): {
  grants: number
  professionals: number
} {
  const grants = relationship.grants.filter((entry) => entry.status === 'active').length
  const covers = relationship.substitutions.filter((entry) => entry.status === 'active').length
  return { grants, professionals: (relationship.holder ? 1 : 0) + covers }
}

/**
 * The same counts as one sentence, so the dialog asks its question in two lines
 * instead of four.
 *
 * Null when there is nothing to count: a relationship with no live permits and
 * nobody attending it stops nothing, and printing a zero would be answering a
 * question the reader did not ask.
 */
export function whatTerminationStopsSentence(relationship: RelationshipState): string | null {
  const { grants, professionals } = whatTerminationStops(relationship)
  const permits =
    grants === 0 ? null : grants === 1 ? 'se corta 1 permiso' : `se cortan ${grants} permisos`
  const people =
    professionals === 0
      ? null
      : professionals === 1
        ? '1 profesional deja de atenderla'
        : `${professionals} profesionales dejan de atenderla`
  const said = [permits, people].filter((part) => part !== null)
  if (said.length === 0) return null
  const sentence = said.join(' y ')
  return `${sentence[0]?.toUpperCase()}${sentence.slice(1)}.`
}

export type TerminationRefusal = 'already-ended' | 'not-allowed' | 'gone' | 'unavailable'

/**
 * `409` here is a relationship that is no longer live — somebody else ended it,
 * or it ended while this screen was open. It is a state the reader can see by
 * refreshing, so it offers no retry; only the temporary failure does, and it
 * says why retrying is safe.
 */
export function terminationRefusalFor(status: number | undefined): TerminationRefusal {
  if (status === 409) return 'already-ended'
  if (status === 403) return 'not-allowed'
  if (status === 404) return 'gone'
  return 'unavailable'
}

export function terminationRefusalTitle(refusal: TerminationRefusal): string {
  if (refusal === 'already-ended') return 'Este vínculo ya no está activo'
  if (refusal === 'not-allowed') return 'No puedes terminar este vínculo'
  if (refusal === 'gone') return 'Este vínculo ya no está'
  return 'No pudimos terminar el vínculo'
}

export function terminationRefusalDescription(refusal: TerminationRefusal): string {
  if (refusal === 'already-ended') {
    return 'Puede que alguien más lo terminara mientras tenías esta pantalla abierta. Actualiza para ver cómo está ahora.'
  }
  if (refusal === 'not-allowed') {
    return 'Solo alguien que pueda asignar profesionales puede terminar un vínculo. El profesional responsable no puede, ni siquiera con sus propios clientes.'
  }
  if (refusal === 'gone') {
    return 'Vuelve a clientes para ver qué vínculos hay ahora.'
  }
  // Nothing was written: the command is all or nothing, so a failure leaves the
  // relationship exactly as it was.
  return 'La conexión falló de forma temporal. No se terminó nada y nadie perdió acceso, así que puedes intentarlo otra vez.'
}

/**
 * A reason is optional — the gym owes the system no justification — but a blank
 * one is not a reason. Trimming it away silently would disagree with a caller
 * who believes they gave one.
 */
export function terminationReasonProblem(reason: string): 'blank' | 'too-long' | null {
  if (reason === '') return null
  if (reason.trim() === '') return 'blank'
  if (reason.length > 2000) return 'too-long'
  return null
}

export function terminationReasonMessage(problem: 'blank' | 'too-long'): string {
  if (problem === 'blank') return 'Escribe un motivo o deja el campo vacío.'
  return 'El motivo es demasiado largo.'
}
