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
          ...(one.rpe === undefined ? {} : { target_rpe: one.rpe }),
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
              ...(typeof one.target_rpe === 'number' ? { rpe: one.target_rpe } : {}),
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
  return settled(renumbered(steps.filter((step) => step.position !== position)))
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

/**
 * The positions an exercise travels with: its whole superset, or only itself.
 *
 * A chain is a block. Everything below depends on that single idea, and it is what
 * makes the model match what somebody sees — two exercises struck with the same
 * colour are one thing, so dragging either drags both and nothing gets dropped
 * between them.
 */
export function blockAt(steps: readonly WorkingStep[], position: number): readonly number[] {
  const group = steps.find((step) => step.position === position)?.supersetGroup
  if (group === undefined) return [position]
  return steps
    .filter((step) => step.supersetGroup === group)
    .map((step) => step.position)
    .sort((one, other) => one - other)
}

/**
 * A drag, with a superset travelling whole.
 *
 * **This is the defect it was written to fix.** Chains used to be dissolved whenever
 * their members stopped being neighbours, which meant that dragging any unrelated
 * exercise into the gap between two chained ones silently unchained them. Somebody
 * reordering their routine lost supersets they had just made, with nothing on screen
 * to say so — and `IX-46` guaranteed they could never have been saved that way
 * either. Now a block cannot be split: it moves as one, and nothing lands inside it.
 */
export function movedTo(
  steps: readonly WorkingStep[],
  from: number,
  to: number,
): readonly WorkingStep[] {
  const block = blockAt(steps, from)
  const first = block[0]
  if (first === undefined) return steps

  const span = block.length
  const at = Math.max(1, Math.min(steps.length - span + 1, to))
  if (at === first) return steps

  const moving = steps.filter((step) => block.includes(step.position))
  const rest = steps.filter((step) => !block.includes(step.position))
  const index = boundary(rest, at - 1, at - 1 > first - 1)

  return renumbered([...rest.slice(0, index), ...moving, ...rest.slice(index)])
}

/**
 * The nearest index that is not inside somebody else's chain.
 *
 * Dropping between the two halves of another superset would split it, so the landing
 * slides off the block in the direction the drag was already going.
 */
function boundary(rest: readonly WorkingStep[], index: number, forwards: boolean): number {
  let at = Math.max(0, Math.min(rest.length, index))
  while (at > 0 && at < rest.length) {
    const before = rest[at - 1]?.supersetGroup
    if (before === undefined || before !== rest[at]?.supersetGroup) return at
    at += forwards ? 1 : -1
  }
  return at
}

/** Positions run one to N with no gaps, which is what the database requires. */
function renumbered(steps: readonly WorkingStep[]): readonly WorkingStep[] {
  return steps.map((step, index) => ({ ...step, position: index + 1 }))
}

/** A chain of one is not a chain, however it came to be one. */
function settled(steps: readonly WorkingStep[]): readonly WorkingStep[] {
  const counts = new Map<number, number>()
  for (const step of steps) {
    if (step.supersetGroup === undefined) continue
    counts.set(step.supersetGroup, (counts.get(step.supersetGroup) ?? 0) + 1)
  }
  return steps.map((step) => {
    if (step.supersetGroup === undefined || (counts.get(step.supersetGroup) ?? 0) >= 2) return step
    const { supersetGroup: _alone, ...rest } = step
    return rest
  })
}

/**
 * Chains an exercise to another, into a superset of any size.
 *
 * **A superset is not a pair.** Three exercises back to back is an ordinary thing to
 * prescribe, so chaining with somebody who is already in a chain joins that chain
 * rather than starting a rival one — and leaves whatever chain this exercise was in,
 * because one exercise cannot be in two.
 *
 * **Choosing is not restricted to a neighbour, but the result always is.** `IX-46`
 * refuses a group whose positions are not contiguous and refuses it at publication,
 * so offering only the rows beside this one was the screen protecting the database at
 * the person's expense. Picking the fifth to chain with the second brings the fifth
 * alongside, which is what somebody meant by choosing it.
 */
