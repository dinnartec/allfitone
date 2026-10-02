/**
 * What has to be true about a routine before it can be published.
 *
 * These are the reasons `V-G` shows. They mirror `session_content_errors`, so the
 * value here is that the wording is right and that positions are renumbered — a gap
 * in `position` is refused by the database, and a screen that removes the second of
 * three exercises must not leave one.
 */

import { describe, expect, test } from 'bun:test'

import {
  countSets,
  reasonsNotToPublish,
  chainLetters,
  chainedWith,
  movedTo,
  reordered,
  replacedStep,
  unchained,
  stepsFromContent,
  stepsToContent,
  withPicked,
  withoutStep,
  type WorkingStep,
} from './routine-draft'

const step = (position: number, name: string, sets = 4, reps = 8): WorkingStep => ({
  position,
  movementId: `movement-${position}`,
  name,
  sets: Array.from({ length: sets }, () => ({ kind: 'normal' as const, reps })),
})

describe('what stops a routine from being published', () => {
  test('T-SP-ROUTINE-01 a routine with no name and no exercises is missing two things', () => {
    expect(reasonsNotToPublish('', []).map((issue) => issue.title)).toEqual([
      'La rutina no tiene nombre',
      'La rutina no tiene ejercicios',
    ])
  })

  test('T-SP-ROUTINE-02 whitespace is not a name', () => {
    expect(reasonsNotToPublish('   ', [step(1, 'Sentadilla')])).toHaveLength(1)
  })

  test('T-SP-ROUTINE-03 an exercise with no series is named in the reason', () => {
    const issues = reasonsNotToPublish('Empuje', [step(1, 'Press de banca', 0)])

    expect(issues[0]?.title).toBe('«Press de banca» no tiene ninguna serie')
  })

  test('T-SP-ROUTINE-04 a complete routine has nothing missing', () => {
    expect(reasonsNotToPublish('Empuje', [step(1, 'Press de banca')])).toEqual([])
  })

  test('T-SP-ROUTINE-05 series are counted across exercises, not per exercise', () => {
    expect(countSets([step(1, 'A', 4), step(2, 'B', 3)])).toBe(7)
  })
})

describe('the draft as the contract wants it', () => {
  const ACTIVITY = '019f0000-0000-7000-8000-000000000031'

  test('T-SP-ROUTINE-06 positions are renumbered from one, whatever they were', () => {
    const content = stepsToContent('Empuje', [step(7, 'A'), step(9, 'B')], ACTIVITY)

    expect(content.steps.map((one) => one.position)).toEqual([1, 2])
  })

  test('T-SP-ROUTINE-07 rest is sent only when somebody set it', () => {
    const content = stepsToContent(
      'Empuje',
      [{ ...step(1, 'A'), restSeconds: 90 }, step(2, 'B')],
      ACTIVITY,
    )

    expect(content.steps[0]?.target).toHaveProperty('target_rest_seconds', 90)
    expect(content.steps[1]?.target).not.toHaveProperty('target_rest_seconds')
  })

  test('T-SP-ROUTINE-08 the title is trimmed, because the database trims it too', () => {
    expect(stepsToContent('  Empuje  ', [], ACTIVITY).title).toBe('Empuje')
  })

  test('T-SP-ROUTINE-09 the activity type travels on every save, because null erases it', () => {
    // The defect: the screen sent null, which wiped the type the creation had put in
    // the draft. With no type there is no family to match, so `session_content_errors`
    // answered `target-family` for every step and the whole draft was refused — the
    // routine editor failed the moment somebody picked an exercise.
    const content = stepsToContent('Empuje', [step(1, 'A')], ACTIVITY)

    expect(content.activity_type_id).toBe(ACTIVITY)
  })

  test('T-SP-ROUTINE-10 a weight travels with its unit, or it is not a weight', () => {
    const loaded: WorkingStep = {
      ...step(1, 'A'),
      loadUnit: 'lb',
      sets: [
        { kind: 'normal', reps: 8, load: 135 },
        { kind: 'normal', reps: 8 },
      ],
    }
    const sets = stepsToContent('Empuje', [loaded], ACTIVITY).steps[0]?.target as {
      sets: Record<string, unknown>[]
    }

    expect(sets.sets[0]).toMatchObject({ target_load_value: 135, target_load_unit_code: 'lb' })
    // The column pair is what `planned_sets` checks: half of it is refused.
    expect(sets.sets[1]).not.toHaveProperty('target_load_value')
    expect(sets.sets[1]).not.toHaveProperty('target_load_unit_code')
  })

  test("T-SP-ROUTINE-11 and comes back as the exercise's unit when the draft is reopened", () => {
    const loaded: WorkingStep = {
      ...step(1, 'A'),
      loadUnit: 'lb',
      sets: [{ kind: 'normal', reps: 8, load: 135 }],
    }
    const reopened = stepsFromContent(stepsToContent('Empuje', [loaded], ACTIVITY))

    expect(reopened[0]?.loadUnit).toBe('lb')
    expect(reopened[0]?.sets[0]?.load).toBe(135)
  })

  test('T-SP-ROUTINE-12 a routine nobody weighed carries no unit either', () => {
    const reopened = stepsFromContent(stepsToContent('Empuje', [step(1, 'A')], ACTIVITY))

    expect(reopened[0]?.loadUnit).toBeUndefined()
  })
})

