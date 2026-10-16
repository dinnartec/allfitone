/**
 * The rules for asking somebody to cover for a client's coach.
 *
 * Three of them are worth stating away from the screen, because each is a place
 * a client could get it wrong in a way nobody notices until production:
 *
 * **Who may ask** is not only an administrator. `OP-REL-004` accepts the holder
 * too — they are the one who knows they will be away, and making them ask an
 * administrator to file their own absence is how a client ends up uncovered.
 * No other operation in this domain works that way.
 *
 * **An end date is required**, and not as a form nicety. Access stops on that
 * date by itself, with no nightly job to run; a cover with no end would have to
 * be switched off by hand, and until somebody did, it would keep granting
 * access to a person's data.
 *
 * **Proposing grants nothing.** The cover is created pending, and the
 * professional named in it reads nothing of the person's until the person
 * accepts. Silence is never acceptance. The dialog has to say so, because
 * "assign a substitute" reads like it takes effect.
 */

import type { OrganizationMembership, RelationshipSubstitution } from './studio-api'

const COACH = 'coach'

/**
 * The holder may ask, and so may anybody who can assign professionals. The
 * capability half is read from the role catalogue the server publishes — see
 * `canAssignProfessionals` — and the holder half is a plain identity check,
 * because being the holder is not a role.
 */
export function canProposeSubstitution({
  isHolder,
  mayAssignProfessionals,
  relationshipActive,
  hasHolder,
}: {
  isHolder: boolean
  mayAssignProfessionals: boolean
  relationshipActive: boolean
  hasHolder: boolean
}): boolean {
  // A cover stands in for a holder. Where there is none the command refuses,
  // and putting the first coach in charge is a different operation.
  if (!relationshipActive || !hasHolder) return false
  return isHolder || mayAssignProfessionals
}

/**
 * The coaches who could actually cover: active coaches of this organization,
 * minus whoever already attends the person. Covering yourself is not covering,
 * and the command refuses it — offering it spends a click to reach a refusal.
 */
export function coversAvailable(
  memberships: readonly OrganizationMembership[],
  holderMembershipId: string,
): readonly OrganizationMembership[] {
  return memberships
    .filter((entry) => entry.status === 'active' && entry.roles.includes(COACH))
    .filter((entry) => entry.membership_id !== holderMembershipId)
    .sort((left, right) => left.display_name.localeCompare(right.display_name, 'es'))
}

export type WindowProblem = 'missing-start' | 'missing-end' | 'ends-before-start' | 'ends-in-past'

/**
 * The same three refusals the command makes, asked here so the reader is told
 * before the round trip rather than after it. The command still decides — this
 * never lets through anything it would reject, it only answers sooner.
 *
 * `today` is passed in rather than read from the clock so the rule can be
 * tested without freezing time.
 */
export function windowProblem(
  startsOn: string,
  endsOn: string,
  today: string,
): WindowProblem | null {
  if (!startsOn) return 'missing-start'
  if (!endsOn) return 'missing-end'
  if (endsOn < startsOn) return 'ends-before-start'
  if (endsOn < today) return 'ends-in-past'
  return null
}

export function windowProblemMessage(problem: WindowProblem): string {
  if (problem === 'missing-start') return 'Dinos desde cuándo cubre.'
  if (problem === 'missing-end') {
    // Why, not just what: the date is what ends the access, so leaving it out
    // is not a blank field, it is a cover nobody would ever switch off.
    return 'Una suplencia necesita fecha de fin: es lo que corta el acceso cuando termina.'
  }
  if (problem === 'ends-before-start') return 'La fecha de fin es anterior a la de inicio.'
  return 'Esa suplencia ya habría terminado. Elige una fecha de fin futura.'
}

