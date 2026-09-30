/**
 * Supersets and the order they keep, for anything with a place and an optional chain.
 *
 * The routine editor and the session in progress ask the same questions of a list of
 * exercises — move one, chain two, take one out of its chain — and the answers have to
 * be the same, or a superset built in the routine would behave differently the moment
 * somebody started training it. So the rules live here once, typed on the two fields
 * they need, and each screen brings its own row.
 *
 * `chainedBy` takes how to tell rows apart, because positions move under it: the editor
 * tells them by movement, and the session by its own key, since a session can hold the
 * same movement twice.
 */

export interface Chainable {
  readonly position: number
  readonly supersetGroup?: number
}

/**
 * The row without its chain. Removed rather than set to undefined: the key's absence is
 * what the contract means by «not chained», and `exactOptionalPropertyTypes` agrees.
 */
function loose<T extends Chainable>(step: T): T {
  const copy: { -readonly [K in keyof T]: T[K] } = { ...step }
  delete copy.supersetGroup
  return copy
}

/**
 * The positions an exercise travels with: its whole superset, or only itself.
 *
 * A chain is a block. Everything below depends on that single idea, and it is what
 * makes the model match what somebody sees — two exercises struck with the same
 * colour are one thing, so dragging either drags both and nothing gets dropped
 * between them.
 */
export function blockAt<T extends Chainable>(
  steps: readonly T[],
  position: number,
): readonly number[] {
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
export function movedTo<T extends Chainable>(
  steps: readonly T[],
  from: number,
  to: number,
): readonly T[] {
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
function boundary<T extends Chainable>(
  rest: readonly T[],
  index: number,
  forwards: boolean,
): number {
  let at = Math.max(0, Math.min(rest.length, index))
  while (at > 0 && at < rest.length) {
    const before = rest[at - 1]?.supersetGroup
    if (before === undefined || before !== rest[at]?.supersetGroup) return at
    at += forwards ? 1 : -1
  }
  return at
}

/** Positions run one to N with no gaps, which is what the database requires. */
export function renumbered<T extends Chainable>(steps: readonly T[]): readonly T[] {
  return steps.map((step, index) => ({ ...step, position: index + 1 }))
}

/** A chain of one is not a chain, however it came to be one. */
export function settled<T extends Chainable>(steps: readonly T[]): readonly T[] {
  const counts = new Map<number, number>()
  for (const step of steps) {
    if (step.supersetGroup === undefined) continue
    counts.set(step.supersetGroup, (counts.get(step.supersetGroup) ?? 0) + 1)
  }
  return steps.map((step) => {
    if (step.supersetGroup === undefined || (counts.get(step.supersetGroup) ?? 0) >= 2) return step
    return loose(step)
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
export function chainedBy<T extends Chainable>(
  steps: readonly T[],
  position: number,
  mate: number,
  identity: (step: T) => unknown,
): readonly T[] {
  if (position === mate) return steps
  const source = steps.find((step) => step.position === position)
  const partner = steps.find((step) => step.position === mate)
  if (!source || !partner) return steps

  // Out of its own chain first: one exercise cannot be in two, and a step still marked
  // with its old group would drag that whole block along behind it.
  const free = unchained(steps, position)
  const at = free.find((step) => identity(step) === identity(source))?.position
  const other = free.find((step) => identity(step) === identity(partner))
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
  const marked = new Set([identity(source)])
  if (other.supersetGroup === undefined) marked.add(identity(partner))

  return settled(
    moved.map((step) => (marked.has(identity(step)) ? { ...step, supersetGroup: group } : step)),
  )
}

/** One more than every group in use, so a new chain never collides with an old one. */
function nextGroup<T extends Chainable>(steps: readonly T[]): number {
  return Math.max(0, ...steps.map((step) => step.supersetGroup ?? 0)) + 1
}

/**
 * Takes this exercise out of its chain, and leaves the rest of it chained.
 *
 * With three in a superset, removing one is not the end of the superset — the other
 * two carry on. Only a chain down to a single member dissolves, because one exercise
 * back to back with nothing is just an exercise.
 */
export function unchained<T extends Chainable>(
  steps: readonly T[],
  position: number,
): readonly T[] {
  const group = steps.find((step) => step.position === position)?.supersetGroup
  if (group === undefined) return steps

  const freed: readonly T[] = steps.map((step) => {
    if (step.position !== position) return step
    return loose(step)
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
export function chainLetters<T extends Chainable>(
  steps: readonly T[],
): ReadonlyMap<number, string> {
  const letters = new Map<number, string>()
  for (const step of steps) {
    const group = step.supersetGroup
    if (group === undefined || letters.has(group)) continue
    const at = letters.size
    letters.set(group, at < 26 ? String.fromCharCode(65 + at) : String(at + 1))
  }
  return letters
}
