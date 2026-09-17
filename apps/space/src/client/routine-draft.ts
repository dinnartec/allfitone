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
import type { PickedMovement } from './exercise-pick'
import { OPENING_SETS, OPENING_UNIT, type MassUnit, type WorkingSet } from './set-scheme'

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
  /** One entry per set, in order. The truth of the prescription since `ADR-030`. */
  readonly sets: readonly WorkingSet[]
  readonly restSeconds?: number
  /** Shared with a neighbour to run them back to back; only neighbours may share one. */
  readonly supersetGroup?: number
  /** What the weights of this exercise are said in. One bar, one unit.  */
  readonly loadUnit?: MassUnit
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
    if (step.sets.length === 0) {
      issues.push({ title: `«${step.name}» no tiene ninguna serie`, hint: 'Añádele al menos una' })
      continue
    }
    // A set to failure is the one kind that legitimately has no number.
    const empty = step.sets.some((one) => one.kind !== 'to_failure' && (one.reps ?? 0) < 1)
    if (empty) {
      issues.push({ title: `«${step.name}» tiene una serie vacía`, hint: 'Ponle repeticiones' })
    }
  }

  return issues
}

export function countSets(steps: readonly WorkingStep[]): number {
  return steps.reduce((total, step) => total + step.sets.length, 0)
}

/**
 * The draft as the contract wants it.
 *
 * **`activityTypeId` is required, and it is the one the creation command put in the
 * draft.** The key itself is not optional — `session_content_errors` rejects any
 * content that does not carry all three — so "leave it out" is not available, and
 * passing null erases it. With no activity type the family a step must match cannot
 * be resolved, so *every* step comes back `target-family` and the whole draft is
 * refused: a routine could be named and never given an exercise. A default here is
 * what let that ship, so there is none.
 */
export function stepsToContent(
  title: string,
  steps: readonly WorkingStep[],
  activityTypeId: string | null,
): SessionTemplateDraftContent {
  return {
    title: title.trim(),
    activity_type_id: activityTypeId,
    steps: steps.map((step, index) => ({
      position: index + 1,
      movement_id: step.movementId,
      ...(step.supersetGroup === undefined ? {} : { superset_group: step.supersetGroup }),
      target: {
        family: 'strength' as const,
        // The aggregate is deliberately not sent: it is derived at publication, and a
        // second copy of a number is a second copy that can disagree.
        sets: step.sets.map((one, order) => ({
          set_order: order + 1,
          kind: one.kind,
          ...(one.reps === undefined ? {} : { target_reps: one.reps }),
          // Value and unit travel together or not at all: the column pair is what
          // `planned_sets` checks, and a number with no unit is not a weight.
          ...(one.load === undefined
            ? {}
            : {
                target_load_value: one.load,
                target_load_unit_code: step.loadUnit ?? OPENING_UNIT,
              }),
        })),
        ...(step.restSeconds === undefined ? {} : { target_rest_seconds: step.restSeconds }),
      },
    })),
  }
}

/**
 * What an exercise opens with, and it is a starting point rather than a decision.
 *
 * Before `ADR-030` this was the whole prescription and nothing could change it, so
 * every exercise anybody added was four sets of eight forever. The point of the
 * screen is that every one of those rows gets edited.
 */

/**
 * Appends a whole batch, which is what makes picking several one save and not several.
 *
 * The picker hands back names as well as ids because the list renders the name, and
 * looking it up again would mean a second read of a catalogue the picker just had.
 */
export function withPicked(
  steps: readonly WorkingStep[],
  picked: readonly PickedMovement[],
): readonly WorkingStep[] {
  const chosen = picked.filter((movement) => !steps.some((step) => step.movementId === movement.id))
  return [
    ...steps,
    ...chosen.map((movement) => ({
      position: 0,
      movementId: movement.id,
      name: movement.name,
      sets: OPENING_SETS,
    })),
  ].map((step, index) => ({ ...step, position: index + 1 }))
}

/**
 * The draft as it arrived, back into what the screen edits.
 *
 * The name is not in the content: a step carries `movement_id` and nothing else about
 * the movement, so a reopened routine shows identifiers until the catalogue is read.
 * The picker already holds that catalogue, and the editor asks it by id.
 */
export function stepsFromContent(
  content: SessionTemplateDraftContent,
  nameFor: (movementId: string) => string | undefined = () => undefined,
): readonly WorkingStep[] {
  return content.steps.map((step, index) => {
    const target = step.target as Record<string, unknown>
    const sets = Array.isArray(target.sets) ? (target.sets as Record<string, unknown>[]) : []
    const movementId = typeof step.movement_id === 'string' ? step.movement_id : ''
    const rest = target.target_rest_seconds
    const group = (step as Record<string, unknown>).superset_group
    const unit = unitOf(sets)
    return {
      position: index + 1,
      movementId,
      name: nameFor(movementId) ?? 'Ejercicio',
      sets:
        sets.length > 0
          ? sets.map((one) => ({
              kind: (typeof one.kind === 'string' ? one.kind : 'normal') as WorkingSet['kind'],
              ...(typeof one.target_reps === 'number' ? { reps: one.target_reps } : {}),
              ...(typeof one.target_load_value === 'number' ? { load: one.target_load_value } : {}),
            }))
          : // An older draft says how many and how hard, and meant that many identical
            // sets. Publication does the same thing on its side.
            Array.from({ length: Number(target.target_sets ?? 0) }, () => ({
              kind: 'normal' as const,
              ...(typeof target.target_reps === 'number' ? { reps: target.target_reps } : {}),
            })),
      ...(typeof rest === 'number' ? { restSeconds: rest } : {}),
      ...(typeof group === 'number' ? { supersetGroup: group } : {}),
      // Read off the first set that carries one: the unit is the exercise's, and the
      // rows only hold it because that is where the table keeps it.
      ...(unit === undefined ? {} : { loadUnit: unit }),
    }
  })
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

/** The unit the rows agree on, or nothing when none of them carries a weight. */
function unitOf(sets: readonly Record<string, unknown>[]): MassUnit | undefined {
  for (const one of sets) {
    const code = one.target_load_unit_code
    if (code === 'kg' || code === 'lb') return code
  }
  return undefined
}
