/**
 * Turning a relationship's events into sentences a person reads.
 *
 * The server sends a `type` and a loose `detail` whose keys differ per kind. It
 * deliberately sends no prose: the words belong to the screen, and keeping them
 * here means a reader of the timeline and a reader of the relationship see the
 * same vocabulary.
 *
 * Two rules the wording follows, both of them product decisions rather than
 * style:
 *
 * · **A professional in charge is not a permission.** «Diana pasó a atenderla»
 *   never implies Diana can read anything. The relationship screen says so
 *   explicitly and this must not quietly suggest otherwise.
 * · **A reason belongs to whoever gave it.** When the person ended the
 *   relationship, their reason is theirs and the server withholds it. The line
 *   says who closed it and stops, rather than implying nothing was said.
 */

import type { RelationshipHistoryEvent } from './studio-api'

export type HistoryEventKind = RelationshipHistoryEvent['type']

function detailText(event: RelationshipHistoryEvent, key: string): string | null {
  const value = (event.detail as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function detailFlag(event: RelationshipHistoryEvent, key: string): boolean {
  return (event.detail as Record<string, unknown>)[key] === true
}

/** The professional an assignment event is about, or null when unnamed. */
export function professionalName(event: RelationshipHistoryEvent): string | null {
  return detailText(event, 'display_name')
}

/**
 * What happened, in one line.
 *
 * `personName` is the client the relationship is about. It is passed in rather
 * than read from the event because the server never repeats it — the screen
 * already knows whose history it is showing.
 */
export function historyEventTitle(event: RelationshipHistoryEvent, personName: string): string {
  const professional = professionalName(event)

  switch (event.type) {
    case 'relationship_started':
      return detailText(event, 'continues_relationship_id')
        ? `${personName} volvió al gimnasio`
        : `${personName} entró como clienta`
    case 'holder_assigned':
      return professional
        ? `${professional} pasó a atenderla`
        : 'Se asignó un profesional responsable'
    case 'holder_ended':
      return professional ? `${professional} dejó de atenderla` : 'El responsable dejó de atenderla'
    case 'substitution_proposed':
      return professional
        ? `Se propuso a ${professional} como suplente`
        : 'Se propuso una suplencia'
    case 'substitution_accepted':
      return professional
        ? `${personName} aceptó a ${professional} como suplente`
        : `${personName} aceptó la suplencia`
    case 'substitution_ended':
      return professional ? `Terminó la suplencia de ${professional}` : 'Terminó la suplencia'
    case 'consent_decided':
      return consentTitle(event, personName)
    case 'relationship_ended':
      return endedTitle(event, personName)
  }
}

function consentTitle(event: RelationshipHistoryEvent, personName: string): string {
  const scope = detailText(event, 'scope_code')
  const decision = detailText(event, 'decision')
  const named = scope ? scopeLabel(scope) : 'un permiso'
  if (decision === 'accepted') return `${personName} concedió ${named}`
  if (decision === 'rejected') return `${personName} rechazó ${named}`
  if (decision === 'revoked') return `${personName} retiró ${named}`
  return `${personName} decidió sobre ${named}`
}

/*
 * Who closed it, and the reason only when it is ours to read. `declared_by_us`
 * comes from the server precisely so the screen can distinguish «they gave no
 * reason» from «the reason is not ours», and say neither when it does not know.
 */
function endedTitle(event: RelationshipHistoryEvent, personName: string): string {
  if (detailFlag(event, 'declared_by_us')) return 'El gimnasio cerró el vínculo'
  const by = detailText(event, 'ended_by_kind')
  if (by === 'person') return `${personName} cerró el vínculo`
  return 'Se cerró el vínculo'
}

/** The reason the organization declared, when it was the organization. */
export function endedReason(event: RelationshipHistoryEvent): string | null {
  if (event.type !== 'relationship_ended') return null
  return detailText(event, 'reason')
}

/**
 * Said once, under a closure the person declared: the reason exists and is not
 * ours. Without this the screen looks like it is hiding something, or like
 * nothing was said.
 */
export function endedElsewhereNote(event: RelationshipHistoryEvent): string | null {
  if (event.type !== 'relationship_ended') return null
  if (detailFlag(event, 'declared_by_us')) return null
  return 'Si dio un motivo, es suyo y no nos lo comparte.'
}

/*
 * The seven V1 scopes, in the words the person was shown. Not read from the
 * published catalogue on purpose: that catalogue describes what is being asked
 * for now, and a history line has to keep saying what was decided then, even
 * after a scope is renamed or stops being offered.
 */
const SCOPE_LABELS: Record<string, string> = {
  relationship_training: 'el entrenamiento',
  prior_training_history: 'su historial de entrenamiento anterior',
  body_progress: 'su progreso corporal',
  health_context: 'su contexto de salud',
  nutrition_intake: 'lo que come',
  nutrition_guidance: 'la orientación nutricional',
  nutrition_media: 'las fotos de sus comidas',
}

export function scopeLabel(scopeCode: string): string {
  return SCOPE_LABELS[scopeCode] ?? `el permiso «${scopeCode}»`
}

/**
 * Events that carry a professional's name are the ones a coach sees a shorter
 * list of: the row policy shows them only their own assignment. The screen says
 * so when the reader is a coach, so a short history does not read as a complete
 * one.
 */
export function mentionsAProfessional(event: RelationshipHistoryEvent): boolean {
  return (
    event.type === 'holder_assigned' ||
    event.type === 'holder_ended' ||
    event.type === 'substitution_proposed' ||
    event.type === 'substitution_accepted' ||
    event.type === 'substitution_ended'
  )
}
