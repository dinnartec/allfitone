import { beforeEach, describe, expect, test } from 'bun:test'

import {
  addsToRoutine,
  alreadyIn,
  declareAlreadyIn,
  declareReplacing,
  exerciseFilter,
  forgetExerciseFilter,
  rememberExerciseFilter,
  isPicked,
  offerExercisePick,
  replacingPosition,
  offerable,
  pickButton,
  pickLabel,
  takeExercisePick,
  togglePick,
  type PickedMovement,
} from './exercise-pick'

const SQUAT: PickedMovement = { id: 'm-1', name: 'Sentadilla con barra' }
const BENCH: PickedMovement = { id: 'm-2', name: 'Press de banca con barra' }
const CURL: PickedMovement = { id: 'm-3', name: 'Curl de bíceps con barra' }

describe('choosing several exercises at once', () => {
  test('T-SP-PICK-01 tapping one adds it and tapping it again takes it back', () => {
    const one = togglePick([], SQUAT)
    expect(isPicked(one, SQUAT.id)).toBe(true)

    expect(togglePick(one, SQUAT)).toEqual([])
  })

  test('T-SP-PICK-02 the batch reads in the list order, not the order it was tapped', () => {
    // The same canonicalisation `toggleFocus` does: what somebody confirms should read
    // the way the list they picked from reads.
    const picked = togglePick(togglePick(togglePick([], SQUAT), CURL), BENCH)

    expect(picked.map((one) => one.name)).toEqual([
      'Curl de bíceps con barra',
      'Press de banca con barra',
      'Sentadilla con barra',
    ])
  })

  test('T-SP-PICK-03 removing one leaves the rest alone', () => {
    const picked = togglePick(togglePick(togglePick([], SQUAT), CURL), BENCH)

    expect(togglePick(picked, BENCH).map((one) => one.id)).toEqual(['m-3', 'm-1'])
  })

  test('T-SP-PICK-04 the confirm counts out loud, because the batch is otherwise invisible', () => {
    expect(pickLabel(0)).toBe('Añadir')
    expect(pickLabel(1)).toBe('Añadir 1 ejercicio')
    expect(pickLabel(3)).toBe('Añadir 3 ejercicios')
  })

  test('T-SP-PICK-12 what is drawn is the count alone, and never longer than the name', () => {
    expect(pickButton(0)).toBe('Añadir')
    expect(pickButton(1)).toBe('Añadir 1')
    expect(pickButton(3)).toBe('Añadir 3')
    for (const count of [0, 1, 3, 12]) {
      expect(pickButton(count).length).toBeLessThanOrEqual(pickLabel(count).length)
    }
  })

  test('T-SP-PICK-05 what the routine already trains is not offered a second time', () => {
    const catalogue = [
      {
        id: 'm-1',
        discipline_code: 'strength',
        name: 'Sentadilla con barra',
        muscles: ['quadriceps'],
        equipment: ['barbell'],
        demo_url: null,
      },
      {
        id: 'm-2',
        discipline_code: 'strength',
        name: 'Press de banca con barra',
        muscles: ['chest'],
        equipment: ['barbell', 'bench'],
        demo_url: null,
      },
    ]

    expect(offerable(catalogue, ['m-1']).map((one) => one.id)).toEqual(['m-2'])
    expect(offerable(catalogue, []).length).toBe(2)
  })
})

describe('the selection crosses, the draft does not', () => {
  beforeEach(() => {
    takeExercisePick()
    declareAlreadyIn([])
    declareReplacing(undefined)
    forgetExerciseFilter()
  })

  test('T-SP-PICK-06 what the picker offers is what the editor collects', () => {
    offerExercisePick([SQUAT, BENCH])

    expect(takeExercisePick().map((one) => one.id)).toEqual(['m-1', 'm-2'])
  })

  test('T-SP-PICK-07 collecting empties it, so a second look does not append it again', () => {
    // Without this, opening the picker and coming back having chosen nothing would add
    // the previous batch a second time.
    offerExercisePick([SQUAT])
    takeExercisePick()

    expect(takeExercisePick()).toEqual([])
  })

  test('T-SP-PICK-08 collecting nothing is empty rather than undefined, because it is a list', () => {
    expect(takeExercisePick()).toEqual([])
  })

  test('T-SP-PICK-09 the editor says what is already in before it pushes', () => {
    declareAlreadyIn(['m-1', 'm-2'])

    expect(alreadyIn()).toEqual(['m-1', 'm-2'])
  })

  test('T-SP-PICK-14 the picker is told whether it is adding or substituting', () => {
    declareReplacing(3)

    expect(replacingPosition()).toBe(3)
  })

  test('T-SP-PICK-15 and adding says so out loud, so a cancelled swap cannot leak', () => {
    // Set once and never cleared, backing out of a substitution would leave the flag
    // behind and the next «Añadir ejercicio» would overwrite instead of appending.
    declareReplacing(3)
    declareReplacing(undefined)

    expect(replacingPosition()).toBeUndefined()
  })

  test('T-SP-PICK-10 the filter survives the trip to a filter screen and back', () => {
    // Three screens share it, so none of them can hold it: whichever did would lose
    // it on the way to the others.
    rememberExerciseFilter({ muscles: ['chest'], equipment: [] })

    expect(exerciseFilter().muscles).toEqual(['chest'])
    expect(exerciseFilter().muscles).toEqual(['chest'])
  })

  test('T-SP-PICK-11 and is forgotten on purpose, not on read like the batch', () => {
    rememberExerciseFilter({ muscles: ['chest'], equipment: ['barbell'] })
    forgetExerciseFilter()

    expect(exerciseFilter()).toEqual({ muscles: [], equipment: [] })
  })
})

describe('addsToRoutine', () => {
  test('the picker opens the detail with a draft to add to', () => {
    expect(addsToRoutine(undefined)).toBe(true)
  })

  test('a program opens it to look, and there is no draft behind it', () => {
    expect(addsToRoutine('program')).toBe(false)
  })

  test('a session in progress opens it to explain, and has no draft either', () => {
    expect(addsToRoutine('session')).toBe(false)
  })

  test('a repeated parameter still says where it came from', () => {
    expect(addsToRoutine(['program', 'program'])).toBe(false)
  })
})