describe('removing and reordering leave no gap', () => {
  test('T-SP-ROUTINE-09 removing the middle exercise renumbers the rest', () => {
    const left = withoutStep([step(1, 'A'), step(2, 'B'), step(3, 'C')], 2)

    expect(left.map((one) => [one.position, one.name])).toEqual([
      [1, 'A'],
      [2, 'C'],
    ])
  })

  test('T-SP-ROUTINE-10 reordering renumbers by the new order and keeps every exercise', () => {
    const moved = reordered([step(1, 'A'), step(2, 'B'), step(3, 'C')], [3, 1, 2])

    expect(moved.map((one) => [one.position, one.name])).toEqual([
      [1, 'C'],
      [2, 'A'],
      [3, 'B'],
    ])
  })

  test('T-SP-ROUTINE-11 an order naming something that is gone drops it rather than a hole', () => {
    expect(reordered([step(1, 'A')], [1, 99]).map((one) => one.name)).toEqual(['A'])
  })
})

describe('dragging an exercise somewhere else', () => {
  const three = () => [step(1, 'A'), step(2, 'B'), step(3, 'C')]
  const five = () => [1, 2, 3, 4, 5].map((at) => step(at, String.fromCharCode(64 + at)))

  test('T-SP-ROUTINE-13 the last one to the front, and everything renumbers', () => {
    expect(movedTo(three(), 3, 1).map((one) => one.name)).toEqual(['C', 'A', 'B'])
    expect(movedTo(three(), 3, 1).map((one) => one.position)).toEqual([1, 2, 3])
  })

  test('T-SP-ROUTINE-14 the first one to the end', () => {
    expect(movedTo(three(), 1, 3).map((one) => one.name)).toEqual(['B', 'C', 'A'])
  })

  test('T-SP-ROUTINE-15 dropping it where it already was changes nothing', () => {
    expect(movedTo(three(), 2, 2).map((one) => one.name)).toEqual(['A', 'B', 'C'])
  })

  test('T-SP-ROUTINE-28 dragging anything between two chained exercises does not unchain them', () => {
    // The defect: a chain was dissolved whenever its members stopped being neighbours,
    // so dragging an unrelated exercise into the gap silently lost a superset somebody
    // had just made, with nothing on screen to say so.
    const chained = chainedWith(five(), 2, 3)
    const moved = movedTo(chained, 1, 2)

    expect(moved.filter((one) => one.supersetGroup !== undefined)).toHaveLength(2)
    const group = moved.filter((one) => one.supersetGroup !== undefined).map((one) => one.position)
    expect(group[1]).toBe((group[0] ?? 0) + 1)
  })

  test('T-SP-ROUTINE-29 a chain travels whole when any of its members is dragged', () => {
    const chained = chainedWith(five(), 2, 3)
    const moved = movedTo(chained, 2, 4)

    expect(moved.map((one) => one.name)).toEqual(['A', 'D', 'E', 'B', 'C'])
    expect(moved.filter((one) => one.supersetGroup !== undefined).map((one) => one.name)).toEqual([
      'B',
      'C',
    ])
  })

  test('T-SP-ROUTINE-16 a superset survives being moved as a whole', () => {
    const chained = [
      step(1, 'A'),
      { ...step(2, 'B'), supersetGroup: 1 },
      { ...step(3, 'C'), supersetGroup: 1 },
    ]
    const moved = movedTo(chained, 1, 3)

    expect(moved.map((one) => one.name)).toEqual(['B', 'C', 'A'])
    expect(moved.filter((one) => one.supersetGroup === 1)).toHaveLength(2)
  })

  test('T-SP-ROUTINE-17 nothing can be dropped inside a chain, so it slides off it', () => {
    const chained = [
      step(1, 'A'),
      { ...step(2, 'B'), supersetGroup: 1 },
      { ...step(3, 'C'), supersetGroup: 1 },
      step(4, 'D'),
    ]
    // Asked to land between B and C, which would split them. A block is one item, so
    // one place of travel past it lands beyond the whole thing.
    const moved = movedTo(chained, 4, 3)

    expect(moved.map((one) => one.name)).toEqual(['A', 'D', 'B', 'C'])
    expect(moved.filter((one) => one.supersetGroup !== undefined)).toHaveLength(2)
  })
})

