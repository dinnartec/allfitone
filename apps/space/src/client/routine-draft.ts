/**
 * What a routine has to be before it can be published, and how it reaches the wire.
 *
 * The screen shows a name, a list and a confirm; what it cannot show is *why* the
 * confirm is unavailable, and `V-G` exists precisely to say so. Those reasons are the
 * same ones `session_content_errors` enforces in PostgreSQL — stated here in the
 * person's words so the screen does not have to guess from an error code.
 *
 * **This is not a second validator.** The database refuses regardless; this only turns
 * a refusal into a sentence before it happens. If the two ever disagree the database
 * wins, and that disagreement is a bug here.
 */

import type { SessionTemplateDraftContent } from './content'

/**
 * Every routine a person builds in Space is strength.
 *
 * `V-H` asks for a name and nothing else, so a discipline picker would be a question
 * the canvas does not ask. Endurance, interval and mobility exist in the catalogue and
 * belong to programmes Allfit curates; the day Space offers them, this becomes a
 * choice on the screen rather than a constant here.
 */
export const DISCIPLINE = 'strength'

export interface WorkingStep {
  readonly position: number
  readonly movementId: string
  readonly name: string
  readonly sets: number
  readonly reps: number
  readonly restSeconds?: number
}

export interface PublishIssue {
  readonly title: string
  readonly hint: string
}

const MAX_TITLE = 160

export function reasonsNotToPublish(
  title: string,
  steps: readonly WorkingStep[],
): readonly PublishIssue[] {
  const issues: PublishIssue[] = []

  if (title.trim() === '') {
    issues.push({ title: 'La rutina no tiene nombre', hint: 'Ponle uno arriba' })
  } else if (title.trim().length > MAX_TITLE) {
    issues.push({ title: 'El nombre es demasiado largo', hint: 'Acórtalo un poco' })
  }

  if (steps.length === 0) {
    issues.push({ title: 'La rutina no tiene ejercicios', hint: 'Añade al menos uno' })
  }

  for (const step of steps) {
    if (step.sets < 1) {
      issues.push({ title: `«${step.name}» no tiene ninguna serie`, hint: 'Añádele al menos una' })
    } else if (step.reps < 1) {
      issues.push({ title: `«${step.name}» no tiene repeticiones`, hint: 'Está vacía' })
    }
  }

  return issues
}

export function countSets(steps: readonly WorkingStep[]): number {
  return steps.reduce((total, step) => total + step.sets, 0)
}

/**
 * The draft as the contract wants it.
 *
 * `activity_type_id` is deliberately absent: the creation command already put the one
 * activity type of the discipline in the draft, and sending null here would erase it.
 */
export function stepsToContent(
  title: string,
  steps: readonly WorkingStep[],
  activityTypeId: string | null = null,
): SessionTemplateDraftContent {
  return {
    title: title.trim(),
    activity_type_id: activityTypeId,
    steps: steps.map((step, index) => ({
      position: index + 1,
      movement_id: step.movementId,
      target: {
        family: 'strength' as const,
        target_sets: step.sets,
        target_reps: step.reps,
        ...(step.restSeconds === undefined ? {} : { target_rest_seconds: step.restSeconds }),
      },
    })),
  }
}

/** Renumbering is the whole operation: a gap in `position` is refused by the database. */
export function withoutStep(
  steps: readonly WorkingStep[],
  position: number,
): readonly WorkingStep[] {
  return steps
    .filter((step) => step.position !== position)
    .map((step, index) => ({ ...step, position: index + 1 }))
}

export function reordered(
  steps: readonly WorkingStep[],
  order: readonly number[],
): readonly WorkingStep[] {
  const byPosition = new Map(steps.map((step) => [step.position, step]))
  return order
    .map((position) => byPosition.get(position))
    .filter((step): step is WorkingStep => step !== undefined)
    .map((step, index) => ({ ...step, position: index + 1 }))
}