export function chainedWith(
  steps: readonly WorkingStep[],
  position: number,
  mate: number,
): readonly WorkingStep[] {
  if (position === mate) return steps
  const source = steps.find((step) => step.position === position)
  const partner = steps.find((step) => step.position === mate)
  if (!source || !partner) return steps

  // Out of its own chain first: one exercise cannot be in two, and a step still marked
  // with its old group would drag that whole block along behind it.
  const free = unchained(steps, position)
  const at = free.find((step) => step.movementId === source.movementId)?.position
  const other = free.find((step) => step.movementId === partner.movementId)
  if (at === undefined || !other) return steps

  const group = other.supersetGroup ?? nextGroup(free)
  const block = blockAt(free, other.position)
  const first = block[0] ?? other.position

  // The one who asked stays put and the other comes to them, on the side it already
  // came from: whichever was first in the routine still is, so chaining reorders as
  // little as it can get away with.
  const moved = movedTo(free, other.position, first < at ? at - block.length : at + 1)

  // Both, when the partner has no chain yet: marking only one would leave a group of
  // one, which `settled` then dissolves, and nothing at all would have happened.
  const marked = new Set([source.movementId])
  if (other.supersetGroup === undefined) marked.add(partner.movementId)

  return settled(
    moved.map((step) => (marked.has(step.movementId) ? { ...step, supersetGroup: group } : step)),
  )
}

/** One more than every group in use, so a new chain never collides with an old one. */
function nextGroup(steps: readonly WorkingStep[]): number {
  return Math.max(0, ...steps.map((step) => step.supersetGroup ?? 0)) + 1
}

/**
 * Takes this exercise out of its chain, and leaves the rest of it chained.
 *
 * With three in a superset, removing one is not the end of the superset — the other
 * two carry on. Only a chain down to a single member dissolves, because one exercise
 * back to back with nothing is just an exercise.
 */
export function unchained(steps: readonly WorkingStep[], position: number): readonly WorkingStep[] {
  const group = steps.find((step) => step.position === position)?.supersetGroup
  if (group === undefined) return steps

  const freed: readonly WorkingStep[] = steps.map((step) => {
    if (step.position !== position) return step
    // Removed rather than set to undefined: the key's absence is what the contract
    // means by «not chained», and `exactOptionalPropertyTypes` agrees.
    const { supersetGroup: _chained, ...rest } = step
    return rest
  })

  const remaining = freed.filter((step) => step.supersetGroup === group)
  if (remaining.length < 2) return settled(freed)

  // It was in the middle of three, so leaving it where it stands would hold the other
  // two apart — and a group whose positions are not contiguous is refused by `IX-46`.
  // It parks immediately after what is left of the chain.
  const last = Math.max(...remaining.map((step) => step.position))
  return position > last ? settled(freed) : settled(movedTo(freed, position, last))
}

/**
 * A letter per superset, so two rows can say they are the same one.
 *
 * The group number is an implementation detail — it counts up forever as chains are
 * made and broken, so the first superset of a routine can easily be «superserie 7».
 * Letters are assigned by where the chain appears in the routine, which is the order
 * somebody reads it in, and they are recomputed from the steps every time rather than
 * stored: a stored letter is one more thing that can disagree with the list.
 *
 * Past the alphabet it falls back to the number. Twenty-seven supersets in one routine
 * is not a case worth inventing a notation for, but being quietly wrong about it is
 * worse than being ugly.
 */
export function chainLetters(steps: readonly WorkingStep[]): ReadonlyMap<number, string> {
  const letters = new Map<number, string>()
  for (const step of steps) {
    const group = step.supersetGroup
    if (group === undefined || letters.has(group)) continue
    const at = letters.size
    letters.set(group, at < 26 ? String.fromCharCode(65 + at) : String(at + 1))
  }
  return letters
}

/**
 * Another movement in the same place, keeping everything the place had.
 *
 * Sets, rest, unit and the superset it belongs to are the prescription; the movement
 * is what the prescription is *of*. Somebody swapping an incline press for a flat one
 * is not asking to type four sets again.
 */
export function replacedStep(
  steps: readonly WorkingStep[],
  position: number,
  movement: PickedMovement,
): readonly WorkingStep[] {
  return steps.map((step) =>
    step.position === position ? { ...step, movementId: movement.id, name: movement.name } : step,
  )
}

/** The unit the rows agree on, or nothing when none of them carries a weight. */
function unitOf(sets: readonly Record<string, unknown>[]): MassUnit | undefined {
  for (const one of sets) {
    const code = one.target_load_unit_code
    if (code === 'kg' || code === 'lb') return code
  }
  return undefined
}