describe('chaining two exercises into a superset', () => {
  const five = () => [1, 2, 3, 4, 5].map((at) => step(at, String.fromCharCode(64 + at)))

  test('T-SP-ROUTINE-19 two neighbours chain where they stand', () => {
    const chained = chainedWith(five(), 2, 3)

    expect(chained.map((one) => one.name)).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(chained.filter((one) => one.supersetGroup !== undefined).map((one) => one.name)).toEqual(
      ['B', 'C'],
    )
  })

  test('T-SP-ROUTINE-20 a distant one is brought alongside, because the pair must be contiguous', () => {
    // `IX-46` refuses a group whose positions are not contiguous, so choosing the
    // fifth to chain with the second has to move it there.
    const chained = chainedWith(five(), 2, 5)

    expect(chained.map((one) => one.name)).toEqual(['A', 'B', 'E', 'C', 'D'])
    const group = chained.filter((one) => one.supersetGroup !== undefined)
    expect(group.map((one) => one.name)).toEqual(['B', 'E'])
    expect(group.map((one) => one.position)).toEqual([2, 3])
  })

  test('T-SP-ROUTINE-21 and one from above lands directly before it', () => {
    const chained = chainedWith(five(), 4, 1)
    const group = chained.filter((one) => one.supersetGroup !== undefined)

    expect(group.map((one) => one.name)).toEqual(['A', 'D'])
    expect(group.map((one) => one.position)[1]).toBe((group.map((one) => one.position)[0] ?? 0) + 1)
  })

  test('T-SP-ROUTINE-22 joining an existing chain makes it three, not a rival pair', () => {
    const joined = chainedWith(chainedWith(five(), 4, 5), 1, 4)
    const chained = joined.filter((one) => one.supersetGroup !== undefined)

    expect(chained.map((one) => one.name)).toEqual(['A', 'D', 'E'])
    expect(new Set(chained.map((one) => one.supersetGroup)).size).toBe(1)
  })

  test('T-SP-ROUTINE-30 a superset is not a pair: a third joins the same chain', () => {
    const three = chainedWith(chainedWith(five(), 2, 3), 4, 3)
    const chained = three.filter((one) => one.supersetGroup !== undefined)

    expect(chained.map((one) => one.name)).toEqual(['B', 'C', 'D'])
    expect(new Set(chained.map((one) => one.supersetGroup)).size).toBe(1)
  })

  test('T-SP-ROUTINE-31 leaving a chain of three leaves the other two chained', () => {
    const three = chainedWith(chainedWith(five(), 2, 3), 4, 3)
    const freed = unchained(three, 3)
    const chained = freed.filter((one) => one.supersetGroup !== undefined)

    expect(chained.map((one) => one.name)).toEqual(['B', 'D'])
    // The one that left cannot stay between them: `IX-46` wants the rest contiguous.
    expect(chained.map((one) => one.position)[1]).toBe(
      (chained.map((one) => one.position)[0] ?? 0) + 1,
    )
  })

  test('T-SP-ROUTINE-32 but leaving a chain of two dissolves it, because one is nobody', () => {
    const freed = unchained(chainedWith(five(), 2, 3), 2)

    expect(freed.every((one) => one.supersetGroup === undefined)).toBe(true)
  })

  test('T-SP-ROUTINE-33 deleting a member never leaves a chain of one behind', () => {
    const gone = withoutStep(chainedWith(five(), 2, 3), 2)

    expect(gone.every((one) => one.supersetGroup === undefined)).toBe(true)
  })

  test('T-SP-ROUTINE-23 chaining with itself is not a chain', () => {
    expect(chainedWith(five(), 2, 2)).toEqual(five())
  })

  test('T-SP-ROUTINE-25 both halves of a chain carry the same letter', () => {
    const letters = chainLetters(chainedWith(five(), 2, 3))
    const marked = chainedWith(five(), 2, 3).filter((one) => one.supersetGroup !== undefined)

    expect(marked).toHaveLength(2)
    expect(letters.get(marked[0]?.supersetGroup ?? -1)).toBe('A')
    expect(letters.get(marked[1]?.supersetGroup ?? -1)).toBe('A')
  })

  test('T-SP-ROUTINE-26 letters follow the order they are read in, not the group number', () => {
    // The group number counts up as chains are made and broken, so the first superset
    // of a routine is easily «7». The letter is what somebody sees.
    const twice = chainedWith(chainedWith(five(), 4, 5), 1, 2)
    const letters = chainLetters(twice)

    expect([...letters.values()]).toEqual(['A', 'B'])
    expect(letters.get(twice[0]?.supersetGroup ?? -1)).toBe('A')
  })

  test('T-SP-ROUTINE-27 a routine with no chains has no letters', () => {
    expect(chainLetters(five()).size).toBe(0)
  })

  test('T-SP-ROUTINE-24 unchaining frees both, not only the one asked about', () => {
    const freed = unchained(chainedWith(five(), 2, 3), 2)

    expect(freed.every((one) => one.supersetGroup === undefined)).toBe(true)
  })
})