/** Today as the date inputs write it, in the reader's own timezone. */
export function todayAsCalendarDay(now: Date = new Date()): string {
  const year = now.getFullYear()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export type ProposalRefusal =
  'already-proposed' | 'not-allowed' | 'gone' | 'invalid-window' | 'unavailable'

/**
 * `409` is the interesting one again, and it means something different here
 * than on the other two operations in this card. It is not "somebody beat you
 * to it" and not "there is nobody to take the client from": it is that this
 * same cover, same professional and same days, is already waiting for an
 * answer. A partial unique index enforces that, so a double click lands here.
 *
 * It can also mean the person has no contact to be asked — the command refuses
 * rather than leave a professional waiting on an answer nobody was ever asked
 * for. Both are states the reader can see by refreshing, so neither offers a
 * retry.
 */
export function proposalRefusalFor(status: number | undefined): ProposalRefusal {
  if (status === 409) return 'already-proposed'
  if (status === 403) return 'not-allowed'
  if (status === 404) return 'gone'
  if (status === 422) return 'invalid-window'
  return 'unavailable'
}

export function proposalRefusalTitle(refusal: ProposalRefusal): string {
  if (refusal === 'already-proposed') return 'Esa suplencia ya está propuesta'
  if (refusal === 'not-allowed') return 'No puedes proponer suplencias en este vínculo'
  if (refusal === 'gone') return 'Este vínculo ya no está'
  if (refusal === 'invalid-window') return 'Esas fechas no sirven'
  return 'No pudimos proponer la suplencia'
}

export function proposalRefusalDescription(refusal: ProposalRefusal): string {
  if (refusal === 'already-proposed') {
    return 'Ya hay una suplencia esperando respuesta para ese profesional en esas fechas, o la persona no tiene cómo ser avisada. Actualiza para ver cómo está el vínculo ahora.'
  }
  if (refusal === 'not-allowed') {
    return 'Solo el profesional responsable, o alguien que pueda asignar profesionales, puede proponer quién le cubre.'
  }
  if (refusal === 'gone') {
    return 'Puede que el vínculo haya terminado. Vuelve a clientes para elegir otro.'
  }
  if (refusal === 'invalid-window') {
    return 'Revisa el inicio y el fin: la suplencia tiene que terminar después de empezar, y no en el pasado.'
  }
  // Nothing was written and nobody was asked, which is what makes offering a
  // retry honest here.
  return 'La conexión falló de forma temporal. No se propuso nada y no se avisó a nadie, así que puedes intentarlo otra vez.'
}

/**
 * Whether this reader is being shown every cover on the relationship, or only
 * the ones that are theirs.
 *
 * Since `STUDIO-94` the row policy shows a professional the covers of the
 * clients they hold, so for a holder an empty list really does mean there are
 * none. For anybody else without the directory capability — an accepted
 * substitute reading the screen — it still means "none that are yours to see",
 * and saying "no hay" to them would be a claim this screen cannot make.
 */
export function seesEverySubstitution({
  everyClient,
  isHolder,
}: {
  everyClient: boolean
  isHolder: boolean
}): boolean {
  return everyClient || isHolder
}

/**
 * `OP-REL-006`. Who may cut a cover short, and which covers can be cut.
 *
 * **Not the holder**, and that is the asymmetry worth stating rather than
 * smoothing over: the coach in charge may ask for a cover and may not call it
 * off. The command refuses them, so offering them the button would spend a
 * click to reach a refusal — and reading the holder into this rule because it
 * reads nicer would put a button on screen that never works.
 *
 * **Only a cover that is running.** One nobody has answered grants no access,
 * so there is nothing to cut; withdrawing it is a different operation that
 * does not exist yet (`STUDIO-150`). A cover already over has nothing to end.
 */
export function canEndSubstitution({
  mayAssignProfessionals,
  relationshipActive,
  status,
}: {
  mayAssignProfessionals: boolean
  relationshipActive: boolean
  status: RelationshipSubstitution['status']
}): boolean {
  if (!relationshipActive || !mayAssignProfessionals) return false
  return status === 'active'
}

export type TerminationRefusal = 'already-ended' | 'not-allowed' | 'gone' | 'unavailable'

/**
 * `409` here means the cover is not in a state that can be ended — it was
 * already closed, or it was never running. Either way the reader can see it by
 * refreshing, so it offers no retry; only the temporary failure does.
 */
export function terminationRefusalFor(status: number | undefined): TerminationRefusal {
  if (status === 409) return 'already-ended'
  if (status === 403) return 'not-allowed'
  if (status === 404) return 'gone'
  return 'unavailable'
}

export function terminationRefusalTitle(refusal: TerminationRefusal): string {
  if (refusal === 'already-ended') return 'Esa suplencia ya no está corriendo'
  if (refusal === 'not-allowed') return 'No puedes terminar suplencias en este vínculo'
  if (refusal === 'gone') return 'Esa suplencia ya no está'
  return 'No pudimos terminar la suplencia'
}

export function terminationRefusalDescription(refusal: TerminationRefusal): string {
  if (refusal === 'already-ended') {
    return 'Puede que alguien más la terminara, o que la persona nunca la aceptara. Actualiza para ver cómo está el vínculo ahora.'
  }
  if (refusal === 'not-allowed') {
    return 'Solo alguien que pueda asignar profesionales puede terminar una suplencia. El profesional responsable puede proponerlas, pero no cortarlas.'
  }
  if (refusal === 'gone') {
    return 'Puede que el vínculo o la suplencia hayan terminado. Actualiza para ver cómo está ahora.'
  }
  // Nothing was written, so the access is exactly as it was: still running.
  return 'La conexión falló de forma temporal. La suplencia sigue corriendo, así que puedes intentarlo otra vez.'
}