describe('swapping one exercise for another', () => {
  test('T-SP-ROUTINE-18 the movement changes and the prescription stays', () => {
    const loaded: WorkingStep = {
      ...step(1, 'A'),
      restSeconds: 90,
      loadUnit: 'lb',
      sets: [{ kind: 'warmup', reps: 12, load: 20 }],
    }
    const swapped = replacedStep([loaded, step(2, 'B')], 1, { id: 'other', name: 'Press plano' })

    expect(swapped[0]?.name).toBe('Press plano')
    expect(swapped[0]?.movementId).toBe('other')
    expect(swapped[0]?.sets).toEqual(loaded.sets)
    expect(swapped[0]?.restSeconds).toBe(90)
    expect(swapped[0]?.loadUnit).toBe('lb')
    expect(swapped[1]?.name).toBe('B')
  })
})

describe('a whole batch of exercises arrives at once', () => {
  const picked = [
    { id: 'm-1', name: 'Sentadilla con barra' },
    { id: 'm-2', name: 'Press de banca con barra' },
    { id: 'm-3', name: 'Curl de bíceps con barra' },
  ]

  test('T-SP-ROUTINE-12 three picked are three steps, numbered without a gap', () => {
    // One batch, one save. Adding them one at a time is what the sheet did, and it
    // wrote the draft once per exercise.
    const steps = withPicked([], picked)

    expect(steps.map((one) => one.position)).toEqual([1, 2, 3])
    expect(steps.map((one) => one.movementId)).toEqual(['m-1', 'm-2', 'm-3'])
  })

  test('T-SP-ROUTINE-13 a batch lands after what was already there, renumbered from one', () => {
    const steps = withPicked([step(1, 'A')], picked.slice(0, 2))

    expect(steps.map((one) => one.position)).toEqual([1, 2, 3])
    expect(steps[0]?.name).toBe('A')
  })

  test('T-SP-ROUTINE-14 an exercise already in the routine is not added twice', () => {
    const first = withPicked([], picked)

    expect(withPicked(first, picked).length).toBe(3)
  })

  test('T-SP-ROUTINE-15 a batch opens on the first scheme, which the screen then edits', () => {
    const [first] = withPicked([], picked.slice(0, 1))

    expect(first?.sets).toEqual([
      { kind: 'normal', reps: 8 },
      { kind: 'normal', reps: 8 },
      { kind: 'normal', reps: 8 },
      { kind: 'normal', reps: 8 },
    ])
  })

  test('T-SP-ROUTINE-16 and what is sent is the sets, never the aggregate', () => {
    // The summary is derived at publication. Sending a second copy of a number is
    // sending something that can disagree with the rows it summarises.
    const content = stepsToContent('Empuje', withPicked([], picked.slice(0, 1)), 'activity')
    const target = content.steps[0]?.target as Record<string, unknown>

    expect(target.sets).toHaveLength(4)
    expect(target.target_sets).toBeUndefined()
    expect(target.target_reps).toBeUndefined()
  })

  test('T-SP-ROUTINE-17 a set to failure carries no repetitions, because the number is whatever comes out', () => {
    const failing: WorkingStep = {
      position: 1,
      movementId: 'movement-1',
      name: 'Press',
      sets: [{ kind: 'to_failure' }],
    }
    const target = stepsToContent('Empuje', [failing], 'activity').steps[0]?.target as Record<
      string,
      unknown
    >
    const [only] = target.sets as { kind: string; target_reps?: number }[]

    expect(only?.kind).toBe('to_failure')
    expect(only?.target_reps).toBeUndefined()
    expect(reasonsNotToPublish('Empuje', [failing])).toEqual([])
  })
})

describe('el esfuerzo no se planifica', () => {
  // ADR-033: el RPE es lo que se siente al hacer la serie, y se registra al entrenar.
  test('un borrador que traía RPE lo pierde al leerse', () => {
    const steps = stepsFromContent({
      title: 'Pierna',
      activity_type_id: null,
      steps: [
        {
          position: 1,
          movement_id: 'movement-1',
          target: {
            family: 'strength',
            sets: [{ set_order: 1, kind: 'normal', target_reps: 8, target_rpe: 7.5 }],
          },
        },
      ],
    } as never)

    expect(Object.keys(steps[0]?.sets[0] ?? {})).not.toContain('rpe')
  })

  test('y el borrador que se guarda no lo lleva', () => {
    const content = stepsToContent(
      'Pierna',
      [
        {
          position: 1,
          movementId: 'movement-1',
          name: 'Sentadilla',
          sets: [{ kind: 'normal', reps: 8 }],
        },
      ],
      null,
    )

    const sets = (content.steps[0]?.target as { sets: Record<string, unknown>[] }).sets
    expect(Object.keys(sets[0] ?? {})).not.toContain('target_rpe')
  })
})
